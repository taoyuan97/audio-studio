# T012：混音分轨倍速与单轨参数一致性

## 1. 任务信息

- 状态：已完成，自动化与人工验收均通过
- 优先级：P1
- 类型：混音线增量任务
- 前置任务：T006（混音线）、T007（产物库展示）
- 后续任务：无
- 目标目录：`backend/app/mixdown.py`、`backend/tests/test_mixdown.py`、`frontend/src/pages/MixdownPage.tsx`、`frontend/src/features/mixdown/`、`frontend/src/features/library/`、`frontend/src/api/`、`frontend/src/styles/`
- 创建日期：2026-09-05
- 关联文档：`docs/tech/tech-design.md`（5.8）、`docs/tech/api-contract.md`（第 9 节）、`docs/tech/data-model.md`（5.4）

## 2. 背景与目标

当前混音页只能调整音量、背景偏移和人声闪避，不能在人声与背景进入混音前分别调整速度。人声语速偏快或偏慢、背景节奏与人声不匹配时，只能先导出成品再整体变速；这会同时改变两条轨道，无法修正单条轨道的问题。

本任务为人声轨和背景轨分别增加非破坏性的速度倍率。倍率只写入混音任务快照和成品参数，不修改源 voice/bgm 产物；FFmpeg 在混合前分别完成变速，再执行背景循环或截断、偏移、音量、闪避和编码。

同时修正 T006 遗留的单轨参数不一致：页面在仅人声或仅背景时允许调整对应音量，但后端单轨导出当前忽略增益。本任务统一三种轨道组合的参数语义，使存在的轨道对应的倍速和音量始终生效。

## 3. 已确认设计决策

- 新增 `voice_speed` 与 `bgm_speed`，范围均为 `0.5～2.0`，步长 `0.05`，默认 `1.0`。
- 使用 FFmpeg `atempo` 改变速度并保持原音调，不采用会同步升降调的采样率变换。
- 倍速对双轨和单轨导出都生效；未选择的轨道在请求快照中规范化为默认倍速 `1.0`。
- 双轨成品以变速后的人声时长为时间轴终点：`target_duration = voice_duration / voice_speed`。
- 背景先变速，再按变速后的有效时长与 `target_duration` 比较并循环或截断；之后应用背景偏移。偏移不延长成品结尾。
- 仅背景导出的成品时长为 `bgm_duration / bgm_speed`；仅人声导出的成品时长为 `voice_duration / voice_speed`。
- 倍速和增益为混音参数，不回写、不覆盖源产物，也不生成中间 voice/bgm 产物。
- 本期不增加提交前的单轨试听或浏览器实时双轨混音；页面只实时展示调整后预计时长、组合规则和波形时间轴，成品在任务完成后试听。
- 单轨音量在本任务中一并修正：仅人声应用 `voice_gain`，仅背景应用 `bgm_gain`。
- 旧客户端未传倍速字段时按 `1.0` 处理；历史 mix 产物没有倍速字段时按 `1.0` 展示，保持向后兼容。

## 4. 行为与处理规则

### 4.1 双轨处理

```text
[voice] atempo=voice_speed → volume=voice_gain → aresample → 时间戳归零
[bgm]   atempo=bgm_speed
        → 按变速后时长循环或截断到变速后人声长度
        → 时间戳归零 → adelay=bgm_offset → 截断到成品长度
        → volume=bgm_gain → aresample
ducking=on: 变速后人声作为 sidechain，压低变速后背景
→ amix → 截断到变速后人声长度 → 编码
```

- 人声有效时长：`voice_effective_duration = voice_source_duration / voice_speed`。
- 背景有效时长：`bgm_effective_duration = bgm_source_duration / bgm_speed`。
- 循环/截断判断必须比较两个有效时长，不能继续比较源文件时长。
- 人声闪避在两轨变速后执行，使 sidechain 检测与最终时间轴一致。
- `bgm_offset` 的含义仍为背景从成品时间轴第几秒开始；输出长度不因偏移增加。

### 4.2 单轨处理

- 仅人声：`atempo=voice_speed → volume=voice_gain → aresample → 编码`。
- 仅背景：`atempo=bgm_speed → volume=bgm_gain → aresample → 编码`。
- 仅背景且 `bgm_speed=1.0`、`bgm_gain=100`、源格式与输出格式相同时，允许 stream copy；其他情况必须重编码。
- 单轨任务将 `bgm_offset` 规范化为 `0`、`ducking` 规范化为 `false`；缺失轨道的增益和倍速保存默认值，确保任务判重与历史参数稳定。

### 4.3 前端交互

- 在对应音量控件附近增加“人声倍速”“背景倍速”滑块，显示两位有效精度的 `x` 倍率。
- 未选择对应轨道时禁用其倍速和音量控件；选择轨道后默认 `1.0x`。
- 组合规则提示按有效时长实时更新，明确背景将循环、截断或与人声等长。
- 双轨波形按有效时长和背景偏移计算时间轴，并显示两轨调整后的预计时长；不改变 peaks 数据本身。
- 成品卡片的混音参数摘要展示两轨倍速、两轨音量、背景偏移和闪避状态。
- 产物库参数明细增加 `voice_speed=人声倍速`、`bgm_speed=背景倍速`；历史产物缺少字段时不显示未知值。

## 5. API、快照与兼容性

`POST /api/mixdown/jobs` 新增可选字段：

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

