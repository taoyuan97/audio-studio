"""测试基座：临时 DATA_DIR + FAKE_MODE + ASGI 客户端。"""

from __future__ import annotations

import struct
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette

from app.config import Settings
from app.main import create_app


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "data_dir": tmp_path,
        "fake_mode": True,
        "serve_frontend": False,
        "deepseek_model_id": "deepseek-chat",
        "dashscope_model_id": "qwen-plus",
        "moonshot_model_id": "kimi-k2-0905-preview",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def app(tmp_path: Path) -> Starlette:
    return create_app(settings=make_settings(tmp_path))


@pytest.fixture
def client(app: Starlette) -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


def write_wav(path: Path, seconds: float = 0.2, frequency: int = 220) -> None:
    """生成 16bit 单声道正弦 WAV（无外部依赖，供音频端点测试）。"""
    import math

    rate = 8000
    frames = int(seconds * rate)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        for frame in range(frames):
            value = int(10000 * math.sin(2 * math.pi * frequency * frame / rate))
            writer.writeframesraw(struct.pack("<h", value))


def create_voice_artifact(app: Starlette, name: str = "测试人声") -> dict:
    """经仓储插入带 WAV 文件的 voice 产物（T002 无业务创建端点）。"""
    repo = app.state.repository
    artifact = repo.insert_artifact(
        type="voice",
        name=name,
        params={"scene": "meditation", "engine": "demo", "format": "wav"},
        audio_format="wav",
        duration=0.2,
    )
    audio_file = app.state.audio_dir / "artifacts" / f"{artifact['id']}.wav"
    write_wav(audio_file)
    repo.update_artifact_audio_path(artifact["id"], f"artifacts/{artifact['id']}.wav")
    return repo.get_artifact(artifact["id"])


def create_script_artifact(app: Starlette, text: str = "欢迎 [停顿 3s] 放松") -> dict:
    repo = app.state.repository
    return repo.insert_artifact(
        type="script_meditation",
        name="测试脚本",
        params={"topic": "测试", "duration": 5, "model": "deepseek-chat"},
        content={"text": text},
    )
