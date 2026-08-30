"""T007 设置状态、运行时编辑与真实连通探测。"""

from __future__ import annotations

import asyncio
import time
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .config import SettingsRevisionConflictError, SettingsStore
from .errors import ApiError, invalid
from .ffmpeg import ffmpeg_version, find_ffprobe
from .llm.registry import ModelRegistry
from .music.minimax import BASE_URL as MINIMAX_BASE_URL
from .tts.providers import TTSProviderError, make_provider
from .tts.voices import voices_for

router = APIRouter(prefix="/api/settings", tags=["settings"])

REVEAL_FIELDS: dict[str, dict[str, str]] = {
    "llm_deepseek": {"credential": "deepseek_api_key"},
    "llm_qwen": {"credential": "dashscope_api_key"},
    "llm_moonshot": {"credential": "moonshot_api_key"},
    "tts_aliyun": {"credential": "aliyun_tts_api_key"},
    "tts_volc": {
        "app_id": "volc_tts_app_id",
        "access_token": "volc_tts_access_token",
    },
    "minimax": {},
}


class ProviderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    credential: str | None = None
    model_id: str | None = None
    app_id: str | None = None
    access_token: str | None = None


class RevisionRequest(BaseModel):
    revision: int = Field(ge=0)


class CredentialRevealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    field: Literal["credential", "app_id", "access_token"]


class RuntimeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    llm_timeout_seconds: int | None = Field(default=None, ge=1, le=600)
    minimax_timeout_seconds: int | None = Field(default=None, ge=30, le=1200)


def _store(request: Request) -> SettingsStore:
    return request.app.state.settings_store


def _mask(value: str) -> str | None:
    if not value:
        return None
    if len(value) <= 4:
        return f"{value[:1]}***"
    return f"{value[:3]}***{value[-4:]}"


def _provider_status(store: SettingsStore, provider: str) -> dict:
    settings = store.current
    if provider == "llm_deepseek":
        credentials = [settings.deepseek_api_key]
        model_id = settings.deepseek_model_id
    elif provider == "llm_qwen":
        credentials = [settings.dashscope_api_key]
        model_id = settings.dashscope_model_id
    elif provider == "llm_moonshot":
        credentials = [settings.moonshot_api_key]
        model_id = settings.moonshot_model_id
    elif provider == "tts_aliyun":
        credentials = [settings.aliyun_tts_api_key]
        model_id = settings.aliyun_tts_model_id
    elif provider == "tts_volc":
        credentials = [settings.volc_tts_app_id, settings.volc_tts_access_token]
        model_id = None
    elif provider == "minimax":
        credentials = [settings.minimax_api_key]
        model_id = None
    else:
        raise ValueError(provider)
    configured = all(bool(value) for value in credentials)
    item = {
        "configured": configured,
        "credential_masked": " / ".join(filter(None, (_mask(value) for value in credentials))) or None,
        "credential_source": store.credential_source(provider),
        "editable": provider != "minimax",
        "runtime_credential_fields": _runtime_credential_fields(store, provider),
    }
    if model_id is not None:
        item["model_id"] = model_id
    return item


def _runtime_credential_fields(store: SettingsStore, provider: str) -> list[str]:
    field_map = REVEAL_FIELDS[provider]
    return [name for name, field in field_map.items() if store.has_override(field)]


def status_payload(store: SettingsStore) -> dict:
    settings = store.current
    version = ffmpeg_version(settings.ffmpeg_path)
    return {
        "revision": store.revision,
        "providers": {
            provider: _provider_status(store, provider)
            for provider in (
                "llm_deepseek",
                "llm_qwen",
                "llm_moonshot",
                "tts_aliyun",
                "tts_volc",
                "minimax",
            )
        },
        "runtime": {
            "llm_timeout_seconds": settings.llm_timeout_seconds,
            "minimax_timeout_seconds": settings.minimax_timeout_seconds,
        },
        "ffmpeg": {
            "available": version is not None,
            "version": version,
            "ffprobe_available": find_ffprobe(settings.ffmpeg_path) is not None,
        },
        "fake_mode": settings.fake_mode,
    }


def _require_local_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    host = (urlparse(origin).hostname or "").lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise ApiError("SETTINGS_ORIGIN_FORBIDDEN", "设置写入仅限本机页面", 403)


def _sync_runtime(request: Request) -> None:
    current = _store(request).current
    # 兼容既有只读引用；业务路由和 handler 均应优先读取 SettingsStore。
    request.app.state.settings = current
    request.app.state.llm_registry = ModelRegistry(current)


def _commit_error(exc: Exception) -> ApiError:
    if isinstance(exc, SettingsRevisionConflictError):
        return ApiError("SETTINGS_REVISION_CONFLICT", "配置已在其他页面更新，请刷新后重试", 409)
    if isinstance(exc, ValueError):
        return invalid("SETTINGS_PARAMS_INVALID", str(exc))
    if isinstance(exc, OSError):
        return ApiError("SETTINGS_PERSIST_FAILED", "配置保存失败，请检查数据目录权限", 500)
    raise exc


@router.get("/status")
def get_status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return status_payload(_store(request))


@router.post("/providers/{provider}/credentials/reveal")
def reveal_credential(
    provider: str,
    payload: CredentialRevealRequest,
    request: Request,
    response: Response,
):
    _require_local_origin(request)
    mapping = REVEAL_FIELDS.get(provider)
    if mapping is None or payload.field not in mapping:
        raise invalid("SETTINGS_PARAMS_INVALID", "该服务或凭据字段不支持浏览器查看")
    try:
        value = _store(request).reveal_override(
            mapping[payload.field], expected_revision=payload.revision
        )
    except Exception as exc:
        raise _commit_error(exc) from None
    response.headers["Cache-Control"] = "no-store"
    return {"revision": _store(request).revision, "field": payload.field, "value": value}


