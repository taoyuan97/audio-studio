# API 契约：Audio Studio 正式项目

## 1. 文档信息

- 版本：v2.5
- 状态：已确认（决策点 F1：实现级）
- 创建日期：2026-08-26
- 变更记录：v2.5 明确 T014 客户端历史版本文档导出直接读取版本 `content.text`，不新增导出 API
- 变更记录：v2.4 增加 T013 脚本配置读写、TTS inline tags 能力字段、`vocal` segment、显式草稿保存与非兼容引擎降级语义
- 变更记录：v2.3 扩展 T012 混音请求：人声/背景独立倍速、默认值与范围、单轨参数和有效时长规范化语义
- 变更记录：v2.2 增加 T011 阿里云自定义音色库 CRUD、按模型合并 defaults、试听验证状态与模型感知缓存；TTS 任务冻结提交时模型快照
- 变更记录：v2.1 校准 T006/T007 实施状态，并明确所有设置 POST/PATCH/DELETE（含 Provider probe）执行本机 Origin 校验
- 变更记录：v2.0 开放 MiniMax API Key 与模型 ID 的浏览器写入；运行时 Key 支持按需回显和清除，`.env` Key 仍禁止回显
- 变更记录：v1.9 增加 T007 浏览器运行时凭据按字段回显；`.env`/MiniMax 禁止回显，火山 App ID 与 Access Token 独立处理
- 变更记录：v1.8 扩展 T007 设置 API：五类服务凭据/模型参数浏览器写入、revision 并发控制与免重启热生效；MiniMax Key 仍只读
- 变更记录：v1.7 增加 T009 冥想消息 `.md` / `.txt` 参考附件、持久化、重试与 LLM 上下文预算契约
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
| 第 4 节 | 冥想会话、消息、参考附件、模型、草稿与版本保存 | 已实现 | T003/T009 |
| 第 5 节 | run 查询、SSE、取消 | 已实现 | T002 |
| 第 6 节 | artifacts 基座、音频/peaks、脚本版本查看与恢复 | 已实现（T002 基座 + T003 扩展） | T002/T003 |
| 第 7 节 | TTS | 已实现；阿里云自定义音色库已接入，火山真实联调延期 | T004/T011 |
| 第 8 节 | BGM | 已实现；真实 MiniMax smoke 因 Key/账号权限阻塞 | T005 |
| 第 9 节 | 混音 | 已实现（含分轨倍速与单轨参数一致性） | T006/T012 |
| 第 10 节 | 设置状态、浏览器编辑、脚本配置与探测 | 已实现 | T007/T013 |
| 第 11 节 | 通用 run、剧本、TTS、BGM 与混音事件 | 已实现 | T002–T006 |
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
    { "id": "msg_...", "role": "user", "content": "生成一段深海放松冥想", "params": { "duration": 15, "model": "deepseek-chat" }, "attachments": [{ "id": "att_...", "name": "参考.md", "size": 1234, "media_type": "text/markdown" }], "created_at": 0 },
    { "id": "msg_...", "role": "assistant", "content": "欢迎来到...", "params": null, "attachments": [], "created_at": 0 }
  ],
  "has_more": false
}
```

### 4.6 POST /api/conversations/{id}/messages

发送消息（剧本生成/refinement）。

- 请求：

```json
{
  "text": "生成一段深海放松冥想",
  "duration": 15,
  "model": "deepseek-chat",
  "allow_draft_overwrite": false,
  "attachments": [{ "name": "参考.md", "content": "# 睡前放松\n..." }]
}
```

- 校验：`text` 非空 ≤20000 字符；`duration` ∈ {5,10,15,20,25,30}；`model` 必须在可用模型列表。
- `attachments` 可选、默认 `[]`，最多 3 个；仅允许大小写不敏感的 `.md` / `.txt` basename。单文件 UTF-8 字节数 ≤200 KB，合计 ≤500 KB，正文合计 ≤60000 字符；空正文、NUL、路径式文件名均拒绝。
- 客户端只发送附件 `name/content`；服务端计算 `size/media_type` 并持久化。消息列表只返回附件元数据，不返回正文。
- 响应 202：run 载荷（`kind: "script"`）。
- 409：`CONVERSATION_RUN_ACTIVE`；manual/restored 未保存草稿且未确认覆盖时为 `SCRIPT_DRAFT_OVERWRITE_CONFIRM_REQUIRED`。
- 422：`SCRIPT_TEXT_INVALID` / `SCRIPT_PARAMS_INVALID` / `SCRIPT_ATTACHMENT_*`。

### 4.7 POST /api/conversations/{id}/messages/{mid}/retry

重试失败的助手消息（以该用户消息及其已持久化附件重新生成，不复制 user 消息或附件）。

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
- 三项模型 ID 必须非空，允许不同 provider 使用相同 ID；浏览器运行时配置保存后无需重启，后续模型列表请求立即返回新值。
- 兜底：页面加载后 Key 配置发生变化时，发送接口仍返回 422 `SCRIPT_LLM_NOT_CONFIGURED`。

### 4.9 PATCH /api/conversations/{id}/script-draft

人工编辑工作草稿并重新解析标记。

- 请求：`{ "text": "...", "expected_revision": 2 }`
- 响应 200：更新后的 script_draft（`origin: "manual"`，revision +1）。
- 409：`SCRIPT_DRAFT_REVISION_CONFLICT`；404：`SCRIPT_DRAFT_NOT_FOUND`。
- 前端只在用户点击“保存草稿”，或 dirty 状态点击“完成编辑”时调用本端点；不允许防抖、定时或输入触发的自动保存。“完成编辑”必须等待保存成功才退出编辑态。

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

### 6.5 DELETE /api/artifacts

清空全部产物；二次确认由前端负责。脚本版本随外键级联删除，音频文件与峰值缓存逐项清理。

- 响应 200：`{ "deleted": 12 }`，数字为本次删除的产物数。

### 6.6 GET /api/artifacts/{id}/audio

音频文件流。

- 响应 200：`audio/mpeg` 或 `audio/wav`；支持 HTTP Range（`<audio>` seek 依赖）。200/206 响应均通过 `Content-Disposition: inline` 提供下载文件名，格式为 `{产物名称}-{MMDD}-{HHmm}.{音频格式}`；名称中的文件系统非法字符会替换为 `-`。
- 404：`ARTIFACT_NOT_FOUND` / `ARTIFACT_NO_AUDIO`（脚本类型）。

### 6.7 GET /api/artifacts/{id}/versions

脚本不可变版本列表，按 version_no 倒序；草稿不在此列表。

- 响应 200：`{ "items": [{ "id": "ver_...", "artifact_id": "art_...", "version_no": 2, "params": {}, "content": {}, "created_at": 0 }] }`。
- T014 的 Markdown/TXT 导出由浏览器直接读取已返回版本的 `content.text`；不得由 `segments` 反向拼接，不上传正文，也不新增服务端导出或临时文件 API。

### 6.8 POST /api/artifacts/{id}/versions/{version_id}/restore-draft

把历史版本复制为会话工作草稿，不改变 artifact 当前版本。

- 请求：`{ "expected_revision": 4 }`
- 响应 200：更新后的 script_draft（`origin: "restored"`）。
- 后续手动保存会追加新版本，不重写历史。
### 6.9 GET /api/artifacts/{id}/peaks

波形峰值 JSON（首次计算并缓存）。

- 响应 200：

```json
{ "peaks": [0.12, 0.45, ...], "duration": 301.5, "buckets": 1200 }
```

- `peaks` 为 0–1 归一化幅度数组（≤1200 桶）。

## 7. TTS 线

### 7.1 GET /api/tts/defaults

引擎/当前模型音色库/能力声明/场景预设。系统音色由后端按模型维护，自定义音色来自 SQLite；阿里云只返回与当前 `ALIYUN_TTS_MODEL_ID` 精确匹配的两类音色。

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
      "supports_inline_tags": true,
      "voices": [
        { "id": "longanlingxin", "name": "龙安灵心", "tags": ["温柔", "女声"], "recommended_scene": "meditation", "source": "system", "custom_voice_id": null, "verification_status": null },
        { "id": "qwen-audio-3.0-tts-plus-myvoice-a1b2c3", "name": "温柔女声 03", "tags": ["自定义"], "recommended_scene": null, "source": "custom", "custom_voice_id": "cvoice_...", "verification_status": "verified" }
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
      "supports_inline_tags": false,
      "voices": [
        { "id": "zh_female_wanwanxiaohe_moon_bigtts", "name": "湾湾小何", "tags": ["知性", "女声"], "recommended_scene": "podcast", "source": "system", "custom_voice_id": null, "verification_status": null }
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
- `source=system|custom` 标识音色来源；只有自定义音色返回 `custom_voice_id` 和 `verification_status`。自定义名称为空时 `name` 回退为完整 `voice_id`。
- 项目内置阿里云系统音色按模型组织；现有 `longanlingxin` / `longanlufeng` 仅属于 `qwen-audio-3.0-tts-plus`。其他模型不会错误继承这两项。
- 自定义音色不参与场景推荐。TTS 页选中自定义音色后切换场景只更新语速，不覆盖音色。
- 默认 `qwen-audio-3.0-tts-plus` 经真实调用确认不接受 SSML `<break>`（服务端 `ret=416`）且 pitch 未验证支持，因此 defaults 声明两者为 false；停顿切本地静音，前端音调滑块置灰。instruction 已真实验证可用。
- 能力字段即 `TTSCapabilities`（B3 降级依据）。`supports_inline_tags=true` 只适用于 `qwen-audio-3.0-tts-plus` / `qwen-audio-3.0-tts-flash`：计划层将 `[emotion:asmr]`、`[vocal:sighing]` 转为 Provider 文本中的 `[asmr]`、`[sighing]`。其他引擎剥离这两类内部标签但保留正文与停顿，TTS 页在提交前展示被忽略标签数量；旧 `[情绪:x]` instruction 行为继续兼容。

### 7.2 GET /api/tts/voices/{engine}/{voice}/preview

系统音色试听。首次真实合成固定短句并缓存，其后直接回放。缓存身份包含 `engine + model + voice_id`，物理文件名使用摘要，不直接拼接 URL 参数。

- 响应 200：`audio/wav`（同 6.5 支持 Range）。
- 404：`TTS_VOICE_NOT_FOUND`；502：`TTS_PROVIDER_ERROR`（首次合成失败）。

### 7.3 GET /api/tts/custom-voices?model=

读取 SQLite 中的阿里云自定义音色；`model` 可选，传入时精确过滤。默认返回全部记录，按模型、创建时间稳定排序。

```json
{
  "items": [
    {
      "id": "cvoice_1724660000_abc123",
      "engine": "aliyun",
      "model": "qwen-audio-3.0-tts-plus",
      "voice_id": "qwen-audio-3.0-tts-plus-myvoice-a1b2c3",
      "name": "温柔女声 03",
      "display_name": "温柔女声 03",
      "verification_status": "verified",
      "last_checked_at": 1724660000000,
      "last_verified_at": 1724660000000,
      "last_error": null,
      "created_at": 1724660000000,
      "updated_at": 1724660000000
    }
  ]
}
```

`verification_status ∈ {unverified, verified, failed}`。名称为 `null` 时 `display_name` 返回实际 `voice_id`。验证状态仅表示最近一次真实试听结果，不是永久有效性承诺。

### 7.4 POST /api/tts/custom-voices

登记已有阿里云音色；保存本身不调用 Provider、不产生试听费用。

```json
{
  "model": "qwen-audio-3.0-tts-plus",
  "voice_id": "qwen-audio-3.0-tts-plus-myvoice-a1b2c3",
  "name": "温柔女声 03"
}
```

- `model` / `voice_id`：去除首尾空白后 1–200 字符，只允许 ASCII 字母、数字、点、下划线、连字符，首字符须为字母或数字。
- Qwen-Audio 3.0 基础音色的 `voice_id` 必须是完整 voice 参数，格式为 `qwen-audio-3.0-tts-{plus|flash}-{音色后缀}`；设置页对疑似裸后缀给出补全候选，但允许用户保留原值以兼容声音复刻音色。
- `name`：可省略或为 `null`，非空时去除首尾空白且不超过 100 字符；纯空白归一为 `null`，拒绝 NUL/控制字符。
- 同一模型下 `(engine, model, voice_id)` 唯一；不同模型允许相同 `voice_id`。
- 与同模型的项目内置系统音色冲突时拒绝；本接口不负责抓取完整阿里云官方列表。
- 响应 201：完整 `TtsCustomVoice`，初始 `verification_status=unverified`。

### 7.5 PATCH /api/tts/custom-voices/{id}

仅重命名本地记录。请求只接受 `{ "name": "新名称" }` 或 `{ "name": null }`；`model`、`voice_id`、状态均不可修改。响应 200 为更新后的完整资源。

### 7.6 DELETE /api/tts/custom-voices/{id}

删除本地记录及对应试听缓存，不调用阿里云删除接口，不删除历史 run、artifact 或正式音频。响应 200：`{ "deleted": true }`。

### 7.7 POST /api/tts/custom-voices/{id}/verify

使用记录绑定的模型和音色 ID 合成固定短句，更新验证状态并准备试听缓存。

```json
{ "force": false }
```

- `force=false` 且已有缓存：不请求 Provider，返回 `cache_hit=true`。
- 无缓存：请求一次 Provider；成功后原子写入 WAV 缓存并标记 verified。
- `force=true`：忽略缓存重新验证，可能再次产生费用；前端必须二次确认。
- 验证失败：记录 failed、检查时间和脱敏错误；保留记录以及过去成功生成的旧缓存，API 返回 502。
- 阿里云返回 cosyvoice `Engine error [411]` 时，错误信息明确包含实际 model/voice，并提示检查完整基础音色参数；HTTP 状态仍为 502，表示失败来自上游验证调用。
- 成功响应：`{ "voice": TtsCustomVoice, "preview_url": "/api/tts/custom-voices/{id}/preview", "cache_hit": false }`。
- 写操作和可能计费的验证调用执行与设置接口相同的本机 Origin 校验。

### 7.8 GET /api/tts/custom-voices/{id}/preview

只播放已经存在的自定义音色 WAV 缓存，不调用 Provider、不产生费用；支持 HTTP Range。无缓存返回 `TTS_CUSTOM_VOICE_PREVIEW_NOT_FOUND`。

### 7.9 POST /api/tts/jobs

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
- 校验：`engine`/`voice_id` 在当前 defaults 列表内；阿里云自定义音色必须已登记且绑定当前 `ALIYUN_TTS_MODEL_ID`，无论验证状态如何均可提交；`speed` 0.5–1.5；`pitch` 引擎支持时 -12~12（半音）；`format` ∈ {mp3, wav}；裸文本 ≤20000 字符。
- 服务端解析并冻结 `model`、`voice_id`、`voice_name`、`voice_source`。TTS handler 使用提交时模型快照；排队期间修改全局模型不会静默改写任务。API Key 等凭据仍在执行时读取当前设置。
- 响应 202：run 载荷（`kind: "tts"`）。
- 422：`TTS_TEXT_EMPTY` / `TTS_TEXT_TOO_LONG` / `TTS_PARAMS_INVALID`；409：`RUN_QUEUE_FULL` / `TTS_RUN_ACTIVE`（同参数任务运行中）。

## 8. BGM 线

### 8.1 GET /api/music/defaults

当前 Provider、运行时模型 ID、能力、Prompt 灵感示例与通用输入范围。模型 ID 默认 `music-3.0`，可由设置页覆盖；灵感示例仅用于填充文本，不是可校验的风格枚举。

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
  "voice_speed": 1.0,
  "bgm_speed": 1.0,
  "voice_gain": 80,
  "bgm_gain": 45,
  "bgm_offset": 0,
  "ducking": true,
  "format": "mp3"
}
```

