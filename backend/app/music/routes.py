"""BGM defaults / jobs / retry API 与 run handler。"""

from __future__ import annotations

import asyncio
import os
import time
from contextlib import suppress
from pathlib import Path

import httpx
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ..config import Settings
from ..database import NotFoundError, Repository, new_id, now_ms
from ..errors import ApiError, conflict, invalid
from ..runs import RunCancelledError, RunContext
from .fake import generate_fake_music
from .minimax import MODEL, generate_music
from .postprocess import MusicProcessingError, process_music
from .provider import MusicGenerationRequest, MusicServiceError

router = APIRouter(prefix="/api/music", tags=["music"])
STRUCTURE_HINTS = ("intro", "build_up", "drop", "outro")
PROMPT_SUGGESTIONS = (
    {"id": "zen", "label": "古琴与空灵氛围", "prompt": "空灵缓慢的冥想背景音乐，以古琴和柔和氛围音色为主，无明显鼓点，动态平稳"},
    {"id": "electronic", "label": "柔和电子与缓慢脉冲", "prompt": "柔和电子 Pad 与缓慢脉冲，温暖、克制、低动态，适合呼吸练习"},
    {"id": "piano", "label": "抒情钢琴与温暖弦乐", "prompt": "简洁抒情的钢琴主题，辅以温暖弦乐，节奏自由，旋律自然重复"},
    {"id": "drone", "label": "颂钵与深度冥想", "prompt": "颂钵、低频 Drone 和细微环境质感，极慢、深沉、没有明显高潮"},
)
ERROR_HTTP_STATUS = {
    "MUSIC_RATE_LIMITED": 429,
    "MUSIC_CONTENT_REJECTED": 422,
    "MUSIC_REQUEST_INVALID": 422,
    "MUSIC_TIMEOUT": 504,
}


class MusicJobRequest(BaseModel):
    prompt: str
    target_duration: int
    structure_hints: list[str] = Field(default_factory=list)
    format: str = "mp3"


class MusicRetryRequest(BaseModel):
    mode: str
    confirm_regenerate: bool | None = None


@router.get("/defaults")
def defaults():
    return {
        "provider": "minimax",
        "model": MODEL,
        "capabilities": {
            "instrumental": True,
            "prompt_max_length": 2000,
            "native_duration": False,
            "structure_control": "prompt_hint",
            "remote_url": True,
        },
        "prompt_suggestions": PROMPT_SUGGESTIONS,
        "structure_hints": STRUCTURE_HINTS,
        "duration_range": {"min": 60, "max": 600},
    }


def _snapshot(payload: MusicJobRequest) -> dict:
    prompt = payload.prompt.strip()
    if not 1 <= len(prompt) <= 2000:
        raise invalid("MUSIC_PARAMS_INVALID", "音乐描述长度必须为 1～2000 个字符")
    if not 60 <= payload.target_duration <= 600:
        raise invalid("MUSIC_PARAMS_INVALID", "目标时长必须为 60～600 秒")
    if payload.format not in {"mp3", "wav"}:
        raise invalid("MUSIC_PARAMS_INVALID", "输出格式仅支持 MP3 或 WAV")
    if len(payload.structure_hints) != len(set(payload.structure_hints)) or any(
        item not in STRUCTURE_HINTS for item in payload.structure_hints
    ):
        raise invalid("MUSIC_PARAMS_INVALID", "结构倾向无效或重复")
    return {
        "provider": "minimax",
        "model": MODEL,
        "prompt": prompt,
        "target_duration": payload.target_duration,
        "structure_hints": payload.structure_hints,
        "format": payload.format,
    }


@router.post("/jobs", status_code=202)
async def submit_job(payload: MusicJobRequest, request: Request):
    repo: Repository = request.app.state.repository
    settings: Settings = request.app.state.settings
    snapshot = _snapshot(payload)
    if not settings.fake_mode and not settings.minimax_api_key:
        raise ApiError("MUSIC_AUTH_FAILED", "未配置 MiniMax API Key", 502)
    if repo.active_run_for_request("music", snapshot):
        raise conflict("MUSIC_RUN_ACTIVE", "相同参数的 BGM 任务正在运行")
    manager = request.app.state.runs
    run = await manager.enqueue("music", result={"request": snapshot, "source_run_id": None})
    return manager.run_payload(run)


def _get_retryable_run(repo: Repository, run_id: str) -> dict:
    try:
        run = repo.get_run(run_id)
    except NotFoundError:
        raise ApiError("RUN_NOT_FOUND", "运行不存在", 404) from None
    if run["kind"] != "music" or run["status"] != "failed":
        raise conflict("RUN_NOT_RETRYABLE", "仅失败的 BGM 任务可以重试")
    if not (run.get("result") or {}).get("request"):
        raise conflict("RUN_NOT_RETRYABLE", "失败任务缺少可复用参数")
    return run


@router.post("/jobs/{run_id}/retry", status_code=202)
async def retry_job(run_id: str, payload: MusicRetryRequest, request: Request):
    repo: Repository = request.app.state.repository
    original = _get_retryable_run(repo, run_id)
    result = original.get("result") or {}
    snapshot = result["request"]
    if payload.mode == "download":
        expires_at = result.get("expires_at")
        if not result.get("audio_url") or not isinstance(expires_at, int) or expires_at <= now_ms():
            raise invalid("MUSIC_URL_EXPIRED", "音乐下载地址缺失或已过期，请重新生成")
        next_result = {
            "request": snapshot,
            "source_run_id": run_id,
            "audio_url": result["audio_url"],
            "expires_at": expires_at,
            "request_id": result.get("request_id"),
            "source_duration": result.get("source_duration"),
        }
    elif payload.mode == "regenerate":
        if payload.confirm_regenerate is not True:
            raise invalid("MUSIC_REGENERATE_UNCONFIRMED", "重新生成可能再次计费，请明确确认")
        next_result = {"request": snapshot, "source_run_id": run_id}
    else:
        raise invalid("MUSIC_PARAMS_INVALID", "重试模式无效")
    manager = request.app.state.runs
    run = await manager.enqueue("music", result=next_result)
    return manager.run_payload(run)


