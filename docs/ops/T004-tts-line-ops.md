# T004 TTS 线 — 人工操作与验收手册

> 适用范围：T004（阿里云 Qwen-TTS / 火山 TTS、分段合成、试听与 TTS 页面）中必须由人工提供凭据、安装本地依赖或主观试听确认的部分。
> 自动化测试已覆盖配置隔离、合成计划、能力降级、阿里云 SSE 解析、试听缓存、FAKE_MODE WAV 全链路、表单联动和播放器组件，不在本文重复展开。

## 1. 当前人工事项总览

截至 2026-08-26，编码与自动化验证已经完成，以下事项仍需人工处理：

| 优先级 | 人工事项 | 当前状态 | 完成标志 |
| --- | --- | --- | --- |
| P0 | 安装并配置 ffmpeg / ffprobe | **已完成**：winget FFmpeg 9.0.1，后端可解析两者 | FAKE_MODE MP3 与真实 MP3 均成功 |
| P0 | 配置独立阿里云 TTS Key | **已完成**：脱敏检查通过 | 单引擎 smoke 输出 `OK aliyun` |
| 延期 | 确认火山凭证形态并配置 | 按用户决策暂停，待官方鉴权说明 | 后续单独恢复，不阻塞阿里云里程碑 |
| P0 | 执行阿里云真实 smoke | **已完成**：48kHz/1ch WAV，2.96s | `OK aliyun` |
| P0 | 真实音频人工试听 | 尚未执行 | 停顿、呼吸、情绪、语速和音质清单通过 |
| P1 | 验证首次试听与缓存命中 | **已完成**：首次约 1.42s、二次约 0.16s，文件时间戳/哈希不变 | 第二次未改写缓存 |
| P1 | 验证 MP3 320k 与 WAV 48kHz/16bit | **已完成** | ffprobe 输出符合要求 |

说明：

- 真实 `backend/.env` 含密钥，不得提交 Git、粘贴到任务文档或截图公开传播。
- 阿里云 TTS 与通义千问 LLM **配置项完全隔离**。代码不会用 `DASHSCOPE_API_KEY` 兜底 TTS。
- 两个 Key 的字符串允许相同，但必须分别写入各自环境变量；后续轮换和权限控制互不依赖。
- T007 设置接口/设置页尚未实施，当前不要以 `/settings` 是否展示模型作为 T004 阻塞；本阶段以 defaults、smoke 和实际合成为准。
- T006 混音线尚未实施，因此「送去混音」目前只验证跳转参数，不要求完成后续混音。
- 默认 `qwen-audio-3.0-tts-plus` 已真实确认 `instruction=true`、`SSML=false`、`pitch=false`；阿里云音调滑块同样应置灰，普通停顿走本地静音。

### 1.1 2026-08-26 实施记录

| 验证项 | 结果 |
| --- | --- |
| FFmpeg / ffprobe | 9.0.1；后端发现成功；修复 Windows `ffprobe.exe` 扩展名探测 |
| TTS 专项测试 | 通过，含 FAKE_MODE WAV/MP3、缓存、取消无半成品 |
| 阿里云 smoke | `qwen-audio-3.0-tts-plus` + `longanlingxin`，48000Hz/1ch，2.96s |
| 阿里云试听缓存 | 首次约 1423ms、二次约 162ms；时间戳和 SHA-256 均未变化 |
| 带标记 WAV | 7 段，20.424s，pcm_s16le / 48000Hz / 1ch / 16bit |
| MP3 | 5.048s，mp3 / 48000Hz / 1ch / 320000bps |
| Range | `206 Partial Content`，请求 0–99 返回 100 bytes |
| peaks | 1200 buckets，duration=20.424s，二次缓存命中 |
| 自动化回归 | 后端 111 passed；前端 27 passed；构建和 ESLint 通过 |
| 火山 TTS | 未调用；等待官方鉴权配置说明 |

本次真实验证保留两份产物供人工试听：

- WAV：`backend/data/audio/artifacts/art_1787728225627_7c42f8.wav`
- MP3：`backend/data/audio/artifacts/art_1787728270429_afb9c5.mp3`

