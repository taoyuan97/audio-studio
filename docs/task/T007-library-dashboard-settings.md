# T007：产物库 + 首页 + 设置页

## 1. 任务信息

- 状态：进行中（T007-A 已实现；T007-B 已完成可独立实施部分并通过自动化/浏览器验收，完整混音闭环等待 T006）
- 优先级：P0
- 类型：正式任务 7/8
- 前置任务：T002（artifacts CRUD 基座）；随 T003–T006 产物类型陆续接入
- 后续任务：T008
- 目标目录：T007-A 为 `frontend/src/features/{library,dashboard}/`；T007-B 为 `frontend/src/features/settings/`、`backend/app/settings.py`、`backend/app/config.py`（含 SettingsStore/动态配置改造）
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.5/5.6/5.7）、`docs/tech/tech-design.md`（5.9）、`docs/tech/api-contract.md`（第 3、6、10 节）

### 1.1 交付拆分（2026-08-27 确认）

- **T007-A（当前交付）**：在 T005 BGM 阻塞、T006 随之阻塞期间，先实现受限版产物库与首页。只开放 `script_meditation` 和 `voice` 的展示与单项管理；BGM、混音统一标注“后续开放”。
- **T007-B（后续交付）**：补齐 BGM/mix 产物、完整下游闭环、清空全部、脚本历史版本恢复、设置状态与连通测试，以及完整全局运行态。
- 设置页在 T007-A 继续保持占位；TTS 人声的“送去混音”沿用既定 `/mixdown?voice_id=` 跳转语义，不在本阶段额外调整。

### 1.2 设置范围修订（2026-08-30 确认）

- 不创建独立 T007-A 设置任务，继续在本文件的 T007-B 中实施和验收。
- 允许从浏览器写入 DeepSeek、通义千问、Kimi、阿里云 TTS、火山 TTS 的凭据；MiniMax API Key 暂不支持浏览器写入。
- 允许编辑上述 LLM/阿里云 TTS 的模型 ID，以及 LLM/MiniMax 超时参数；取消三家 LLM 模型 ID 互不重复限制，只保留非空校验。
- 浏览器保存后无需重启：已运行任务保持启动时快照，排队未执行任务及保存后新任务在开始执行时读取最新配置。
- 安全边界限定为绑定 `127.0.0.1` 的本机可信用户，本期不增加登录鉴权。
- 浏览器保存的凭据允许在设置页查看：默认隐藏，点击眼睛后按字段从后端读取；`.env` 凭据禁止回显。火山 TTS 的浏览器 App ID 直接显示，Access Token 默认隐藏并按需显示。

## 2. 目标

实现产物库（全类型管理 + 送下游流转）、首页概览（统计/最近产物/快速开始/全局运行态）、设置页（配置状态、浏览器编辑、免重启热生效、连通测试）。完成后工作台各线产物形成完整管理闭环，非开发者无需编辑 `.env` 即可管理受支持的模型配置。

## 3. 行为基线（继承原型 library/home/settings 页语义 + 修订后的决策 D3）

- 产物库交互同原型：类型筛选 Tab、卡片（名称/类型徽章/参数摘要/生成时间）、详情弹层、重命名、删除确认、送下游（脚本→TTS、人声/背景→混音，跳转预选）、清空全部（确认）。
- 首页同原型：模块卡片入口、产物计数、最近 5 条、快速开始引导。
- 设置页按 provider 展示配置状态、掩码、来源与可编辑参数；仅浏览器保存的凭据可按需回显，`.env` 与 MiniMax Key 不可回显。保存和测试连通分离，保存成功即热生效。

## 4. 分期范围

### 4.1 T007-A：当前实现范围

**产物库（`/library`）**

- Tab 保留全部 / 冥想脚本 / TTS 人声 / 背景音 / 成品；前端只请求并展示 `script_meditation`、`voice`，背景音与成品固定展示“后续开放”空状态。
- 冥想与 TTS 卡片展示名称、类型、参数摘要和生成时间。
- 详情弹层：冥想复用 `ScriptView`；TTS 复用 `AudioPlayer` + `WaveformView`；参数使用中文标签展示。
- 支持单项重命名、删除确认；不实现清空全部和脚本历史版本恢复。
- 冥想脚本送 TTS；TTS 人声保留送混音跳转语义。
- mutation 后失效 artifacts/stats 查询，保证 TTS 下拉、产物库与首页数据同步。

**首页（`/`）**

- 冥想、TTS、产物库为可用模块入口；BGM、混音标注“后续开放”且不可进入。
- stats 只呈现冥想脚本与 TTS 人声计数；最近产物和运行态过滤为 `script_meditation|voice`、`script|tts`。
- 最近产物点击进入产物库详情。

**设置页（`/settings`）**

- 继续保持占位，留待 T007-B。

