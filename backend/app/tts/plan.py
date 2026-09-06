"""脚本 segments → Provider speech / 本地 silence 合成计划。"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .capabilities import TTSCapabilities

MAX_SPEECH_CHARS = 500
_SENTENCE_RE = re.compile(r"(?<=[。！？!?；;])")
_MARKER_RE = re.compile(r"\[([^\]]*)\]")
_PAUSE_RE = re.compile(r"^停顿\s*(\d+(?:\.\d+)?)\s*s$", re.I)
_EMOTION_RE = re.compile(r"^情绪[:：]\s*(.+)$")
_NATIVE_EMOTION_RE = re.compile(r"^emotion:\s*([A-Za-z][A-Za-z0-9 -]*)$", re.I)
_VOCAL_RE = re.compile(r"^vocal:\s*([A-Za-z][A-Za-z0-9 -]*)$", re.I)
_SPEED_RE = re.compile(r"^语速[:：]\s*(.+)$")


@dataclass(frozen=True)
class PlanSegment:
    kind: str
    text: str = ""
    seconds: float = 0.0
    speed: float = 1.0
    emotion: str | None = None
    enable_ssml: bool = False


def _speed_value(marker: str | None, base: float) -> float:
    return max(0.5, min(1.5, base * {"慢速": 0.8, "正常": 1.0, "快速": 1.2}.get(marker or "", 1.0)))


def _split_long(text: str) -> list[str]:
    sentences = [item.strip() for item in _SENTENCE_RE.split(text) if item.strip()]
    result: list[str] = []
    for sentence in sentences or [text]:
        while len(sentence) > MAX_SPEECH_CHARS:
            result.append(sentence[:MAX_SPEECH_CHARS])
            sentence = sentence[MAX_SPEECH_CHARS:]
        if sentence:
            result.append(sentence)
    return result


def _clean_speech_text(text: str) -> str:
    visible = "".join(
        " " if unicodedata.category(character) in ("Cc", "Cf") else character
        for character in text
    )
    return re.sub(r"\s+", " ", visible).strip()


def _has_speakable_text(text: str) -> bool:
    return any(unicodedata.category(character)[0] in ("L", "N") for character in text)


def validate_plan(plan: list[PlanSegment]) -> None:
    """Provider 调用前验证计划，错误中不暴露脚本原文。"""
    for index, segment in enumerate(plan, start=1):
        if segment.kind == "speech" and not _has_speakable_text(segment.text):
            raise ValueError(f"合成计划第 {index} 段不包含可合成文字")


def build_plan(text: str, capabilities: TTSCapabilities, base_speed: float) -> list[PlanSegment]:
    plan: list[PlanSegment] = []
    emotion: str | None = None
    inline_emotion: str | None = None
    pending_vocals: list[str] = []
    speed_marker: str | None = None

    def push_speech(value: str) -> None:
        nonlocal pending_vocals
        cleaned = _clean_speech_text(value)
        if not _has_speakable_text(cleaned):
            return
        speed = _speed_value(speed_marker, base_speed)
        resolved_emotion = emotion if capabilities.supports_instruction else None
        chunks = _split_long(cleaned)
        for chunk_index, chunk in enumerate(chunks):
            if not _has_speakable_text(chunk):
                continue
            inline_prefix = ""
            if capabilities.supports_inline_tags:
                if inline_emotion:
                    inline_prefix += f"[{inline_emotion}]"
                if chunk_index == 0 and pending_vocals:
                    inline_prefix += "".join(f"[{tag}]" for tag in pending_vocals)
            plan.append(
                PlanSegment(kind="speech", text=f"{inline_prefix}{chunk}", speed=speed, emotion=resolved_emotion)
            )
        pending_vocals = []

    def flush_vocals_to_previous() -> None:
        nonlocal pending_vocals
        if not capabilities.supports_inline_tags or not pending_vocals:
            pending_vocals = []
            return
        if plan and plan[-1].kind == "speech":
            previous = plan[-1]
            suffix = "".join(f"[{tag}]" for tag in pending_vocals)
            plan[-1] = PlanSegment(
                kind=previous.kind,
                text=f"{previous.text}{suffix}",
                seconds=previous.seconds,
                speed=previous.speed,
                emotion=previous.emotion,
                enable_ssml=previous.enable_ssml,
            )
            pending_vocals = []

    def push_pause(seconds: float, *, force_silence: bool = False) -> None:
        if seconds <= 0:
            return
        flush_vocals_to_previous()
        can_embed = (
            not force_silence
            and capabilities.supports_ssml
            and seconds * 1000 <= capabilities.max_ssml_pause_ms
            and bool(plan)
            and plan[-1].kind == "speech"
        )
        if can_embed:
            previous = plan[-1]
            plan[-1] = PlanSegment(
                kind="speech",
                text=f'{previous.text}<break time="{int(seconds * 1000)}ms"/>',
                speed=previous.speed,
                emotion=previous.emotion,
                enable_ssml=True,
            )
        else:
            plan.append(PlanSegment(kind="silence", seconds=seconds))

    cursor = 0
    for match in _MARKER_RE.finditer(text):
        push_speech(text[cursor : match.start()])
        cursor = match.end()
        marker = match.group(1).strip()
        pause = _PAUSE_RE.match(marker)
        if pause:
            push_pause(float(pause.group(1)))
            continue
        if marker == "吸气":
            push_pause(4.0, force_silence=True)
            continue
        if marker == "呼气":
            push_pause(5.0, force_silence=True)
            continue
        native_emotion_match = _NATIVE_EMOTION_RE.match(marker)
        if native_emotion_match:
            flush_vocals_to_previous()
            inline_emotion = " ".join(native_emotion_match.group(1).lower().split())
            emotion = None
            continue
        vocal_match = _VOCAL_RE.match(marker)
        if vocal_match:
            if capabilities.supports_inline_tags:
                pending_vocals.append(" ".join(vocal_match.group(1).lower().split()))
            continue
        emotion_match = _EMOTION_RE.match(marker)
        if emotion_match:
            flush_vocals_to_previous()
            emotion = emotion_match.group(1).strip() or None
            inline_emotion = None
            continue
        speed_match = _SPEED_RE.match(marker)
        if speed_match and speed_match.group(1).strip() in ("慢速", "正常", "快速"):
            speed_marker = speed_match.group(1).strip()

    push_speech(text[cursor:])
    flush_vocals_to_previous()
    return plan
