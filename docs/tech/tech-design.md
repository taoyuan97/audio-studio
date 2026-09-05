# 技术设计：Audio Studio 正式项目

## 1. 文档信息

- 版本：v2.3
- 状态：设计已确认、T012 已完成并通过自动化验收
- 创建日期：2026-08-26
- 变更记录：v2.3 增加 T012 混音分轨倍速：人声/背景独立 `atempo`、有效时长与成品时间轴规则、单轨增益一致性和预览边界
- 变更记录：v2.2 增加 T011 阿里云自定义音色库：SQLite 按模型持久化、设置页独立 Tab、试听验证状态、模型感知缓存与 TTS 模型快照一致性
- 变更记录：v2.1 完成 T006/T007 状态校准；首页移除快速开始，侧边栏增加分业务线运行态徽标，设置探测补齐本机 Origin 校验，真实 Provider 联调归入 T008
- 变更记录：v2.0 开放 MiniMax API Key 与模型 ID 的浏览器编辑、回显和清除；BGM defaults 与任务开始时快照读取运行时模型 ID
- 变更记录：v1.9 增加仅限浏览器运行时凭据的按字段回显；`.env`/MiniMax 禁止回显，火山 App ID 与 Token 独立展示
- 变更记录：v1.8 扩展 T007 设置线：五类服务凭据与模型参数支持浏览器持久化和免重启热生效；MiniMax Key 仍只读
- 变更记录：v1.7 增加 T009 冥想消息 Markdown/TXT 参考附件、SQLite 持久化及 LLM 上下文预算设计
- 变更记录：v1.6 按 MiniMax Music 3.0 官方能力校准 T005：取消正式 style 枚举、自由 prompt 为核心、structure_hints 降级为非确定性提示，并引入 Provider 中立适配边界与脱敏重试能力
- 变更记录：v1.5 记录阿里云真实验证结果：`qwen-audio-3.0-tts-plus` instruction=true、SSML=false、pitch=false，停顿改走本地静音；FFmpeg 9.0.1 安装并修复 Windows `ffprobe.exe` 同目录探测；火山鉴权验证延期
- 变更记录：v1.4 阿里云 TTS 与通义千问 LLM 配置隔离：新增 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`，禁止 TTS 回退读取 `DASHSCOPE_*`；设置状态展示 TTS 实际模型 ID
- 变更记录：v1.3 按当前代码校准 T002：SQLite 同步短连接、run handler 注册与 `RunContext`、API 实施状态；FFmpeg 启动/设置探测归 T007，混音错误映射归 T006
- 变更记录：v1.2 API 契约与数据模型拆分为独立文档（`api-contract.md` / `data-model.md`，实现级单一事实源），本文 5.2/5.4 改为摘要概览
- 变更记录：v1.1 吸收 meditation-guide-studio（`C:\projects\apps\meditation-guide-studio`）已验证实现——TTS 双引擎接入代码移植、情绪 instruction 映射定论、SSML break/静音切分双策略、音频落盘原子化规范、run 进度持久化、MiniMax 同步接口修正（E1）与计费安全重试（E8）、48kHz 基准（E2）、呼吸停顿 4s/5s（E4）
- 关联文档：`docs/prd/prd.md`（产品需求）、`docs/tech/api-contract.md`（API 契约·实现级）、`docs/tech/data-model.md`（数据模型·完整定义）、`docs/task/T001–T012`（任务拆分）
- 技术栈基准：`article-studio/docs/tech/tech-design.md`
- 交互基准：`prototype/`（已验收原型，前端功能语义来源）

## 2. 总体架构

### 2.1 架构图

```text
┌────────────────────────────────────────────────────────────┐
│                       浏览器（SPA）                        │
│  React 19 + Vite + TS + Ant Design 5                       │
│  TanStack Query（服务端状态） + Zustand（客户端状态）       │
│  React Router（首页/冥想会话列表/冥想工作台/TTS/BGM/        │
│               混音/产物库/设置）                            │
└───────────────┬────────────────────────────────────────────┘
                │ HTTP REST（JSON） + SSE（运行事件）
                │ 开发：Vite dev proxy → 127.0.0.1:8000
                │ 生产：同源（FastAPI 托管前端构建产物）
┌───────────────▼────────────────────────────────────────────┐
│                     FastAPI（单进程）                       │
│  app/                                                     │
│   ├─ conversations   剧本会话线（消息流 + LLM 流式）        │
│   ├─ tts             TTS 线（双引擎 Provider + 分段合成）   │
│   ├─ music           BGM 线（MiniMax 同步长调用 + 后处理）   │
│   ├─ mixdown         混音线（FFmpeg 子进程）                │
│   ├─ artifacts       产物库（含音频文件/波形峰值）          │
│   ├─ runs            全局串行队列 + SSE 事件总线            │
│   └─ settings        配置状态与连通性探测                   │
│                                                           │
│  LLM：DeepSeek / 通义千问 / Kimi（OpenAI 兼容，httpx 流式）    │
│  TTS Provider Registry：阿里云 DashScope / 火山引擎豆包     │
│  Music Provider：MiniMax Music（同步接口，长超时单次调用）    │
│  FFmpeg / ffprobe：本地子进程                               │
│  StaticFiles：生产模式托管 frontend/dist；音频走 API Range │
└───────┬────────────────────────────────────────────────────┘
        │
┌───────▼──────────────────┐  ┌─────────────────────────────┐
│ data/audio.sqlite3（业务库）│  │ data/audio/（音频文件）       │
│ conversations/messages/    │  │  artifacts/{id}.mp3|.wav    │
│ runs/artifacts             │  │  previews/（音色试听缓存）    │
└────────────────────────────┘  │  peaks/（波形峰值缓存 JSON） │
                                └─────────────────────────────┘
