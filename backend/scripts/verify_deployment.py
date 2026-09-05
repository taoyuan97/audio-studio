"""验证同源部署或 Vite proxy 的 SPA、API、SSE 与音频 Range。"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx


def verify(base_url: str) -> dict[str, Any]:
    started = time.perf_counter()
    events: list[dict[str, Any]] = []
    with httpx.Client(base_url=base_url, timeout=30, follow_redirects=True) as client:
        health = client.get("/api/health")
        health.raise_for_status()
        assert health.json().get("status") == "ok"

        deep_link = client.get("/meditation/e2e-deep-link")
        deep_link.raise_for_status()
        assert "text/html" in deep_link.headers.get("content-type", "")
        assert '<div id="root"></div>' in deep_link.text

        created = client.post("/api/demo/jobs")
        created.raise_for_status()
        run_id = created.json()["run_id"]

        event_name: str | None = None
        with client.stream(
            "GET",
            f"/api/runs/{run_id}/events",
            headers={"Accept": "text/event-stream"},
        ) as stream:
            stream.raise_for_status()
            assert "text/event-stream" in stream.headers.get("content-type", "")
            assert stream.headers.get("x-accel-buffering") == "no"
            for line in stream.iter_lines():
                if line.startswith("event:"):
                    event_name = line.partition(":")[2].strip()
                elif line.startswith("data:") and event_name:
                    payload = json.loads(line.partition(":")[2].strip())
                    events.append(
                        {
                            "event": event_name,
                            "arrival_ms": round((time.perf_counter() - started) * 1000, 1),
                            "data": payload,
                        }
                    )
                    if event_name in {"run.completed", "run.failed", "run.cancelled"}:
                        break
                    event_name = None

        names = [item["event"] for item in events]
        assert names and names[0] == "run.status"
        # worker 可能在 POST 响应返回前已发布 run.started；此时连接快照应为
        # running，后续 progress 必须分批到达，仍可证明代理没有缓冲整条 SSE。
        assert any(name not in {"run.status", "run.completed"} for name in names)
        assert names[-1] == "run.completed"
        assert events[-1]["arrival_ms"] - events[0]["arrival_ms"] >= 100
        artifact_id = events[-1]["data"]["artifact_id"]

        partial = client.get(
            f"/api/artifacts/{artifact_id}/audio",
            headers={"Range": "bytes=0-99"},
        )
        assert partial.status_code == 206
        assert len(partial.content) == 100
        assert partial.headers.get("accept-ranges") == "bytes"
        assert partial.headers.get("content-range", "").startswith("bytes 0-99/")

    return {
        "base_url": base_url,
        "checked_at": datetime.now().astimezone().isoformat(),
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "health": "ok",
        "spa_deep_link": "ok",
        "sse_events": events,
        "range": "206 bytes=0-99",
        "artifact_id": artifact_id,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = verify(args.base_url.rstrip("/"))
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
