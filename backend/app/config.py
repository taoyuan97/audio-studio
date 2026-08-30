"""环境配置（.env / 环境变量），见 docs/tech/tech-design.md 5.10。"""

from __future__ import annotations

import json
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import Field, ValidationInfo, field_validator
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
    minimax_timeout_seconds: int = Field(default=600, ge=30, le=1200)

    # 本地环境
    data_dir: Path = Path("data")
    ffmpeg_path: str = ""
    fake_mode: bool = False
    serve_frontend: bool = False

    # LLM 超时
    llm_timeout_seconds: int = Field(default=120, ge=1, le=600)

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

@lru_cache
def cached_settings() -> Settings:
    return Settings()


class SettingsRevisionConflictError(RuntimeError):
    """浏览器提交的 revision 已过期。"""


class SettingsStore:
    """`.env` 基线 + DATA_DIR/settings.json 字段级覆盖的线程安全配置仓库。"""

    PROVIDER_FIELDS: dict[str, tuple[str, ...]] = {
        "llm_deepseek": ("deepseek_api_key", "deepseek_model_id"),
        "llm_qwen": ("dashscope_api_key", "dashscope_model_id"),
        "llm_moonshot": ("moonshot_api_key", "moonshot_model_id"),
        "tts_aliyun": ("aliyun_tts_api_key", "aliyun_tts_model_id"),
        "tts_volc": ("volc_tts_app_id", "volc_tts_access_token"),
    }
    CREDENTIAL_FIELDS: dict[str, tuple[str, ...]] = {
        "llm_deepseek": ("deepseek_api_key",),
        "llm_qwen": ("dashscope_api_key",),
        "llm_moonshot": ("moonshot_api_key",),
        "tts_aliyun": ("aliyun_tts_api_key",),
        "tts_volc": ("volc_tts_app_id", "volc_tts_access_token"),
        "minimax": ("minimax_api_key",),
    }
    RUNTIME_FIELDS = ("llm_timeout_seconds", "minimax_timeout_seconds")

    def __init__(self, base: Settings, path: Path):
        self.path = Path(path)
        self._base = base
        self._overrides: dict[str, Any] = {}
        self._revision = 0
        self._lock = threading.RLock()
        self._load()
        self._current = self._build(self._overrides)

    @property
    def current(self) -> Settings:
        with self._lock:
            return self._current

    @property
    def revision(self) -> int:
        with self._lock:
            return self._revision

    def has_override(self, field: str) -> bool:
        with self._lock:
            return field in self._overrides

    def reveal_override(self, field: str, *, expected_revision: int) -> str:
        """只读取浏览器持久化的字段，绝不回退到 `.env` 基线。"""
        with self._lock:
            self._check_revision(expected_revision)
            value = self._overrides.get(field)
            if not isinstance(value, str) or not value:
                raise ValueError("该凭据来自 .env 或尚未通过浏览器保存，不能查看")
            return value

    def credential_source(self, provider: str) -> str | None:
        fields = self.CREDENTIAL_FIELDS[provider]
        current = self.current
        if not all(bool(getattr(current, field)) for field in fields):
            return None
        runtime_count = sum(self.has_override(field) for field in fields)
        if runtime_count == len(fields):
            return "runtime"
        if runtime_count:
            return "mixed"
        return "env"

    def update_provider(
        self, provider: str, values: dict[str, Any], *, expected_revision: int
    ) -> Settings:
        allowed = self.PROVIDER_FIELDS.get(provider)
        if allowed is None:
            raise ValueError("该服务不支持浏览器编辑")
        unknown = set(values) - set(allowed)
        if unknown:
            raise ValueError(f"不支持的配置字段: {', '.join(sorted(unknown))}")
        if not values:
            raise ValueError("没有可更新的字段")
        return self._commit(values, expected_revision=expected_revision)

    def update_runtime(
        self, values: dict[str, Any], *, expected_revision: int
    ) -> Settings:
        unknown = set(values) - set(self.RUNTIME_FIELDS)
        if unknown or not values:
            raise ValueError("运行参数字段非法或为空")
        return self._commit(values, expected_revision=expected_revision)

    def clear_credentials(self, provider: str, *, expected_revision: int) -> Settings:
        if provider == "minimax":
            raise ValueError("MiniMax API Key 暂不支持浏览器编辑")
        fields = self.CREDENTIAL_FIELDS.get(provider)
        if fields is None:
            raise ValueError("未知服务")
        with self._lock:
            self._check_revision(expected_revision)
            candidate = dict(self._overrides)
            for field in fields:
                candidate.pop(field, None)
            return self._persist_and_switch(candidate)

    def _commit(self, values: dict[str, Any], *, expected_revision: int) -> Settings:
        with self._lock:
            self._check_revision(expected_revision)
            candidate = {**self._overrides, **values}
            return self._persist_and_switch(candidate)

    def _check_revision(self, expected: int) -> None:
        if expected != self._revision:
            raise SettingsRevisionConflictError()

    def _persist_and_switch(self, candidate: dict[str, Any]) -> Settings:
        updated = self._build(candidate)
        revision = self._revision + 1
        payload = {"revision": revision, "overrides": candidate}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(f".{self.path.name}.tmp")
        try:
            with open(temporary, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.path)
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
        self._overrides = candidate
        self._revision = revision
        self._current = updated
        return updated

    def _build(self, overrides: dict[str, Any]) -> Settings:
        values = self._base.model_dump()
        values.update(overrides)
        return Settings(_env_file=None, **values)

    def _load(self) -> None:
        if not self.path.is_file():
            return
        data = json.loads(self.path.read_text(encoding="utf-8"))
        revision = data.get("revision", 0)
        overrides = data.get("overrides", {})
        if not isinstance(revision, int) or revision < 0 or not isinstance(overrides, dict):
            raise ValueError("settings.json 格式非法")
        allowed = {
            field
            for fields in self.PROVIDER_FIELDS.values()
            for field in fields
        } | set(self.RUNTIME_FIELDS)
        # MiniMax Key 不接受运行时文件注入，未知字段也拒绝，避免静默误配置。
        if unknown := set(overrides) - allowed:
            raise ValueError(f"settings.json 包含不支持字段: {', '.join(sorted(unknown))}")
        self._revision = revision
        self._overrides = overrides
