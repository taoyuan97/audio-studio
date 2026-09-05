"""TTS defaults / preview / jobs API 与 run handler。"""

from __future__ import annotations

import os
import hashlib
import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from ..config import Settings, SettingsStore
from ..database import (
    DuplicateCustomVoiceError,
    NotFoundError,
    Repository,
    new_id,
)
from ..errors import ApiError, conflict, invalid, not_found
from ..ffmpeg import FFmpegError
from ..runs import RunContext
from ..security import require_local_origin
from .audio import fake_speech, finalize_audio, validate_wav
from .capabilities import get_capabilities
from .plan import build_plan, validate_plan
from .providers import TTSProviderError, make_provider
from .voices import SCENE_PRESETS, voice_by_id, voices_for

router = APIRouter(prefix="/api/tts", tags=["tts"])
MAX_TEXT_LENGTH = 20_000
PREVIEW_TEXT = "你好，请放松呼吸，聆听此刻的声音。"
VOICE_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


class TTSJobRequest(BaseModel):
    script_artifact_id: str | None = None
    text: str | None = None
    scene: str = "meditation"
    engine: str
    voice_id: str
    speed: float = Field(ge=0.5, le=1.5)
    pitch: float | None = Field(default=None, ge=-12, le=12)
    format: str = "mp3"


def _validate_identifier(value: str, label: str) -> str:
    normalized = value.strip()
    if not VOICE_IDENTIFIER_RE.fullmatch(normalized):
        raise ValueError(f"{label}格式无效，仅支持字母、数字、点、下划线和连字符")
    return normalized


def _normalize_voice_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 100 or any(ord(char) < 32 for char in normalized):
        raise ValueError("音色名称格式无效或超过 100 字符")
    return normalized


class CustomVoiceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str
    voice_id: str
    name: str | None = None


