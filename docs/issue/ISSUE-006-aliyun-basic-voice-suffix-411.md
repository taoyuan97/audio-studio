# ISSUE-006：阿里云基础音色误填后缀导致试听验证 411

## 1. 缺陷信息

- 状态：已修复并验收通过
- 优先级：P1（阻断新增基础音色的试听与正式合成，但不影响内置系统音色）
- 发现日期：2026-09-05
- 影响范围：`backend/app/tts/providers.py`、`frontend/src/features/tts/CustomVoiceSettings.tsx`、TTS 自定义音色验证提示
- 关联任务：T011（阿里云自定义 TTS 音色库）
- 官方参考：[Qwen-Audio-TTS 音色列表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)

## 2. 用户现象

在设置页为模型 `qwen-audio-3.0-tts-plus` 登记音色 ID `longlinshuoxi` 后，保存成功，但点击试听返回 HTTP 502，控制台请求为：

```text
POST /api/tts/custom-voices/{id}/verify 502 Bad Gateway
```

页面无法播放试听音频，音色状态变为“验证失败”。

## 3. 定位证据

### 3.1 本地记录的模型绑定正确

SQLite 中失败记录绑定：

```text
model=qwen-audio-3.0-tts-plus
voice_id=longlinshuoxi
verification_status=failed
```

最近一次上游错误为：

```text
[cosyvoice:]Engine error [411]: TTS speak operation failed
```

因此 502 是后端对阿里云验证失败的业务包装，不是 Vite 代理、试听播放器或本地网络错误。

### 3.2 官方 voice 参数要求完整模型前缀

阿里云官方文档说明：每个模型只支持特定音色，模型与音色混用会返回 `InvalidParameter`，并以 `[cosyvoice:]Engine error [411]: TTS speak operation failed` 作为示例。

同一文档说明基础音色命名格式为：

```text
qwen-audio-3.0-tts-{plus|flash}-{音色后缀}
```

官方 `qwen-audio-3.0-tts-plus` 基础音色 Excel 中，`longlinshuoxi` 对应的完整 voice 参数是：

```text
qwen-audio-3.0-tts-plus-longlinshuoxi
```

## 4. 根因

用户从基础音色试听文件名取得 `longlinshuoxi`，将音色后缀误当作完整 `voice` 参数保存。当前表单只检查字符格式，不解释基础音色后缀与完整 voice 的区别，也不会在保存前提示可补全值。

后端已经保留阿里云 SSE 中的 411 信息，但仍以供应商原始措辞返回。前端虽然展示该消息，却没有说明应检查完整 voice 参数，导致用户容易误判为模型配置或网关故障。

## 5. 修复方案（已确认）

1. 当模型为 `qwen-audio-3.0-tts-plus` 或 `qwen-audio-3.0-tts-flash`，且输入的自定义音色 ID 未带当前模型前缀时，保存前弹出确认提示。
2. 提示给出补全后的候选值，并提供“补全并保存”（推荐）与“按原 ID 保存”两个明确选择。
3. 不强制或静默补全；保留原 ID 保存能力，兼容命名规则不同的声音复刻音色。
4. 阿里云返回 cosyvoice 411 时，将错误转换为包含实际 `model`、`voice` 和基础音色完整格式建议的可操作提示。
5. 保持音色 ID 创建后不可修改。已有错误记录通过删除后重新新增修正，不在原记录上静默改变身份。
6. 设置页继续展示绑定模型、实际音色 ID 和验证失败原因；不把 HTTP 502 本身误报为根因。

## 6. 测试方案

- 纯函数：plus/flash 的裸后缀生成正确完整候选值。
- 纯函数：已经带模型前缀时不提示。
- 纯函数：其他模型不做猜测性补全。
- 设置页：裸后缀保存前出现确认，选择补全后提交完整 voice。
- 设置页：选择按原 ID 保存时保持用户输入。
- Provider：cosyvoice 411 返回包含模型、实际 voice 和完整参数建议的安全错误。
- Provider：其他阿里云错误仍保留既有脱敏行为。
- 回归：后端全量测试、前端测试、构建与 lint 通过。

## 7. 验收标准

- [x] `longlinshuoxi` 在 plus 模型下保存前得到 `qwen-audio-3.0-tts-plus-longlinshuoxi` 候选提示。
- [x] 用户可选择补全或保留原 ID，不误伤特殊复刻音色。
- [x] cosyvoice 411 不再只显示笼统的合成失败，而是指出 model/voice 不兼容及完整格式。
- [x] 已有 ID 不可修改和删除后重建语义保持不变。
- [x] 自动化测试、生产构建与代码规范检查通过。

## 8. 人工验收操作

删除 `longlinshuoxi` 本地记录，并使用以下完整音色 ID 重新新增：

```text
qwen-audio-3.0-tts-plus-longlinshuoxi
```

## 9. 实施记录

- 新增 `suggestAliyunBasicVoiceId()`，仅对 plus/flash 两个已知基础音色模型生成候选值；完整 voice 和其他模型不做猜测。
- 新增保存前确认弹窗，提供“补全并保存”“按原 ID 保存”和“返回修改”三条路径。
- 新增音色 ID 字段说明，明确应填写 API 使用的完整 voice，而不是试听文件后缀。
- Provider 解析 cosyvoice 411 时返回实际 model、voice 和完整参数示例；其他供应商错误继续使用既有脱敏路径。
- 后端 TTS 专项测试：20 passed、1 skipped。
- 后端全量测试：188 passed、5 skipped。
- 前端全量测试：68 passed；生产构建和 ESLint 通过。
- 未自动修改或删除原有 `longlinshuoxi` 数据，避免违反音色 ID 不可修改及用户数据边界；用户按第 8 节重建记录后完成真实试听。

## 10. 验收结果

- 验收日期：2026-09-05
- 使用 `qwen-audio-3.0-tts-plus-longlinshuoxi` 完成真实阿里云试听验证。
- 音色与 `qwen-audio-3.0-tts-plus` 匹配，试听成功，缺陷关闭。
