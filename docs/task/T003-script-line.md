# T003：剧本线·冥想（会话 + LLM 流式 + 工作台页）

## 1. 任务信息

- 状态：已完成（自动化测试全通过；FAKE_MODE 手工验收流程见 `docs/ops/T003-script-line-ops.md`）
- 优先级：P0
- 类型：正式任务 3/8
- 前置任务：T001、T002
- 后续任务：T004（脚本产物作为 TTS 输入）、T007（产物库编辑复用）
- 目标目录：`backend/app/script/`、`backend/app/llm/`、`backend/app/conversations.py`、`frontend/src/features/script-workspace/`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.1）、`docs/tech/tech-design.md`（5.5）、`docs/tech/api-contract.md`（第 4 节）、`docs/tech/data-model.md`

### 变更记录

- **v1.3（2026-08-26）：六档时长 + 可配置模型 ID**
  - 冥想脚本目标时长扩展为 `5/10/15/20/25/30` 分钟；保留原有 `5/15/30` 基准，并为新增档位采用平滑插值字数目标：10 分钟约 2200 字、20 分钟约 4200 字、25 分钟约 5100 字。
  - DeepSeek、通义千问、Kimi 的实际模型 ID 改由 `backend/.env` 中的 `DEEPSEEK_MODEL_ID`、`DASHSCOPE_MODEL_ID`、`MOONSHOT_MODEL_ID` 配置，缺省值保持现有模型不变，修改后重启后端生效。
  - 模型 ID 必须为非空且三家之间唯一；配置错误时阻止后端启动并明确指出配置字段，避免注册表静默覆盖。
  - 工作台模型下拉只显示当前实际模型 ID，不显示供应商名称；历史草稿保存的旧 ID 若已不可用，下一次生成回退到当前第一个可用模型，历史版本参数保持不变。

- **v1.2（2026-08-26）：工作草稿 + 用户手动版本**
  - 废止“每次 AI 生成原地覆盖会话脚本产物”的行为；会话仍保持至多一个逻辑脚本产物，但 AI 生成和人工编辑只更新可恢复的工作草稿。
  - 只有用户点击“保存脚本/保存新版本”才创建正式版本；首次保存要求输入脚本名称，后续保存追加不可变版本，不允许相同内容和参数重复保存。
  - 产物库只展示逻辑 artifact 及其当前版本快照；草稿与历史版本不作为独立产物。现有 `script_meditation` 产物在数据库初始化时幂等迁移为 v1。
  - 人工编辑草稿短延迟自动保存，明确提示“草稿已自动保存，但尚未保存为版本”；AI 新结果只在成功后原子替换旧草稿，失败/取消保留旧草稿。
  - 普通 AI 草稿可被下一轮生成直接替换；人工编辑或从历史恢复的未保存草稿，在继续对话前提供“先保存并继续 / 覆盖并继续 / 取消”。
  - 本期交付版本列表、只读查看和“恢复为草稿”；恢复不会改写历史版本，再次保存产生新的递增版本。

- **v1.1（2026-08-26）：LLM 多模型扩展（DeepSeek + Kimi + 通义千问）**
  - `app/llm/registry.py` 新增 Kimi（`kimi-k2-0905-preview`，Moonshot OpenAI 兼容接口，`MOONSHOT_API_KEY`）；三家共用既有 OpenAI 兼容流式实现，零新增依赖。
  - `GET /api/conversations/{id}/models` 契约变更（api-contract.md v1.1）：**仅返回已配置 Key 的可用模型**（`FAKE_MODE` 返回全量），移除 `available/reason` 字段；真实模式零配置返回空列表。
  - 前端 `ModelSelect` 下拉只展示接口返回的可用模型（移除禁用项分支）；工作台默认选中首个可用模型，历史产物 model 不可用时回退；零可用模型时禁用发送并提示。
  - 修复缺陷：`is_configured` 原不感知 `FAKE_MODE`，导致 FAKE_MODE 无 Key 时前端无法选择模型。
  - 发送接口 `SCRIPT_LLM_NOT_CONFIGURED` 校验保留，兜底页面加载后 Key 配置变化的情况。

