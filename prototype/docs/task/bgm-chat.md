# 背景音生成 · 输入区对话化（Agent 形态）改造任务文档

版本：V1.0
创建日期：2026-08-25
依据文档：`prototype/docs/prd/prd.md`（PRD V2.2 · 3.4 背景音/纯音乐生成）、`prototype/docs/task/meditation-chat.md`、`prototype/docs/task/podcast-chat.md`（同构改造，均已完成）
关联页面：`prototype/bgm.html`

---

## 1. 背景与目标

背景音生成页现为「表单式输入」（6 个风格卡片 + 融合指令输入 + 1-10 分钟滑块 + 段落结构复选框 + 生成按钮）。
本次改造与前两页同构：输入区升级为**主流 Agent 对话框形态**，自然语言对话交互，工具栏只保留分钟参数、格式参数（MP3/WAV）、音乐模型切换，加输入框与发送按钮。

**生成结果区域（右栏）保持不变**：进度动画、波形试听（含段落标注）、播放控制、入库、送最终合成全部沿用现状。

---

## 2. 已确认决策记录

| # | 决策点 | 结论 |
|---|--------|------|
| C1 | 模型切换语义 | **音乐生成模型（非 LLM）**：新建 `MUSIC_MODELS` = MiniMax Music 2.5+（主）/ 版权素材库匹配（备），正好对应 PRD 3.4 主备两方案；徽标与产物 `params.model` 记录，不模拟模型间差异 |
| C2 | 时长控件形态 | **紧凑滑块**：保留 1-10 分钟连续调节（BGM 为连续值场景），置于 composer 工具栏，新增紧凑变体样式 |
| C3 | 段落结构承载 | **自然语言解析**：从消息中识别结构关键词（见 3.4），未提及时为均匀结构（Loop）；结果区 chips 继续展示结构 |
| C4 | 分钟/格式控件来源 | **控件为唯一来源**：时长与格式只认工具栏控件，不从自然语言解析（沿用先例） |
| C5 | 格式参数作用 | **仅记录**：格式为导出意向（结果区 chip + 产物 params），原型无真实文件导出，切换不影响波形试听。**⚠ 用户未明确确认，默认按推荐处理** |
| C6 | stale 机制 | **移除**：对话式下参数仅在发送时生效，「参数已变化」横幅成为死代码；仅删除死分支，结果区结构不变 |
| C7 | 风格识别 | `matchStyle` 按 `MUSIC_STYLES[].keywords` 匹配；未命中走默认风格（古风禅意），AI 气泡注明「未识别到具体风格，按默认风格生成」 |
| C8 | 融合指令展示 | 融合 chip 与产物 params 改用 `resolveFusion().note` 摘要（如「笛箫旋律线 + 环境底噪」），不再展示整条消息原文 |

---

## 3. 交互方案

### 3.1 布局（与前两页同构，复用 chat 组件样式）

```
┌─────────────────────────┬─────────────────────────┐
│ 对话卡（左栏，改造）      │ 生成结果卡（右栏，不动）  │
│ ┌─────────────────────┐ │                         │
│ │ 消息流（内部滚动）    │ │  进度动画（5 步）       │
│ │  空态：欢迎语        │ │  / 空态 /              │
│ │       + 建议提示词   │ │  param chips           │
│ │  user 气泡（右对齐） │ │  （含格式 chip）        │
│ │  assistant 气泡     │ │  + 融合说明 note       │
│ │   · 生成中：当前步骤 │ │  + 波形 + 播放器       │
│ │   · 完成：模型徽标   │ │  + 入库 / 送最终合成    │
│ │     + 摘要 + 引导语  │ │  （与现状一致，         │
│ ├─────────────────────┤ │   仅去 stale 死分支）   │
│ │ composer（底部固定） │ │                         │
│ │  工具栏：时长紧凑滑块 │ │                         │
│ │   + 格式 segmented   │ │                         │
│ │   + 模型下拉         │ │                         │
│ │  输入框 + 发送按钮    │ │                         │
│ └─────────────────────┘ │                         │
└─────────────────────────┴─────────────────────────┘
```

### 3.2 对话流细节