```

### 2.2 核心原则

1. **run 统一模型**：剧本/TTS/BGM/混音全部抽象为 run（排队→运行→终态），统一 SSE 事件协议，前端一套 hooks 通吃。
2. **全局串行队列**：同一时刻仅一个 run 运行（单机单用户），FIFO 排队，队列上限 8。
3. **原型为功能语义基准**：前端按原型已验收交互用 React 等价重写，不新增产品功能。
4. **单进程部署**：FastAPI 同时服务 API、SSE、音频文件与前端静态资源。

## 3. 已确认技术决策

| 决策项 | 结论 |
|---|---|
| 前端框架 | React 19 + Vite + TypeScript（strict） + Ant Design 5 |
| 服务端/客户端状态 | TanStack Query / Zustand（仅运行态与 UI 态） |
| 路由 | React Router（BrowserRouter） |
| 包管理器 | pnpm；后端 uv + pyproject.toml |
| 剧本交互（A1） | 对话式工作台：多轮消息流 + 流式生成（同 article-studio 文章线范式） |
| 剧本生成（A3） | 单次 LLM 调用 + 流式，**不用 LangGraph**；ModelRegistry 模式沿用（OpenAI 兼容 httpx 直连，无 LangChain 依赖） |
| 长任务协议（A2） | TTS/BGM/混音/剧本统一 run + SSE |
| 任务并发（C3） | 全局单任务串行队列（FIFO），队列上限 8 → 超出 409 `RUN_QUEUE_FULL` |
| 数据模型（A4 修订） | conversations/messages/message_attachments/runs/artifacts + script_drafts + artifact_versions + tts_custom_voices；会话至多一个逻辑脚本产物，AI/编辑写草稿，用户手动追加版本 |
| 存储（B1） | 本地 `data/audio/` 音频文件（StaticFiles 托管）+ SQLite 单库；放弃 OSS |
| TTS（B2） | 统一 `TTSProvider` 接口，阿里云 DashScope + 火山引擎双适配；阿里云真实链路已验证，火山待官方鉴权说明后验证 |
| 情绪标记（B3/E7） | 阿里云 `qwen-audio-3.0-tts-plus` 为默认模型，`[情绪:x]` → instruction 直传（已验证支持）；火山按 `TTSCapabilities` 能力声明降级为普通朗读；不引入 sambert 旧模型分支 |
| BGM（B4/E1） | MiniMax Music **同步接口**（`music_generation`，单次调用返回 `audio_url`，长超时 10min）：调用 → SSE 等待心跳 → 即下即存；失败不自动重试，重试区分「重新下载/重新生成」（E8） |
| 混音（B5） | 本地 FFmpeg（Windows 安装），Python 子进程封装；闪避仅模式 B（sidechaincompress），模式 A 删除 |
| 音频预览（B6） | `<audio>` 经 artifact API 流播放（HTTP Range）；16bit WAV 原生解析，其他格式经 ffmpeg 提取 PCM → 峰值 JSON（缓存） |
| 音色库（D4/T011） | 系统音色按模型维护；阿里云自定义音色由 SQLite 持久化并在设置页管理，TTS 页只合并当前模型音色；试听缓存包含模型身份 |
| 纯音乐（D2） | 并入 BGM 模块；混音页支持仅背景轨导出 |
| 闪避（D1） | 仅模式 B「人声时压低」，带开关；单轨组合自动失效 |
| API Key（D3，已修订） | `.env` 提供初始值，浏览器可为 DeepSeek/千问/Kimi/阿里云 TTS/火山 TTS/MiniMax 写入本机运行时覆盖并热生效；仅运行时覆盖可按字段回显，`.env` 凭据不可回显 |
| 范围裁剪（C1/C2） | 敏感词过滤、用量统计/预算告警砍掉 |
| 分期（C4） | 一期：冥想 + TTS + 混音（P0）、BGM（P1）；播客二期 |
| 生产部署 | FastAPI 托管 `frontend/dist`，单进程（uvicorn），`SERVE_FRONTEND` 开关 |
| 音频基准（E2/E3） | 全链路 48kHz 单一基准（TTS 原生输出档位，免重采样）；MP3 全线 320k（libmp3lame） |
| 呼吸停顿（E4） | `[吸气]` 4s / `[呼气]` 5s 静音（对齐真实冥想节奏，移植 meditation-guide-studio 量级） |
| 停顿风格档（E5） | 一期不引入 gentle/standard/deep 三档；停顿表做成后端可配置常量，二期再评估 |
| 剧本范式（E6） | 维持 `[停顿 5s]` 文本标记体系（可编辑、用户可见），不引入 ScriptPlan 结构化 JSON 范式 |
| 工程规范（借鉴） | 音频落盘 `.part` 临时文件 + `os.replace` 原子替换 + 每步 ffprobe 复验 + 采样率/声道一致性校验；run 进度持久化（SSE 重连可恢复）；明确不借鉴 Dify/Key 入库/并发 worker/前端轮询 |

## 4. 仓库与目录结构

以下为一期目标结构，不代表所有文件均已存在；当前 T001/T002/T003 已实现，`tts.py`、`music.py`、`mixdown.py`、`settings.py` 及对应前端业务模块随 T004–T007 落地。

```text
audio-studio/
├─ docs/
│  ├─ prd/prd.md
│  ├─ tech/tech-design.md
│  └─ task/T001…（任务拆分，后续创建）
├─ prototype/                 # 原型（冻结归档，不再开发）
├─ frontend/                  # 前端工程
│  ├─ index.html / package.json / pnpm-lock.yaml
│  ├─ vite.config.ts          # dev proxy：/api → 127.0.0.1:8000
│  ├─ tsconfig.json（strict）/ eslint.config.js / .prettierrc
│  ├─ playwright.config.ts
│  └─ src/
│     ├─ main.tsx / App.tsx   # 入口与路由表
│     ├─ api/                 # API 层（唯一 fetch 出口）
│     │  ├─ client.ts         # request 封装 + ApiError
│     │  ├─ types.ts          # 后端契约 TS 类型（单一事实源）
│     │  ├─ conversations.ts  # 剧本线
│     │  ├─ tts.ts / music.ts / mixdown.ts
│     │  ├─ artifacts.ts / settings.ts
│     ├─ lib/
│     │  ├─ sse.ts            # 通用 run SSE hook（useRunStream）
│     │  ├─ format.ts / queryClient.ts
│     ├─ stores/              # Zustand（运行态、全局提示）
│     ├─ layouts/AppLayout.tsx
│     ├─ pages/               # 路由级页面
│     │  ├─ DashboardPage.tsx
│     │  ├─ MeditationListPage.tsx
│     │  ├─ MeditationWorkspacePage.tsx
│     │  ├─ TtsPage.tsx / BgmPage.tsx / MixdownPage.tsx
│     │  ├─ LibraryPage.tsx / SettingsPage.tsx
│     ├─ features/            # 业务模块
│     │  ├─ script-workspace/ # 冥想工作台（二期播客复用）
│     │  ├─ tts/ bgm/ mixdown/ library/ settings/ dashboard/
│     ├─ components/
│     │  ├─ MessageList/      # 对话消息流（含失败卡片/重试）
│     │  ├─ ScriptView/       # 标记徽章渲染 + 时间轴条
│     │  ├─ AudioPlayer/      # 播放器 + 波形 Canvas
│     │  ├─ WaveformView/     # 波形（单轨/双轨叠加）
│     │  ├─ ModelSelect/ DurationSelect/ VoiceSelect/
│     │  └─ StatusBanner/
│     └─ styles/              # 暗色主题 tokens、全局样式
└─ backend/
   ├─ pyproject.toml / .env.example / .env
   ├─ scripts/
   │  ├─ smoke_llm.py         # LLM 真实流式探针
   │  ├─ smoke_tts.py         # 双 TTS 引擎连通探针（情绪支持度已由 meditation-guide-studio 验证）
   │  └─ smoke_music.py       # MiniMax 真实调用探针
   ├─ app/
   │  ├─ main.py              # 应用工厂 + 路由 + 静态托管 + SPA fallback
   │  ├─ config.py            # 环境变量 / DATA_DIR / FAKE_MODE
   │  ├─ database.py          # sqlite3 同步短连接 + WAL + 幂等迁移
   │  ├─ runs.py              # 全局串行队列 + run 生命周期 + SSE 事件总线
   │  ├─ conversations.py     # 会话/消息路由 + LLM 流式服务
   │  ├─ artifacts.py         # 产物 CRUD + 音频/峰值路由
   │  ├─ tts.py               # TTS 路由/服务 + 音色库 + 试听缓存
   │  ├─ music.py             # BGM 路由/服务（MiniMax 同步调用 + 后处理）
   │  ├─ mixdown.py           # 混音路由/服务
   │  ├─ settings.py          # 配置状态/探测路由
   │  ├─ peaks.py             # WAV 原生/FFmpeg PCM → 峰值 JSON（缓存）
   │  └─ ffmpeg.py            # ffmpeg/ffprobe 底层路径探测与子进程封装
   └─ tests/                  # pytest（契约测试 + 假模式全链路）
