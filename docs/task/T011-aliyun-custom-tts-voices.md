# T011：阿里云自定义 TTS 音色库

## 1. 任务信息

- 状态：已完成并验收通过
- 优先级：P1
- 类型：TTS 与设置页增量任务
- 前置任务：T004（TTS 合成线）、T007（模型与环境设置）
- 后续任务：无
- 目标目录：`backend/app/tts/`、`backend/app/database.py`、`backend/app/settings.py`、`backend/tests/`、`frontend/src/pages/TtsPage.tsx`、`frontend/src/pages/SettingsPage.tsx`、`frontend/src/features/tts/`、`frontend/src/api/`、`frontend/src/styles/`
- 创建日期：2026-09-05
- 关联文档：`docs/tech/api-contract.md`（第 7、10、12 节）、`docs/tech/data-model.md`（TTS 音色与试听缓存）、`docs/tech/tech-design.md`（TTS 音色库）、`docs/ops/T004-tts-line-ops.md`
- 官方参考：[Qwen-Audio-TTS 音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)、[声音复刻](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)

## 2. 背景与目标

当前 TTS 页只能选择后端硬编码的少量系统音色，提交和试听也会拒绝不在该白名单内的 `voice_id`。阿里云实际还提供大量基础音色，并允许用户创建绑定特定模型的复刻音色；继续扩充硬编码列表无法满足按需配置和长期管理。

本任务新增一个由后端 SQLite 持久化的阿里云自定义音色库。用户可在设置页为任意模型预先登记音色 ID 和可选显示名称，进行有缓存的试听验证，并在 TTS 页选择与当前 `ALIYUN_TTS_MODEL_ID` 匹配的已登记音色生成音频。配置对所有连接同一后端、使用同一 `DATA_DIR/audio.sqlite3` 的浏览器共享。

本任务只登记和使用已有音色，不创建、复刻或删除阿里云账号中的远端音色。

## 3. 已确认设计决策

- 自定义音色保存到后端 SQLite，可新增、删除、重命名并跨浏览器共享；不使用 localStorage，不提供账号体系、云同步或多设备同步。
- 设置页参考产物库的 Ant Design `Tabs` 切换交互，拆为“模型与环境设置”和“音色配置”两个 Tab；默认仍进入“模型与环境设置”。
- TTS 页只负责选择和使用音色，不在该页新增、编辑或删除音色。
- 新增音色时由用户手动填写模型 ID，可提前配置当前未启用模型的音色。
- 音色严格绑定模型；同一模型下相同 `voice_id` 只允许一条，不同模型可使用相同 `voice_id`。
- TTS 页只展示当前 `ALIYUN_TTS_MODEL_ID` 对应的系统音色和自定义音色；其他模型的配置保留在数据库中，切换回对应模型后重新出现。
- 自定义音色可填写可选显示名称；名称为空时回退显示完整 `voice_id`。显示名称允许重复。
- `voice_id` 和绑定模型创建后不可修改，只允许修改显示名称；换 ID 或模型需删除后重新新增。
- 不允许把项目已内置、且属于同一模型的系统音色重复登记为自定义音色。
- 本期仅逐条新增，不支持批量粘贴或 Excel 导入。
- 自定义音色不配置适用场景；用户手动选择后切换冥想/播客场景时保持该音色，不被场景推荐覆盖。
- 保存后初始状态为“未验证”；试听成功记录“已验证”和时间，试听失败记录“验证失败”并允许保留和重试。
- 普通试听优先播放缓存，不重复计费；提供明确的“重新验证”操作，二次确认其会绕过缓存并可能再次产生费用。
- 删除只移除本地音色配置及对应试听缓存，不调用阿里云删除接口，不删除历史 run 或已生成产物。
- 修正内置系统音色名称：“龙安聆心”改为“龙安灵心”，“龙安陆风”改为“龙安鲁风”。

## 4. 行为基线与边界

### 4.1 模型兼容性

- 阿里云规定 `model` 与 `voice` 必须匹配；本地不能仅凭 ID 格式证明兼容性，真实试听验证和正式合成的上游响应是最终事实源。
- 手动登记模型 ID 只建立绑定关系，不承诺为现有 `AliyunTTSProvider` 增加新协议。仅与当前 `/services/audio/tts/SpeechSynthesizer` 调用方式兼容的模型可成功试听和合成。
- 项目内置系统音色也必须改为按模型组织。现有两项阿里云内置音色只归属 `qwen-audio-3.0-tts-plus`，不得在其他模型的 defaults 中继续出现。
- 本期不自动下载或同步阿里云 Excel 音色表，也不联网刷新官方音色元数据。

