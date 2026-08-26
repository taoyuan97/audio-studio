# 全局设置页 · 大模型统一配置 任务文档

版本：V1.0
创建日期：2026-08-25
依据文档：`prototype/docs/prd/prd.md`（PRD V2.2）、`prototype/docs/task/meditation-chat.md` / `podcast-chat.md` / `bgm-chat.md`（对话化改造，均已完成）
关联页面：`prototype/settings.html`（新建）、全部功能页

---

## 1. 背景与目标

各功能页的模型选择目前散落在页面内（冥想/播客 composer 的 LLM 下拉、TTS 页引擎下拉、BGM composer 音乐模型下拉），模型库写死在 mock.js。

本次新增**全局设置页**：侧边栏加入口，统一配置三大类模型参数，各功能页的下拉从「已启用模型池」取选项、以「默认模型」为初始值。

---

## 2. 已确认决策记录

| # | 决策点 | 结论 |
|---|--------|------|
| C1 | 设置页与页内下拉的关系 | **模型池模式**：设置页每类可启用多个模型并指定一个默认；各页下拉列出该类已启用模型，页内自行选择（初始 = 默认模型） |
| C2 | 音乐生成模型 | **仅 MiniMax music-3.0** 一项（移除版权素材库匹配选项；与 PRD 3.4 备选方案不符，以用户确认为准） |
| C3 | 保存交互 | **选中即保存**：开关切换 / 设默认 / API Key 输入均即时持久化，无保存按钮 |
| C4 | API Key | **每模型一个输入框，纯示意**：存储到本地设置，不真实连接、不做校验（placeholder 形如 `sk-...`） |
| C5 | 模型 id 稳定性 | TTS 引擎**保持现有 id**（`ali` / `volc`），仅更新显示名，避免破坏 `VOICES[].engine` 音色联动与既有产物数据 |
| C6 | 启用约束 | 每类**至少保留一个启用模型**：禁用最后一个时 toast 拦截；默认模型必须处于启用态（禁用默认模型时默认自动落到其余首个启用项） |
| C7 | 页内切换语义 | 各页下拉切换**只影响本页会话**，不回写全局默认（沿用现状，产物 params 记录实际生效模型） |

---

## 3. 模型库更新（mock.js）

| 类别 | 常量 | 变更后 |
|------|------|--------|
| 文本生成 | `LLM_MODELS` | DeepSeek（`deepseek`）/ **Kimi（`kimi`，新增）** / 通义千问（`qwen`），各含 `provider` + 一句话 `desc` |
| 语音合成 | `TTS_ENGINES` | Qwen-Audio-TTS（`ali`，显示名由「阿里云」更新）/ 火山引擎豆包 TTS（`volc`），id 不变 |
| 音乐生成 | `MUSIC_MODELS` | **仅 MiniMax music-3.0**（`minimax-music`，名称由「MiniMax Music 2.5+」更新；移除 `library` 项） |

`llmById` / `engineById` / `musicModelById` 兜底逻辑不变。

## 4. 设置数据模型（Store 扩展）

```js
// Store 持久化结构（localStorage，随现有 store key）
settings: {
  text:  { enabled: ['deepseek','kimi','qwen'], default: 'deepseek', keys: { deepseek:'', kimi:'', qwen:'' } },
  tts:   { enabled: ['ali','volc'],              default: 'ali',      keys: { ali:'', volc:'' } },
  music: { enabled: ['minimax-music'],           default: 'minimax-music', keys: { 'minimax-music':'' } },
}
```

- 新增 API：`Store.getSettings()`（带默认值兜底与结构容错）/ `Store.saveSettings(cat, patch)`
- 默认值：全部启用、默认取各类第一个模型、key 全空
- localStorage 不可用时降级内存（沿用现有 `Store.ok` 机制），设置页照常可用（刷新丢失）

## 5. 设置页设计（settings.html + settings.js）

### 5.1 布局

```
侧边栏                      设置页（3 栏）
┌──────────┐    ┌──────────────┬──────────────┬──────────────┐
│ 音频生产  │    │ 文本生成      │ 语音合成      │ 音乐生成      │
│  ·…      │    │ 剧本生成用    │ TTS 合成用    │ 背景音生成用  │
│ 系统      │    │ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │
│  设置 ⚙  │→   │ │DeepSeek  │ │ │Qwen-     │ │ │MiniMax   │ │
└──────────┘    │ │[默认][on]│ │ │Audio-TTS │ │ │music-3.0 │ │
                │ │key:sk-.. │ │ │[默认][on]│ │ │[默认][on]│ │
                │ └──────────┘ │ └──────────┘ │ └──────────┘ │
                │ │Kimi      │ │ │豆包 TTS   │ │              │
                │ │[off]     │ │ │[off]      │ │              │
                │ └──────────┘ │ └──────────┘ │              │
                │ │千问 …    │ │              │              │
                └──────────────┴──────────────┴──────────────┘
```

