# T014：脚本历史版本导出 TXT / Markdown

## 1. 任务信息

- 状态：已完成，用户验收通过
- 优先级：P1
- 类型：冥想脚本前端增量任务
- 前置任务：T003（脚本草稿与版本）、T013（脚本结果编辑器与版本历史）
- 后续任务：无
- 目标目录：`frontend/src/pages/`、`frontend/src/features/script-export/`、`frontend/src/styles/`、`frontend/src/**/*.test.tsx`、`docs/tech/`
- 创建日期：2026-09-06
- 完成日期：2026-09-06
- 关联文档：`docs/tech/tech-design.md`、`docs/tech/api-contract.md`、`docs/tech/data-model.md`、`docs/task/T003-script-line.md`、`docs/task/T013-script-editor-tags-fullscreen.md`
- 参考实现：`C:\projects\studio\article-studio\frontend\src\pages\ArticleWorkspacePage.tsx`、`C:\projects\studio\article-studio\frontend\src\features\article-export\`

## 2. 背景与目标

当前冥想工作台的“版本历史”弹窗支持选择历史版本、预览结构化脚本和恢复为工作草稿，但不能将已保存版本导出为本地文档。

本任务在选中版本的预览区增加“导出文档”入口。用户可在独立弹窗中设置本次导出的文件标题并选择 Markdown 或 TXT 格式，随后在浏览器本地生成文件。导出只读取不可变版本的 `content.text`，不修改脚本产物、版本、草稿或任何服务端数据。

## 3. 已确认产品决策

### 3.1 导出范围

- 只允许导出版本历史中当前选中的已保存版本。
- 不支持导出尚未保存的工作草稿。
- 每次打开版本历史弹窗时，默认选中版本号最大的最新版本；用户随后仍可切换其他版本。
- 未选择版本时不显示“导出文档”按钮。
- 导出目标在打开导出弹窗时冻结为当时选中的版本，避免弹窗打开后外层状态变化导致导错版本。

### 3.2 导出标题

- 标题只属于本次导出，不修改脚本产物名称、版本名称或服务端数据。
- 打开弹窗时默认标题格式：

```text
{脚本产物名称}-v{版本号}-{MMDD}-{HHmm}
```

- 示例：`睡前放松冥想-v2-0906-0957`。
- `MMDD-HHmm` 使用用户浏览器本地时间，在每次打开导出弹窗时生成；月、日、时、分均补足两位。
- 用户可在导出前自由修改标题。
- 最终文件名直接使用校验和清理后的标题加扩展名，不再额外追加版本号或时间：

```text
睡前放松冥想-v2-0906-0957.md
睡前放松冥想-v2-0906-0957.txt
```

### 3.3 标题校验与文件名清理

- 标题必填，去除首尾空格后长度为 1～100 个字符。
- 标题输入为单行，不接受换行符。
- 文档正文标题使用用户输入经首尾去空格后的内容，不替换其中普通可显示字符。
- 文件名基于同一标题生成，但 Windows 文件名非法字符 `< > : " / \ | ? *`、ASCII 控制字符替换为空格。
- 文件名清理后折叠连续空格、去除首尾空格，并去除末尾的句点和空格。
- 若清理后文件名为空，阻止导出并显示校验错误，不静默使用其他业务标题。
- 扩展名由格式自动决定，用户不需要在标题中输入；若标题本身以 `.md` 或 `.txt` 结尾，仍按普通标题处理并追加所选格式扩展名。

### 3.4 导出格式

- 支持 Markdown 文档（`.md`）与 TXT 文本（`.txt`）。
- 每次打开导出弹窗默认选择 Markdown。
- 格式切换只影响扩展名、MIME 类型和正文标题语法，不改变脚本正文。
- 文件编码统一为 UTF-8，不添加 BOM。

### 3.5 导出内容

- 不包含创建时间、目标时长、模型、预估时长或其他额外元数据。
- 标题与原始脚本之间保留一个空行。
- 直接读取选中版本的 `content.text`，不得由 `segments` 反向拼接正文。
- 原始脚本的换行、空格和标签保持不变，包括但不限于：
  - `[emotion:asmr]`
  - `[vocal:sighing]`
  - `[停顿 5s]`
  - `[吸气]` / `[呼气]`
  - `[情绪:温柔]` / `[语速:慢速]`
