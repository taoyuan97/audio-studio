"""本机可信页面的写操作保护。"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import Request

from .errors import ApiError


def require_local_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    host = (urlparse(origin).hostname or "").lower()
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise ApiError("SETTINGS_ORIGIN_FORBIDDEN", "设置写入仅限本机页面", 403)
