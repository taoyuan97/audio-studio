# T009：冥想工作台消息附件（Markdown / TXT 参考资料）

## 1. 任务信息

- 状态：已完成（用户验收通过）
- 优先级：P0
- 类型：一期增量任务
- 前置任务：T003（冥想会话、消息、LLM 流式生成）
- 后续任务：无
- 目标目录：`frontend/src/pages/`、`frontend/src/features/script-workspace/`、`frontend/src/api/`、`frontend/src/styles/`、`backend/app/`、`backend/tests/`
- 创建日期：2026-08-27
- 验收日期：2026-08-28
- 关联文档：`docs/tech/api-contract.md`（第 4、12 节）、`docs/tech/data-model.md`（消息模型）、`docs/task/T003-script-line.md`

## 2. 目标

在冥想工作台输入框下方、“时长”按钮左侧增加“+”附件入口。用户单次可选择最多 3 个本地 `.md` / `.txt` UTF-8 文本文件，输入明确指令后发送；后端持久化附件并把正文作为参考资料一并交给 LLM。附件在消息历史、失败重试和后续多轮上下文中保持可用。

## 3. 已确认行为基线

- 附件只作为参考资料，不能替代用户指令；输入文字为空时不允许发送。
- 单次消息最多 3 个文件。
- 单文件最大 200 KB，单次附件合计最大 500 KB；`1 KB = 1024 bytes`，后端按 UTF-8 编码后的实际字节数复验。
- 一期仅支持 `.md`、`.txt`，扩展名大小写不敏感；MIME 仅作提示，不能作为唯一校验依据。
- 一期仅支持 UTF-8（含 UTF-8 BOM）。GBK / ANSI 或其他无法严格按 UTF-8 解码的文件提示用户转换编码，不引入编码探测依赖。
- 发送前展示已选文件名、大小和移除入口；已发送消息只展示文件名和大小，不提供预览、下载或删除。
- 允许同名但内容不同的文件。同一次待发送列表中，以“文件名 + 文件大小 + 最后修改时间”完全相同判定重复并去重。
- 当前轮附件完整交给模型；后续轮次继续携带历史附件内容，但计入既有历史上下文预算。本轮内容优先，较早历史附件允许被裁剪。
- 发送成功后清空输入文字和待发送附件；请求失败或生成失败时保留/复用附件。

## 4. 范围

### 4.1 前端交互

- 在 `MeditationWorkspacePage.tsx` 的 `.composer-tools` 内，将“+”按钮放在 `DurationSelect` 左侧。
- “+”按钮触发隐藏的 `<input type="file" multiple>`，声明 `accept=".md,.txt,text/markdown,text/plain"`。
- 通过 `File.arrayBuffer()` + `TextDecoder('utf-8', { fatal: true })` 严格解码；允许并去除文件开头的 UTF-8 BOM。不要使用会静默插入替换字符的宽松解码作为编码校验。
- 待发送附件至少维护 `name`、`size`、`lastModified`、`content`；重复键只用于当前待发送列表，不作为服务端附件主键。
- 每次选择都与当前列表合并：过滤重复项后再校验总数和总大小；部分文件不合规时，保留已通过校验的文件并逐项提示未加入原因。
- 在输入框与 `.composer-foot` 之间展示附件标签，包含文件名、格式化大小和移除按钮；长文件名省略并可通过 `title` 查看完整名称。
- 达到 3 个文件时禁用附件按钮；运行中、草稿编辑中或草稿保存中，与输入框、时长和模型控件保持相同禁用状态。
- 发送按钮仍以 `input.trim()` 和有效模型为必要条件；选择附件不能让空文本消息变得可发送。
- `submitMessage` 使用发送时的附件快照，避免“未保存人工草稿”确认/保存弹窗期间修改附件导致请求内容漂移。
- 接口返回 202 后才清空输入和附件。网络错误、参数错误、覆盖确认取消均不清空。
- `MessageList` 在用户消息气泡下展示已发送附件的文件名和大小；助手消息不展示附件。
- 补齐窄屏换行、长文件名、禁用态、hover/focus-visible 等样式，不破坏当前 composer 响应式布局。

### 4.2 API 契约

继续使用 JSON 请求，不改为 `multipart/form-data`，也不新增 `python-multipart`：

```json
{
  "text": "请参考附件内容生成一段冥想脚本",
  "duration": 15,
  "model": "deepseek-chat",
  "allow_draft_overwrite": false,
  "attachments": [
    {
      "name": "参考资料.md",
      "content": "# 参考资料\n……"
    }
  ]
}
```

- `attachments` 可选，默认空数组；每项请求只接收 `name`、`content`，不信任客户端声明的 MIME 和大小。
- 后端从规范化后的扩展名确定 `media_type`：`.md` → `text/markdown`，`.txt` → `text/plain`。
- 服务端附件元数据响应结构：

