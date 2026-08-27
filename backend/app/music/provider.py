"""音乐 Provider 中立边界。供应商专有字段不得泄漏到通用请求。"""

from __future__ import annotations

from dataclasses import dataclass


class MusicServiceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class MusicGenerationRequest:
    prompt: str
    target_duration: int
    structure_hints: tuple[str, ...] = ()
    output_format: str = "mp3"


@dataclass(frozen=True)
class MusicGenerationResult:
    request_id: str
    audio_url: str
    expires_at_ms: int
    duration_seconds: float
    sample_rate: int | None = None
    channels: int | None = None
    source_format: str = "mp3"
