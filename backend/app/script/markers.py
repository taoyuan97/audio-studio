"""标记解析器（唯一事实源）：text → {segments[], est_duration}。

- 结构见 data-model.md 5.1；前端只渲染 segments，不重复实现解析。
- 标记规范：`[停顿 Ns]` / `[情绪:x]` / `[语速:x]` / `[吸气]` / `[呼气]`。
- `[吸气]` → pause 4s、`[呼气]` → pause 5s（决策 E4）。
- 情绪/语速为"状态标记"：出现后对后续 speech 持续生效，直至再次出现。
- 非法标记（无法识别的 `[…]`）容错：从 segments 中剔除，不中断解析。
- est_duration = Σ(音节数 × 每音节基准时长 ÷ 语速系数) + Σ停顿秒数。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# 每音节基准时长（秒）：与原型 AudioEngine 常数一致（SYL_BASE 0.26 + SYL_GAP 0.07）
SYLLABLE_SECONDS = 0.33
# 语速档 → 系数（慢速读得更久）
SPEED_FACTORS = {"慢速": 0.72, "正常": 1.0, "快速": 1.28}
# 呼吸标记折算（E4）
BREATH_SECONDS = {"吸气": 4.0, "呼气": 5.0}

_MARKER_RE = re.compile(r"\[([^\]]*)\]")
_PAUSE_RE = re.compile(r"^停顿\s*(\d+(?:\.\d+)?)\s*s$", re.IGNORECASE)
_EMOTION_RE = re.compile(r"^情绪[:：]\s*(.+)$")
_SPEED_RE = re.compile(r"^语速[:：]\s*(.+)$")

# 非法标记剔除后 speech 文本里不应残留的空白
_STRIP_RE = re.compile(r"[ \t]+")


@dataclass
class ParsedScript:
    segments: list[dict[str, Any]]
    est_duration: float

    def as_content(self) -> dict[str, Any]:
        """按 data-model.md 5.1 的 content_json 结构输出。"""
        return {"segments": self.segments, "est_duration": round(self.est_duration, 1)}

    @property
    def speech_seconds(self) -> float:
        return sum(_segment_seconds(seg) for seg in self.segments)


def _speed_factor(speed: str | None) -> float:
    return SPEED_FACTORS.get(speed or "", 1.0)


def _segment_seconds(segment: dict[str, Any]) -> float:
    if segment["kind"] == "pause":
        return float(segment["seconds"])
    syllables = _count_syllables(segment["text"])
    return syllables * SYLLABLE_SECONDS / _speed_factor(segment.get("speed"))


def _count_syllables(text: str) -> int:
    """中文按字计；拉丁字母/数字连续串按词计（与原型 countSyllables 一致）。"""
    cjk = len(re.findall(r"[\u4e00-\u9fff]", text))
    latin = len(re.findall(r"[A-Za-z]+", text))
    digits = len(re.findall(r"[0-9]+", text))
    return cjk + latin + digits


def parse_script(text: str) -> ParsedScript:
    """解析带标记脚本文本（容忍非法标记与空文本）。"""
    segments: list[dict[str, Any]] = []
    emotion: str | None = None
    speed: str | None = None
    cursor = 0

    def push_speech(chunk: str) -> None:
        cleaned = _STRIP_RE.sub(" ", chunk).strip()
        if cleaned:
            segments.append(
                {"kind": "speech", "text": cleaned, "emotion": emotion, "speed": speed}
            )

    for match in _MARKER_RE.finditer(text):
        push_speech(text[cursor : match.start()])
        tag = match.group(1).strip()
        cursor = match.end()

        pause = _PAUSE_RE.match(tag)
        if pause:
            seconds = float(pause.group(1))
            if seconds > 0:
                segments.append({"kind": "pause", "seconds": seconds})
            continue
        if tag in BREATH_SECONDS:
            segments.append({"kind": "pause", "seconds": BREATH_SECONDS[tag]})
            continue
        emotion_match = _EMOTION_RE.match(tag)
        if emotion_match:
            emotion = emotion_match.group(1).strip() or None
            continue
        speed_match = _SPEED_RE.match(tag)
        if speed_match:
            value = speed_match.group(1).strip()
            # 语速值非法时容错：不更新状态
            if value in SPEED_FACTORS:
                speed = value
            continue
        # 无法识别的标记：剔除（容错），不影响后续解析

    push_speech(text[cursor:])

    est_duration = sum(_segment_seconds(seg) for seg in segments)
    return ParsedScript(segments=segments, est_duration=est_duration)
