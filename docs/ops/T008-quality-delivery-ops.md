# T008 质量与交付验收记录

验收日期：2026-09-05（Asia/Shanghai）

## 结论

T008 一期交付项通过。千问 LLM 与火山 TTS 的真实服务复核按决策延期，不阻塞本次交付；性能项复用 2026-08-30 的历史真实记录。

## 自动化回归

- 后端：`python -m pytest`，187 passed；真实 FFmpeg 用例已执行。存在 1 条来自 Starlette `TestClient`/httpx 兼容层的弃用提示。
- 前端：`pnpm test`，17 个测试文件、62 个用例全部通过。jsdom 输出 3 条“不支持伪元素 getComputedStyle”环境提示，不是断言失败。
- 静态检查：`pnpm lint` 通过。
- 生产构建：`pnpm build` 通过，无 Vite chunk size warning；最大共享 chunk 687.76 kB（gzip 224.46 kB）。
- Playwright：`pnpm e2e`，7/7 场景通过，耗时 30.8 秒；覆盖主路径 A/B、TTS 独立入口、排队与取消、刷新恢复、失败与两档重试、产物库操作，混音使用真实 FFmpeg。

## 真实服务 smoke

真实输出保存在本机 `backend/data/smoke/20260905-t008/`。该目录受 `.gitignore` 管理，仓库仅提交本记录，不提交生成媒体或密钥。

| 探针 | 服务/模型 | 结果 | 耗时 | 本地输出 |
| --- | --- | --- | ---: | --- |
| `smoke_llm.py` | DeepSeek `deepseek-v4-flash` | 通过；271 字，停顿/情绪/语速/呼吸标记断言通过 | 2.28 s | `llm-deepseek.txt`（664 B） |
| `smoke_tts.py` | 阿里云 `qwen-audio-3.0-tts-plus` / `longanlingxin` | 通过；WAV 48 kHz、单声道、2.96 s | 1.21 s | `tts-aliyun.wav`（284,204 B） |
| `smoke_music.py` | MiniMax `music-3.0` | 通过；生成、下载、真实后处理完成，成品 60.00 s / 48 kHz | 119.29 s | `music-minimax.mp3`（2,403,059 B） |

延期项：

- 千问 LLM 真实流式复核：延期；本次环境未配置 DashScope Key。
- 火山 TTS 真实合成复核：延期；本次环境未配置火山凭据。

## 部署验证

验证脚本：`backend/scripts/verify_deployment.py`。

| 入口 | 健康检查 | SPA 深链 | SSE 到达时间 | Range |
| --- | --- | --- | --- | --- |
| 单进程 `http://127.0.0.1:8000` | 通过 | 通过 | 150.6 / 345.7 / 581.8 / 848.1 ms | `206 bytes=0-99` |
| Vite proxy `http://127.0.0.1:5173` | 通过 | 通过 | 686.6 / 807.3 / 1047.7 / 1299.1 ms | `206 bytes=0-99` |

完整机器可读记录：

- `backend/data/smoke/20260905-t008/deploy-single-process-8000.json`
- `backend/data/smoke/20260905-t008/deploy-vite-proxy.json`

两种入口均观察到分段 SSE 事件而非一次性缓冲，并完成音频首 100 字节的 Range 请求。

## 性能软目标

按决策复用 `backend/data/audio.sqlite3` 中 2026-08-30 的真实 TTS 记录：15 分钟目标档、脚本 2,840 字、生成音频 912.784 秒，提交到完成 181.138 秒（run 181.117 秒）。

PRD 软目标为不超过 180 秒，本记录超出 1.138 秒。该项按约定不阻塞交付，列为已知问题；后续可从请求分段、供应商耗时及编码阶段分别采样定位。

## 环境与恢复

- 验收 FFmpeg：`C:\Users\18520\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe`
- E2E 使用隔离端口：后端 8010、前端 5174，不复用常驻服务。
- 部署验证期间临时使用 8000/5173；结束后已停止临时进程，并恢复原有 8000 开发后端且健康检查通过。
