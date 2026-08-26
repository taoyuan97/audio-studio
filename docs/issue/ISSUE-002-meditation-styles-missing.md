# ISSUE-002 冥想会话列表与工作台业务样式缺失

- 日期：2026-08-26
- 状态：已修复
- 严重级别：高（核心页面可操作但布局和视觉层级失效）
- 发现方式：冥想会话列表页与工作台页视觉验收

## 一、缺陷现象

- `/meditation` 中会话标题呈现为浏览器默认白底按钮，列表缺少容器、间距和交互状态。
- `/meditation/:conversationId` 未形成双栏工作台，聊天区和结果区上下堆叠。
- 消息气泡、输入 composer、生成进度、脚本标记徽章与时间轴等业务样式均未生效。
- 页面仍有暗色背景，Ant Design 组件本身也有主题样式，因此并非整份 CSS 加载失败。

## 二、定位分析

- `frontend/src/main.tsx` 已正常导入 `styles/global.css`。
- `frontend/src/styles/global.css` 仅包含主题变量、基础布局、专注模式和时长选择器样式，在第 195 行结束。
- `MeditationListPage`、`MeditationWorkspacePage`、`MessageList`、`ScriptView` 使用的 `page-*`、`conv-*`、`workspace-*`、`msg-*`、`composer-*`、`script-*`、`timeline-*` 等选择器均无对应规则。
- 原型中存在相关视觉语义，但正式项目迁移时没有补齐业务页面样式。

结论：根因是冥想模块业务 CSS 缺失，不是导入路径、Vite 构建或 Ant Design 主题配置问题。

## 三、修复决策

1. 专注模式内容最大宽度由 `960px` 调整为 `1200px`，改善桌面双栏空间。
2. 延续现有暗夜视觉体系，以 Ant Design 组件与主题 token 为主。
3. 原型只作为布局和信息层级参考，不做逐像素复刻。
4. 新增作用域明确的冥想模块样式，避免通用类名影响后续 TTS、BGM 等页面。
5. 桌面使用双栏布局，窄屏降级为单栏。

## 四、修复范围

| 文件 | 计划修改 |
| --- | --- |
| `frontend/src/styles/global.css` | 调整专注模式最大宽度和基础盒模型 |
| `frontend/src/styles/meditation.css` | 新增列表、工作台、消息、composer、生成态、脚本结果和响应式样式 |
| `frontend/src/main.tsx` | 引入冥想模块样式 |
| `frontend/src/pages/MeditationListPage.tsx` | 为列表页增加作用域根类名 |

不修改会话、流式生成、脚本解析和编辑等业务逻辑。

## 五、验收清单

- [x] 会话列表标题不再呈现浏览器默认按钮外观
- [x] 桌面工作台为双栏，内容区最大宽度为 `1200px`
- [x] `900px` 以下工作台切换为单栏，移动端间距和 composer 自动换行
- [x] 消息、composer、生成态、失败态、脚本徽章和时间轴样式完整
- [x] 保留 Ant Design 暗色主题、组件状态和焦点交互
- [x] `npm run lint`、`npm run build`、`npm run test -- --run` 通过（23/23）

## 六、验证结果

- TypeScript 与 Vite 生产构建通过。
- ESLint 通过，无新增静态检查问题。
- Vitest 共 4 个测试文件、23 项用例全部通过。
- `git diff --check` 通过。
- 冥想列表和工作台关键 class 静态覆盖检查通过；新增选择器均限定在 `.meditation-list-page` 或 `.workspace-grid` 下。
- Vite 仍提示主 JS chunk 超过 500 kB；这是既有依赖打包提示，与本次 CSS 修复无关。