- **空态**：欢迎语（说明能力：描述风格/氛围/融合元素/段落结构，生成纯音乐背景音轨）+ 建议提示词：
  - 「来一段古风禅意的背景音乐，加上笛子和雨声」
  - 「做一段自然氛围的冥想背景音，要有海浪声」
  - 「来点电子氛围的专注工作背景音」
  - 「生成一段钢琴抒情的安静背景音，带前奏和收尾」
  - 点击建议词 → 填入输入框（不直接发送）
- **user 气泡**：右对齐，显示用户原文
- **assistant 气泡**（带音乐模型徽标）：
  - 生成中：typing 动画 + 当前步骤（`GEN_STEPS` 沿用现 5 步，语义本就是音乐渲染流程）
  - 完成摘要：「已生成「古风禅意」背景音轨 —— X 分钟，结构：Intro / Drop，融合：笛箫旋律线 + 环境底噪。可在右侧试听，或直接送去最终合成。」（未识别风格时注明默认风格；无融合时省略融合段）
  - 不重复渲染音频信息（右栏是唯一结果区）
- **历史消息**：可滚动回看；每次发送触发新一次生成并重置右栏结果

### 3.3 composer 结构

- 工具栏（一行，可换行）：
  - 时长：紧凑滑块（1-10 分钟，默认 3），带数值显示
  - 格式：segmented 二选一（MP3 / WAV，默认 MP3）
  - 模型下拉：`MUSIC_MODELS`（默认 MiniMax Music 2.5+）
- 输入框：textarea 自适应高度（1~4 行），placeholder「描述你想要的背景音乐：风格、氛围、融合元素、段落结构……」
- 发送按钮：Enter 发送 / Shift+Enter 换行；空输入禁发；生成中禁发

### 3.4 自然语言解析（mock 层，确定性规则）

| 解析项 | 规则 | 兜底 |
|--------|------|------|
| 风格 `matchStyle` | `MUSIC_STYLES[].keywords` 任一命中（古风/禅意/笛子/国风、电子/氛围/合成器/赛博、钢琴/抒情/琴键、自然/森林/海浪/雨/风、民谣/吉他/轻快/旅行、深空/冥想/宇宙/低频） | 默认「古风禅意」，气泡注明 |
| 段落 `parseStructure` | Intro/前奏/引入 → intro；Build Up/递进/铺垫 → buildup；Drop/高潮/爆点 → drop；Outro/收尾/回落 → outro；按规范顺序排列 | 未提及 = 均匀结构（Loop） |
| 融合 | 复用 `resolveFusion(整条消息)`（笛/箫→旋律线、电子/合成→琶音、雨/海/风/森林→底噪、鼓/节奏/律动→律动加强） | 无命中 = 无融合 |

生成链路复用 `AudioEngine.renderMusic({ style, fusion, duration: 分钟×60, structure, seedKey })`，seedKey 用解析后参数（`styleId|fusionNote|duration|structure`）保证确定性。

### 3.5 状态设计（bgm.js）

| 字段 | 变化 |
|------|------|
| `styleId` / `fusionText` / `structure` / `stale` | **移除**（由每次发送解析；stale 见 C6） |
| `messages` | **新增**：`[{ role, text, pending?, meta?: { model, modelName, styleName, structure, fusionNote, duration } }]` |
| `model` / `format` / `input` | **新增**：音乐模型 id / 'mp3' \| 'wav' / 输入框受控文本 |
| `duration` | 保留（默认 3，控件改紧凑滑块） |
| `generating` / `stepDone` / `progress` / `result` / `savedId` | 保留，语义不变（result.params 增 format/model/modelName/input） |

### 3.6 产物入库

- `params` 新增 `format` / `model` / `modelName` / `input`；`fusionText` 改存融合摘要 note（C8）；其余（styleId/styleName/duration/structure）不变
- 产物命名沿用 `背景音 · ${styleName}（${duration}分钟）`

---

## 4. 改动范围（文件级）