async def _emit_progress(repo: Repository, ctx: RunContext, phase: str, waited_s: int = 0) -> None:
    repo.set_run_progress(ctx.run_id, {"completed": 0, "total": 1, "stage": phase})
    await ctx.emit("music.progress", {"phase": phase, "waited_s": waited_s})


async def _generate_with_heartbeat(ctx: RunContext, repo: Repository, settings: Settings, request: MusicGenerationRequest):
    task = asyncio.create_task(
        generate_music(settings.minimax_api_key, request, timeout=settings.minimax_timeout_seconds)
    )
    started = time.monotonic()
    next_heartbeat = 0.0
    try:
        while not task.done():
            ctx.check_cancelled()
            waited = time.monotonic() - started
            if waited >= next_heartbeat:
                await _emit_progress(repo, ctx, "generating", int(waited))
                next_heartbeat += 5
            await ctx.sleep(0.2)
        return await task
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


async def _download(ctx: RunContext, url: str, destination: Path) -> None:
    part = destination.with_suffix(destination.suffix + ".part")
    try:
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                written = 0
                with part.open("wb") as output:
                    async for chunk in response.aiter_bytes():
                        ctx.check_cancelled()
                        if chunk:
                            output.write(chunk)
                            written += len(chunk)
        if written <= 0:
            raise ApiError("MUSIC_DOWNLOAD_FAILED", "下载到的音乐文件为空", 502)
        os.replace(part, destination)
    except RunCancelledError:
        raise
    except (httpx.HTTPError, OSError):
        raise ApiError("MUSIC_DOWNLOAD_FAILED", "远程音乐下载失败", 502) from None
    finally:
        part.unlink(missing_ok=True)


def make_music_handler(repo: Repository, settings: Settings, audio_dir: Path):
    async def handle(ctx: RunContext) -> str:
        run = repo.get_run(ctx.run_id)
        stored = run.get("result") or {}
        snapshot = stored.get("request")
        if not snapshot:
            raise ApiError("MUSIC_PARAMS_INVALID", "BGM 任务快照缺失", 422)
        request = MusicGenerationRequest(
            prompt=snapshot["prompt"],
            target_duration=snapshot["target_duration"],
            structure_hints=tuple(snapshot["structure_hints"]),
            output_format=snapshot["format"],
        )
        artifacts_dir = audio_dir / "artifacts"
        source_format = "wav" if settings.fake_mode else "mp3"
        source = artifacts_dir / f".{ctx.run_id}.source.{source_format}"
        artifact_id = new_id("art")
        final = artifacts_dir / f"{artifact_id}.{snapshot['format']}"
        artifact_created = False
        remote_result = dict(stored)
        try:
            if stored.get("audio_url"):
                await _emit_progress(repo, ctx, "downloading")
                await _download(ctx, stored["audio_url"], source)
            elif settings.fake_mode:
                await _emit_progress(repo, ctx, "generating", 0)
                source_duration = await asyncio.to_thread(
                    generate_fake_music, source, snapshot["prompt"], snapshot["structure_hints"]
                )
                remote_result["source_duration"] = source_duration
                repo.set_run_result(ctx.run_id, remote_result)
                await _emit_progress(repo, ctx, "downloading")
            else:
                generated = await _generate_with_heartbeat(ctx, repo, settings, request)
                remote_result.update(
                    audio_url=generated.audio_url,
                    expires_at=generated.expires_at_ms,
                    request_id=generated.request_id,
                    source_duration=generated.duration_seconds,
                )
                repo.set_run_result(ctx.run_id, remote_result)
                ctx.check_cancelled()
                await _emit_progress(repo, ctx, "downloading")
                await _download(ctx, generated.audio_url, source)

            ctx.check_cancelled()
            await _emit_progress(repo, ctx, "processing")
            source_info, final_info = await asyncio.to_thread(
                process_music,
                source,
                final,
                snapshot["target_duration"],
                snapshot["format"],
                settings.ffmpeg_path,
            )
            ctx.check_cancelled()
            params = {
                **snapshot,
                "source_duration": round(source_info.duration_seconds, 3),
            }
            repo.insert_artifact(
                artifact_id=artifact_id,
                type="bgm",
                name="BGM · " + snapshot["prompt"][:24],
                source_run_id=ctx.run_id,
                params=params,
                audio_path=f"artifacts/{artifact_id}.{snapshot['format']}",
                audio_format=snapshot["format"],
                duration=final_info.duration_seconds,
            )
            artifact_created = True
            repo.set_run_result(ctx.run_id, {**remote_result, "artifact_id": artifact_id})
            return artifact_id
        except MusicServiceError as exc:
            raise ApiError(exc.code, exc.message, ERROR_HTTP_STATUS.get(exc.code, 502)) from None
        except MusicProcessingError as exc:
            status = 503 if exc.code == "MUSIC_FFMPEG_MISSING" else 500
            raise ApiError(exc.code, exc.message, status) from None
        finally:
            source.unlink(missing_ok=True)
            if not artifact_created:
                final.unlink(missing_ok=True)

    return handle
