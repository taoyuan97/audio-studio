"""最终混音：参数校验、可取消 FFmpeg 执行、原子导出与产物入库。"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from .config import SettingsStore
from .database import NotFoundError, Repository, new_id
from .errors import ApiError, conflict, invalid
from .ffmpeg import FFmpegError, find_ffmpeg, find_ffprobe
from .runs import RunCancelledError, RunContext

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/mixdown", tags=["mixdown"])

DUCKING_FILTER = "sidechaincompress=threshold=0.03:ratio=4:attack=50:release=400"
PUBLIC_FFMPEG_ERROR = "混音处理失败，请检查音频文件后重试"


class MixdownJobRequest(BaseModel):
    voice_artifact_id: str | None = None
    bgm_artifact_id: str | None = None
    voice_gain: int = 80
    bgm_gain: int = 45
    bgm_offset: float = 0
    ducking: bool = True
    format: str = "mp3"


@dataclass(frozen=True)
class MixAudioInfo:
    duration_seconds: float
    sample_rate: int
    channels: int


def _seconds(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def build_filter_graph(
    *,
    voice_duration: float,
    bgm_duration: float,
    voice_gain: int,
    bgm_gain: int,
    bgm_offset: float,
    ducking: bool,
) -> str:
    """构建双轨滤镜图；输入 0 为 voice，输入 1 为 bgm。"""
    target = _seconds(voice_duration)
    offset_ms = round(bgm_offset * 1000)
    voice = (
        f"[0:a]volume={voice_gain / 100:.4f},aresample=48000,"
        "asetpts=PTS-STARTPTS"
    )
    if ducking:
        voice += ",asplit=2[voice_mix][voice_sidechain]"
    else:
        voice += "[voice_mix]"

    if bgm_duration < voice_duration:
        length_filter = f"aloop=loop=-1:size=2147483647,atrim=duration={target}"
    else:
        length_filter = f"atrim=duration={target}"
    background = (
        f"[1:a]{length_filter},asetpts=PTS-STARTPTS,"
        f"adelay={offset_ms}:all=1,atrim=duration={target},"
        f"volume={bgm_gain / 100:.4f},aresample=48000[bgm_mix]"
    )

    if ducking:
        combine = (
            f"[bgm_mix][voice_sidechain]{DUCKING_FILTER}[bgm_ducked];"
            f"[voice_mix][bgm_ducked]amix=inputs=2:duration=first:"
            f"dropout_transition=0:normalize=0,atrim=duration={target}[mixout]"
        )
    else:
        combine = (
            f"[voice_mix][bgm_mix]amix=inputs=2:duration=first:"
            f"dropout_transition=0:normalize=0,atrim=duration={target}[mixout]"
        )
    return f"{voice};{background};{combine}"


def build_ffmpeg_args(
    *,
    voice_path: Path | None,
    bgm_path: Path | None,
    voice_duration: float | None,
    bgm_duration: float | None,
    voice_gain: int,
    bgm_gain: int,
    bgm_offset: float,
    ducking: bool,
    output_format: str,
    output_path: Path,
    bgm_format: str | None = None,
) -> list[str]:
    """按三种轨道组合生成 FFmpeg 参数，便于矩阵单测。"""
    args = ["-y", "-v", "error"]
    if voice_path is not None and bgm_path is not None:
        assert voice_duration is not None and bgm_duration is not None
        graph = build_filter_graph(
            voice_duration=voice_duration,
            bgm_duration=bgm_duration,
            voice_gain=voice_gain,
            bgm_gain=bgm_gain,
            bgm_offset=bgm_offset,
            ducking=ducking,
        )
        args += [
            "-i", str(voice_path), "-i", str(bgm_path),
            "-filter_complex", graph, "-map", "[mixout]",
        ]
    elif voice_path is not None:
        # 单人声语义为透传重编码；混音调节只在双轨组合中生效。
        args += ["-i", str(voice_path), "-map", "0:a:0", "-af", "aresample=48000"]
    elif bgm_path is not None:
        args += ["-i", str(bgm_path), "-map", "0:a:0"]
        if bgm_format == output_format:
            return [*args, "-c:a", "copy", "-f", output_format, str(output_path)]
        args += ["-af", "aresample=48000"]
    else:
        raise ValueError("至少需要一条音轨")

    codec = (
        ["-c:a", "libmp3lame", "-b:a", "320k", "-ar", "48000", "-f", "mp3"]
        if output_format == "mp3"
        else ["-c:a", "pcm_s16le", "-ar", "48000", "-f", "wav"]
    )
    return [*args, *codec, str(output_path)]


def _artifact_path(audio_dir: Path, artifact: dict[str, Any]) -> Path:
    audio = artifact.get("audio") or {}
    return audio_dir / "artifacts" / f"{artifact['id']}.{audio.get('format', '')}"


def _input_artifact(repo: Repository, artifact_id: str | None, expected: str) -> dict | None:
    if artifact_id is None:
        return None
    try:
        artifact = repo.get_artifact(artifact_id)
    except NotFoundError:
        raise invalid("MIX_INPUT_INVALID", "所选音轨不存在，请刷新后重试") from None
    if artifact["type"] != expected or not artifact.get("audio"):
        raise invalid("MIX_INPUT_INVALID", "所选产物不是有效的对应音轨")
    return artifact


def _snapshot(payload: MixdownJobRequest, repo: Repository) -> tuple[dict[str, Any], dict | None, dict | None]:
    if payload.voice_artifact_id is None and payload.bgm_artifact_id is None:
        raise invalid("MIX_INPUT_MISSING", "请至少选择一条音轨")
    if payload.format not in {"mp3", "wav"}:
        raise invalid("MIX_INPUT_INVALID", "输出格式仅支持 MP3 或 WAV")
    if not 0 <= payload.voice_gain <= 100 or not 0 <= payload.bgm_gain <= 100:
        raise invalid("MIX_INPUT_INVALID", "音量必须在 0～100 之间")
    if not 0 <= payload.bgm_offset <= 60:
        raise invalid("MIX_INPUT_INVALID", "背景偏移必须在 0～60 秒之间")
    voice = _input_artifact(repo, payload.voice_artifact_id, "voice")
    bgm = _input_artifact(repo, payload.bgm_artifact_id, "bgm")
    snapshot = {
        "voice_artifact_id": payload.voice_artifact_id,
        "bgm_artifact_id": payload.bgm_artifact_id,
        "voice_gain": payload.voice_gain,
        "bgm_gain": payload.bgm_gain,
        "bgm_offset": payload.bgm_offset if voice and bgm else 0,
        "ducking": payload.ducking if voice and bgm else False,
        "format": payload.format,
    }
    return snapshot, voice, bgm


@router.post("/jobs", status_code=202)
async def submit_job(payload: MixdownJobRequest, request: Request):
    repo: Repository = request.app.state.repository
    snapshot, _voice, _bgm = _snapshot(payload, repo)
    settings = request.app.state.settings_store.current
    if find_ffmpeg(settings.ffmpeg_path) is None or find_ffprobe(settings.ffmpeg_path) is None:
        raise ApiError("MIX_FFMPEG_MISSING", "FFmpeg/FFprobe 不可用，请安装或完成路径配置", 503)
    if repo.active_run_for_request("mixdown", snapshot):
        raise conflict("MIX_RUN_ACTIVE", "相同参数的混音任务正在运行")
    manager = request.app.state.runs
    run = await manager.enqueue("mixdown", result={"request": snapshot})
    return manager.run_payload(run)


def probe_mix_audio(path: Path, ffprobe_binary: str) -> MixAudioInfo:
    if not path.is_file() or path.stat().st_size <= 0:
        raise FFmpegError("输出文件不存在或为空")
    try:
        result = subprocess.run(
            [ffprobe_binary, "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=sample_rate,channels:format=duration", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FFmpegError("ffprobe 执行失败") from exc
    if result.returncode != 0:
        logger.error("ffprobe failed for %s: %s", path, result.stderr)
        raise FFmpegError("输出音频复验失败")
    try:
        payload = json.loads(result.stdout)
        stream = payload["streams"][0]
        return MixAudioInfo(
            duration_seconds=float(payload["format"]["duration"]),
            sample_rate=int(stream["sample_rate"]),
            channels=int(stream["channels"]),
        )
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise FFmpegError("输出音频参数无效") from exc


async def _run_cancellable(ctx: RunContext, binary: str, args: list[str], timeout: float = 300) -> None:
    ctx.check_cancelled()
    try:
        process = await asyncio.create_subprocess_exec(
            binary, *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except OSError as exc:
        raise FFmpegError("ffmpeg 启动失败") from exc
    communicate = asyncio.create_task(process.communicate())
    deadline = time.monotonic() + timeout
    try:
        while not communicate.done():
            ctx.check_cancelled()
            if time.monotonic() >= deadline:
                raise FFmpegError("ffmpeg 执行超时")
            await asyncio.sleep(0.1)
        _stdout, stderr = await communicate
        if process.returncode != 0:
            logger.error("ffmpeg failed for run %s: %s", ctx.run_id, stderr.decode(errors="replace"))
            raise FFmpegError("ffmpeg 执行失败")
    finally:
        if process.returncode is None:
            process.kill()
            with suppress(ProcessLookupError):
                await process.wait()
        if not communicate.done():
            communicate.cancel()
            with suppress(asyncio.CancelledError):
                await communicate


async def _emit_phase(repo: Repository, ctx: RunContext, phase: str) -> None:
    repo.set_run_progress(ctx.run_id, {"completed": 0, "total": 1, "stage": phase})
    await ctx.emit("mix.progress", {"phase": phase})


def make_mixdown_handler(repo: Repository, settings_store: SettingsStore, audio_dir: Path):
    async def handle(ctx: RunContext) -> str:
        run = repo.get_run(ctx.run_id)
        snapshot = (run.get("result") or {}).get("request")
        if not snapshot:
            raise ApiError("MIX_INPUT_INVALID", "混音任务快照缺失", 422)
        try:
            voice = _input_artifact(repo, snapshot["voice_artifact_id"], "voice")
            bgm = _input_artifact(repo, snapshot["bgm_artifact_id"], "bgm")
        except ApiError as exc:
            raise ApiError(exc.code, exc.message, 422) from None

        settings = settings_store.current
        ffmpeg_binary = find_ffmpeg(settings.ffmpeg_path)
        ffprobe_binary = find_ffprobe(settings.ffmpeg_path)
        if ffmpeg_binary is None or ffprobe_binary is None:
            raise ApiError("MIX_FFMPEG_MISSING", "FFmpeg/FFprobe 不可用，请安装或完成路径配置", 503)

        voice_path = _artifact_path(audio_dir, voice) if voice else None
        bgm_path = _artifact_path(audio_dir, bgm) if bgm else None
        if (voice_path and not voice_path.is_file()) or (bgm_path and not bgm_path.is_file()):
            raise ApiError("MIX_FFMPEG_ERROR", PUBLIC_FFMPEG_ERROR, 500)

        artifact_id = new_id("art")
        final = audio_dir / "artifacts" / f"{artifact_id}.{snapshot['format']}"
        part = final.with_suffix(final.suffix + ".part")
        artifact_created = False
        expected_duration = float((voice or bgm)["audio"]["duration"])
        try:
            await _emit_phase(repo, ctx, "prep")
            args = build_ffmpeg_args(
                voice_path=voice_path,
                bgm_path=bgm_path,
                voice_duration=float(voice["audio"]["duration"]) if voice else None,
                bgm_duration=float(bgm["audio"]["duration"]) if bgm else None,
                voice_gain=snapshot["voice_gain"],
                bgm_gain=snapshot["bgm_gain"],
                bgm_offset=snapshot["bgm_offset"],
                ducking=snapshot["ducking"],
                output_format=snapshot["format"],
                output_path=part,
                bgm_format=bgm["audio"]["format"] if bgm else None,
            )
            if voice and bgm and snapshot["ducking"]:
                await _emit_phase(repo, ctx, "ducking")
            ctx.check_cancelled()
            await _emit_phase(repo, ctx, "encode")
            await _run_cancellable(ctx, ffmpeg_binary, args)
            ctx.check_cancelled()
            info = await asyncio.to_thread(probe_mix_audio, part, ffprobe_binary)
            ctx.check_cancelled()
            if abs(info.duration_seconds - expected_duration) > 1:
                raise FFmpegError("输出时长复验失败")
            if snapshot["format"] == "wav" and info.sample_rate != 48000:
                raise FFmpegError("WAV 采样率复验失败")
            os.replace(part, final)
            ctx.check_cancelled()
            source_name = voice["name"] if voice else bgm["name"]
            repo.insert_artifact(
                artifact_id=artifact_id,
                type="mix",
                name=f"混音 · {source_name}",
                source_run_id=ctx.run_id,
                params=snapshot,
                audio_path=f"artifacts/{artifact_id}.{snapshot['format']}",
                audio_format=snapshot["format"],
                duration=info.duration_seconds,
            )
            artifact_created = True
            repo.set_run_result(ctx.run_id, {"request": snapshot, "artifact_id": artifact_id})
            return artifact_id
        except RunCancelledError:
            raise
        except FFmpegError:
            logger.exception("mixdown run %s failed", ctx.run_id)
            raise ApiError("MIX_FFMPEG_ERROR", PUBLIC_FFMPEG_ERROR, 500) from None
        except OSError:
            logger.exception("mixdown run %s file operation failed", ctx.run_id)
            raise ApiError("MIX_FFMPEG_ERROR", PUBLIC_FFMPEG_ERROR, 500) from None
        finally:
            part.unlink(missing_ok=True)
            if not artifact_created:
                final.unlink(missing_ok=True)

    return handle
