"""TTS 能力声明；提交校验与合成计划共用。"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class TTSCapabilities:
    supports_ssml: bool
    supports_instruction: bool
    supports_pitch: bool
    max_ssml_pause_ms: int = 0

    def as_dict(self) -> dict:
        return asdict(self)


# 2026-08-26 真实 qwen-audio-3.0-tts-plus 验证：instruction 可用；
# enable_ssml + <break> 会由服务端返回 ret=416，pitch 亦不在该模型已验证能力内。
ALIYUN_QWEN = TTSCapabilities(False, True, False, 0)
VOLCANO = TTSCapabilities(False, False, False, 0)


def get_capabilities(engine: str, model: str, voice_id: str = "") -> TTSCapabilities:
    del model, voice_id
    if engine == "aliyun":
        return ALIYUN_QWEN
    if engine == "volc":
        return VOLCANO
    raise ValueError(f"未知 TTS 引擎: {engine}")