### 4.2 T007-B：后续完整范围

**产物库（`/library`）**

- 类型 Tab：全部 / 冥想脚本 / 人声 / 背景音 / 成品（二期加播客脚本）。
- 卡片列表：名称、类型徽章、参数摘要（脚本=当前版本号/时长/模型；voice=引擎/音色/语速/时长；bgm=风格/时长；mix=轨道组合/时长/格式）、生成时间。
- 详情弹层：完整 params + content（脚本类展示当前版本并复用 ScriptView，提供版本历史查看/恢复为工作台草稿入口；音频类内嵌 AudioPlayer + 波形）。草稿与历史版本不作为独立产物卡片。
- 操作：重命名（PATCH name）、删除（确认弹窗；脚本级联删除全部版本，音频连带删除文件）、**送下游**（按 type 映射：script_*→`/tts?artifact_id=`；voice→`/mixdown?voice_id=`；bgm→`/mixdown?bgm_id=`）、清空全部（二次确认）。
- 空态引导（无产物时按类型引导去对应生成页）。
- 删除后列表与各下游页下拉同步（invalidate artifacts keys）。

**首页（`/`）**

- 模块卡片入口（冥想/TTS/BGM/混音/产物库）+ 简述。
- stats 聚合：产物计数、最近 5 条产物（点击进详情或对应页）、全局运行态（active_runs 徽标：进行中任务类型，点击跳对应页）。
- 快速开始引导文案：生成剧本 → TTS 人声 →（可选）背景音 → 混音导出。

**设置页（`/settings`）**

- `SettingsStore` 启动时合并默认值、`.env` 与 `DATA_DIR/settings.json`（运行时文件 > `.env` > 默认值），以配置快照和 revision 作为后端统一读取入口；写入采用同目录临时文件 + `os.replace`，校验/持久化失败不污染内存有效配置。
- `GET /api/settings/status`：provider 配置卡（`llm_deepseek|llm_qwen|llm_moonshot|tts_aliyun|tts_volc|minimax`）展示 configured、凭据掩码、`runtime|env` 来源、实际 model_id 与 editable；另展示可编辑 LLM/MiniMax 超时、只读 ffmpeg/ffprobe 和 FAKE_MODE。
- `PATCH /api/settings/providers/{provider}`：写入三家 LLM、阿里云 TTS、火山 TTS 的凭据与模型参数；凭据字段未传表示保留，status/PATCH/日志均不返回完整凭据，只有专用 reveal 接口可按下述边界返回运行时字段。
- `DELETE /api/settings/providers/{provider}/credentials`：二次确认后删除浏览器凭据覆盖；若 `.env` 存在则回退到环境值。MiniMax 不展示编辑/清除入口，后端也拒绝其 Key 写入。
- `POST /api/settings/providers/{provider}/credentials/reveal`：携带 revision 与单个字段名，只返回 `settings.json` 中对应的浏览器覆盖值；`.env`、MiniMax、未保存字段和 provider/字段错配均拒绝。响应 `Cache-Control: no-store`，并沿用本机 Origin 校验。
- 页面凭据默认隐藏，点击眼睛才请求并显示；修改保存成功后立即清空前端明文状态、恢复隐藏并刷新配置。火山 App ID 单独自动读取并明文展示，Access Token 单独点击显示；不写入 Web Storage、URL 或 Query 缓存。
- `PATCH /api/settings/runtime`：编辑 `llm_timeout_seconds`（1–600）与 `minimax_timeout_seconds`（30–1200）；FFmpeg、DATA_DIR、FAKE_MODE、SERVE_FRONTEND 等环境配置保持只读。
- 所有写接口携带 revision；冲突返回 409 并提示刷新，避免多个页面静默覆盖。保存成功后刷新 settings status、会话 models 与 TTS/BGM defaults 等相关查询。
- 每项「测试连通」（`POST /api/settings/probe/{provider}`）：保存与探测是独立动作，loading 后显示成功延迟/失败原因；探测失败不回滚配置。FAKE_MODE 下 probe 仍明确调用真实第三方服务。
- 配置热生效：LLM registry 与 TTS/BGM handler 改为在任务开始时获取 SettingsStore 最新快照；已运行任务不被中途切换，排队未执行任务使用实际开始时的新配置。
- 页面安全提示：仅供本机可信用户使用；写接口校验同源/Origin。项目继续绑定 `127.0.0.1`，不在本任务加入登录鉴权。
- 应用启动/设置状态探测负责暴露 FFmpeg 可用性，但不阻止无需 FFmpeg 的剧本功能启动；T006 混音提交端点仍须独立前置校验，避免启动后环境变化造成误判。

### 4.3 整体任务不实现

