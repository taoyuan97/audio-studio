"""剧本线契约端点测试（api-contract.md 第 4 节，FAKE_MODE）。

run 执行时序（SSE 事件序列、1:1 产物原地更新、refinement）见 test_script_run.py。
"""

from __future__ import annotations

import time

from fastapi.testclient import TestClient
from starlette.applications import Starlette

from app.main import create_app
from conftest import make_settings


def wait_run_terminal(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed", "cancelled"):
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到达终态: {run}")


def create_conversation(client: TestClient, title: str = "深海放松") -> dict:
    response = client.post("/api/conversations", json={"scene": "meditation", "title": title})
    assert response.status_code == 201
    return response.json()


def send_message(client: TestClient, conversation_id: str, text: str = "来一段深海放松") -> dict:
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"text": text, "duration": 5, "model": "deepseek-chat"},
    )
    assert response.status_code == 202
    return response.json()


class TestConversationCrud:
    def test_create_defaults(self, client: TestClient):
        response = client.post("/api/conversations", json={"scene": "meditation"})
        assert response.status_code == 201
        body = response.json()
        assert body["scene"] == "meditation"
        assert body["title"] == "未命名冥想"
        assert body["id"].startswith("conv_")
        assert body["created_at"] == body["updated_at"]

    def test_create_invalid_scene_rejected(self, client: TestClient):
        response = client.post("/api/conversations", json={"scene": "unknown"})
        assert response.status_code == 422

    def test_list_sorted_by_updated_desc(self, client: TestClient):
        first = create_conversation(client, "第一个")
        second = create_conversation(client, "第二个")
        items = client.get("/api/conversations?scene=meditation").json()["items"]
        ids = [item["id"] for item in items]
        assert ids.index(second["id"]) < ids.index(first["id"])

    def test_rename(self, client: TestClient):
        conversation = create_conversation(client)
        response = client.patch(
            f"/api/conversations/{conversation['id']}", json={"title": "新标题"}
        )
        assert response.status_code == 200
        assert response.json()["title"] == "新标题"

    def test_rename_not_found(self, client: TestClient):
        response = client.patch(
            "/api/conversations/conv_nonexistent", json={"title": "x"}
        )
        assert response.status_code == 404
        assert response.json()["code"] == "CONVERSATION_NOT_FOUND"

    def test_detail_aggregate(self, client: TestClient):
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        wait_run_terminal(client, run["run_id"])

        detail = client.get(f"/api/conversations/{conversation['id']}").json()
        assert detail["conversation"]["id"] == conversation["id"]
        assert detail["active_run_id"] is None  # 已完成
        assert detail["script_artifact"] is None
        draft = detail["script_draft"]
        assert draft["origin"] == "generated"
        assert draft["content"]["text"]
        assert draft["content"]["segments"]
        assert draft["content"]["est_duration"] > 0
        assert detail["has_unsaved_changes"] is True

    def test_detail_active_run_reported(self, app: Starlette, client: TestClient):
        """慢速生成期间 detail 聚合返回 active_run_id。"""

        async def slow_script(ctx):
            await ctx.sleep(0.3)
            return None

        app.state.runs.register("script", slow_script)
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        detail = client.get(f"/api/conversations/{conversation['id']}").json()
        assert detail["active_run_id"] == run["run_id"]
        wait_run_terminal(client, run["run_id"])

    def test_detail_not_found(self, client: TestClient):
        response = client.get("/api/conversations/conv_nonexistent")
        assert response.status_code == 404


class TestMessages:
    def test_send_and_list_messages(self, client: TestClient):
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"], "来一段睡眠引导")
        wait_run_terminal(client, run["run_id"])

        body = client.get(f"/api/conversations/{conversation['id']}/messages").json()
        assert body["has_more"] is False
        roles = [item["role"] for item in body["items"]]
        assert roles == ["user", "assistant"]
        user_msg = body["items"][0]
        assert user_msg["params"] == {"duration": 5, "model": "deepseek-chat"}
        assistant_msg = body["items"][1]
        assert assistant_msg["params"] is None
        assert "[停顿" in assistant_msg["content"]

    def test_pagination_cursor(self, client: TestClient):
        conversation = create_conversation(client)
        run1 = send_message(client, conversation["id"], "来一段深海放松")
        wait_run_terminal(client, run1["run_id"])
        run2 = send_message(client, conversation["id"], "再温柔一些")
        wait_run_terminal(client, run2["run_id"])

        full = client.get(f"/api/conversations/{conversation['id']}/messages").json()
        assert len(full["items"]) == 4

        # limit=2：最新 2 条，has_more=True
        page1 = client.get(
            f"/api/conversations/{conversation['id']}/messages?limit=2"
        ).json()
        assert len(page1["items"]) == 2
        assert page1["has_more"] is True
        assert page1["items"] == full["items"][2:]

        # before 游标：取更早的 2 条
        cursor = page1["items"][0]["id"]
        page2 = client.get(
            f"/api/conversations/{conversation['id']}/messages?limit=2&before={cursor}"
        ).json()
        assert page2["items"] == full["items"][:2]
        assert page2["has_more"] is False

    def test_send_validation_errors(self, client: TestClient):
        conversation = create_conversation(client)
        base = f"/api/conversations/{conversation['id']}/messages"

        empty = client.post(base, json={"text": "  ", "duration": 5, "model": "deepseek-chat"})
        assert empty.status_code == 422
        assert empty.json()["code"] == "SCRIPT_TEXT_INVALID"

        too_long = client.post(
            base, json={"text": "x" * 20001, "duration": 5, "model": "deepseek-chat"}
        )
        assert too_long.status_code == 422
        assert too_long.json()["code"] == "SCRIPT_TEXT_INVALID"

        bad_duration = client.post(
            base, json={"text": "主题", "duration": 12, "model": "deepseek-chat"}
        )
        assert bad_duration.status_code == 422
        assert bad_duration.json()["code"] == "SCRIPT_PARAMS_INVALID"

        bad_model = client.post(
            base, json={"text": "主题", "duration": 5, "model": "gpt-4"}
        )
        assert bad_model.status_code == 422
        assert bad_model.json()["code"] == "SCRIPT_PARAMS_INVALID"

    def test_all_duration_presets_are_accepted(self, client: TestClient):
        for duration in (5, 10, 15, 20, 25, 30):
            conversation = create_conversation(client, f"{duration} 分钟")
            response = client.post(
                f"/api/conversations/{conversation['id']}/messages",
                json={
                    "text": "主题",
                    "duration": duration,
                    "model": "deepseek-chat",
                },
            )
            assert response.status_code == 202

    def test_send_active_run_conflict(self, app: Starlette, client: TestClient):
        async def slow_script(ctx):
            await ctx.sleep(0.3)
            return None

        app.state.runs.register("script", slow_script)
        conversation = create_conversation(client)
        send_message(client, conversation["id"])
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages",
            json={"text": "再来一段", "duration": 5, "model": "deepseek-chat"},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "CONVERSATION_RUN_ACTIVE"


