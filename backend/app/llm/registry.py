"""LLM ModelRegistry：DeepSeek + Kimi + 通义千问，流式输出。

各 Provider 共享 OpenAI Chat Completions 协议，但请求参数必须按模型能力构造。
Moonshot 的 K2.5/K2.6 支持 thinking 开关，并要求使用固定采样参数；本模块
因此不向任何 Moonshot 模型显式发送 temperature。
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from ..config import Settings
from ..errors import ApiError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LlmModel:
    provider: str
    model: str
    name: str
    base_url: str
    api_key_setting: str


@dataclass(frozen=True)
class MoonshotCapabilities:
    thinking_configurable: bool
    thinking_forced: bool
    thinking_parameter_supported: bool
    temperature_policy: Literal["omit"]
    thinking_unavailable_reason: str | None


@dataclass(frozen=True)
class LlmStreamEvent:
    kind: Literal["reasoning", "content", "finish", "usage", "done"]
    content: str | None = None
    finish_reason: str | None = None


class ModelRegistry:
    """模型注册表：可用性声明、Provider 请求适配与流式调用。"""

    _MOONSHOT_THINKING_MODELS = frozenset({"kimi-k2.5", "kimi-k2.6"})
    _MOONSHOT_FORCED_THINKING_MODELS = frozenset(
        {"kimi-k2.7-code", "kimi-k2.7-code-highspeed"}
    )

    def __init__(self, settings: Settings):
        self.settings = settings
        self._entries = (
            LlmModel(
                provider="deepseek",
                model=settings.deepseek_model_id,
                name="DeepSeek Chat",
                base_url="https://api.deepseek.com/v1",
                api_key_setting="deepseek_api_key",
            ),
            LlmModel(
                provider="moonshot",
                model=settings.moonshot_model_id,
                name="Kimi K2",
                base_url="https://api.moonshot.cn/v1",
                api_key_setting="moonshot_api_key",
            ),
            LlmModel(
                provider="qwen",
                model=settings.dashscope_model_id,
                name="通义千问 Plus",
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                api_key_setting="dashscope_api_key",
            ),
        )
        self._models = {entry.model: entry for entry in self._entries}

    @classmethod
    def moonshot_capabilities(cls, model: str | None) -> MoonshotCapabilities:
        normalized = (model or "").strip().lower()
        if normalized in cls._MOONSHOT_THINKING_MODELS:
            return MoonshotCapabilities(True, False, True, "omit", None)
        if normalized in cls._MOONSHOT_FORCED_THINKING_MODELS:
            return MoonshotCapabilities(
                False,
                True,
                False,
                "omit",
                "Kimi K2.7 Code 始终开启思考，不能关闭",
            )
        if normalized == "kimi-k3":
            return MoonshotCapabilities(
                False, False, False, "omit", "Kimi K3 不使用 thinking 开关"
            )
        return MoonshotCapabilities(
            False, False, False, "omit", "当前模型不支持可配置的思考模式"
        )

    def effective_moonshot_thinking(self, model: str) -> bool | None:
        normalized = model.strip().lower()
        if normalized in self._MOONSHOT_THINKING_MODELS:
            return self.settings.moonshot_thinking_enabled
        if normalized in self._MOONSHOT_FORCED_THINKING_MODELS:
            return True
        return None

    def get(self, model: str) -> LlmModel | None:
        return self._models.get(model)

    def get_by_provider(self, provider: str) -> LlmModel | None:
        return next((entry for entry in self._entries if entry.provider == provider), None)

    def is_configured(self, model: str) -> bool:
        entry = self._models.get(model)
        return bool(entry and getattr(self.settings, entry.api_key_setting))

    def list_models(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for entry in self._entries:
            if self.settings.fake_mode or self.is_configured(entry.model):
                items.append(
                    {"provider": entry.provider, "model": entry.model, "name": entry.name}
                )
        return items

    def request_payload(
        self, entry: LlmModel, messages: list[dict[str, str]]
    ) -> dict[str, Any]:
        """构造 Provider 感知的请求体，供正式生成与设置探测共用。"""
        payload: dict[str, Any] = {
            "model": entry.model,
            "messages": messages,
            "stream": True,
        }
        if entry.provider == "moonshot":
            if entry.model.strip().lower() in self._MOONSHOT_THINKING_MODELS:
                payload["thinking"] = {
                    "type": (
                        "enabled"
                        if self.settings.moonshot_thinking_enabled
                        else "disabled"
                    )
                }
            return payload
        payload["temperature"] = 0.8
        return payload

    def stream_chat(
        self, model: str, messages: list[dict[str, str]], *, timeout_seconds: int | None = None
    ) -> AsyncIterator[LlmStreamEvent]:
        entry = self._models.get(model)
        if entry is None:
            raise ApiError("SCRIPT_PARAMS_INVALID", f"未知模型: {model}", 422)
        api_key = getattr(self.settings, entry.api_key_setting)
        if not api_key:
            raise ApiError(
                "SCRIPT_LLM_NOT_CONFIGURED",
                "该模型未配置 API Key，请先在服务端 .env 中配置",
                422,
            )
        timeout = httpx.Timeout(
            timeout_seconds or self.settings.llm_timeout_seconds, connect=10.0
        )
        return self._stream(entry, api_key, messages, timeout)

    async def _stream(
        self,
        entry: LlmModel,
        api_key: str,
        messages: list[dict[str, str]],
        timeout: httpx.Timeout,
    ) -> AsyncIterator[LlmStreamEvent]:
        received_done = False
        received_content = False
        response_started = False
        finish_reason: str | None = None
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    f"{entry.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=self.request_payload(entry, messages),
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")
                        request_id = response.headers.get("x-request-id")
                        raise self._upstream_error(
                            entry, response.status_code, body, request_id=request_id
                        )
                    response_started = True
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:") :].strip()
                        if payload == "[DONE]":
                            received_done = True
                            yield LlmStreamEvent("done")
                            break
                        for event in self._parse_stream_payload(payload, entry):
                            if event.kind == "content" and event.content:
                                received_content = True
                            elif event.kind == "finish":
                                finish_reason = event.finish_reason
                            yield event
        except httpx.TimeoutException:
            raise ApiError("SCRIPT_TIMEOUT", "模型响应超时，请重试", 504) from None
        except httpx.HTTPError as exc:
            if response_started:
                raise ApiError(
                    "SCRIPT_LLM_STREAM_INCOMPLETE",
                    "模型响应中断，未保存不完整内容，请重试",
                    502,
                ) from exc
            raise ApiError("SCRIPT_LLM_ERROR", "模型调用失败，请稍后重试", 502) from exc

        if not received_done:
            raise ApiError(
                "SCRIPT_LLM_STREAM_INCOMPLETE",
                "模型响应中断，未保存不完整内容，请重试",
                502,
            )
        if finish_reason == "length":
            raise ApiError(
                "SCRIPT_LLM_OUTPUT_TRUNCATED",
                "模型输出达到长度上限，未保存不完整内容",
                502,
            )
        if finish_reason == "content_filter":
            raise ApiError(
                "SCRIPT_LLM_CONTENT_REJECTED",
                "输入或模型输出触发内容安全限制，请调整内容后重试",
                502,
            )
        if finish_reason not in (None, "stop"):
            raise ApiError(
                "SCRIPT_LLM_ERROR",
                f"模型未正常完成输出（{finish_reason}），请重试",
                502,
            )
        if not received_content:
            raise ApiError("SCRIPT_LLM_ERROR", "模型返回内容为空，请重试", 502)

    @classmethod
    def _parse_stream_payload(
        cls, payload: str, entry: LlmModel
    ) -> list[LlmStreamEvent]:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            raise ApiError(
                "SCRIPT_LLM_STREAM_INCOMPLETE", "模型返回了无法解析的流数据，请重试", 502
            ) from None
        if not isinstance(data, dict):
            raise ApiError(
                "SCRIPT_LLM_STREAM_INCOMPLETE", "模型返回了无法解析的流数据，请重试", 502
            )
        if isinstance(data.get("error"), dict):
            raise cls._upstream_error(entry, 502, json.dumps(data, ensure_ascii=False))

        choices = data.get("choices")
        if choices == [] and data.get("usage") is not None:
            return [LlmStreamEvent("usage")]
        if not isinstance(choices, list) or not choices:
            return []
        choice = choices[0]
        if not isinstance(choice, dict):
            return []
        events: list[LlmStreamEvent] = []
        delta = choice.get("delta")
        if isinstance(delta, dict):
            if delta.get("reasoning_content"):
                events.append(LlmStreamEvent("reasoning"))
            content = delta.get("content")
            if isinstance(content, str) and content:
                events.append(LlmStreamEvent("content", content=content))
        reason = choice.get("finish_reason")
        if isinstance(reason, str) and reason:
            events.append(LlmStreamEvent("finish", finish_reason=reason))
        if data.get("usage") is not None:
            events.append(LlmStreamEvent("usage"))
        return events

    @staticmethod
    def _safe_upstream_details(body: str) -> tuple[str | None, str | None, str | None]:
        try:
            data = json.loads(body)
            error = data.get("error") if isinstance(data, dict) else None
            if not isinstance(error, dict):
                return None, None, None
            error_type = error.get("type") if isinstance(error.get("type"), str) else None
            error_code = error.get("code") if isinstance(error.get("code"), str) else None
            raw_message = error.get("message") if isinstance(error.get("message"), str) else None
            safe_message = None
            if raw_message:
                safe_message = re.sub(r"[\x00-\x1f\x7f]+", " ", raw_message).strip()[:200]
                safe_message = re.sub(
                    r"(?i)\bbearer\s+\S+", "Bearer ***", safe_message
                )
                safe_message = re.sub(
                    r"(?i)\bsk-[a-z0-9_-]{4,}\b", "sk-***", safe_message
                )
            return error_type, error_code, safe_message
        except (json.JSONDecodeError, AttributeError):
            return None, None, None

    @classmethod
    def _upstream_error(
        cls,
        entry: LlmModel,
        status_code: int,
        body: str,
        *,
        request_id: str | None = None,
    ) -> ApiError:
        error_type, error_code, safe_message = cls._safe_upstream_details(body)
        logger.warning(
            "LLM upstream rejected request provider=%s model=%s status=%s error_type=%s error_code=%s request_id=%s message=%s",
            entry.provider,
            entry.model,
            status_code,
            error_type,
            error_code,
            request_id,
            safe_message,
        )
        if status_code == 400 and error_type == "content_filter":
            return ApiError(
                "SCRIPT_LLM_CONTENT_REJECTED",
                "输入或模型输出触发内容安全限制，请调整内容后重试",
                502,
            )
        if status_code == 400:
            return ApiError(
                "SCRIPT_LLM_REQUEST_INVALID",
                "模型请求参数不兼容，请检查模型 ID 与思考模式设置",
                502,
            )
        if status_code == 401:
            return ApiError(
                "SCRIPT_LLM_AUTH_ERROR",
                "API Key 无效，或 API Key 与接口所属平台不匹配",
                502,
            )
        if status_code == 403:
            return ApiError("SCRIPT_LLM_ACCESS_DENIED", "当前账号无权调用该模型", 502)
        if status_code == 404:
            return ApiError(
                "SCRIPT_LLM_MODEL_NOT_FOUND", "模型不存在或当前账号无权访问", 502
            )
        if status_code == 429:
            quota = error_type == "exceeded_current_quota_error"
            return ApiError(
                "SCRIPT_LLM_QUOTA_EXCEEDED" if quota else "SCRIPT_LLM_RATE_LIMITED",
                "账户余额或 Token 额度不足" if quota else "模型繁忙或请求受限，请稍后重试",
                502,
            )
        return ApiError("SCRIPT_LLM_ERROR", "模型服务暂时异常，请稍后重试", 502)
