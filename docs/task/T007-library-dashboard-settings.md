# T007：产物库 + 首页 + 设置页

## 1. 任务信息

- 状态：进行中（T007-A 已实现，待验收；T007-B 待开始）
- 优先级：P0
- 类型：正式任务 7/8
- 前置任务：T002（artifacts CRUD 基座）；随 T003–T006 产物类型陆续接入
- 后续任务：T008
- 目标目录：T007-A 为 `frontend/src/features/{library,dashboard}/`；T007-B 为 `frontend/src/features/settings/`、`backend/app/settings.py`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.5/5.6/5.7）、`docs/tech/tech-design.md`（5.9）、`docs/tech/api-contract.md`（第 3、6、10 节）

### 1.1 交付拆分（2026-08-27 确认）

- **T007-A（当前交付）**：在 T005 BGM 阻塞、T006 随之阻塞期间，先实现受限版产物库与首页。只开放 `script_meditation` 和 `voice` 的展示与单项管理；BGM、混音统一标注“后续开放”。
- **T007-B（后续交付）**：补齐 BGM/mix 产物、完整下游闭环、清空全部、脚本历史版本恢复、设置状态与连通测试，以及完整全局运行态。
- 设置页在 T007-A 继续保持占位；TTS 人声的“送去混音”沿用既定 `/mixdown?voice_id=` 跳转语义，不在本阶段额外调整。

## 2. 目标

实现产物库（全类型管理 + 送下游流转）、首页概览（统计/最近产物/快速开始/全局运行态）、设置页（配置状态 + 连通测试）。完成后工作台各线产物形成完整管理闭环。

## 3. 行为基线（继承原型 library/home/settings 页语义 + 决策 D3）

- 产物库交互同原型：类型筛选 Tab、卡片（名称/类型徽章/参数摘要/生成时间）、详情弹层、重命名、删除确认、送下游（脚本→TTS、人声/背景→混音，跳转预选）、清空全部（确认）。
- 首页同原型：模块卡片入口、产物计数、最近 5 条、快速开始引导。
- 设置页只读（D3）：Key 掩码展示、测试连通按钮；编辑须改 `.env` 重启（页面文案说明）。

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

- `GET /api/settings/status`（后端 `app/settings.py`）：provider 配置卡（llm_deepseek/llm_qwen/llm_moonshot/tts_aliyun/tts_volc/minimax：configured 状态 + Key 掩码；三家 LLM 额外返回只读实际 model_id）+ ffmpeg/ffprobe（按 `FFMPEG_PATH` 或 PATH 探测版本/可用性）+ FAKE_MODE 状态。
- 每项「测试连通」（`POST /api/settings/probe/{provider}`）：loading + 结果（成功延迟/失败原因文案）。
- Key 编辑指引文案（改 `.env` 后重启生效）。
- 应用启动/设置状态探测负责暴露 FFmpeg 可用性，但不阻止无需 FFmpeg 的剧本功能启动；T006 混音提交端点仍须独立前置校验，避免启动后环境变化造成误判。

### 4.3 整体任务不实现

- 产物批量操作（多选删除）；产物标签/搜索；Key 界面编辑（D3 明确不做）。

## 5. 状态与数据流设计

```text
Query: ['artifacts', type?] / ['stats'] / ['settings-status']
Mutation: rename / delete / clearAll / probe
送下游 = navigate 路由 query（同各线 T003–T006 已实现的预选参数）
全局运行态: stats.active_runs → 侧边栏/首页徽标（30s 轮询或页面聚焦重取）
```

## 6. 测试

- 自动化（pytest）：settings status/probe 契约（掩码格式、LLM 实际 model_id、未配置 ok:false、probe 各 provider 分支 mock、`FFMPEG_PATH` 与 PATH 探测）、清空/删除联动（文件删除断言）。
- 自动化（Vitest）：Tab 过滤、卡片信息按类型正确渲染、送下游跳转参数、清空确认流程、设置卡状态与探测交互。
- 手工：四类产物入库后产物库全操作走查；删除 voice 后混音页下拉同步消失；probe 真实点击（已配置项）。

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

- [ ] BGM/mix 产物展示、参数摘要和完整下游流转。
- [ ] 清空全部及二次确认；脚本历史版本查看与恢复入口。
- [ ] 设置页状态卡与探测按钮；Key 掩码、实际 model_id、FFmpeg/ffprobe 与 FAKE_MODE 状态。
- [ ] 完整首页计数、最近产物和全局运行态。
