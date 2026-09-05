"""后端音色库与场景预设（defaults 的唯一事实源）。"""

from __future__ import annotations

ALIYUN_VOICES_BY_MODEL = {
    "qwen-audio-3.0-tts-plus": [
        {"id": "longanlingxin", "name": "龙安灵心", "tags": ["温柔", "女声"], "recommended_scene": "meditation"},
        {"id": "longanlufeng", "name": "龙安鲁风", "tags": ["沉稳", "男声"], "recommended_scene": "meditation"},
    ]
}

VOLC_VOICES = [
    {"id": "zh_female_wanwanxiaohe_moon_bigtts", "name": "湾湾小何", "tags": ["知性", "女声"], "recommended_scene": "podcast"},
    {"id": "zh_male_yangguangqingnian_moon_bigtts", "name": "阳光青年", "tags": ["自然", "男声"], "recommended_scene": "podcast"},
]

SCENE_PRESETS = {
    "meditation": {
        "speed": 0.8,
        "recommended_voice_ids": ["longanlingxin", "longanlufeng"],
        "note": "偏慢语速，温柔系音色",
    },
    "podcast": {
        "speed": 1.0,
        "recommended_voice_ids": ["zh_female_wanwanxiaohe_moon_bigtts"],
        "note": "正常语速，自然讲述",
    },
}


def voices_for(engine: str, model: str | None = None) -> list[dict]:
    if engine == "aliyun":
        return ALIYUN_VOICES_BY_MODEL.get(model or "qwen-audio-3.0-tts-plus", [])
    if engine == "volc":
        return VOLC_VOICES
    return []


def voice_by_id(engine: str, voice_id: str, model: str | None = None) -> dict | None:
    return next(
        (voice for voice in voices_for(engine, model) if voice["id"] == voice_id),
        None,
    )
