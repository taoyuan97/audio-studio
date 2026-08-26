# T004：TTS 线（双引擎 Provider + 分段合成 + TTS 页）

## 1. 任务信息

- 状态：阿里云 TTS 验收通过；火山延期（待官方鉴权说明）
- 优先级：P0
- 类型：正式任务 4/8
- 前置任务：T003（脚本产物输入）
- 后续任务：T006（voice 产物作为混音输入）
- 目标目录：`backend/app/tts/`、`backend/app/tts.py`、`frontend/src/features/tts/`、`frontend/src/components/AudioPlayer/`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.2）、`docs/tech/tech-design.md`（5.6）、`docs/tech/api-contract.md`（第 7 节）、`docs/tech/data-model.md`（5.2）、`docs/ops/T004-tts-line-ops.md`（人工配置与验收）
- 移植来源：`C:\projects\apps\meditation-guide-studio\backend\app\services\{tts_aliyun,tts_volcano,tts_capabilities}.py`、`render_plan_service.py`（ALIYUN_VOICES）
- 配置决策：阿里云 TTS 与通义千问 LLM 配置彻底隔离；TTS 仅使用 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`，不得回退读取 `DASHSCOPE_*`
- 验证记录（2026-08-26）：阿里云真实 smoke、试听缓存、带标记 WAV、MP3 320k、Range/peaks 均通过；真实验证确认默认 `qwen-audio-3.0-tts-plus` 能力为 instruction=true、SSML=false、pitch=false
- 人工验收（2026-08-26）：阿里云 TTS 的 MP3、WAV 均可正常生成和试听，音质、instruction 听感及分段拼接符合验收预期
- 延期决策：火山 TTS 暂不验证，待取得官方鉴权配置说明后单独恢复，不阻塞阿里云单引擎里程碑

## 2. 目标

实现 TTS 人声合成完整链路：双引擎 Provider（阿里云 Qwen-TTS / 火山豆包，代码移植自已验证项目）、能力声明降级、标记 → 合成计划（SSML break / 静音切分双策略）、分段合成拼接、音色库与试听、TTS 页。完成后冥想脚本可一键变为可播放人声干声。

## 3. 行为基线（继承原型 tts 页语义 + 决策 B2/B3/E2/E4/E7）

- 交互同原型：脚本来源下拉（产物库脚本 + 粘贴兜底）、场景联动预设（冥想 0.8x/播客 1.0x + 推荐音色高亮）、引擎切换联动音色、音色试听、语速/音调滑块、合成进度、结果播放 + 波形。
- 标记处理承诺（PRD 5.2）：能力声明支持 SSML 时 `[停顿 Ns]` 优先 break（超长切静音）；默认阿里云 Qwen 与火山均不支持 SSML，因此切本地静音；`[吸气]`4s/`[呼气]`5s；`[情绪:x]` 阿里云 instruction 直传、火山降级普通朗读；`[语速:x]` 分段 rate；标记不朗读出口。
- 全链路 48kHz；MP3 320k / WAV 16bit（E2/E3）。
- 试听按「引擎+音色」缓存，重复试听不重复计费。
- 完成自动入库（params 完整快照含来源脚本 id）。

## 4. 范围

### 4.1 必须实现

**后端（Provider 层移植 + 适配）**

- `app/tts/providers.py`：
  - `AliyunTTSProvider`（移植 tts_aliyun.py）：只从 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID` 初始化（默认模型 `qwen-audio-3.0-tts-plus`，不回退 `DASHSCOPE_*`）；调用 `/services/audio/tts/SpeechSynthesizer`，payload 含 sample_rate/volume/rate/pitch/instruction/enable_ssml，Bearer 鉴权，SSE 响应流式解析拼接音频；仅 Qwen 分支（不移植 sambert，E7）。默认模型真实验证仅开启 instruction，SSML/pitch 由能力声明关闭。
  - `VolcTTSProvider`：当前按 `VOLC_TTS_APP_ID` + 最终 `VOLC_TTS_ACCESS_TOKEN` 直连合成 API、解码二进制 frame；官方鉴权配置说明未确认，真实验证延期。若实际凭证需要 HMAC 换 token，恢复任务时调整 Provider 与环境变量。
  - 统一接口 `synthesize(text, {voice, speed, pitch, emotion, ssml_breaks}) -> WAV bytes`；返回采样率/声道元信息供拼接校验。
