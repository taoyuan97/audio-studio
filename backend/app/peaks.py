"""波形峰值计算：音频文件 → 归一化幅度数组（≤1200 桶），结果缓存至 peaks/{id}.json。

- WAV：原生 wave 模块解码（无 ffmpeg 依赖）。
- MP3 等压缩格式：ffmpeg 解码为 PCM（要求 ffmpeg 可用）。
"""

from __future__ import annotations

import json
import struct
import wave
from pathlib import Path

from .errors import ApiError
from .ffmpeg import FFmpegError, find_ffmpeg
from . import ffmpeg as ffmpeg_mod

MAX_BUCKETS = 1200


def _peaks_from_samples(samples: bytes, channels: int, width: int) -> tuple[list[float], float]:
    """16bit PCM 字节 → 每桶最大绝对幅度归一化 + 总时长（秒）。"""
    frame_size = channels * width
    total_frames = len(samples) // frame_size if frame_size else 0
    if total_frames == 0:
        return [], 0.0
    buckets = min(MAX_BUCKETS, total_frames)
    frames_per_bucket = total_frames / buckets
    peaks: list[float] = []
    for bucket in range(buckets):
        start = int(bucket * frames_per_bucket)
        end = int((bucket + 1) * frames_per_bucket)
        chunk = samples[start * frame_size : end * frame_size]
        count = len(chunk) // 2
        values = struct.unpack(f"<{count}h", chunk[: count * 2]) if count else ()
        peak = max((abs(v) for v in values), default=0)
        peaks.append(min(1.0, peak / 32768.0))
    duration = total_frames * frame_size / (frame_size)  # placeholder, caller supplies rate
    return peaks, duration


def compute_peaks(audio_path: Path, audio_format: str | None) -> dict:
    """返回 {peaks, duration, buckets}；计算失败抛 ApiError。"""
    if not audio_path.is_file():
        raise ApiError("ARTIFACT_NO_AUDIO", "音频文件不存在", 404)
    fmt = (audio_format or audio_path.suffix.lstrip(".") or "").lower()
    try:
        if fmt == "wav":
            with wave.open(str(audio_path), "rb") as reader:
                channels = reader.getnchannels()
                width = reader.getsampwidth()
                rate = reader.getframerate()
                frames = reader.getnframes()
                duration = frames / rate if rate else 0.0
                samples = reader.readframes(frames)
            if width != 2:
                # 非 16bit WAV：经 ffmpeg 归一处理
                return _peaks_via_ffmpeg(audio_path)
            peaks, _ = _peaks_from_samples(samples, channels, width)
        else:
            result = _peaks_via_ffmpeg(audio_path)
            return result
    except wave.Error as exc:
        raise ApiError("PEAKS_DECODE_ERROR", f"音频解码失败: {exc}", 500) from exc
    return {"peaks": peaks, "duration": duration, "buckets": len(peaks)}


def _peaks_via_ffmpeg(audio_path: Path) -> dict:
    import subprocess

    binary = find_ffmpeg()
    if binary is None:
        raise ApiError(
            "MIX_FFMPEG_MISSING", "ffmpeg 不可用，无法计算波形（MP3 需要 ffmpeg）", 503
        )
    # 16bit 单声道 8kHz PCM 足够波形可视化
    cmd = [
        binary,
        "-i",
        str(audio_path),
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        "-",
    ]
    try:
        completed = subprocess.run(cmd, capture_output=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ApiError("PEAKS_DECODE_ERROR", f"音频解码失败: {exc}", 500) from exc
    if completed.returncode != 0:
        raise ApiError("PEAKS_DECODE_ERROR", "音频解码失败", 500)
    samples = completed.stdout
    total = len(samples) // 2
    duration = total / 8000
    buckets = min(MAX_BUCKETS, total) if total else 0
    frames_per_bucket = total / buckets if buckets else 0
    peaks: list[float] = []
    for bucket in range(buckets):
        start = int(bucket * frames_per_bucket)
        end = int((bucket + 1) * frames_per_bucket)
        chunk = samples[start * 2 : end * 2]
        count = len(chunk) // 2
        values = struct.unpack(f"<{count}h", chunk[: count * 2]) if count else ()
        peak = max((abs(v) for v in values), default=0)
        peaks.append(min(1.0, peak / 32768.0))
    return {"peaks": peaks, "duration": duration, "buckets": len(peaks)}


def load_or_compute_peaks(audio_path: Path, peaks_cache: Path, audio_format: str | None) -> dict:
    """缓存优先（与产物同生命周期）；缓存不存在则计算并落盘（原子写）。"""
    if peaks_cache.is_file():
        try:
            return json.loads(peaks_cache.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass  # 缓存损坏则重算
    result = compute_peaks(audio_path, audio_format)
    peaks_cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = peaks_cache.with_suffix(".json.part")
    tmp.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    tmp.replace(peaks_cache)
    return result
