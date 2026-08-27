# API 契约：Audio Studio 正式项目

## 1. 文档信息

- 版本：v1.6
- 状态：已确认（决策点 F1：实现级）
- 创建日期：2026-08-26
- 变更记录：v1.6 按 MiniMax Music 3.0 官方能力校准 T005：取消正式 style 枚举，以自由 prompt 为核心；structure_hints 为非确定性提示；补充 Provider 能力、24h URL 与脱敏 music_retry 契约
- 变更记录：v1.5 按阿里云真实验证修正默认 Qwen-TTS 能力：instruction=true、SSML=false、pitch=false；T004 状态改为阿里云技术验收通过、火山延期
- 变更记录：v1.4 阿里云 TTS 改用独立 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`，defaults 与 settings status 暴露实际 TTS 模型 ID
- 变更记录：v1.3 增加章节实施状态矩阵，校准 health 版本示例；纳入脚本草稿/版本、六档时长与可配置模型 ID 契约
- 变更记录：v1.1 将 4.8 models 响应改为仅含可用模型并新增 Kimi 注册项
- 关联文档：`docs/tech/tech-design.md`（总体设计）、`docs/tech/data-model.md`（数据模型）
- 对接基准：`backend/tests/test_frontend_contract.py` 按本文档逐端点锁定；前端 `frontend/src/api/types.ts` 以本文档为类型单一事实源

### 1.1 章节实施状态

本文同时承载“已实现契约”和“后续任务已确认设计”。**已确认设计不表示端点已经存在**；开发和联调前应先核对下表及对应任务状态。

| 章节 | 能力 | 实施状态 | 归属 |
|---|---|---|---|
| 第 3 节 | health / stats | 已实现 | T002 |
| 第 4 节 | 冥想会话、消息、模型、草稿与版本保存 | 已实现 | T003 |
| 第 5 节 | run 查询、SSE、取消 | 已实现 | T002 |
| 第 6 节 | artifacts 基座、音频/peaks、脚本版本查看与恢复 | 已实现（T002 基座 + T003 扩展） | T002/T003 |
| 第 7 节 | TTS | 已实现；阿里云技术验收通过，火山延期 | T004 |
| 第 8 节 | BGM | 已实现；真实 MiniMax smoke 因 Key/账号权限阻塞 | T005 |
| 第 9 节 | 混音 | 仅确认设计，端点尚未实现 | T006 |
| 第 10 节 | 设置状态与探测 | 仅确认设计，端点尚未实现 | T007 |
| 第 11 节 | 通用 run、剧本、TTS 与 BGM 事件已实现；混音事件待实现 | 部分实现 | T002–T006 |
| 第 12 节 | 错误码目标全集；随对应业务任务逐步实现 | 部分实现 | T002–T007 |

`POST /api/demo/jobs` 与 `kind=demo` 是 T002 队列/SSE 内部联调入口，不属于正式业务契约，后续业务不得依赖。

## 2. 通用约定

- Base：开发 `http://127.0.0.1:8000`（Vite proxy `/api` → 8000）；生产同源。
- 请求/响应体均为 JSON（`Content-Type: application/json`），音频/峰值端点除外。
- 时间戳一律 Unix 毫秒整数。
- 长任务提交（各线 `POST .../jobs`、剧本 `POST .../messages`）统一 **202 + run 载荷**；不接受重复提交（见各线 409 语义）。

### 2.1 错误结构

所有非 2xx 响应体：

```json
{ "code": "RUN_QUEUE_FULL", "message": "任务队列已满（上限 8），请稍后再试" }
```

- `code`：稳定错误码（见第 12 节总表），前端据此映射文案与重试策略。
- `message`：人性化中文描述，已脱敏（不含 Key/内部路径）。

### 2.2 run 载荷（各线同构）

```json
{
  "run_id": "run_1724660000_abc123",
  "kind": "tts",
  "status": "queued",
  "events_url": "/api/runs/run_1724660000_abc123/events"
}
```

`kind`：`script | tts | music | mixdown`；`status`：`queued | running | completed | failed | cancelled`。

### 2.3 游标分页（消息列表）

