"""启动 Playwright 专用后端：隔离数据、FAKE_MODE 与受控测试入口。"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings
from app.main import create_app


def main() -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    data_dir = (backend_dir / ".tmp" / "e2e-data").resolve()
    safe_parent = (backend_dir / ".tmp").resolve()
    if data_dir.parent != safe_parent or data_dir.name != "e2e-data":
        raise RuntimeError(f"拒绝清理非预期 E2E 数据目录: {data_dir}")
    if data_dir.exists():
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True)

    settings = Settings(fake_mode=True, e2e_mode=True, data_dir=data_dir)
    uvicorn.run(create_app(settings=settings), host="127.0.0.1", port=8010)


if __name__ == "__main__":
    main()