### 4.2 历史快照

- TTS 提交时把实际 `model`、`voice_id`、解析后的 `voice_name` 和 `voice_source` 写入 run 请求快照。
- 自定义音色后续重命名或删除不改写既有 run、产物名称和 `params_json`。
- 已排队任务即使对应自定义音色随后被删除，也继续使用提交时快照；删除不承担取消任务语义。
- 修正当前 TTS handler 在执行阶段用最新设置覆盖 `snapshot.model` 的行为：模型使用提交时不可变快照，API Key 等凭据仍在执行时读取当前设置。
- 相同请求的活动任务判重继续包含模型、音色 ID 和音色名称等完整快照。

### 4.3 设置写入安全

- 音色新增、修改、删除、首次验证和强制重新验证均属于设置类写入或可能计费操作，执行与现有设置接口一致的本机 Origin 校验。
- 查询列表和播放已缓存音频为只读操作。
- 服务仍是本地可信用户模型；本任务不新增登录、租户或权限系统。

## 5. 数据模型与 Repository

### 5.1 新表

在 `backend/app/database.py` 的幂等 `SCHEMA` 中新增：

```sql
CREATE TABLE IF NOT EXISTS tts_custom_voices (
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
CREATE INDEX IF NOT EXISTS idx_tts_custom_voices_model
  ON tts_custom_voices(engine, model, created_at DESC);
```

约定：

- `id` 使用 `cvoice_{unix毫秒}_{6位随机}`。
- `engine` 本期只允许 `aliyun`，保留字段是为了明确唯一键和未来扩展边界。
- `name` 为空时保存 `NULL`；API 额外返回计算后的 `display_name = name || voice_id` 语义。
- `verification_status` 仅允许 `unverified | verified | failed`。
- 首次真实试听成功：状态改为 `verified`，写 `last_checked_at/last_verified_at` 并清空 `last_error`。
- 试听失败：状态改为 `failed`，更新 `last_checked_at/last_error`；若过去成功过，保留 `last_verified_at` 作为历史信息。
- `last_error` 只保存 Provider 已脱敏、截断后的安全错误，不保存请求文本、Key、内部路径或完整响应体。
- 仅重命名不重置验证状态；ID 和模型没有 PATCH 入口。

### 5.2 Repository 方法

新增并测试以下原子操作：

- `create_tts_custom_voice(...)`
- `get_tts_custom_voice(id)`
- `list_tts_custom_voices(engine=None, model=None)`
- `rename_tts_custom_voice(id, name)`
- `set_tts_custom_voice_verification(...)`
- `delete_tts_custom_voice(id)`，返回删除前快照供路由清理缓存
- `find_tts_custom_voice(engine, model, voice_id)`

重复唯一键由 Repository 映射成稳定的领域冲突，不向 API 泄露 SQLite 错误文本。旧数据库通过 `CREATE TABLE IF NOT EXISTS` 幂等升级，不改写已有 run 和 artifact。

## 6. API 契约

### 6.1 自定义音色资源

#### GET `/api/tts/custom-voices?model=`

- 默认返回全部阿里云自定义音色，按模型、创建时间稳定排序；可选 `model` 精确过滤。
- 响应：`{ "items": [TtsCustomVoice, ...] }`。
- 返回内部资源 ID、模型、实际音色 ID、可选名称、计算后的显示名称、验证状态与时间，不返回凭据或试听文件路径。

#### POST `/api/tts/custom-voices`

```json
{
  "model": "qwen-audio-3.0-tts-plus",
  "voice_id": "qwen-audio-3.0-tts-plus-xxx",
  "name": "温柔女声 03"
}
```

- `model`、`voice_id` 去除首尾空白后必填，长度 1–200；只允许 ASCII 字母、数字、点、下划线、连字符，且首字符必须是字母或数字。
- `name` 可省略或为 `null`；非空时去除首尾空白，最长 100 字符，拒绝 NUL 和控制字符。纯空白归一为 `null`。
- 同一模型相同 ID 返回 409，并提示编辑已有音色；不同模型相同 ID 允许存在。
- 与该模型下项目内置系统音色冲突时返回 409。
- 创建成功返回 201 和状态为 `unverified` 的完整资源；保存本身不调用阿里云、不产生试听费用。