- 请求：`?before={message_id}&limit=50`（limit 1–200，默认 50，按时间正序返回）。
- 响应：`{ "items": [...], "has_more": true }`；`has_more=true` 时以最后一条 `id` 作为下次 `before`。

## 3. 通用端点

### 3.1 GET /api/health

健康检查。

- 响应 200：`{ "status": "ok", "version": "0.1.0" }`

### 3.2 GET /api/stats

首页统计。

- 响应 200：

```json
{
  "artifact_counts": { "script_meditation": 3, "voice": 5, "bgm": 2, "mix": 1 },
  "conversation_count": 3,
  "recent_artifacts": [
    { "id": "art_...", "type": "voice", "name": "深海放松·人声", "created_at": 1724660000000 }
  ],
  "active_runs": [{ "run_id": "run_...", "kind": "tts", "status": "running" }]
}
```

- `recent_artifacts` 最多 5 条，时间倒序；`active_runs` 为当前 queued/running 的 run。

## 4. 剧本线（冥想一期；二期播客同构，scene 区分）

### 4.1 POST /api/conversations

创建会话。

- 请求：`{ "scene": "meditation", "title": "深海放松" }`（`title` 可选，缺省"未命名冥想"）
- 响应 201：

```json
{
  "id": "conv_1724660000_abc",
  "scene": "meditation",
  "title": "深海放松",
  "created_at": 1724660000000,
  "updated_at": 1724660000000
}
```

### 4.2 GET /api/conversations?scene=&limit=

会话列表（时间倒序）。

- 参数：`scene`（可选过滤）、`limit`（默认 100）。
- 响应 200：`{ "items": [conversation, ...] }`

### 4.3 GET /api/conversations/{id}

会话详情（工作台初始加载聚合接口）。

- 响应 200：

```json
{
  "conversation": { "id": "conv_...", "scene": "meditation", "title": "深海放松", "created_at": 0, "updated_at": 0 },
  "script_draft": { "conversation_id": "conv_...", "content": { "text": "...", "segments": [], "est_duration": 300 }, "params": { "duration": 15, "model": "deepseek-chat" }, "origin": "generated", "revision": 2, "updated_at": 0 },
  "script_artifact": { "id": "art_...", "type": "script_meditation", "name": "深海放松", "current_version_no": 1, "content": { "text": "...", "segments": [], "est_duration": 300 } },
  "has_unsaved_changes": true,
  "active_run_id": "run_..."
}
```

- `script_draft`：当前工作草稿，尚未生成过为 `null`；不进入产物库。
- `script_artifact`：会话 1:1 逻辑脚本产物，首次手动保存前为 `null`。
- `has_unsaved_changes`：草稿内容/参数是否不同于当前正式版本。
- `active_run_id`：该会话 queued/running 的剧本 run，无则 `null`（前端据此重连 SSE）。
- 404：`CONVERSATION_NOT_FOUND`。

### 4.4 PATCH /api/conversations/{id}

重命名。

- 请求：`{ "title": "新标题" }`（1–100 字符）
- 响应 200：conversation 对象。404 同上。

### 4.5 GET /api/conversations/{id}/messages?before=&limit=

消息列表（游标分页，见 2.3）。

- 响应 200：

```json
{
  "items": [
    { "id": "msg_...", "role": "user", "content": "生成一段深海放松冥想", "params": { "duration": 15, "model": "deepseek-chat" }, "created_at": 0 },
    { "id": "msg_...", "role": "assistant", "content": "欢迎来到...", "params": null, "created_at": 0 }
  ],
  "has_more": false
}
```

### 4.6 POST /api/conversations/{id}/messages

发送消息（剧本生成/refinement）。

- 请求：

```json
{ "text": "生成一段深海放松冥想", "duration": 15, "model": "deepseek-chat", "allow_draft_overwrite": false }
```

