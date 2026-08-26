"""script 线 run 执行测试（FAKE_MODE 流式）：

- SSE 事件序列（assistant.delta 有序 → message.completed → artifact.updated → run.completed）
- 会话 1:1 脚本产物原地更新（再生成/编辑 id 不变）
- refinement 上下文组装（历史消息入上下文 + 预算截断）
- 取消丢弃临时内容 / 失败路径
"""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient
from starlette.applications import Starlette

from app.conversations import (
    CONTEXT_CHAR_BUDGET,
    CONTEXT_MESSAGE_LIMIT,
    _assemble_llm_messages,
)
from app.errors import ApiError
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


def create_conversation(client: TestClient) -> dict:
    response = client.post(
        "/api/conversations", json={"scene": "meditation", "title": "深海放松"}
    )
    assert response.status_code == 201
    return response.json()


def send_message(client: TestClient, conversation_id: str, text: str = "来一段深海放松", duration: int = 5) -> dict:
    response = client.post(
        f"/api/conversations/{conversation_id}/messages",
        json={"text": text, "duration": duration, "model": "deepseek-chat"},
    )
    assert response.status_code == 202
    return response.json()


def collect_sse(client: TestClient, run_id: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    with client.stream("GET", f"/api/runs/{run_id}/events") as response:
        assert response.status_code == 200
        event_name = None
        for line in response.iter_lines():
            if line.startswith("event: "):
                event_name = line[len("event: "):]
            elif line.startswith("data: ") and event_name:
                events.append((event_name, json.loads(line[len("data: "):])))
                event_name = None
    return events


class TestSSESequence:
    def test_full_event_sequence(self, app: Starlette, client: TestClient):
        """契约时序：run.status → run.started → assistant.delta* →
        message.completed → artifact.updated → run.completed。

        占位 demo run 先占住 worker，确保跟踪 run 在排队期完成 SSE 连接。
        """

        async def slow_demo(ctx):
            await ctx.sleep(0.15)
            return None

        app.state.runs.register("demo", slow_demo)
        client.post("/api/demo/jobs")  # 占位（运行 0.15s）

        conversation = create_conversation(client)
        run = send_message(client, conversation["id"], "来一段深海放松")

        events = collect_sse(client, run["run_id"])
        names = [name for name, _ in events]

        assert names[0] == "run.status"
        assert "run.started" in names
        assert names[-1] == "run.completed"
        # 事件相对顺序
        assert names.index("run.started") < names.index("assistant.delta")
        assert names.index("assistant.delta") < names.index("message.completed")
        assert names.index("message.completed") < names.index("artifact.updated")
        assert names.index("artifact.updated") < names.index("run.completed")

        # delta 有序且拼接等于定稿消息内容
        deltas = [data["delta"] for name, data in events if name == "assistant.delta"]
        assert "".join(deltas)  # 非空

        completed = next(
            data for name, data in events if name == "message.completed"
        )
        assert completed["message"]["role"] == "assistant"
        assert completed["message"]["content"] == "".join(deltas).strip()

        # artifact.updated 载荷结构
        updated = next(data for name, data in events if name == "artifact.updated")
        assert updated["artifact"]["id"]
        content = updated["artifact"]["content"]
        assert content["text"] == completed["message"]["content"]
        assert content["segments"] and content["est_duration"] > 0

        # run.completed 的 artifact_id 与产物一致
        final = next(data for name, data in events if name == "run.completed")
        assert final["artifact_id"] == updated["artifact"]["id"]

    def test_message_persisted_after_run(self, client: TestClient):
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "completed"

        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]
        assert [m["role"] for m in messages] == ["user", "assistant"]