## 2. ffmpeg / ffprobe 安装与配置

### 2.1 用途

- WAV 输出由后端直接拼接，不依赖 ffmpeg。
- MP3 320k 编码依赖 ffmpeg。
- MP3 波形解码以及后续 T006 混音同时依赖 ffmpeg / ffprobe。

必须安装同一发行包中的 `ffmpeg.exe` 和 `ffprobe.exe`。

### 2.2 配置方式

以下两种方式任选其一：

1. 将包含 `ffmpeg.exe`、`ffprobe.exe` 的目录加入系统 `PATH`，并将 `.env` 中 `FFMPEG_PATH` 留空。
2. 在 `backend/.env` 中把 `FFMPEG_PATH` 指向 **`ffmpeg.exe` 文件本身**，不要只填目录：

   ```dotenv
   FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
   ```

代码会在 `ffmpeg.exe` 同目录寻找 `ffprobe.exe`。修改后必须重启后端。

### 2.3 验证

在 PowerShell 中执行：

```powershell
ffmpeg -version
ffprobe -version
```

如果使用 `FFMPEG_PATH` 而未加入 PATH，可直接执行配置中的绝对路径：

```powershell
& 'C:\tools\ffmpeg\bin\ffmpeg.exe' -version
& 'C:\tools\ffmpeg\bin\ffprobe.exe' -version
```

判定标准：两个命令均退出成功并显示版本。若只配置了目录、路径拼写错误或只存在 ffmpeg 而没有 ffprobe，应先修正，不要继续 MP3 验收。

## 3. 真实 TTS 凭据配置

### 3.1 阿里云 TTS

在阿里云百炼控制台创建或选择可调用 Qwen-TTS 的 API Key，确认账号已开通目标模型、具有调用额度，然后在 `backend/.env` 中填写：

```dotenv
# 通义千问 LLM；不要把这一组当作 TTS 配置入口
DASHSCOPE_API_KEY=
DASHSCOPE_MODEL_ID=qwen-plus

# 阿里云 TTS 独立配置
ALIYUN_TTS_API_KEY=sk-xxxxxxxx
ALIYUN_TTS_MODEL_ID=qwen-audio-3.0-tts-plus
```

检查项：

- `ALIYUN_TTS_API_KEY` 非空且 Key 有效。
- `ALIYUN_TTS_MODEL_ID` 保持 `qwen-audio-3.0-tts-plus`，除非已确认账号使用其他兼容模型。
- 模型 ID 不得显式配置为空；空值会阻止后端启动。
- 不要删除或覆盖 LLM 的 `DASHSCOPE_*` 配置。

### 3.2 火山 TTS

当前实现读取：

```dotenv
VOLC_TTS_APP_ID=xxxxxxxx
VOLC_TTS_ACCESS_TOKEN=xxxxxxxx
```

需要人工确认 `VOLC_TTS_ACCESS_TOKEN` 是可用于 `openspeech.bytedance.com/api/v1/tts` 的最终 access token，而不是 Access Key ID 或 Secret Key。

如果控制台只提供以下任一种不同凭证组合，先停止真实火山 smoke，并反馈给开发者调整 Provider：

- Access Key ID + Secret Access Key；
- API Key + Secret Key + APP ID；
- 需要先通过签名接口换取短期 token 的凭证。

不要把 Secret Key 误填到 `VOLC_TTS_ACCESS_TOKEN`。当前代码不会自动使用 Secret Key 执行 HMAC 换 token。

### 3.3 重启生效

配置修改后重启后端。`Settings` 在进程内缓存，热修改 `.env` 不会自动刷新：

```powershell
cd C:\projects\studio\audio-studio
.\scripts\stop-all.bat
.\scripts\start-all.bat
```

也可以分别启动前后端，具体见 `scripts/README.md`。

## 4. 无计费的 FAKE_MODE 人工验收

真实调用前先验证本地链路，以便把界面/文件问题与供应商问题分开。

### 4.1 配置

```dotenv
FAKE_MODE=true
```

