"""BGM 探测、循环/截断、淡入淡出、48kHz 导出与原子落盘。"""

from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..ffmpeg import FFmpegError, find_ffprobe, run_ffmpeg


class MusicProcessingError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AudioInfo:
    duration_seconds: float
    sample_rate: int
    channels: int


def probe_audio(path: Path, ffmpeg_path: str = "") -> AudioInfo:
    if not path.is_file() or path.stat().st_size <= 0:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "音乐文件不存在或为空")
    binary = find_ffprobe(ffmpeg_path)
    if binary is None:
        raise MusicProcessingError("MUSIC_FFMPEG_MISSING", "ffprobe 不可用，请安装或配置 FFmpeg")
    try:
        result = subprocess.run(
            [binary, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "音频探测失败") from exc
    if result.returncode != 0:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "音乐文件损坏或无法读取")
    try:
        payload = json.loads(result.stdout)
        stream = payload["streams"][0]
        info = AudioInfo(float(payload["format"]["duration"]), int(stream["sample_rate"]), int(stream["channels"]))
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "文件不包含有效音频流") from exc
    if info.duration_seconds <= 0 or info.sample_rate <= 0 or info.channels <= 0:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "音频参数无效")
    return info


def _fade_lengths(target_seconds: float) -> tuple[float, float]:
    return min(3.0, target_seconds / 3), min(8.0, target_seconds / 3)


def _run(ffmpeg_path: str, args: list[str]) -> None:
    try:
        run_ffmpeg(ffmpeg_path, args, timeout=300)
    except FFmpegError as exc:
        code = "MUSIC_FFMPEG_MISSING" if "不可用" in str(exc) else "MUSIC_PROCESSING_ERROR"
        raise MusicProcessingError(code, f"音乐后处理失败：{exc}") from None


def _create_loop_unit(source: Path, loop_path: Path, info: AudioInfo, ffmpeg_path: str) -> None:
    crossfade = min(4.0, info.duration_seconds / 3)
    period = info.duration_seconds - crossfade
    if crossfade <= 0.01 or period <= crossfade:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "源音乐过短，无法安全循环")
    graph = (
        "[0:a]asplit=3[headsrc][tailsrc][middlesrc];"
        f"[headsrc]atrim=0:{crossfade:.6f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={crossfade:.6f}[head];"
        f"[tailsrc]atrim={period:.6f}:{info.duration_seconds:.6f},asetpts=PTS-STARTPTS,afade=t=out:st=0:d={crossfade:.6f}[tail];"
        "[tail][head]amix=inputs=2:duration=longest:normalize=0[seam];"
        f"[middlesrc]atrim={crossfade:.6f}:{period:.6f},asetpts=PTS-STARTPTS[middle];"
        "[seam][middle]concat=n=2:v=0:a=1[loop]"
    )
    _run(ffmpeg_path, ["-y", "-v", "error", "-i", str(source), "-filter_complex", graph, "-map", "[loop]", "-c:a", "pcm_s16le", "-f", "wav", str(loop_path)])


def process_music(source: Path, final: Path, target_seconds: int, output_format: str, ffmpeg_path: str = "") -> tuple[AudioInfo, AudioInfo]:
    if not 60 <= target_seconds <= 600 or output_format not in {"mp3", "wav"}:
        raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "音乐后处理参数无效")
    source_info = probe_audio(source, ffmpeg_path)
    part = final.with_suffix(final.suffix + ".part")
    loop_path = final.with_suffix(".loop.part.wav")
    final.parent.mkdir(parents=True, exist_ok=True)
    fade_in, fade_out = _fade_lengths(target_seconds)
    filters = (
        f"atrim=duration={target_seconds},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={fade_in:.6f},"
        f"afade=t=out:st={target_seconds - fade_out:.6f}:d={fade_out:.6f},aresample=48000"
    )
    try:
        if source_info.duration_seconds < target_seconds:
            _create_loop_unit(source, loop_path, source_info, ffmpeg_path)
            inputs = ["-stream_loop", "-1", "-i", str(loop_path)]
        else:
            inputs = ["-i", str(source)]
        codec = ["-c:a", "libmp3lame", "-b:a", "320k", "-f", "mp3"] if output_format == "mp3" else ["-c:a", "pcm_s16le", "-f", "wav"]
        _run(ffmpeg_path, ["-y", "-v", "error", *inputs, "-af", filters, "-t", str(target_seconds), "-ar", "48000", *codec, str(part)])
        final_info = probe_audio(part, ffmpeg_path)
        if abs(final_info.duration_seconds - target_seconds) > 1 or final_info.sample_rate != 48000:
            raise MusicProcessingError("MUSIC_PROCESSING_ERROR", "最终音乐时长或采样率校验失败")
        os.replace(part, final)
        return source_info, final_info
    finally:
        part.unlink(missing_ok=True)
        loop_path.unlink(missing_ok=True)