- 不把内部标签转换为中文显示名或阿里云 Provider 原生标签。
- 整个文件结尾统一保留一个换行符。

Markdown 内容格式：

```md
# 睡前放松冥想-v2-0906-0957

[emotion:asmr]
慢慢地，让你的呼吸安静下来。
[停顿 5s]
```

TXT 内容格式：

```text
睡前放松冥想-v2-0906-0957

[emotion:asmr]
慢慢地，让你的呼吸安静下来。
[停顿 5s]
```

### 3.6 弹窗状态

- “导出文档”按钮位于选中版本预览区标题栏，与“恢复为草稿”按钮并列。
- 点击后打开独立的“导出文件”弹窗。
- 导出弹窗作为 `MeditationWorkspacePage` 下的页面级 Modal，与版本历史 Modal 互为兄弟组件，不直接嵌套在版本历史 Modal 的 DOM 中。
- 打开导出弹窗时，版本历史弹窗保持打开并保留当前选中版本。
- 导出成功后只关闭导出弹窗；版本历史弹窗继续保持打开，当前选中版本不变。
- 导出失败时保留标题、格式和目标版本，以便用户重试。
- 用户取消导出弹窗时不生成文件，不改变版本历史状态。
- 关闭版本历史弹窗时同步关闭导出弹窗并清空冻结的导出目标。
- 导出进行中禁用标题、格式、取消、关闭、遮罩关闭和重复导出操作。

## 4. 用户交互流程

```text
工作台脚本结果区
  → 打开“版本历史”
  → 选择一个已保存版本
  → 预览标题栏显示“恢复为草稿 / 导出文档”
  → 点击“导出文档”
  → 导出文件弹窗默认填入“产物名-vN-MMDD-HHmm”并选中 Markdown
  → 用户可修改标题或切换 TXT
  → 点击“导出”
  → 生成 UTF-8 文件并触发本地保存
  → 成功提示，关闭导出弹窗
  → 返回仍保持原选中版本的版本历史弹窗
```

## 5. 前端组件设计

### 5.1 `MeditationWorkspacePage.tsx`

新增状态建议：

```ts
const [exportModalOpen, setExportModalOpen] = useState(false)
const [exportVersion, setExportVersion] = useState<ScriptVersion | null>(null)
```

职责：

- 在 `selectedVersion` 预览标题栏增加“导出文档”按钮。
- 点击时把 `selectedVersion` 写入 `exportVersion`，再打开导出弹窗。
- 向导出弹窗传入脚本产物名称、冻结版本及关闭回调。
- 导出成功只关闭导出弹窗，不清除版本历史的 `selectedVersion`。
- 关闭版本历史时同时关闭导出弹窗并清理 `exportVersion`。

### 5.2 `ExportScriptModal.tsx`

建议位置：

```text
frontend/src/features/script-export/ExportScriptModal.tsx
```

建议 Props：

```ts
interface ExportScriptModalProps {
  open: boolean
  artifactName: string
  version: ScriptVersion | null
  onCancel: () => void
  onExported: () => void
}
```

表单内容：

- 只读版本信息：`v{version_no}`。
- 文件标题 `Input`：单行、最大 100 字符、显示校验错误。
- 导出格式 `Radio.Group`：Markdown / TXT。
- 保存行为提示。
- 取消、导出按钮及导出 loading 状态。

初始化规则：

- `open` 从 false 变 true 时，根据 `artifactName`、`version_no` 和当前本地时间生成默认标题。
- 同时把格式重置为 Markdown。
- 弹窗保持打开期间不得因父组件重渲染重复生成时间或覆盖用户输入。
- `version=null` 时不得执行导出。

### 5.3 导出文件工具

建议位置：

```text
frontend/src/features/script-export/exportFile.ts
```

建议职责：

