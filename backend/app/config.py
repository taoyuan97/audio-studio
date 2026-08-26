"""环境配置（.env / 环境变量），见 docs/tech/tech-design.md 5.10。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM（剧本生成）
    deepseek_api_key: str = ""
    dashscope_api_key: str = ""
    moonshot_api_key: str = ""
    deepseek_model_id: str = "deepseek-chat"
    dashscope_model_id: str = "qwen-plus"
    moonshot_model_id: str = "kimi-k2-0905-preview"

    # 阿里云 TTS（与通义千问 LLM 配置隔离）
    aliyun_tts_api_key: str = ""
    aliyun_tts_model_id: str = "qwen-audio-3.0-tts-plus"

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

    @field_validator(
        "deepseek_model_id",
        "dashscope_model_id",
        "moonshot_model_id",
        "aliyun_tts_model_id",
        mode="before",
    )
    @classmethod
    def validate_model_id_not_blank(cls, value: object, info: ValidationInfo) -> str:
        model_id = str(value or "").strip()
        if not model_id:
            raise ValueError(f"{info.field_name.upper()} 不能为空")
        return model_id

    @model_validator(mode="after")
    def validate_model_ids_unique(self) -> Settings:
        configured = (
            ("DEEPSEEK_MODEL_ID", self.deepseek_model_id),
            ("DASHSCOPE_MODEL_ID", self.dashscope_model_id),
            ("MOONSHOT_MODEL_ID", self.moonshot_model_id),
        )
        seen: dict[str, str] = {}
        for field_name, model_id in configured:
            if previous := seen.get(model_id):
                raise ValueError(
                    f"模型 ID 不允许重复：{previous} 与 {field_name} 均为 {model_id!r}"
                )
            seen[model_id] = field_name
        return self


@lru_cache
def cached_settings() -> Settings:
    return Settings()
