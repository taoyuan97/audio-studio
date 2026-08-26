"""产物端点：list/detail/patch/delete/audio(Range)/peaks（api-contract.md 第 6 节）。"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Query, Request, Response
from pydantic import BaseModel, Field

from .database import NotFoundError, Repository, RevisionConflictError
from .errors import ApiError, invalid, not_found
from .peaks import load_or_compute_peaks

router = APIRouter(prefix="/api/artifacts", tags=["artifacts"])

ARTIFACT_TYPES = ("script_meditation", "voice", "bgm", "mix")
MEDIA_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav"}


class ArtifactPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    content: dict | None = None


class RestoreVersionRequest(BaseModel):
    expected_revision: int = Field(ge=0)


def _repo(request: Request) -> Repository:
    return request.app.state.repository


def _get_artifact(request: Request, artifact_id: str) -> dict:
    try:
        return _repo(request).get_artifact(artifact_id)
    except NotFoundError:
        raise not_found("ARTIFACT_NOT_FOUND", "产物不存在") from None


def _audio_dir(request: Request) -> Path:
    return request.app.state.audio_dir


@router.get("")
def list_artifacts(
    request: Request,
    type: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
):
    if type is not None and type not in ARTIFACT_TYPES:
        raise invalid("ARTIFACT_TYPE_INVALID", f"非法产物类型: {type}")
    return {"items": _repo(request).list_artifacts(type=type, limit=limit)}


@router.get("/{artifact_id}")
def get_artifact(artifact_id: str, request: Request):
    return _get_artifact(request, artifact_id)


@router.get("/{artifact_id}/versions")
def list_artifact_versions(artifact_id: str, request: Request):
    artifact = _get_artifact(request, artifact_id)
    if not artifact["type"].startswith("script"):
        raise invalid("ARTIFACT_NOT_EDITABLE", "音频产物没有脚本版本")
    return {"items": _repo(request).list_artifact_versions(artifact_id)}


@router.post("/{artifact_id}/versions/{version_id}/restore-draft")
def restore_artifact_version(
    artifact_id: str,
    version_id: str,
    payload: RestoreVersionRequest,
    request: Request,
):
    artifact = _get_artifact(request, artifact_id)
    if not artifact["type"].startswith("script"):
        raise invalid("ARTIFACT_NOT_EDITABLE", "音频产物没有脚本版本")
    try:
        return _repo(request).restore_artifact_version_to_draft(
            artifact_id,
            version_id,
            expected_revision=payload.expected_revision,
        )
    except NotFoundError:
        raise not_found("SCRIPT_VERSION_NOT_FOUND", "脚本版本不存在") from None
    except RevisionConflictError:
        raise ApiError(
            "SCRIPT_DRAFT_REVISION_CONFLICT", "草稿已在其他位置更新", 409
        ) from None


@router.patch("/{artifact_id}")
def patch_artifact(artifact_id: str, payload: ArtifactPatch, request: Request):
    artifact = _get_artifact(request, artifact_id)
    updates: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.content is not None:
        if not artifact["type"].startswith("script"):
            raise invalid("ARTIFACT_NOT_EDITABLE", "音频产物不支持内容编辑")
        raise invalid(
            "SCRIPT_EDIT_VIA_DRAFT_REQUIRED",
            "脚本内容请先编辑工作草稿，再手动保存为新版本",
        )
    if not updates:
        raise invalid("ARTIFACT_PATCH_EMPTY", "没有可更新的字段")
    return _repo(request).update_artifact(artifact_id, **updates)


@router.delete("/{artifact_id}")
def delete_artifact(artifact_id: str, request: Request):
    _get_artifact(request, artifact_id)
    artifact = _repo(request).get_artifact(artifact_id)
    _repo(request).delete_artifact(artifact_id)
    # 连带清理音频文件与峰值缓存
    if artifact["audio"]:
        audio_file = _audio_dir(request) / "artifacts" / f"{artifact_id}.{artifact['audio']['format']}"
        for candidate in (audio_file, _audio_dir(request) / "peaks" / f"{artifact_id}.json"):
            try:
                candidate.unlink(missing_ok=True)
            except OSError:
                pass
    return {"deleted": True}


@router.get("/{artifact_id}/audio")
def get_artifact_audio(artifact_id: str, request: Request, range_header: str | None = None):
    """音频文件流，支持 HTTP Range（<audio> seek 依赖）。"""
    del range_header  # Range 经 request.headers 读取
    artifact = _get_artifact(request, artifact_id)
    if not artifact["audio"]:
        raise not_found("ARTIFACT_NO_AUDIO", "该产物没有音频文件")
    fmt = artifact["audio"]["format"] or "wav"
    audio_file = _audio_dir(request) / "artifacts" / f"{artifact_id}.{fmt}"
    if not audio_file.is_file():
        raise not_found("ARTIFACT_NO_AUDIO", "音频文件不存在")

    file_size = audio_file.stat().st_size
    media_type = MEDIA_TYPES.get(fmt, "application/octet-stream")
    range_value = request.headers.get("range")

    if range_value:
        start, end = _parse_range(range_value, file_size)
        length = end - start + 1
        with open(audio_file, "rb") as handle:
            handle.seek(start)
            data = handle.read(length)
        return Response(
            content=data,
            status_code=206,
            media_type=media_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
            },
        )

    with open(audio_file, "rb") as handle:
        data = handle.read()
    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
        },
    )


def _parse_range(range_value: str, file_size: int) -> tuple[int, int]:
    """解析 `bytes=start-end`（end 可省略/越界裁剪）。"""
    if not range_value.startswith("bytes="):
        raise ApiError("RANGE_INVALID", "不支持的 Range 头", 416)
    spec = range_value[len("bytes=") :].split(",")[0].strip()
    if "-" not in spec:
        raise ApiError("RANGE_INVALID", "不支持的 Range 头", 416)
    start_str, end_str = spec.split("-", 1)
    try:
        if start_str == "":
            # bytes=-N：最后 N 字节
            suffix = int(end_str)
            start = max(0, file_size - suffix)
            end = file_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
    except ValueError:
        raise ApiError("RANGE_INVALID", "不支持的 Range 头", 416) from None
    end = min(end, file_size - 1)
    if start < 0 or start > end or start >= file_size:
        raise ApiError("RANGE_INVALID", "请求范围越界", 416)
    return start, end


@router.get("/{artifact_id}/peaks")
def get_artifact_peaks(artifact_id: str, request: Request):
    artifact = _get_artifact(request, artifact_id)
    if not artifact["audio"]:
        raise not_found("ARTIFACT_NO_AUDIO", "该产物没有音频文件")
    fmt = artifact["audio"]["format"] or "wav"
    audio_file = _audio_dir(request) / "artifacts" / f"{artifact_id}.{fmt}"
    peaks_cache = _audio_dir(request) / "peaks" / f"{artifact_id}.json"
    return load_or_compute_peaks(audio_file, peaks_cache, fmt)
