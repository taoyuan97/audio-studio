"""LLM ModelRegistry：DeepSeek + 通义千问（DashScope OpenAI 兼容），流式输出。

- 两家均为 OpenAI 兼容 chat/completions + SSE 流式，直接用 httpx 实现
  （不引入 LangChain 重依赖；registry 接口保持可替换）。
- 配置：DEEPSEEK_API_KEY / DASHSCOPE_API_KEY（见 config.py）。
- 错误映射（api-contract.md 第 12 节）：
  - Key 未配置 → SCRIPT_LLM_NOT_CONFIGURED（422，调用方提交前应先校验）；
  - 网络/上游 4xx-5xx → SCRIPT_LLM_ERROR（502，message 脱敏）；
  - 超时 → SCRIPT_TIMEOUT（504）。
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import Settings
from ..errors import ApiError


@dataclass(frozen=True)
class LlmModel:
    provider: str
    model: str
    name: str
    base_url: str
    api_key_setting: str  # Settings 字段名


MODELS: tuple[LlmModel, ...] = (
    LlmModel(
        provider="deepseek",
        model="deepseek-chat",
        name="DeepSeek Chat",
        base_url="https://api.deepseek.com/v1",
        api_key_setting="deepseek_api_key",
    ),
    LlmModel(
        provider="moonshot",
        model="kimi-k2-0905-preview",
        name="Kimi K2",
        base_url="https://api.moonshot.cn/v1",
        api_key_setting="moonshot_api_key",
    ),
    LlmModel(
        provider="qwen",
        model="qwen-plus",
        name="通义千问 Plus",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key_setting="dashscope_api_key",
    ),
)


class ModelRegistry:
    """模型注册表：可用性声明 + OpenAI 兼容流式调用。"""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._models = {m.model: m for m in MODELS}

    def get(self, model: str) -> LlmModel | None:
        return self._models.get(model)

    def is_configured(self, model: str) -> bool:
        entry = self._models.get(model)
        return bool(entry and getattr(self.settings, entry.api_key_setting))

    def list_models(self) -> list[dict[str, Any]]:
        """GET /api/conversations/{id}/models 载荷：仅返回可用模型。

        - 真实模式：已配置 API Key 的模型；
        - FAKE_MODE：全量注册模型（伪流式无需 Key）。
        """
        items: list[dict[str, Any]] = []
        for entry in MODELS:
            if self.settings.fake_mode or self.is_configured(entry.model):
                items.append(
                    {
                        "provider": entry.provider,
                        "model": entry.model,
                        "name": entry.name,
                    }
                )
        return items

    def stream_chat(
        self, model: str, messages: list[dict[str, str]], *, timeout_seconds: int | None = None
    ) -> AsyncIterator[str]:
        """OpenAI 兼容流式补全，逐段 yield 文本增量。"""
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
            timeout_seconds or self.settings.llm_timeout_seconds,
            connect=10.0,
        )
        return self._stream(entry, api_key, messages, timeout)

    async def _stream(
        self,
        entry: LlmModel,
        api_key: str,
        messages: list[dict[str, str]],
        timeout: httpx.Timeout,
    ) -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    f"{entry.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": entry.model,
                        "messages": messages,
                        "stream": True,
                        "temperature": 0.8,
                    },
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")
                        raise self._upstream_error(entry, response.status_code, body)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:") :].strip()
                        if payload == "[DONE]":
                            return
                        delta = self._extract_delta(payload)
                        if delta:
                            yield delta
        except httpx.TimeoutException:
            raise ApiError("SCRIPT_TIMEOUT", "模型响应超时，请重试", 504) from None
        except httpx.HTTPError as exc:
            raise ApiError(
                "SCRIPT_LLM_ERROR", "模型调用失败，请稍后重试", 502
            ) from exc

    @staticmethod
    def _extract_delta(payload: str) -> str | None:
        try:
            data = json.loads(payload)
            return data["choices"][0]["delta"].get("content")
        except (json.JSONDecodeError, KeyError, IndexError, TypeError):
            return None

    @staticmethod
    def _upstream_error(entry: LlmModel, status_code: int, body: str) -> ApiError:
        # 脱敏：不透出 Key / 上游响应原文
        del body
        return ApiError(
            "SCRIPT_LLM_ERROR",
            f"模型调用失败（{entry.provider} 返回 {status_code}），请稍后重试",
            502,
        )
