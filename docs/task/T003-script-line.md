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

- **v1.1（2026-08-26）：LLM 多模型扩展（DeepSeek + Kimi + 通义千问）**
  - `app/llm/registry.py` 新增 Kimi（`kimi-k2-0905-preview`，Moonshot OpenAI 兼容接口，`MOONSHOT_API_KEY`）；三家共用既有 OpenAI 兼容流式实现，零新增依赖。
  - `GET /api/conversations/{id}/models` 契约变更（api-contract.md v1.1）：**仅返回已配置 Key 的可用模型**（`FAKE_MODE` 返回全量），移除 `available/reason` 字段；真实模式零配置返回空列表。
  - 前端 `ModelSelect` 下拉只展示接口返回的可用模型（移除禁用项分支）；工作台默认选中首个可用模型，历史产物 model 不可用时回退；零可用模型时禁用发送并提示。
  - 修复缺陷：`is_configured` 原不感知 `FAKE_MODE`，导致 FAKE_MODE 无 Key 时前端无法选择模型。
  - 发送接口 `SCRIPT_LLM_NOT_CONFIGURED` 校验保留，兜底页面加载后 Key 配置变化的情况。

## 2. 目标

实现冥想剧本完整链路：对话式工作台（多轮消息流）、LLM 流式生成带标记脚本、标记解析（segments/est_duration）、会话 1:1 脚本产物原地更新、编辑闭环。完成后冥想剧本功能与原型等价（真实 LLM 替代 mock）。

## 3. 行为基线（继承原型已验收语义 + 决策 A1/A3/A4）

- 对话式交互同原型 meditation 页：消息流气泡、参数气泡（时长 5/15/30 + 模型）、生成步骤动画、AI 摘要气泡。
- 生成中禁用发送与参数切换；支持取消（丢弃临时内容）；失败展示失败卡片 + 重试。
- 会话 1:1 脚本产物：首次生成成功自动创建；再生成/编辑**原地更新**（无版本历史，A4）。
- 多轮 refinement：历史消息入上下文（预算内截断），支持"再温柔一些""缩短到 5 分钟"类指令。
- 标记解析在后端（唯一事实源）：前端只渲染 segments，不重复实现解析。
- 单次 LLM 调用 + 流式（A3，无 LangGraph）。

## 4. 范围

### 4.1 必须实现

**后端**

- `app/llm/registry.py`：ModelRegistry——DeepSeek（ChatDeepSeek）+ 通义千问（DashScope OpenAI 兼容），流式；`GET /api/conversations/{id}/models` 端点。
- `app/script/prompts.py`：冥想 Prompt 模板——角色设定 + 标记规范（`[停顿 Ns]`/`[情绪:x]`/`[语速:x]`/`[吸气]`/`[呼气]`）+ 结构（引导→主体→收尾）+ 时长-篇幅映射（5min≈1200 字/15min≈3200 字/30min≈6000 字，含停顿折算）。
- `app/script/markers.py`：标记解析器——text → `{segments[], est_duration}`（结构按 data-model.md 5.1；吸气 4s/呼气 5s）。
- `app/conversations.py`：api-contract.md 第 4 节全部端点（创建/列表/详情聚合/重命名/消息分页/发送/重试）。
- run handler：组装上下文 → LLM 流式（`assistant.delta` 逐段推）→ 写 messages（`message.completed`）→ 更新 1:1 脚本产物（`artifact.updated`）→ `run.completed`。
- FAKE_MODE：内置示例冥想脚本（按 duration 档位）伪流式输出。

**前端**

- `/meditation` 会话列表页：列表（时间倒序）、新建、重命名、进入工作台。
- `/meditation/:conversationId` 工作台（专注模式）：
  - 聚合接口初始加载（conversation + script_artifact + active_run_id 重连）。
  - `MessageList/`：用户/助手气泡分型、流式增量气泡、失败卡片（错误码映射文案 + 重试）。
  - 右侧/下方脚本结果区：`ScriptView/` 标记徽章渲染（segments 结构化渲染）+ 时间轴条（语音/停顿分段着色 + est_duration）。
  - 参数气泡：DurationSelect + ModelSelect（运行中锁定）。
  - 发送/取消/重试；409 互斥提示。
  - 编辑模式：textarea 切换 → PATCH content.text → 后端重解析返回 → 徽章/时间轴刷新（编辑闭环）。
  - 空态引导（新会话无脚本时）。

### 4.2 不实现

- 播客场景（scene=podcast 二期）；脚本产物删除/送下游入口（T007 产物库统一）；敏感词过滤（已砍）。

## 5. 状态与数据流设计

```text
Query: ['conversation', id] / ['messages', id] / ['models']
Mutation: sendMessage / retry / cancel / editScript(PATCH artifact)
Zustand(运行态): activeRunId / temporaryAssistantText(流式气泡)
事件: assistant.delta→临时气泡；message.completed→invalidate messages；
      artifact.updated→invalidate script_artifact；run.*→退出运行态
```

## 6. 测试

- 自动化（pytest）：markers 解析（全标记类型/组合/非法标记容错/est_duration 计算）、conversations 契约端点、LLM fake 流式 run 事件序列（delta 有序、completed 定稿、artifact 1:1 原地更新）、refinement 上下文组装、取消/失败路径。
- 自动化（Vitest）：ScriptView 徽章/时间轴渲染、useRunStream script 事件分发。
- 手工（FAKE_MODE）：列表→新建→生成→编辑→再生成→重进恢复 全流程。

## 7. 验收标准

- [ ] 会话列表/新建/重命名/进入正常；空主题禁用发送。
- [ ] 流式生成：气泡逐字增长；完成后脚本区徽章 + 时间轴 + 预估时长正确。
- [ ] 多轮 refinement 生效（改时长/语气指令，脚本内容相应变化）。
- [ ] 编辑保存后徽章/时长同步刷新；产物原地更新（id 不变）。
- [ ] 取消丢弃临时内容；失败卡片可重试；运行中参数锁定。
- [ ] 刷新页面恢复会话状态；active_run 重连 SSE 恢复运行态。
- [ ] 契约测试（第 4 节端点 + script 线事件）全部通过；控制台无错误。