## 2. 目标

实现冥想剧本完整链路：对话式工作台（多轮消息流）、LLM 流式生成带标记脚本、标记解析（segments/est_duration）、会话工作草稿、1:1 逻辑脚本产物与用户手动版本、编辑和版本恢复闭环。完成后冥想剧本功能与原型语义一致，并确保 AI 后续生成不会覆盖用户已确认的脚本版本。

## 3. 行为基线（继承原型已验收语义 + 决策 A1/A3/A4）

- 对话式交互同原型 meditation 页：消息流气泡、参数气泡（时长 5/10/15/20/25/30 + 模型）、生成步骤动画、AI 摘要气泡。
- 生成中禁用发送与参数切换；支持取消（丢弃临时内容）；失败展示失败卡片 + 重试。
- 会话至多对应一个逻辑脚本产物；AI 生成/人工编辑更新工作草稿，不修改已保存版本。
- 首次手动保存创建逻辑产物并要求输入名称；后续保存追加 v2/v3…，当前版本快照供产物库和下游读取。
- 工作草稿自动持久化但不属于产物库；生成失败/取消不改变旧草稿。
- 历史版本永久保留，不支持单独删除；删除逻辑产物时级联删除全部版本。
- 多轮 refinement：历史消息入上下文（预算内截断），支持"再温柔一些""缩短到 5 分钟"类指令。
- 标记解析在后端（唯一事实源）：前端只渲染 segments，不重复实现解析。
- 单次 LLM 调用 + 流式（A3，无 LangGraph）。

## 4. 范围

### 4.1 必须实现

**后端**

- `app/llm/registry.py`：ModelRegistry——DeepSeek + Kimi + 通义千问（OpenAI 兼容），流式；实际模型 ID 从三项 `*_MODEL_ID` 环境变量读取并校验非空、唯一；`GET /api/conversations/{id}/models` 端点。
- `app/script/prompts.py`：冥想 Prompt 模板——角色设定 + 标记规范（`[停顿 Ns]`/`[情绪:x]`/`[语速:x]`/`[吸气]`/`[呼气]`）+ 结构（引导→主体→收尾）+ 时长-篇幅映射（5/10/15/20/25/30min≈1200/2200/3200/4200/5100/6000 字，含停顿折算）。
- `app/script/markers.py`：标记解析器——text → `{segments[], est_duration}`（结构按 data-model.md 5.1；吸气 4s/呼气 5s）。
- `app/conversations.py`：api-contract.md 第 4 节全部端点（创建/列表/详情聚合/重命名/消息分页/发送/重试）+ 草稿更新/手动保存版本。
- `script_drafts`：会话 1:1 工作草稿，保存结构化 content、参数、来源 run、来源类型（generated/manual/restored）和递增 revision；使用 expected_revision 防止多标签页静默覆盖。
- `artifact_versions`：逻辑脚本产物 1:N 不可变版本；版本号单调递增，artifact 保留当前版本物化快照以兼容产物库和 TTS。
- run handler：组装上下文 → LLM 流式（`assistant.delta` 逐段推）→ 写 messages（`message.completed`）→ 成功后原子更新草稿（`script.draft.updated`）→ `run.completed{artifact_id:null}`。
- 初始化迁移：现有 `script_meditation` artifact 幂等补建 v1，并设置当前版本；名称、内容与参数保持不变。
- FAKE_MODE：内置示例冥想脚本（按 duration 档位）伪流式输出。

**前端**

