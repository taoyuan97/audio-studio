# scripts — 启动/停止脚本

Windows 下双击即可运行，无需命令行操作。

## 脚本清单

| 脚本 | 作用 |
| --- | --- |
| `start-all.bat` | 前后端同时启动（两个独立窗口），前端就绪后自动打开默认浏览器 |
| `start-backend.bat` | 仅启动后端（FastAPI/uvicorn，`http://localhost:8000`，API 文档 `/docs`） |
| `start-frontend.bat` | 仅启动前端（Vite dev，`http://localhost:5173/`），就绪后自动打开浏览器 |
| `stop-all.bat` | 停止全部服务并关闭窗口（见下方停止机制） |

## 首次使用前

1. 后端依赖：`cd backend && uv sync`（生成 `.venv`）
2. 前端依赖：`cd frontend && pnpm install`
3. 可选配置：复制 `backend/.env.example` 为 `backend/.env`，填入 LLM API Key（DeepSeek/Kimi/千问）；
   不配置则以默认配置运行（模型下拉为空），可设 `FAKE_MODE=true` 体验无 Key 生成流程。

启动脚本会自动检测以上前置条件，缺失时给出安装提示。

## 停止机制（双保险）

1. **窗口标题匹配**：启动脚本窗口标题固定为 `audio-studio-backend` / `audio-studio-frontend`，`stop-all.bat` 按标题终止整棵进程树——覆盖经典控制台窗口。
2. **端口 + 进程名兜底**：`netstat` 查 8000/5173 监听 PID，**校验进程名为 python.exe / node.exe 后**才终止——覆盖 Windows Terminal 标签页等标题匹配失效的场景，且不会误杀恰好占用同端口的其他程序。

进程树终止后宿主 cmd 窗口自动关闭，无残留窗口。

## 备注

- **脚本内提示信息为英文（纯 ASCII），是有意为之**：cmd 解析批处理时按字节定位行，含中文的批处理在「文件编码 ≠ 控制台代码页」的环境下（如 UTF-8 系统区域、Windows Terminal）会发生行错位、脚本执行紊乱。纯 ASCII 在任何代码页下都绝对稳定，中文说明统一放本文件。若需修改脚本，请保持纯 ASCII。
- 后端以单进程启动（不带 `--reload`），保证停止行为可预期；开发热重载可在终端手动执行：
  `cd backend && .venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload --port 8000`
- 单个服务也可在其窗口内按 `Ctrl+C` 停止。
- 若手动修改了服务窗口标题，标题匹配会失效，此时依赖端口兜底仍可正常停止。