- 默认值：`voice_speed=1.0`、`bgm_speed=1.0`、`voice_gain=80`、`bgm_gain=45`、`bgm_offset=0`、`ducking=true`、`format=mp3`。旧客户端省略倍速字段时保持原速。
- 校验：两轨至少其一（`MIX_INPUT_MISSING`，422）；`*_speed` 必须是有限数值且处于 `0.5～2.0` 闭区间；`*_gain` 0–100；`bgm_offset` 0–60 秒；id 必须存在且类型正确（voice→`voice`、bgm→`bgm`，`MIX_INPUT_INVALID`，422）。
- 规范化快照：未选择的轨道将对应倍速规范化为 `1.0`；仅单轨时 `bgm_offset=0`、`ducking=false`。双轨成品时长为 `voice 源时长 / voice_speed`，背景按 `bgm 源时长 / bgm_speed` 循环或截断；仅单轨时输出时长为对应源时长除以对应倍速。倍速和对应增益在三种轨道组合中均生效。
- 响应 202：run 载荷（`kind: "mixdown"`）。409 同 7.3（`MIX_RUN_ACTIVE`）。

## 10. 设置线

设置页前端使用三个顶层 Tab：“模型与环境设置”承载既有 Provider/运行时/本地环境内容，“音色配置”承载第 7.3–7.8 节自定义音色管理，“脚本配置”承载情绪/语气词/停顿预设。音色配置保存在 SQLite；脚本配置以完整快照写入 `settings.json`。两个浏览器连接同一后端和同一 `DATA_DIR` 时共享数据。

