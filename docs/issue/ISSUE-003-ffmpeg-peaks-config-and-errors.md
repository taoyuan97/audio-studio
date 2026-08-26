# ISSUE-003：peaks 未透传 FFMPEG_PATH 与 FFmpeg 错误脱敏未收口

## 1. 缺陷信息

- 状态：待修复
- 优先级：P1（在 T006/T007 开发前收口）
- 发现日期：2026-08-26
- 影响范围：`backend/app/peaks.py`、`backend/app/ffmpeg.py`、后续 `backend/app/mixdown.py`、`backend/app/settings.py`
- 关联任务：T002（底层基座）、T006（混音错误映射）、T007（设置状态与探测）

## 2. 当前现象

### 2.1 peaks 未使用配置的 FFMPEG_PATH

`Settings` 已提供 `ffmpeg_path`，`app/ffmpeg.py` 的查找函数也支持传入覆盖路径；但 `app/peaks.py` 在 MP3/非 16bit WAV 解码时直接调用无参数的 `find_ffmpeg()`，只会从系统 PATH 查找。

因此，当 ffmpeg 仅通过 `backend/.env` 的 `FFMPEG_PATH` 配置、未加入系统 PATH 时：

- 混音等未来模块可以通过配置找到 ffmpeg；
- peaks 端点仍可能错误返回 `MIX_FFMPEG_MISSING`；
- 同一进程对 FFmpeg 可用性的判断不一致。

### 2.2 底层 FFmpeg 错误尚未完成业务脱敏

`run_ffmpeg()` 当前使用 stderr 最后一行构造 `FFmpegError`。上游 stderr 可能包含输入/输出绝对路径或其他内部环境信息；如果后续业务层直接透传该异常文本，会违反 API 契约的错误脱敏要求。

当前 `MIX_FFMPEG_MISSING` / `MIX_FFMPEG_ERROR` 的完整映射尚未实现，属于 T006 的待交付能力；FFmpeg/ffprobe 状态与版本探测属于 T007。

## 3. 正确目标设计

- 所有 FFmpeg 使用点统一遵循：优先 `FFMPEG_PATH`，其次系统 PATH。
- ffmpeg 与 ffprobe 必须作为一组校验；配置只指向 ffmpeg 时，按同目录解析 ffprobe。
- API/SSE 只返回稳定、脱敏的业务错误码和用户文案。
- 完整命令、stderr 与绝对路径仅进入受控服务端日志，不写入 run.error_message。
- 缺少 FFmpeg 不应阻止剧本等无关模块启动；T006 提交前独立检查，T007 状态页负责展示与主动探测。

## 4. 建议修复思路

1. 让 peaks 从应用 Settings 或已解析的 FFmpeg 工具对象取得路径，将配置值传入解码函数，避免在模块内部再次无参探测。
2. 收敛 `ffmpeg.py` 的执行结果和异常类型：底层异常保留诊断信息，业务层映射固定的安全文案。
3. T006 在创建 run 前校验 ffmpeg/ffprobe；运行期失败映射为 `MIX_FFMPEG_ERROR`，取消时终止子进程并清理 `.part` 文件。
4. T007 的 status/probe 使用同一套路径解析逻辑，返回 ffmpeg 与 ffprobe 的独立可用性和版本摘要。

## 5. 验收标准

- [ ] ffmpeg 未加入 PATH、仅配置 `FFMPEG_PATH` 时，MP3 peaks 可正常计算。
- [ ] `FFMPEG_PATH` 无效、ffprobe 缺失、执行超时和非零退出均有稳定错误码。
- [ ] API/SSE 错误消息不包含绝对路径、完整命令、stderr 或密钥。
- [ ] T006 提交前检查与 T007 settings status/probe 对同一环境给出一致结论。
- [ ] WAV 原生 peaks、MP3 FFmpeg peaks、缓存命中与损坏重算测试全部通过。
