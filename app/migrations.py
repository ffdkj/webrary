"""Schema migrations executed on FastAPI startup."""

from .database import db


def ensure_schema() -> None:
    """Create every base table the backend expects when the DB is fresh."""
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id integer,
                created_at timestamp not null,
                email varchar(255) not null unique,
                password_hash varchar(255) not null,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS books (
                id integer,
                author varchar(255),
                cover_url varchar(2048),
                created_at timestamp not null,
                description TEXT,
                extension varchar(255),
                file_path varchar(1024),
                filesize bigint,
                title varchar(255) not null,
                is_uploaded boolean,
                zlib_hash varchar(255),
                zlib_id bigint,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS bookshelves (
                id integer,
                created_at timestamp not null,
                name varchar(255) not null,
                sort_order integer,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS shelf_books (
                id integer,
                added_at timestamp not null,
                book_id bigint not null,
                shelf_id bigint not null,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS reading_progress (
                id integer,
                current_page integer,
                is_finished boolean,
                last_read_at timestamp,
                total_pages integer,
                book_id bigint not null unique,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS user_zlibrary (
                id integer,
                domain varchar(255),
                proxy_host varchar(255),
                proxy_port integer,
                remix_userid varchar(255),
                remix_userkey varchar(255),
                updated_at timestamp,
                zlibrary_email varchar(255),
                zlibrary_password varchar(255),
                user_id bigint not null unique,
                primary key (id)
            );
            CREATE TABLE IF NOT EXISTS zlibrary_config (
                id integer,
                config_key varchar(255) not null unique,
                config_value varchar(2048),
                updated_at timestamp,
                primary key (id)
            );
            """
        )
    ensure_highlights_table()


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