### 10.1 GET /api/settings/status

读取脱敏配置状态、可编辑参数与只读环境状态。本端点不返回完整凭据。

- 响应 200：

```json
{
  "revision": 3,
  "providers": {
    "llm_deepseek": { "configured": true, "credential_masked": "sk-***cdef", "credential_source": "runtime", "runtime_credential_fields": ["credential"], "model_id": "deepseek-chat", "editable": true },
    "llm_qwen": { "configured": true, "credential_masked": "sk-***ab12", "credential_source": "env", "runtime_credential_fields": [], "model_id": "qwen-plus", "editable": true },
    "llm_moonshot": { "configured": false, "credential_masked": null, "credential_source": null, "runtime_credential_fields": [], "model_id": "kimi-k2-0905-preview", "editable": true },
    "tts_aliyun": { "configured": true, "credential_masked": "sk-***9x8y", "credential_source": "runtime", "runtime_credential_fields": ["credential"], "model_id": "qwen-audio-3.0-tts-plus", "editable": true },
    "tts_volc": { "configured": true, "credential_masked": "123***3456 / tok***5678", "credential_source": "mixed", "runtime_credential_fields": ["app_id"], "editable": true },
    "minimax": { "configured": true, "credential_masked": "eyJ***jk4", "credential_source": "runtime", "runtime_credential_fields": ["credential"], "model_id": "music-3.0", "editable": true }
  },
  "runtime": { "llm_timeout_seconds": 120, "minimax_timeout_seconds": 600 },
  "ffmpeg": { "available": true, "version": "ffmpeg version 7.0 ...", "ffprobe_available": true },
  "fake_mode": false
}
```