class CustomVoiceRename(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None


class CustomVoiceVerify(BaseModel):
    model_config = ConfigDict(extra="forbid")

    force: bool = False


def _system_voice_payload(voice: dict) -> dict:
    return {
        **voice,
        "source": "system",
        "custom_voice_id": None,
        "verification_status": None,
    }


def _custom_voice_payload(voice: dict) -> dict:
    return {
        "id": voice["voice_id"],
        "name": voice["display_name"],
        "tags": ["自定义"],
        "recommended_scene": None,
        "source": "custom",
        "custom_voice_id": voice["id"],
        "verification_status": voice["verification_status"],
    }


def _preview_cache_path(
    audio_dir: Path, engine: str, model: str, voice_id: str
) -> Path:
    identity = f"{engine}\0{model}\0{voice_id}".encode("utf-8")
    digest = hashlib.sha256(identity).hexdigest()
    return audio_dir / "previews" / f"{engine}_{digest}.wav"


def _engine_payload(settings: Settings, repo: Repository, engine: str) -> dict:
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    capabilities = get_capabilities(engine, model)
    voices = [_system_voice_payload(voice) for voice in voices_for(engine, model)]
    if engine == "aliyun":
        voices.extend(
            _custom_voice_payload(voice)
            for voice in repo.list_tts_custom_voices(engine="aliyun", model=model)
        )
    return {
        "id": engine,
        "name": "阿里云" if engine == "aliyun" else "火山引擎",
        "model": model,
        **capabilities.as_dict(),
        "voices": voices,
    }


@router.get("/defaults")
def defaults(request: Request):
    settings: Settings = request.app.state.settings_store.current
    repo: Repository = request.app.state.repository
    return {
        "engines": [
            _engine_payload(settings, repo, "aliyun"),
            _engine_payload(settings, repo, "volc"),
        ],
        "scene_presets": SCENE_PRESETS,
    }


def _validate_engine(
    repo: Repository,
    settings: Settings,
    engine: str,
    voice_id: str,
    pitch: float | None,
) -> tuple[str, dict]:
    if engine not in ("aliyun", "volc"):
        raise invalid("TTS_PARAMS_INVALID", "TTS 引擎无效")
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    system_voice = voice_by_id(engine, voice_id, model)
    voice = (
        {**system_voice, "source": "system"}
        if system_voice is not None
        else None
    )
    if voice is None and engine == "aliyun":
        custom_voice = repo.find_tts_custom_voice(engine, model, voice_id)
        if custom_voice is not None:
            voice = {
                "id": voice_id,
                "name": custom_voice["display_name"],
                "source": "custom",
            }
    if voice is None:
        raise not_found("TTS_VOICE_NOT_FOUND", "音色不存在")
    capabilities = get_capabilities(engine, model, voice_id)
    if pitch is not None and not capabilities.supports_pitch:
        raise invalid("TTS_PARAMS_INVALID", "当前引擎不支持音调调节")
    return model, voice


async def _synthesize_one(
    settings: Settings,
    engine: str,
    text: str,
    *,
    model: str | None = None,
    **kwargs,
) -> bytes:
    if settings.fake_mode:
        return fake_speech(text, kwargs["speed"]).audio
    provider = make_provider(settings, engine, model=model)
    result = await provider.synthesize(text, **kwargs)
    return result.audio


def _custom_voice_or_404(repo: Repository, custom_voice_id: str) -> dict:
    try:
        return repo.get_tts_custom_voice(custom_voice_id)
    except NotFoundError:
        raise not_found(
            "TTS_CUSTOM_VOICE_NOT_FOUND", "自定义音色不存在"
        ) from None


@router.get("/custom-voices")
def list_custom_voices(request: Request, model: str | None = None):
    repo: Repository = request.app.state.repository
    normalized_model = model.strip() if model else None
    return {
        "items": repo.list_tts_custom_voices(
            engine="aliyun", model=normalized_model or None
        )
    }


@router.post("/custom-voices", status_code=201)
def create_custom_voice(payload: CustomVoiceCreate, request: Request):
    require_local_origin(request)
    repo: Repository = request.app.state.repository
    try:
        model = _validate_identifier(payload.model, "模型 ID")
        voice_id = _validate_identifier(payload.voice_id, "音色 ID")
        name = _normalize_voice_name(payload.name)
    except ValueError as exc:
        raise invalid("TTS_CUSTOM_VOICE_PARAMS_INVALID", str(exc)) from None
    if voice_by_id("aliyun", voice_id, model) is not None:
        raise conflict(
            "TTS_CUSTOM_VOICE_SYSTEM_CONFLICT", "该音色已是当前模型的系统音色"
        )
    try:
        return repo.create_tts_custom_voice(
            engine="aliyun",
            model=model,
            voice_id=voice_id,
            name=name,
        )
    except DuplicateCustomVoiceError:
        raise conflict(
            "TTS_CUSTOM_VOICE_DUPLICATE", "该模型下已存在相同音色，请编辑已有记录"
        ) from None


@router.patch("/custom-voices/{custom_voice_id}")
def rename_custom_voice(
    custom_voice_id: str, payload: CustomVoiceRename, request: Request
):
    require_local_origin(request)
    if "name" not in payload.model_fields_set:
        raise invalid("TTS_CUSTOM_VOICE_PARAMS_INVALID", "请提供音色名称")
    repo: Repository = request.app.state.repository
    try:
        name = _normalize_voice_name(payload.name)
    except ValueError as exc:
        raise invalid("TTS_CUSTOM_VOICE_PARAMS_INVALID", str(exc)) from None
    try:
        return repo.rename_tts_custom_voice(custom_voice_id, name)
    except NotFoundError:
        raise not_found(
            "TTS_CUSTOM_VOICE_NOT_FOUND", "自定义音色不存在"
        ) from None


@router.delete("/custom-voices/{custom_voice_id}")
def delete_custom_voice(custom_voice_id: str, request: Request):
    require_local_origin(request)
    repo: Repository = request.app.state.repository
    voice = _custom_voice_or_404(repo, custom_voice_id)
    cache = _preview_cache_path(
        request.app.state.audio_dir,
        voice["engine"],
        voice["model"],
        voice["voice_id"],
    )
    try:
        cache.unlink(missing_ok=True)
        cache.with_suffix(".wav.part").unlink(missing_ok=True)
    except OSError:
        raise ApiError(
            "TTS_CUSTOM_VOICE_DELETE_FAILED", "试听缓存删除失败，请检查数据目录权限", 500
        ) from None
    repo.delete_tts_custom_voice(custom_voice_id)
    return {"deleted": True}


@router.post("/custom-voices/{custom_voice_id}/verify")
async def verify_custom_voice(
    custom_voice_id: str, payload: CustomVoiceVerify, request: Request
):
    require_local_origin(request)
    repo: Repository = request.app.state.repository
    voice = _custom_voice_or_404(repo, custom_voice_id)
    cache = _preview_cache_path(
        request.app.state.audio_dir,
        voice["engine"],
        voice["model"],
        voice["voice_id"],
    )
    preview_url = f"/api/tts/custom-voices/{custom_voice_id}/preview"
    if cache.is_file() and not payload.force:
        return {"voice": voice, "preview_url": preview_url, "cache_hit": True}
    temporary = cache.with_suffix(".wav.part")
    try:
        audio = await _synthesize_one(
            request.app.state.settings_store.current,
            "aliyun",
            PREVIEW_TEXT,
            model=voice["model"],
            voice=voice["voice_id"],
            speed=1.0,
            pitch=None,
            emotion=None,
            enable_ssml=False,
        )
        validate_wav(audio)
        temporary.write_bytes(audio)
        os.replace(temporary, cache)
        updated = repo.set_tts_custom_voice_verification(
            custom_voice_id, status="verified"
        )
        return {"voice": updated, "preview_url": preview_url, "cache_hit": False}
    except (TTSProviderError, OSError, ValueError) as exc:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        message = str(exc).replace("\r", " ").replace("\n", " ")[:200]
        repo.set_tts_custom_voice_verification(
            custom_voice_id, status="failed", error=message
        )
        raise ApiError("TTS_CUSTOM_VOICE_VERIFY_FAILED", message, 502) from None


@router.get("/custom-voices/{custom_voice_id}/preview")
def custom_voice_preview(custom_voice_id: str, request: Request):
    repo: Repository = request.app.state.repository
    voice = _custom_voice_or_404(repo, custom_voice_id)
    cache = _preview_cache_path(
        request.app.state.audio_dir,
        voice["engine"],
        voice["model"],
        voice["voice_id"],
    )
    if not cache.is_file():
        raise not_found(
            "TTS_CUSTOM_VOICE_PREVIEW_NOT_FOUND", "该音色尚无试听缓存"
        )
    return FileResponse(
        cache,
        media_type="audio/wav",
        filename=f"custom-voice-{custom_voice_id}.wav",
    )


@router.get("/voices/{engine}/{voice_id}/preview")
async def preview(engine: str, voice_id: str, request: Request):
    settings: Settings = request.app.state.settings_store.current
    if engine not in ("aliyun", "volc"):
        raise invalid("TTS_PARAMS_INVALID", "TTS 引擎无效")
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    if voice_by_id(engine, voice_id, model) is None:
        raise not_found("TTS_VOICE_NOT_FOUND", "系统音色不存在")
    cache = _preview_cache_path(request.app.state.audio_dir, engine, model, voice_id)
    if not cache.is_file():
        try:
            audio = await _synthesize_one(
                settings,
                engine,
                PREVIEW_TEXT,
                model=model,
                voice=voice_id,
                speed=1.0,
                pitch=None,
                emotion=None,
                enable_ssml=False,
            )
            validate_wav(audio)
            temporary = cache.with_suffix(".wav.part")
            temporary.write_bytes(audio)
            os.replace(temporary, cache)
        except (TTSProviderError, OSError, ValueError) as exc:
            raise ApiError("TTS_PROVIDER_ERROR", str(exc), 502) from None
    return FileResponse(cache, media_type="audio/wav", filename=f"{engine}_{voice_id}.wav")


@router.post("/jobs", status_code=202)
async def submit_job(payload: TTSJobRequest, request: Request):
    repo: Repository = request.app.state.repository
    settings: Settings = request.app.state.settings_store.current
    if bool(payload.script_artifact_id) == bool(payload.text and payload.text.strip()):
        raise invalid("TTS_TEXT_EMPTY", "脚本产物与粘贴文本必须且只能提供一项")
    if payload.scene not in SCENE_PRESETS or payload.format not in ("mp3", "wav"):
        raise invalid("TTS_PARAMS_INVALID", "场景或输出格式无效")
    model, voice = _validate_engine(
        repo, settings, payload.engine, payload.voice_id, payload.pitch
    )

    source_name = "自定义文本"
    conversation_id = None
    text = (payload.text or "").strip()
    if payload.script_artifact_id:
        try:
            artifact = repo.get_artifact(payload.script_artifact_id)
        except NotFoundError:
            raise not_found("ARTIFACT_NOT_FOUND", "脚本产物不存在") from None
        if not artifact["type"].startswith("script") or not artifact.get("content"):
            raise invalid("TTS_PARAMS_INVALID", "来源产物不是脚本")
        text = str(artifact["content"].get("text") or "").strip()
        source_name = artifact["name"]
        conversation_id = artifact["conversation_id"]
        inferred_scene = "meditation" if artifact["type"] == "script_meditation" else "podcast"
        if payload.scene != inferred_scene:
            raise invalid("TTS_PARAMS_INVALID", "场景与脚本产物不一致")
    if not text:
        raise invalid("TTS_TEXT_EMPTY", "待合成文本为空")
    if len(text) > MAX_TEXT_LENGTH:
        raise invalid("TTS_TEXT_TOO_LONG", "待合成文本超过 20000 字符")
    if not settings.fake_mode:
        configured = (
            bool(settings.aliyun_tts_api_key)
            if payload.engine == "aliyun"
            else bool(settings.volc_tts_app_id and settings.volc_tts_access_token)
        )
        if not configured:
            raise ApiError("TTS_PROVIDER_ERROR", "当前 TTS 引擎未配置", 502)

    snapshot = {
        "text": text,
        "source_name": source_name,
        "scene": payload.scene,
        "engine": payload.engine,
        "model": model,
        "voice_id": payload.voice_id,
        "voice_name": voice["name"],
        "voice_source": voice["source"],
        "speed": payload.speed,
        "pitch": payload.pitch,
        "script_artifact_id": payload.script_artifact_id,
        "format": payload.format,
    }
    active = repo.active_run_for_request("tts", snapshot)
    if active:
        raise conflict("TTS_RUN_ACTIVE", "相同参数的 TTS 任务正在运行")
    manager = request.app.state.runs
    run = await manager.enqueue(
        "tts", conversation_id=conversation_id, result={"request": snapshot}
    )
    return manager.run_payload(run)


def make_tts_handler(repo: Repository, settings_store: SettingsStore, audio_dir: Path):
    async def handle(ctx: RunContext) -> str:
        settings = settings_store.current
        run = repo.get_run(ctx.run_id)
        snapshot = (run.get("result") or {}).get("request")
        if not snapshot:
            raise ApiError("TTS_PARAMS_INVALID", "TTS 任务快照缺失", 422)
        capabilities = get_capabilities(
            snapshot["engine"], snapshot["model"], snapshot["voice_id"]
        )
        plan = build_plan(snapshot["text"], capabilities, snapshot["speed"])
        if not plan:
            raise ApiError("TTS_TEXT_EMPTY", "待合成文本为空", 422)
        try:
            validate_plan(plan)
        except ValueError as exc:
            raise ApiError("TTS_TEXT_INVALID", str(exc), 422) from None
        parts: list[bytes] = []
        total = len(plan)
        speech_request = 0
        final: Path | None = None
        artifact_created = False
        try:
            for index, segment in enumerate(plan, start=1):
                ctx.check_cancelled()
                if segment.kind == "silence":
                    from .audio import silence_wav

                    audio = silence_wav(segment.seconds)
                else:
                    speech_request += 1
                    try:
                        audio = await _synthesize_one(
                            settings,
                            snapshot["engine"],
                            segment.text,
                            model=snapshot["model"],
                            voice=snapshot["voice_id"],
                            speed=segment.speed,
                            pitch=snapshot["pitch"],
                            emotion=segment.emotion,
                            enable_ssml=segment.enable_ssml,
                        )
                    except TTSProviderError as exc:
                        raise TTSProviderError(
                            f"第 {index}/{total} 段合成失败"
                            f"（TTS 请求 {speech_request}，文本长度 {len(segment.text)}）：{exc}"
                        ) from exc
                parts.append(audio)
                ctx.report_progress(
                    completed=index,
                    total=total,
                    stage="synthesizing",
                    event="tts.progress",
                    extra={"segment": index, "total_segments": total},
                )
            ctx.check_cancelled()
            ctx.report_progress(completed=total, total=total, stage="assembling", event="tts.progress")
            artifact_id = new_id("art")
            final, duration = finalize_audio(
                parts,
                artifact_id=artifact_id,
                output_format=snapshot["format"],
                audio_dir=audio_dir,
                ffmpeg_path=settings.ffmpeg_path,
            )
            ctx.check_cancelled()
            ctx.report_progress(completed=total, total=total, stage="encoding", event="tts.progress")
            params = {key: value for key, value in snapshot.items() if key not in ("text", "source_name")}
            repo.insert_artifact(
                artifact_id=artifact_id,
                type="voice",
                name=f"人声 · {snapshot['voice_name']} · {snapshot['source_name']}",
                conversation_id=run["conversation_id"],
                source_run_id=ctx.run_id,
                params=params,
                content={"text": snapshot["text"]},
                audio_path=f"artifacts/{artifact_id}.{snapshot['format']}",
                audio_format=snapshot["format"],
                duration=duration,
            )
            artifact_created = True
            repo.set_run_result(ctx.run_id, {"request": snapshot, "artifact_id": artifact_id})
            return artifact_id
        except TTSProviderError as exc:
            raise ApiError("TTS_PROVIDER_ERROR", str(exc), 502) from None
        except FFmpegError as exc:
            raise ApiError("TTS_PROVIDER_ERROR", f"音频编码失败：{exc}", 502) from None
        except ValueError as exc:
            raise ApiError("TTS_PROVIDER_ERROR", str(exc), 502) from None
        finally:
            if final is not None and not artifact_created:
                final.unlink(missing_ok=True)

    return handle