- 校验：`text` 非空 ≤20000 字符；`duration` ∈ {5,10,15,20,25,30}；`model` 必须在可用模型列表。
- 响应 202：run 载荷（`kind: "script"`）。
- 409：`CONVERSATION_RUN_ACTIVE`；manual/restored 未保存草稿且未确认覆盖时为 `SCRIPT_DRAFT_OVERWRITE_CONFIRM_REQUIRED`。
- 422：`SCRIPT_TEXT_INVALID` / `SCRIPT_PARAMS_INVALID`。

### 4.7 POST /api/conversations/{id}/messages/{mid}/retry

重试失败的助手消息（以该用户消息重新生成）。

- 请求体：空。
- 响应 202：run 载荷。409/404 同前。

### 4.8 GET /api/conversations/{id}/models

可用 LLM 列表。**仅返回已配置 API Key 的可用模型**（`FAKE_MODE=true` 时返回全量注册模型）；未配置的模型不出现在列表中，前端下拉只展示本端点返回项。真实模式下零配置返回空列表（前端据此禁用发送并提示配置 Key）。

- 响应 200：

```json
{
  "models": [
    { "provider": "deepseek", "model": "deepseek-chat", "name": "DeepSeek Chat" },
    { "provider": "qwen", "model": "qwen-plus", "name": "通义千问 Plus" },
    { "provider": "moonshot", "model": "kimi-k2-0905-preview", "name": "Kimi K2" }
  ]
}
```

- 字段：`provider`（deepseek/qwen/moonshot）/ `model`（对应 `*_MODEL_ID` 的实际值，也是发送消息时的 `model` 取值）/ `name`（兼容保留的服务展示名；工作台下拉只显示 `model`）。
- 注册模型与配置对应：`DEEPSEEK_MODEL_ID`←`DEEPSEEK_API_KEY`、`DASHSCOPE_MODEL_ID`←`DASHSCOPE_API_KEY`、`MOONSHOT_MODEL_ID`←`MOONSHOT_API_KEY`；缺省模型 ID 分别为 `deepseek-chat`、`qwen-plus`、`kimi-k2-0905-preview`。
- 三项模型 ID 必须非空且互不重复；配置错误时后端启动失败并指出字段。修改 `.env` 后须重启后端。
- 兜底：页面加载后 Key 配置发生变化时，发送接口仍返回 422 `SCRIPT_LLM_NOT_CONFIGURED`。

### 4.9 PATCH /api/conversations/{id}/script-draft

人工编辑工作草稿并重新解析标记。

- 请求：`{ "text": "...", "expected_revision": 2 }`
- 响应 200：更新后的 script_draft（`origin: "manual"`，revision +1）。
- 409：`SCRIPT_DRAFT_REVISION_CONFLICT`；404：`SCRIPT_DRAFT_NOT_FOUND`。

### 4.10 POST /api/conversations/{id}/script-versions

把当前草稿手动保存为不可变版本。

- 首次请求：`{ "name": "睡前深度放松", "expected_revision": 2 }`，名称 1–100 字符；创建逻辑 artifact + v1。
- 后续请求：`{ "expected_revision": 4 }`；在同一 artifact 下追加 v2/v3…。
- 响应 201：`{ "artifact": {...}, "version": {...} }`。
- 409：`SCRIPT_VERSION_UNCHANGED`；422：`SCRIPT_NAME_REQUIRED`。

## 5. run（全局统一）

### 5.1 GET /api/runs/{run_id}

状态查询（SSE 不可用时的兜底轮询/恢复入口）。

- 响应 200：

```json
{
  "run_id": "run_...",
  "kind": "tts",
  "status": "running",
  "conversation_id": null,
  "queue_position": 0,
  "progress": { "completed": 3, "total": 12, "stage": "synthesizing" },
  "artifact_id": null,
  "error": null,
  "music_retry": null
}
```

- 终态示例：`status: "completed"` 时，script run 的 `artifact_id` 为 `null`，其他产物 run 非空；`failed` 时 `error: { "code": "...", "message": "..." }`。
- 404：`RUN_NOT_FOUND`。
- `music_retry`：仅 failed music run 返回 `{ "download_available": true, "expires_at": 1724663600000 }`；其他 run 为 `null`。不得返回远程签名 URL。

### 5.2 GET /api/runs/{run_id}/events

