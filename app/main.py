"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC_DIR, UPLOAD_DIR
from .database import db, fetch_all, next_id, now_ms
from .migrations import ensure_schema
from .routers import ai_reader, auth, books, bookshelves, settings, zlibrary
from .schemas import fail
from .services.ebook import ensure_epub_conversion


@asynccontextmanager
async def lifespan(_: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ensure_schema()
    with db() as conn:
        count = conn.execute("SELECT COUNT(*) AS count FROM bookshelves").fetchone()["count"]
        if count == 0:
            shelf_id = next_id(conn, "bookshelves")
            conn.execute(
                "INSERT INTO bookshelves (id, name, sort_order, created_at) VALUES (?, ?, 0, ?)",
                (shelf_id, "默认书架", now_ms()),
            )
    for book in fetch_all(
        """
        SELECT * FROM books
        WHERE file_path LIKE '%.mobi' OR file_path LIKE '%.azw3'
           OR extension IN ('mobi', 'azw3')
        """
    ):
        try:
            source = Path(book["file_path"])
            if not source.exists():
                continue
            converted, extension = ensure_epub_conversion(
                source, book["extension"] or source.suffix.lstrip(".")
            )
            with db() as conn:
                conn.execute(
                    """
                    UPDATE books
                    SET file_path = ?, extension = ?, filesize = ?
                    WHERE id = ?
                    """,
                    (str(converted), extension, converted.stat().st_size, book["id"]),
                )
        except Exception:
            pass
    yield


app = FastAPI(title="Webrary FastAPI", lifespan=lifespan)

app.include_router(auth.router)
app.include_router(bookshelves.router)
app.include_router(books.router)
app.include_router(zlibrary.router)
app.include_router(settings.router)
app.include_router(ai_reader.router)


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=fail(exc.detail),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content=fail("请求参数错误"),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content=fail(f"服务器内部错误: {exc}"),
    )


UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