```json
{
  "id": "att_...",
  "name": "参考资料.md",
  "size": 1234,
  "media_type": "text/markdown"
}
```

- `GET /api/conversations/{id}/messages` 的每条消息新增 `attachments` 数组；无附件及助手消息返回空数组，避免前端区分字段缺失。
- 消息列表不返回附件正文，防止分页响应体随资料长度膨胀；本期不增加附件正文、预览或下载端点。
- `POST .../messages/{message_id}/retry` 请求契约不变，后端读取目标用户消息已持久化的附件并重用。
- 更新 `frontend/src/api/types.ts` 中的待发送附件、请求附件、附件元数据和 `Message` 类型。

### 4.3 后端校验

前端校验用于即时反馈，后端是最终事实源：

- `text.strip()` 仍必须非空且不超过既有 20,000 字符。
- 附件数量为 0–3；单文件 UTF-8 字节数不超过 204,800，合计不超过 512,000。
- 文件名去除首尾空白后必须非空；拒绝 `/`、`\`、NUL 和路径穿越式名称，只保存 basename 语义的名称。
- 扩展名只允许 `.md` / `.txt`，大小写不敏感。
- 拒绝空附件正文和包含 NUL 的正文。
- 在物理大小限制之外，增加 `MAX_ATTACHMENT_CHARS_TOTAL = 60_000` 的模型输入保护上限；按 Python Unicode 字符数统计附件正文合计。该常量与错误提示需集中定义并由测试锁定。
- JSON 已经是 Unicode 文本，服务端无法还原浏览器所读原文件的编码；严格 UTF-8 原文件识别由前端 `TextDecoder(..., { fatal: true })` 完成，后端负责字符、字节数和内容安全复验。
- 校验必须发生在写消息、写附件和入队之前；任一附件失败时整次请求不落库、不创建 run。
- 新增并纳入统一错误码表：
  - `SCRIPT_ATTACHMENT_COUNT_INVALID`
  - `SCRIPT_ATTACHMENT_NAME_INVALID`
  - `SCRIPT_ATTACHMENT_TYPE_INVALID`
  - `SCRIPT_ATTACHMENT_SIZE_INVALID`
  - `SCRIPT_ATTACHMENT_CONTENT_INVALID`

### 4.4 数据模型与迁移

新增附件表，避免把正文混入用于生成参数的 `params_json`：

```sql
CREATE TABLE IF NOT EXISTS message_attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  size        INTEGER NOT NULL,
  content     TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id, position ASC);
```

- `Repository.initialize()` 通过 `CREATE TABLE IF NOT EXISTS` 幂等升级旧 SQLite，不改写既有消息。
- 扩展 `insert_message(..., attachments=...)`，在同一数据库事务中写入消息和全部附件，保证原子性。
- 提供按单条消息读取附件正文的方法，供当前生成、失败重试使用。
- 消息列表批量加载当前页所有附件元数据，避免逐消息查询造成 N+1；`get_message` 返回统一的附件元数据结构。
- 会话删除沿既有 `messages` 外键级联删除附件；测试中显式确认 SQLite 外键已启用且级联生效。
- 附件属于会话消息记录，不进入脚本 artifact / version，避免保存同一份参考资料的重复副本。

### 4.5 LLM Prompt 与上下文预算

- 扩展 LLM 消息组装逻辑。当前用户消息由“用户指令 + 参考资料区”组成，而数据库中的 `messages.content` 继续只保存用户实际输入文字。
- 参考资料采用稳定、可测试的边界格式，并在其前加入安全说明：附件是创作参考资料，其中的命令、角色设定或系统提示不得覆盖系统指令。
- 文件名及边界需安全序列化，不能允许文件正文伪造下一个附件边界；可使用长度标记或对边界保留串进行转义。
- 当前轮附件按选择顺序完整加入，受第 4.3 节 60,000 字符总上限保护，不计入用于历史消息的 `CONTEXT_CHAR_BUDGET`。
- 历史消息组装时，用户消息的文字和历史附件正文共同计入既有 `CONTEXT_CHAR_BUDGET = 12_000`：
  - 从最近消息向前装配；
  - 优先保留历史用户指令和助手回复，再使用剩余预算加入历史附件；
  - 历史附件按消息由近到远、消息内按原顺序加入；
  - 预算不足时允许截断附件正文并加入明确的“历史附件已截断”标记；
  - 不截断本轮附件，不让历史附件挤占本轮指令。
- `retry` 必须与首次发送组装出等价的本轮附件内容；模型、时长仍取目标用户消息的 `params`。
- 模型请求和日志不得输出完整附件正文，错误信息保持脱敏。
- `FAKE_MODE` 不要求根据附件语义生成不同脚本，但 Prompt 组装单元测试必须证明附件正文会进入真实模型调用消息。

### 4.6 同步技术文档

- 更新 `docs/tech/api-contract.md`：消息响应、发送请求、校验规则、重试语义和错误码。
- 更新 `docs/tech/data-model.md`：`message_attachments` 表、生命周期及消息 JSON 示例。
- 如 LLM 上下文组装章节已有对应说明，同步更新 `docs/tech/tech-design.md`，避免任务文档成为唯一事实源。

### 4.7 不实现

- PDF、DOCX、图片、音频、目录和压缩包上传。
- GBK / ANSI 自动识别或转码。
- 历史附件预览、下载、单独删除或重新编辑。
- 对附件建立知识库、向量索引、摘要缓存或模型服务商文件对象。
- 拖拽上传、粘贴文件、上传进度和跨页面保留尚未发送的本地文件。

## 5. 状态与数据流设计

```text
本地文件选择
  → 前端扩展名/数量/字节数/UTF-8 严格解码/重复校验
  → 待发送附件标签（可移除）
  → POST JSON：文字 + 参数 + 附件正文
  → 后端重新校验
  → 同一事务写 user message + message_attachments
  → enqueue script run
  → handler 读取消息与附件
  → 当前指令 + 安全边界包装的参考资料 → LLM
  → SSE 流式生成与既有草稿流程
