"""Signed cookie session authentication for the FastAPI backend."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional

from fastapi import HTTPException, Request, Response

from .config import SESSION_COOKIE, SESSION_MAX_AGE, SESSION_SECRET
from .database import fetch_one, next_id, now_ms


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(payload: str) -> str:
    return hmac.new(
        SESSION_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def create_session_token(user_id: int) -> str:
    payload_data = {
        "uid": user_id,
        "exp": int(time.time()) + SESSION_MAX_AGE,
        "nonce": secrets.token_hex(8),
    }
    payload = _b64url_encode(
        json.dumps(payload_data, separators=(",", ":")).encode("utf-8")
    )
    return f"{payload}.{_sign(payload)}"


def read_session_token(token: Optional[str]) -> Optional[int]:
    if not token or "." not in token:
        return None
    payload, signature = token.rsplit(".", 1)
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        data = json.loads(_b64url_decode(payload))
        if int(data.get("exp", 0)) < int(time.time()):
            return None
        uid = data.get("uid")
        return int(uid) if uid is not None else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        create_session_token(user_id),
        max_age=SESSION_MAX_AGE,
        path="/",
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def generate_salt() -> str:
    return base64.b64encode(os.urandom(16)).decode("ascii")


def hash_password(password: str, salt: str) -> str:
    digest = hashlib.sha256(
        salt.encode("utf-8") + password.encode("utf-8")
    ).digest()
    return base64.b64encode(digest).decode("ascii")


def verify_password(password: str, stored: str) -> bool:
    if not stored or ":" not in stored:
        return False
    salt, expected = stored.split(":", 1)
    actual = hash_password(password, salt)
    return hmac.compare_digest(actual, expected)


def build_user_response(user: dict) -> dict:
    row = fetch_one("SELECT * FROM user_zlibrary WHERE user_id = ?", (user["id"],))
    return {
        "id": user["id"],
        "email": user["email"],
        "zlibraryBound": bool(row and row.get("remix_userkey")),
        "zlibraryEmail": (row or {}).get("zlibrary_email"),
    }


def get_current_user_id(request: Request) -> int:
    user_id = read_session_token(request.cookies.get(SESSION_COOKIE))
    if user_id is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return user_id


def get_current_user_or_none(request: Request) -> Optional[dict]:
    user_id = read_session_token(request.cookies.get(SESSION_COOKIE))
    if user_id is None:
        return None
    return fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))


def new_user_id(conn) -> int:
    return next_id(conn, "users")


def create_user(email: str, password: str) -> dict:
    salt = generate_salt()
    stored_hash = f"{salt}:{hash_password(password, salt)}"
    from .database import db

    with db() as conn:
        user_id = next_id(conn, "users")
        conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, email, stored_hash, now_ms()),
        )
    return fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