#### PATCH `/api/tts/custom-voices/{id}`

- 请求仅接受 `{ "name": "新名称" }` 或 `{ "name": null }`，不接受 `model/voice_id/engine/status`。
- 响应 200 为更新后的完整资源。

#### DELETE `/api/tts/custom-voices/{id}`

- 删除数据库记录及该资源对应试听缓存。
- 不调用阿里云，不删除历史 run、artifact 或正式音频。
- 响应：`{ "deleted": true }`。

### 6.2 验证与试听

#### POST `/api/tts/custom-voices/{id}/verify`

请求：

```json
{ "force": false }
```

- `force=false`：存在有效缓存时直接返回缓存信息，不请求阿里云；无缓存时用固定短句进行一次真实合成。
- `force=true`：忽略缓存重新请求阿里云；前端必须经过带费用提示的二次确认。
- 请求使用资源自身绑定的 `model/voice_id`，因此可验证当前尚未设为 `ALIYUN_TTS_MODEL_ID` 的预配置音色。
- 成功后原子替换 WAV 缓存，再写验证状态；响应包含更新后的资源、`preview_url` 和 `cache_hit`。
- 失败时不覆盖旧缓存；数据库记录状态为 `failed`，API 返回脱敏错误。若存在过去缓存，UI 可继续明确标注为“旧缓存”，不能把播放旧缓存解释为当前验证成功。
- `FAKE_MODE` 自动化路径仍走完整状态和缓存流程；真实验收必须显式使用真实配置，避免测试套件产生费用。

#### GET `/api/tts/custom-voices/{id}/preview`

- 只播放已生成缓存，不触发 Provider 调用，不产生费用。
- 支持 `audio/wav` 和 HTTP Range；无缓存返回 404。

### 6.3 defaults 与 TTS jobs

- `GET /api/tts/defaults` 从 Repository 读取当前阿里云模型的自定义音色，与该模型的项目内置系统音色合并。
- `voices[]` 增加 `source: "system" | "custom"`；自定义项额外返回 `custom_voice_id` 和验证状态，系统项对应字段为空。
- 阿里云 TTS job 只接受“当前模型的内置音色”或“数据库中绑定当前模型的自定义音色”。仅在请求中临时填写、但未保存的任意 ID 仍返回 `TTS_VOICE_NOT_FOUND`。
- 火山引擎保持现有白名单，不读取自定义音色表。
- 自定义音色未验证或验证失败时仍允许正式提交；TTS 页需给出非阻断提示，最终结果由 Provider 决定。

### 6.4 错误码

新增或明确：

| 错误码 | HTTP | 场景 |
| --- | --- | --- |
| `TTS_CUSTOM_VOICE_PARAMS_INVALID` | 422 | 模型、音色 ID 或名称非法，或 PATCH 含不可编辑字段 |
| `TTS_CUSTOM_VOICE_NOT_FOUND` | 404 | 自定义音色资源不存在 |
| `TTS_CUSTOM_VOICE_DUPLICATE` | 409 | 同模型相同自定义音色已存在 |
| `TTS_CUSTOM_VOICE_SYSTEM_CONFLICT` | 409 | 与同模型项目内置系统音色冲突 |
| `TTS_CUSTOM_VOICE_PREVIEW_NOT_FOUND` | 404 | 尚无可播放的试听缓存 |
| `TTS_CUSTOM_VOICE_VERIFY_FAILED` | 502 | 真实试听验证失败，资源状态已记录为 failed |

现有 `TTS_VOICE_NOT_FOUND` 继续用于 TTS job/defaults 音色解析失败，现有 `TTS_PROVIDER_ERROR` 继续用于正式合成失败。

## 7. 试听缓存与文件安全