class TestRetry:
    def test_retry_last_user_message(self, client: TestClient):
        conversation = create_conversation(client)
        run1 = send_message(client, conversation["id"])
        wait_run_terminal(client, run1["run_id"])
        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]

        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/{messages[0]['id']}/retry"
        )
        assert response.status_code == 202
        wait_run_terminal(client, response.json()["run_id"])

        # 重试后新增一条 assistant 消息（user 消息不重复）
        after = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]
        assert [m["role"] for m in after] == ["user", "assistant", "assistant"]

    def test_retry_non_last_message_rejected(self, client: TestClient):
        conversation = create_conversation(client)
        run1 = send_message(client, conversation["id"])
        wait_run_terminal(client, run1["run_id"])
        run2 = send_message(client, conversation["id"], "再温柔一些")
        wait_run_terminal(client, run2["run_id"])
        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]

        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/{messages[0]['id']}/retry"
        )
        assert response.status_code == 409
        assert response.json()["code"] == "MESSAGE_NOT_RETRYABLE"

    def test_retry_message_not_found(self, client: TestClient):
        conversation = create_conversation(client)
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/msg_nonexistent/retry"
        )
        assert response.status_code == 404
        assert response.json()["code"] == "MESSAGE_NOT_FOUND"


class TestModels:
    def test_fake_mode_returns_all_registered(self, client: TestClient):
        """FAKE_MODE 无需 Key：返回全量注册模型（DeepSeek/Kimi/千问）。"""
        conversation = create_conversation(client)
        response = client.get(f"/api/conversations/{conversation['id']}/models")
        assert response.status_code == 200
        models = response.json()["models"]
        assert {m["model"] for m in models} == {
            "deepseek-chat",
            "kimi-k2-0905-preview",
            "qwen-plus",
        }
        for item in models:
            assert set(item) == {"provider", "model", "name"}

    def test_real_mode_only_configured(self, tmp_path):
        """真实模式：仅返回已配置 Key 的模型，未配置的不出现。"""
        settings = make_settings(
            tmp_path,
            fake_mode=False,
            deepseek_api_key="sk-test-deepseek",
            moonshot_api_key="sk-test-moonshot",
        )
        app = create_app(settings=settings)
        with TestClient(app) as test_client:
            conversation = create_conversation(test_client)
            models = test_client.get(
                f"/api/conversations/{conversation['id']}/models"
            ).json()["models"]
            assert {m["model"] for m in models} == {
                "deepseek-chat",
                "kimi-k2-0905-preview",
            }
            assert all(m["provider"] != "qwen" for m in models)

    def test_custom_model_ids_are_returned(self, tmp_path):
        settings = make_settings(
            tmp_path,
            deepseek_model_id="deepseek-reasoner",
            dashscope_model_id="qwen-max",
            moonshot_model_id="moonshot-v1-auto",
        )
        app = create_app(settings=settings)
        with TestClient(app) as test_client:
            conversation = create_conversation(test_client)
            models = test_client.get(
                f"/api/conversations/{conversation['id']}/models"
            ).json()["models"]
            assert {item["model"] for item in models} == {
                "deepseek-reasoner",
                "qwen-max",
                "moonshot-v1-auto",
            }

    def test_real_mode_zero_keys_returns_empty(self, tmp_path):
        """真实模式零配置：返回空列表（前端据此禁用发送）。"""
        settings = make_settings(
            tmp_path,
            fake_mode=False,
            deepseek_api_key="",
            dashscope_api_key="",
            moonshot_api_key="",
        )
        app = create_app(settings=settings)
        with TestClient(app) as test_client:
            conversation = create_conversation(test_client)
            body = test_client.get(
                f"/api/conversations/{conversation['id']}/models"
            ).json()
            assert body["models"] == []

    def test_models_conversation_not_found(self, client: TestClient):
        response = client.get("/api/conversations/conv_nonexistent/models")
        assert response.status_code == 404
