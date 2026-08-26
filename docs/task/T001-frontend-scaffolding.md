# T001：前端脚手架

## 1. 任务信息

- 状态：已完成
- 优先级：P0
- 类型：正式任务 1/8
- 前置任务：无
- 后续任务：T003、T004、T005、T006、T007
- 目标目录：`frontend/`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（第 6 节交互规范）、`docs/tech/tech-design.md`（第 6 节前端设计）、`docs/tech/api-contract.md`

## 2. 目标

搭建 React 前端工程：脚手架、路由骨架、暗色主题、API 层、通用 SSE hook、通用组件。完成后各业务任务（T003–T007）在其上填充页面。

## 3. 行为基线

- 视觉沿用原型暗色专业工具风（`prototype/css/main.css` 的色板/间距/圆角 tokens 迁移为 CSS 变量 + AntD theme token）。
- 路由结构与 tech-design 6.2 一致；handoff 语义 = 路由 query 参数。
- SSE 事件协议按 api-contract.md 第 11 节（契约锁定项）。

## 4. 范围

### 4.1 必须实现

**工程脚手架**

- Vite + React 19 + TypeScript（strict）+ ESLint（typescript-eslint + react-hooks）+ Prettier + pnpm。
- `vite.config.ts`：dev proxy `/api`、`/media` → `http://127.0.0.1:8000`。
- Vitest、Playwright 配置就绪（用例由后续任务补）。

**AppLayout 与路由**

- 全部 8 条路由注册（页面先用占位组件）：`/`、`/meditation`、`/meditation/:conversationId`、`/tts`、`/bgm`、`/mixdown`、`/library`、`/settings`。
- AppLayout：AntD Layout/Sider 侧边导航（首页/冥想/TTS/BGM/混音/产物库/设置），当前路由高亮；冥想工作台为专注模式布局（顶部返回）。
- 暗色主题：AntD ConfigProvider darkAlgorithm + 自定义 tokens；全局样式（`src/styles/`）。

**API 层（`src/api/`）**

- `client.ts`：fetch 封装、JSON 序列化、错误归一化 `ApiError{status, code, message}`（网络不可达 → `BACKEND_UNREACHABLE`）、AbortSignal 透传。
- `types.ts`：api-contract.md 全部端点的请求/响应 TS 类型（单一事实源，锚定契约测试）。
- 各领域模块文件骨架（conversations/tts/music/mixdown/artifacts/settings，函数后续任务填充）。

**SSE 通用 hook（`src/lib/sse.ts`）**

- `useRunStream(runId, handlers)`：EventSource 封装，按事件名分发；`run.completed/failed/cancelled` 后自动关连接；组件卸载清理。
- 支持排队期 `run.status` 重复推送（队列位置更新）。

**通用组件骨架**

- `StatusBanner/`（全局错误/提示，Zustand 全局 UI store 驱动）。
- `DurationSelect/`（5/10/15/20/25/30 分钟气泡选择）、`ModelSelect/`。
- Zustand store 骨架（全局 UI 态：错误提示、全局运行态）。

### 4.2 不实现

- 业务页面逻辑（T003–T007）；AudioPlayer/WaveformView/ScriptView/MessageList（随各线任务实现）。

## 5. 状态与数据流设计

```text
QueryClient（全局）
┌────────────────────────────┐
│ 默认 staleTime 30s；错误重试 1 次 │
└────────────────────────────┘
Zustand：uiStore（banner 消息队列） + runStore（全局 activeRuns 注册表，T002 联调后由各页接入）
```

## 6. 测试

- 自动化：Vitest——`client.ts` 错误归一化（网络/4xx/5xx/错误体解析）、`sse.ts` 事件分发与连接生命周期（mock EventSource）。
- 手工：`pnpm dev` 各路由可达、侧边栏高亮正确、暗色主题生效、lint/build 零错误。

## 7. 验收标准

- [x] `pnpm build`、`pnpm lint`、`pnpm test` 全部通过。
- [x] 8 条路由渲染占位页，AppLayout 高亮与专注模式布局正确。
- [x] 暗色主题视觉对齐原型（色板/侧边栏/卡片）。
- [x] client 单测覆盖错误归一化分支；sse hook 单测覆盖事件分发与自动关闭。
- [x] dev proxy 转发 `/api` 正确（用后端 health 端点或 404 兜底验证）。
