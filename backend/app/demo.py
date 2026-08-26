"""演示任务：sleep + 进度上报 + 生成示例 WAV 产物。

T002 内部联调端点（非正式契约）：用于验证 run 队列、SSE 事件时序、产物入库
与音频/峰值端点，同时供前端 T001 联调 useRunStream。后续任务（T003–T006）
以真实业务 handler 替代。
"""

from __future__ import annotations

import math
import struct
import wave
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request

from .database import Repository
from .runs import RunContext, RunManager

router = APIRouter(prefix="/api/demo", tags=["demo"])

SAMPLE_RATE = 8000
DEMO_SECONDS = 0.4


async def demo_handler(ctx: RunContext) -> str:
    """三步进度 + 正弦波 WAV 产物（.part 原子落盘）。"""
    total_steps = 3
    for step in range(total_steps):
        ctx.check_cancelled()
        ctx.report_progress(
            completed=step,
            total=total_steps,
            stage=f"step-{step + 1}",
            event="demo.progress",
        )
        await ctx.sleep(0.05)

    manager = ctx._manager  # noqa: SLF001 - 演示任务直接复用管理器内部引用
    repo: Repository = manager.repo
    artifact = repo.insert_artifact(
        type="voice",
        name="演示人声（T002 联调）",
        source_run_id=ctx.run_id,
        params={"scene": "meditation", "engine": "demo", "format": "wav"},
        audio_path=None,
        audio_format="wav",
        duration=DEMO_SECONDS,
    )
    audio_dir: Path = manager.audio_dir
    final_path = audio_dir / "artifacts" / f"{artifact['id']}.wav"
    final_path.parent.mkdir(parents=True, exist_ok=True)
    part_path = final_path.with_suffix(".wav.part")
    _write_sine_wav(part_path, DEMO_SECONDS)
    part_path.replace(final_path)
    repo.update_artifact_audio_path(artifact["id"], f"artifacts/{artifact['id']}.wav")
    return artifact["id"]


def _write_sine_wav(path: Path, seconds: float) -> None:
    frames = int(seconds * SAMPLE_RATE)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        for frame in range(frames):
            value = int(12000 * math.sin(2 * math.pi * 220 * frame / SAMPLE_RATE))
            writer.writeframesraw(struct.pack("<h", value))


@router.post("/jobs", status_code=202)
async def create_demo_job(request: Request):
    manager: RunManager = request.app.state.runs
    run = await manager.enqueue("demo")
    return manager.run_payload(run)
