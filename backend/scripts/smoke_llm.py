"""DeepSeek/千问真实流式生成探针；会产生少量服务商调用费用。"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.errors import ApiError
from app.llm.registry import ModelRegistry

REQUIRED_MARKERS = ("[停顿", "[情绪:", "[语速:", "[吸气]", "[呼气]")


async def probe(provider: str, settings: Settings, output_dir: Path) -> bool:
    registry = ModelRegistry(settings)
    entry = registry.get_by_provider(provider)
    if entry is None or not registry.is_configured(entry.model):
        print(f"SKIP {provider}: 未配置对应 API Key")
        return False

    messages = [
        {
            "role": "system",
            "content": "你是冥想脚本作者。只输出带规范控制标记的简短中文脚本。",
        },
        {
            "role": "user",
            "content": (
                "写一段约 150 字的睡前放松脚本，必须完整包含且保持原样："
                "[停顿 2s]、[情绪:温柔]、[语速:慢速]、[吸气]、[呼气]。"
            ),
        },
    ]
    started = time.perf_counter()
    chunks: list[str] = []
    try:
        async for delta in registry.stream_chat(entry.model, messages):
            chunks.append(delta)
            print(delta, end="", flush=True)
    except ApiError as exc:
        print(f"\nFAIL {provider}: {exc.code} {exc.message}")
        return False

    text = "".join(chunks).strip()
    missing = [marker for marker in REQUIRED_MARKERS if marker not in text]
    if not text or missing:
        print(f"\nFAIL {provider}: 输出缺少标记 {missing}")
        return False

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"llm-{provider}.txt"
    output_path.write_text(text + "\n", encoding="utf-8")
    print(
        f"\nOK   {provider}: model={entry.model} chars={len(text)} "
        f"elapsed={time.perf_counter() - started:.2f}s path={output_path.resolve()}"
    )
    return True


async def main() -> int:
    parser = argparse.ArgumentParser(description="真实流式调用 DeepSeek/千问并校验冥想标记")
    parser.add_argument("--provider", choices=("deepseek", "qwen", "both"), default="both")
    parser.add_argument("--yes", action="store_true", help="确认执行可能计费的真实调用")
    parser.add_argument("--output-dir", type=Path, help="生成物目录；默认 DATA_DIR/smoke/<时间>")
    args = parser.parse_args()
    if not args.yes:
        parser.error("真实探针可能产生费用；确认后请增加 --yes")

    settings = Settings(fake_mode=False)
    output_dir = args.output_dir or (
        settings.data_dir / "smoke" / datetime.now().strftime("%Y%m%d-%H%M%S")
    )
    providers = ("deepseek", "qwen") if args.provider == "both" else (args.provider,)
    results = [await probe(provider, settings, output_dir) for provider in providers]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