SSE 事件流（协议见第 11 节）。

- 响应 200：`Content-Type: text/event-stream`。
- 连接即发 `run.status`（含队列位置与已持久化进度）；终态事件后服务端关闭连接。

### 5.3 POST /api/runs/{run_id}/cancel

取消。

- 响应 200：`{ "run_id": "run_...", "status": "cancelled" }`
- 语义：queued → 直接取消；running → 尽力中断（丢弃中间产物）；已终态 → 409 `RUN_ALREADY_FINISHED`。

## 6. 产物

### 6.1 GET /api/artifacts?type=&limit=

产物列表（时间倒序）。

- 参数：`type`（可选：`script_meditation|voice|bgm|mix`）、`limit`（默认 200）。
- 响应 200：`{ "items": [artifact, ...] }`（列表项含 `params` 摘要与 `audio` 元信息，`content` 仅脚本类型返回，见 data-model.md）。

### 6.2 GET /api/artifacts/{id}

产物详情。

- 响应 200：artifact 完整对象：

```json
{
  "id": "art_...",
  "type": "voice",
  "name": "深海放松·人声",
  "conversation_id": "conv_...",
  "source_run_id": "run_...",
  "params": { "scene": "meditation", "engine": "aliyun", "model": "qwen-audio-3.0-tts-plus", "voice_id": "longanlingxin", "voice_name": "龙安聆心", "speed": 0.8, "pitch": null, "script_artifact_id": "art_...", "format": "mp3" },
  "content": null,
  "audio": { "format": "mp3", "duration": 301.5, "url": "/api/artifacts/art_.../audio", "peaks_url": "/api/artifacts/art_.../peaks" },
  "created_at": 1724660000000,
  "updated_at": 1724660000000
}
```

- 脚本类型无 `audio`，`content = {text, segments[], est_duration}`（结构见 data-model.md）。
- 404：`ARTIFACT_NOT_FOUND`。

### 6.3 PATCH /api/artifacts/{id}

重命名产物。脚本正文不可绕过草稿/版本链路直接修改。

- 请求：

```json
{ "name": "新名称" }
```

- 校验：`name` 1–100 字符。
- 响应 200：更新后 artifact 完整对象。
- 422：脚本带 content 返回 `SCRIPT_EDIT_VIA_DRAFT_REQUIRED`；音频带 content 返回 `ARTIFACT_NOT_EDITABLE`。

### 6.4 DELETE /api/artifacts/{id}

删除（连带音频文件、峰值缓存；被下游引用不阻止删除，混音产物 params 中保留历史 id 引用）。

- 响应 200：`{ "deleted": true }`

### 6.5 GET /api/artifacts/{id}/audio

音频文件流。

- 响应 200：`audio/mpeg` 或 `audio/wav`；支持 HTTP Range（`<audio>` seek 依赖）。
- 404：`ARTIFACT_NOT_FOUND` / `ARTIFACT_NO_AUDIO`（脚本类型）。

### 6.6 GET /api/artifacts/{id}/versions

脚本不可变版本列表，按 version_no 倒序；草稿不在此列表。

- 响应 200：`{ "items": [{ "id": "ver_...", "artifact_id": "art_...", "version_no": 2, "params": {}, "content": {}, "created_at": 0 }] }`。

### 6.7 POST /api/artifacts/{id}/versions/{version_id}/restore-draft

把历史版本复制为会话工作草稿，不改变 artifact 当前版本。

- 请求：`{ "expected_revision": 4 }`
- 响应 200：更新后的 script_draft（`origin: "restored"`）。
- 后续手动保存会追加新版本，不重写历史。
### 6.8 GET /api/artifacts/{id}/peaks

波形峰值 JSON（首次计算并缓存）。

- 响应 200：

```json
{ "peaks": [0.12, 0.45, ...], "duration": 301.5, "buckets": 1200 }
```

- `peaks` 为 0–1 归一化幅度数组（≤1200 桶）。

## 7. TTS 线

### 7.1 GET /api/tts/defaults

引擎/音色库/能力声明/场景预设（后端硬编码官方列表，D4）。

- 响应 200：

