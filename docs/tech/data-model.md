# 数据模型：Audio Studio 正式项目

## 1. 文档信息

- 版本：v1.9
- 状态：已确认（决策点 F2：完整定义）
- 创建日期：2026-08-26
- 变更记录：v1.9 明确 T014 导出文件及本次导出标题不是持久化业务实体，不改变脚本产物、版本与草稿生命周期
- 变更记录：v1.8 增加 T013 脚本情绪/语气词/停顿配置覆盖、`vocal` segment，并将人工草稿改为仅显式保存
- 变更记录：v1.7 扩展 T012 mix 参数快照：人声/背景独立倍速及有效时长语义
- 变更记录：v1.6 增加 T011 `tts_custom_voices` 按模型持久化音色库、试听验证状态、模型感知缓存与删除生命周期
- 变更记录：v1.5 明确仅 `settings.json` 中的浏览器凭据覆盖可按字段回显，`.env` 基线永不回显
- 变更记录：v1.4 增加 T007 `DATA_DIR/settings.json` 运行时配置覆盖的布局、优先级与敏感数据规则
- 变更记录：v1.3 增加 T009 `message_attachments` 文本参考附件表及生命周期
- 变更记录：v1.2 校准 T005：BGM 以自由 prompt 取代 style 枚举，structure_hints 为非确定性提示；music result_json 保存请求快照、远程结果与重试来源
- 变更记录：v1.1 增加 T003 的 `script_drafts`、`artifact_versions` 与 artifact 当前版本字段，并按实际实现将数据库访问方式校准为 sqlite3 同步短连接
- 关联文档：`docs/tech/tech-design.md`（总体设计）、`docs/tech/api-contract.md`（API 契约）
- 单一事实源：后端 `app/database.py`（DDL）、契约测试；前端 `types.ts` 按本文档映射

## 2. 总览

- 数据库：SQLite 单库（WAL 模式），路径 `DATA_DIR/audio.sqlite3`；sqlite3 同步短连接（每次操作短连接、写事务 `BEGIN IMMEDIATE`、`busy_timeout=5000`，不用 ORM）。
- 主键：`TEXT`，格式 `{前缀}_{unix毫秒}_{6位随机}`（如 `conv_1724660000_a1b2c3`），服务端生成。
- 时间戳：Unix 毫秒整数。
- JSON 字段：SQLite `TEXT` 存 JSON 字符串，读写经 json 序列化/反序列化。
- 正式项目数据从零开始，不迁移原型 localStorage 数据。

## 3. ER 关系

```text
conversations 1 ──── N messages
messages      1 ──── 0..3 message_attachments       [用户参考资料；assistant 为 0]
conversations 1 ──── 0..1 script_drafts           [工作草稿，不进入产物库]
conversations 1 ──── 0..1 artifacts(type=script_*)[逻辑脚本产物，用户首次保存创建]
artifacts    1 ──── N artifact_versions            [用户手动保存的不可变版本]
runs         N ──── 0..1 artifacts                [script run 的 artifact_id 为 null]
artifacts    0..N ─→ 引用 artifacts                [mix.params 引用 voice/bgm id，弱引用不约束删除]
tts_custom_voices  独立配置资源                    [按 engine+model+voice_id 唯一；产物只保存快照，不建外键]
```

## 4. 表结构

### 4.1 conversations（会话）

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  scene       TEXT NOT NULL,             -- 'meditation'（二期加 'podcast'）
  title       TEXT NOT NULL DEFAULT '未命名冥想',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_conversations_scene ON conversations(scene, updated_at DESC);
```

### 4.2 messages（消息）

```sql
CREATE TABLE messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,        -- 'user' | 'assistant'
  content          TEXT NOT NULL,        -- 消息正文（assistant 为生成的脚本文本）
  params_json      TEXT,                 -- user 消息参数快照；assistant 为 NULL
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at ASC);
```

`params_json`（user 消息）：

```json
{ "duration": 15, "model": "deepseek-chat" }
```

### 4.3 message_attachments（消息参考附件）

```sql
CREATE TABLE message_attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  media_type  TEXT NOT NULL,              -- text/markdown | text/plain
  size        INTEGER NOT NULL,            -- 服务端按 content UTF-8 编码计算的字节数
  content     TEXT NOT NULL,               -- LLM 使用的参考正文；消息列表 API 不返回
  position    INTEGER NOT NULL,            -- 同一消息内的选择顺序（从 0 开始）
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_message_attachments_message
  ON message_attachments(message_id, position ASC);
