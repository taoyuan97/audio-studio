"""WAV 生成、校验、顺序拼接与 MP3 编码。"""

from __future__ import annotations

import io
import math
import os
import re
import shutil
import struct
import wave
from pathlib import Path

from ..ffmpeg import FFmpegError, run_ffmpeg
from .providers import SynthesisResult

SAMPLE_RATE = 48_000
CHANNELS = 1
SAMPLE_WIDTH = 2


def fake_speech(text: str, speed: float, *, frequency: int = 220) -> SynthesisResult:
    break_re = re.compile(r'<break\s+time="(\d+)ms"\s*/>')
    stream = io.BytesIO()
    with wave.open(stream, "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(SAMPLE_WIDTH)
        writer.setframerate(SAMPLE_RATE)
        cursor = 0
        for match in break_re.finditer(text):
            _write_fake_tone(writer, re.sub(r"<[^>]+>", "", text[cursor:match.start()]), speed, frequency)
            writer.writeframes(b"\x00\x00" * int(int(match.group(1)) / 1000 * SAMPLE_RATE))
            cursor = match.end()
        _write_fake_tone(writer, re.sub(r"<[^>]+>", "", text[cursor:]), speed, frequency)
    return SynthesisResult(stream.getvalue())


def _write_fake_tone(writer: wave.Wave_write, text: str, speed: float, frequency: int) -> None:
    if not text:
        return
    seconds = max(0.25, min(30.0, len(text) * 0.075 / max(speed, 0.5)))
    frames = int(seconds * SAMPLE_RATE)
    block = bytearray()
    for index in range(frames):
        envelope = min(1.0, index / 800, (frames - index) / 800)
        value = int(6500 * max(0.0, envelope) * math.sin(2 * math.pi * frequency * index / SAMPLE_RATE))
        block.extend(struct.pack("<h", value))
    writer.writeframes(block)


def silence_wav(seconds: float) -> bytes:
    stream = io.BytesIO()
    with wave.open(stream, "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(SAMPLE_WIDTH)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(b"\x00\x00" * int(max(0.0, seconds) * SAMPLE_RATE))
    return stream.getvalue()


def validate_wav(data: bytes) -> tuple[int, int, int, bytes]:
    try:
        with wave.open(io.BytesIO(data), "rb") as reader:
            rate = reader.getframerate()
            channels = reader.getnchannels()
            width = reader.getsampwidth()
            frames = reader.readframes(reader.getnframes())
    except (wave.Error, EOFError) as exc:
        raise ValueError("Provider 返回的不是有效 WAV") from exc
    if (rate, channels, width) != (SAMPLE_RATE, CHANNELS, SAMPLE_WIDTH):
        raise ValueError(
            f"WAV 格式不一致：{rate}Hz/{channels}ch/{width * 8}bit，要求 48000Hz/1ch/16bit"
        )
    return rate, channels, width, frames


def assemble_wav(parts: list[bytes], destination: Path) -> float:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total_frames = 0
    with wave.open(str(destination), "wb") as writer:
        writer.setnchannels(CHANNELS)
        writer.setsampwidth(SAMPLE_WIDTH)
        writer.setframerate(SAMPLE_RATE)
        for part in parts:
            _, _, _, frames = validate_wav(part)
            writer.writeframes(frames)
            total_frames += len(frames) // (CHANNELS * SAMPLE_WIDTH)
    return total_frames / SAMPLE_RATE


def finalize_audio(
    parts: list[bytes],
    *,
    artifact_id: str,
    output_format: str,
    audio_dir: Path,
    ffmpeg_path: str,
) -> tuple[Path, float]:
    work_dir = audio_dir / "tmp" / artifact_id
    work_dir.mkdir(parents=True, exist_ok=True)
    master = work_dir / "master.wav"
    final = audio_dir / "artifacts" / f"{artifact_id}.{output_format}"
    final.parent.mkdir(parents=True, exist_ok=True)
    part = final.with_name(final.name + ".part")
    try:
        duration = assemble_wav(parts, master)
        if output_format == "wav":
            shutil.copyfile(master, part)
        else:
            run_ffmpeg(
                ffmpeg_path,
                [
                    "-y",
                    "-i",
                    str(master),
                    "-ar",
                    str(SAMPLE_RATE),
                    "-ac",
                    "1",
                    "-codec:a",
                    "libmp3lame",
                    "-b:a",
                    "320k",
                    "-f",
                    "mp3",
                    str(part),
                ],
            )
        if not part.is_file() or part.stat().st_size == 0:
            raise ValueError("音频编码结果为空")
        os.replace(part, final)
        return final, duration
    except FFmpegError:
        part.unlink(missing_ok=True)
        raise
    except Exception:
        part.unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