```json
{
  "engines": [
    {
      "id": "aliyun",
      "name": "阿里云",
      "model": "qwen-audio-3.0-tts-plus",
      "supports_ssml": false,
      "supports_instruction": true,
      "max_ssml_pause_ms": 0,
      "supports_pitch": false,
      "voices": [
        { "id": "longanlingxin", "name": "龙安聆心", "tags": ["温柔", "女声"], "recommended_scene": "meditation" }
      ]
    },
    {
      "id": "volc",
      "name": "火山引擎",
      "model": "BV700_streaming",
      "supports_ssml": false,
      "supports_instruction": false,
      "max_ssml_pause_ms": 0,
      "supports_pitch": false,
      "voices": [
        { "id": "zh_female_wanwanxiaohe_moon_bigtts", "name": "湾湾小何", "tags": ["知性", "女声"], "recommended_scene": "podcast" }
      ]
    }
  ],
  "scene_presets": {
    "meditation": { "speed": 0.8, "recommended_voice_ids": ["longanlingxin"], "note": "偏慢语速，温柔系音色" },
    "podcast": { "speed": 1.0, "recommended_voice_ids": [], "note": "正常语速，自然讲述" }
  }
}
```

- 阿里云引擎的 `model` 来自 `ALIYUN_TTS_MODEL_ID`（默认 `qwen-audio-3.0-tts-plus`）；Provider 只读取 `ALIYUN_TTS_*`，不回退读取千问 LLM 的 `DASHSCOPE_*`。
- 默认 `qwen-audio-3.0-tts-plus` 经真实调用确认不接受 SSML `<break>`（服务端 `ret=416`）且 pitch 未验证支持，因此 defaults 声明两者为 false；停顿切本地静音，前端音调滑块置灰。instruction 已真实验证可用。
- 能力字段即 `TTSCapabilities`（B3 降级依据）：前端可据此展示"该引擎不支持情绪指令/音调"提示。

### 7.2 GET /api/tts/voices/{engine}/{voice}/preview

音色试听。首次真实合成固定短句并缓存（`previews/{engine}_{voice}.wav`），其后直接回放。

- 响应 200：`audio/wav`（同 6.5 支持 Range）。
- 404：`TTS_VOICE_NOT_FOUND`；502：`TTS_PROVIDER_ERROR`（首次合成失败）。

### 7.3 POST /api/tts/jobs

提交合成任务。

- 请求：

```json
{
  "script_artifact_id": "art_...",
  "text": null,
  "scene": "meditation",
  "engine": "aliyun",
  "voice_id": "longanlingxin",
  "speed": 0.8,
  "pitch": null,
  "format": "mp3"
}
```

- `script_artifact_id` 与 `text` 二选一（前者优先）；来源为脚本产物时 scene 以产物来源会话自动判定（显式传入则校验一致）。
- 校验：`engine`/`voice_id` 在 defaults 列表内；`speed` 0.5–1.5；`pitch` 引擎支持时 -12~12（半音）；`format` ∈ {mp3, wav}；裸文本 ≤20000 字符。
- 响应 202：run 载荷（`kind: "tts"`）。
- 422：`TTS_TEXT_EMPTY` / `TTS_TEXT_TOO_LONG` / `TTS_PARAMS_INVALID`；409：`RUN_QUEUE_FULL` / `TTS_RUN_ACTIVE`（同参数任务运行中）。

## 8. BGM 线

### 8.1 GET /api/music/defaults

当前 Provider、能力、Prompt 灵感示例与通用输入范围。灵感示例仅用于填充文本，不是可校验的风格枚举。

- 响应 200：

```json
{
  "provider": "minimax",
  "model": "music-3.0",
  "capabilities": {
    "instrumental": true,
    "prompt_max_length": 2000,
    "native_duration": false,
    "structure_control": "prompt_hint",
    "remote_url": true
  },
  "prompt_suggestions": [
    { "id": "zen", "label": "古琴与空灵氛围", "prompt": "空灵缓慢的冥想背景音乐，以古琴和柔和氛围音色为主，无明显鼓点，动态平稳" }
  ],
  "structure_hints": ["intro", "build_up", "drop", "outro"],
  "duration_range": { "min": 60, "max": 600 }
}
```

