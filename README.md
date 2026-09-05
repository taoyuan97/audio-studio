# AI 音频工作台

本地优先的冥想音频生产工作台：脚本生成、TTS、BGM、双轨混音和产物管理由 React 前端与 FastAPI 后端组成。

## 环境要求

- Python 3.11–3.13、[uv](https://docs.astral.sh/uv/)
- Node.js、pnpm 11
- FFmpeg 与 ffprobe（必须来自同一发行包）

Windows 可用 `winget install Gyan.FFmpeg` 安装。安装后重新打开终端，运行：

```powershell
ffmpeg -version
ffprobe -version
```

如果命令不在 PATH 中，在 `backend/.env` 的 `FFMPEG_PATH` 填写 `ffmpeg.exe` 绝对路径；后端会在同目录查找 `ffprobe.exe`。

## 首次配置

```powershell
cd backend
uv sync
Copy-Item .env.example .env

cd ..\frontend
pnpm install
```

在 `backend/.env` 中按需填写：

- `DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`MOONSHOT_API_KEY`：脚本模型。
- `ALIYUN_TTS_API_KEY`：阿里云 Qwen-TTS。
- `VOLC_TTS_APP_ID`、`VOLC_TTS_ACCESS_TOKEN`：火山 TTS。
- `MINIMAX_API_KEY`：音乐生成。
- `DATA_DIR`、`FFMPEG_PATH`：本地数据与 FFmpeg。
- `FAKE_MODE=true`：LLM/TTS/BGM 使用本地假实现；混音和音乐后处理仍使用真实 FFmpeg。
- `SERVE_FRONTEND=true`：由 FastAPI 托管 `frontend/dist`。

不要提交 `backend/.env`，也不要把 Key/token 写入日志或验收文档。

## 开发启动

Windows 可双击 `scripts/start-all.bat`，或分别运行：

```powershell
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8000

cd frontend
pnpm dev
```

开发页面为 `http://localhost:5173`，Vite 将 `/api` 代理到 `127.0.0.1:8000`。

## 单进程生产启动

双击 `scripts/start-production.bat`，或手动执行：

```powershell
cd frontend
pnpm build

cd ..\backend
$env:SERVE_FRONTEND = 'true'
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

浏览器统一访问 `http://localhost:8000`；SPA 深链、API、SSE 和音频 Range 均走该端口。

## 测试与验收

```powershell
cd backend
.venv\Scripts\python.exe -m pytest --basetemp=.tmp/pytest

cd ..\frontend
pnpm test
pnpm build
pnpm e2e
```

`pnpm e2e` 会在 8010/5174 端口自动启动隔离的 `FAKE_MODE` 后端与 Vite，清理并使用 `backend/.tmp/e2e-data`；要求 FFmpeg/ffprobe 可用。

部署探针需在目标服务启动后运行：

```powershell
cd backend
.venv\Scripts\python.exe scripts\verify_deployment.py --base-url http://127.0.0.1:8000
.venv\Scripts\python.exe scripts\verify_deployment.py --base-url http://127.0.0.1:5173
```

真实服务 smoke 会产生费用，只有明确确认后才运行；生成物默认保存到 `backend/data/smoke/<时间>/`。

## 常见错误

- `MIX_FFMPEG_MISSING` / `MUSIC_FFMPEG_MISSING`：确认 `ffmpeg.exe` 和 `ffprobe.exe` 都存在，并修正 `FFMPEG_PATH` 后重启。
- `BACKEND_UNREACHABLE`：确认 8000 端口服务已启动；开发模式还需确认 Vite proxy 目标未修改。
- `RUN_QUEUE_FULL`：等待已有任务完成或取消后重试；后端单 worker 串行执行耗时任务。
- `SCRIPT_LLM_NOT_CONFIGURED` / Provider 鉴权错误：检查相应独立凭据，避免把千问 Key 与阿里云 TTS Key 混用。
- 深链刷新 404：先执行 `pnpm build`，并以 `SERVE_FRONTEND=true` 启动后端。
- 端口被占用：运行 `scripts/stop-all.bat`，或确认占用进程后更换/释放 8000、5173 端口。

更多 Windows 启停说明见 `scripts/README.md`。