- 缓存身份必须包含 `engine + model + voice_id`，避免切换模型后复用错误音频。
- 文件名使用上述规范化身份的 SHA-256 摘要，不直接拼接用户输入，例如 `previews/aliyun_{sha256}.wav`。
- 内置音色试听同步改用模型感知的缓存键，兼容旧文件无需迁移；旧 `{engine}_{voice}.wav` 可留存但不再命中。
- 首次/强制验证均先写同目录 `.part`，完成 WAV 校验后 `os.replace` 原子替换。
- 失败或取消不得留下 `.part`；强制验证失败不得破坏已有成功缓存。
- 重命名不改缓存身份；删除自定义音色清理其 WAV 和 `.part`，清理失败不得恢复已删除数据库记录，但应返回或记录可诊断的安全错误。

## 8. 后端实现范围

### 8.1 音色目录

- 把 `backend/app/tts/voices.py` 的阿里云系统音色改为按模型映射；火山保持现有结构。
- 增加统一的音色解析函数，返回系统/自定义来源和显示名称；提交、试听、defaults 共用，避免三套规则漂移。
- 修正官方名称为“龙安灵心”“龙安鲁风”。
- 场景推荐只匹配当前模型实际返回的系统音色；自定义音色不加入推荐 ID。

### 8.2 Provider 与任务快照

- `AliyunTTSProvider` 支持显式模型参数，验证预配置音色和执行 TTS 快照时不强制使用当前全局模型。
- Provider 仍只读取 `ALIYUN_TTS_API_KEY`，不得回退到 LLM 的 `DASHSCOPE_API_KEY`。
- TTS handler 使用提交时 `snapshot.model`；若模型配置随后变化，不静默替换为新模型。
- 能力声明继续按实际执行的 engine/model/voice 解析。未专门声明的新模型沿用现有兼容降级规则，本任务不宣称其 SSML、pitch 或 instruction 已验证。

### 8.3 设置探测兼容

- 当前模型有内置音色时，阿里云 Provider probe 继续优先使用内置首项。
- 当前模型没有内置音色时，可使用该模型已配置的自定义首项；完全没有可用音色时返回明确的“请先配置音色”结果，不得因空列表产生 500。

## 9. 前端实现范围

### 9.1 设置页 Tab

- 在 `SettingsPage.tsx` 顶层增加 `Tabs`，交互和视觉参考 `LibraryPage.tsx`。
- “模型与环境设置”Tab 完整承载现有 Provider、运行时和本地环境内容，现有行为和查询键不变。
- “音色配置”Tab 承载阿里云自定义音色管理；支持通过稳定的 Tab key 直接打开，供 TTS 页空状态引导。
- Tab 切换不卸载正在提交的表单状态；刷新后以默认 Tab 或 URL 中合法 Tab key 恢复，非法 key 回退默认。

### 9.2 音色配置 Tab

- 页头说明：只登记已有音色；模型和音色必须匹配；保存不收费，首次试听/强制重新验证可能收费；删除不影响阿里云远端音色。
- 提供“新增音色”按钮和 Modal，字段为模型 ID、音色 ID、可选音色名称。
- 列表展示：显示名称、完整音色 ID、绑定模型、验证状态、最近检查/成功时间、操作。
- 完整 ID 和模型长文本支持省略展示、复制或 `title` 查看，不撑破窄屏。
- 操作包括：普通试听、重新验证、重命名、删除。
- 普通试听命中缓存时直接播放；无缓存时按钮文案/提示明确会进行一次验证。
- 强制重新验证使用 `Popconfirm` 明确提示可能再次产生阿里云费用。
- 失败后刷新对应资源并显示脱敏原因；允许继续重命名、删除或重试。
- 删除二次确认明确说明“仅删除 Audio Studio 本地配置与试听缓存，不删除阿里云音色”。
- React Query mutations 成功后失效 `['tts-custom-voices']` 和 `['tts-defaults']`；并发失败、404 和 409 使用后端稳定文案。

### 9.3 TTS 页

- 音色 Select 使用分组 options，顺序为“系统音色”“我的音色”；自定义显示名称后附简短 ID 便于辨认。
- 系统推荐星标只作用于系统音色；自定义音色不自动成为场景推荐。
- 当前选中自定义音色时切换场景只更新语速，不覆盖音色；系统音色保持既有场景推荐联动。
- 切换引擎或阿里云模型后，如果原音色不在新列表中，使用当前场景推荐系统音色，找不到时回退首项。
- 当前模型没有任何音色时，禁用提交和试听，展示前往设置页“音色配置”Tab 的提示。
- 自定义音色试听复用验证/缓存 API；未验证或失败状态显示非阻断提示。
- 提交载荷仍只发送实际 `voice_id`，不信任客户端发送名称、来源或绑定模型；后端重新解析并生成快照。
- 合成结果继续展示任务快照中的 `voice_name`；名称为空时显示完整 ID。