### 8.2 POST /api/music/jobs

提交生成任务（MiniMax 同步接口，E1）。

- 请求：

```json
{ "prompt": "笛箫与柔和电子氛围融合，节奏缓慢，动态平稳，适合冥想", "target_duration": 300, "structure_hints": ["intro", "outro"], "format": "mp3" }
```

- `prompt` 必填，去除首尾空白后长度 1–2000；`target_duration` 60–600 秒；`structure_hints` 元素 ∈ defaults.structure_hints、不可重复；`format` ∈ `mp3|wav`。
- 请求保持 Provider 中立；MiniMax adapter 映射为纯音乐非流式 URL 请求。`structure_hints` 当前转写为 prompt 提示，不保证模型精确分段。
- 响应 202：run 载荷（`kind: "music"`）。
- 409/422：同 7.3（`MUSIC_PARAMS_INVALID`）。

### 8.3 POST /api/music/jobs/{run_id}/retry

失败重试（E8 计费安全：失败不自动重试，重试分两档）。

- 请求：

```json
{ "mode": "download", "confirm_regenerate": null }
```

- `mode=download`：run 失败但 `result_json.audio_url` 未过官方 24h 有效期 → 仅重新下载+后处理（免计费）；URL 缺失或过期 → 422 `MUSIC_URL_EXPIRED`（提示改用 regenerate）。
- `mode=regenerate`：重新调用生成；必须携带 `confirm_regenerate: true`，否则 422 `MUSIC_REGENERATE_UNCONFIRMED`。
- 响应 202：新 run 载荷（复用原参数，`source_run_id` 指向原 run）。
- 仅 failed 状态的 music run 可重试 → 409 `RUN_NOT_RETRYABLE`。

## 9. 混音线

### 9.1 POST /api/mixdown/jobs

提交混音任务。

- 请求：

```json
{
  "voice_artifact_id": "art_...",
  "bgm_artifact_id": "art_...",
  "voice_gain": 80,
  "bgm_gain": 45,
  "bgm_offset": 0,
  "ducking": true,
  "format": "mp3"
}
```

- 校验：两轨至少其一（`MIX_INPUT_MISSING`，422）；`*_gain` 0–100；`bgm_offset` 0–60 秒；id 必须存在且类型正确（voice→`voice`、bgm→`bgm`，`MIX_INPUT_INVALID`，422）。
- 响应 202：run 载荷（`kind: "mixdown"`）。409 同 7.3（`MIX_RUN_ACTIVE`）。

## 10. 设置线

### 10.1 GET /api/settings/status

配置状态（只读，D3）。

- 响应 200：

```json
{
  "providers": {
    "llm_deepseek": { "configured": true, "key_masked": "sk-***cdef", "model_id": "deepseek-chat" },
    "llm_qwen": { "configured": true, "key_masked": "sk-***ab12", "model_id": "qwen-plus" },
    "llm_moonshot": { "configured": false, "key_masked": null, "model_id": "kimi-k2-0905-preview" },
    "tts_aliyun": { "configured": true, "key_masked": "sk-***9x8y", "model_id": "qwen-audio-3.0-tts-plus" },
    "tts_volc": { "configured": false, "key_masked": null },
    "minimax": { "configured": true, "key_masked": "eyJ***jk4" }
  },
  "ffmpeg": { "available": true, "version": "ffmpeg version 7.0 ...", "ffprobe_available": true },
  "fake_mode": false
}
```

### 10.2 POST /api/settings/probe/{provider}

连通性测试（真实轻量探测）。