重启后端，打开 `http://localhost:5173/tts`。

### 4.2 验收步骤

1. 切换「产物库脚本」与「粘贴文本」，确认两种来源互斥。
2. 粘贴以下短文本：

   ```text
   现在，请慢慢放松。[停顿 2s][情绪:温柔][语速:慢速]感受身体逐渐安静下来。[吸气]保持。[呼气]放松。[停顿 12s]回到此刻。
   ```

3. 切换冥想/播客场景，确认语速默认值与推荐音色联动。
4. 切换阿里云/火山引擎，确认音色列表联动；当前阿里云默认模型与火山音调滑块均应置灰。
5. 分别选择 WAV、MP3 提交：
   - 进度应依次出现逐段合成、拼接、编码；
   - 完成后显示波形、时长和播放器；
   - 产物自动写入产物库，类型为 `voice`；
   - MP3 失败且提示 ffmpeg 不可用时，返回第 2 节处理。
6. 在运行中点击取消，确认任务进入取消态，结果区不出现半成品。
7. 完成后点击「送去混音」，确认地址形如 `/mixdown?voice_id=art_...`。

### 4.3 本地文件核对

缺省数据目录下应出现：

```text
backend/data/audio/artifacts/{artifact_id}.wav|.mp3
backend/data/audio/peaks/{artifact_id}.json
backend/data/audio/previews/{engine}_{voice}.wav
```

如果配置了 `DATA_DIR`，以上路径以实际 `DATA_DIR/audio/` 为准。失败或取消后不应残留最终 artifact 文件或 `.part` 文件。

## 5. 真实 Provider smoke

### 5.1 费用与安全说明

- smoke 会向供应商提交一句短文本，可能产生少量费用。
- 脚本不会打印 Key、token 或完整响应体，也不会保留生成音频。
- 必须显式添加 `--yes` 才会发起调用。
- 建议先分别测试，定位问题后再跑双引擎。

### 5.2 分引擎执行

```powershell
cd C:\projects\studio\audio-studio\backend

# 先测试阿里云
uv run python scripts/smoke_tts.py --engine aliyun --yes

# 火山当前延期；只有取得官方鉴权说明并恢复任务后才执行
uv run python scripts/smoke_tts.py --engine volc --yes

# 火山恢复并单独通过后，才执行最终双引擎复核
uv run python scripts/smoke_tts.py --engine both --yes
```

成功示例的关键字段：

```text
OK   aliyun: model=qwen-audio-3.0-tts-plus voice=... 48000Hz/1ch ...s
OK   volc: model=BV700_streaming voice=... 48000Hz/1ch ...s
```

当前阶段以阿里云输出 `OK` 且命令退出码为 0 作为阿里云里程碑完成条件。火山已明确延期，未来恢复后再以两者均输出 `OK` 作为双引擎完成条件。

## 6. 真实页面试听与合成验收

将 `FAKE_MODE=false`，重启后端并进入 `/tts`。

### 6.1 试听缓存

选择一个尚未试听过的「引擎 + 音色」组合：

1. 第一次点「试听」：等待真实合成并正常播放。
2. 记录后端日志中该组合的 Provider 请求次数。
3. 再次点击同一组合：应快速返回，且后端不再调用 Provider。
4. 确认缓存文件为 `previews/{engine}_{voice}.wav`。

如需重新验证首次调用，可在停止后端后备份并删除该组合对应的单个 preview 文件；不要删除整个 `DATA_DIR`。

### 6.2 标记与音质试听

建议先用 WAV 和 30–60 秒短文本，分别生成阿里云、火山结果：

| 检查项 | 阿里云预期 | 火山预期 |
| --- | --- | --- |
| 普通文本 | 无标记被朗读 | 无标记被朗读 |
| `[停顿 2s]` | 默认 Qwen 模型走本地静音，时长接近 2 秒 | 本地静音拼接，时长接近 2 秒 |
| `[停顿 12s]` | 超长停顿切本地静音 | 本地静音拼接 |
| `[吸气]` / `[呼气]` | 独立静音约 4 秒 / 5 秒 | 独立静音约 4 秒 / 5 秒 |
| `[情绪:温柔]` | instruction 生效，主观听感更温柔 | 自动降级普通朗读 |
| `[语速:慢速]` | 后续语段明显变慢 | 后续语段明显变慢 |
| 拼接点 | 无爆音、截字或明显跳变 | 无爆音、截字或明显跳变 |

