# T003 剧本线·冥想 — 人工操作手册

> 适用范围：T003（冥想剧本：会话 + LLM 流式 + 工作台）中需要人工协助或人工处理的部分。
> 自动化测试已覆盖的部分（markers 解析、契约端点、run 事件序列、ScriptView 渲染）不在本文范围。

## 1. LLM API Key 配置（真实模型模式）

冥想剧本生成默认接入三家模型（DeepSeek / Kimi / 通义千问），均为 OpenAI 兼容接口；API Key 与实际模型 ID 均通过 `backend/.env` 配置，无需额外 SDK。

### 1.1 Key 申请

| 模型 | 提供方 | 申请入口 | 环境变量 |
| --- | --- | --- | --- |
| DeepSeek Chat | DeepSeek | https://platform.deepseek.com → API Keys | `DEEPSEEK_API_KEY` |
| 通义千问 Plus | 阿里云百炼（DashScope） | https://bailian.console.aliyun.com → API-KEY 管理 | `DASHSCOPE_API_KEY` |
| Kimi K2 | Moonshot AI | https://platform.moonshot.cn → API Key 管理 | `MOONSHOT_API_KEY` |

注意事项：

- `DASHSCOPE_API_KEY` 仅供通义千问 LLM 使用；阿里云 TTS 使用独立的 `ALIYUN_TTS_API_KEY` / `ALIYUN_TTS_MODEL_ID`，两条链路禁止配置回退。
- 三家 Key 均可只配其中一或多家；**前端模型下拉只展示已配置 Key 的模型**，未配置的不出现在下拉中。
- 三家模型 ID 分别由 `DEEPSEEK_MODEL_ID`、`DASHSCOPE_MODEL_ID`、`MOONSHOT_MODEL_ID` 设置，必须非空且互不重复；模型下拉只显示实际模型 ID。
- 真实模式下零 Key 时模型下拉为空、发送禁用（提示配置 Key）；`FAKE_MODE=true` 时下拉展示全部三家（无需任何 Key）。

### 1.2 配置步骤

1. 复制 `backend/.env.example` 为 `backend/.env`（`data/`、`.env` 均已在 gitignore 中，Key 不会入库）。
2. 填入 Key：

   ```dotenv
   DEEPSEEK_API_KEY=sk-xxxxxxxx
   DASHSCOPE_API_KEY=sk-xxxxxxxx
   DEEPSEEK_MODEL_ID=deepseek-chat
   DASHSCOPE_MODEL_ID=qwen-plus
   MOONSHOT_MODEL_ID=kimi-k2-0905-preview
   FAKE_MODE=false
   ```

   模型 ID 可改为对应供应商账号实际可用的其他模型。空值或三项重复会阻止后端启动，错误信息会指出相关环境变量。

3. 重启后端（`Settings` 通过 `lru_cache` 缓存，改 `.env` 必须重启才生效）。
4. 验证配置是否生效（任选其一）：
   - 浏览器打开前端 → 进入任一冥想会话 → 模型下拉应展示已配置 Key 的模型；
   - 直接调用接口（`<conversation_id>` 任取一个已存在的会话）：

     ```powershell
     curl.exe http://localhost:8000/api/conversations/<conversation_id>/models
     # 期望（已配置 DeepSeek 与 Kimi 时）：{"models":[{"provider":"deepseek","model":"deepseek-chat","name":"DeepSeek Chat"},{"provider":"moonshot","model":"kimi-k2-0905-preview","name":"Kimi K2"}]}
     # 未出现在列表中的模型即未配置 Key，前端下拉亦不展示
     ```

### 1.3 常见错误码处置

| 错误码 | 含义 | 人工处置 |
| --- | --- | --- |
| `SCRIPT_LLM_NOT_CONFIGURED` (422) | 所选模型未配置 Key | 按 1.2 配置并重启；前端失败卡片也会给出同样提示 |
| `SCRIPT_LLM_ERROR` (502) | 上游返回 4xx/5xx | 确认 Key 有效、账户余额充足；后端日志有脱敏后的上游状态码 |
| `SCRIPT_TIMEOUT` (504) | 模型响应超时（默认 120s） | 长脚本（30 分钟档）可调大 `.env` 中 `LLM_TIMEOUT_SECONDS` 后重启 |

## 2. FAKE_MODE 手工验收流程

不配置任何 Key 也可完成 T003 全部验收：将 `backend/.env` 中 `FAKE_MODE=true`（或删除 `.env`，用命令行临时指定）。FAKE_MODE 下脚本生成走内置示例脚本的伪流式输出，事件序列与真实模式完全一致。

### 2.1 启动服务

```powershell
# 后端（终端 1）
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload --port 8000

# 前端（终端 2）
cd frontend
pnpm dev
```

浏览器打开 http://localhost:5173/meditation。

### 2.2 验收清单（对应 T003 第 7 节）

按顺序执行并逐项确认：

1. **会话列表**：`/meditation` 显示空态引导 → 点「新建会话」→ 自动跳入工作台。
2. **空主题禁用**：输入框为空时「发送」按钮禁用。
3. **流式生成**：输入主题（如「深海放松」）选时长/模型 → 发送 →
   - 结果区出现 3 步生成动画；
   - 左侧出现 AI 气泡且文字逐段增长（伪流式）；
   - 完成后脚本区出现标记徽章（情绪/语速）、停顿块、时间轴条与「预估口播」时长。
4. **时长档位**：分别选择 5/10/15/20/25/30 分钟，确认六档均可生成，脚本篇幅与预估时长随档位变化。
5. **多轮 refinement**：在已有脚本的会话中再发「再温柔一些」/「缩短到 5 分钟」→ 脚本内容相应变化（FAKE_MODE 下为另一份示例脚本）。
6. **编辑闭环**：点「编辑脚本」→ 修改文本（可增删 `[停顿 3s]`、`[情绪:温柔]` 等标记）→ 「保存并重新解析」→ 徽章与时间轴立即按新文本刷新；刷新页面后仍保持。
7. **取消**：生成中点「取消」→ 临时流式内容被丢弃，无残留气泡。
8. **参数锁定**：生成中时长/模型下拉与输入框禁用；再次发送会提示「该会话已有生成任务进行中」（409）。
9. **重进恢复**：生成中刷新页面 → 工作台恢复运行态（生成动画继续）；完成后脚本正常展示。
10. **重命名**：返回列表 → 重命名会话 → 标题更新。

### 2.3 判定标准

- 全部清单项通过、浏览器控制台无红色报错 → T003 手工验收通过。
- 数据落盘位置：缺省为 `backend/data/audio.sqlite3`（SQLite）与 `backend/data/audio/`（音频产物、试听和 peaks 缓存）；脚本正文及版本存于 SQLite，不单独写 JSON 文件。如需重置开发数据，先停掉后端，再备份并删除 `backend/data/audio.sqlite3`、对应 `-wal/-shm` 文件及 `backend/data/audio/` 后重启；自定义 `DATA_DIR` 时以其实际目录为准。

## 3. 遗留人工事项

- [ ] 「送去 TTS」按钮当前为禁用占位，待 T004 实装后移除禁用。
- [ ] 真实模型模式下建议各跑一次 5 分钟档生成，人工评估脚本质量与标记规范性（Prompt 调优属 T008 质量任务范围）。
