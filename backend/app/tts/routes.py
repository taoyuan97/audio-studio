"""TTS defaults / preview / jobs API 与 run handler。"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import Settings
from ..database import NotFoundError, Repository, new_id
from ..errors import ApiError, conflict, invalid, not_found
from ..ffmpeg import FFmpegError
from ..runs import RunContext
from .audio import fake_speech, finalize_audio, validate_wav
from .capabilities import get_capabilities
from .plan import build_plan, validate_plan
from .providers import TTSProviderError, make_provider
from .voices import SCENE_PRESETS, voice_by_id, voices_for

router = APIRouter(prefix="/api/tts", tags=["tts"])
MAX_TEXT_LENGTH = 20_000
PREVIEW_TEXT = "你好，请放松呼吸，聆听此刻的声音。"


class TTSJobRequest(BaseModel):
    script_artifact_id: str | None = None
    text: str | None = None
    scene: str = "meditation"
    engine: str
    voice_id: str
    speed: float = Field(ge=0.5, le=1.5)
    pitch: float | None = Field(default=None, ge=-12, le=12)
    format: str = "mp3"


def _engine_payload(settings: Settings, engine: str) -> dict:
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    capabilities = get_capabilities(engine, model)
    return {
        "id": engine,
        "name": "阿里云" if engine == "aliyun" else "火山引擎",
        "model": model,
        **capabilities.as_dict(),
        "voices": voices_for(engine),
    }


@router.get("/defaults")
def defaults(request: Request):
    settings: Settings = request.app.state.settings
    return {
        "engines": [_engine_payload(settings, "aliyun"), _engine_payload(settings, "volc")],
        "scene_presets": SCENE_PRESETS,
    }


def _validate_engine(settings: Settings, engine: str, voice_id: str, pitch: float | None) -> tuple[str, dict]:
    if engine not in ("aliyun", "volc"):
        raise invalid("TTS_PARAMS_INVALID", "TTS 引擎无效")
    voice = voice_by_id(engine, voice_id)
    if voice is None:
        raise not_found("TTS_VOICE_NOT_FOUND", "音色不存在")
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    capabilities = get_capabilities(engine, model, voice_id)
    if pitch is not None and not capabilities.supports_pitch:
        raise invalid("TTS_PARAMS_INVALID", "当前引擎不支持音调调节")
    return model, voice


async def _synthesize_one(settings: Settings, engine: str, text: str, **kwargs) -> bytes:
    if settings.fake_mode:
        return fake_speech(text, kwargs["speed"]).audio
    provider = make_provider(settings, engine)
    result = await provider.synthesize(text, **kwargs)
    return result.audio


@router.get("/voices/{engine}/{voice_id}/preview")
async def preview(engine: str, voice_id: str, request: Request):
    settings: Settings = request.app.state.settings
    _model, _voice = _validate_engine(settings, engine, voice_id, None)
    cache = request.app.state.audio_dir / "previews" / f"{engine}_{voice_id}.wav"
    if not cache.is_file():
        try:
            audio = await _synthesize_one(
                settings,
                engine,
                PREVIEW_TEXT,
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
    settings: Settings = request.app.state.settings
    if bool(payload.script_artifact_id) == bool(payload.text and payload.text.strip()):
        raise invalid("TTS_TEXT_EMPTY", "脚本产物与粘贴文本必须且只能提供一项")
    if payload.scene not in SCENE_PRESETS or payload.format not in ("mp3", "wav"):
        raise invalid("TTS_PARAMS_INVALID", "场景或输出格式无效")
    model, voice = _validate_engine(settings, payload.engine, payload.voice_id, payload.pitch)

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


def make_tts_handler(repo: Repository, settings: Settings, audio_dir: Path):
    async def handle(ctx: RunContext) -> str:
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
