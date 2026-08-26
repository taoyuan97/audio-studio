# T005：BGM 线（MiniMax 同步接口 + 后处理 + BGM 页）

## 1. 任务信息

- 状态：待开始
- 优先级：P1
- 类型：正式任务 5/8
- 前置任务：T002
- 后续任务：T006（bgm 产物作为混音输入）
- 目标目录：`backend/app/music/`、`backend/app/music.py`、`frontend/src/features/bgm/`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.3）、`docs/tech/tech-design.md`（5.7）、`docs/tech/api-contract.md`（第 8 节）、`docs/tech/data-model.md`（5.3）
- 移植来源：`C:\projects\apps\meditation-guide-studio\backend\app\services\{music_minimax,music_postprocessor}.py`

## 2. 目标

实现 BGM 生成完整链路：MiniMax Music 同步接口封装（E1）、错误分类、失败两档重试（E8 计费安全）、下载后处理（循环/截断/fade）、风格预设、BGM 页。完成后用户可生成纯音乐背景轨。

## 3. 行为基线（继承原型 bgm 页语义 + 决策 B4/E1/E8）

- 交互同原型：风格卡片选择 + 自由描述（跨风格融合）、时长滑块（1–10 分钟气泡）、段落结构标签多选、格式气泡（MP3/WAV）、生成进度、结果播放 + 波形、入库/送混音。
- MiniMax 为同步接口：单次调用（`music_generation`，`music-3.0`，`output_format: url`）长超时 10min；等待期 SSE 心跳（waited_s）。
- 失败不自动重试；重试两档：`download`（URL 有效期内免计费）/ `regenerate`（二次确认）。
- 取消 = 中断等待/下载放弃结果（计费可能已发生，文案说明）。
- 后处理：循环填充/截断至目标时长 + 首尾 fade in/out + 时长复验；48kHz/MP3 320k。

## 4. 范围

### 4.1 必须实现

**后端**

- `app/music/minimax.py`（移植 music_minimax.py 并适配）：
  - `generate_music(prompt, ...) -> {audio_url, request_id, duration}`：httpx 同步 POST，超时 `MINIMAX_TIMEOUT_SECONDS`（600s）。
  - 错误分类（移植）：Key 无效/限流/余额权限/内容审核/超时/参数错误/服务不可用 → `MusicServiceError(kind)` → 差异化错误码映射。
- `app/music/postprocess.py`（移植 music_postprocessor.py）：ffprobe 探测 → 短则 FFmpeg 循环拼接、长则裁剪 → fade in/out → 导出（MP3 320k / WAV 48k）→ 复验时长 → 原子落盘。
- `app/music.py`：defaults / jobs / retry 端点（api-contract.md 第 8 节，含 retry 的 `MUSIC_URL_EXPIRED` / `MUSIC_REGENERATE_UNCONFIRMED` / `RUN_NOT_RETRYABLE` 分支）。
- run handler：生成（成功即把 `audio_url/expires_at/request_id` 落 runs.result_json）→ httpx 流式下载 → 后处理 → 建 bgm 产物 → `run.completed`；失败保 result_json 供重试。
- `music.progress`：generating（5s 心跳 waited_s）→ downloading → processing。
- FAKE_MODE：本地和弦占位音（`wave` 模块，按风格变调），后处理走真实 FFmpeg。

**前端**

- `/bgm` 页：
  - 风格卡片（defaults 下发，单选高亮）+ 自由描述输入（跨风格融合提示）。
  - 时长气泡（滑块 60–600s，展示分钟）、段落结构标签多选、格式气泡。
  - 提交 → 运行态：等待心跳（已等待 Ns → mm:ss）+ phase 文案（生成中/下载中/处理中）→ 取消。
  - 失败卡片：分类文案 + **两档重试**——URL 可用时显示「重新下载」（默认）与「重新生成」（Popconfirm 二次确认）；URL 不可用仅「重新生成」。
  - 结果区：AudioPlayer + WaveformView（结构标签能量差异可视）+ 参数摘要；「送去混音」（`/mixdown?bgm_id=`）。
  - 历史失败 run 的重试入口（重新进入页面时，可从产物库空态或提交记录进入——一期简化为失败当场重试 + run 状态接口可查）。

### 4.2 不实现

- Aliyun 备选音乐引擎（music_aliyun 不移植）；音乐源文件库管理（music_files 不移植）；后台自动重试。

## 5. 状态与数据流设计

```text
Query: ['music-defaults']
Mutation: submitJob / cancel / retryJob({mode, confirm_regenerate})
事件: music.progress→心跳与 phase；run.completed→invalidate artifact → 渲染结果
runs.result_json: {audio_url, expires_at} —— 失败重试的数据基础（E8）
```

## 6. 测试

- 自动化（pytest）：minimax 错误分类矩阵（mock httpx 各状态码/响应体 → 错误码映射）、retry 三分支（download 命中缓存 URL / URL 过期 422 / regenerate 未确认 422）、后处理（短源循环、长源截断、fade 参数、时长复验、原子落盘）、事件序列（心跳→downloading→processing→completed）、取消路径。
- 自动化（Vitest）：两档重试交互（URL 可用性 → 按钮显隐与确认流程）、心跳进度展示。
- 手工（真实 Key）：smoke_music.py 真实生成 + 下载 + 后处理全链路一次。

## 7. 验收标准

- [ ] 风格卡片/自由描述/时长/结构/格式参数齐全并全部进入 params 快照。
- [ ] FAKE_MODE 全流程：提交→心跳进度→结果播放/波形→入库；后处理真实执行（时长=目标值，fade 可听/可测）。
- [ ] 失败重试两档：mock URL 有效 → 重新下载不调生成接口；URL 过期 → 引导 regenerate；regenerate 需二次确认。
- [ ] 取消中断等待，无残留文件；文案说明计费可能已发生。
- [ ] smoke_music.py 真实调用通过；契约测试通过。