class TestArtifactOneToOne:
    def test_regenerate_updates_in_place(self, client: TestClient):
        """再生成：1:1 脚本产物原地更新，id 不变（A4）。"""
        conversation = create_conversation(client)
        run1 = send_message(client, conversation["id"], "来一段深海放松")
        wait_run_terminal(client, run1["run_id"])
        detail1 = client.get(f"/api/conversations/{conversation['id']}").json()
        artifact1 = detail1["script_artifact"]

        run2 = send_message(client, conversation["id"], "再温柔一些，缩短到 5 分钟")
        wait_run_terminal(client, run2["run_id"])
        detail2 = client.get(f"/api/conversations/{conversation['id']}").json()
        artifact2 = detail2["script_artifact"]

        assert artifact2["id"] == artifact1["id"]
        assert artifact2["updated_at"] >= artifact1["updated_at"]
        # 产物列表中也只有一件脚本产物
        items = client.get("/api/artifacts?type=script_meditation").json()["items"]
        ids = [item["id"] for item in items if item["conversation_id"] == conversation["id"]]
        assert ids == [artifact1["id"]]

    def test_edit_script_recomputes_segments(self, client: TestClient):
        """编辑闭环：PATCH content.text → 后端重解析返回。"""
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        terminal = wait_run_terminal(client, run["run_id"])
        artifact_id = terminal["artifact_id"]

        response = client.patch(
            f"/api/artifacts/{artifact_id}",
            json={"content": {"text": "新的开始 [停顿 4s] [情绪:温柔] 温柔结尾"}},
        )
        assert response.status_code == 200
        content = response.json()["content"]
        assert content["text"] == "新的开始 [停顿 4s] [情绪:温柔] 温柔结尾"
        kinds = [seg["kind"] for seg in content["segments"]]
        assert kinds == ["speech", "pause", "speech"]
        assert content["segments"][1] == {"kind": "pause", "seconds": 4.0}
        assert content["segments"][2]["emotion"] == "温柔"
        assert content["est_duration"] > 0
        # 产物 id 不变（原地更新）
        assert response.json()["id"] == artifact_id


class TestRefinementContext:
    def test_history_included_when_present(self):
        history = [
            {"role": "user", "content": "第一轮指令"},
            {"role": "assistant", "content": "第一轮脚本"},
        ]
        messages = _assemble_llm_messages(history, "再温柔一些", 15)
        assert messages[0]["role"] == "system"
        assert "修改后的完整脚本" in messages[0]["content"]  # refinement guide 注入
        assert {"role": "user", "content": "第一轮指令"} in messages
        assert {"role": "assistant", "content": "第一轮脚本"} in messages
        assert messages[-1]["role"] == "user"
        assert "再温柔一些" in messages[-1]["content"]
        assert "15 分钟" in messages[-1]["content"]

    def test_no_history_no_refinement_guide(self):
        messages = _assemble_llm_messages([], "来一段冥想", 5)
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "修改后的完整脚本" not in messages[0]["content"]

    def test_budget_truncation(self):
        """超出预算的最早历史被截断。"""
        big = "字" * 1000
        history = [{"role": "user", "content": f"{big}-{i}"} for i in range(30)]
        messages = _assemble_llm_messages(history, "再改一版", 5)
        user_contents = [m["content"] for m in messages if m["role"] == "user"]
        # 最新的若干条在上下文里，最早的不在
        assert f"{big}-29" in user_contents
        assert f"{big}-0" not in user_contents
        total = sum(len(m["content"]) for m in messages[1:])
        assert total <= CONTEXT_CHAR_BUDGET + len("再改一版")

    def test_message_limit_truncation(self):
        history = [
            {"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"}
            for i in range(100)
        ]
        messages = _assemble_llm_messages(history, "再改一版", 5)
        assert len(messages) - 2 <= CONTEXT_MESSAGE_LIMIT


