"""全局 run 框架：串行队列 + SSE 事件总线（docs/tech/tech-design.md 5.1）。

- 单 worker 协程顺序执行，queued 上限 8（RUN_QUEUE_FULL）。
- 各业务线通过 register(kind, handler) 接入；handler 接收 RunContext。
- SSE：连接即发 run.status 快照（含队列位置与持久化进度）；排队期 5s 重发；
  终态事件（run.completed/failed/cancelled）后连接关闭。
- 取消：queued 即消（立即终态）；running 置协作中断标志，handler 检查后抛
  RunCancelledError；DB 终态迁移是"谁发布事件"的唯一裁决（幂等）。
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from .database import Repository
from .errors import ApiError

logger = logging.getLogger(__name__)

Handler = Callable[["RunContext"], Awaitable[str | None]]
TERMINAL_EVENTS = ("run.completed", "run.failed", "run.cancelled")


class RunCancelledError(Exception):
    """handler 内部协作取消信号。"""


class RunContext:
    """业务线 handler 的执行上下文：事件推送 / 进度上报 / 取消检查。"""

    def __init__(self, run_id: str, kind: str, manager: "RunManager"):
        self.run_id = run_id
        self.kind = kind
        self._manager = manager

    @property
    def cancelled(self) -> bool:
        return self.run_id in self._manager._cancelled

    def check_cancelled(self) -> None:
        if self.cancelled:
            raise RunCancelledError()

    async def emit(self, event: str, data: dict[str, Any] | None = None) -> None:
        await self._manager.publish(self.run_id, event, data or {})

    def report_progress(
        self,
        *,
        completed: int,
        total: int,
        stage: str,
        event: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """进度持久化（progress_json）+ 可选线级事件推送（如 tts.progress）。"""
        progress = {"completed": completed, "total": total, "stage": stage}
        self._manager.repo.set_run_progress(self.run_id, progress)
        if event:
            payload: dict[str, Any] = {"completed": completed, "total": total, "stage": stage}
            if extra:
                payload.update(extra)
            asyncio.get_running_loop().create_task(
                self._manager.publish(self.run_id, event, payload)
            )

    async def sleep(self, seconds: float) -> None:
        """分片睡眠（0.1s 粒度检查取消），供长等待 handler 使用。"""
        remaining = seconds
        while remaining > 0:
            self.check_cancelled()
            chunk = min(0.1, remaining)
            await asyncio.sleep(chunk)
            remaining -= chunk


class RunManager:
    def __init__(self, repo: Repository, *, max_pending: int = 8, audio_dir: Any = None):
        self.repo = repo
        self.max_pending = max_pending
        self.audio_dir = audio_dir  # Path：音频产物根目录（DATA_DIR/audio）
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._handlers: dict[str, Handler] = {}
        self._subscribers: dict[str, list[asyncio.Queue]] = {}
        self._cancelled: set[str] = set()
        self._started: set[str] = set()  # 已出队（含 running）的 run
        self._e2e_controls: dict[str, dict[str, Any]] = {}
        self._worker_task: asyncio.Task | None = None

    def arm_e2e_control(
        self,
        kind: str,
        *,
        delay_seconds: float = 0,
        failure_code: str | None = None,
        failure_message: str | None = None,
        result_patch: dict[str, Any] | None = None,
    ) -> None:
        """为下一次指定类型的 run 注入延迟/失败；只由 E2E 专用端点调用。"""
        if kind not in self._handlers:
            raise ApiError("RUN_KIND_UNKNOWN", f"未知任务类型: {kind}", 422)
        self._e2e_controls[kind] = {
            "delay_seconds": delay_seconds,
            "failure_code": failure_code,
            "failure_message": failure_message,
            "result_patch": result_patch or {},
        }

    # ---------------- 生命周期 ----------------

    def register(self, kind: str, handler: Handler) -> None:
        self._handlers[kind] = handler

    async def start(self) -> None:
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker(), name="run-worker")

    async def shutdown(self) -> None:
        # 不迁移运行中 run 的状态：留给下次启动 recover_stale_runs（RUN_INTERRUPTED）
        if self._worker_task is not None:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

    # ---------------- 提交与查询 ----------------

    async def enqueue(
        self,
        kind: str,
        conversation_id: str | None = None,
        *,
        result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if kind not in self._handlers:
            raise ApiError("RUN_KIND_UNKNOWN", f"未知任务类型: {kind}", 422)
        if self.repo.count_queued_runs() >= self.max_pending:
            raise ApiError(
                "RUN_QUEUE_FULL", f"任务队列已满（上限 {self.max_pending}），请稍后再试", 409
            )
        run = self.repo.create_run(kind, conversation_id, result=result)
        await self._queue.put(run["id"])
        return run

    def run_payload(self, run: dict[str, Any]) -> dict[str, Any]:
        return {
            "run_id": run["id"],
            "kind": run["kind"],
            "status": run["status"],
            "events_url": f"/api/runs/{run['id']}/events",
        }

    def active_run_id_for_conversation(self, conversation_id: str) -> str | None:
        return self.repo.active_run_for_conversation(conversation_id)

    # ---------------- SSE 事件总线 ----------------

    def subscribe(self, run_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(run_id, []).append(queue)
        return queue

    def unsubscribe(self, run_id: str, queue: asyncio.Queue) -> None:
        queues = self._subscribers.get(run_id)
        if queues and queue in queues:
            queues.remove(queue)
        if queues is not None and not queues:
            self._subscribers.pop(run_id, None)

    async def publish(self, run_id: str, event: str, data: dict[str, Any]) -> None:
        for queue in list(self._subscribers.get(run_id, [])):
            queue.put_nowait((event, data))

    def status_snapshot(self, run_id: str) -> dict[str, Any]:
        """run.status SSE 快照载荷（api-contract.md 11.1；终态附 artifact_id/error）。"""
        run = self.repo.get_run(run_id)
        payload: dict[str, Any] = {
            "status": run["status"],
            "queue_position": self.repo.queue_position(run_id),
            "progress": run["progress"],
        }
        if run["status"] == "completed":
            payload["artifact_id"] = run["artifact_id"]
        elif run["status"] == "failed":
            payload["error"] = {"code": run["error_code"], "message": run["error_message"]}
        return payload

    # ---------------- 取消 ----------------

    async def cancel(self, run_id: str) -> dict[str, Any]:
        run = self.repo.get_run(run_id)
        if run["status"] not in ("queued", "running"):
            raise ApiError("RUN_ALREADY_FINISHED", "任务已结束，无法取消", 409)
        self._cancelled.add(run_id)
        # queued 且尚未出队：立即终态迁移并广播（worker 出队时幂等跳过）
        if run["status"] == "queued" and run_id not in self._started:
            if self.repo.finish_run(run_id, "cancelled"):
                await self.publish(run_id, "run.cancelled", {})
        return {"run_id": run_id, "status": "cancelled"}

    # ---------------- worker ----------------

    async def _worker(self) -> None:
        while True:
            run_id = await self._queue.get()
            try:
                await self._process(run_id)
            except Exception:
                # worker 自身异常不应中断循环
                logger.exception("run %s 处理异常", run_id)
            finally:
                self._queue.task_done()

    async def _process(self, run_id: str) -> None:
        # 出队即登记；queued 期被取消的 run 在此幂等收口
        self._started.add(run_id)
        try:
            run = self.repo.get_run(run_id)
        except Exception:
            self._started.discard(run_id)
            return
        if run["status"] == "cancelled":
            self._cleanup(run_id)
            return
        if run_id in self._cancelled:
            if self.repo.finish_run(run_id, "cancelled"):
                await self.publish(run_id, "run.cancelled", {})
            self._cleanup(run_id)
            return

        if not self.repo.mark_run_running(run_id):
            # 与取消竞态：迁移失败说明已被终态化
            self._cleanup(run_id)
            return
        await self.publish(run_id, "run.started", {})

        handler = self._handlers.get(run["kind"])
        ctx = RunContext(run_id, run["kind"], self)
        try:
            if handler is None:
                raise ApiError("RUN_KIND_UNKNOWN", f"未知任务类型: {run['kind']}", 422)
            control = self._e2e_controls.pop(run["kind"], None)
            if control:
                delay_seconds = float(control.get("delay_seconds") or 0)
                if delay_seconds > 0:
                    await ctx.sleep(delay_seconds)
                result_patch = control.get("result_patch") or {}
                if result_patch:
                    current = self.repo.get_run(run_id).get("result") or {}
                    self.repo.set_run_result(run_id, {**current, **result_patch})
                if control.get("failure_code"):
                    raise ApiError(
                        str(control["failure_code"]),
                        str(control.get("failure_message") or "E2E 注入失败"),
                        502,
                    )
            artifact_id = await handler(ctx)
            if self.repo.finish_run(run_id, "completed", artifact_id=artifact_id):
                await self.publish(
                    run_id, "run.completed", {"artifact_id": artifact_id}
                )
            else:
                # handler 执行期间被取消：以取消收口
                if self.repo.finish_run(run_id, "cancelled"):
                    await self.publish(run_id, "run.cancelled", {})
        except RunCancelledError:
            if self.repo.finish_run(run_id, "cancelled"):
                await self.publish(run_id, "run.cancelled", {})
        except ApiError as exc:
            if self.repo.finish_run(
                run_id, "failed", error_code=exc.code, error_message=exc.message
            ):
                await self.publish(
                    run_id, "run.failed", {"code": exc.code, "message": exc.message}
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # 兜底：未知异常脱敏上报
            logger.exception("run %s handler 异常", run_id)
            if self.repo.finish_run(
                run_id,
                "failed",
                error_code="RUN_INTERNAL_ERROR",
                error_message="任务执行出错，请重试",
            ):
                await self.publish(
                    run_id,
                    "run.failed",
                    {"code": "RUN_INTERNAL_ERROR", "message": "任务执行出错，请重试"},
                )
        finally:
            self._cleanup(run_id)

    def _cleanup(self, run_id: str) -> None:
        self._started.discard(run_id)
        self._cancelled.discard(run_id)