### 9.4 前端类型与 API 模块

- 新增 `TtsCustomVoice`、列表、创建、重命名、验证响应类型。
- 扩展 `TtsVoice`：`source`、可空 `custom_voice_id`、可选验证状态字段。
- 在 `frontend/src/api/tts.ts` 增加 CRUD、验证和缓存播放函数；所有资源路径参数用 `encodeURIComponent`。
- 把音色 option 分组、场景切换保留规则等纯逻辑下沉到 `features/tts/`，便于 Vitest 覆盖。

## 10. 不实现

- 调用阿里云声音复刻/创建接口。
- 查询或删除阿里云账号中的远端自定义音色。
- 自动同步官方系统音色、基础音色 Excel 或账号音色列表。
- 批量粘贴、CSV/Excel 导入导出。
- 音色适用场景、风格标签、收藏、排序或默认音色配置。
- 修改已创建记录的模型或 `voice_id`。
- 火山引擎自定义音色。
- 账号、租户、权限、云同步和不同后端实例之间的数据同步。
- 为不同阿里云模型新增专属 Provider 协议或未经验证的能力声明。

## 11. 状态与数据流

```text
设置页 / 音色配置
  → POST 自定义音色（model + voice_id + name?）
  → SQLite 保存为 unverified
  → 普通试听：有缓存则直接播放；无缓存则 verify
  → 显式重新验证：二次确认 → force verify
  → Provider 使用记录绑定的 model + voice_id
  → 成功：原子缓存 WAV + verified/时间
  → 失败：保留记录与旧缓存 + failed/脱敏错误

TTS 页
  → GET defaults
  → 当前 ALIYUN_TTS_MODEL_ID 的系统音色 + 自定义音色
  → 选择实际 voice_id
  → POST job
  → 后端按当前模型重新解析音色并冻结 model/id/name/source 快照
  → handler 使用模型快照合成
  → 产物保存完整音色快照
```

关键一致性约定：

- SQLite 是自定义音色元数据唯一事实源；试听 WAV 是可重建缓存。
- settings 中的当前模型决定 TTS 页可见和可提交音色，不限制设置页提前管理其他模型。
- 验证状态是“最近一次真实验证结果”，不是永久有效性承诺。
- 缓存命中只证明存在历史试听音频，不等同于当前上游仍接受该音色。

## 12. 测试

### 12.1 后端 Repository 与迁移

- 新旧数据库初始化均存在新表和索引；既有数据、run、artifact 不变。
- CRUD、可空名称、同模型唯一、跨模型同 ID、稳定排序和 NotFound。
- 验证状态迁移：unverified → verified、unverified/verified → failed、失败后再次 verified。
- 重命名保留验证状态；删除返回快照并只删除目标记录。

### 12.2 后端 API 与 TTS 链路

- model/voice/name 的空值、边界长度、非法字符、额外字段校验。
- 同模型重复返回 409；跨模型同 ID 成功；项目内置系统音色冲突返回 409。
- 自定义音色列表支持全部和 model 过滤，不泄露内部文件路径。
- 首次验证调用 Provider 一次并生成缓存；二次普通验证命中缓存且不调用 Provider；force 再调用一次。
- 验证失败持久化 failed 和脱敏错误；旧缓存不被覆盖；再次成功可恢复 verified。
- 缓存文件名不包含原始模型或音色 ID；不同模型同 ID 不冲突；删除清理对应缓存。
- defaults 只合并当前模型的自定义音色；其他模型音色不可提交。
- 未验证和 failed 自定义音色仍可提交；未登记任意 ID仍返回 `TTS_VOICE_NOT_FOUND`。
- 火山白名单行为不变。
- TTS artifact params 包含提交时 model/voice_id/voice_name/voice_source。
- 排队后修改全局模型，handler 仍使用提交时模型快照；更新 API Key 仍在执行时生效。
- 当前模型无内置音色时 settings probe 使用自定义音色或返回可理解的缺少音色结果。
- 所有音色管理写操作和真实验证执行本机 Origin 校验。
- FAKE_MODE 覆盖 CRUD、验证缓存、任务完成和删除生命周期；真实 Provider 调用只能由显式人工验收触发。

