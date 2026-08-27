"""真实 MiniMax Music 3.0 连通与后处理探针；会产生服务商调用费用。"""

from __future__ import annotations

import argparse
import asyncio
import sys
import tempfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.music.minimax import MODEL, generate_music
from app.music.postprocess import MusicProcessingError, process_music
from app.music.provider import MusicGenerationRequest, MusicServiceError


async def probe(settings: Settings, prompt: str, duration: int, output_format: str) -> bool:
    if not settings.minimax_api_key:
        print("SKIP minimax: 未配置 MINIMAX_API_KEY")
        return False

    request = MusicGenerationRequest(
        prompt=prompt,
        target_duration=duration,
        structure_hints=("intro", "outro"),
        output_format=output_format,
    )
    try:
        generated = await generate_music(
            settings.minimax_api_key,
            request,
            timeout=settings.minimax_timeout_seconds,
        )
        with tempfile.TemporaryDirectory(prefix="audio-studio-music-") as temp_name:
            temp_dir = Path(temp_name)
            source = temp_dir / "source.mp3"
            final = temp_dir / f"final.{output_format}"
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                async with client.stream("GET", generated.audio_url) as response:
                    response.raise_for_status()
                    with source.open("wb") as output:
                        async for chunk in response.aiter_bytes():
                            output.write(chunk)
            source_info, final_info = await asyncio.to_thread(
                process_music,
                source,
                final,
                duration,
                output_format,
                settings.ffmpeg_path,
            )
    except (MusicServiceError, MusicProcessingError, httpx.HTTPError, OSError) as exc:
        print(f"FAIL minimax: {exc}")
        return False

    print(
        f"OK   minimax: model={MODEL} request_id={generated.request_id} "
        f"source={source_info.duration_seconds:.2f}s "
        f"final={final_info.duration_seconds:.2f}s/{final_info.sample_rate}Hz "
        "url_ttl=24h"
    )
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description="真实调用 MiniMax Music 3.0 并验证下载、循环及淡入淡出")
    parser.add_argument("--yes", action="store_true", help="确认执行可能计费的真实调用")
    parser.add_argument("--duration", type=int, default=60, help="目标秒数（60～600）")
    parser.add_argument("--format", choices=("mp3", "wav"), default="mp3")
    parser.add_argument(
        "--prompt",
        default="空灵缓慢的冥想背景音乐，古琴和柔和氛围音色，无明显鼓点，纯音乐",
    )
    args = parser.parse_args()
    if not args.yes:
        parser.error("真实探针可能产生 MiniMax 费用；确认后请增加 --yes")
    if not 60 <= args.duration <= 600:
        parser.error("--duration 必须为 60～600")
    return 0 if await probe(Settings(fake_mode=False), args.prompt, args.duration, args.format) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
