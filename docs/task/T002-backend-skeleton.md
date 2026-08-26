# T002：后端骨架（run 队列 + SSE + 契约测试框架）

## 1. 任务信息

- 状态：已完成（T002 自动化验收已覆盖；当前数据库与产物契约已由 T003 继续扩展）
- 优先级：P0
- 类型：正式任务 2/8
- 前置任务：无
- 后续任务：T003、T004、T005、T006、T007
- 目标目录：`backend/`
- 创建日期：2026-08-26
- 关联文档：`docs/tech/tech-design.md`（第 5 节后端设计）、`docs/tech/api-contract.md`、`docs/tech/data-model.md`

### 变更记录

- **v1.1（2026-08-26）：按当前实现校准任务基线**
  - T002 核心骨架已完成：FastAPI 应用工厂、SQLite/WAL、全局串行 run 队列、SSE、通用端点、artifacts 基座、FAKE_MODE demo 和契约测试。
  - 数据库实际采用 sqlite3 同步短连接，不使用显式线程池；T002 建立核心四表，T003 后续增加 `script_drafts`、`artifact_versions` 及脚本版本迁移。
  - run 扩展接口以 `register(kind, handler)` + `enqueue(kind, conversation_id?)` 为准，业务 handler 通过 `RunContext` 上报事件、进度与协作取消。
  - 脚本正文 PATCH 已由 T003 收紧为“草稿 + 手动版本”链路；T002 保留产物查询、重命名、删除、音频 Range 与 peaks 基座。
  - T002 只提供 FFmpeg/ffprobe 底层探测和执行工具；启动/设置状态探测归 T007，混音提交前检查及 `MIX_FFMPEG_*` 业务错误映射归 T006。

## 2. 目标

搭建 FastAPI 后端骨架：应用工厂、数据库层、**全局 run 串行队列与 SSE 事件总线**、通用端点（health/stats/run 三件套、artifacts 基座）、FAKE_MODE 框架、契约测试基座。各业务线（T003–T006）通过注册各自的 run handler 接入队列。

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
- `app/database.py`：sqlite3 同步短连接（本地单机、短事务，不用 ORM）+ WAL + `busy_timeout`；T002 初始化 conversations/messages/runs/artifacts 核心四表，当前完整六表及幂等迁移以 data-model.md 和 `app/database.py` 为准。

**run 框架（核心）**

- `app/runs.py`：
  - 扩展入口 `register(kind, handler)`；提交入口 `enqueue(kind, conversation_id?) -> run`（FIFO，queued 数量 ≥8 → `RUN_QUEUE_FULL`）。
  - 单 worker 协程：出队 → running → 执行 → 终态写库。
  - handler 上下文 `RunContext`：`emit(...)` 推送线级事件，`report_progress(...)` 写 progress_json 并可推送 SSE，`check_cancelled()/sleep()` 提供协作取消。
  - 取消：queued 立即落库为 cancelled，队列中遗留 ID 由 worker 出队时幂等跳过；running 设置中断标志，由 handler 协作检查并清理；FFmpeg 子进程中断由 T006 实现。
  - SSE 端点 `GET /api/runs/{run_id}/events`：事件总线（asyncio.Queue 按订阅分发）、`run.status` 快照、排队期 5s 重发、终态关闭。
  - 启动恢复：扫描 queued/running → failed（RUN_INTERRUPTED）。

**通用端点**

- `GET /api/health`、`GET /api/stats`（api-contract.md 第 3 节）。
- `GET /api/runs/{run_id}`、`POST /api/runs/{run_id}/cancel`。
- artifacts 基座：list/detail/patch name/delete/audio（Range 支持）/peaks；T003 追加脚本版本列表与恢复，并禁止绕过草稿/版本链路直接 PATCH 脚本正文。
- `app/peaks.py`：16bit WAV 原生解码；MP3/其他格式经 ffmpeg 解码 PCM，峰值 JSON 原子缓存。
- `app/ffmpeg.py`：提供 ffmpeg/ffprobe 路径查找、版本读取和子进程执行的底层工具。启动/设置状态探测归 T007；混音业务错误码、脱敏与提交前检查归 T006。当前 peaks 的 `FFMPEG_PATH` 透传及底层错误脱敏缺口见 `docs/issue/ISSUE-003-ffmpeg-peaks-config-and-errors.md`。

**FAKE_MODE 框架**

- config 开关透传；各线假实现由后续任务注册（本任务提供 fake run handler 示例：sleep + 进度上报，用于联调队列/SSE）。

**契约测试基座**

- `tests/test_frontend_contract.py`：按 api-contract.md 逐端点锁定（路径、方法、状态码、错误结构、run 载荷、SSE 事件名与载荷 key）；先覆盖本任务端点，各任务追加。
- `tests/conftest.py`：临时 DATA_DIR fixture、FAKE_MODE=true、ASGI 测试客户端及测试产物辅助；run 轮询/SSE 解析辅助当前就近定义在 `test_runs.py`。

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

- 自动化（pytest）：队列上限 409、串行顺序、queued 立即终态、running 协作取消、SSE 事件序列（连接快照→started→…→终态关闭）、重启恢复 RUN_INTERRUPTED、artifacts 基座 + 音频 Range + peaks 缓存、错误结构与未知 run 异常脱敏。
- 手工：`uv run uvicorn app.main:app --reload` + curl 走通 run 全生命周期。

## 7. 验收标准

- [x] T002 核心四表初始化与 WAL 生效；当前完整 schema 与幂等迁移由 data-model.md/`app/database.py` 锁定。
- [x] 提交 fake run → SSE 按契约时序推送 → 终态关闭；刷新重连 `run.status` 恢复进度。
- [x] queued 上限 8、取消、重启恢复行为符合契约测试断言。
- [x] artifacts 基座/Range/peaks 契约测试通过（临时 WAV 验证）。
- [x] `SERVE_FRONTEND=true` 所用静态托管 + SPA fallback 组件可用（占位 index.html 验证）。
- [x] T002 自动化测试通过；业务错误统一为 `{code,message}`，未知 run handler 异常脱敏。