class TestCancelAndFailure:
    def test_cancel_discards_temporary_content(self, app: Starlette, client: TestClient):
        """取消：临时内容丢弃——无 assistant 消息、无脚本产物。"""
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        time.sleep(0.05)  # 进入 running、流式输出中

        response = client.post(f"/api/runs/{run['run_id']}/cancel")
        assert response.status_code == 200
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "cancelled"

        detail = client.get(f"/api/conversations/{conversation['id']}").json()
        assert detail["script_artifact"] is None
        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]
        assert [m["role"] for m in messages] == ["user"]

    def test_failure_reports_sanitized_error(self, app: Starlette, client: TestClient):
        async def broken_script(ctx):
            raise ApiError("SCRIPT_LLM_ERROR", "模型调用失败（deepseek 返回 500），请稍后重试", 502)

        app.state.runs.register("script", broken_script)
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])

        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "failed"
        assert terminal["error"]["code"] == "SCRIPT_LLM_ERROR"

        # 失败：临时内容丢弃（无 assistant 消息 / 无产物），active_run 解除
        detail = client.get(f"/api/conversations/{conversation['id']}").json()
        assert detail["script_artifact"] is None
        assert detail["active_run_id"] is None
        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]
        assert [m["role"] for m in messages] == ["user"]

    def test_retry_after_failure(self, app: Starlette, client: TestClient):
        """失败卡片重试：重新注册可用 handler 后以原 user 消息重生成。"""
        calls = {"count": 0}

        async def flaky_script(ctx):
            calls["count"] += 1
            if calls["count"] == 1:
                raise ApiError("SCRIPT_LLM_ERROR", "模型调用失败，请稍后重试", 502)
            # 复用正式 handler 的产物逻辑（简化：直接落一条产物）
            manager = ctx._manager  # noqa: SLF001
            artifact = manager.repo.insert_artifact(
                type="script_meditation",
                name="重试产物",
                source_run_id=ctx.run_id,
                params={"topic": "x", "duration": 5, "model": "deepseek-chat"},
                content={"text": "重试后的脚本", "segments": [], "est_duration": 1.0},
            )
            return artifact["id"]

        app.state.runs.register("script", flaky_script)
        conversation = create_conversation(client)
        run = send_message(client, conversation["id"])
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "failed"

        messages = client.get(
            f"/api/conversations/{conversation['id']}/messages"
        ).json()["items"]
        retry = client.post(
            f"/api/conversations/{conversation['id']}/messages/{messages[0]['id']}/retry"
        )
        assert retry.status_code == 202
        retried = wait_run_terminal(client, retry.json()["run_id"])
        assert retried["status"] == "completed"


class TestRecovery:
    def test_refresh_recovers_running_state(self, tmp_path):
        """刷新恢复：同实例 detail 返回 active_run_id 供前端重连 SSE；
        服务重启则遗留 run 标记 RUN_INTERRUPTED，可重新提交。"""
        settings = make_settings(tmp_path)
        app1 = create_app(settings=settings)
        with TestClient(app1) as client:
            async def slow_script(ctx):
                await ctx.sleep(30)
                return None

            app1.state.runs.register("script", slow_script)
            conversation = create_conversation(client)
            run = send_message(client, conversation["id"])
            time.sleep(0.05)
            # 刷新页面场景：detail 聚合返回 active_run_id
            detail = client.get(f"/api/conversations/{conversation['id']}").json()
            assert detail["active_run_id"] == run["run_id"]

        app2 = create_app(settings=make_settings(tmp_path))
        with TestClient(app2) as client2:
            # 服务重启：遗留 run 收口为 failed（RUN_INTERRUPTED），可重新提交
            run_status = client2.get(f"/api/runs/{run['run_id']}").json()
            assert run_status["status"] == "failed"
            assert run_status["error"]["code"] == "RUN_INTERRUPTED"
            detail = client2.get(f"/api/conversations/{conversation['id']}").json()
            assert detail["active_run_id"] is None
            resend = client2.post(
                f"/api/conversations/{conversation['id']}/messages",
                json={"text": "重新生成", "duration": 5, "model": "deepseek-chat"},
            )
            assert resend.status_code == 202
