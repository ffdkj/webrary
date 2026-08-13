"""Persisted app settings stored in the shared zlibrary_config table."""

from typing import Optional

from ..database import db, fetch_one, next_id, now_ms


ALLOW_REGISTRATION_KEY = "allow_registration"


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    row = fetch_one(
        "SELECT config_value FROM zlibrary_config WHERE config_key = ?", (key,)
    )
    if row is None:
        return default
    return row["config_value"]


def set_setting(key: str, value: str) -> None:
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM zlibrary_config WHERE config_key = ?", (key,)
        ).fetchone()
        if row is None:
            setting_id = next_id(conn, "zlibrary_config")
            conn.execute(
                """
                INSERT INTO zlibrary_config (id, config_key, config_value, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (setting_id, key, value, now_ms()),
            )
        else:
            conn.execute(
                """
                UPDATE zlibrary_config
                SET config_value = ?, updated_at = ?
                WHERE id = ?
                """,
                (value, now_ms(), row["id"]),
            )


def registration_allowed() -> bool:
    value = get_setting(ALLOW_REGISTRATION_KEY, "1")
    return str(value or "1").lower() not in ("0", "false", "no", "off")


def set_registration_allowed(allowed: bool) -> None:
    set_setting(ALLOW_REGISTRATION_KEY, "1" if allowed else "0")