- `/meditation` 会话列表页：列表（时间倒序）、新建、重命名、进入工作台。
- `/meditation/:conversationId` 工作台（专注模式）：
  - 聚合接口初始加载（conversation + script_draft + script_artifact/current_version + active_run_id 重连）。
  - `MessageList/`：用户/助手气泡分型、流式增量气泡、失败卡片（错误码映射文案 + 重试）。
  - 右侧/下方脚本结果区：以工作草稿为展示源；`ScriptView/` 标记徽章渲染（segments 结构化渲染）+ 时间轴条（语音/停顿分段着色 + est_duration）。
  - 参数气泡：DurationSelect（5/10/15/20/25/30 分钟）+ ModelSelect（只显示 `.env` 配置后的实际模型 ID，运行中锁定）。
  - 发送/取消/重试；409 互斥提示。
  - 编辑模式：textarea 短延迟自动保存工作草稿 → 后端重解析 → 徽章/时间轴刷新；显示保存中/已自动保存/失败状态。
  - 保存版本：首次保存弹窗要求脚本名称并创建 v1；草稿与当前版本一致时禁用；后续保存追加新版本。
  - 版本历史：结果区标题显示 `vN · 版本历史`；支持列表、只读查看、恢复为草稿，恢复后再次保存产生新版本。
  - 覆盖保护：manual/restored 草稿继续发送前弹三项选择（先保存并继续 / 覆盖并继续 / 取消）；generated 草稿直接进入下一轮。
  - 空态引导（新会话无脚本时）。

### 4.2 不实现

- 播客场景（scene=podcast 二期）；脚本产物删除/送下游入口（T007 产物库统一）；敏感词过滤（已砍）。

## 5. 状态与数据流设计

```text
Query: ['conversation', id] / ['messages', id] / ['models'] / ['script-versions', artifactId]
Mutation: sendMessage / retry / cancel / updateDraft / saveVersion / restoreVersion
Zustand(运行态): activeRunId / temporaryAssistantText(流式气泡)
事件: assistant.delta→临时气泡；message.completed→invalidate messages；
      script.draft.updated→刷新工作草稿；run.*→退出运行态
```

## 6. 测试

- 自动化（pytest）：markers 解析、六档时长参数、模型 ID 默认值/自定义值/非空唯一校验、conversations/草稿/版本契约、LLM fake 流式事件序列、失败/取消保留旧草稿、人工草稿 revision 冲突、首次保存命名、相同内容拒绝重复版本、版本追加/恢复、现有产物幂等迁移。
- 自动化（Vitest）：DurationSelect 六档选项、ModelSelect 只显示实际模型 ID、ScriptView、草稿保存状态、首次保存弹窗、重复保存禁用、三项覆盖保护、版本列表/查看/恢复、useRunStream `script.draft.updated` 分发。
- 手工（FAKE_MODE）：列表→新建→生成草稿→首次命名保存→人工编辑自动保存→保存新版本→继续生成→查看/恢复旧版本→刷新恢复 全流程。

## 7. 验收标准

- [ ] 会话列表/新建/重命名/进入正常；空主题禁用发送。
- [ ] 流式生成：气泡逐字增长；完成后脚本区徽章 + 时间轴 + 预估时长正确。
- [ ] 多轮 refinement 生效（改时长/语气指令，脚本内容相应变化）。
- [ ] 时长选择完整提供 5/10/15/20/25/30 分钟，六档均通过后端校验并使用对应篇幅目标。
- [ ] 三家模型 ID 可通过 `.env` 修改；空值或重复值阻止启动并指出字段；工作台下拉只显示实际模型 ID。
- [ ] AI 生成和人工编辑只更新可恢复草稿，不改变当前正式版本；失败/取消保留旧草稿。
- [ ] 首次保存必须命名并创建 v1；后续保存追加版本且 artifact id 不变；相同内容和参数不能重复保存。
- [ ] 人工编辑草稿自动保存并有清晰状态；继续生成前出现三项覆盖保护。
- [ ] 版本列表/只读查看/恢复为草稿完整；恢复后保存产生新版本而不重写历史。
- [ ] 现有脚本产物幂等迁移为 v1；产物库只展示逻辑 artifact 当前版本。
- [ ] 取消丢弃临时内容；失败卡片可重试；运行中参数锁定。
- [ ] 刷新页面恢复会话状态；active_run 重连 SSE 恢复运行态。
- [ ] 契约测试（第 4 节端点 + script 线事件）全部通过；控制台无错误。