```

- user 消息与附件在同一事务写入；失败重试复用原附件，不复制记录。
- 消息分页批量加载附件元数据，正文仅供服务端组装 LLM 上下文。
- 删除会话时经 `messages` 外键级联删除；附件不复制进 script draft、artifact 或 version。

### 4.4 runs（全局运行任务）

```sql
CREATE TABLE runs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,        -- 'script' | 'tts' | 'music' | 'mixdown'
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,  -- 仅 script 线
  status           TEXT NOT NULL,        -- 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress_json    TEXT,                 -- 进度持久化（SSE 重连恢复）
  result_json      TEXT,                 -- 音乐线：远端结果（E8）；其余 NULL
  error_code       TEXT,                 -- failed 时非空（见 api-contract.md 第 12 节）
  error_message    TEXT,                 -- failed 时非空（脱敏后）
  artifact_id      TEXT,                 -- 耗时产物成功时指向产物；script run 为 NULL
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  finished_at      INTEGER
);
CREATE INDEX idx_runs_status ON runs(status, created_at ASC);
```

`progress_json`（按 kind）：

```json
// script：null（流式增量不落库，message.completed 落 messages）
// tts：    { "completed": 3, "total": 12, "stage": "synthesizing" }
// music：  { "completed": 0, "total": 1, "stage": "generating" }
// mixdown：{ "completed": 0, "total": 1, "stage": "prep" }
```

`result_json`（music 线，E8）：

```json
{
  "request": { "prompt": "...", "target_duration": 300, "structure_hints": ["intro"], "format": "mp3" },
  "audio_url": "https://...",
  "expires_at": 1724663600000,
  "request_id": "mm_...",
  "source_run_id": null
}
```

> 生成成功即下载持久化，`audio_url` 仅供失败 run 的 `retry=download` 免计费重下载使用。

### 4.5 artifacts（产物，单表多态）

```sql
CREATE TABLE artifacts (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,        -- 'script_meditation' | 'voice' | 'bgm' | 'mix'（二期加 'script_podcast'）
  name             TEXT NOT NULL,
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,  -- 仅脚本类型
  source_run_id    TEXT,                 -- 产出该产物的 run
  params_json      TEXT NOT NULL,        -- 生成参数快照（回溯用，按 type 见第 5 节）
  content_json     TEXT,                 -- 仅脚本类型（见第 5 节）
  audio_path       TEXT,                 -- 相对 DATA_DIR/audio 的路径；脚本类型 NULL
  audio_format     TEXT,                 -- 'mp3' | 'wav'；脚本类型 NULL
  duration         REAL,                 -- 秒（音频=实测 ffprobe；脚本=est_duration）
  current_version_id TEXT,               -- 脚本逻辑产物当前版本；音频为 NULL
  current_version_no INTEGER,            -- 脚本当前版本号；音频为 NULL
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_type ON artifacts(type, created_at DESC);
```

### 4.6 script_drafts（会话工作草稿）

```sql
CREATE TABLE script_drafts (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  source_run_id    TEXT,
  params_json      TEXT NOT NULL,
  content_json     TEXT NOT NULL,
  origin           TEXT NOT NULL,        -- generated | manual | restored
  revision         INTEGER NOT NULL,     -- 乐观并发控制，单调递增
  updated_at       INTEGER NOT NULL
);
```

草稿不属于产物库；AI 生成成功后原子替换 generated 草稿。人工输入先只存在前端内存，用户点击“保存草稿”或在 dirty 状态点击“完成编辑”后才写入 manual 草稿；版本恢复标记 restored。更新接口携带 `expected_revision`，不一致返回 409。关闭全屏不触发持久化，也不丢弃前端编辑状态。

### 4.7 artifact_versions（脚本不可变版本）

```sql
CREATE TABLE artifact_versions (
  id               TEXT PRIMARY KEY,
  artifact_id      TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_no       INTEGER NOT NULL,
  source_run_id    TEXT,
  params_json      TEXT NOT NULL,
  content_json     TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE(artifact_id, version_no)
);
```

版本只在用户手动保存时追加；artifact 的 content/params/duration 是当前版本物化快照，供既有产物库与 TTS 接口兼容读取。现有脚本 artifact 初始化时幂等迁移为 v1。

T014 导出的 Markdown/TXT 文件是浏览器根据所选不可变版本 `content.text` 临时生成的本地文件，不是业务实体。本次导出标题只存在于前端弹窗内存，不写入 SQLite、artifact/version/draft、浏览器持久化存储或服务端文件目录，因而不参与任何实体生命周期与级联删除。

### 4.8 tts_custom_voices（自定义 TTS 音色库）

```sql
CREATE TABLE tts_custom_voices (
  id                   TEXT PRIMARY KEY,
  engine               TEXT NOT NULL,
  model                TEXT NOT NULL,
  voice_id             TEXT NOT NULL,
  name                 TEXT,
  verification_status  TEXT NOT NULL DEFAULT 'unverified',
  last_checked_at      INTEGER,
  last_verified_at     INTEGER,
  last_error           TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE(engine, model, voice_id)
);
CREATE INDEX idx_tts_custom_voices_model
  ON tts_custom_voices(engine, model, created_at DESC);
```

- `id` 格式为 `cvoice_{unix毫秒}_{6位随机}`；API 使用内部 ID 做重命名、删除和验证，避免把 Provider 音色 ID 用作资源路径身份。
- `engine` 本期只允许 `aliyun`；字段保留是为了使模型绑定和唯一约束完整。
- `model` / `voice_id` 是创建后不可变的 Provider 身份；同一模型下 ID 唯一，不同模型可使用相同 ID。
- `name` 是可空显示名称；为空时 API 和界面回退显示完整 `voice_id`，名称本身无需唯一。
- `verification_status ∈ {unverified, verified, failed}`，表示最近一次真实试听验证结果而非永久有效性。
- `last_checked_at` 记录最近一次真实验证尝试；`last_verified_at` 记录最近一次成功时间。后续失败不会抹去过去成功时间。
- `last_error` 只保存经过脱敏和长度限制的 Provider 错误；成功后清空。
- 自定义音色与 run/artifact 不建外键。提交时把模型、ID、名称、来源复制进不可变请求快照，因此删除或重命名配置不会改写历史。
- 通过 `CREATE TABLE IF NOT EXISTS` 幂等升级旧 SQLite，不迁移或改写现有数据。

## 5. artifacts 多态 schema（params_json / content_json 完整定义）

### 5.1 type = script_meditation（冥想脚本）

`params_json`：

```json
{
  "topic": "深海放松",           // 用户主题输入
  "matched_topic": "深海放松",   // 命中的预设主题（自由输入时同 topic）
  "duration": 15,               // 目标时长档位 5|10|15|20|25|30（分钟）
  "model": "deepseek-chat"      // 最后一次生成的模型
}
```

`content_json`：

```json
{
  "text": "[emotion:asmr]欢迎来到今天的放松练习\n[vocal:sighing][停顿 3s]\n...",
  "segments": [                    // 后端 markers.py 解析结果（唯一事实源，前端不重复解析）
    { "kind": "speech", "text": "欢迎来到今天的放松练习", "emotion": "asmr", "speed": null },
    { "kind": "vocal", "tag": "sighing" },
    { "kind": "pause", "seconds": 3 },
    { "kind": "speech", "text": "请找一个舒适的位置坐下", "emotion": null, "speed": "慢速" }
  ],
  "est_duration": 302.5            // 预估总时长（秒）：语速档×字数 + 停顿求和（吸气4s/呼气5s）
}
```

> segments 元素：`kind ∈ {speech, pause, vocal}`；speech 可带 `emotion`（内部新标签保存规范化英文名，旧标签保留原值）、`speed`；pause 带折算后 `seconds`；vocal 带英文 `tag` 且预估时长权重为 0。`[吸气]`→`{kind:"pause", seconds:4}`、`[呼气]`→`{kind:"pause", seconds:5}`（E4）。

### 5.2 type = voice（人声干声）

`params_json`：

```json
{
  "scene": "meditation",                  // 'meditation' | 'podcast'（来源脚本自动判定或用户选择）
  "engine": "aliyun",                     // 'aliyun' | 'volc'
  "model": "qwen-audio-3.0-tts-plus",     // 引擎内模型
  "voice_id": "longanlingxin",
  "voice_name": "龙安灵心",
  "voice_source": "system",              // 'system' | 'custom'，提交时快照
  "speed": 0.8,                           // 0.5–1.5
  "pitch": null,                          // 引擎支持时 -12~12（半音），否则 null
  "script_artifact_id": "art_...",        // 来源脚本产物；裸文本提交时 null
  "format": "mp3"                         // 'mp3' | 'wav'
}
```

`content_json`：`null`（脚本文本经 script_artifact_id 追溯）。
`audio_path`：必有（`artifacts/{id}.mp3|.wav`）。

### 5.3 type = bgm（背景音乐）

`params_json`：

```json
{
  "provider": "minimax",           // 实际执行 Provider 快照
  "model": "music-3.0",            // 实际模型快照
  "prompt": "笛箫与柔和电子氛围融合，节奏缓慢，动态平稳", // 用户自由描述
  "target_duration": 300,           // 目标时长（秒，60–600，后处理保证）
  "structure_hints": ["intro", "outro"], // 非确定性结构提示（可空数组）
  "format": "mp3",                  // 导出格式
  "source_duration": 180.2           // Provider 源音频时长（可 null）
}
```

`content_json`：`null`。`audio_path`：必有。

### 5.4 type = mix（混音成品）

`params_json`：

```json
{
  "voice_artifact_id": "art_...",   // 可 null（纯音乐导出）；弱引用，源删除后保留 id 作历史记录
  "bgm_artifact_id": "art_...",     // 可 null
  "voice_speed": 1.0,               // 0.5–2.0；未选人声时规范化为 1.0
  "bgm_speed": 1.0,                 // 0.5–2.0；未选背景时规范化为 1.0
  "voice_gain": 80,                 // 0–100
  "bgm_gain": 45,                   // 0–100
  "bgm_offset": 0,                  // 0–60 秒
  "ducking": true,                  // 模式 B 闪避开关
  "format": "mp3"
}
```

`content_json`：`null`。`audio_path`：必有。

倍速是 mix 成品的非破坏性处理快照，不修改所引用的 voice/bgm 产物。双轨 `audio.duration` 约等于 `voice 源时长 / voice_speed`；仅单轨时约等于对应源时长除以对应倍速。历史 mix 产物可能没有 `voice_speed`/`bgm_speed`，读取和展示时按 `1.0` 兼容，不执行数据迁移。

## 6. 文件布局（DATA_DIR）

```text
DATA_DIR/
├─ settings.json             # T007 浏览器运行时配置覆盖（含凭据，不入库/不提交 Git）
├─ audio.sqlite3
└─ audio/
   ├─ artifacts/
   ├─ previews/
   └─ peaks/
```

`settings.json` 不是业务数据表：保存 revision 与浏览器设置的字段级覆盖值，由 `SettingsStore` 整体校验后通过同目录临时文件 + `os.replace` 原子写入。读取优先级为运行时文件 > `.env` > 默认值。除 Provider/runtime 字段外，T013 增加 `script_emotion_tags`、`script_vocal_tags`、`script_pause_presets` 三个完整快照字段；标签项结构为 `{name,label,enabled}`，前两类各最多 20 项，停顿最多 20 个整数且每项 1–300 秒。状态 API 只返回掩码、来源和可回显字段名；脚本配置由独立无缓存端点读取。专用 reveal API 可按字段返回本文件中的浏览器凭据覆盖，但绝不读取或回退到 `.env`，响应禁止缓存。该文件属于本机敏感数据，生命周期随 `DATA_DIR`，备份和迁移时须按凭据文件处理。

### 6.1 音频文件布局（DATA_DIR/audio/）

```text
data/
├─ audio.sqlite3
└─ audio/
   ├─ artifacts/{artifact_id}.mp3|.wav    # 音频产物（voice/bgm/mix）
   ├─ previews/{engine}_{sha256(engine\0model\0voice_id)}.wav # 模型感知的音色试听缓存
   └─ peaks/{artifact_id}.json            # 波形峰值缓存（{peaks:[...], duration, buckets}）
```

## 7. 生命周期与清理规则

| 操作 | 联动清理 |
|---|---|
| `DELETE /api/artifacts/{id}` | 级联删除脚本历史版本；音频另删 `artifacts/{id}.*` + `peaks/{id}.json`；mix.params 中弱引用保留 |
| 会话删除（本期无此入口） | messages 级联；脚本产物 `conversation_id` 置 NULL（产物保留在库） |
| 系统音色试听缓存 | 模型感知缓存，普通试听永久复用；仅手动清 DATA_DIR 时移除 |
| 自定义音色试听缓存 | 普通试听复用；强制重新验证原子替换；删除本地自定义音色记录时同步移除，不影响正式音频 |
| 峰值缓存 | 与产物同生命周期；产物 PATCH 脚本编辑（无音频）不影响 |
| 失败/取消 run | 中间临时文件即删（`.part`/中间段 WAV 不落 DATA_DIR/audio/artifacts 命名空间） |
| 服务重启 | queued/running run 启动时标记 failed（`code: RUN_INTERRUPTED`，文案"服务重启中断，请重新提交"），已完成产物不受影响 |

## 8. 并发与一致性

- 全局单写者：run worker 单协程串行执行（C3），SQLite 写冲突主要来自 API 请求（创建/编辑）与 worker 终态写入——统一经数据库访问层的写队列（同一线程池串行化）。
- WAL 模式：读不阻塞写。
- 音频文件原子落盘：`.part` 临时文件 → `os.replace`（移植规范）；数据库记录在文件落盘成功后写入，保证 `audio_path` 指向的文件必存在。
- 自定义音色真实验证先写/校验 `.part` 再替换缓存，随后更新验证状态；失败保留旧缓存并记录脱敏失败状态。
- TTS run 在提交时冻结 `model/voice_id/voice_name/voice_source`。执行阶段读取当前凭据，但不得用最新全局模型覆盖任务模型快照。
