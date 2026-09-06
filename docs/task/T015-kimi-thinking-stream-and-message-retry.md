# T015：Kimi 思考模式、流式协议兼容与失败消息重试一致性

## 1. 任务信息

- 状态：已完成并通过自动化与真实 Kimi 人工验收
- 优先级：P0
- 类型：冥想脚本生成与设置页可靠性修复
- 前置任务：T003（脚本生成与失败重试）、T007（浏览器设置与热更新）、T009（消息附件与重试复用）
- 后续任务：Kimi 思考过程的可选展示与持久化能力（本期不实施）
- 目标目录：`backend/app/llm/`、`backend/app/config.py`、`backend/app/settings.py`、`backend/app/conversations.py`、`backend/tests/`、`frontend/src/pages/SettingsPage.tsx`、`frontend/src/pages/MeditationWorkspacePage.tsx`、`frontend/src/features/script-workspace/`、`frontend/src/api/`、`frontend/src/styles/`、`docs/tech/`
- 创建日期：2026-09-06
- 关联文档：`docs/tech/tech-design.md`、`docs/tech/api-contract.md`、`docs/tech/data-model.md`、`docs/task/T003-script-line.md`、`docs/task/T007-library-dashboard-settings.md`、`docs/task/T009-meditation-message-attachments.md`
- 官方依据：[Kimi API 概述](https://platform.kimi.com/docs/api/overview)、[模型参数参考](https://platform.kimi.com/docs/api/models-overview)、[Chat Completions API](https://platform.kimi.com/docs/api/chat)、[Kimi K2.6](https://platform.kimi.com/docs/guide/kimi-k2-6-quickstart)、[流式输出](https://platform.kimi.com/docs/guide/utilize-the-streaming-output-feature-of-kimi-api)、[错误说明](https://platform.kimi.com/docs/api/errors)

## 2. 背景与用户现象

用户在冥想工作台把模型切换为 `kimi-k2.6` 后发送消息，任务进入失败态，页面显示：

```text
生成失败
模型调用失败，请稍后重试。
```

随后点击失败卡片的“重试”，浏览器控制台出现：

```text
POST /api/conversations/{conversation_id}/messages/{message_id}/retry 409 Conflict
```

本地运行记录确认同一会话的两次 Kimi 任务均收到 Moonshot HTTP 400：

```text
run_1788661732396_5c277a  SCRIPT_LLM_ERROR  moonshot 返回 400
run_1788661788424_bc6270  SCRIPT_LLM_ERROR  moonshot 返回 400
```

该会话随后存在两条内容相同的用户消息：

```text
msg_1788661732366_c8826e  较早消息
msg_1788661788391_a82edd  最新消息
```

控制台中的 retry 请求仍使用较早消息 ID。后端只允许重试最新一条用户消息，因此按现有保护规则返回 409 `MESSAGE_NOT_RETRYABLE`。

本任务同时解决两个串联问题：

1. Kimi K2.6 请求参数不符合官方约束，导致真实生成首先失败。
2. 发送成功入库后前端消息缓存没有同步，失败重试可能继续引用旧消息，产生次生 409。

## 3. 根因与官方协议结论

### 3.1 Kimi K2.6 拒绝共享请求体中的温度值

当前 `ModelRegistry` 让 DeepSeek、通义千问和 Moonshot 共用同一套 OpenAI Chat Completions 请求体，并固定发送：

```json
{
  "stream": true,
  "temperature": 0.8
}
```

Kimi 官方参数约束为：

- `kimi-k2.6` 思考模式的温度固定为 `1.0`。
- `kimi-k2.6` 非思考模式的温度固定为 `0.6`。
- 对 K2.5/K2.6 显式传入其他温度会返回 `invalid_request_error`。
- 官方建议调用这些模型时不要显式传入 `temperature`。

因此当前固定的 `temperature: 0.8` 是本次 Moonshot HTTP 400 的直接根因。

### 3.2 思考模式具有独立的请求与响应字段

K2.5/K2.6 通过请求体中的 `thinking` 控制思考模式：

```json
{"thinking": {"type": "enabled"}}
```

或：

```json
{"thinking": {"type": "disabled"}}
```

思考开启时，流式响应先返回 `delta.reasoning_content`，之后才返回 `delta.content`。当前解析器只提取 `content`，不会把推理内容误写为脚本，但也不会把只有 `reasoning_content` 的数据块交还给业务 handler；长时间思考期间，handler 因此无法按分片检查任务取消状态。

### 3.3 当前流式结束判定不完整

官方要求以 `data: [DONE]` 判断一条流式消息是否完整。当前实现遇到 `[DONE]` 会正常返回，但上游连接提前 EOF 时也会自然结束；只要此前已有部分正文，业务层仍可能把残缺内容保存为 assistant 消息和脚本草稿。

### 3.4 前端失败路径使用过期消息缓存

发送接口在后端插入 user 消息后返回 run 信息。前端进入运行态，但没有立即刷新 `['messages', conversationId]`：

- 成功路径仅在 `message.completed` 时刷新消息列表。
- `run.failed` 只保存失败信息并退出运行态，不刷新消息列表。
- `handleRetry` 从当前 React Query 缓存计算 `lastUserMessage`。

当新提交已经入库、前端缓存仍停留在上一轮时，retry URL 会携带旧消息 ID。后端数据库看到另一条更新的 user 消息后，正确返回 409。

## 4. 已确认产品与技术决策

### 4.1 思考开关适用范围

- 设置页只允许对 `kimi-k2.5` 和 `kimi-k2.6` 操作思考开关。
- 其他模型显示该能力不可配置，并说明原因，不静默伪装成已生效。
- `kimi-k2.7-code` 系列始终开启思考，不允许关闭。
- `kimi-k3` 使用 `reasoning_effort`，不发送 K2.x 的 `thinking` 参数。
- `moonshot-v1-*` 和无法识别的自定义模型不发送 `thinking` 参数。

### 4.2 生效时机

- 思考模式是 Kimi Provider 的全局运行时设置。
- run handler 开始执行时读取 `SettingsStore.current` 的最新设置，与现有模型设置热更新语义保持一致。
- 排队期间修改设置时，尚未开始的任务使用新值；已经开始的任务持有开始时取得的不可变 `Settings` 快照，不在流式过程中切换。
- retry 是新 run，开始执行时重新读取最新设置。
- 生成成功后，在脚本草稿/产物参数中记录本次实际使用的 `thinking_enabled`；不把它作为用户消息的提交快照。

### 4.3 思考内容处理

- 本期不向用户展示原始 `reasoning_content`。
- 不把 `reasoning_content` 写入消息、run、草稿、artifact、日志或前端状态。
- 页面沿用现有等待/输入动画；正文 `content` 到达后继续按现有方式流式展示。
- 后续可以单独扩展“模型正在思考”阶段或思考过程展示，本任务不预留需要持久化推理正文的数据结构。
- 本期不发送 `thinking.keep="all"`，不启用 Preserved Thinking。

### 4.4 Moonshot 温度策略

- 所有 Moonshot 模型均不显式发送 `temperature`，交由模型采用合法默认值。
- DeepSeek、通义千问暂时保留现有 `temperature: 0.8`，避免无关 Provider 行为变化。
- Provider 请求体必须由统一入口按能力构造；正式生成与设置页“测试连通”不得分别拼装不同参数。

### 4.5 错误展示与日志

- 前端展示后端分类后的安全中文原因，不再把所有 `SCRIPT_LLM_ERROR` 无条件覆盖成同一条通用文案。
- 上游详细错误仅写服务端日志。
- 日志只允许记录 provider、模型 ID、HTTP 状态、上游 `error.type`、`error.code`、截断且脱敏后的 `error.message` 和可用的 request ID。
- 禁止记录 API Key、Authorization 头、完整 Prompt、消息上下文、附件正文和未经处理的完整响应体。

### 4.6 流式完整性

- 必须收到 `[DONE]` 才能把上游响应视为完整。
- 未收到 `[DONE]` 而连接结束时，任务失败并丢弃临时正文，不落 assistant 消息和脚本草稿。
- `finish_reason="length"` 表示模型输出被截断，即使随后收到 `[DONE]` 也不得把残缺内容保存为完整脚本。
- `finish_reason="content_filter"` 或其他不能形成完整正文的终止原因进入分类失败路径。

### 4.7 文档范围

本任务文档同时覆盖 Kimi 400、思考模式设置、Moonshot 流式兼容和失败消息 retry 409，不拆分为多个 issue。

## 5. 设置模型、持久化与 API

### 5.1 后端配置

在 `Settings` 中增加：

```python
moonshot_thinking_enabled: bool = True
```

Pydantic Settings 自动支持环境变量：

```dotenv
MOONSHOT_THINKING_ENABLED=true
```

约定：

- 默认值为 `true`，与 Kimi K2.6 官方默认一致。
- 字符串环境变量使用 Pydantic 的标准布尔解析；非法值应在启动时明确报配置错误。
- `SettingsStore.PROVIDER_FIELDS["llm_moonshot"]` 增加 `moonshot_thinking_enabled`。
- `SettingsStore.CREDENTIAL_FIELDS` 不增加该字段；清除浏览器 API Key 时不得清除思考设置。
- 旧 `settings.json` 没有该字段时从 `.env` 或代码默认值继承，不需要数据库迁移。
- 浏览器保存 `false` 时必须保留显式 false，不能被 `exclude_none`、truthy 判断或默认值覆盖。

### 5.2 设置状态响应

Kimi Provider 状态增加：

```json
{
  "configured": true,
  "model_id": "kimi-k2.6",
  "thinking_enabled": true,
  "thinking_configurable": true,
  "thinking_unavailable_reason": null
}
```

非可配置模型示例：

```json
{
  "model_id": "kimi-k3",
  "thinking_enabled": true,
  "thinking_configurable": false,
  "thinking_unavailable_reason": "Kimi K3 不使用 thinking 开关"
}
```

能力判定以后端为事实源，前端不得自行假设任意 `kimi-*` 模型都支持开关。`thinking_enabled` 保存用户偏好；`thinking_configurable` 表示当前模型是否会使用该偏好。

### 5.3 Provider 更新接口

现有接口继续使用：

```text
PATCH /api/settings/providers/llm_moonshot
```

请求可同时更新模型、API Key 与思考开关：

```json
{
  "revision": 8,
  "model_id": "kimi-k2.6",
  "thinking_enabled": false
}
```

- `thinking_enabled` 必须是 JSON boolean，不接受字符串、数字或 null。
- 设置写入继续受本机 Origin 校验、revision 乐观锁和原子文件替换保护。
- 保存成功后使 `['settings-status']` 与模型列表等现有相关缓存失效。

### 5.4 前端设置交互

- Kimi 卡片在模型 ID 下增加 Ant Design `Switch`，标签为“深度思考”。
- 默认开启；辅助说明为“开启后模型会先推理再生成正文，耗时和 Token 消耗可能增加”。
- 使用表单当前的模型 ID 实时判断展示状态；用户尚未保存的新模型 ID 也应立即影响开关是否可操作。
- 当前模型为 K2.5/K2.6 时允许切换。
- 当前模型为 K2.7 Code、K3、Moonshot V1 或未知模型时禁用，并展示后端定义的兼容性原因。
- 从可配置模型切换到不可配置模型时保留用户偏好，不把开关强制写回；以后切回 K2.5/K2.6 时恢复原偏好。
- 保存失败或 revision 冲突时沿用现有设置页刷新与错误提示规则。

## 6. Provider 请求构造与模型能力

### 6.1 能力解析

在 LLM Provider 层建立集中式 Moonshot 模型能力解析，至少返回：

```text
thinking_configurable
thinking_forced
thinking_parameter_supported
temperature_policy
```

模型 ID 去除首尾空格后做精确匹配：

| 模型 | thinking 行为 | temperature 行为 |
| --- | --- | --- |
| `kimi-k2.5` | 使用设置值 | 不发送 |
| `kimi-k2.6` | 使用设置值 | 不发送 |
| `kimi-k2.7-code` / `kimi-k2.7-code-highspeed` | 强制开启，不发送可关闭配置 | 不发送 |
| `kimi-k3` | 不发送 K2.x `thinking` | 不发送 |
| `moonshot-v1-*` | 不发送 | 不发送 |
| 未识别 Moonshot 模型 | 不发送，按兼容降级处理 | 不发送 |

未识别模型不得因为本地能力表过期而被禁止调用；最终兼容性由 Moonshot 响应和设置页连通测试确认。

### 6.2 请求示例

K2.6 开启思考：

```json
{
  "model": "kimi-k2.6",
  "messages": [],
  "stream": true,
  "thinking": {"type": "enabled"}
}
```

K2.6 关闭思考：

```json
{
  "model": "kimi-k2.6",
  "messages": [],
  "stream": true,
  "thinking": {"type": "disabled"}
}
```

K3、Moonshot V1 或未知模型：

```json
{
  "model": "kimi-k3",
  "messages": [],
  "stream": true
}
```

上述 Moonshot 请求均不包含 `temperature`、`top_p`、`n`、`presence_penalty` 或 `frequency_penalty`。

### 6.3 正式生成与探测共用

- `ModelRegistry.stream_chat` 与设置页 `_probe_llm` 必须走同一请求构造函数。
- probe 使用当前模型和当前思考设置，继续使用较短的探测超时。
- probe 成功只说明认证、模型权限和当前参数组合可用，不声称验证长文本生成质量。

## 7. 流式响应状态机

### 7.1 分片类型

将当前“只在有正文时 yield 字符串”的解析方式调整为内部结构化分片，至少区分：

```text
reasoning     仅表示收到思考分片，不携带可持久化正文
content       携带最终正文增量
finish        携带 finish_reason
done          收到 [DONE]
usage         可忽略或为后续统计保留，不影响正文
```

- 原始 `reasoning_content` 只在解析当前数据块时判断是否存在，不向上游业务对象复制正文。
- handler 对每个 reasoning/content 分片执行 `ctx.check_cancelled()`，保证 Kimi 长思考期间仍可响应用户取消。
- 只有 content 分片触发前端 `assistant.delta` 并加入最终脚本文本。
- 空 `choices` 的 usage 分片不能被视为解析错误。
- 无法解析的单个 JSON 数据块不得直接拼入正文；需要按安全规则记录或归类失败。

### 7.2 完整性判定

流式状态至少跟踪：

```text
received_done
finish_reason
received_content
```

完成条件：

```text
received_done = true
finish_reason = stop（或 Provider 明确定义的等价正常原因）
received_content = true
```

失败条件：

- HTTP 流提前 EOF 且未收到 `[DONE]`。
- `finish_reason=length`。
- `finish_reason=content_filter`。
- 完整结束但最终正文为空。
- SSE JSON 结构持续异常，无法形成受支持的输出状态。

失败时保留现有事务边界：临时流式内容只存在于内存和页面运行态，不落 assistant 消息、不更新脚本草稿。

## 8. 上游错误分类与安全边界

### 8.1 分类建议

| 上游响应 | 稳定业务码 | 前端安全文案 |
| --- | --- | --- |
| 400 / `invalid_request_error` | `SCRIPT_LLM_REQUEST_INVALID` | 模型请求参数不兼容，请检查模型 ID 与思考模式设置 |
| 400 / `content_filter` | `SCRIPT_LLM_CONTENT_REJECTED` | 输入或模型输出触发内容安全限制，请调整内容后重试 |
| 401 | `SCRIPT_LLM_AUTH_ERROR` | API Key 无效，或 API Key 与接口所属平台不匹配 |
| 403 | `SCRIPT_LLM_ACCESS_DENIED` | 当前账号无权调用该模型 |
| 404 | `SCRIPT_LLM_MODEL_NOT_FOUND` | 模型不存在或当前账号无权访问 |
| 429 / quota | `SCRIPT_LLM_QUOTA_EXCEEDED` | 账户余额或 Token 额度不足 |
| 429 / overload、rate limit | `SCRIPT_LLM_RATE_LIMITED` | 模型繁忙或请求受限，请稍后重试 |
| 500 / 503 | `SCRIPT_LLM_ERROR` | 模型服务暂时异常，请稍后重试 |
| 上游或本地读取超时 | `SCRIPT_TIMEOUT` | 模型响应超时，请重试 |
| 未收到 `[DONE]` | `SCRIPT_LLM_STREAM_INCOMPLETE` | 模型响应中断，未保存不完整内容，请重试 |
| `finish_reason=length` | `SCRIPT_LLM_OUTPUT_TRUNCATED` | 模型输出达到长度上限，未保存不完整内容 |

中国站 `api.moonshot.cn` 与国际站 `api.moonshot.ai` 的账号、余额和 API Key 隔离。当前项目使用中国站地址，因此 401 文案应提示用户确认 Key 来源，但不得回显 Key。

### 8.2 安全解析与日志

- 仅当响应体是预期 JSON 对象时读取 `error.type/message/code`。
- 上游 message 先去除控制字符、换行和潜在凭据，再截断到合理长度。
- 用户可见文案由业务码固定映射，不直接展示未经审核的上游原文。
- 日志使用结构化字段；request ID 仅在上游明确提供时记录。
- 非 JSON 错误页只记录 HTTP 状态和响应类型，不记录完整 HTML。

## 9. 消息缓存与 retry 一致性

### 9.1 发送后的缓存同步

`sendMessage` 返回 202 后立即：

1. 进入 run 状态并尽快建立 SSE，不能为了等待消息刷新而延迟订阅。
2. 异步失效并刷新 `['messages', conversationId]`。
3. 成功时现有 `message.completed` 继续刷新，保证 assistant 消息进入列表。
4. `run.failed` 也刷新消息列表，保证失败 run 对应的 user 消息可见。

### 9.2 重试前强一致读取

点击失败卡片“重试”时：

1. 不直接使用渲染时闭包中的 `lastUserMessage`。
2. 主动请求当前会话最新消息页。
3. 把响应写回 React Query 缓存。
4. 从最新响应中选择最后一条 user 消息并调用 retry。
5. 获取最新消息期间禁用重试按钮，避免重复点击产生并发请求。

如果刷新失败或找不到用户消息，应显示明确错误并停止，不回退到旧缓存 ID。

### 9.3 后端保护保持不变

- 继续只允许重试同一会话的最新 user 消息。
- retry 不复制 user 消息或附件。
- 继续复用该 user 消息已经持久化的 duration、model、provider 和附件。
- 继续拒绝会话存在 active run、目标消息不属于该会话或目标不是 user 消息的请求。
- 本任务不通过放宽 `MESSAGE_NOT_RETRYABLE` 校验掩盖前端缓存问题。

## 10. 实施范围

### 10.1 后端

- `config.py`
  - 增加 `moonshot_thinking_enabled=True`。
  - 纳入 Kimi Provider 可持久化字段和旧配置兼容白名单。
- `settings.py`
  - 扩展 ProviderUpdate、状态响应、字段映射和 Kimi 能力说明。
  - probe 复用正式请求构造。
- `llm/registry.py`
  - 引入 Provider/模型感知的请求体构造。
  - 所有 Moonshot 请求移除 temperature。
  - K2.5/K2.6 发送设置选择的 thinking.type。
  - 解析 reasoning/content/finish/done，增加取消检查所需的结构化分片。
  - 增加 `[DONE]`、finish_reason 和错误分类处理。
  - 增加脱敏结构化日志。
- `conversations.py`
  - 使用执行开始时的思考设置。
  - 只把 content 作为脚本文本。
  - 在草稿/产物参数记录实际思考模式。
- `errors.py`、API 契约
  - 补充稳定 LLM 分类错误码和安全文案。

### 10.2 前端

- `api/types.ts`、`api/settings.ts`
  - 扩展 Kimi Provider 状态和更新请求类型。
- `SettingsPage.tsx`
  - 增加深度思考 Switch、模型能力禁用态及原因。
- `MeditationWorkspacePage.tsx`
  - 发送接受、run.failed 时刷新消息。
  - retry 前强制读取最新消息并防重复提交。
- `features/script-workspace/errors.ts`
  - 展示新的安全分类文案，不泄露 Provider 原始响应。
- 现有 MessageList 不显示或保存 reasoning_content。

### 10.3 技术文档

- 更新 `docs/tech/api-contract.md`：设置字段、Provider 状态、错误码和 retry 一致性。
- 更新 `docs/tech/tech-design.md`：Moonshot 能力适配、思考流过滤、运行时配置生效时机与流式完整性。
- 仅当最终实现新增持久化字段时更新 `docs/tech/data-model.md`；本方案不持久化 reasoning_content，不新增 SQLite 列。
- 更新 `backend/.env.example` 中的 `MOONSHOT_THINKING_ENABLED=true` 及说明。

## 11. 不在本任务范围

- 展示、折叠或导出模型原始思考过程。
- 持久化 `reasoning_content` 或启用 `thinking.keep="all"`。
- Kimi K3 的 `reasoning_effort` 设置。
- Kimi 工具调用、官方工具、联网搜索、视觉输入或 Partial Mode。
- 自动调用 Moonshot `/v1/models` 同步模型能力表。
- 自动重试可能产生额外费用的 LLM 生成请求。
- 放宽后端“只能重试最新用户消息”的并发保护。
- 删除本次排查期间已经产生的两条重复历史 user 消息。

## 12. 测试方案

### 12.1 后端单元测试

- Settings 默认 `moonshot_thinking_enabled is True`。
- `.env` 的 true/false 正确解析，非法布尔值启动失败。
- 旧 settings.json 缺少字段时使用默认值。
- 浏览器更新 false 后持久化为 false，重新创建 SettingsStore 后仍为 false。
- 清除 Moonshot API Key 不清除思考偏好。
- revision 冲突和非法字段继续返回稳定错误。
- K2.5/K2.6 开启与关闭分别生成正确 `thinking.type`。
- K2.7 Code、K3、Moonshot V1 和未知模型不发送错误的 thinking 参数。
- 所有 Moonshot 请求都不包含 temperature；DeepSeek/Qwen 仍包含 0.8。
- 设置页 probe 和正式生成使用相同请求构造结果。

### 12.2 流式解析测试

- reasoning_content 先到达时不进入最终正文，也不写日志/数据库。
- 每个 reasoning 分片仍让 handler 获得取消检查机会。
- reasoning 后的 content 正确顺序拼接并推送。
- 空 choices usage 数据块不会导致异常。
- 收到 finish_reason=stop 和 `[DONE]` 后正常完成。
- 有部分 content 但未收到 `[DONE]` 时失败且不落 assistant/草稿。
- finish_reason=length、content_filter 分别映射稳定错误码。
- 完整流结束但 content 为空时保持失败。
- 400/401/403/404/429/5xx 按表映射，日志和 API 响应不含 Key、Prompt 或原始响应体。

### 12.3 前端测试

- Kimi K2.5/K2.6 显示可操作开关且默认开启。
- 保存 false 时请求体携带布尔 false，成功后状态保持关闭。
- K2.7 Code、K3、Moonshot V1 和未知模型禁用开关并显示对应说明。
- 修改表单中的模型 ID 后，开关可用性即时更新。
- 发送接受后不延迟 SSE 连接，同时触发消息刷新。
- run.failed 后触发消息刷新。
- retry 始终使用刚从服务端取得的最新 user message ID。
- 连续两次失败、缓存仍有旧消息时不再请求旧消息 retry URL。
- retry 刷新期间按钮禁用；刷新失败不发 retry 请求。
- 各 LLM 分类错误显示安全中文文案。
- 页面和 API 类型中不存在 reasoning_content。

### 12.4 后端集成测试

- 使用 mock Moonshot SSE 完成“思考分片 → 正文分片 → stop → [DONE]”完整链路。
- 成功 run 只保存正文，草稿参数记录实际 thinking_enabled。
- 修改设置后，新开始的 run 和 retry 使用最新思考值。
- 已运行的流不受设置中途修改影响。
- 失败 run 不落 assistant 消息；刷新消息后 retry 成功复用同一 user 消息和附件。
- 对非最新 user 消息的直接 retry 请求继续返回 409 `MESSAGE_NOT_RETRYABLE`。

### 12.5 真实 Provider 人工验证

真实调用可能产生费用，只在自动化全部通过后手动执行：

1. 设置 `MOONSHOT_MODEL_ID=kimi-k2.6` 并配置中国站 API Key。
2. 设置页保持“深度思考”开启，执行“测试连通”并生成短冥想脚本。
3. 确认不再出现由 temperature 触发的 HTTP 400。
4. 关闭深度思考，再次测试连通并生成脚本。
5. 确认两种模式都只展示/保存正文，未出现 reasoning_content。
6. 人工注入一次失败，确认失败用户消息立即可见，点击重试不再出现旧消息 409。
7. 检查服务端日志只含允许的脱敏诊断字段。

## 13. 验收标准

- [x] Kimi K2.6 使用默认开启的思考模式可以完成真实脚本生成，不再因 `temperature: 0.8` 返回 400。
- [x] 用户可在设置页开启或关闭 K2.5/K2.6 思考模式，保存后热生效并跨重启保留。
- [x] 非 K2.5/K2.6 模型不能误操作开关，页面明确说明能力限制。
- [x] 所有 Moonshot 请求不显式携带 temperature，DeepSeek/Qwen 行为无回归。
- [x] 正式生成与设置页连通测试使用相同的模型能力和请求参数。
- [x] reasoning_content 不展示、不持久化、不进入脚本文本或日志。
- [x] Kimi 思考阶段仍可取消任务。
- [x] 未收到 `[DONE]`、输出截断或内容过滤时不保存部分脚本。
- [x] 前端能显示认证、权限、模型、额度/限流、参数、内容安全、服务异常和流中断等安全分类原因。
- [x] 新用户消息生成失败后，失败卡片重试使用服务端最新 user 消息，不再因缓存过期产生 409。
- [x] 后端对真正的历史消息仍返回 `MESSAGE_NOT_RETRYABLE`。
- [x] 自动化测试、类型检查、前端构建与后端完整测试通过。
- [x] 技术文档和 `.env.example` 与最终实现一致。

## 14. 建议实施顺序

1. 先补齐 Settings 字段、持久化、状态 API 和设置页开关测试。
2. 抽取 Moonshot 模型能力与请求构造器，修复 temperature/thinking 参数。
3. 重构内部流式分片并完成 `[DONE]`、finish_reason、取消和错误分类测试。
4. 接入 script handler，验证只保存 content 与运行时设置热更新。
5. 修复前端消息缓存刷新及 retry 前强一致读取。
6. 更新技术文档，运行后端、前端与构建检查。
7. 经用户允许后执行可能产生费用的真实 Kimi 人工验证。

## 15. 实施记录

实施日期：2026-09-06。

- 新增 `moonshot_thinking_enabled` 设置项、状态能力字段与设置页开关；严格校验 JSON boolean，运行时持久化后热生效。
- `ModelRegistry` 改为 Provider 感知请求构造：K2.5/K2.6 发送 thinking，其他 Moonshot 模型兼容降级，Moonshot 全部省略 temperature。
- LLM 流改为 reasoning/content/finish/usage/done 结构化事件；仅 content 进入 SSE 和数据库，必须收到 `[DONE]`，并拒绝截断、内容过滤及提前断流。
- 上游错误按参数、内容安全、认证、权限、模型、额度、限流、服务异常、超时与流中断分类；前端仅展示安全中文原因。
- `run.failed` 后刷新消息缓存，点击重试前再次读取服务端消息并锁定最新 user message ID，同时禁用重复点击。
- 更新 API 契约、技术设计、数据模型与 `.env.example`。
- 自动化结果：后端完整 pytest `231 passed, 5 skipped`；前端完整 Vitest `90 passed`，ESLint 与生产构建通过。新增定向用例覆盖 Moonshot 请求/流解析、思考阶段取消、部分脚本不落库、设置持久化、设置页能力联动和 retry 强一致读取。
- 用户已完成人工验收：真实 Kimi 调用通过，K2.6 默认思考模式不再因 `temperature: 0.8` 返回 400。