- `provider` ∈ `llm_deepseek | llm_qwen | llm_moonshot | aliyun_tts | volc_tts | minimax | ffmpeg`。
- `aliyun_tts` 的配置状态与探测只使用 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`；未配置独立 TTS Key 时，即使 `DASHSCOPE_API_KEY` 已配置也返回未配置。
- 响应 200（探测本身 200，结果在体内）：

```json
{ "ok": true, "latency_ms": 842, "message": "合成成功（1.2s 音频）" }
```

- 未配置 → `{ "ok": false, "latency_ms": 0, "message": "未配置 API Key" }`（仍 200）。

## 11. SSE 事件协议

`GET /api/runs/{run_id}/events`，事件按 run.kind 分发；事件名与载荷为契约锁定项。

### 11.1 事件全表

| 线 | 事件 | 载荷 | 语义 |
|---|---|---|---|
| 通用 | `run.status` | `{status, queue_position, progress}` | 连接即发（恢复快照）；排队期间每 5s 重发 |
| 通用 | `run.started` | `{}` | 出队开始执行 |
| script | `assistant.delta` | `{delta: "文本增量"}` | 流式脚本文本增量 |
| script | `message.completed` | `{message: {id, role, content, created_at}}` | 消息定稿（写入 messages 表） |
| script | `script.draft.updated` | `{draft: {content, params, origin, revision, updated_at}}` | AI 生成成功，工作草稿已原子替换 |
| tts | `tts.progress` | `{segment, total_segments, stage}` | 分段进度（stage: `synthesizing|assembling|encoding`） |
| music | `music.progress` | `{phase, waited_s}` | `phase: generating|downloading|processing`；generating 期 5s 心跳 |
| mixdown | `mix.progress` | `{phase}` | `phase: prep|ducking|encode` |
| 通用 | `run.completed` | `{artifact_id}` | 成功；script run 为 `null`，其他产物任务为新产物 id |
| 通用 | `run.failed` | `{code, message}` | 失败，临时内容丢弃 |
| 通用 | `run.cancelled` | `{}` | 取消，临时内容丢弃 |

### 11.2 时序（TTS 线示例）

```text
连接 → run.status{queued, queue_position:1}
     → run.status{queued, queue_position:0}（前序完成）
     → run.started
     → tts.progress{segment:1, total_segments:12, stage:"synthesizing"}
     → tts.progress{segment:2, ...} ...
     → tts.progress{stage:"assembling"} → tts.progress{stage:"encoding"}
     → run.completed{artifact_id:"art_..."}   ← 连接关闭