```

后端为**单 `app` 包**（无 article-studio 的 `*_agent` 二包结构——无 LangGraph，业务全为服务层）；LLM/标记解析等纯逻辑放 `app/script/`、`app/llm/` 子模块。

## 5. 后端设计

### 5.1 run 模型与全局串行队列

- `runs` 表：`id, kind(script|tts|music|mixdown), conversation_id?, status(queued|running|completed|failed|cancelled), progress_json(completed, total, stage —— 进度持久化，SSE 断线重连/刷新后可恢复), result_json(音乐线：远端 audio_url/expires_at，供「重新下载」免计费重试), error_code, error_message, artifact_id, created_at, started_at, finished_at`。
- 提交接口（各线 POST）创建 `queued` run 入 FIFO 队列 → 202 + run 载荷；队列长度 ≥ 8 → 409 `RUN_QUEUE_FULL`。
- 业务线通过 `RunManager.register(kind, handler)` 注册；提交使用 `enqueue(kind, conversation_id?)`，handler 通过 `RunContext.emit/report_progress/check_cancelled` 接入事件、持久化进度和协作取消。
- 单 worker 协程顺序执行：出队 → `running` → 执行线逻辑 → 终态（成功落 `artifact_id`）。
- 取消：queued → 直接 cancelled；running → 按线中断（LLM abort / TTS 停止下一段 / Music 中断等待 / FFmpeg kill），丢弃中间产物。
- SSE `GET /api/runs/{run_id}/events`：连接即发 `run.status`（当前状态 + 队列位置 + 已持久化的进度 `{completed, total, stage}`），随后按事件推送；`run.completed/failed/cancelled` 后关闭。

### 5.2 API 契约（概览，详见 [api-contract.md](api-contract.md)）

端点分组：通用（health/stats）、剧本线（conversations CRUD + messages 游标分页 + models）、run 三件套（状态查询/SSE/取消）、产物（list/detail/patch/delete/audio(Range)/peaks）、TTS 线（defaults/系统试听/jobs + 自定义音色 CRUD/验证/缓存播放）、BGM 线（defaults/jobs/retry 两档）、混音线（jobs）、设置（status/probe）。

关键约定：错误统一 `{code, message}`（脱敏）；长任务提交 202 + 同构 run 载荷 `{run_id, kind, status, events_url}`；消息游标分页。完整请求/响应示例、参数校验、错误码总表与前端处理建议见 **api-contract.md**（实现级，契约测试与 `types.ts` 的对接唯一基准）。

### 5.3 SSE 事件协议（概览，事件全表与时序详见 [api-contract.md](api-contract.md) 第 11 节）

统一入口 `GET /api/runs/{run_id}/events`，事件按 run.kind 分发：通用（`run.status` 连接快照含队列位置与持久化进度、`run.started/completed/failed/cancelled` 终态关闭）+ 各线事件（剧本：`assistant.delta`/`message.completed`/`script.draft.updated`；TTS：`tts.progress` 分段进度；BGM：`music.progress` 等待心跳；混音：`mix.progress` phase）。

### 5.4 数据存储（概览，详见 [data-model.md](data-model.md)）

SQLite 单库（WAL）：核心表 `conversations/messages/message_attachments/runs/artifacts`，剧本另有 `script_drafts` 工作草稿与 `artifact_versions` 不可变版本，TTS 另有 `tts_custom_voices` 按模型持久化音色库；消息附件正文仅供服务端 LLM 上下文使用，列表 API 只返回元数据；artifact 保存当前版本物化快照，后端 marker 解析仍是唯一事实源。

文件：`data/audio/artifacts/{id}.mp3|.wav`（音频产物）、`data/audio/previews/{engine}_{sha256(engine\0model\0voice_id)}.wav`（模型感知试听缓存）、`data/audio/peaks/{id}.json`（波形峰值缓存）；`DATA_DIR` 配置。自定义音色元数据保存在 `audio.sqlite3/tts_custom_voices`，不写入 `settings.json`。

ER 关系、DDL、四种产物类型 params_json/content_json 的完整字段定义、文件生命周期与清理规则见 **data-model.md**。

### 5.5 剧本线设计

- **`app/llm/registry.py`**：ModelRegistry（数据驱动注册表）——三家均 OpenAI 兼容 chat/completions + SSE 流式，httpx 直连实现（不引入 LangChain 重依赖）：
  - DeepSeek（`deepseek-chat`，`api.deepseek.com/v1`）
  - 通义千问（`qwen-plus`，DashScope OpenAI 兼容模式）
  - Kimi（`kimi-k2-0905-preview`，`api.moonshot.cn/v1`）
  - 模型列表**仅返回已配置 Key 的可用项**（`FAKE_MODE` 返回全量），前端下拉只展示可用模型；发送时后端仍校验 `SCRIPT_LLM_NOT_CONFIGURED` 作兜底；`FAKE_MODE` 时返回内置示例脚本的伪流。
  - 三家实际模型 ID 分别由 `DEEPSEEK_MODEL_ID`、`DASHSCOPE_MODEL_ID`、`MOONSHOT_MODEL_ID` 提供初始值，必须非空但允许跨 provider 重复；运行时覆盖保存后重建注册表，工作台下拉立即显示新模型 ID。历史消息/产物中的旧 ID 不迁移。
- **`app/script/prompts.py`**：冥想专用 Prompt 模板——角色设定 + 标记规范（`[停顿 Ns]`/`[情绪:x]`/`[语速:x]`/`[吸气]`/`[呼气]`）+ 结构要求（引导进入→主体→收尾）+ 时长-篇幅映射（5/10/15/20/25/30min≈1200/2200/3200/4200/5100/6000 字，含停顿折算）。
- **`app/script/markers.py`**：标记解析器（后端唯一事实源）——文本 → `segments[]`（`{kind: speech|pause, text?, emotion?, speed?, seconds?}`）+ 预估时长（语速档 × 字数 + 停顿求和）。生成完成与 PATCH 编辑时均执行，随产物存储，前端直接渲染徽章与时间轴，**不在 TS 重复实现解析**。
- **会话流**：POST messages → 同事务写用户消息与 `.md` / `.txt` 参考附件 → 组装多轮上下文 → LLM 流式 → `assistant.delta` → 完成后写 assistant message + 原子更新工作草稿 → `script.draft.updated`；只有用户手动保存才创建/更新逻辑 artifact 当前快照并追加版本。
- 多轮 refinement：历史消息全部入上下文（预算内截断），用户可自然语言微调。当前轮附件完整加入带不可信资料声明的 JSON 安全边界；历史正文优先占用 12000 字符预算，剩余预算按由近到远顺序加入历史附件并允许截断。

### 5.6 TTS 线设计

- **`app/tts/providers.py`**：`TTSProvider` 统一接口——`synthesize(text, {voice, speed, pitch, emotion}) -> WAV bytes`；实现**移植自 meditation-guide-studio（已验证代码）**：
  - `AliyunTTSProvider`：Qwen-TTS 只读取独立的 `ALIYUN_TTS_API_KEY`，默认模型来自 `ALIYUN_TTS_MODEL_ID`，不得回退读取千问 LLM 的 `DASHSCOPE_*`；同时允许调用方显式传入模型，用于预配置音色验证和执行不可变 TTS 快照。走 `/services/audio/tts/SpeechSynthesizer`，payload 含 `sample_rate/volume/rate/pitch/instruction/enable_ssml`，Bearer 鉴权，SSE 响应流式解析（逐行 `data:` → JSON event → 拼 `output.audio.data`）。不移植 sambert 旧分支（E7）。
  - `VolcTTSProvider`：`openspeech.bytedance.com` —— HMAC 签名换 access token（带缓存与过期刷新）→ HTTP 合成（`voice_type/speed_ratio/volume_ratio`），二进制 frame 解码。
- **`app/tts/capabilities.py`**：`TTSCapabilities` 能力声明（移植）——按 provider/model/voice 声明是否支持 instruction/SSML/pitch、SSML 最大停顿毫秒数、音色白名单；提交与合成计划构建时校验，不支持项自动降级。
- 默认 `qwen-audio-3.0-tts-plus` 真实验证能力：`supports_instruction=true`、`supports_ssml=false`、`supports_pitch=false`。向该模型发送 `enable_ssml + <break>` 会返回 `ret=416`，因此 `[停顿 Ns]` 必须切本地静音；前端音调滑块置灰。计划层仍保留未来 SSML 模型的 break 策略。
- **标记 → 合成计划（B3 定论）**：`markers.py` 解析结果 → 合成计划，停顿**双策略**：
  - 支持_SSML 的引擎：`[停顿 Ns]` → `<break time="Nms"/>` 内嵌文本交引擎渲染（自然停顿）；超过能力声明最大停顿毫秒数 → 切为独立静音段；
  - 不支持 SSML / 超长停顿：文本切分 + 独立静音段拼接。
  - `[吸气]` → 4s、`[呼气]` → 5s 静音（E4）；`[情绪:x]` → 阿里云 instruction 直传、火山降级为普通朗读；`[语速:x]` → 分段 rate。
- **分段合成与拼接**：逐段调用 Provider 取 WAV PCM → 与静音段按序拼接 → 统一 48kHz WAV 母带 → MP3（libmp3lame 320k，E2/E3）。段内超长再按句号切分。全程逐段推 `tts.progress` 并同步写 `runs.progress_json`，可中断。
- **音频落盘工程规范（移植）**：每段先落中间 WAV → `ffprobe` 复验采样率（48k）与声道一致性 → concat manifest 拼接 `.part` 临时文件 → `os.replace` 原子替换最终文件 → 再次 probe 复验时长；任一步失败清理临时文件，不落半成品。
- **系统音色库（D4）**：`app/tts/voices.py` 按模型维护系统音色；现有阿里云 `longanlingxin/longanlufeng` 只属于 `qwen-audio-3.0-tts-plus`，名称按官方修正为“龙安灵心/龙安鲁风”。火山继续使用既有白名单。场景预设只推荐当前模型实际存在的系统音色。
- **自定义音色库（T011）**：`tts_custom_voices` 保存 `engine/model/voice_id/name` 及验证状态，`(engine,model,voice_id)` 唯一。设置页允许为任意模型逐条预配置、重命名、试听验证和删除；TTS defaults 只合并当前 `ALIYUN_TTS_MODEL_ID` 对应记录。删除仅影响本地元数据和试听缓存，不调用阿里云远端删除接口。
- **试听与验证**：系统音色继续使用惰性试听；自定义音色通过显式 verify 操作维护 `unverified|verified|failed`、最近检查/成功时间和脱敏错误。普通试听命中缓存不调用 Provider；强制重新验证需前端费用确认。缓存键包含 engine/model/voice_id 并使用 SHA-256 文件名，`.part` 校验后原子替换，失败保留旧缓存。
- **任务一致性**：TTS 提交时从服务端解析并冻结 `model/voice_id/voice_name/voice_source`。handler 使用提交时模型和当前凭据，禁止在出队时用最新 `ALIYUN_TTS_MODEL_ID` 覆盖快照；配置重命名或删除不改写排队任务与历史产物。
- **来源**：`script_artifact_id`（取产物 text）或裸 `text`；来源为脚本产物时 scene 自动判定并记入 params 快照。

### 5.7 BGM 线设计

- **`app/music/provider.py` + `app/music/minimax.py`**：通用层使用 `prompt/target_duration/structure_hints/format`；MiniMax adapter 才映射运行时 `model`（默认 `music-3.0`）、`is_instrumental: true`、`lyrics_optimizer: false`、`stream: false`、`output_format: url`。同步单次 POST `/music_generation`，httpx 长超时 10min，响应含 `audio_url/request_id/时长/采样率`；**无 task_id 轮询**。
- **错误分类（移植）**：API Key 无效 / 限流 / 余额权限 / 内容审核 / 超时 / 参数错误 / 服务不可用 → 分类映射 `MusicServiceError`，透出差异化错误码与文案。
- **计费安全（E8，移植语义）**：生成失败**不自动重试**；`audio_url` 与 `expires_at` 落 `runs.result_json`——失败 run 的重试接口区分两档：
  - `retry=download`：URL 未过期 → 仅重新下载（免计费）；
  - `retry=regenerate`：无 URL 或已过期 → 重新调用生成（前端二次确认，`confirm_regenerate=true` 才放行）。
- **下载与后处理**：httpx 流式下载远端音频 → 源文件落盘 → 后处理（移植 `music_postprocessor` 逻辑）：目标时长校验 → 短则 FFmpeg 循环拼接、长则裁剪 → 首尾 fade in/out → 按格式导出（MP3 320k / WAV 48kHz，E2/E3）→ ffprobe 复验最终时长 → 原子落盘入库。
- 等待期 SSE 推 `music.progress`（`{phase: generating, waited_s}`，5s 心跳）；取消 = 中断等待/下载放弃结果（服务商侧计费可能已发生，文案说明）。
- 自由 prompt 为核心输入，不存在正式 style 枚举；`GET /api/music/defaults` 可下发只负责填充文本的 prompt_suggestions。structure_hints 当前转成自然语言提示，不向纯音乐请求发送仅含结构标签的伪歌词，也不承诺精确分段。
- `FAKE_MODE`：本地生成和弦占位音（`wave` 模块写 WAV，无额外依赖），后处理仍走真实 FFmpeg。

### 5.8 混音线设计（`app/ffmpeg.py` + `app/mixdown.py`）

- **职责边界**：T002 只提供 `find_ffmpeg/find_ffprobe/ffmpeg_version/run_ffmpeg` 底层工具；T006 在混音提交前按 `FFMPEG_PATH` 检查并映射脱敏后的 `MIX_FFMPEG_MISSING/MIX_FFMPEG_ERROR`；T007 负责启动/设置状态中的 ffmpeg、ffprobe 可用性与版本探测。
- **滤镜链**（人声+背景，分轨倍速均保持原音调）：
  ```text
  [voice] atempo=voice_speed → volume=voice_gain → aresample → 时间戳归零
  [bgm] atempo=bgm_speed → 按有效时长 aloop/循环填充或 atrim 截断
        → 时间戳归零 → adelay=offset → 截断到成品长度 → volume=bgm_gain → aresample
  ducking=on: sidechaincompress(变速后 voice 为 sidechain, 变速后 bgm 被压缩)  # 模式 B
  → amix / amerge → 输出
  ```
  分轨倍速范围 `0.5～2.0`、步长 `0.05`、默认 `1.0`；闪避参数默认 threshold≈0.03、ratio≈4、attack≈50ms、release≈400ms。
- **有效时长与组合规则**：`voice_effective_duration=voice_duration/voice_speed`，`bgm_effective_duration=bgm_duration/bgm_speed`。双轨成品以变速后人声长度为终点，背景按两个有效时长的比较结果循环或截断，`bgm_offset` 只延后背景起点、不延长成品；单轨输出为对应源时长除以对应倍速，且对应增益生效。单轨或 ducking=off 跳过 sidechain。
- **单轨与兼容性**：仅人声执行 `atempo + volume + aresample` 后重编码；仅背景执行对应滤镜后重编码，仅在 `bgm_speed=1.0`、`bgm_gain=100` 且输入输出格式一致时允许 stream copy。倍速省略时默认为 `1.0`；参数只进入 run/mix 产物快照，不修改源产物。
- **导出**：MP3（libmp3lame 320k）/ WAV（pcm_s16le 48kHz，E2）；中间与最终文件均按 5.6 落盘工程规范原子落盘 + ffprobe 复验，输出时长按有效时长复验。
- **波形峰值（B6）**：`peaks.py` —— 16bit WAV 用 Python `wave` 原生读取；MP3/其他格式用 ffmpeg 解码为 8kHz 单声道 PCM；随后分桶取最大幅度（≤1200 桶）并原子缓存于 `peaks/{id}.json`。`GET /api/artifacts/{id}/peaks` 命中缓存直接返回。双轨预览由前端分别取两轨 peaks，并按分轨有效时长和背景偏移绘制时间轴；本期不做浏览器实时混音或提交前同步试听。

### 5.9 设置线设计

- `SettingsStore` 是进程内配置单一入口：启动时合并默认值、`.env` 与 `DATA_DIR/settings.json`，优先级为运行时文件 > `.env` > 默认值；持久化采用同目录临时文件 + `os.replace` 原子替换。
- `GET /api/settings/status`：返回配置 revision、各 provider 的 configured/掩码/来源及可编辑模型参数，同时返回 ffmpeg/ffprobe、FAKE_MODE 等只读环境状态；任何响应均不含完整凭据。
- `PATCH /api/settings/providers/{provider}`：支持 `llm_deepseek|llm_qwen|llm_moonshot|tts_aliyun|tts_volc|minimax` 的凭据和模型参数更新；MiniMax 模型 ID 默认 `music-3.0`。密码字段未传表示保留，显式清除走独立 credentials 删除端点。
- `PATCH /api/settings/runtime`：更新 `llm_timeout_seconds`、`minimax_timeout_seconds`；其他本地环境参数不开放写入。
- `DELETE /api/settings/providers/{provider}/credentials`：删除浏览器运行时凭据覆盖；若 `.env` 有值则立即回退并在 status 中显示 `source=env`。
- `POST /api/settings/providers/{provider}/credentials/reveal`：以 revision + 单字段读取 `SettingsStore._overrides`，不读取合并后的 Settings，因而不会回退或泄露 `.env`；成功响应禁止缓存，并复用本机 Origin 校验。MiniMax 与其他单 Key provider 使用 `credential`，火山 App ID/Token 分字段请求，页面自动读取 App ID 不会同时下发 Token。
- 前端完整凭据只保存在 ProviderCard 组件状态：默认隐藏，点击显示；保存成功与卸载时释放，不进入 React Query/Web Storage/URL。MiniMax 使用标准密码输入并可编辑模型 ID；火山 App ID 为普通输入常显，Access Token 使用独立密码输入。
- 设置页顶层使用“模型与环境设置 / 音色配置”两个 Tab，交互参考产物库。前者承载既有 Provider、运行时和本地环境；后者管理 SQLite 自定义音色，并清楚标注模型绑定、试听费用和本地删除语义。TTS 页不提供音色 CRUD。
- 写接口携带 revision 做乐观并发控制；校验并原子落盘成功后才替换内存快照。保存和真实连通测试分离，探测失败不回滚配置。
- `POST /api/settings/probe/{provider}`：轻量真实探测——LLM（一次极短补全）、TTS（合成一句短音频即弃）、MiniMax（调用官方 `GET /v1/models`，不触发音乐生成计费）、ffmpeg（版本）。FAKE_MODE 不改变 probe 的真实探测语义。
- 免重启生效边界：一般任务在开始执行时读取最新设置；TTS 的模型与音色在提交时冻结、执行时仅读取最新凭据，防止排队期间切换模型造成错配。LLM registry 和 BGM handler 不得永久捕获启动时配置。
- 安全边界为绑定 `127.0.0.1` 的本机可信用户：写接口执行同源/Origin 校验，不在本任务引入登录鉴权；若未来开放局域网或公网访问，必须先增加管理员认证。

### 5.10 环境配置

以下环境变量作为初始值和运行时覆盖的回退值。浏览器可编辑项保存到 `DATA_DIR/settings.json` 后立即覆盖对应环境值；删除运行时覆盖则回退，无需重启。FFmpeg、DATA_DIR、FAKE_MODE、SERVE_FRONTEND 仍只能通过环境配置。

```dotenv
# LLM（剧本生成）
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=          # 仅用于通义千问 LLM
MOONSHOT_API_KEY=           # Kimi（api.moonshot.cn）
DEEPSEEK_MODEL_ID=deepseek-chat
DASHSCOPE_MODEL_ID=qwen-plus
MOONSHOT_MODEL_ID=kimi-k2-0905-preview