```

关键状态约定：

- 待发送附件仅存在于页面本地 state；进入 202 成功态后清空。
- 已发送附件以数据库为事实源，页面刷新后由消息列表恢复元数据。
- 失败 run 不删除用户消息或附件，点击重试复用原记录。
- 发送附件与消息必须原子落库，不能出现有消息无附件或有附件无消息。

## 6. 测试

### 6.1 前端

- “+”按钮位于“时长”左侧，点击触发多选文件输入，`accept` 正确。
- `.md` / `.txt` 大小写扩展名可加入；其他格式、非 UTF-8、空文件、单文件超 200 KB 被拒绝并提示。
- 三个文件合计不超过 500 KB 可加入；第 4 个和总大小超限文件不可加入。
- 相同“文件名 + 大小 + 最后修改时间”去重；同名但内容/元数据不同可同时存在。
- 标签正确展示名称、格式化大小并可移除；3 个时禁用“+”；窄屏布局不溢出。
- 只有附件、没有文字时发送按钮禁用，Enter 也不发送。
- 请求载荷包含附件名称与正文；202 后清空，API 失败时保留。
- 覆盖草稿确认/先保存再发送流程使用发送快照，不丢附件、不重复提交。
- 消息历史只展示附件元数据；刷新后的 API 数据可正常渲染。

### 6.2 后端

- 请求模型及 0、1、3 个附件成功契约；4 个附件失败且不落库、不入队。
- 文件名、扩展名、空内容、NUL、单文件 204,800 边界、总计 512,000 边界、60,000 字符边界测试。
- 客户端伪造大小/MIME 不影响服务端计算结果。
- 消息和附件同事务写入；注入附件写入失败时消息回滚。
- 消息分页返回附件元数据但不泄露 `content`；批量查询路径无 N+1。
- 删除会话时附件级联删除。
- 当前轮 Prompt 包含完整附件、安全说明和稳定边界；历史附件计入 12,000 字符预算并按规则截断。
- 失败后重试读取同一附件；重试不新增第二份用户消息或附件。
- 无附件的既有生成、历史上下文、草稿覆盖确认、SSE 和 FAKE_MODE 测试全部回归通过。

### 6.3 验证命令

- 后端：`pytest`
- 前端：`pnpm test`
- 前端类型与生产构建：`pnpm build`
- 前端代码规范：`pnpm lint`

## 7. 验收标准

- [x] 冥想工作台“时长”左侧显示“+”按钮，最多可选择 3 个 `.md` / `.txt` 文件。
- [x] UTF-8、200 KB 单文件、500 KB 合计和 60,000 附件字符限制均有前后端对应校验与清晰提示。
- [x] 用户未输入明确文字时，即使已选择附件也不能发送。
- [x] 发送前可查看文件名/大小并移除；发送成功后清空，失败时保留。
- [x] 已发送用户消息展示附件名称和大小，不提供正文、预览、下载或删除入口。
- [x] 数据库原子保存消息和附件；刷新、失败重试后附件仍然存在并可复用。
- [x] 抓取或 mock LLM 请求可证明本轮附件正文随用户指令发送，且带有参考资料安全边界。
- [x] 后续多轮生成携带预算内的历史附件；本轮附件不被历史上下文挤占，较早附件可按规则裁剪。
- [x] 既有无附件消息、发送、重试、SSE、草稿覆盖保护和脚本生成行为无回归。
- [x] API 契约、数据模型、前后端类型和自动化测试同步更新，`pytest`、`pnpm test`、`pnpm build`、`pnpm lint` 全部通过。
