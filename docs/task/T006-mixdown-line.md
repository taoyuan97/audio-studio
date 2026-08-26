# T006：混音线（FFmpeg 滤镜链 + 导出 + 混音页）

## 1. 任务信息

- 状态：待开始
- 优先级：P0
- 类型：正式任务 6/8
- 前置任务：T004（voice 产物）、T005（bgm 产物）
- 后续任务：T007（mix 产物入库展示）
- 目标目录：`backend/app/mixdown.py`、`frontend/src/features/mixdown/`
- 创建日期：2026-08-26
- 关联文档：`docs/prd/prd.md`（5.4）、`docs/tech/tech-design.md`（5.8）、`docs/tech/api-contract.md`（第 9 节）、`docs/tech/data-model.md`（5.4）

## 2. 目标

实现最终混音完整链路：FFmpeg 滤镜链（音量/偏移/循环填充/截断/闪避模式 B）、三种轨道组合规则、双格式导出、双轨波形预览、混音页。完成后人声+背景音可合成可导出成品。

## 3. 行为基线（继承原型 mixdown 页语义 + 决策 B5/D1/E2）

- 交互同原型：人声/背景双轨下拉（可为空）+ 音量滑块 ×2 + 偏移滑块 + 闪避开关（仅模式 B，附说明文案）+ 格式选择 + 双轨波形叠放预览 + 组合规则提示。
- 规则：背景短于人声循环填充、长则截断；仅人声透传重编码；仅背景原样导出；双轨至少其一。
- 闪避仅模式 B（sidechaincompress：人声为 sidechain，背景被压缩）；单轨或关闭时跳过。
- 导出 MP3 320k / WAV 16bit 48kHz（E2）；`.part` 原子落盘 + ffprobe 复验。

## 4. 范围

### 4.1 必须实现

**后端**

- `app/mixdown.py`：jobs 端点（api-contract.md 第 9 节：参数校验、轨道类型校验 `MIX_INPUT_INVALID`、`MIX_FFMPEG_MISSING`）。
- 复用 T002 `app/ffmpeg.py` 底层工具，混音提交前按 `FFMPEG_PATH`（缺省 PATH）同时检查 ffmpeg/ffprobe；不可用时直接 503 `MIX_FFMPEG_MISSING`，不创建 run。
- 将底层 `FFmpegError` 映射为脱敏后的 `MIX_FFMPEG_ERROR`；上游 stderr 与本地绝对路径只写服务端日志，不进入 API/SSE `message`。
- 滤镜链构建（纯函数，可单测）：
  ```text
  双轨: [bgm] (aloop 循环 | atrim 截断) → adelay=offset → volume=bgm_gain
        [voice] volume=voice_gain
        ducking=on → sidechaincompress(voice→sidechain, bgm 被压)
        → amix → 导出
  仅人声: 透传重编码；仅背景: stream copy（格式一致时）或重编码
  ```
  sidechain 参数默认：threshold≈0.03、ratio≈4、attack≈50ms、release≈400ms。
- run handler：`mix.progress`（prep→ducking→encode）→ 原子落盘 → 建 mix 产物 → completed。
- FFmpeg 子进程取消、超时与失败时清理 `.part`/中间文件；已开始执行的 running run 支持终止子进程并以 cancelled 收口。

**前端**

- `/mixdown` 页（`?voice_id=&bgm_id=` 预选，来自 TTS/BGM 页跳转）：
  - 双轨下拉：voice / bgm 产物各一（含名称/参数摘要/时长），支持清空；双空禁用提交。
  - 调节面板：音量滑块 ×2（0–100）、偏移滑块（0–60s）、闪避开关 + 模式 B 说明文案、格式气泡。
  - 双轨波形：两轨 peaks 上下叠放（偏移可视化偏移量）；加载中/单轨空态。
  - 组合规则提示：根据两轨时长实时显示（循环填充/截断/透传）。
  - 提交 → 运行态（phase 进度）→ 结果：混音成品播放 + 波形 + 参数摘要 + 自动入库。
  - 失败卡片（FFmpeg 缺失 → 引导设置页；执行失败 → 可重试）。

### 4.2 不实现

- 模式 A 静音段压低（已删除，D1）；成品再编辑/二次混音；响度归一（LUFS）——一期不做。

## 5. 状态与数据流设计

```text
Query: ['artifacts','voice'] / ['artifacts','bgm'] / ['artifact', id] / ['peaks', voiceId] / ['peaks', bgmId]
Mutation: submitJob / cancel
事件: mix.progress→phase；run.completed→invalidate artifact → 结果渲染
规则提示 = 前端按两轨 duration 对比推导（纯展示，实际处理以后端滤镜链为准）
```

## 6. 测试

- 自动化（pytest）：滤镜链参数拼装矩阵（双轨+ducking 开/关、偏移边界、循环/截断分支、单轨透传/原样）、组合规则处理结果时长断言（fake 双 WAV：短背景→输出=人声时长；长背景→输出=人声时长）、原子落盘与失败清理、契约端点与事件序列、`FFMPEG_PATH` 覆盖、ffmpeg/ffprobe 缺失 503、执行失败错误码与路径脱敏。
- 自动化（Vitest）：轨道选择/清空互斥与提交禁用、规则提示随时长/选择变化、双轨波形叠放渲染。
- 手工：固定样本（人声含明确停顿 + 背景音）人耳验收 ducking 三态（开/关/单轨），偏移与音量实时听感。

## 7. 验收标准

- [ ] `?voice_id=&bgm_id=` 跳转预选正确；双空禁用提交。
- [ ] 三种组合（人声+背景/仅人声/仅背景）全部可走通，规则提示与实际处理一致，输出时长断言通过。
- [ ] ducking 开启时人声段落背景音可感知降低、停顿处恢复（人耳验收）；关闭/单轨时无压缩。
- [ ] 偏移/音量生效（滤镜链参数断言 + 试听）；波形偏移可视化正确。
- [ ] MP3/WAV 导出参数正确（ffprobe 复验断言）；失败无半成品。
- [ ] `FFMPEG_PATH` 与 PATH 两种探测方式均生效；缺失/执行失败分别稳定映射 `MIX_FFMPEG_MISSING`/`MIX_FFMPEG_ERROR`，响应不泄露绝对路径和 stderr。
- [ ] 契约测试通过；控制台无错误。
