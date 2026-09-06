"""TTS 能力声明；提交校验与合成计划共用。"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TTSCapabilities:
    supports_ssml: bool
    supports_instruction: bool
    supports_pitch: bool
    max_ssml_pause_ms: int = 0
    supports_inline_tags: bool = False

    def as_dict(self) -> dict:
        return asdict(self)


# 2026-08-26 真实 qwen-audio-3.0-tts-plus 验证：instruction 可用；
# enable_ssml + <break> 会由服务端返回 ret=416，pitch 亦不在该模型已验证能力内。
ALIYUN_QWEN = TTSCapabilities(False, True, False, 0, True)
ALIYUN_OTHER = TTSCapabilities(False, True, False, 0, False)
VOLCANO = TTSCapabilities(False, False, False, 0, False)


def get_capabilities(engine: str, model: str, voice_id: str = "") -> TTSCapabilities:
    del voice_id
    if engine == "aliyun":
        if model in {"qwen-audio-3.0-tts-plus", "qwen-audio-3.0-tts-flash"}:
            return ALIYUN_QWEN
        return ALIYUN_OTHER
    if engine == "volc":
        return VOLCANO
    raise ValueError(f"未知 TTS 引擎: {engine}")