- 产物批量操作（多选删除）；产物标签/搜索。
- MiniMax API Key 浏览器编辑；FFmpeg/DATA_DIR/FAKE_MODE/SERVE_FRONTEND 浏览器编辑。
- 用户登录、管理员口令、凭据加密存储及局域网/公网开放；若未来放开非本机访问，须先另行设计认证。

## 5. 状态与数据流设计

```text
Query: ['artifacts', type?] / ['stats'] / ['settings-status']
Mutation: rename / delete / clearAll / updateProvider / clearCredentials / updateRuntime / probe
送下游 = navigate 路由 query（同各线 T003–T006 已实现的预选参数）
全局运行态: stats.active_runs → 侧边栏/首页徽标（30s 轮询或页面聚焦重取）

设置读取: defaults + .env + DATA_DIR/settings.json → SettingsStore snapshot/revision
设置写入: revision 校验 → 完整配置校验 → settings.json 原子替换 → 内存快照切换 → 相关 Query 失效
任务执行: 出队开始时读取快照；运行中任务保持既有快照
```

## 6. 测试

- 自动化（pytest）：settings status/probe/reveal 契约（掩码、来源、可回显字段、模型 ID、未配置、各 provider mock、`FFMPEG_PATH`/PATH）；运行时配置优先级、原子写失败回滚、重启持久化、凭据新增/替换/保留/清除/按字段回显、`.env` 与 MiniMax 回显拒绝、超时边界、revision 冲突及全链路脱敏。
- 自动化（pytest）：保存后 models/defaults 立即刷新；运行中任务保持旧快照、排队任务开始时读取新快照；三个 provider 使用相同模型 ID 合法。
- 自动化（Vitest）：Tab 过滤、卡片信息、送下游、清空确认；设置卡初始化、默认隐藏/点击显示/修改保存、火山字段独立处理、来源与掩码、清除/探测、revision 冲突、MiniMax Key 只读和相关 Query 失效。
- 手工：四类产物入库后产物库全操作走查；删除 voice 后混音页下拉同步消失；浏览器更新五类服务配置后不重启验证 defaults/模型列表与真实 probe；确认响应、日志和页面不泄露完整凭据。

## 7. 验收标准

### 7.1 T007-A

- [x] 五个 Tab 呈现正确；冥想/TTS 正常过滤，BGM/成品显示“后续开放”。
- [x] 冥想/TTS 卡片参数摘要与生成时间正确渲染。
- [x] 详情弹层复用脚本徽章、音频播放和波形组件。
- [x] 单项重命名/删除（含确认）可用并失效相关查询。
- [x] 冥想脚本送 TTS；TTS 人声沿用送混音路由语义。
- [x] 首页只展示当前开放能力的计数、最近产物和运行态。
- [x] 无产物、加载失败、BGM/混音后续开放空状态明确。

### 7.2 T007-B

- [x] 产物库支持 BGM/mix 展示、参数摘要及既定路由下游语义；BGM 页面已开放。实际 mix 生成与混音页仍等待 T006。
- [x] 清空全部及二次确认；脚本历史版本查看与恢复入口。
- [x] 设置页状态卡、配置来源、凭据掩码、实际 model_id、可编辑超时、FFmpeg/ffprobe 与 FAKE_MODE 状态完整呈现。
- [x] DeepSeek/千问/Kimi/阿里云 TTS/火山 TTS 凭据可在浏览器新增、查看、替换和清除；仅浏览器保存值可回显，`.env` 与 MiniMax Key 均不可回显或通过浏览器写入。
- [x] 凭据默认隐藏、点击眼睛显示，保存后恢复隐藏；火山 App ID 常显且 Access Token 独立隐藏/显示。
- [x] 配置持久化到 `DATA_DIR/settings.json`，优先级与回退正确，保存后无需重启并按任务开始时点热生效。
- [x] revision 冲突、字段校验、原子写失败均有明确反馈且不破坏旧配置；三家 LLM 模型 ID 允许重复。
- [x] 各 provider 真实探测接口与交互已实现，保存与探测互不绑定；本机同源安全边界和敏感信息脱敏通过验证。
- [x] 首页展示四类计数、最近产物、全局运行态与快速开始；混音入口按 T006 实际状态继续标注后续开放。

### 7.3 2026-08-30 实施验证

- 后端：`154 passed, 2 skipped`；跳过项为既有环境条件用例。
- 前端：Vitest `44 passed`；ESLint 通过；TypeScript + Vite 生产构建通过。
- 浏览器：设置、产物库、首页与 BGM 路由实机渲染通过；另以隔离的临时 DATA_DIR 验证 App ID 自动显示、Access Token/LLM 凭据独立点击显示、`.env` 无查看入口、修改保存后恢复隐藏，未发现 console error/warn，未调用真实 provider 或修改现有业务数据。
- 待外部依赖：T006 混音 API/页面未实现，因此 mix 产物只能兼容展示既有/未来数据，不能由当前工作台新生成。