- 后端校验两个倍速均为有限数值且处于闭区间 `[0.5, 2.0]`，非法值返回 422 `MIX_INPUT_INVALID`。
- Pydantic 默认值和 TypeScript 可选字段均为兼容旧客户端服务；页面提交完整显式参数。
- run 请求快照、活动任务判重、mix 产物 `params_json` 均包含规范化后的两个倍速。
- 输出时长复验使用有效时长：双轨/仅人声验证 `voice_duration / voice_speed`，仅背景验证 `bgm_duration / bgm_speed`，延续允许 1 秒误差的现有规则。
- 既有数据库不新增列或迁移；倍速随现有 JSON 快照和 `params_json` 保存。

## 6. 实施范围

### 6.1 后端

- 扩展 `MixdownJobRequest`、请求校验与 `_snapshot` 规范化。
- 扩展 `build_filter_graph` 和 `build_ffmpeg_args`，保证 `atempo` 位于混音、sidechain 及背景长度处理之前。
- 依据有效时长选择背景循环/截断分支并计算双轨目标长度。
- 为单轨构建倍速、音量和重采样滤镜；收紧仅背景 stream-copy 条件。
- 修正 handler 的 `expected_duration`，保存完整成品参数。
- 保持既有取消、超时、错误脱敏、`.part` 清理与 ffprobe 格式复验不变。

### 6.2 前端

- 扩展 `SubmitMixdownJobRequest` 类型和页面 payload。
- 新增两个倍率状态及滑块，按轨道选择状态启停。
- 抽取或复用有效时长计算，供规则提示和双轨波形保持同一口径。
- 扩展结果参数摘要和产物库参数标签。
- 调整混音页样式，保证窄屏下控件与数值标签不溢出。

### 6.3 技术文档

- 更新 `docs/tech/tech-design.md` 的混音滤镜链、时长锚点、单轨语义和前端预览边界。
- 更新 `docs/tech/api-contract.md` 的请求字段、默认值、范围与规范化规则。
- 更新 `docs/tech/data-model.md` 的 mix `params_json` 快照定义。

## 7. 测试方案

### 7.1 后端自动化

- 请求默认值、上下边界 `0.5/2.0` 和越界/非有限数值校验。
- 双轨滤镜链包含两个独立 `atempo`，且位于背景循环/截断和 sidechain 之前。
- 使用有效时长决定背景循环、截断和等长分支；覆盖源时长结论与变速后结论相反的案例。
- 仅人声/仅背景均应用对应倍速和音量；仅背景 stream-copy 优化只在参数无处理需求时命中。
- 真实 FFmpeg 覆盖人声加速、背景减速及两种单轨，断言输出时长与有效时长一致。
- 产物 `params` 保存规范化倍速；任务取消、失败清理和错误脱敏回归通过。

### 7.2 前端自动化

- 两个倍速控件默认 `1.0x`，按轨道选择状态分别启用/禁用。
- 修改倍速后提交完整 payload。
- 规则提示按有效时长切换循环/截断/等长分支。
- 波形组件使用有效时长和偏移计算时间轴并展示预计时长。
- 成品摘要展示倍速；历史产物缺失倍速字段时回退为 `1.0x`。
- 既有双空禁用、预选、清空、运行态和失败重试测试继续通过。

### 7.3 验证命令

- 后端：`pytest backend/tests/test_mixdown.py`
- 前端定向：`pnpm --dir frontend test -- MixdownPage rules DualTrackWaveform`
- 前端完整：`pnpm --dir frontend test`、`pnpm --dir frontend build`
- 如本机 FFmpeg/ffprobe 可用，执行真实音频时长测试；否则明确记录跳过原因。

## 8. 不实现

- 成品整体倍速或成品二次编辑。
- 改变音高、音调独立控制或变声效果。
- 浏览器端实时双轨混音、实时闪避或提交前同步试听。
- 将变速结果另存为新的 voice/bgm 源产物。
- 动态拉伸背景以精确对齐音乐小节、节拍检测或 beat matching。
- 超出 `0.5～2.0` 的多段 `atempo` 链。

## 9. 验收标准

- [x] 人声和背景可在 `0.5x～2.0x` 内分别调整，默认均为 `1.0x`，互不覆盖。
- [x] 三种轨道组合中，对应轨道的倍速和音量均实际生效。
- [x] 双轨输出长度等于变速后人声长度，背景按变速后长度正确循环或截断，偏移不延长结尾。
- [x] 变速使用 `atempo` 保持原音调，闪避在变速后的同一时间轴上工作。
- [x] 页面规则、预计时长、波形时间轴、成品摘要与后端处理结果口径一致。
- [x] API 默认值兼容旧客户端，历史 mix 产物缺少倍速字段时正常展示。
- [x] mix 产物和 run 快照保存完整倍速参数，相同请求判重包含倍速。
- [x] 后端定向/完整测试、前端定向/完整测试、lint 及生产构建通过；真实 FFmpeg 用例在当前环境按既有条件跳过。

## 10. 验收记录

- 2026-09-05：自动化验收通过。后端 191 passed、5 skipped；前端 69 passed；ESLint、生产构建与 `git diff --check` 通过。跳过项为当前测试环境未探测到 FFmpeg/ffprobe 时按既有条件跳过的真实音频用例。
- 2026-09-05：用户完成人工验收并确认通过；人声/背景分轨倍速、单轨参数、组合规则、预计时长、波形时间轴及成品结果符合预期。