# 阿里云 TTS（与通义千问 LLM 配置隔离，不做 DASHSCOPE_* 回退）
ALIYUN_TTS_API_KEY=
ALIYUN_TTS_MODEL_ID=qwen-audio-3.0-tts-plus

# 火山引擎 TTS
VOLC_TTS_APP_ID=
VOLC_TTS_ACCESS_TOKEN=

# MiniMax Music
MINIMAX_API_KEY=
MINIMAX_MODEL_ID=music-3.0
MINIMAX_TIMEOUT_SECONDS=600    # 同步接口长超时（E1，典型 1–3 分钟，上限 10 分钟）

# 本地环境
DATA_DIR=data
FFMPEG_PATH=                # 可选；缺省从 PATH 探测
FAKE_MODE=false             # true：LLM 伪流 + TTS/BGM 本地占位合成（开发/测试）
SERVE_FRONTEND=true         # 生产托管 frontend/dist；开发置 false

# LLM 超时/重试（沿用 article-studio 参数风格）
LLM_TIMEOUT_SECONDS=120
```

### 5.11 假模式（FAKE_MODE）与测试基准

- LLM：内置示例冥想脚本按 duration 档位伪流式输出。
- TTS：`wave` + `struct` 生成分段正弦/静音 WAV（时长与文本长度成正比）。
- BGM：本地和弦占位音（按风格变调）。
- 混音：**始终走真实 FFmpeg**（本地依赖，无外部成本），假模式不替代。
- 契约测试：`tests/test_frontend_contract.py` 锁定 5.2 全部端点与 5.3 事件协议，作为前后端对接唯一基准。

## 6. 前端设计

### 6.1 工程脚手架

同 article-studio：Vite + React 19 + TS（strict）+ ESLint/Prettier + pnpm；业务请求统一通过 `vite.config.ts` 的 `/api` 代理到 `127.0.0.1:8000`。当前配置仍保留未使用的 `/media` 代理，但后端不提供该路由，业务代码不得依赖。

### 6.2 路由设计

| 路由 | 布局 | 页面 |
|---|---|---|
| `/` | AppLayout（侧边导航） | DashboardPage |
| `/meditation` | AppLayout | MeditationListPage（会话列表 + 新建） |
| `/meditation/:conversationId` | 专注模式（顶部返回） | MeditationWorkspacePage（对话式工作台） |
| `/tts` | AppLayout | TtsPage（`?artifact_id=` 预选脚本） |
| `/bgm` | AppLayout | BgmPage |
| `/mixdown` | AppLayout | MixdownPage（`?voice_id=&bgm_id=` 预选） |
| `/library` | AppLayout | LibraryPage |
| `/settings` | AppLayout | SettingsPage |

原型的 handoff 机制退化为路由 query 参数（SPA 内跳转自然携带）；二期新增 `/podcast`、`/podcast/:conversationId`。

### 6.3 数据层

- **TanStack Query**：会话/消息/草稿/版本/产物/defaults/stats 走 Query；发送、草稿自动保存、保存版本、恢复、取消、删除走 Mutation；`run.completed` / `script.draft.updated` 精确失效收口。
- **Zustand**：仅运行态（activeRunId、流式临时内容、队列状态）与全局 UI 态；不缓存服务端数据副本。
- **API 层**：`client.ts` 错误归一化 `ApiError{status, code, message}`（透出 5.2 错误码）；`types.ts` 与后端契约一一对应，手工维护（锚定契约测试）。

### 6.4 SSE 客户端（`lib/sse.ts`）

- 基于原生 `EventSource` 的**通用 `useRunStream(runId, handlers)`**：按事件名分发（`run.status/started/...` + 各线事件），组件卸载自动清理。
- `run.completed` / 终态后自动关连接；`onerror` 区分网络断开与 `CLOSED`。
- 页面重进且接口返回 `active_run_id` / run 状态查询恢复事件流（`run.status` 兜底恢复 UI）。

### 6.5 关键组件映射（原型 → React）

| 原型模块 | React 目标 |
|---|---|
| `js/common/layout.js` + `css/main.css` | `layouts/AppLayout.tsx`（AntD Layout/Sider） + 暗色主题 tokens |
| `js/common/store.js`（artifacts/handoff/settings） | `api/artifacts.ts`（服务端产物库）+ 路由 query（handoff）+ `api/settings.ts` |
| `js/common/mock.js` | 后端 defaults 接口（模型/引擎/音色/风格均为真实数据） |
| `js/common/audio.js`（Web Audio 引擎） | 删除——真实音频经 `AudioPlayer`（`<audio>` + Range）与 `WaveformView`（peaks JSON） |
| `js/pages/meditation.js` 对话区 | `features/script-workspace/`（MessageList + 流式 hook + 参数气泡） |
| 标记徽章/时间轴渲染 | `components/ScriptView/`（渲染后端 `segments[]`，不重复解析） |
| `js/pages/tts.js / bgm.js / mixdown.js` | `features/tts|bgm|mixdown/`（表单 + run 进度 + 结果区） |
| `js/pages/library.js` | `features/library/`（Tab 筛选 + 详情弹层 + 送下游） |
| `js/pages/settings.js` | `features/settings/`（状态卡 + 探测按钮） |

交互细节保留：时长/格式气泡设置（DurationSelect/FormatSelect）、语速音调滑块联动、场景预设联动、双轨波形叠放、闪避开关与说明文案、空态引导、清空确认。

### 6.6 安全渲染

- 脚本文本/错误信息一律文本节点渲染（React 默认转义）；`ScriptView` 徽章由解析段结构化生成，禁 `dangerouslySetInnerHTML`。
- 音频 URL 仅允许本服务 `/api/artifacts/{id}/audio`。

## 7. 开发工作流

```powershell
# 后端（终端 1）
cd backend
uv sync
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# 前端（终端 2）
cd frontend
pnpm install
pnpm dev            # http://localhost:5173，业务请求经 /api proxy 转发到 8000