- `app/tts/capabilities.py`（移植 tts_capabilities.py）：按 provider/model/voice 声明 supports_ssml/instruction/pitch、max_ssml_pause_ms、音色白名单；提交与计划构建时校验降级。
- `app/tts/voices.py`：官方音色硬编码表（阿里云参考移植 ALIYUN_VOICES + 火山官方列表；id/名称/风格标签/推荐场景）。
- `app/tts/plan.py`：markers segments → 合成计划——SSML 模式：`<break time="Nms"/>` 内嵌（≤max_ssml_pause_ms），超长/不支持切独立静音段；静音段 4s/5s/按秒；段内超长再按句号切分。
- `app/tts.py`：defaults / preview（缓存）/ jobs 端点（api-contract.md 第 7 节）。
- run handler：逐段合成（`tts.progress` + progress_json）→ 静音文件 + concat manifest 拼接（`.part` + `os.replace` 原子落盘，ffprobe 每步复验）→ 编码导出 → 建 voice 产物 → `run.completed`。
- FAKE_MODE：`wave`+`struct` 生成分段正弦/静音 WAV（时长∝文本长度），走完整拼接与落盘路径。
- `app/config.py` / `.env.example`：新增 `ALIYUN_TTS_API_KEY` 与 `ALIYUN_TTS_MODEL_ID`；Key 可空，模型 ID 默认 `qwen-audio-3.0-tts-plus` 且显式空值启动失败；不校验 TTS Key 与 LLM Key 的字符串是否相同。

**前端**

- `/tts` 页（`?artifact_id=` 预选）：
  - 脚本来源 Select（type=script_* 产物，名称/类型/时间）+ 粘贴文本 Tab 兜底（二选一互斥）。
  - 场景 Segmented（来源为脚本产物时自动判定）→ 联动语速默认与推荐音色高亮 + 预设说明文案。
  - 引擎 Select → 联动音色 Select（voices 来自 defaults）；引擎能力不足项禁用（音调滑块对不支持引擎置灰）。
  - 音色试听按钮（`<audio>` 播 preview，加载态/失败提示）。
  - 语速滑块 0.5–1.5、音调滑块（能力支持时）、格式气泡（MP3/WAV）。
  - 提交 → 排队/运行态（进度 n/N + stage）→ 取消 → 结果区：`AudioPlayer/`（`<audio>` + Range 播放）+ `WaveformView/`（peaks 渲染）+ 时长/格式。
  - 失败卡片（错误码文案，如额度不足/引擎错误）+ 重新提交。
  - 「送去混音」入口（跳转 `/mixdown?voice_id=`，T006 接收）。

### 4.2 不实现

- 声音克隆；火山情绪映射（降级为普通朗读，不做近似映射）；试听缓存管理界面。

## 5. 状态与数据流设计

```text
Query: ['tts-defaults'] / ['artifacts', 'script_*'] / ['artifact', id]
Mutation: submitJob / cancel；事件: tts.progress→进度条；run.completed→invalidate ['artifact', newId] 并渲染结果
音频: <audio src="/api/artifacts/{id}/audio">；波形: GET peaks
```

## 6. 测试

- 自动化（pytest）：配置隔离（TTS 不读取 `DASHSCOPE_*`、TTS 模型非空校验）、合成计划构建（SSML/切分双策略矩阵：短停顿/超长停顿/吸气呼气/情绪/语速/段超长切句）、能力降级（火山：SSML 关→全静音切分；instruction 关→情绪忽略）、Provider mock 单测（SSE 解析、token 刷新）、拼接管线（fake WAV：段序/静音时长/48k 一致性/原子落盘/失败清理）、契约端点与事件序列、试听缓存（二次请求不调 Provider）。
- 自动化（Vitest）：表单联动（引擎→音色、场景→预设）、AudioPlayer、提交/进度/结果状态机。
- 手工（真实 Key）：smoke_tts.py 连通复核 + 短脚本真实合成试听。

## 7. 验收标准

- [x] 来源下拉/粘贴互斥；场景联动（语速默认、推荐音色高亮、说明文案）自动化测试通过。
- [x] 引擎切换音色列表联动；不支持音调的引擎滑块置灰并提示。
- [x] 阿里云首次试听真实合成，二次试听缓存命中（时间戳/哈希不变）。
- [x] FAKE_MODE 全流程：提交→分段进度→结果播放/波形/时长→产物入库（params 快照含来源脚本 id）。
- [x] 标记处理：停顿按秒、吸气 4s/呼气 5s、标记文本不进入 Provider 普通朗读文本。
- [x] 取消/失败路径正确，自动化断言无 artifact 与 `.part` 半成品残留。
- [x] 阿里云 `smoke_tts.py` 真实连通通过；WAV/MP3/Range/peaks 与契约测试通过。
- [ ] 火山真实 smoke：延期，待官方鉴权说明。
- [x] 阿里云 TTS 只读取独立的 `ALIYUN_TTS_*` 配置；defaults 与产物 params 返回/保存实际 TTS 模型 ID（设置状态端点归 T007）。
- [x] 人工播放真实 WAV/MP3，确认音质、instruction 听感及拼接点无异常。
