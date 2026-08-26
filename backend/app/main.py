"""应用工厂：lifespan（数据库/队列初始化与恢复）+ 通用端点 + SPA 托管。"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .artifacts import router as artifacts_router
from .config import Settings
from .conversations import make_script_handler, router as conversations_router
from .database import NotFoundError, Repository
from .demo import demo_handler, router as demo_router
from .errors import ApiError, api_error_handler, http_error_handler
from .llm.registry import ModelRegistry
from .runs import TERMINAL_EVENTS, RunManager
from .tts.routes import make_tts_handler, router as tts_router

logger = logging.getLogger(__name__)

SSE_HEARTBEAT_SECONDS = 5.0


class SPAStaticFiles(StaticFiles):
    """SPA fallback：非 /api 路径未命中时回退 index.html（深链刷新不 404）。"""

    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith("api"):
                raise
            return await super().get_response("index.html", scope)
        if response.status_code == 404 and not path.startswith("api"):
            response = await super().get_response("index.html", scope)
        return response


def _sse_chunk(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def create_app(*, settings: Settings | None = None, data_dir: Path | None = None) -> FastAPI:
    resolved_settings = settings or Settings()
    resolved_data_dir = Path(data_dir or resolved_settings.data_dir).resolve()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        audio_dir = resolved_data_dir / "audio"
        for sub in ("artifacts", "previews", "peaks"):
            (audio_dir / sub).mkdir(parents=True, exist_ok=True)
        repository = Repository(resolved_data_dir / "audio.sqlite3")
        repository.initialize()
        interrupted = repository.recover_stale_runs()
        if interrupted:
            logger.warning("启动恢复：%s 个遗留 run 标记为 RUN_INTERRUPTED", interrupted)
        manager = RunManager(repository, audio_dir=audio_dir)
        llm_registry = ModelRegistry(resolved_settings)
        manager.register("demo", demo_handler)
        manager.register(
            "script", make_script_handler(repository, resolved_settings, llm_registry)
        )
        manager.register(
            "tts", make_tts_handler(repository, resolved_settings, audio_dir)
        )
        await manager.start()
        application.state.settings = resolved_settings
        application.state.repository = repository
        application.state.runs = manager
        application.state.data_dir = resolved_data_dir
        application.state.audio_dir = audio_dir
        application.state.llm_registry = llm_registry
        try:
            yield
        finally:
            await manager.shutdown()

    application = FastAPI(
        title="Audio Studio", version="0.1.0", lifespan=lifespan
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Range"],
        expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
    )
    application.add_exception_handler(ApiError, api_error_handler)
    application.add_exception_handler(StarletteHTTPException, http_error_handler)

    @application.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, _exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"code": "VALIDATION_ERROR", "message": "请求参数校验失败"},
        )

    @application.exception_handler(NotFoundError)
    async def handle_not_found(_request: Request, exc: NotFoundError):
        return JSONResponse(
            status_code=404, content={"code": "NOT_FOUND", "message": str(exc)}
        )

    application.include_router(artifacts_router)
    application.include_router(conversations_router)
    application.include_router(demo_router)
    application.include_router(tts_router)

    # ---------------- 通用端点 ----------------

    @application.get("/api/health")
    async def health():
        return {"status": "ok", "version": application.version}

    @application.get("/api/stats")
    async def stats(request: Request):
        repo: Repository = request.app.state.repository
        manager: RunManager = request.app.state.runs
        result = repo.get_stats()
        result["active_runs"] = manager.repo.list_active_runs()
        return result

    # ---------------- run 端点 ----------------

    def _get_run_or_404(request: Request, run_id: str) -> dict[str, Any]:
        try:
            return request.app.state.repository.get_run(run_id)
        except NotFoundError:
            raise ApiError("RUN_NOT_FOUND", "运行不存在", 404) from None

    @application.get("/api/runs/{run_id}")
    async def get_run(run_id: str, request: Request):
        manager: RunManager = request.app.state.runs
        run = _get_run_or_404(request, run_id)
        error = None
        if run["status"] == "failed":
            error = {"code": run["error_code"], "message": run["error_message"]}
        return {
            "run_id": run["id"],
            "kind": run["kind"],
            "status": run["status"],
            "conversation_id": run["conversation_id"],
            "queue_position": manager.repo.queue_position(run_id),
            "progress": run["progress"],
            "artifact_id": run["artifact_id"],
            "error": error,
        }

    @application.post("/api/runs/{run_id}/cancel")
    async def cancel_run(run_id: str, request: Request):
        _get_run_or_404(request, run_id)
        manager: RunManager = request.app.state.runs
        return await manager.cancel(run_id)

    @application.get("/api/runs/{run_id}/events")
    async def run_events(run_id: str, request: Request):
        _get_run_or_404(request, run_id)
        manager: RunManager = request.app.state.runs

        async def stream():
            queue = manager.subscribe(run_id)
            try:
                # 连接即发快照（api-contract.md 11.1/11.3：终态直接收口）
                yield _sse_chunk("run.status", manager.status_snapshot(run_id))
                initial = manager.repo.get_run(run_id)
                if initial["status"] in ("completed", "failed", "cancelled"):
                    return
                while True:
                    try:
                        event, data = await asyncio.wait_for(
                            queue.get(), timeout=SSE_HEARTBEAT_SECONDS
                        )
                    except TimeoutError:
                        # 排队期 5s 重发 run.status（队列位置更新）
                        current = manager.repo.get_run(run_id)
                        if current["status"] == "queued":
                            yield _sse_chunk("run.status", manager.status_snapshot(run_id))
                        continue
                    yield _sse_chunk(event, data)
                    if event in TERMINAL_EVENTS:
                        return
            finally:
                manager.unsubscribe(run_id, queue)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------------- 生产托管 ----------------

    if resolved_settings.serve_frontend:
        dist_dir = Path(__file__).resolve().parents[2] / "frontend" / "dist"
        if dist_dir.is_dir():
            application.mount(
                "/", SPAStaticFiles(directory=dist_dir, html=True), name="frontend"
            )
        else:
            logger.warning(
                "SERVE_FRONTEND=true 但 %s 不存在，请先在 frontend/ 执行 pnpm build", dist_dir
            )

    return application


app = create_app()
