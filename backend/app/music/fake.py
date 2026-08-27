"""FAKE_MODE 本地和弦源音频。"""

from __future__ import annotations

import hashlib
import math
import struct
import wave
from pathlib import Path


def generate_fake_music(path: Path, prompt: str, structure_hints: list[str]) -> float:
    sample_rate = 8000
    duration = 12.0
    seed = int.from_bytes(hashlib.sha256(prompt.encode("utf-8")).digest()[:2], "big")
    root = 174.61 * (2 ** ((seed % 12) / 12))
    chord = (root, root * 1.25, root * 1.5)
    sections = max(1, len(structure_hints))
    amplitudes = [0.18, 0.28, 0.42, 0.16]
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        for frame in range(int(duration * sample_rate)):
            position = frame / (duration * sample_rate)
            section = min(sections - 1, int(position * sections))
            amplitude = amplitudes[section % len(amplitudes)] if structure_hints else 0.22
            value = sum(math.sin(2 * math.pi * frequency * frame / sample_rate) for frequency in chord) / 3
            writer.writeframesraw(struct.pack("<h", int(32767 * amplitude * value)))
    return duration