人工试听无法只靠波形替代。真实验证已确认默认 Qwen 模型不接受 SSML `<break>`（`ret=416`），现已通过 `capabilities.py` 关闭 SSML/pitch 并改用本地静音；若 instruction 或其他模型能力出现异常，记录引擎、模型、音色、短文本和脱敏错误信息，停止重复计费尝试。

### 6.3 格式复核

对最终文件执行：

```powershell
ffprobe -v error -show_entries stream=codec_name,sample_rate,channels,bits_per_sample,bit_rate -show_entries format=duration -of json '<artifact_file>'
```

期望：

- WAV：`sample_rate=48000`、单声道、16bit PCM。
- MP3：`sample_rate=48000`、单声道、目标码率约 320000。
- duration 与页面显示基本一致。

## 7. 常见失败与人工处置

| 现象或错误 | 可能原因 | 人工处置 |
| --- | --- | --- |
| `ALIYUN_TTS_MODEL_ID 不能为空`，后端无法启动 | TTS 模型 ID 配置为空 | 恢复默认 `qwen-audio-3.0-tts-plus` 后重启 |
| `TTS_PROVIDER_ERROR：当前 TTS 引擎未配置` | 独立 TTS Key/APP ID/token 缺失 | 按第 3 节配置；不要依赖 `DASHSCOPE_API_KEY` |
| 阿里云返回 401/403 | Key 无效、模型未开通或权限不足 | 在百炼控制台核对 Key、模型权限和额度 |
| 阿里云返回参数错误 | 模型、音色或能力声明不匹配 | 记录脱敏错误，停止重复调用，反馈开发者调整模型/音色/能力表 |
| 火山返回 401/鉴权失败 | token 无效，或实际凭证不是最终 access token | 按 3.2 确认凭证类型；需要 HMAC 换 token 时反馈开发者 |
| `Provider 返回的不是有效 WAV` | 上游实际返回 MP3/错误体或格式不兼容 | 保存脱敏状态码与 Content-Type，不要传播响应中的凭据；反馈开发者 |
| MP3 编码失败或提示 ffmpeg 不可用 | ffmpeg 路径错误/未安装 | 按第 2 节修正；先用 WAV 验证 TTS 主链路 |
| 首次试听成功、再次仍调用 Provider | 缓存目录不可写或缓存未落盘 | 检查 `DATA_DIR/audio/previews` 权限和文件是否存在 |
| 波形加载失败但音频可播放 | peaks 生成依赖或缓存问题 | WAV 先检查文件格式；MP3 先检查 ffmpeg；删除单个 peaks 缓存后重试 |
| 真实合成中取消后仍有一次计费 | Provider 请求已经发出，无法撤回 | 属预期边界；取消会阻止后续分段和产物入库 |

## 8. 验收结果回填

完成后把以下记录回填到任务或交付记录，禁止填写真实 Key/token：

```text
验收日期：
操作人：
ffmpeg 版本：
ffprobe 版本：
阿里云模型 ID：qwen-audio-3.0-tts-plus
阿里云 smoke：通过 / 失败（脱敏原因）
火山凭证形态：最终 access token / 其他（说明）
火山 smoke：通过 / 失败（脱敏原因）
阿里云试听与标记：通过 / 失败
火山试听与降级：通过 / 失败
WAV 48kHz/16bit：通过 / 失败
MP3 320k：通过 / 失败
试听缓存：通过 / 失败
取消无半成品：通过 / 失败
遗留问题：
```

人工播放本次 WAV/MP3 并确认音质、instruction 听感与拼接点后，可将 T004 的阿里云单引擎里程碑标记为完成。火山保持独立延期项，取得官方鉴权说明后再恢复双引擎验收。
