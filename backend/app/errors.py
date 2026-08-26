"""统一错误：所有业务错误抛 ApiError，响应体 {code, message}（api-contract.md 2.1）。"""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import HTTPException
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


def not_found(code: str, message: str) -> ApiError:
    return ApiError(code, message, 404)


def conflict(code: str, message: str) -> ApiError:
    return ApiError(code, message, 409)


def invalid(code: str, message: str) -> ApiError:
    return ApiError(code, message, 422)


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"code": exc.code, "message": exc.message},
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """FastAPI/Starlette HTTP 异常统一为 {code, message} 结构（如 422 校验失败）。"""
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    message = str(exc.detail) if exc.detail else HTTPException(exc.status_code).detail
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": f"HTTP_{exc.status_code}", "message": message},
    )