`credential_source` 为 `runtime | env | mixed | null`；火山 App ID/Token 分别来自运行时与环境时为 `mixed`。`runtime_credential_fields` 只列出实际保存于 `settings.json`、允许回显的前端字段名，不含值。

### 10.2 PATCH /api/settings/providers/{provider}

保存 provider 配置。`provider` ∈ `llm_deepseek | llm_qwen | llm_moonshot | tts_aliyun | tts_volc | minimax`。

- 请求示例（LLM/阿里云 TTS）：

```json
{ "revision": 3, "credential": "sk-new", "model_id": "deepseek-chat" }
```

- 请求示例（火山 TTS）：

```json
{ "revision": 3, "app_id": "123456", "access_token": "token-new" }
```

- 请求示例（MiniMax Music）：

```json
{ "revision": 3, "credential": "minimax-key-new", "model_id": "music-3.0" }
```

- 凭据字段未传表示保留当前值；空字符串非法，不承担清除语义。
- `model_id` 去除首尾空白后必须非空，不要求跨 provider 唯一。
- 校验和原子持久化全部成功后更新内存快照，响应 200 为新的脱敏 provider 状态及递增后的 revision。
- revision 过期返回 409 `SETTINGS_REVISION_CONFLICT`；不支持的 provider/字段返回 422 `SETTINGS_PARAMS_INVALID`。

