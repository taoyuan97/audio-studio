"""真实 TTS 连通探针；会产生少量服务商调用费用。"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.tts.audio import validate_wav
from app.tts.providers import TTSProviderError, make_provider
from app.tts.voices import voices_for


async def probe(engine: str, settings: Settings) -> bool:
    configured = (
        bool(settings.aliyun_tts_api_key)
        if engine == "aliyun"
        else bool(settings.volc_tts_app_id and settings.volc_tts_access_token)
    )
    if not configured:
        print(f"SKIP {engine}: 未配置独立凭据")
        return False
    voice = voices_for(engine)[0]["id"]
    provider = make_provider(settings, engine)
    try:
        result = await provider.synthesize(
            "你好，这是音频工作台连通测试。",
            voice=voice,
            speed=1.0,
            pitch=None,
            emotion="温柔" if engine == "aliyun" else None,
            enable_ssml=False,
        )
        rate, channels, width, frames = validate_wav(result.audio)
    except (TTSProviderError, ValueError) as exc:
        print(f"FAIL {engine}: {exc}")
        return False
    seconds = len(frames) / (rate * channels * width)
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    print(f"OK   {engine}: model={model} voice={voice} {rate}Hz/{channels}ch {seconds:.2f}s")
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description="真实调用阿里云/火山 TTS 并校验 WAV")
    parser.add_argument("--engine", choices=("aliyun", "volc", "both"), default="both")
    parser.add_argument("--yes", action="store_true", help="确认执行可能计费的真实调用")
    args = parser.parse_args()
    if not args.yes:
        parser.error("真实探针可能产生费用；确认后请增加 --yes")
    settings = Settings(fake_mode=False)
    engines = ("aliyun", "volc") if args.engine == "both" else (args.engine,)
    results = [await probe(engine, settings) for engine in engines]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