| 文件 | 改动 | 不动 |
|------|------|------|
| `js/common/mock.js` | 新增 `MUSIC_MODELS` + `musicModelById`、`matchStyle`、`parseStructure` 并导出 | `MUSIC_STYLES` / `resolveFusion` / `fakeTask` / 冥想播客相关均不动 |
| `js/pages/bgm.js` | 左栏重构为对话组件；`doGenerate` 改为 `sendMessage`（解析风格/结构/融合 → 走原渲染链路）；移除 stale 死分支；结果区补「格式」chip；直接规避前两页已修 bug（局部刷新重绑、`doSave` 箭头包裹） | `renderResultArea` 主体、波形绘制、播放器、`drawWave`/`refreshTransport`/`startLoop`、入库、送合成 handoff 均不动 |
| `bgm.html` | page-desc 文案同步 | — |
| `css/main.css` | 新增工具栏紧凑滑块样式（少量）；其余复用 chat 组件样式 | 现有样式全部保留 |
| 其他页面 | 零改动 | — |

---

## 5. 任务分解

### BC1 Mock 层（mock.js）

**内容**
- `MUSIC_MODELS`（MiniMax Music 2.5+ / 版权素材库匹配）+ `musicModelById`
- `matchStyle(input)` → `{ style, matched }`（C7 规则）
- `parseStructure(input)` → 结构 id 数组（C3 规则）

**验收标准**
- 控制台可访问新函数；风格/结构关键词命中与兜底行为符合规则

### BC2 页面重构（bgm.js + bgm.html + main.css 少量）

**内容**
- state 改造（见 3.5）
- 左栏对话渲染：空态（欢迎语 + 建议词）、消息流、composer（紧凑滑块 + 格式 segmented + 模型下拉）
- 发送交互：Enter/按钮发送、空输入禁发、生成中禁发、建议词点击填入
- 发送时解析风格/结构/融合并走 `renderMusic`；完成后填充摘要气泡；结果区补格式 chip、去 stale 分支
- `doSave` params 扩展（3.6）；page-desc 文案更新；紧凑滑块样式

**验收标准**
- 见第 6 节总验收清单

### BC3 联调验收

**内容**
- 本页全流程走查（风格命中/兜底 × 结构解析 × 融合识别 × 格式/时长/模型切换 × 播放试听）+ 冥想/播客页回归（mock 改动零影响）+ 最终合成 handoff / 产物库确认

---

## 6. 验收标准（总清单）

- [ ] 空态显示欢迎语 + 建议提示词，点击填入输入框
- [ ] 风格关键词命中正确（如「古风禅意…笛子和雨声」→ 古风禅意风格 + 融合 note「笛箫旋律线 + 环境底噪」）
- [ ] 未命中风格关键词时走默认风格，AI 气泡注明「按默认风格生成」
- [ ] 结构关键词解析正确（「带前奏和收尾」→ Intro / Outro；未提及 → 均匀结构 Loop；chips 展示一致）
- [ ] 时长紧凑滑块（1-10 分钟）调节后发送，波形时长与 chips 一致；格式 segmented 切换体现在 chips 与产物 params
- [ ] 模型切换 → 下次生成气泡徽标与产物 params 记录正确（MiniMax Music 2.5+ / 版权素材库匹配）
- [ ] Enter 发送 / Shift+Enter 换行；空输入禁发；生成中发送按钮禁用
- [ ] 生成中：右栏进度动画正常，assistant 气泡同步显示当前步骤
- [ ] 完成后：波形渲染、段落标注、播放/暂停/进度刷新正常；多次发送历史可回看且右栏重置（savedId 重置）
- [ ] 入库产物 `params` 含 `format` / `model` / `modelName` / `input` / `fusionText`（摘要）；送最终合成后 handoff 预选正常
- [ ] 全程无控制台报错、无网络请求；冥想/播客页回归正常

---

## 7. 明确不做（Out of Scope）

- 不从自然语言解析时长与格式（C4：控件为唯一来源）
- 不做真实音频文件导出（C5：格式仅记录）
- 不模拟音乐模型间差异（C1：仅徽标与 params）
- 不做多轮追问微调（沿用单轮触发式决策）
- 结果区除「格式」chip 与 stale 死分支移除外不做任何改动（C5/C6）