### 10.3 DELETE /api/settings/providers/{provider}/credentials

请求体 `{ "revision": 3 }`。删除该 provider 在 `settings.json` 中保存的凭据（火山同时删除运行时 App ID/Token）；环境变量存在时立即回退到环境值，否则变为未配置。模型 ID 运行时覆盖不随凭据删除。

### 10.4 POST /api/settings/providers/{provider}/credentials/reveal

仅回显浏览器保存的单个凭据字段。请求体为 `{ "revision": 3, "field": "credential" }`；火山字段使用 `app_id | access_token`，其余可写 provider 使用 `credential`。

- 成功响应：`{ "revision": 3, "field": "credential", "value": "sk-full-value" }`，并设置 `Cache-Control: no-store`。
- `.env` 基线值、未通过浏览器保存的字段、未知 provider 或字段错配一律返回 422，响应和错误信息不得包含完整值。
- revision 过期返回 409；接口执行与写接口相同的本机 Origin 校验。
- 前端不得把响应写入 localStorage、sessionStorage、URL 或 Query 缓存；组件卸载及保存成功时清除内存明文。

### 10.5 PATCH /api/settings/runtime

请求体可包含 `llm_timeout_seconds`（1–600）和 `minimax_timeout_seconds`（30–1200），并必须包含 revision。至少提供一个待修改字段；其余环境参数不可写。响应 200 返回更新后的 `runtime` 与 revision。

