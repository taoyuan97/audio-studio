"""剧本线会话端点（api-contract.md 第 4 节）+ script run handler（LLM 流式）。

- 发送/重试 → 写 user 消息（重试复用既有）→ enqueue script run（202）。
- handler：组装上下文 → LLM 流式（assistant.delta）→ 写 assistant 消息
  （message.completed）→ 更新会话工作草稿（script.draft.updated）→ run.completed。
- FAKE_MODE：内置示例冥想脚本按 duration 档位伪流式输出。
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from .config import Settings
from .database import (
    DuplicateVersionError,
    NotFoundError,
    Repository,
    RevisionConflictError,
)
from .errors import ApiError, conflict, invalid, not_found
from .llm.registry import ModelRegistry
from .runs import RunContext
from .script.fake import generate_fake_script
from .script.markers import parse_script
from .script.prompts import (
    REFINEMENT_GUIDE,
    SYSTEM_PROMPT,
    build_user_prompt,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

SCRIPT_DURATIONS = (5, 15, 30)
MAX_TEXT_LENGTH = 20000
# 多轮 refinement 上下文预算（预算内截断）
CONTEXT_MESSAGE_LIMIT = 24
CONTEXT_CHAR_BUDGET = 12000
# FAKE_MODE 伪流式参数
FAKE_CHUNK_SIZE = 24
FAKE_CHUNK_INTERVAL = 0.015


# ---------------- 请求模型 ----------------


class CreateConversationRequest(BaseModel):
    scene: str = "meditation"
    title: str | None = Field(default=None, max_length=100)


class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class SendMessageRequest(BaseModel):
    text: str
    duration: int
    model: str
    allow_draft_overwrite: bool = False


class UpdateScriptDraftRequest(BaseModel):
    text: str
    expected_revision: int = Field(ge=0)


class SaveScriptVersionRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    expected_revision: int = Field(ge=1)


# ---------------- 工具 ----------------


def _repo(request: Request) -> Repository:
    return request.app.state.repository


def _registry(request: Request) -> ModelRegistry:
    return request.app.state.llm_registry


def _get_conversation(request: Request, conversation_id: str) -> dict[str, Any]:
    try:
        return _repo(request).get_conversation(conversation_id)
    except NotFoundError:
        raise not_found("CONVERSATION_NOT_FOUND", "会话不存在") from None


def _validate_script_params(
    registry: ModelRegistry, settings: Settings, duration: int, model: str
) -> None:
    if duration not in SCRIPT_DURATIONS or registry.get(model) is None:
        raise invalid("SCRIPT_PARAMS_INVALID", "时长或模型参数非法")
    if not settings.fake_mode and not registry.is_configured(model):
        raise invalid("SCRIPT_LLM_NOT_CONFIGURED", "该模型未配置 API Key")


def _message_payload(message: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": message["id"],
        "role": message["role"],
        "content": message["content"],
        "created_at": message["created_at"],
    }


# ---------------- 端点（api-contract.md 第 4 节）----------------


@router.post("", status_code=201)
def create_conversation(payload: CreateConversationRequest, request: Request):
    if payload.scene != "meditation":  # 播客场景二期（scene=podcast）
        raise invalid("SCENE_INVALID", "暂不支持该会话场景")
    title = payload.title.strip() if payload.title else None
    return _repo(request).create_conversation(payload.scene, title)


@router.get("")
def list_conversations(
    request: Request,
    scene: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
):
    return {"items": _repo(request).list_conversations(scene=scene, limit=limit)}


@router.get("/{conversation_id}")
def get_conversation_detail(conversation_id: str, request: Request):
    conversation = _get_conversation(request, conversation_id)
    manager = request.app.state.runs
    repo = _repo(request)
    return {
        "conversation": conversation,
        "script_draft": repo.get_script_draft(conversation_id),
        "script_artifact": repo.get_script_artifact(conversation_id),
        "has_unsaved_changes": repo.script_draft_has_unsaved_changes(conversation_id),
        "active_run_id": manager.active_run_id_for_conversation(conversation_id),
    }


@router.patch("/{conversation_id}")
def rename_conversation(
    conversation_id: str, payload: RenameConversationRequest, request: Request
):
    _get_conversation(request, conversation_id)
    return _repo(request).rename_conversation(conversation_id, payload.title.strip())


@router.get("/{conversation_id}/messages")
def list_messages(
    conversation_id: str,
    request: Request,
    before: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    _get_conversation(request, conversation_id)
    try:
        items, has_more = _repo(request).list_messages(
            conversation_id, before=before, limit=limit
        )
    except NotFoundError:
        raise not_found("MESSAGE_NOT_FOUND", "消息不存在") from None
    return {"items": items, "has_more": has_more}


@router.post("/{conversation_id}/messages", status_code=202)
async def send_message(
    conversation_id: str, payload: SendMessageRequest, request: Request
):
    _get_conversation(request, conversation_id)
    text = payload.text
    if not text.strip() or len(text) > MAX_TEXT_LENGTH:
        raise invalid("SCRIPT_TEXT_INVALID", "消息文本为空或超出长度限制")
    _validate_script_params(
        _registry(request), request.app.state.settings, payload.duration, payload.model
    )
    manager = request.app.state.runs
    if manager.active_run_id_for_conversation(conversation_id):
        raise conflict("CONVERSATION_RUN_ACTIVE", "该会话已有正在进行的生成任务")

    repo = _repo(request)
    draft = repo.get_script_draft(conversation_id)
    if (
        draft
        and draft["origin"] in ("manual", "restored")
        and repo.script_draft_has_unsaved_changes(conversation_id)
        and not payload.allow_draft_overwrite
    ):
        raise conflict(
            "SCRIPT_DRAFT_OVERWRITE_CONFIRM_REQUIRED",
            "当前草稿包含未保存的人工修改，请确认后继续生成",
        )
    repo.insert_message(
        conversation_id,
        "user",
        text,
        params={"duration": payload.duration, "model": payload.model},
    )
    repo.touch_conversation(conversation_id)
    run = await manager.enqueue("script", conversation_id=conversation_id)
    return manager.run_payload(run)


@router.post("/{conversation_id}/messages/{message_id}/retry", status_code=202)
async def retry_message(
    conversation_id: str,
    message_id: str,
    request: Request,
    allow_draft_overwrite: bool = Query(default=False),
):
    _get_conversation(request, conversation_id)
    repo = _repo(request)
    try:
        message = repo.get_message(message_id)
    except NotFoundError:
        raise not_found("MESSAGE_NOT_FOUND", "消息不存在") from None
    if message["conversation_id"] != conversation_id or message["role"] != "user":
        raise not_found("MESSAGE_NOT_FOUND", "消息不存在")
    # 仅允许对最后一条用户消息重试（失败 run 不落 assistant 消息，锚点即该消息；
    # 成功后重试 = 以同一指令重新生成）
    last_user_id = next(
        (
            item["id"]
            for item in reversed(
                repo.list_messages(conversation_id, limit=500)[0]
            )
            if item["role"] == "user"
        ),
        None,
    )
    if last_user_id != message_id:
        raise conflict("MESSAGE_NOT_RETRYABLE", "只能重试最近一条用户消息")

    manager = request.app.state.runs
    if manager.active_run_id_for_conversation(conversation_id):
        raise conflict("CONVERSATION_RUN_ACTIVE", "该会话已有正在进行的生成任务")
    draft = repo.get_script_draft(conversation_id)
    if (
        draft
        and draft["origin"] in ("manual", "restored")
        and repo.script_draft_has_unsaved_changes(conversation_id)
        and not allow_draft_overwrite
    ):
        raise conflict(
            "SCRIPT_DRAFT_OVERWRITE_CONFIRM_REQUIRED",
            "当前草稿包含未保存的人工修改，请确认后继续生成",
        )
    run = await manager.enqueue("script", conversation_id=conversation_id)
    return manager.run_payload(run)


@router.get("/{conversation_id}/models")
def list_models(conversation_id: str, request: Request):
    _get_conversation(request, conversation_id)
    return {"models": _registry(request).list_models()}


@router.patch("/{conversation_id}/script-draft")
def update_script_draft(
    conversation_id: str, payload: UpdateScriptDraftRequest, request: Request
):
    _get_conversation(request, conversation_id)
    text = payload.text.strip()
    if not text or len(text) > MAX_TEXT_LENGTH:
        raise invalid("SCRIPT_TEXT_INVALID", "脚本文本为空或超出长度限制")
    repo = _repo(request)
    current = repo.get_script_draft(conversation_id)
    if current is None:
        raise not_found("SCRIPT_DRAFT_NOT_FOUND", "脚本草稿不存在")
    parsed = parse_script(text)
    try:
        return repo.upsert_script_draft(
            conversation_id,
            source_run_id=current["source_run_id"],
            params=current["params"],
            content={"text": text, **parsed.as_content()},
            origin="manual",
            expected_revision=payload.expected_revision,
        )
    except RevisionConflictError:
        raise conflict("SCRIPT_DRAFT_REVISION_CONFLICT", "草稿已在其他位置更新") from None


@router.post("/{conversation_id}/script-versions", status_code=201)
def save_script_version(
    conversation_id: str, payload: SaveScriptVersionRequest, request: Request
):
    _get_conversation(request, conversation_id)
    repo = _repo(request)
    artifact = repo.get_script_artifact(conversation_id)
    name = payload.name.strip() if payload.name else None
    if artifact is None and not name:
        raise invalid("SCRIPT_NAME_REQUIRED", "首次保存必须输入脚本名称")
    try:
        saved_artifact, version = repo.save_script_version(
            conversation_id,
            expected_revision=payload.expected_revision,
            name=name,
        )
    except NotFoundError:
        raise not_found("SCRIPT_DRAFT_NOT_FOUND", "脚本草稿不存在") from None
    except DuplicateVersionError:
        raise conflict("SCRIPT_VERSION_UNCHANGED", "草稿与当前版本相同") from None
    except RevisionConflictError:
        raise conflict("SCRIPT_DRAFT_REVISION_CONFLICT", "草稿已在其他位置更新") from None
    return {"artifact": saved_artifact, "version": version}


# ---------------- script run handler ----------------


def make_script_handler(
    repo: Repository, settings: Settings, registry: ModelRegistry
):
    """构造 script 线 run handler（main.py lifespan 注册）。"""

    async def handle(ctx: RunContext) -> str:
        run = repo.get_run(ctx.run_id)
        conversation_id = run["conversation_id"]
        conversation = repo.get_conversation(conversation_id)
        messages, _ = repo.list_messages(conversation_id, limit=500)

        last_user = next(
            (m for m in reversed(messages) if m["role"] == "user"), None
        )
        if last_user is None:
            raise invalid("SCRIPT_TEXT_INVALID", "没有可生成的用户消息")
        history = messages[: messages.index(last_user)]
        params = last_user["params"] or {}
        duration = params.get("duration", 15)
        model = params.get("model", "deepseek-chat")

        llm_messages = _assemble_llm_messages(history, last_user["content"], duration)

        chunks: list[str] = []
        if settings.fake_mode:
            fake_text, matched_topic = generate_fake_script(
                last_user["content"], duration
            )
            async for delta in _fake_stream(fake_text):
                ctx.check_cancelled()
                await ctx.emit("assistant.delta", {"delta": delta})
                chunks.append(delta)
            topic = matched_topic
        else:
            async for delta in registry.stream_chat(model, llm_messages):
                ctx.check_cancelled()
                await ctx.emit("assistant.delta", {"delta": delta})
                chunks.append(delta)
            topic = last_user["content"].strip()[:50] or "冥想引导"

        script_text = "".join(chunks).strip()
        if not script_text:
            raise ApiError("SCRIPT_LLM_ERROR", "模型返回内容为空，请重试", 502)

        # 消息定稿（失败/取消不会走到这里——临时内容丢弃）
        message = repo.insert_message(conversation_id, "assistant", script_text)
        repo.touch_conversation(conversation_id)
        await ctx.emit("message.completed", {"message": _message_payload(message)})

        # 生成成功只更新工作草稿；正式版本仅由用户手动保存。
        parsed = parse_script(script_text)
        draft = repo.upsert_script_draft(
            conversation["id"],
            source_run_id=ctx.run_id,
            params={
                "topic": topic,
                "matched_topic": topic,
                "duration": duration,
                "model": model,
            },
            content={"text": script_text, **parsed.as_content()},
            origin="generated",
        )
        await ctx.emit(
            "script.draft.updated",
            {"draft": draft},
        )
        return None

    return handle


def _assemble_llm_messages(
    history: list[dict[str, Any]], text: str, duration: int
) -> list[dict[str, str]]:
    """多轮 refinement：历史消息入上下文（预算内截断）。"""
    trimmed: list[dict[str, str]] = []
    budget = CONTEXT_CHAR_BUDGET
    for message in reversed(history[-CONTEXT_MESSAGE_LIMIT:]):
        content = message["content"]
        if len(content) > budget:
            break
        budget -= len(content)
        trimmed.insert(0, {"role": message["role"], "content": content})

    system_content = SYSTEM_PROMPT
    if trimmed:
        system_content = f"{SYSTEM_PROMPT}\n\n{REFINEMENT_GUIDE}"
    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    messages.extend(trimmed)
    messages.append({"role": "user", "content": build_user_prompt(text, duration)})
    return messages


async def _fake_stream(text: str):
    """FAKE_MODE 伪流式：分片 yield，间隔便于观察增量与取消。"""
    for index in range(0, len(text), FAKE_CHUNK_SIZE):
        await asyncio.sleep(FAKE_CHUNK_INTERVAL)
        yield text[index : index + FAKE_CHUNK_SIZE]
