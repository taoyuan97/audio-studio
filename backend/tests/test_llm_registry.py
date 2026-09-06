"""T015：Moonshot 请求能力、流式完整性与错误分类。"""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.config import Settings
from app.errors import ApiError
from app.llm.registry import LlmModel, ModelRegistry


def registry_for(model: str = "kimi-k2.6", *, thinking: bool = True) -> ModelRegistry:
    return ModelRegistry(
        Settings(
            _env_file=None,
            moonshot_api_key="sk-test",
            moonshot_model_id=model,
            moonshot_thinking_enabled=thinking,
        )
    )


@pytest.mark.parametrize("model", ["kimi-k2.5", "kimi-k2.6"])
@pytest.mark.parametrize("thinking", [True, False])
def test_kimi_configurable_thinking_and_no_temperature(model: str, thinking: bool):
    registry = registry_for(model, thinking=thinking)
    entry = registry.get(model)
    assert entry is not None

    payload = registry.request_payload(entry, [{"role": "user", "content": "你好"}])

    assert payload["thinking"] == {"type": "enabled" if thinking else "disabled"}
    assert "temperature" not in payload
    capabilities = registry.moonshot_capabilities(model)
    assert capabilities.thinking_configurable is True
    assert capabilities.thinking_forced is False
    assert capabilities.thinking_parameter_supported is True
    assert capabilities.temperature_policy == "omit"


@pytest.mark.parametrize(
    "model,thinking_forced,reason",
    [
        ("kimi-k2.7-code", True, "始终开启思考"),
        ("kimi-k2.7-code-highspeed", True, "始终开启思考"),
        ("kimi-k3", False, "不使用 thinking"),
        ("moonshot-v1-128k", False, "不支持可配置"),
        ("future-model", False, "不支持可配置"),
    ],
)
def test_non_configurable_moonshot_models_omit_thinking(
    model: str, thinking_forced: bool, reason: str
):
    registry = registry_for(model, thinking=False)
    entry = registry.get(model)
    assert entry is not None

    payload = registry.request_payload(entry, [{"role": "user", "content": "你好"}])

    assert "thinking" not in payload
    assert "temperature" not in payload
    capabilities = registry.moonshot_capabilities(model)
    assert capabilities.thinking_configurable is False
    assert capabilities.thinking_forced is thinking_forced
    assert capabilities.thinking_parameter_supported is False
    assert capabilities.temperature_policy == "omit"
    assert reason in (capabilities.thinking_unavailable_reason or "")


def test_other_providers_keep_temperature():
    registry = registry_for()
    for provider in ("deepseek", "qwen"):
        entry = registry.get_by_provider(provider)
        assert entry is not None
        assert registry.request_payload(entry, [])["temperature"] == 0.8


def install_stream(monkeypatch, body: str, *, status: int = 200, headers=None):
    original = httpx.AsyncClient

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text=body, headers=headers)

    def client_factory(**kwargs):
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr("app.llm.registry.httpx.AsyncClient", client_factory)


def collect_stream(registry: ModelRegistry):
    async def collect():
        return [event async for event in registry.stream_chat("kimi-k2.6", [])]

    return asyncio.run(collect())


def test_reasoning_is_not_exposed_but_keeps_stream_active(monkeypatch):
    install_stream(
        monkeypatch,
        "\n\n".join(
            [
                'data: {"choices":[{"delta":{"reasoning_content":"secret"},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
                "data: [DONE]",
                "",
            ]
        ),
    )
    registry = registry_for()

    events = collect_stream(registry)

    assert [event.kind for event in events] == ["reasoning", "content", "finish", "done"]
    assert "".join(event.content or "" for event in events) == "正文"
    assert all(event.content != "secret" for event in events)


def test_stream_requires_done_even_after_content(monkeypatch):
    install_stream(
        monkeypatch,
        'data: {"choices":[{"delta":{"content":"残缺正文"},"finish_reason":"stop"}]}\n\n',
    )
    registry = registry_for()

    with pytest.raises(ApiError) as caught:
        collect_stream(registry)

    assert caught.value.code == "SCRIPT_LLM_STREAM_INCOMPLETE"


def test_length_finish_is_rejected_after_done(monkeypatch):
    install_stream(
        monkeypatch,
        "\n\n".join(
            [
                'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":"length"}]}',
                "data: [DONE]",
                "",
            ]
        ),
    )
    registry = registry_for()

    with pytest.raises(ApiError) as caught:
        collect_stream(registry)

    assert caught.value.code == "SCRIPT_LLM_OUTPUT_TRUNCATED"


@pytest.mark.parametrize(
    "status,error_type,expected",
    [
        (400, "invalid_request_error", "SCRIPT_LLM_REQUEST_INVALID"),
        (400, "content_filter", "SCRIPT_LLM_CONTENT_REJECTED"),
        (401, "invalid_authentication_error", "SCRIPT_LLM_AUTH_ERROR"),
        (403, "permission_denied_error", "SCRIPT_LLM_ACCESS_DENIED"),
        (404, "resource_not_found_error", "SCRIPT_LLM_MODEL_NOT_FOUND"),
        (429, "exceeded_current_quota_error", "SCRIPT_LLM_QUOTA_EXCEEDED"),
        (429, "rate_limit_reached_error", "SCRIPT_LLM_RATE_LIMITED"),
        (503, "server_unavailable", "SCRIPT_LLM_ERROR"),
    ],
)
def test_upstream_error_classification(status: int, error_type: str, expected: str):
    entry = LlmModel("moonshot", "kimi-k2.6", "Kimi", "https://example", "key")
    error = ModelRegistry._upstream_error(
        entry,
        status,
        '{"error":{"type":"%s","code":"x","message":"safe"}}' % error_type,
    )
    assert error.code == expected


def test_upstream_log_details_redact_credentials():
    _, _, message = ModelRegistry._safe_upstream_details(
        '{"error":{"message":"Authorization Bearer abcdef and sk-secretvalue"}}'
    )
    assert message == "Authorization Bearer *** and sk-***"