- 顶部说明条：启用的模型将出现在对应功能页的模型下拉中；此处配置仅本地示意（原型）
- 每栏卡片：栏标题 + 用途说明 + 模型卡片列表

### 5.2 模型卡片交互

- **卡片主体**（名称 + 供应商徽标 + 描述 + 「默认」徽标）：点击已启用的卡片 → 设为默认（即时保存，徽标移动）
- **启用开关**：切换即时保存；禁用默认模型时默认自动落到其余首个启用项；禁用最后一个启用项被拦截（toast）
- **API Key 输入框**：`type="text"` + placeholder `sk-...（示意）`，输入防抖保存，仅启用的模型展示输入框（禁用态隐藏，减少噪音）
- 所有变更轻量反馈（toast 或徽标动画），无保存按钮

## 6. 各功能页接入

| 页面 | 下拉选项来源 | 初始值 |
|------|--------------|--------|
| 冥想 / 播客 | `LLM_MODELS` ∩ 启用列表 | `settings.text.default` |
| TTS | `TTS_ENGINES` ∩ 启用列表 | `settings.tts.default`（音色联动逻辑不变） |
| BGM | `MUSIC_MODELS` ∩ 启用列表（当前仅 1 项） | `settings.music.default` |

- 页内切换仍只改本页 state，不回写全局（C7）
- 初始值模型若不在启用列表（异常数据），兜底取启用列表第一个

## 7. 改动范围（文件级）

| 文件 | 改动 | 不动 |
|------|------|------|
| `js/common/layout.js` | NAV 增「系统」组 + 设置项（新增齿轮图标） | 现有导航项 |
| `js/common/mock.js` | 三类模型库更新（见第 3 节） | `VOICES` / 生成逻辑 / `fakeTask` 等 |
| `js/common/store.js` | `getSettings` / `saveSettings` + 默认值容错 | artifacts / handoff 逻辑 |
| `settings.html` + `js/pages/settings.js` | **新建**：3 栏设置页 | — |
| `css/main.css` | 新增 `.grid-3`、模型卡片样式（复用现有 `switch`） | 现有样式 |
| `meditation.js` / `podcast.js` / `bgm.js` / `tts.js` | 下拉选项来源 + 初始值接入设置 | 其余逻辑零改动 |

## 8. 任务分解

### SC1 基础层（mock.js + store.js）

**内容**：三类模型库更新；`Store.getSettings/saveSettings` 与默认值容错

**验收**：控制台可读写设置并持久化；`llmById('kimi')` 等可查

### SC2 设置页（settings.html + settings.js + main.css + layout.js）

**内容**：侧边栏入口；3 栏页面；模型卡片（开关 / 默认 / API Key）全部即时保存交互

**验收**：见第 9 节清单前半部分

### SC3 各页接入（4 个页面 js）

**内容**：下拉选项过滤 + 初始值取默认模型

### SC4 联调验收

**内容**：设置页 ↔ 各页联动全流程 + 产物 params + 回归

## 9. 验收标准（总清单）

- [ ] 侧边栏「系统」组出现「设置」，点击进入设置页，当前项高亮
- [ ] 3 栏渲染：文本生成 3 个模型 / 语音合成 2 个 / 音乐生成 1 个（MiniMax music-3.0）
- [ ] 启用开关即时保存，刷新后保持；禁用某类最后一个启用模型被拦截并 toast 提示
- [ ] 点击已启用卡片设为默认，「默认」徽标即时移动并持久化；禁用默认模型后默认自动转移
- [ ] API Key 输入即时保存，刷新后保持（禁用模型不显示输入框）
- [ ] 禁用 Kimi 后，冥想/播客页下拉不再出现 Kimi；默认模型为初始选中项
- [ ] TTS 页引擎下拉跟随启用列表，音色联动正常；BGM 页下拉仅 MiniMax music-3.0
- [ ] 页内切换模型不回写全局默认；产物 params 记录实际生效模型
- [ ] 全程无控制台报错、无网络请求；四个功能页生成流程回归正常

## 10. 明确不做（Out of Scope）

- 不做真实 API 连接 / Key 校验（C4：纯示意）
- 不做模型高级参数（temperature、top_p 等）
- 不做多套 Key profile / 环境切换（生产/测试）
- 不改各页生成逻辑与产物结构（仅模型来源变化）
