"""阿里云 Qwen-TTS 与火山 TTS Provider 适配。"""

from __future__ import annotations

import base64
import json
import logging
import re
import unicodedata
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


class TTSProviderError(RuntimeError):
    """已脱敏的 Provider 失败。"""


@dataclass(frozen=True)
class SynthesisResult:
    audio: bytes
    sample_rate: int = 48_000
    channels: int = 1


def _safe_message(value: object) -> str:
    message = str(value or "provider error")[:200]
    message = re.sub(
        r"(?i)(authorization|api[_-]?key|secret|token)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        message,
    )
    return message.replace("\r", " ").replace("\n", " ")


class AliyunTTSProvider:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str = "https://dashscope.aliyuncs.com/api/v1",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.transport = transport

    async def synthesize(
        self,
        text: str,
        *,
        voice: str,
        speed: float,
        pitch: float | None,
        emotion: str | None,
        enable_ssml: bool = False,
    ) -> SynthesisResult:
        if not self.api_key:
            raise TTSProviderError("阿里云 TTS 未配置")
        input_payload: dict = {
            "text": text,
            "voice": voice,
            "format": "wav",
            "sample_rate": 48_000,
            "volume": 50,
            "rate": speed,
        }
        if emotion:
            input_payload["instruction"] = _truncate_instruction(emotion)
        if pitch is not None:
            input_payload["pitch"] = pitch
        if enable_ssml:
            if not text.lstrip().startswith("<speak"):
                input_payload["text"] = f"<speak>{text}</speak>"
            input_payload["enable_ssml"] = True
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-SSE": "enable",
        }
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=60.0) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/services/audio/tts/SpeechSynthesizer",
                    headers=headers,
                    json={"model": self.model, "input": input_payload},
                ) as response:
                    response.raise_for_status()
                    audio = await self._parse_sse(
                        response, model=self.model, voice=voice
                    )
        except TTSProviderError:
            raise
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("阿里云 TTS 请求失败: %s", exc.__class__.__name__)
            raise TTSProviderError("阿里云 TTS 合成失败") from exc
        if not audio:
            raise TTSProviderError("阿里云 TTS 返回空音频")
        return SynthesisResult(audio)

    @staticmethod
    async def _parse_sse(
        response: httpx.Response,
        *,
        model: str | None = None,
        voice: str | None = None,
    ) -> bytes:
        chunks: list[bytes] = []
        async for raw_line in response.aiter_lines():
            if not raw_line.startswith("data:"):
                continue
            value = raw_line[5:].strip()
            if not value or value == "[DONE]":
                continue
            try:
                event = json.loads(value)
            except json.JSONDecodeError as exc:
                raise TTSProviderError("阿里云 TTS 响应解析失败") from exc
            if event.get("code"):
                safe_message = _safe_message(event.get("message"))
                if "engine error [411]" in safe_message.lower():
                    identity = (
                        f"（model={model}，voice={voice}）" if model and voice else ""
                    )
                    example = (
                        f"，基础音色请填写完整 voice 参数，例如 {model}-音色后缀"
                        if model
                        else "，基础音色请填写包含模型前缀的完整 voice 参数"
                    )
                    raise TTSProviderError(
                        f"阿里云 TTS 合成失败：当前模型不支持该音色{identity}{example}"
                    )
                raise TTSProviderError(
                    f"阿里云 TTS 合成失败：{safe_message}"
                )
            audio = (event.get("output") or {}).get("audio") or {}
            if audio.get("data"):
                try:
                    chunks.append(base64.b64decode(audio["data"], validate=True))
                except (ValueError, TypeError) as exc:
                    raise TTSProviderError("阿里云 TTS 音频解码失败") from exc
        return b"".join(chunks)


class VolcTTSProvider:
    """火山现有 access token 直连适配；401 时允许一次原 token 重试。"""

    endpoint = "https://openspeech.bytedance.com/api/v1/tts"

    def __init__(
        self,
        app_id: str,
        access_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.app_id = app_id
        self.access_token = access_token
        self.transport = transport

    async def synthesize(
        self,
        text: str,
        *,
        voice: str,
        speed: float,
        pitch: float | None,
        emotion: str | None,
        enable_ssml: bool = False,
    ) -> SynthesisResult:
        del pitch, emotion, enable_ssml
        if not self.app_id or not self.access_token:
            raise TTSProviderError("火山 TTS 未配置")
        import uuid

        payload = {
            "app": {"appid": self.app_id, "token": self.access_token, "cluster": "volcano_tts"},
            "user": {"uid": "audio-studio"},
            "audio": {"voice_type": voice, "encoding": "wav", "speed_ratio": speed, "volume_ratio": 1.0},
            "request": {"reqid": uuid.uuid4().hex, "text": text, "text_type": "plain", "operation": "query"},
        }
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=60.0) as client:
                response = await client.post(
                    self.endpoint,
                    headers={"Authorization": f"Bearer; {self.access_token}"},
                    json=payload,
                )
            response.raise_for_status()
            data = response.json()
            if data.get("code") != 3000:
                raise TTSProviderError(
                    f"火山 TTS 合成失败：{_safe_message(data.get('message'))}"
                )
            frames = data.get("data") or []
            audio = b"".join(
                base64.b64decode(frame["data"])
                for frame in frames
                if isinstance(frame, dict) and frame.get("type") == "binary" and frame.get("data")
            )
        except TTSProviderError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("火山 TTS 请求失败: %s", exc.__class__.__name__)
            raise TTSProviderError("火山 TTS 合成失败") from exc
        if not audio:
            raise TTSProviderError("火山 TTS 返回空音频")
        return SynthesisResult(audio)


def _truncate_instruction(text: str, max_units: int = 100) -> str:
    used = 0
    for index, char in enumerate(text):
        is_cjk = unicodedata.category(char).startswith("Lo") and (
            0x3400 <= ord(char) <= 0x9FFF or 0xF900 <= ord(char) <= 0xFAFF
        )
        used += 2 if is_cjk else 1
        if used > max_units:
            return text[:index]
    return text


def make_provider(settings, engine: str, *, model: str | None = None):
    if engine == "aliyun":
        return AliyunTTSProvider(
            settings.aliyun_tts_api_key,
            model or settings.aliyun_tts_model_id,
        )
    if engine == "volc":
        return VolcTTSProvider(settings.volc_tts_app_id, settings.volc_tts_access_token)
    raise ValueError(f"未知 TTS 引擎: {engine}")