# 测试
cd backend && uv run pytest -p no:cacheprovider
cd frontend && pnpm test        # Vitest
cd frontend && pnpm e2e         # Playwright（需后端运行，FAKE_MODE=true）

# 真实服务探针（实施期一次性验证）
uv run python scripts/smoke_tts.py --yes    # 双引擎真实连通（会产生少量调用费用）
uv run python scripts/smoke_llm.py
uv run python scripts/smoke_music.py  # MiniMax 同步调用 + 下载
```

## 8. 测试策略

| 层级 | 工具 | 范围 |
|---|---|---|
| 后端单元/契约 | pytest | markers 解析、合成计划、FFmpeg 滤镜链参数、串行队列/取消、5.2 全端点契约、SSE 事件序列 |
| 前端组件 | Vitest + Testing Library | ScriptView 徽章/时间轴、AudioPlayer、useRunStream 事件分发、表单联动 |
| E2E | Playwright | FAKE_MODE 下主路径：冥想生成→编辑→TTS→混音导出；BGM→混音（纯音乐）；产物库增删/送下游；排队/取消 |

混音线 E2E 用真实 FFmpeg（本地依赖）；TTS/BGM/LLM 用假模式，不依赖真实 Key。

## 9. 构建与部署

```powershell
cd frontend && pnpm build        # 产物 → frontend/dist
cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

