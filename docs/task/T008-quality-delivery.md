# T008：质量与交付（E2E 联调 + 部署验证）

## 1. 任务信息

- 状态：已完成（千问 LLM、火山 TTS 真实复核经确认延期）
- 优先级：P0
- 类型：正式任务 8/8
- 前置任务：T001–T007 全部
- 后续任务：无（一期交付）；二期 T101+（播客线）
- 目标目录：`frontend/e2e/`、`backend/scripts/`、根目录启动脚本
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（第 7、8 节）、`docs/tech/tech-design.md`（第 7–9 节）

## 2. 目标

全链路联调验收：E2E 主路径覆盖、真实服务 smoke 探针、生产构建与单进程部署验证、性能软目标核验、交付清单收口。

## 3. 行为基线

- E2E 在 FAKE_MODE 下跑主路径（不依赖真实 Key）；混音线用真实 FFmpeg。

## 4. 范围

### 4.1 必须实现

**E2E（Playwright，`frontend/e2e/`）**

- 主路径 A（冥想成品）：新建冥想会话 → 生成脚本 → 编辑 → 送 TTS → 合成（fake）→ 送混音 → 双轨混音导出（真实 FFmpeg）→ 产物库可见成品并播放。
- 主路径 B（纯音乐）：BGM 生成（fake + 真实后处理）→ 混音页仅选背景轨导出。
- 模块独立：TTS 粘贴文本直接合成；产物库 CRUD/送下游/清空。
- 运行态：排队（提交第二个任务断言 queued 与队列位置）、取消（运行中取消断言状态收口）。
- 恢复：生成运行中刷新页面 → 运行态恢复（run.status 快照）。
- 失败路径：契约测试注入的失败 run → 失败卡片 + 重试（BGM 两档重试 UI 分支）。

**smoke 探针（`backend/scripts/`，真实 Key，一次性验证）**

- `smoke_llm.py`：DeepSeek/千问真实流式生成一段脚本（标记齐全断言）。
- `smoke_tts.py`：双引擎真实合成短音频（连通复核；Qwen instruction 已验证）。
- `smoke_music.py`：MiniMax 真实生成 + 下载 + 后处理一次。

执行决策：本次完成 DeepSeek、阿里云 TTS、MiniMax 三条真实链路；千问 LLM 与火山 TTS 真实复核延期。

**部署验证（F6）**

- `pnpm build` → `SERVE_FRONTEND=true` 单进程 uvicorn 启动：
  - 静态资源 + SPA fallback（刷新深链路由不 404）。
  - `/api`、SSE（长连接流式无缓冲）、音频 Range（`<audio>` seek）经同源端口全部可用。
  - Vite dev proxy 与直连 8000 两种方式各验证一次 SSE 流式（tech-design 风险项）。
- 编写启动说明（README：`.env` 配置、ffmpeg 安装、启动命令）。

**性能软目标核验（PRD 第 7 节）**

- 真实 TTS：15 分钟脚本（30min 档取半）提交到可预览计时，记录实测值（软目标 ≤3min，超限不阻塞交付，记录为已知问题）。

### 4.2 不实现

- 真实 Key 的自动化 E2E（成本不可控）；Docker 化；性能压测。

## 5. 状态与数据流设计

不新增状态；本任务为验收收口。E2E 环境复用后端 FAKE_MODE 与 conftest 临时 DATA_DIR 机制（Playwright 经环境变量指向测试后端实例）。

## 6. 测试

- `pnpm e2e` 全量通过（FAKE_MODE 后端 + 真实 FFmpeg）。
- 三个 smoke 脚本真实跑通并留档输出。
- 全量 pytest + Vitest 通过；`pnpm build` 零告警。

## 7. 验收标准

- [x] E2E 主路径 A/B 绿色（含真实 FFmpeg 混音导出的文件存在性断言）。
- [x] 排队/取消/刷新恢复/失败重试四类运行态场景 E2E 覆盖。
- [x] 单进程部署：深链刷新、SSE 流式、音频 seek 全部经 8000 端口同源验证通过。
- [x] dev proxy 与直连两种 SSE 验证记录留档。
- [x] 三个 smoke 脚本输出留档（真实生成物路径与耗时；延期供应商见验收记录）。
- [x] README 启动说明完整（.env/ffmpeg/启动/常见错误）。

## 8. 验收记录

- 详细执行结果、部署时序、真实服务输出与性能已知问题：[`docs/ops/T008-quality-delivery-ops.md`](../ops/T008-quality-delivery-ops.md)。
- 性能软目标按确认复用 2026-08-30 历史真实记录；提交到完成 181.138 秒，超出 180 秒目标 1.138 秒，不阻塞交付。
