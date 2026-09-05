"""环境配置校验测试。"""

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_model_id_defaults_preserve_existing_models():
    settings = Settings(_env_file=None)

    assert settings.deepseek_model_id == "deepseek-chat"
    assert settings.dashscope_model_id == "qwen-plus"
    assert settings.moonshot_model_id == "kimi-k2-0905-preview"
    assert settings.aliyun_tts_model_id == "qwen-audio-3.0-tts-plus"
    assert settings.minimax_model_id == "music-3.0"
    assert settings.e2e_mode is False


def test_model_ids_are_trimmed_and_customizable():
    settings = Settings(
        _env_file=None,
        deepseek_model_id=" deepseek-reasoner ",
        dashscope_model_id=" qwen-max ",
        moonshot_model_id=" moonshot-v1-auto ",
    )

    assert settings.deepseek_model_id == "deepseek-reasoner"
    assert settings.dashscope_model_id == "qwen-max"
    assert settings.moonshot_model_id == "moonshot-v1-auto"


def test_blank_model_id_is_rejected_with_field_name():
    with pytest.raises(ValidationError, match="DEEPSEEK_MODEL_ID 不能为空"):
        Settings(_env_file=None, deepseek_model_id="  ")


def test_blank_aliyun_tts_model_id_is_rejected():
    with pytest.raises(ValidationError, match="ALIYUN_TTS_MODEL_ID 不能为空"):
        Settings(_env_file=None, aliyun_tts_model_id="  ")


def test_blank_minimax_model_id_is_rejected():
    with pytest.raises(ValidationError, match="MINIMAX_MODEL_ID 不能为空"):
        Settings(_env_file=None, minimax_model_id="  ")


def test_aliyun_tts_configuration_is_independent_from_dashscope():
    settings = Settings(
        _env_file=None,
        dashscope_api_key="llm-key",
        dashscope_model_id="qwen-max",
        aliyun_tts_api_key="tts-key",
        aliyun_tts_model_id="qwen-audio-3.0-tts-plus",
    )
    assert settings.aliyun_tts_api_key == "tts-key"
    assert settings.aliyun_tts_model_id == "qwen-audio-3.0-tts-plus"


def test_duplicate_model_ids_are_allowed_across_providers():
    settings = Settings(
        _env_file=None,
        deepseek_model_id="same-model",
        dashscope_model_id="same-model",
        moonshot_model_id="other-model",
    )
    assert settings.deepseek_model_id == settings.dashscope_model_id == "same-model"