- `SERVE_FRONTEND=true`：FastAPI 挂载 `dist` + SPA fallback（非 `/api` 深链未命中返回 `index.html`）。
- 音频不暴露 `/media` 静态目录；`GET /api/artifacts/{id}/audio` 自定义 Range 端点是唯一音频出口。
- 单进程服务 API、SSE、音频与前端；数据落本机 `DATA_DIR`。不做 Docker/云部署。

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| TTS 双引擎接入与情绪标记 | **部分消除**：阿里云真实 smoke、instruction、WAV/MP3、缓存与产物链路已验证；默认模型 SSML/pitch 已按真实结果关闭。火山鉴权形态缺少官方说明，真实验证延期 |
| MiniMax 同步调用超时/失败 | 长超时 10min + 分类错误码 + 等待心跳可取消；失败不自动重试（防重复计费），URL 落库支持免计费重新下载（E8） |
| 移植代码与新架构（run 队列/SSE）水土不服 | Provider 层保持纯函数式（输入参数 → 音频 bytes/URL），与 run 框架解耦；契约测试锁定行为 |
| FFmpeg 滤镜链（sidechaincompress/aloop）调参 | 契约测试锁参数拼装；实施期用固定样本音频人耳验收 ducking/循环/截断三态 |
| SSE 经 Vite proxy 流式兼容 | dev proxy 与直连各验证一次（同 article-studio） |
| 长任务排队体验（单队列串行） | `run.status` 携带队列位置；前端全局运行态提示（首页/侧边栏可见进行中任务） |
| 手工 TS 契约类型漂移 | 契约测试 + `types.ts` 锚定；后续可评估 openapi-typescript |
| Windows 下 ffmpeg 未安装 | T006 提交前检查并返回 `MIX_FFMPEG_MISSING`；T007 启动/设置状态探测与安装指引。peaks 配置透传缺口见 ISSUE-003 |

