"""环境配置（.env / 环境变量），见 docs/tech/tech-design.md 5.10。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM（剧本生成）
    deepseek_api_key: str = ""
    dashscope_api_key: str = ""
    moonshot_api_key: str = ""

    # 火山引擎 TTS
    volc_tts_app_id: str = ""
    volc_tts_access_token: str = ""

    # MiniMax Music
    minimax_api_key: str = ""
    minimax_timeout_seconds: int = 600

    # 本地环境
    data_dir: Path = Path("data")
    ffmpeg_path: str = ""
    fake_mode: bool = False
    serve_frontend: bool = False

    # LLM 超时
    llm_timeout_seconds: int = 120


@lru_cache
def cached_settings() -> Settings:
    return Settings()