```

### 11.3 断线恢复

- 前端重连（刷新页面）后：run 仍活跃 → 重新连 events，`run.status` 恢复进度；run 已终态 → `run.status` 直接给终态，前端据此收口。

## 12. 错误码总表

| 错误码 | HTTP | 场景 | 前端处理建议 |
|---|---|---|---|
| `RUN_QUEUE_FULL` | 409 | 队列 ≥8 | 提示稍后再试 |
| `RUN_NOT_FOUND` | 404 | run 不存在 | 返回上一页 |
| `RUN_ALREADY_FINISHED` | 409 | 取消已终态 run | 刷新状态 |
| `RUN_NOT_RETRYABLE` | 409 | 非 failed 的 music run 重试 | 刷新状态 |
| `CONVERSATION_NOT_FOUND` | 404 | 会话不存在 | 返回列表 |
| `CONVERSATION_RUN_ACTIVE` | 409 | 会话已有活动剧本 run | 展示运行中 |
| `SCRIPT_TEXT_INVALID` | 422 | 剧本文本空/超长 | 表单校验提示 |
| `SCRIPT_PARAMS_INVALID` | 422 | duration/model 非法 | 表单校验提示 |
| `SCRIPT_LLM_NOT_CONFIGURED` | 422 | 模型未配置 | 引导去设置页 |
| `SCRIPT_LLM_ERROR` | 502 | LLM 调用失败（脱敏） | 失败卡片+重试 |
| `SCRIPT_TIMEOUT` | 504 | LLM 流式超时 | 失败卡片+重试 |
| `TTS_TEXT_EMPTY` / `TTS_TEXT_TOO_LONG` | 422 | 文本校验 | 表单校验提示 |
| `TTS_PARAMS_INVALID` | 422 | 引擎/音色/语速/格式非法 | 表单校验提示 |
| `TTS_VOICE_NOT_FOUND` | 404 | 音色不存在 | 刷新 defaults |
| `TTS_RUN_ACTIVE` | 409 | 同参数任务运行中 | 展示运行中 |
| `TTS_PROVIDER_ERROR` | 502 | 引擎调用失败（脱敏） | 失败卡片+重试 |
| `MUSIC_PARAMS_INVALID` | 422 | BGM 参数非法 | 表单校验提示 |
| `MUSIC_RUN_ACTIVE` | 409 | 相同参数的 BGM 任务正在运行 | 展示运行中 |
| `MUSIC_AUTH_FAILED` | 502 | MiniMax API Key 无效 | 引导检查配置 |
| `MUSIC_RATE_LIMITED` | 429 | MiniMax 限流 | 稍后手动重试 |
| `MUSIC_ACCESS_DENIED` | 502 | 模型权限、余额或额度不足 | 引导检查账号 |
| `MUSIC_CONTENT_REJECTED` | 422 | Prompt 未通过内容审核 | 修改 Prompt 后重新提交 |
| `MUSIC_REQUEST_INVALID` | 422 | Provider 拒绝请求参数 | 检查 Prompt/模型配置 |
| `MUSIC_NETWORK_ERROR` | 502 | 无法连接 MiniMax | 检查网络后重试 |
| `MUSIC_URL_EXPIRED` | 422 | retry=download 但 URL 过期 | 引导改 regenerate |
| `MUSIC_REGENERATE_UNCONFIRMED` | 422 | regenerate 未确认 | 弹二次确认 |
| `MUSIC_PROVIDER_ERROR` | 502 | MiniMax 服务异常或响应异常 | 失败卡片+两档重试 |
| `MUSIC_TIMEOUT` | 504 | 同步接口超时（10min） | 失败卡片+重试 |
| `MUSIC_DOWNLOAD_FAILED` | 502 | 远程音频下载失败 | URL 有效时重新下载 |
| `MUSIC_FFMPEG_MISSING` | 503 | BGM 后处理缺少 ffmpeg/ffprobe | 引导安装或配置 |
| `MUSIC_PROCESSING_ERROR` | 500 | BGM 后处理或时长复验失败 | 失败卡片+两档重试 |
| `MIX_INPUT_MISSING` | 422 | 双轨均空 | 表单校验提示 |
| `MIX_INPUT_INVALID` | 422 | 轨道 id 不存在/类型错误 | 刷新下拉 |
| `MIX_FFMPEG_MISSING` | 503 | ffmpeg/ffprobe 不可用 | 引导去设置页查看安装指引 |
| `MIX_FFMPEG_ERROR` | 500 | ffmpeg 执行失败（脱敏） | 失败卡片+重试 |
| `ARTIFACT_NOT_FOUND` | 404 | 产物不存在 | 返回列表 |
| `ARTIFACT_NO_AUDIO` | 404 | 脚本产物请求音频 | 前端不应发起 |
| `ARTIFACT_NOT_EDITABLE` | 422 | 音频产物带 content 编辑 | 前端不应发起 |
| `SCRIPT_DRAFT_NOT_FOUND` | 404 | 尚无可编辑/保存的工作草稿 | 引导先生成脚本 |
| `SCRIPT_DRAFT_REVISION_CONFLICT` | 409 | 草稿 revision 已变化 | 刷新草稿后重试 |
| `SCRIPT_DRAFT_OVERWRITE_CONFIRM_REQUIRED` | 409 | 人工/恢复草稿未确认覆盖 | 弹三项保护确认 |
| `SCRIPT_NAME_REQUIRED` | 422 | 首次保存未输入脚本名称 | 打开命名弹窗 |
| `SCRIPT_VERSION_UNCHANGED` | 409 | 草稿与当前版本相同 | 禁用重复保存 |
| `SCRIPT_VERSION_NOT_FOUND` | 404 | 历史版本不存在 | 刷新版本列表 |
| `SCRIPT_EDIT_VIA_DRAFT_REQUIRED` | 422 | 绕过草稿直接 PATCH 脚本正文 | 改走草稿与保存版本接口 |
| `BACKEND_UNREACHABLE` | — | 网络不可达（前端本地归一化） | 全局提示横幅 |