## 11. 任务拆分（概览，明细见 docs/task/）

| 任务 | 内容 | 依赖 |
|---|---|---|
| T001 | 前端脚手架：路由/AppLayout/暗色主题/API 层/useRunStream | — |
| T002 | 后端骨架：FastAPI/SQLite/run 串行队列 + SSE/FAKE_MODE/契约测试框架 | — |
| T003 | 剧本线·冥想：会话消息/LLM 流式/markers 解析/1:1 产物/工作台页 | T001, T002 |
| T004 | TTS 线：双 Provider（移植）/能力声明/SSML 双策略合成计划/分段拼接/音色库+试听/peaks/TTS 页 | T003（产物输入）|
| T005 | BGM 线：MiniMax 同步调用/错误分类/下载后处理（fade）/失败重试（E8）/BGM 页 | T002 |
| T006 | 混音线：FFmpeg 封装/滤镜链/导出/双轨波形/混音页 | T004, T005 |
| T007 | 产物库 + 首页 + 设置页 | T002（各线产物陆续接入） |
| T008 | E2E 联调与验收（FAKE_MODE 主路径 + 真实服务 smoke） | 全部 |
| T009 | 冥想消息 Markdown/TXT 参考附件：选择校验、持久化、Prompt 与重试 | T003 |
| T011 | 阿里云自定义音色库：按模型持久化、设置页管理、试听验证、TTS 合并选择 | T004、T007 |
| 二期 T101+ | 播客剧本线（scene=podcast，意图识别/润色模式），复用 T004/T006 | 一期完成 |

建议顺序：T001/T002 并行 → T003 → T004 → T005 → T006 → T007 → T008。B3 情绪支持度已由 meditation-guide-studio 验证，`smoke_tts.py` 仅作 T004 完工后的连通复核，不再阻塞开工。

当前实施状态：T001、T002、T003、T005、T006、T007、T009、T011 已完成；T004 阿里云技术验收通过、火山延期；T008 待开始。任务状态以各 `docs/task/T*.md` 为准。
