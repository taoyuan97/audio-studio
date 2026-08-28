"""SQLite 数据层：核心 DDL 与仓储方法（docs/tech/data-model.md 单一事实源）。

- sqlite3 同步连接（每次操作短连接，WAL 模式），本地单机场景足够。
- 时间戳统一 Unix 毫秒整数；ID 格式 {prefix}_{unix_ms}_{6位随机}。
- JSON 字段以 TEXT 存储，读写时序列化/反序列化。
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  scene       TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '未命名冥想',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_scene ON conversations(scene, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  content          TEXT NOT NULL,
  params_json      TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS message_attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  size        INTEGER NOT NULL,
  content     TEXT NOT NULL,
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments(message_id, position ASC);

CREATE TABLE IF NOT EXISTS runs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  status           TEXT NOT NULL,
  progress_json    TEXT,
  result_json      TEXT,
  error_code       TEXT,
  error_message    TEXT,
  artifact_id      TEXT,
  created_at       INTEGER NOT NULL,
  started_at       INTEGER,
  finished_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at ASC);

CREATE TABLE IF NOT EXISTS artifacts (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  name             TEXT NOT NULL,
  conversation_id  TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  source_run_id    TEXT,
  params_json      TEXT NOT NULL,
  content_json     TEXT,
  audio_path       TEXT,
  audio_format     TEXT,
  duration         REAL,
  current_version_id TEXT,
  current_version_no INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type, created_at DESC);

CREATE TABLE IF NOT EXISTS script_drafts (
  conversation_id  TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  source_run_id    TEXT,
  params_json      TEXT NOT NULL,
  content_json     TEXT NOT NULL,
  origin           TEXT NOT NULL,
  revision         INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifact_versions (
  id               TEXT PRIMARY KEY,
  artifact_id      TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_no       INTEGER NOT NULL,
  source_run_id    TEXT,
  params_json      TEXT NOT NULL,
  content_json     TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  UNIQUE(artifact_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact
  ON artifact_versions(artifact_id, version_no DESC);
"""

RUN_ACTIVE_STATUSES = ("queued", "running")
RUN_TERMINAL_STATUSES = ("completed", "failed", "cancelled")


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str) -> str:
    return f"{prefix}_{now_ms()}_{secrets.token_hex(3)}"


def _loads(value: str | None) -> Any:
    return json.loads(value) if value else None


class NotFoundError(LookupError):
    """行不存在（调用方映射为 404）。"""


class RevisionConflictError(RuntimeError):
    """工作草稿 revision 与客户端期望不一致。"""


class DuplicateVersionError(RuntimeError):
    """工作草稿与当前正式版本完全一致。"""