### 10.6 GET /api/settings/script-config

读取当前脚本标签配置和系统默认值，响应带 `Cache-Control: no-store`：

```json
{
  "revision": 3,
  "emotion_tags": [{ "name": "asmr", "label": "轻柔耳语", "enabled": true }],
  "vocal_tags": [{ "name": "sighing", "label": "叹息", "enabled": true }],
  "pause_presets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 60],
  "defaults": {
    "emotion_tags": [{ "name": "asmr", "label": "轻柔耳语", "enabled": true }],
    "vocal_tags": [{ "name": "sighing", "label": "叹息", "enabled": true }],
    "pause_presets": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25, 30, 60]
  }
}
```

- `name` 是传给模型的英文值：1–64 字符，以英文字母开头，后续只允许英文字母、数字、空格和 `-`；服务端统一转小写并折叠连续空格。同一类别规范化后不得重复。
- `label` 是 1–20 字符中文显示名，禁止方括号和控制字符；`enabled=false` 的项仍保留在配置中，但不出现在编辑器插入列表。
- 情绪和语气词各最多 20 项；停顿最多 20 项且不得重复，每项必须为整数 1–300 秒。配置列表顺序就是编辑器展示顺序。
- 系统默认情绪为 7 项、语气词为阿里云官方 7 项、停顿为 15 项；“恢复默认”由前端把 `defaults` 复制到编辑态，仍需用户显式保存。

### 10.7 PATCH /api/settings/script-config

以完整快照替换三类配置：

```json
{
  "revision": 3,
  "emotion_tags": [{ "name": "asmr", "label": "轻柔耳语", "enabled": true }],
  "vocal_tags": [{ "name": "sighing", "label": "叹息", "enabled": true }],
  "pause_presets": [1, 2, 3, 5, 10]
}
```

- 三个集合均必传，允许空数组；校验成功后原子写入 `settings.json`，revision +1，响应 200 与 10.6 相同。
- revision 过期返回 409 `SETTINGS_REVISION_CONFLICT`；字段、数量、名称、重复或范围非法返回 422 `SETTINGS_PARAMS_INVALID`。
- 执行本机 Origin 校验；失败时不得修改内存配置或落盘文件。

### 10.8 POST /api/settings/probe/{provider}

连通性测试（真实轻量探测）。

