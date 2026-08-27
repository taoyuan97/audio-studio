"""MiniMax Music 3.0 同步接口适配器。"""

from __future__ import annotations

import re
import time
from typing import Any

import httpx

from .provider import MusicGenerationRequest, MusicGenerationResult, MusicServiceError

MODEL = "music-3.0"
BASE_URL = "https://api.minimaxi.com/v1"
URL_TTL_MS = 24 * 60 * 60 * 1000
STRUCTURE_LABELS = {
    "intro": "以舒缓引子开始",
    "build_up": "中段逐渐增强",
    "drop": "安排一次明显但不过度突兀的能量释放",
    "outro": "结尾自然收束",
}


def build_prompt(request: MusicGenerationRequest) -> str:
    hints = "；".join(STRUCTURE_LABELS[item] for item in request.structure_hints)
    suffix = f"\n结构倾向：{hints}。" if hints else ""
    # MiniMax 对纯音乐 prompt 的总长度上限为 2000；保留结构提示时截断正文尾部。
    return f"{request.prompt[: max(1, 2000 - len(suffix))]}{suffix}"[:2000]


async def generate_music(
    api_key: str,
    request: MusicGenerationRequest,
    *,
    timeout: float = 600,
    transport: httpx.AsyncBaseTransport | None = None,
    base_url: str = BASE_URL,
) -> MusicGenerationResult:
    if not api_key.strip():
        raise MusicServiceError("MUSIC_AUTH_FAILED", "未配置 MiniMax API Key")
    prompt = request.prompt.strip()
    if not 1 <= len(prompt) <= 2000:
        raise MusicServiceError("MUSIC_REQUEST_INVALID", "音乐 Prompt 长度必须为 1～2000 个字符")

    payload = {
        "model": MODEL,
        "prompt": build_prompt(request),
        "stream": False,
        "output_format": "url",
        "audio_setting": {"sample_rate": 44100, "bitrate": 256000, "format": "mp3"},
        "aigc_watermark": False,
        "lyrics_optimizer": False,
        "is_instrumental": True,
    }
    try:
        async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/music_generation",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise MusicServiceError("MUSIC_TIMEOUT", "MiniMax 音乐生成请求超时") from exc
    except httpx.RequestError as exc:
        raise MusicServiceError("MUSIC_NETWORK_ERROR", "无法连接 MiniMax 音乐生成服务") from exc

    if response.status_code >= 400:
        raise _normalize_error(response)
    try:
        body = response.json()
        base_resp = body["base_resp"]
        if int(base_resp["status_code"]) != 0:
            raise _normalize_error(response)
        data = body["data"]
        status = str(data["status"]).lower()
        audio_url = str(data["audio"])
        request_id = str(body["trace_id"])
        extra = body.get("extra_info") or data.get("extra_info") or {}
        duration_ms = int(extra["music_duration"])
        sample_rate = _optional_int(extra.get("music_sample_rate"))
        channels = _optional_int(extra.get("music_channel"))
    except MusicServiceError:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise MusicServiceError("MUSIC_PROVIDER_ERROR", "MiniMax 返回结构异常") from exc

    if status not in {"2", "success", "succeeded", "completed", "complete"}:
        raise MusicServiceError("MUSIC_PROVIDER_ERROR", "MiniMax 音乐生成未完成")
    try:
        parsed_url = httpx.URL(audio_url)
    except httpx.InvalidURL as exc:
        raise MusicServiceError("MUSIC_PROVIDER_ERROR", "MiniMax 返回的音频地址无效") from exc
    if parsed_url.scheme != "https" or not parsed_url.host or not request_id or duration_ms <= 0:
        raise MusicServiceError("MUSIC_PROVIDER_ERROR", "MiniMax 返回内容不完整")
    return MusicGenerationResult(
        request_id=request_id,
        audio_url=audio_url,
        expires_at_ms=int(time.time() * 1000) + URL_TTL_MS,
        duration_seconds=duration_ms / 1000,
        sample_rate=sample_rate,
        channels=channels,
    )


def _optional_int(value: Any) -> int | None:
    return None if value in (None, "") else int(value)


def _normalize_error(response: httpx.Response) -> MusicServiceError:
    code = ""
    message = ""
    try:
        body = response.json()
        if isinstance(body, dict):
            base_resp = body.get("base_resp") or {}
            code = str(base_resp.get("status_code") or body.get("error_code") or "")
            message = str(base_resp.get("status_msg") or body.get("error_message") or "")
    except ValueError:
        pass
    fingerprint = f"{code} {message}".lower()
    status = response.status_code
    if code == "1004" or status == 401 or any(word in fingerprint for word in ("invalid api", "unauthorized")):
        return MusicServiceError("MUSIC_AUTH_FAILED", "MiniMax API Key 无效")
    if code == "1002" or status == 429:
        return MusicServiceError("MUSIC_RATE_LIMITED", "MiniMax 音乐生成服务限流")
    if code in {"1008", "2153"} or any(
        word in fingerprint
        for word in ("insufficient", "balance", "permission", "quota", "no longer available to new users")
    ):
        return MusicServiceError("MUSIC_ACCESS_DENIED", "MiniMax 模型权限、余额或额度不足")
    if code in {"1026", "1027"} or any(word in fingerprint for word in ("audit", "sensitive", "content")):
        return MusicServiceError("MUSIC_CONTENT_REJECTED", "音乐 Prompt 未通过内容审核")
    if code == "1001":
        return MusicServiceError("MUSIC_TIMEOUT", "MiniMax 音乐生成请求超时")
    if code == "2013":
        return MusicServiceError("MUSIC_REQUEST_INVALID", "MiniMax 音乐生成请求参数错误")
    if status >= 500 or (status == 200 and code and code != "0"):
        return MusicServiceError("MUSIC_PROVIDER_ERROR", "MiniMax 音乐生成服务暂时不可用")
    detail = _safe_detail(code, message)
    return MusicServiceError(
        "MUSIC_PROVIDER_ERROR",
        f"MiniMax 拒绝了音乐生成请求{f'（{detail}）' if detail else ''}",
    )


def _safe_detail(code: str, message: str) -> str:
    raw = ": ".join(part for part in (code.strip(), message.strip()) if part)
    raw = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", raw)
    raw = re.sub(r"(?i)(?:sk-|eyj)[a-z0-9._-]+", "[key redacted]", raw)
    raw = re.sub(r"https?://\S+", "[url redacted]", raw)
    return raw[:300]
