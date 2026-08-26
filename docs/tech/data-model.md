# 数据模型：Audio Studio 正式项目

## 1. 文档信息

- 版本：v1.0
- 状态：已确认（决策点 F2：完整定义）
- 创建日期：2026-08-26
- 关联文档：`docs/tech/tech-design.md`（总体设计）、`docs/tech/api-contract.md`（API 契约）
- 单一事实源：后端 `app/database.py`（DDL）、契约测试；前端 `types.ts` 按本文档映射

## 2. 总览

- 数据库：SQLite 单库（WAL 模式），路径 `DATA_DIR/audio.sqlite3`；sqlite3 + 线程池执行（同 article-studio，不用 ORM）。
- 主键：`TEXT`，格式 `{前缀}_{unix毫秒}_{6位随机}`（如 `conv_1724660000_a1b2c3`），服务端生成。
- 时间戳：Unix 毫秒整数。
- JSON 字段：SQLite `TEXT` 存 JSON 字符串，读写经 json 序列化/反序列化。
- 正式项目数据从零开始，不迁移原型 localStorage 数据。

## 3. ER 关系

```text
conversations 1 ──── N messages
conversations 1 ──── 1 artifacts(type=script_*)   [会话 1:1 脚本产物，原地更新]
runs         N ──── 0..1 artifacts                [run 成功产出产物；runs.artifact_id]
artifacts    0..N ─→ 引用 artifacts                [mix.params 引用 voice/bgm id，弱引用不约束删除]
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

### 4.3 runs（全局运行任务）

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
  artifact_id      TEXT,                 -- completed 时指向产出产物
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
{ "audio_url": "https://...", "expires_at": 1724663600000, "request_id": "mm_..." }
```

> 生成成功即下载持久化，`audio_url` 仅供失败 run 的 `retry=download` 免计费重下载使用。

### 4.4 artifacts（产物，单表多态）

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
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_artifacts_type ON artifacts(type, created_at DESC);
```

## 5. artifacts 多态 schema（params_json / content_json 完整定义）

### 5.1 type = script_meditation（冥想脚本）

`params_json`：

```json
{
  "topic": "深海放松",           // 用户主题输入
  "matched_topic": "深海放松",   // 命中的预设主题（自由输入时同 topic）
  "duration": 15,               // 目标时长档位 5|15|30（分钟）
  "model": "deepseek-chat"      // 最后一次生成的模型
}
```

`content_json`：

```json
{
  "text": "欢迎来到今天的放松练习 [情绪:温柔]\n[停顿 3s]\n...",
  "segments": [                    // 后端 markers.py 解析结果（唯一事实源，前端不重复解析）
    { "kind": "speech", "text": "欢迎来到今天的放松练习", "emotion": "温柔", "speed": null },
    { "kind": "pause", "seconds": 3 },
    { "kind": "speech", "text": "请找一个舒适的位置坐下", "emotion": null, "speed": "慢速" }
  ],
  "est_duration": 302.5            // 预估总时长（秒）：语速档×字数 + 停顿求和（吸气4s/呼气5s）
}
```

> segments 元素：`kind ∈ {speech, pause}`；speech 可带 `emotion`（原标记值）、`speed`（原标记值）；pause 带折算后 `seconds`。`[吸气]`→`{kind:"pause", seconds:4}`、`[呼气]`→`{kind:"pause", seconds:5}`（E4）。

### 5.2 type = voice（人声干声）

`params_json`：

```json
{
  "scene": "meditation",                  // 'meditation' | 'podcast'（来源脚本自动判定或用户选择）
  "engine": "aliyun",                     // 'aliyun' | 'volc'
  "model": "qwen-audio-3.0-tts-plus",     // 引擎内模型
  "voice_id": "loongstella",
  "voice_name": "龙婉",
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
  "style": "zen_gufeng",            // 预设风格 id
  "style_name": "古风禅意",         // 展示名快照
  "description": "笛子+电子氛围",    // 自由描述（可 null）
  "duration": 300,                  // 目标时长（秒，60–600，后处理保证）
  "structure": ["intro", "outro"],  // 段落结构（可空数组）
  "format": "mp3",                  // 导出格式
  "model": "music-3.0"              // MiniMax 模型快照
}
```

`content_json`：`null`。`audio_path`：必有。

### 5.4 type = mix（混音成品）

`params_json`：

```json
{
  "voice_artifact_id": "art_...",   // 可 null（纯音乐导出）；弱引用，源删除后保留 id 作历史记录
  "bgm_artifact_id": "art_...",     // 可 null
  "voice_gain": 80,                 // 0–100
  "bgm_gain": 45,                   // 0–100
  "bgm_offset": 0,                  // 0–60 秒
  "ducking": true,                  // 模式 B 闪避开关
  "format": "mp3"
}
```

`content_json`：`null`。`audio_path`：必有。

## 6. 文件布局（DATA_DIR/audio/）

```text
data/
├─ audio.sqlite3
└─ audio/
   ├─ artifacts/{artifact_id}.mp3|.wav    # 音频产物（voice/bgm/mix）
   ├─ previews/{engine}_{voice_id}.wav    # 音色试听缓存（固定短句，一次合成永久回放）
   └─ peaks/{artifact_id}.json            # 波形峰值缓存（{peaks:[...], duration, buckets}）
```

## 7. 生命周期与清理规则

| 操作 | 联动清理 |
|---|---|
| `DELETE /api/artifacts/{id}` | 删 `artifacts/{id}.*` 音频 + `peaks/{id}.json`；mix.params 中的弱引用 id 保留（前端展示"已删除"） |
| 会话删除（本期无此入口） | messages 级联；脚本产物 `conversation_id` 置 NULL（产物保留在库） |
| 音色试听缓存 | 永久保留（免计费回放）；仅手动清 DATA_DIR 时移除 |
| 峰值缓存 | 与产物同生命周期；产物 PATCH 脚本编辑（无音频）不影响 |
| 失败/取消 run | 中间临时文件即删（`.part`/中间段 WAV 不落 DATA_DIR/audio/artifacts 命名空间） |
| 服务重启 | queued/running run 启动时标记 failed（`code: RUN_INTERRUPTED`，文案"服务重启中断，请重新提交"），已完成产物不受影响 |

## 8. 并发与一致性

- 全局单写者：run worker 单协程串行执行（C3），SQLite 写冲突主要来自 API 请求（创建/编辑）与 worker 终态写入——统一经数据库访问层的写队列（同一线程池串行化）。
- WAL 模式：读不阻塞写。
- 音频文件原子落盘：`.part` 临时文件 → `os.replace`（移植规范）；数据库记录在文件落盘成功后写入，保证 `audio_path` 指向的文件必存在。
