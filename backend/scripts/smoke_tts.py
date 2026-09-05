"""真实 TTS 连通探针；会产生少量服务商调用费用。"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.tts.audio import validate_wav
from app.tts.providers import TTSProviderError, make_provider
from app.tts.voices import voices_for


async def probe(engine: str, settings: Settings, output_dir: Path) -> bool:
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
    started = time.perf_counter()
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
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"tts-{engine}.wav"
        output_path.write_bytes(result.audio)
    except (TTSProviderError, ValueError) as exc:
        print(f"FAIL {engine}: {exc}")
        return False
    seconds = len(frames) / (rate * channels * width)
    elapsed = time.perf_counter() - started
    model = settings.aliyun_tts_model_id if engine == "aliyun" else "BV700_streaming"
    print(
        f"OK   {engine}: model={model} voice={voice} {rate}Hz/{channels}ch "
        f"audio={seconds:.2f}s elapsed={elapsed:.2f}s path={output_path.resolve()}"
    )
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description="真实调用阿里云/火山 TTS 并校验 WAV")
    parser.add_argument("--engine", choices=("aliyun", "volc", "both"), default="both")
    parser.add_argument("--yes", action="store_true", help="确认执行可能计费的真实调用")
    parser.add_argument("--output-dir", type=Path, help="生成物目录；默认 DATA_DIR/smoke/<时间>")
    args = parser.parse_args()
    if not args.yes:
        parser.error("真实探针可能产生费用；确认后请增加 --yes")
    settings = Settings(fake_mode=False)
    output_dir = args.output_dir or (
        settings.data_dir / "smoke" / datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    engines = ("aliyun", "volc") if args.engine == "both" else (args.engine,)
    results = [await probe(engine, settings, output_dir) for engine in engines]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
