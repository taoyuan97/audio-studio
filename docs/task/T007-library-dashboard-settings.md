# T007：产物库 + 首页 + 设置页

## 1. 任务信息

- 状态：待开始
- 优先级：P0
- 类型：正式任务 7/8
- 前置任务：T002（artifacts CRUD 基座）；随 T003–T006 产物类型陆续接入
- 后续任务：T008
- 目标目录：`frontend/src/features/{library,dashboard,settings}/`、`backend/app/settings.py`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.5/5.6/5.7）、`docs/tech/tech-design.md`（5.9）、`docs/tech/api-contract.md`（第 3、6、10 节）

## 2. 目标

实现产物库（全类型管理 + 送下游流转）、首页概览（统计/最近产物/快速开始/全局运行态）、设置页（配置状态 + 连通测试）。完成后工作台各线产物形成完整管理闭环。

## 3. 行为基线（继承原型 library/home/settings 页语义 + 决策 D3）

- 产物库交互同原型：类型筛选 Tab、卡片（名称/类型徽章/参数摘要/生成时间）、详情弹层、重命名、删除确认、送下游（脚本→TTS、人声/背景→混音，跳转预选）、清空全部（确认）。
- 首页同原型：模块卡片入口、产物计数、最近 5 条、快速开始引导。
- 设置页只读（D3）：Key 掩码展示、测试连通按钮；编辑须改 `.env` 重启（页面文案说明）。

## 4. 范围

### 4.1 必须实现

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

- `GET /api/settings/status`（后端 `app/settings.py`）：provider 配置卡（llm_deepseek/llm_qwen/tts_aliyun/tts_volc/minimax：configured 状态 + Key 掩码）+ ffmpeg（版本/可用性）+ FAKE_MODE 状态。
- 每项「测试连通」（`POST /api/settings/probe/{provider}`）：loading + 结果（成功延迟/失败原因文案）。
- Key 编辑指引文案（改 `.env` 后重启生效）。

### 4.2 不实现

- 产物批量操作（多选删除）；产物标签/搜索；Key 界面编辑（D3 明确不做）。

## 5. 状态与数据流设计

```text
Query: ['artifacts', type?] / ['stats'] / ['settings-status']
Mutation: rename / delete / clearAll / probe
送下游 = navigate 路由 query（同各线 T003–T006 已实现的预选参数）
全局运行态: stats.active_runs → 侧边栏/首页徽标（30s 轮询或页面聚焦重取）
```

## 6. 测试

- 自动化（pytest）：settings status/probe 契约（掩码格式、未配置 ok:false、probe 各 provider 分支 mock）、清空/删除联动（文件删除断言）。
- 自动化（Vitest）：Tab 过滤、卡片信息按类型正确渲染、送下游跳转参数、清空确认流程、设置卡状态与探测交互。
- 手工：四类产物入库后产物库全操作走查；删除 voice 后混音页下拉同步消失；probe 真实点击（已配置项）。

## 7. 验收标准

- [ ] 五个 Tab 过滤正确；卡片参数摘要按类型完整。
- [ ] 详情弹层：脚本徽章渲染 + 音频播放均可用。
- [ ] 重命名/删除/清空（含确认）全通；删除后文件清理、下游下拉同步。
- [ ] 送下游跳转且目标页预选正确（三种类型 × 对应下游）。
- [ ] 首页计数/最近产物/运行态徽标准确；快速开始引导展示。
- [ ] 设置页状态卡与探测按钮全通；Key 掩码显示（如 `sk-***cdef`）；FFmpeg 不可用时显著提示。
- [ ] 空产物库时各空态引导正确；控制台无错误。