- `provider` ∈ `llm_deepseek | llm_qwen | llm_moonshot | tts_aliyun | tts_volc | minimax | ffmpeg`，与 status/update 命名一致。
- `tts_aliyun` 的配置状态与探测只使用 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`；未配置独立 TTS Key 时，即使 `DASHSCOPE_API_KEY` 已配置也返回未配置。
- 响应 200（探测本身 200，结果在体内）：

```json
{ "ok": true, "latency_ms": 842, "message": "合成成功（1.2s 音频）" }
```

- 未配置 → `{ "ok": false, "latency_ms": 0, "message": "未配置 API Key" }`（仍 200）。
- 保存与探测相互独立；探测失败不回滚配置。即使 `FAKE_MODE=true`，probe 仍是明确的真实第三方服务调用。
- 与其他设置 POST/PATCH/DELETE 一致，probe 执行本机 Origin 校验；非本机页面请求返回 403 `SETTINGS_ORIGIN_FORBIDDEN`，且不得发起第三方调用。
- 热生效语义：通常由任务在开始执行时读取最新配置；TTS 是模型/音色绑定的例外——模型与音色在提交时冻结，执行时只读取最新凭据，避免排队期间切换模型导致错配。

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
| `SCRIPT_ATTACHMENT_COUNT_INVALID` | 422 | 单次附件超过 3 个 | 保留已选附件并提示 |
| `SCRIPT_ATTACHMENT_NAME_INVALID` | 422 | 文件名为空、包含路径或 NUL | 移除无效附件并提示 |
| `SCRIPT_ATTACHMENT_TYPE_INVALID` | 422 | 非 `.md` / `.txt` | 提示支持的格式 |
| `SCRIPT_ATTACHMENT_SIZE_INVALID` | 422 | 单文件超过 200 KB 或合计超过 500 KB | 移除超限附件并提示 |
| `SCRIPT_ATTACHMENT_CONTENT_INVALID` | 422 | 正文为空、含 NUL 或合计超过 60000 字符 | 提示转换/缩减文件 |
| `SCRIPT_LLM_NOT_CONFIGURED` | 422 | 模型未配置 | 引导去设置页 |
| `SCRIPT_LLM_ERROR` | 502 | LLM 调用失败（脱敏） | 失败卡片+重试 |
| `SCRIPT_TIMEOUT` | 504 | LLM 流式超时 | 失败卡片+重试 |
| `TTS_TEXT_EMPTY` / `TTS_TEXT_TOO_LONG` | 422 | 文本校验 | 表单校验提示 |
| `TTS_PARAMS_INVALID` | 422 | 引擎/音色/语速/格式非法 | 表单校验提示 |
| `TTS_VOICE_NOT_FOUND` | 404 | 音色不存在 | 刷新 defaults |
| `TTS_CUSTOM_VOICE_PARAMS_INVALID` | 422 | 自定义音色模型、ID、名称非法或尝试修改不可编辑字段 | 保留表单并定位字段 |
| `TTS_CUSTOM_VOICE_NOT_FOUND` | 404 | 自定义音色记录不存在 | 刷新音色配置列表/defaults |
| `TTS_CUSTOM_VOICE_DUPLICATE` | 409 | 同模型相同自定义音色已存在 | 提示编辑已有音色 |
| `TTS_CUSTOM_VOICE_SYSTEM_CONFLICT` | 409 | 与同模型项目内置系统音色冲突 | 直接使用系统音色 |
| `TTS_CUSTOM_VOICE_PREVIEW_NOT_FOUND` | 404 | 自定义音色尚无试听缓存 | 先执行试听验证 |
| `TTS_CUSTOM_VOICE_VERIFY_FAILED` | 502 | 真实试听验证失败且状态已记录 | 显示脱敏原因并允许重试 |
| `TTS_CUSTOM_VOICE_DELETE_FAILED` | 500 | 自定义音色试听缓存无法删除 | 检查 DATA_DIR 权限后重试 |
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
| `SETTINGS_PARAMS_INVALID` | 422 | provider、运行时或脚本配置的字段、数量、名称、重复项或参数范围非法 | 保留表单并定位字段 |
| `SETTINGS_REVISION_CONFLICT` | 409 | 配置已被其他页面更新 | 刷新状态后重试 |
| `SETTINGS_PERSIST_FAILED` | 500 | 运行时配置原子持久化失败，旧配置保持有效 | 提示检查 DATA_DIR 权限后重试 |
| `SETTINGS_ORIGIN_FORBIDDEN` | 403 | 配置写请求不是允许的本机同源来源 | 阻止写入并提示仅限本机使用 |
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