- `buildDefaultExportTitle(artifactName, versionNumber, now)`：生成稳定、可测试的默认标题。
- `validateExportTitle(title)`：完成必填、单行、长度校验。
- `sanitizeExportFileName(title)`：只处理文件系统非法字符，不改变正文标题。
- `buildExportContent(title, scriptText, format)`：构建 MD/TXT 内容。
- `exportScriptFile(input)`：生成正确 MIME 类型的 UTF-8 Blob，并触发保存。

格式类型：

```ts
type ScriptExportFormat = 'markdown' | 'txt'
```

MIME 类型：

```text
markdown → text/markdown;charset=utf-8
txt      → text/plain;charset=utf-8
```

## 6. 本地保存与浏览器兼容

- 参考文章工作台的文件导出实现。
- 浏览器支持 `window.showSaveFilePicker` 时，优先打开系统“另存为”，使用清理后的文件名作为 `suggestedName`。
- 用户取消系统“另存为”属于正常取消，不显示错误、不关闭导出弹窗。
- 浏览器不支持 `showSaveFilePicker` 时，使用 `Blob`、`URL.createObjectURL` 和隐藏 `<a download>` 触发浏览器下载。
- 浏览器下载发生文件重名时，由浏览器自行处理，不在应用内追加序号或覆盖检测。
- 回退浏览器下载成功时提示文件已保存到浏览器下载目录。
- 无论成功或失败，都及时移除临时 `<a>` 并调用 `URL.revokeObjectURL`。
- 不向后端上传正文，不创建临时服务端文件，不新增导出 API。

## 7. 内容规范化边界

为同时满足“正文保持不变”和“文件结尾统一换行”，只允许以下外层处理：

1. 标题使用 `trim()` 后的值。
2. 标题后固定写入两个换行符。
3. 原始 `content.text` 原样写入，不做 Markdown 转义、标签转换、空行折叠或逐行 trim。
4. 若原始正文末尾已有一个或多个 `\r` / `\n`，移除这些末尾换行后统一补一个 `\n`。
5. 正文内部的 CRLF/LF、空格和空行不改写。

Markdown 标题的 `# ` 是导出格式结构，不属于正文标签转换。标题内的 Markdown 特殊字符按用户输入原样保留。

## 8. 错误处理

- 标题为空、包含换行、超过 100 字符或清理后文件名为空：阻止导出并在字段附近显示明确错误。
- 版本为空：按钮层和执行层双重阻止，并提示“请选择要导出的版本”。
- Blob、系统文件写入或浏览器下载失败：显示“导出失败”及安全错误信息，保留弹窗状态。
- `AbortError`：视为用户取消，不显示失败提示。
- 错误提示不得包含脚本正文。
- 导出动作不应影响草稿 dirty、编辑状态、版本选择、React Query 缓存或导航保护状态。

## 9. 数据与 API 影响

- 不新增后端 API。
- 不修改 SQLite schema。
- 不修改 `ScriptVersion` API 契约。
- 不修改 artifact、version 或 draft 数据。
- 导出内容直接来自版本历史接口已返回的 `ScriptVersion.content.text`。
- 文件标题只保存在导出弹窗组件状态中；不写入 localStorage、sessionStorage、URL 或 React Query。

## 10. 样式与可访问性

- 导出弹窗延续项目现有 Ant Design 暗色主题与表单间距。
- 标题 `label` 与输入框建立关联。
- 格式选择提供可访问名称“导出格式”。
- 导出按钮 loading 时保持明确状态，不允许重复触发。
- 校验信息可被辅助技术读取。
- 小屏幕下输入框和格式选项不横向溢出。
- 版本预览标题栏按钮空间不足时允许合理换行，不遮挡版本号。

## 11. 测试方案

### 11.1 导出工具单元测试