@router.patch("/providers/{provider}")
def update_provider(provider: str, payload: ProviderUpdate, request: Request):
    _require_local_origin(request)
    raw = payload.model_dump(exclude_none=True, exclude={"revision"})
    if any(isinstance(value, str) and not value.strip() for value in raw.values()):
        raise invalid("SETTINGS_PARAMS_INVALID", "配置值不能为空；清除凭据请使用清除操作")
    field_map = {
        "llm_deepseek": {"credential": "deepseek_api_key", "model_id": "deepseek_model_id"},
        "llm_qwen": {"credential": "dashscope_api_key", "model_id": "dashscope_model_id"},
        "llm_moonshot": {"credential": "moonshot_api_key", "model_id": "moonshot_model_id"},
        "tts_aliyun": {"credential": "aliyun_tts_api_key", "model_id": "aliyun_tts_model_id"},
        "tts_volc": {"app_id": "volc_tts_app_id", "access_token": "volc_tts_access_token"},
    }
    mapping = field_map.get(provider)
    if mapping is None:
        raise invalid("SETTINGS_PARAMS_INVALID", "该服务不支持浏览器编辑")
    if unknown := set(raw) - set(mapping):
        raise invalid("SETTINGS_PARAMS_INVALID", f"该服务不支持字段: {', '.join(sorted(unknown))}")
    values = {mapping[key]: value.strip() if isinstance(value, str) else value for key, value in raw.items()}
    try:
        _store(request).update_provider(provider, values, expected_revision=payload.revision)
    except Exception as exc:
        raise _commit_error(exc) from None
    _sync_runtime(request)
    return {"revision": _store(request).revision, "provider": _provider_status(_store(request), provider)}


@router.delete("/providers/{provider}/credentials")
def clear_credentials(provider: str, payload: RevisionRequest, request: Request):
    _require_local_origin(request)
    try:
        _store(request).clear_credentials(provider, expected_revision=payload.revision)
    except Exception as exc:
        raise _commit_error(exc) from None
    _sync_runtime(request)
    return {"revision": _store(request).revision, "provider": _provider_status(_store(request), provider)}


@router.patch("/runtime")
def update_runtime(payload: RuntimeUpdate, request: Request):
    _require_local_origin(request)
    values = payload.model_dump(exclude_none=True, exclude={"revision"})
    try:
        _store(request).update_runtime(values, expected_revision=payload.revision)
    except Exception as exc:
        raise _commit_error(exc) from None
    _sync_runtime(request)
    settings = _store(request).current
    return {
        "revision": _store(request).revision,
        "runtime": {
            "llm_timeout_seconds": settings.llm_timeout_seconds,
            "minimax_timeout_seconds": settings.minimax_timeout_seconds,
        },
    }


async def _probe_llm(provider: str, request: Request) -> str:
    settings = _store(request).current
    registry = ModelRegistry(settings)
    model = {
        "llm_deepseek": settings.deepseek_model_id,
        "llm_qwen": settings.dashscope_model_id,
        "llm_moonshot": settings.moonshot_model_id,
    }[provider]
    chunks = []
    async for chunk in registry.stream_chat(
        model,
        [{"role": "user", "content": "请只回复：连接成功"}],
        timeout_seconds=min(settings.llm_timeout_seconds, 30),
    ):
        chunks.append(chunk)
    if not chunks:
        raise RuntimeError("模型返回空内容")
    return "模型响应成功"


async def _probe_tts(provider: str, request: Request) -> str:
    settings = _store(request).current
    engine = "aliyun" if provider == "tts_aliyun" else "volc"
    voice = voices_for(engine)[0]["id"]
    result = await make_provider(settings, engine).synthesize(
        "连接测试",
        voice=voice,
        speed=1.0,
        pitch=None,
        emotion=None,
        enable_ssml=False,
    )
    return f"合成成功（{len(result.audio)} bytes）"


async def _probe_minimax(request: Request) -> str:
    key = _store(request).current.minimax_api_key
    if not key:
        raise ValueError("未配置 API Key")
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{MINIMAX_BASE_URL}/models",
            headers={"Authorization": f"Bearer {key}"},
        )
    if response.status_code in (401, 403):
        raise ValueError("MiniMax API Key 无效或无权限")
    response.raise_for_status()
    return "MiniMax 连接成功"


@router.post("/probe/{provider}")
async def probe(provider: str, request: Request):
    valid = {
        "llm_deepseek", "llm_qwen", "llm_moonshot", "tts_aliyun", "tts_volc", "minimax", "ffmpeg"
    }
    if provider not in valid:
        raise invalid("SETTINGS_PARAMS_INVALID", "未知探测项")
    started = time.perf_counter()
    try:
        if provider in {"llm_deepseek", "llm_qwen", "llm_moonshot"}:
            message = await _probe_llm(provider, request)
        elif provider in {"tts_aliyun", "tts_volc"}:
            message = await _probe_tts(provider, request)
        elif provider == "minimax":
            message = await _probe_minimax(request)
        elif provider == "ffmpeg":
            version = await asyncio.to_thread(ffmpeg_version, _store(request).current.ffmpeg_path)
            if version is None:
                raise ValueError("ffmpeg 不可用")
            message = version
        else:
            raise AssertionError("unreachable")
        return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000), "message": message}
    except (ApiError, ValueError, RuntimeError, TTSProviderError, httpx.HTTPError) as exc:
        message = exc.message if isinstance(exc, ApiError) else str(exc)
        return {
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000),
            "message": message[:200] or "连通测试失败",
        }
