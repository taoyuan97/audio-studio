# T002：后端骨架（run 队列 + SSE + 契约测试框架）

## 1. 任务信息

- 状态：待开始
- 优先级：P0
- 类型：正式任务 2/8
- 前置任务：无
- 后续任务：T003、T004、T005、T006、T007
- 目标目录：`backend/`
- 创建日期：2026-08-26
- 关联文档：`docs/tech/tech-design.md`（第 5 节后端设计）、`docs/tech/api-contract.md`、`docs/tech/data-model.md`

## 2. 目标

搭建 FastAPI 后端骨架：应用工厂、数据库层、**全局 run 串行队列与 SSE 事件总线**、通用端点（health/stats/run 三件套、artifacts CRUD）、FAKE_MODE 框架、契约测试基座。完成后各业务线（T003–T006）注册各自的 run handler 即可接入队列。

## 3. 行为基线

- run 状态机：`queued → running → completed|failed|cancelled`；全局单 worker 串行（C3），队列上限 8。
- SSE 协议按 api-contract.md 第 11 节逐字锁定（连接即发 `run.status`、终态关闭、心跳语义）。
- 服务重启：queued/running run 标记 failed（`RUN_INTERRUPTED`）。
- 错误响应统一 `{code, message}` 且脱敏。

## 4. 范围

### 4.1 必须实现

**工程与应用**

- uv + pyproject.toml（fastapi、uvicorn、httpx、python-dotenv 等）；`app/config.py` 读 `.env`（结构见 tech-design 5.10）。
- `app/main.py`：应用工厂 + 路由注册 + CORS（开发）+ `SERVE_FRONTEND` 静态托管 + SPA fallback。
- `app/database.py`：sqlite3 + 线程池执行（同 article-studio 模式，不用 ORM）、WAL、建表迁移（conversations/messages/runs/artifacts 四表，DDL 按 data-model.md 第 4 节）。

**run 框架（核心）**

- `app/runs.py`：
  - 提交入口 `enqueue(kind, conversation_id?, execute_coro_factory) -> run`（FIFO，≥8 → `RUN_QUEUE_FULL`）。
  - 单 worker 协程：出队 → running → 执行 → 终态写库。
  - 进度上报 API：`report_progress(run_id, {completed, total, stage})`（写 progress_json + SSE 推送）。
  - 取消：queued 即消；running 置中断标志（各线 handler 检查并清理）；FFmpeg kill 由各线实现。
  - SSE 端点 `GET /api/runs/{run_id}/events`：事件总线（asyncio.Queue 按订阅分发）、`run.status` 快照、排队期 5s 重发、终态关闭。
  - 启动恢复：扫描 queued/running → failed（RUN_INTERRUPTED）。

**通用端点**

- `GET /api/health`、`GET /api/stats`（api-contract.md 第 3 节）。
- `GET /api/runs/{run_id}`、`POST /api/runs/{run_id}/cancel`。
- artifacts CRUD：list/detail/patch/delete/audio（Range 支持）/peaks（含 `app/peaks.py` ffmpeg PCM → 峰值 JSON 缓存，供任意音频产物用）。
- `app/ffmpeg.py`：ffmpeg/ffprobe 子进程封装（超时、错误归一化 `MIX_FFMPEG_*`）、启动探测。

**FAKE_MODE 框架**

- config 开关透传；各线假实现由后续任务注册（本任务提供 fake run handler 示例：sleep + 进度上报，用于联调队列/SSE）。

**契约测试基座**

- `tests/test_frontend_contract.py`：按 api-contract.md 逐端点锁定（路径、方法、状态码、错误结构、run 载荷、SSE 事件名与载荷 key）；先覆盖本任务端点，各任务追加。
- `tests/conftest.py`：临时 DATA_DIR fixture、FAKE_MODE=true、ASGI 测试客户端、SSE 测试辅助。

### 4.2 不实现

- 业务线端点与逻辑（conversations/messages/tts/music/mixdown/settings——T003–T007）。
- 真实外部服务调用。

## 5. 状态与数据流设计

```text
API 请求 ──enqueue──→ FIFO queue ──→ worker 协程 ──execute──→ 线 handler
                        │                 │    ↑report_progress
                        │                 ▼    │
                     runs 表 ←────── 终态/进度写库
                        │
                        ├─→ SSE 事件总线 ──→ GET /api/runs/{id}/events
                        └─→ GET /api/runs/{id}（轮询兜底）
```

## 6. 测试

- 自动化（pytest）：队列上限 409、串行顺序、queued 取消即消、running 取消中断、SSE 事件序列（连接快照→started→…→终态关闭）、重启恢复 RUN_INTERRUPTED、artifacts CRUD + 音频 Range + peaks 缓存、错误结构脱敏。
- 手工：`uv run uvicorn app.main:app --reload` + curl 走通 run 全生命周期。

## 7. 验收标准

- [ ] 四表 DDL 与 data-model.md 一致；WAL 生效。
- [ ] 提交 fake run → SSE 按契约时序推送 → 终态关闭；刷新重连 `run.status` 恢复进度。
- [ ] 队列 8 上限、取消、重启恢复行为符合契约测试断言。
- [ ] artifacts CRUD/Range/peaks 契约测试通过（用临时生成 WAV 验证）。
- [ ] `SERVE_FRONTEND=true` 时静态托管 + SPA fallback 可用（用占位 index.html 验证）。
- [ ] 全量 pytest 通过；错误信息无 Key/路径泄漏。