- 默认标题按浏览器本地时间生成 `产物名-v2-0906-0957`。
- 月、日、时、分正确补零。
- 标题首尾空格被去除。
- 空标题、仅空格、换行及超过 100 字符被拒绝。
- Windows 非法文件名字符和控制字符被替换，末尾句点/空格被移除。
- Markdown 文件名为 `{title}.md`，TXT 为 `{title}.txt`，不重复追加版本号。
- Markdown 内容包含 `# 标题`、一个空行和原始正文。
- TXT 内容包含标题、一个空行和原始正文。
- 两种格式都原样保留情绪、语气词、停顿和旧标签。
- 正文内部空白不变，文件结尾统一为一个 LF。
- MIME 类型与 UTF-8 编码正确且没有 BOM。
- `showSaveFilePicker` 成功、取消、异常路径行为正确。
- 无文件选择器时创建并回收 Object URL，浏览器处理重名。

### 11.2 弹窗组件测试

- 每次打开默认选择 Markdown，并生成新的默认标题。
- 用户可修改标题、切换 TXT 并触发对应导出。
- 弹窗打开期间父组件重渲染不会覆盖用户标题。
- 导出进行中禁用交互并防重复提交。
- 系统保存取消时弹窗保持打开。
- 导出失败保留标题、格式和版本。
- 导出成功调用 `onExported`。

### 11.3 工作台集成测试

- 未选择版本时不显示导出按钮。
- 选择版本后导出按钮与“恢复为草稿”并列显示。
- 点击导出冻结正确版本并打开弹窗。
- 导出成功后历史弹窗和当前版本选择保持不变。
- 关闭版本历史同步关闭导出弹窗并清理导出目标。
- 导出不触发任何草稿保存、版本恢复或服务端写请求。

### 11.4 回归检查

```powershell
cd frontend
pnpm test -- --run
pnpm lint
pnpm build

cd ..
git diff --check
```

后端没有代码或契约变化，本任务不要求新增后端测试；仍需确认前端现有版本历史与 T013 编辑器测试无回归。

## 12. 文档同步计划

编码完成后同步更新：

- `docs/tech/tech-design.md`：增加历史版本本地文档导出交互、浏览器保存策略与实施状态。
- `docs/tech/api-contract.md`：明确版本接口现有 `content.text` 可作为客户端导出来源，且不新增导出 API。
- `docs/tech/data-model.md`：明确导出文件不是持久化业务实体，不改变 artifact/version/draft 生命周期。
- 本文档：实施完成后更新状态、完成日期和验收清单。

## 13. 不在本任务范围

- 导出当前未保存草稿。
- 导出 PDF、DOCX、HTML、JSON、SSML 或音频。
- 批量导出多个版本或生成 ZIP。
- 服务端生成、存储或提供下载文件。
- 在导出文件中加入时间、模型、目标时长等元数据。
- 把脚本标签转换为中文显示名、阿里云原生标签或结构化 JSON。
- 把导出标题写回脚本产物或版本。
- 导入导出后的 TXT / Markdown 文件。
- 应用内检测重名、自动追加 `(1)` 或管理导出记录。

## 14. 验收标准

- [x] 版本历史中选择已保存版本后，预览标题栏出现与“恢复为草稿”并列的“导出文档”按钮；未选择时不显示。
- [x] 点击按钮打开独立导出弹窗，并冻结正确版本；不支持工作草稿导出。
- [x] 默认标题为 `{产物名}-v{版本号}-{MMDD}-{HHmm}`，使用浏览器本地时间，用户可编辑且不修改服务端数据。
- [x] 标题必填、单行、trim 后 1～100 字符；正文标题保留用户字符，文件名安全清理 Windows 非法字符。
- [x] 默认 Markdown，可切换 TXT；最终文件名直接为 `{用户标题}.md|.txt`，不额外追加版本号。
- [x] MD 使用一级标题，TXT 使用首行标题；标题与正文间一个空行，正文原始空白和全部脚本标签保持不变，文件结尾一个换行。
- [x] 文件使用 UTF-8 且无 BOM，不包含创建时间、模型、时长等额外元数据。
- [x] 系统另存为、用户取消、浏览器下载回退和异常路径行为正确；浏览器自行处理重名。
- [x] 导出成功只关闭导出弹窗，版本历史及选中版本保持；失败保留输入，关闭版本历史同步清理导出状态。
- [x] 导出过程不触发草稿保存、版本恢复或任何后端写请求。
- [x] 技术文档同步，前端 test/lint/build 与 `git diff --check` 全部通过。