### 12.3 前端

- 设置页默认展示“模型与环境设置”，切换“音色配置”后现有设置表单状态不丢失。
- 新增 Modal 的必填、可选名称、长度和字符提示；成功后列表刷新。
- 列表正确展示模型、ID、回退名称、三种验证状态和时间。
- 普通试听区分缓存命中/首次验证；强制重新验证必须二次确认；失败信息正确刷新。
- 重命名只能发送名称；清空名称后回退 ID；删除确认文案不暗示删除阿里云远端资源。
- TTS Select 按系统/自定义分组，只显示当前模型音色。
- 选中自定义音色后切换场景保持选择；系统音色仍按推荐规则切换。
- 模型/引擎变化导致音色失效时正确回退；空列表禁用提交并显示设置入口。
- 请求只提交实际 voice ID；自定义显示名称不进入客户端可信载荷。
- React Query 失效范围正确，不产生重复 Provider 请求。

### 12.4 验证命令与人工验收

- 后端：`pytest`
- 前端：`npm test -- --run`
- 前端类型与生产构建：`npm run build`
- 前端代码规范：`npm run lint`
- 人工：在真实阿里云配置下逐条验证一个当前模型音色和一个预配置模型音色；真实验证前明确确认会产生少量调用费用。
- 人工：两个浏览器连接同一后端，确认新增、重命名、验证状态和删除结果共享。

## 13. 同步技术文档

- 更新 `docs/tech/api-contract.md`：defaults 扩展、自定义音色 CRUD/验证/试听、TTS job 校验、设置页结构和错误码。
- 更新 `docs/tech/data-model.md`：`tts_custom_voices` 表、验证状态、缓存键和删除生命周期。
- 更新 `docs/tech/tech-design.md`：系统/自定义音色合并、模型绑定、Provider 显式模型和任务快照一致性。
- 更新 `docs/ops/T004-tts-line-ops.md`：设置页音色管理、首次试听费用、强制重新验证、模型切换与真实验收步骤。
- 更新旧文档中“音色必须在后端硬编码列表内”“试听缓存只按 engine+voice 命名”等过时描述。

## 14. 验收标准

- [x] 设置页包含“模型与环境设置”“音色配置”两个 Tab，现有设置功能无回归。
- [x] 可逐条新增绑定任意手填模型 ID 的阿里云音色，名称可选且可单独修改。
- [x] 配置保存在 SQLite，同一后端的不同浏览器读取结果一致。
- [x] 同模型重复 ID 和项目内置系统音色冲突被稳定拒绝；跨模型相同 ID 可保存。
- [x] 首次试听成功写入缓存和 verified 时间；失败保留配置并显示 failed；普通重播不计费，强制重验有费用确认。
- [x] TTS 页只展示当前模型对应音色，系统与自定义分组清晰；自定义音色可试听并用于正式生成。
- [x] 自定义音色切换场景不被覆盖；切换模型/引擎时不会保留无效选择。
- [x] TTS run 和产物冻结实际模型、音色 ID、提交时名称与来源；排队期间切换全局模型不造成错配。
- [x] 删除只影响本地记录和试听缓存，不调用阿里云删除接口，不影响历史任务与产物。
- [x] 内置名称已修正为“龙安灵心”“龙安鲁风”，且内置音色按模型返回。
- [x] 缓存键包含模型且不直接使用用户输入作为文件名；失败不破坏旧缓存、不遗留 `.part`。
- [x] API 契约、数据模型、技术设计、运维说明和前后端类型同步更新。
- [x] `pytest`、`npm test -- --run`、`npm run build`、`npm run lint` 全部通过，真实试听只在人工明确确认后执行。

## 15. 完成记录

- 完成日期：2026-09-05
- 自动化验证：后端 188 passed、5 skipped；前端 68 passed；生产构建和 ESLint 通过。
- 人工验收：真实阿里云自定义基础音色试听通过；`qwen-audio-3.0-tts-plus-longlinshuoxi` 可正常验证和播放。
- 关联缺陷：`ISSUE-006` 已修复并验收关闭。
