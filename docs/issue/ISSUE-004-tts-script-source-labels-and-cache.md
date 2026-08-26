# ISSUE-004：TTS 脚本来源无法按当前会话标题识别，保存后列表缓存未失效

## 1. 缺陷信息

- 状态：已修复
- 优先级：P0（影响 TTS 主路径选择正确脚本）
- 发现日期：2026-08-26
- 影响范围：`frontend/src/pages/TtsPage.tsx`、`frontend/src/pages/MeditationWorkspacePage.tsx`、`frontend/src/features/tts/form.ts`
- 关联任务：T003（脚本保存/版本）、T004（TTS 脚本来源）

## 2. 用户现象

TTS 人声合成工作台的「产物库脚本」下拉中，无法正常识别全部冥想脚本。用户反馈缺少：

- 应对亲密关系冲突
- 缓解工作压力

实际表现是多个选项都显示为“未命名冥想·脚本”，用户无法判断它们分别属于哪个冥想会话，因而看起来像脚本缺失。

## 3. 定位证据与根因

### 3.1 数据和后端查询正常

SQLite 中两个脚本均存在，且 `list_artifacts(type="script_meditation")` 返回全部 3 个正式脚本产物：

| 当前会话标题 | artifact id | artifact 名称 | 版本 |
| --- | --- | --- | --- |
| 应对亲密关系冲突 | `art_1787718369272_515894` | 未命名冥想·脚本 | v3 |
| 缓解工作压力 | `art_1787712082844_226d4f` | 未命名冥想·脚本 | v1 |

当前数据量仅 3 条，远低于 artifacts API 默认 200 条上限；不存在后端过滤、limit 截断或 React Query key 形状冲突。

### 3.2 主根因：展示只使用历史 artifact 名称

脚本首次保存时 artifact 名称独立存储。会话后来重命名为主题名称，不会级联修改 artifact 名称，这是合理的数据边界——artifact 支持独立重命名，强制级联可能覆盖用户命名。

TTS 下拉当前标签仅由以下内容组成：

```text
artifact.name · artifact.updated_at
```

没有使用 artifact 已携带的 `conversation_id` 去关联当前会话标题，因此多个历史名称相同的 artifact 无法区分。

### 3.3 次要根因：保存脚本后 artifacts 缓存未失效

工作台成功保存脚本版本后只失效 `conversation` 与 `script-versions` query，没有失效 `artifacts`。用户曾进入 TTS 页时，保存新脚本后立即返回，可能在 query staleTime 窗口内继续看到旧列表。

### 3.4 易产生问题的数据入口

首次保存弹窗只把会话标题作为 placeholder，实际输入值为空且必须人工输入。用户可能保存为通用名称，后续再重命名会话，进一步产生 artifact 名称与当前主题脱节。

## 4. 修复方案（已确认）

1. TTS 页同时查询冥想脚本 artifacts 与当前冥想会话列表。
2. 用 `artifact.conversation_id` 关联当前会话标题。
3. 下拉主标题使用当前会话标题；副信息显示 artifact 名称、版本号和更新时间。
4. 会话不存在或 `conversation_id=null` 时回退 `artifact.name`，保证孤立产物仍可选择。
5. artifacts 与 conversations 查询均显式请求当前 API 最大 `limit=500`，query key 纳入 limit，避免不同参数共享缓存。
6. 保存脚本版本成功后失效 `['artifacts']`，保证 TTS 列表立即刷新。
7. 首次保存弹窗预填 `{当前会话标题}·脚本`，用户仍可编辑。
8. 不批量改名、不迁移现有 artifact；不在会话重命名时级联覆盖 artifact 名称。

## 5. 测试方案

- 单元测试：两个 artifact 名称相同但关联不同会话时，选项主标题分别使用对应会话标题。
- 单元测试：`conversation_id` 为空或关联会话不存在时回退 artifact 名称。
- 单元测试：副信息包含 artifact 名称与版本号。
- 前端回归：保存脚本成功后触发 artifacts query 失效。
- 构建与 ESLint：确保 Ant Design Select 自定义选项类型和渲染合法。

## 6. 验收标准

- [x] 下拉通过 `conversation_id` 映射，可明确显示“应对亲密关系冲突”和“缓解工作压力”。
- [x] 同名 artifact 以当前会话标题作为主标签，不再造成视觉上的脚本缺失。
- [x] 选项可见当前会话标题、artifact 名称、版本与更新时间。
- [x] 新脚本保存后失效 `['artifacts']`，返回 TTS 页面可立即刷新。
- [x] 孤立脚本产物通过单元测试确认回退 artifact 名称。
- [x] 未执行数据库迁移，现有 artifact 名称与版本数据未修改。

## 7. 实施记录

- TTS artifacts 与 conversations 均显式请求 `limit=500`，query key 纳入 limit。
- 新增 `buildScriptSourceOptions()`，集中处理当前会话标题、孤立产物回退、版本和搜索文本。
- Select 支持按当前会话标题、artifact 名称和版本搜索，并以双行选项展示详细信息。
- 首次保存脚本预填 `{当前会话标题}·脚本`，仍允许用户编辑。
- 保存成功后增加 artifacts query 失效。
- 新增 2 项缺陷专项单元测试；前端全量 29 tests passed，生产构建和 ESLint 通过。
