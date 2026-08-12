"""Schema migrations executed on FastAPI startup."""

from .database import db


def ensure_highlights_table() -> None:
    """Create the book highlights table and its lookup index if missing."""
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS book_highlights (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                book_id INTEGER NOT NULL,
                format TEXT NOT NULL,
                cfi_range TEXT,
                page INTEGER,
                start_offset INTEGER,
                end_offset INTEGER,
                quote TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT 'yellow',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_book_highlights_book_user
            ON book_highlights (book_id, user_id)
            """
        )
