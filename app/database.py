"""SQLite access helpers.

The database schema is owned by the existing Spring Boot application and is
reused as-is. This module intentionally never creates or alters tables.
"""

import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

from .config import DATABASE_PATH, UPLOAD_DIR


def connect() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def now_ms() -> int:
    return int(time.time() * 1000)


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {key: row[key] for key in row.keys()}


def rows_to_dicts(rows: List[sqlite3.Row]) -> List[Dict[str, Any]]:
    return [row_to_dict(row) for row in rows]


def fetch_one(sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    with db() as conn:
        return row_to_dict(conn.execute(sql, params).fetchone())


def fetch_all(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    with db() as conn:
        return rows_to_dicts(conn.execute(sql, params).fetchall())


def execute(sql: str, params: tuple = ()) -> int:
    with db() as conn:
        cur = conn.execute(sql, params)
        return cur.lastrowid


def next_id(conn: sqlite3.Connection, table: str) -> int:
    """Compute the next explicit id for legacy tables without AUTOINCREMENT."""
    row = conn.execute(f"SELECT COALESCE(MAX(id), 0) AS max_id FROM {table}").fetchone()
    return int(row["max_id"]) + 1


def execute_many(sql: str, seq: list) -> None:
    with db() as conn:
        conn.executemany(sql, seq)


def ensure_upload_dir() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
