"""run 框架行为测试：队列上限/串行/取消/SSE 时序/重启恢复（T002 验收项）。"""

from __future__ import annotations

import asyncio
import time

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette

from app.config import Settings
from app.main import create_app
from app.runs import RunCancelledError

from conftest import make_settings


def wait_run_terminal(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    """轮询 run 状态直至终态。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["status"] in ("completed", "failed", "cancelled"):
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} 未在 {timeout}s 内到达终态: {run}")


def submit_demo(client: TestClient) -> dict:
    response = client.post("/api/demo/jobs")
    assert response.status_code == 202
    return response.json()


class TestRunLifecycle:
    def test_demo_run_completes_with_artifact(self, client: TestClient):
        run = submit_demo(client)
        assert run["kind"] == "demo"
        assert run["status"] == "queued"
        assert run["events_url"] == f"/api/runs/{run['run_id']}/events"

        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "completed"
        assert terminal["artifact_id"]

        artifact = client.get(f"/api/artifacts/{terminal['artifact_id']}").json()
        assert artifact["type"] == "voice"
        assert artifact["audio"]["format"] == "wav"
        assert artifact["audio"]["url"] == f"/api/artifacts/{artifact['id']}/audio"

    def test_progress_persisted_and_queryable(self, client: TestClient):
        run = submit_demo(client)
        terminal = wait_run_terminal(client, run["run_id"])
        # GET /api/runs 轮询兜底入口可用
        assert terminal["run_id"] == run["run_id"]

    def test_stats_reports_active_runs(self, client: TestClient):
        stats = client.get("/api/stats").json()
        assert "artifact_counts" in stats
        assert "conversation_count" in stats
        assert "recent_artifacts" in stats
        assert "active_runs" in stats


class TestQueue:
    def test_queue_full_rejects_ninth_pending(self, app: Starlette, client: TestClient):
        """1 个 running + 8 个 queued 后，第 10 个提交 409。"""
        async def slow_demo(ctx):
            await ctx.sleep(0.8)
            return None

        app.state.runs.register("demo", slow_demo)
        assert client.post("/api/demo/jobs").status_code == 202
        time.sleep(0.1)  # 确保第一个已出队进入 running
        for _ in range(8):
            response = client.post("/api/demo/jobs")
            assert response.status_code == 202
        # 第 10 个 → RUN_QUEUE_FULL
        response = client.post("/api/demo/jobs")
        assert response.status_code == 409
        assert response.json()["code"] == "RUN_QUEUE_FULL"

    def test_runs_execute_in_submission_order(self, app: Starlette, client: TestClient):
        finished_order: list[int] = []

        async def ordered_demo(ctx):
            # 串行 worker：handler 调用序即出队序（提交顺序）
            finished_order.append(len(finished_order))
            await ctx.sleep(0.02)
            return None

        app.state.runs.register("demo", ordered_demo)
        run_ids = [submit_demo(client)["run_id"] for _ in range(4)]
        for run_id in run_ids:
            wait_run_terminal(client, run_id)
        assert finished_order == [0, 1, 2, 3], "串行队列应按提交顺序完成"


class TestCancel:
    def test_cancel_queued_run_immediately_terminal(self, app: Starlette, client: TestClient):
        async def slow_demo(ctx):
            await ctx.sleep(1.0)
            return None

        app.state.runs.register("demo", slow_demo)
        first = submit_demo(client)
        second = submit_demo(client)

        response = client.post(f"/api/runs/{second['run_id']}/cancel")
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"

        run = client.get(f"/api/runs/{second['run_id']}").json()
        assert run["status"] == "cancelled"
        # 第一个不受影响
        assert client.get(f"/api/runs/{first['run_id']}").json()["status"] in (
            "queued",
            "running",
        )

    def test_cancel_running_run_cooperative(self, app: Starlette, client: TestClient):
        async def cancellable_demo(ctx):
            for _ in range(50):
                ctx.check_cancelled()
                await ctx.sleep(0.05)
            raise AssertionError("应当已被取消")

        app.state.runs.register("demo", cancellable_demo)
        run = submit_demo(client)
        time.sleep(0.1)  # 让其进入 running
        response = client.post(f"/api/runs/{run['run_id']}/cancel")
        assert response.status_code == 200
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "cancelled"

    def test_cancel_finished_run_conflict(self, client: TestClient):
        run = submit_demo(client)
        wait_run_terminal(client, run["run_id"])
        response = client.post(f"/api/runs/{run['run_id']}/cancel")
        assert response.status_code == 409
        assert response.json()["code"] == "RUN_ALREADY_FINISHED"


class TestSSE:
    def test_event_sequence_and_close(self, app: Starlette, client: TestClient):
        """前一个 run 占住 worker，跟踪 run 排队期连接 → 契约全时序可观测。"""
        async def slow_demo(ctx):
            for step in range(2):
                ctx.report_progress(
                    completed=step, total=2, stage="s", event="demo.progress"
                )
                await ctx.sleep(0.15)
            return None

        app.state.runs.register("demo", slow_demo)
        submit_demo(client)  # 占位 run（运行 0.3s）
        tracked = submit_demo(client)  # 排队，期间连接 SSE

        events: list[tuple[str, dict]] = []
        with client.stream(
            "GET", f"/api/runs/{tracked['run_id']}/events"
        ) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            event_name = None
            for line in response.iter_lines():
                if line.startswith("event: "):
                    event_name = line[len("event: "):]
                elif line.startswith("data: ") and event_name:
                    import json

                    events.append((event_name, json.loads(line[len("data: "):])))
                    event_name = None

        names = [name for name, _ in events]
        # 契约时序：快照(queued) → started → 线级进度 → completed（终态关闭）
        assert names[0] == "run.status"
        assert events[0][1]["status"] == "queued"
        assert names[1] == "run.started"
        assert "demo.progress" in names
        assert names[-1] == "run.completed"

    def test_connect_after_terminal_gets_snapshot_only(self, client: TestClient):
        run = submit_demo(client)
        wait_run_terminal(client, run["run_id"])
        events: list[str] = []
        with client.stream("GET", f"/api/runs/{run['run_id']}/events") as response:
            for line in response.iter_lines():
                if line.startswith("event: "):
                    events.append(line[len("event: "):])
        # 已终态：仅 run.status 快照即收口
        assert events == ["run.status"]

    def test_run_not_found(self, client: TestClient):
        response = client.get("/api/runs/run_nonexistent/events")
        assert response.status_code == 404
        assert response.json()["code"] == "RUN_NOT_FOUND"


class TestRecovery:
    def test_stale_runs_marked_interrupted_on_restart(self, tmp_path):
        settings = make_settings(tmp_path)
        app1 = create_app(settings=settings)
        with TestClient(app1) as client:
            async def forever(ctx):
                await ctx.sleep(30)
                return None

            app1.state.runs.register("demo", forever)
            running = submit_demo(client)  # 进入 running（长睡眠）
            time.sleep(0.05)
            queued = submit_demo(client)  # 排在后面，保持 queued
            # 服务停止（lifespan 退出，不迁移状态，留给重启恢复）

        app2 = create_app(settings=make_settings(tmp_path))
        with TestClient(app2) as client2:
            for run_id in (running["run_id"], queued["run_id"]):
                run = client2.get(f"/api/runs/{run_id}").json()
                assert run["status"] == "failed"
                assert run["error"]["code"] == "RUN_INTERRUPTED"


class TestErrorSanitization:
    def test_handler_exception_sanitized(self, app: Starlette, client: TestClient):
        async def broken(ctx):
            raise RuntimeError("sk-secret-123 泄漏信息")

        app.state.runs.register("demo", broken)
        run = submit_demo(client)
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "failed"
        assert terminal["error"]["code"] == "RUN_INTERNAL_ERROR"
        assert "sk-secret" not in terminal["error"]["message"]

    def test_api_error_from_handler_propagates_code(self, app: Starlette, client: TestClient):
        from app.errors import ApiError

        async def failing(ctx):
            raise ApiError("TTS_PROVIDER_ERROR", "引擎调用失败", 502)

        app.state.runs.register("demo", failing)
        run = submit_demo(client)
        terminal = wait_run_terminal(client, run["run_id"])
        assert terminal["status"] == "failed"
        assert terminal["error"]["code"] == "TTS_PROVIDER_ERROR"
