"""SQLite-backed user store.

Kept in a SEPARATE file from the trade DuckDB so it survives the periodic
`rebuild_all` that recreates trade_database.duckdb. SQLite is a better fit than
DuckDB for a small, mutable, transactional user table.
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

_lock = threading.Lock()
_db_path: Optional[Path] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(db_path: Path) -> None:
    """Create the users table if it doesn't exist. Idempotent."""
    global _db_path
    _db_path = Path(db_path)
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                email                TEXT UNIQUE NOT NULL,
                name                 TEXT NOT NULL,
                password_hash        TEXT NOT NULL,
                role                 TEXT NOT NULL DEFAULT 'user',
                is_active            INTEGER NOT NULL DEFAULT 1,
                must_change_password INTEGER NOT NULL DEFAULT 1,
                created_at           TEXT NOT NULL,
                last_login           TEXT
            )
            """
        )
        con.commit()


def _connect() -> sqlite3.Connection:
    if _db_path is None:
        raise RuntimeError("auth store not initialised — call store.init(path)")
    con = sqlite3.connect(str(_db_path))
    con.row_factory = sqlite3.Row
    return con


def _row_to_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    d["is_active"] = bool(d["is_active"])
    d["must_change_password"] = bool(d["must_change_password"])
    return d


def count_users() -> int:
    with _connect() as con:
        return int(con.execute("SELECT COUNT(*) FROM users").fetchone()[0])


def get_by_email(email: str) -> Optional[dict]:
    with _connect() as con:
        r = con.execute(
            "SELECT * FROM users WHERE lower(email) = lower(?)", (email.strip(),)
        ).fetchone()
        return _row_to_dict(r) if r else None


def get_by_id(user_id: int) -> Optional[dict]:
    with _connect() as con:
        r = con.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _row_to_dict(r) if r else None


def list_users() -> list[dict]:
    with _connect() as con:
        rows = con.execute("SELECT * FROM users ORDER BY created_at").fetchall()
        return [_row_to_dict(r) for r in rows]


def create_user(*, email: str, name: str, password_hash: str, role: str,
                must_change_password: bool = True) -> dict:
    with _lock, _connect() as con:
        cur = con.execute(
            """INSERT INTO users
               (email, name, password_hash, role, is_active, must_change_password, created_at)
               VALUES (?, ?, ?, ?, 1, ?, ?)""",
            (email.strip(), name.strip(), password_hash, role,
             1 if must_change_password else 0, _now()),
        )
        con.commit()
        return get_by_id(cur.lastrowid)


def update_user(user_id: int, **fields) -> Optional[dict]:
    allowed = {"name", "role", "is_active", "password_hash", "must_change_password"}
    sets, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in ("is_active", "must_change_password"):
            v = 1 if v else 0
        sets.append(f"{k} = ?")
        vals.append(v)
    if not sets:
        return get_by_id(user_id)
    vals.append(user_id)
    with _lock, _connect() as con:
        con.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", vals)
        con.commit()
    return get_by_id(user_id)


def touch_last_login(user_id: int) -> None:
    with _lock, _connect() as con:
        con.execute("UPDATE users SET last_login = ? WHERE id = ?", (_now(), user_id))
        con.commit()


def delete_user(user_id: int) -> None:
    with _lock, _connect() as con:
        con.execute("DELETE FROM users WHERE id = ?", (user_id,))
        con.commit()