class Repository:
    def __init__(self, path: Path | str):
        self.path = Path(path)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
            self._migrate_artifact_version_columns(connection)
            self._migrate_existing_script_versions(connection)

    @staticmethod
    def _migrate_artifact_version_columns(connection: sqlite3.Connection) -> None:
        """为旧数据库幂等补齐 artifact 当前版本字段。"""
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(artifacts)")
        }
        if "current_version_id" not in columns:
            connection.execute("ALTER TABLE artifacts ADD COLUMN current_version_id TEXT")
        if "current_version_no" not in columns:
            connection.execute("ALTER TABLE artifacts ADD COLUMN current_version_no INTEGER")

    @staticmethod
    def _migrate_existing_script_versions(connection: sqlite3.Connection) -> None:
        """现有脚本 artifact 幂等迁移为 v1，并回填当前版本指针。"""
        rows = connection.execute(
            """SELECT * FROM artifacts
               WHERE type LIKE 'script%' AND content_json IS NOT NULL"""
        ).fetchall()
        for row in rows:
            latest = connection.execute(
                """SELECT id, version_no FROM artifact_versions
                   WHERE artifact_id=? ORDER BY version_no DESC LIMIT 1""",
                (row["id"],),
            ).fetchone()
            if latest is None:
                version_id = new_id("ver")
                connection.execute(
                    """INSERT INTO artifact_versions
                       (id, artifact_id, version_no, source_run_id, params_json,
                        content_json, created_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (
                        version_id,
                        row["id"],
                        1,
                        row["source_run_id"],
                        row["params_json"],
                        row["content_json"],
                        row["created_at"],
                    ),
                )
                latest = {"id": version_id, "version_no": 1}
            if (
                row["current_version_id"] != latest["id"]
                or row["current_version_no"] != latest["version_no"]
            ):
                connection.execute(
                    """UPDATE artifacts
                       SET current_version_id=?, current_version_no=? WHERE id=?""",
                    (latest["id"], latest["version_no"], row["id"]),
                )
            if row["conversation_id"] is not None:
                connection.execute(
                    """INSERT OR IGNORE INTO script_drafts
                       (conversation_id, source_run_id, params_json, content_json,
                        origin, revision, updated_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (
                        row["conversation_id"],
                        row["source_run_id"],
                        row["params_json"],
                        row["content_json"],
                        "generated",
                        1,
                        row["updated_at"],
                    ),
                )

    def recover_stale_runs(self) -> int:
        """服务启动时把遗留 queued/running run 标记为 failed（RUN_INTERRUPTED）。"""
        with self.transaction() as connection:
            cursor = connection.execute(
                """UPDATE runs
                   SET status='failed', finished_at=?, error_code='RUN_INTERRUPTED',
                       error_message='服务重启中断，请重新提交'
                   WHERE status IN ('queued','running')""",
                (now_ms(),),
            )
            return cursor.rowcount

    # ---------------- conversations ----------------

    def create_conversation(self, scene: str, title: str | None = None) -> dict[str, Any]:
        conversation_id = new_id("conv")
        timestamp = now_ms()
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO conversations (id, scene, title, created_at, updated_at)
                   VALUES (?,?,?,?,?)""",
                (conversation_id, scene, title or "未命名冥想", timestamp, timestamp),
            )
        return self.get_conversation(conversation_id)

    def get_conversation(self, conversation_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM conversations WHERE id=?", (conversation_id,)
            ).fetchone()
        if row is None:
            raise NotFoundError("会话不存在")
        return dict(row)

    def list_conversations(
        self, *, scene: str | None = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        where_clause = ""
        params: list[Any] = []
        if scene:
            where_clause = "WHERE scene=?"
            params.append(scene)
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(
                f"""SELECT * FROM conversations {where_clause}
                    ORDER BY updated_at DESC, id DESC LIMIT ?""",
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def rename_conversation(self, conversation_id: str, title: str) -> dict[str, Any]:
        with self.transaction() as connection:
            cursor = connection.execute(
                "UPDATE conversations SET title=?, updated_at=? WHERE id=?",
                (title, now_ms(), conversation_id),
            )
            if cursor.rowcount == 0:
                raise NotFoundError("会话不存在")
        return self.get_conversation(conversation_id)

    def touch_conversation(self, conversation_id: str) -> None:
        """更新会话 updated_at（新消息写入时联动，驱动列表排序）。"""
        with self.transaction() as connection:
            connection.execute(
                "UPDATE conversations SET updated_at=? WHERE id=?",
                (now_ms(), conversation_id),
            )

    # ---------------- messages ----------------

    def insert_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        params: dict[str, Any] | None = None,
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        message_id = new_id("msg")
        created_at = now_ms()
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO messages (id, conversation_id, role, content, params_json, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (
                    message_id,
                    conversation_id,
                    role,
                    content,
                    json.dumps(params, ensure_ascii=False) if params is not None else None,
                    created_at,
                ),
            )
            for position, attachment in enumerate(attachments or []):
                connection.execute(
                    """INSERT INTO message_attachments
                       (id, message_id, name, media_type, size, content, position, created_at)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (
                        new_id("att"),
                        message_id,
                        attachment["name"],
                        attachment["media_type"],
                        attachment["size"],
                        attachment["content"],
                        position,
                        created_at,
                    ),
                )
        return self.get_message(message_id)

    def get_message(
        self, message_id: str, *, include_attachment_content: bool = False
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM messages WHERE id=?", (message_id,)
            ).fetchone()
            attachments = self._attachments_by_message(
                connection, [message_id], include_content=include_attachment_content
            )
        if row is None:
            raise NotFoundError("消息不存在")
        return self._message_dict(row, attachments.get(message_id, []))

    def list_messages(
        self,
        conversation_id: str,
        *,
        before: str | None = None,
        limit: int = 50,
        include_attachment_content: bool = False,
    ) -> tuple[list[dict[str, Any]], bool]:
        """游标分页（api-contract.md 2.3）：时间正序返回，has_more 表示还有更早消息。

        before 为上一页最后一条消息 id；无则从最新往回取 limit 条。
        """
        where = "conversation_id=?"
        params: list[Any] = [conversation_id]
        if before:
            anchor = self.get_message(before)
            if anchor["conversation_id"] != conversation_id:
                raise NotFoundError("消息不存在")
            where += " AND (created_at < ? OR (created_at = ? AND id < ?))"
            params.extend(
                [anchor["created_at"], anchor["created_at"], anchor["id"]]
            )
        # 从新到旧取 limit+1 条，再反转为正序
        with self.connect() as connection:
            rows = connection.execute(
                f"""SELECT * FROM messages WHERE {where}
                    ORDER BY created_at DESC, id DESC LIMIT ?""",
                [*params, limit + 1],
            ).fetchall()
            page_rows = rows[:limit]
            attachments = self._attachments_by_message(
                connection,
                [row["id"] for row in page_rows],
                include_content=include_attachment_content,
            )
        has_more = len(rows) > limit
        items = [
            self._message_dict(row, attachments.get(row["id"], []))
            for row in reversed(page_rows)
        ]
        return items, has_more

    @staticmethod
    def _message_dict(
        row: sqlite3.Row, attachments: list[dict[str, Any]] | None = None
    ) -> dict[str, Any]:
        return {
            "id": row["id"],
            "conversation_id": row["conversation_id"],
            "role": row["role"],
            "content": row["content"],
            "params": _loads(row["params_json"]),
            "attachments": attachments or [],
            "created_at": row["created_at"],
        }

    @staticmethod
    def _attachments_by_message(
        connection: sqlite3.Connection,
        message_ids: list[str],
        *,
        include_content: bool,
    ) -> dict[str, list[dict[str, Any]]]:
        if not message_ids:
            return {}
        placeholders = ",".join("?" for _ in message_ids)
        content_column = ", content" if include_content else ""
        rows = connection.execute(
            f"""SELECT id, message_id, name, media_type, size{content_column}
                FROM message_attachments
                WHERE message_id IN ({placeholders})
                ORDER BY position ASC, id ASC""",
            message_ids,
        ).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            item = {
                "id": row["id"],
                "name": row["name"],
                "media_type": row["media_type"],
                "size": row["size"],
            }
            if include_content:
                item["content"] = row["content"]
            grouped.setdefault(row["message_id"], []).append(item)
        return grouped

    # ---------------- runs ----------------

    def create_run(
        self,
        kind: str,
        conversation_id: str | None = None,
        *,
        result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        run_id = new_id("run")
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO runs
                   (id, kind, conversation_id, status, result_json, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (
                    run_id,
                    kind,
                    conversation_id,
                    "queued",
                    json.dumps(result, ensure_ascii=False) if result is not None else None,
                    now_ms(),
                ),
            )
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        if row is None:
            raise NotFoundError("运行不存在")
        return self._run_dict(row)

    def count_queued_runs(self) -> int:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS value FROM runs WHERE status='queued'"
            ).fetchone()
        return int(row["value"])

    def queue_position(self, run_id: str) -> int:
        """该 run 前面还有几个 queued run（含自身为 0 表示即将执行）。"""
        run = self.get_run(run_id)
        if run["status"] != "queued":
            return 0
        with self.connect() as connection:
            row = connection.execute(
                """SELECT COUNT(*) AS value FROM runs
                   WHERE status='queued' AND created_at < ?""",
                (run["created_at"],),
            ).fetchone()
        return int(row["value"])

    def mark_run_running(self, run_id: str) -> bool:
        with self.transaction() as connection:
            cursor = connection.execute(
                "UPDATE runs SET status='running', started_at=? WHERE id=? AND status='queued'",
                (now_ms(), run_id),
            )
            return cursor.rowcount > 0

    def set_run_progress(self, run_id: str, progress: dict[str, Any]) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE runs SET progress_json=? WHERE id=?",
                (json.dumps(progress, ensure_ascii=False), run_id),
            )

    def set_run_result(self, run_id: str, result: dict[str, Any]) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE runs SET result_json=? WHERE id=?",
                (json.dumps(result, ensure_ascii=False), run_id),
            )

    def finish_run(
        self,
        run_id: str,
        status: str,
        *,
        artifact_id: str | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
    ) -> bool:
        """终态迁移（幂等守护：仅 queued/running 可迁移），返回是否发生迁移。"""
        if status not in RUN_TERMINAL_STATUSES:
            raise ValueError(f"非法终态: {status}")
        with self.transaction() as connection:
            cursor = connection.execute(
                """UPDATE runs
                   SET status=?, finished_at=?, artifact_id=?, error_code=?, error_message=?
                   WHERE id=? AND status IN ('queued','running')""",
                (status, now_ms(), artifact_id, error_code, error_message, run_id),
            )
            return cursor.rowcount > 0

    def list_active_runs(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT id, kind, status FROM runs
                   WHERE status IN ('queued','running') ORDER BY created_at ASC"""
            ).fetchall()
        return [dict(row) for row in rows]

    def active_run_for_conversation(self, conversation_id: str) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT id FROM runs
                   WHERE conversation_id=? AND status IN ('queued','running')
                   ORDER BY created_at DESC LIMIT 1""",
                (conversation_id,),
            ).fetchone()
        return row["id"] if row else None

    def active_run_for_request(self, kind: str, request_payload: dict[str, Any]) -> str | None:
        """查找同类、同请求快照的活动任务，避免重复计费提交。"""
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT id, result_json FROM runs
                   WHERE kind=? AND status IN ('queued','running')
                   ORDER BY created_at DESC""",
                (kind,),
            ).fetchall()
        for row in rows:
            if (_loads(row["result_json"]) or {}).get("request") == request_payload:
                return row["id"]
        return None

    @staticmethod
    def _run_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "kind": row["kind"],
            "conversation_id": row["conversation_id"],
            "status": row["status"],
            "progress": _loads(row["progress_json"]),
            "result": _loads(row["result_json"]),
            "error_code": row["error_code"],
            "error_message": row["error_message"],
            "artifact_id": row["artifact_id"],
            "created_at": row["created_at"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
        }

    # ---------------- script drafts ----------------

    def get_script_draft(self, conversation_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM script_drafts WHERE conversation_id=?",
                (conversation_id,),
            ).fetchone()
        return self._script_draft_dict(row) if row else None

    def script_draft_has_unsaved_changes(self, conversation_id: str) -> bool:
        with self.connect() as connection:
            draft = connection.execute(
                "SELECT params_json, content_json FROM script_drafts WHERE conversation_id=?",
                (conversation_id,),
            ).fetchone()
            if draft is None:
                return False
            artifact = connection.execute(
                """SELECT params_json, content_json FROM artifacts
                   WHERE conversation_id=? AND type='script_meditation'
                   ORDER BY created_at DESC LIMIT 1""",
                (conversation_id,),
            ).fetchone()
        return artifact is None or (
            artifact["content_json"] != draft["content_json"]
            or artifact["params_json"] != draft["params_json"]
        )

    def upsert_script_draft(
        self,
        conversation_id: str,
        *,
        source_run_id: str | None,
        params: dict[str, Any],
        content: dict[str, Any],
        origin: str,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        timestamp = now_ms()
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT revision FROM script_drafts WHERE conversation_id=?",
                (conversation_id,),
            ).fetchone()
            current_revision = int(row["revision"]) if row else 0
            if expected_revision is not None and expected_revision != current_revision:
                raise RevisionConflictError
            next_revision = current_revision + 1
            connection.execute(
                """INSERT INTO script_drafts
                   (conversation_id, source_run_id, params_json, content_json,
                    origin, revision, updated_at)
                   VALUES (?,?,?,?,?,?,?)
                   ON CONFLICT(conversation_id) DO UPDATE SET
                     source_run_id=excluded.source_run_id,
                     params_json=excluded.params_json,
                     content_json=excluded.content_json,
                     origin=excluded.origin,
                     revision=excluded.revision,
                     updated_at=excluded.updated_at""",
                (
                    conversation_id,
                    source_run_id,
                    json.dumps(params, ensure_ascii=False),
                    json.dumps(content, ensure_ascii=False),
                    origin,
                    next_revision,
                    timestamp,
                ),
            )
        return self.get_script_draft(conversation_id)  # type: ignore[return-value]

    def save_script_version(
        self,
        conversation_id: str,
        *,
        expected_revision: int,
        name: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """把当前草稿追加为不可变版本，并原子更新 artifact 当前快照。"""
        timestamp = now_ms()
        with self.transaction() as connection:
            draft = connection.execute(
                "SELECT * FROM script_drafts WHERE conversation_id=?",
                (conversation_id,),
            ).fetchone()
            if draft is None:
                raise NotFoundError("脚本草稿不存在")
            if int(draft["revision"]) != expected_revision:
                raise RevisionConflictError

            artifact = connection.execute(
                """SELECT * FROM artifacts
                   WHERE conversation_id=? AND type='script_meditation'
                   ORDER BY created_at DESC LIMIT 1""",
                (conversation_id,),
            ).fetchone()

            if artifact is None:
                if not name:
                    raise ValueError("首次保存必须输入脚本名称")
                artifact_id = new_id("art")
                connection.execute(
                    """INSERT INTO artifacts
                       (id, type, name, conversation_id, source_run_id, params_json,
                        content_json, audio_path, audio_format, duration,
                        current_version_id, current_version_no, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        artifact_id,
                        "script_meditation",
                        name,
                        conversation_id,
                        draft["source_run_id"],
                        draft["params_json"],
                        draft["content_json"],
                        None,
                        None,
                        _loads(draft["content_json"])["est_duration"],
                        None,
                        None,
                        timestamp,
                        timestamp,
                    ),
                )
                version_no = 1
            else:
                artifact_id = artifact["id"]
                if (
                    artifact["content_json"] == draft["content_json"]
                    and artifact["params_json"] == draft["params_json"]
                ):
                    raise DuplicateVersionError
                version_no = int(artifact["current_version_no"] or 0) + 1

            version_id = new_id("ver")
            connection.execute(
                """INSERT INTO artifact_versions
                   (id, artifact_id, version_no, source_run_id, params_json,
                    content_json, created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (
                    version_id,
                    artifact_id,
                    version_no,
                    draft["source_run_id"],
                    draft["params_json"],
                    draft["content_json"],
                    timestamp,
                ),
            )
            content = _loads(draft["content_json"])
            connection.execute(
                """UPDATE artifacts SET source_run_id=?, params_json=?, content_json=?,
                   duration=?, current_version_id=?, current_version_no=?, updated_at=?
                   WHERE id=?""",
                (
                    draft["source_run_id"],
                    draft["params_json"],
                    draft["content_json"],
                    content["est_duration"],
                    version_id,
                    version_no,
                    timestamp,
                    artifact_id,
                ),
            )

        return self.get_artifact(artifact_id), self.get_artifact_version(
            artifact_id, version_id
        )

    def list_artifact_versions(self, artifact_id: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT * FROM artifact_versions WHERE artifact_id=?
                   ORDER BY version_no DESC""",
                (artifact_id,),
            ).fetchall()
        return [self._artifact_version_dict(row) for row in rows]

    def get_artifact_version(
        self, artifact_id: str, version_id: str
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT * FROM artifact_versions WHERE id=? AND artifact_id=?""",
                (version_id, artifact_id),
            ).fetchone()
        if row is None:
            raise NotFoundError("脚本版本不存在")
        return self._artifact_version_dict(row)

    def restore_artifact_version_to_draft(
        self,
        artifact_id: str,
        version_id: str,
        *,
        expected_revision: int,
    ) -> dict[str, Any]:
        artifact = self.get_artifact(artifact_id)
        if not artifact["conversation_id"]:
            raise NotFoundError("脚本会话不存在")
        version = self.get_artifact_version(artifact_id, version_id)
        return self.upsert_script_draft(
            artifact["conversation_id"],
            source_run_id=version["source_run_id"],
            params=version["params"],
            content=version["content"],
            origin="restored",
            expected_revision=expected_revision,
        )

    @staticmethod
    def _script_draft_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "conversation_id": row["conversation_id"],
            "source_run_id": row["source_run_id"],
            "params": _loads(row["params_json"]),
            "content": _loads(row["content_json"]),
            "origin": row["origin"],
            "revision": row["revision"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    def _artifact_version_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "artifact_id": row["artifact_id"],
            "version_no": row["version_no"],
            "source_run_id": row["source_run_id"],
            "params": _loads(row["params_json"]),
            "content": _loads(row["content_json"]),
            "created_at": row["created_at"],
        }

    # ---------------- artifacts ----------------

    def insert_artifact(
        self,
        *,
        artifact_id: str | None = None,
        type: str,
        name: str,
        conversation_id: str | None = None,
        source_run_id: str | None = None,
        params: dict[str, Any],
        content: dict[str, Any] | None = None,
        audio_path: str | None = None,
        audio_format: str | None = None,
        duration: float | None = None,
    ) -> dict[str, Any]:
        artifact_id = artifact_id or new_id("art")
        timestamp = now_ms()
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO artifacts
                   (id, type, name, conversation_id, source_run_id, params_json,
                    content_json, audio_path, audio_format, duration, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    artifact_id,
                    type,
                    name,
                    conversation_id,
                    source_run_id,
                    json.dumps(params, ensure_ascii=False),
                    json.dumps(content, ensure_ascii=False) if content is not None else None,
                    audio_path,
                    audio_format,
                    duration,
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_artifact(artifact_id)

    def get_artifact(self, artifact_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM artifacts WHERE id=?", (artifact_id,)
            ).fetchone()
        if row is None:
            raise NotFoundError("产物不存在")
        return self._artifact_dict(row)

    def list_artifacts(
        self, *, type: str | None = None, limit: int = 200
    ) -> list[dict[str, Any]]:
        params: list[Any] = []
        where_clause = ""
        if type:
            where_clause = "WHERE type=?"
            params.append(type)
        params.append(limit)
        with self.connect() as connection:
            rows = connection.execute(
                f"""SELECT * FROM artifacts {where_clause}
                    ORDER BY created_at DESC LIMIT ?""",
                params,
            ).fetchall()
        return [self._artifact_dict(row) for row in rows]

    def get_script_artifact(self, conversation_id: str) -> dict[str, Any] | None:
        """会话 1:1 脚本产物（未生成过为 None）。"""
        with self.connect() as connection:
            row = connection.execute(
                """SELECT * FROM artifacts
                   WHERE conversation_id=? AND type LIKE 'script%'
                   ORDER BY created_at DESC LIMIT 1""",
                (conversation_id,),
            ).fetchone()
        return self._artifact_dict(row) if row else None

    def update_artifact(
        self,
        artifact_id: str,
        *,
        name: str | None = None,
        content: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        duration: float | None = None,
    ) -> dict[str, Any]:
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM artifacts WHERE id=?", (artifact_id,)
            ).fetchone()
            if row is None:
                raise NotFoundError("产物不存在")
            if name is not None:
                connection.execute(
                    "UPDATE artifacts SET name=?, updated_at=? WHERE id=?",
                    (name, now_ms(), artifact_id),
                )
            if content is not None:
                connection.execute(
                    "UPDATE artifacts SET content_json=?, updated_at=? WHERE id=?",
                    (json.dumps(content, ensure_ascii=False), now_ms(), artifact_id),
                )
            if params is not None:
                connection.execute(
                    "UPDATE artifacts SET params_json=?, updated_at=? WHERE id=?",
                    (json.dumps(params, ensure_ascii=False), now_ms(), artifact_id),
                )
            if duration is not None:
                connection.execute(
                    "UPDATE artifacts SET duration=?, updated_at=? WHERE id=?",
                    (duration, now_ms(), artifact_id),
                )
        return self.get_artifact(artifact_id)

    def update_artifact_audio_path(
        self, artifact_id: str, audio_path: str, *, duration: float | None = None
    ) -> None:
        """音频文件落盘成功后回填路径（保证 audio_path 指向的文件必存在）。"""
        with self.transaction() as connection:
            connection.execute(
                "UPDATE artifacts SET audio_path=?, duration=COALESCE(?, duration), updated_at=? WHERE id=?",
                (audio_path, duration, now_ms(), artifact_id),
            )

    def delete_artifact(self, artifact_id: str) -> bool:
        with self.transaction() as connection:
            cursor = connection.execute(
                "DELETE FROM artifacts WHERE id=?", (artifact_id,)
            )
            return cursor.rowcount > 0

    @staticmethod
    def _artifact_dict(row: sqlite3.Row) -> dict[str, Any]:
        item = {
            "id": row["id"],
            "type": row["type"],
            "name": row["name"],
            "conversation_id": row["conversation_id"],
            "source_run_id": row["source_run_id"],
            "params": _loads(row["params_json"]) or {},
            "content": _loads(row["content_json"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "current_version_id": row["current_version_id"],
            "current_version_no": row["current_version_no"],
        }
        if row["audio_path"]:
            item["audio"] = {
                "format": row["audio_format"],
                "duration": row["duration"],
                "url": f"/api/artifacts/{row['id']}/audio",
                "peaks_url": f"/api/artifacts/{row['id']}/peaks",
            }
        else:
            item["audio"] = None
        return item

    # ---------------- stats ----------------

    def get_stats(self) -> dict[str, Any]:
        with self.connect() as connection:
            counts = {
                row["type"]: row["value"]
                for row in connection.execute(
                    "SELECT type, COUNT(*) AS value FROM artifacts GROUP BY type"
                ).fetchall()
            }
            conversation_count = connection.execute(
                "SELECT COUNT(*) AS value FROM conversations"
            ).fetchone()["value"]
            recent = connection.execute(
                "SELECT id, type, name, created_at FROM artifacts ORDER BY created_at DESC LIMIT 5"
            ).fetchall()
        return {
            "artifact_counts": counts,
            "conversation_count": int(conversation_count),
            "recent_artifacts": [dict(row) for row in recent],
        }
