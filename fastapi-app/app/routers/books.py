"""Book, shelf-link, reading progress and reader endpoints."""

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import JSONResponse

from ..auth import get_current_user_id
from ..config import MAX_UPLOAD_BYTES, UPLOAD_DIR
from ..database import db, fetch_all, fetch_one, next_id, now_ms
from ..schemas import BookAddRequest, ReadingProgressRequest, TransferRequest, fail, ok
from ..services.ebook import (
    ensure_epub_conversion,
    mime_for_extension,
    parse_file,
    pdf_info,
    render_pdf_page,
)


router = APIRouter(
    prefix="/api/books",
    tags=["books"],
    dependencies=[Depends(get_current_user_id)],
)


def _book_dict(book_row, link_id: Optional[int] = None, progress: Optional[dict] = None) -> dict:
    total_pages = int(progress["total_pages"] or 0) if progress else 0
    current_page = int(progress["current_page"] or 0) if progress else 0
    unread_pages = max(0, total_pages - current_page) if total_pages > 0 else 0
    return {
        "id": link_id,
        "bookId": book_row["id"],
        "title": book_row["title"],
        "author": book_row["author"],
        "coverUrl": book_row["cover_url"],
        "extension": book_row["extension"],
        "filesize": book_row["filesize"],
        "unreadPages": unread_pages,
        "isFinished": bool(progress and progress["is_finished"]),
        "filePath": book_row["file_path"],
        "readOnlineUrl": None,
        "zlibId": book_row["zlib_id"],
        "zlibHash": book_row["zlib_hash"],
        "description": book_row["description"],
        "isUploaded": bool(book_row["is_uploaded"]),
        "createdAt": book_row["created_at"],
    }


def _progress_dict(progress_row, book_row) -> dict:
    return {
        "id": progress_row["id"],
        "bookId": book_row["id"],
        "currentPage": int(progress_row["current_page"] or 0),
        "totalPages": int(progress_row["total_pages"] or 0),
        "finished": bool(progress_row["is_finished"]),
        "lastReadAt": progress_row["last_read_at"],
        "book": _book_dict(book_row),
    }


def _ensure_progress(conn, book_id: int):
    row = conn.execute(
        "SELECT * FROM reading_progress WHERE book_id = ?", (book_id,)
    ).fetchone()
    if row is None:
        progress_id = next_id(conn, "reading_progress")
        conn.execute(
            """
            INSERT INTO reading_progress
                (id, book_id, current_page, total_pages, is_finished, last_read_at)
            VALUES (?, ?, 0, 0, 0, NULL)
            """,
            (progress_id, book_id),
        )
        row = conn.execute(
            "SELECT * FROM reading_progress WHERE book_id = ?", (book_id,)
        ).fetchone()
    return row


@router.get("/shelf/{shelf_id}")
def books_by_shelf(shelf_id: int):
    if fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)) is None:
        return fail(f"Shelf not found: {shelf_id}")
    rows = fetch_all(
        """
        SELECT b.*, sb.id AS link_id, p.current_page, p.total_pages, p.is_finished
        FROM shelf_books sb
        JOIN books b ON b.id = sb.book_id
        LEFT JOIN reading_progress p ON p.book_id = b.id
        WHERE sb.shelf_id = ?
        ORDER BY sb.added_at DESC
        """,
        (shelf_id,),
    )
    return ok([_book_dict(row, link_id=row["link_id"], progress=row) for row in rows])


@router.get("/history")
def reading_history():
    rows = fetch_all(
        """
        SELECT p.id AS progress_id, p.last_read_at, b.*
        FROM reading_progress p
        JOIN books b ON b.id = p.book_id
        WHERE p.last_read_at IS NOT NULL
        ORDER BY p.last_read_at DESC
        """
    )
    return ok(
        [
            {
                "bookId": row["id"],
                "title": row["title"],
                "author": row["author"],
                "coverUrl": row["cover_url"],
                "extension": row["extension"],
                "lastReadAt": row["last_read_at"],
            }
            for row in rows
        ]
    )


@router.post("/shelf/{shelf_id}")
def add_book_to_shelf(shelf_id: int, request: BookAddRequest):
    shelf = fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,))
    if shelf is None:
        return fail(f"Shelf not found: {shelf_id}")

    with db() as conn:
        book_row = None
        if request.zlib_id is not None:
            book_row = conn.execute(
                "SELECT * FROM books WHERE zlib_id = ?", (request.zlib_id,)
            ).fetchone()
        if book_row is None:
            book_id = next_id(conn, "books")
            uploaded = 1 if request.uploaded else (1 if request.zlib_id is None else 0)
            conn.execute(
                """
                INSERT INTO books
                    (id, zlib_id, zlib_hash, title, author, cover_url, extension,
                     filesize, file_path, description, is_uploaded, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    book_id,
                    request.zlib_id,
                    request.zlib_hash or "",
                    request.title or "",
                    request.author,
                    request.cover_url,
                    request.extension,
                    request.filesize,
                    request.file_path,
                    request.description,
                    uploaded,
                    now_ms(),
                ),
            )
            book_row = conn.execute(
                "SELECT * FROM books WHERE id = ?", (book_id,)
            ).fetchone()
        else:
            book_id = book_row["id"]

        link = conn.execute(
            "SELECT * FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
            (shelf_id, book_id),
        ).fetchone()
        if link is None:
            link_id = next_id(conn, "shelf_books")
            conn.execute(
                "INSERT INTO shelf_books (id, shelf_id, book_id, added_at) VALUES (?, ?, ?, ?)",
                (link_id, shelf_id, book_id, now_ms()),
            )
            link = conn.execute(
                "SELECT * FROM shelf_books WHERE id = ?", (link_id,)
            ).fetchone()
        progress_row = _ensure_progress(conn, book_id)

    return ok(_book_dict(book_row, link_id=link["id"], progress=progress_row))


@router.delete("/shelf/{shelf_id}/book/{book_id}")
def remove_from_shelf(shelf_id: int, book_id: int):
    with db() as conn:
        conn.execute(
            "DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
            (shelf_id, book_id),
        )
    return ok("Book removed from shelf", None)


@router.post("/transfer")
def transfer_book(request: TransferRequest):
    book = fetch_one("SELECT id FROM books WHERE id = ?", (request.book_id,))
    if book is None:
        return fail(f"Book not found: {request.book_id}")
    for label, shelf_id in (
        ("Source shelf", request.from_shelf_id),
        ("Target shelf", request.to_shelf_id),
    ):
        if fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)) is None:
            return fail(f"{label} not found: {shelf_id}")
    with db() as conn:
        conn.execute(
            "DELETE FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
            (request.from_shelf_id, request.book_id),
        )
        link = conn.execute(
            "SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
            (request.to_shelf_id, request.book_id),
        ).fetchone()
        if link is None:
            link_id = next_id(conn, "shelf_books")
            conn.execute(
                "INSERT INTO shelf_books (id, shelf_id, book_id, added_at) VALUES (?, ?, ?, ?)",
                (link_id, request.to_shelf_id, request.book_id, now_ms()),
            )
    return ok("Book transferred", None)


@router.delete("/{book_id}")
def delete_book(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    with db() as conn:
        conn.execute("DELETE FROM shelf_books WHERE book_id = ?", (book_id,))
        conn.execute("DELETE FROM reading_progress WHERE book_id = ?", (book_id,))
        conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    if book["is_uploaded"] and book["file_path"]:
        try:
            Path(book["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass
    return ok("Book deleted", None)


@router.post("/upload")
def upload_book(
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    author: Optional[str] = Form(default=None),
    shelf_id: int = Form(...),
):
    if fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)) is None:
        return fail(f"Shelf not found: {shelf_id}")
    original_filename = file.filename or "book"
    ext = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else ""
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return fail(f"File exceeds maximum size of {MAX_UPLOAD_BYTES} bytes")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4()}.{ext}" if ext else str(uuid.uuid4())
    stored_path = UPLOAD_DIR / stored_name
    stored_path.write_bytes(content)

    if ext in ("mobi", "azw3"):
        stored_path, ext = ensure_epub_conversion(stored_path, ext)

    metadata = parse_file(stored_path, ext)
    final_title = (title or "").strip() or metadata.get("title") or original_filename
    final_author = (author or "").strip() or metadata.get("author")
    cover_url = None
    if metadata.get("cover_bytes"):
        cover_format = metadata.get("cover_format") or "jpg"
        cover_name = f"{Path(stored_path).stem}_cover.{cover_format}"
        (UPLOAD_DIR / cover_name).write_bytes(metadata["cover_bytes"])
        cover_url = f"/uploads/{cover_name}"
    filesize = stored_path.stat().st_size

    with db() as conn:
        book_id = next_id(conn, "books")
        conn.execute(
            """
            INSERT INTO books
                (id, title, author, cover_url, extension, filesize, file_path,
                 description, is_uploaded, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)
            """,
            (
                book_id,
                final_title,
                final_author,
                cover_url,
                ext,
                filesize,
                str(stored_path),
                now_ms(),
            ),
        )
        progress_id = next_id(conn, "reading_progress")
        conn.execute(
            """
            INSERT INTO reading_progress
                (id, book_id, current_page, total_pages, is_finished, last_read_at)
            VALUES (?, ?, 0, ?, 0, NULL)
            """,
            (progress_id, book_id, int(metadata.get("pages") or 0)),
        )
        link_id = next_id(conn, "shelf_books")
        conn.execute(
            "INSERT INTO shelf_books (id, shelf_id, book_id, added_at) VALUES (?, ?, ?, ?)",
            (link_id, shelf_id, book_id, now_ms()),
        )
        book_row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        progress_row = conn.execute(
            "SELECT * FROM reading_progress WHERE book_id = ?", (book_id,)
        ).fetchone()

    return ok(_book_dict(book_row, link_id=link_id, progress=progress_row))


@router.get("/{book_id}/progress")
def get_progress(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    with db() as conn:
        progress_row = _ensure_progress(conn, book_id)
    return ok(_progress_dict(progress_row, book))


@router.put("/{book_id}/progress")
def update_progress(book_id: int, request: ReadingProgressRequest):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    with db() as conn:
        progress_row = _ensure_progress(conn, book_id)
        conn.execute(
            """
            UPDATE reading_progress
            SET current_page = ?,
                total_pages = CASE WHEN ? > 0 THEN ? ELSE total_pages END,
                is_finished = ?,
                last_read_at = ?
            WHERE id = ?
            """,
            (
                request.current_page,
                request.total_pages,
                request.total_pages,
                1 if request.finished else 0,
                now_ms(),
                progress_row["id"],
            ),
        )
        progress_row = conn.execute(
            "SELECT * FROM reading_progress WHERE id = ?", (progress_row["id"],)
        ).fetchone()
    return ok(_progress_dict(progress_row, book))


@router.get("/{book_id}/toc")
def book_toc(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    if not book["file_path"]:
        return ok([])
    path = Path(book["file_path"])
    if not path.exists():
        return ok([])
    try:
        metadata = parse_file(path, book["extension"] or "")
        return ok(metadata.get("toc") or [])
    except Exception:
        return ok([])


@router.get("/{book_id}/read")
def read_book(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return JSONResponse(status_code=404, content=fail("Book not found"))
    if not book["file_path"]:
        return JSONResponse(status_code=404, content=fail("No file available for this book"))
    path = Path(book["file_path"])
    if not path.exists():
        return JSONResponse(status_code=404, content=fail("File not found on disk"))
    return Response(
        content=path.read_bytes(),
        media_type=mime_for_extension(book["extension"]),
    )


@router.get("/{book_id}/stream")
def stream_book(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return JSONResponse(status_code=404, content=fail("Book not found"))
    if not book["file_path"]:
        return JSONResponse(status_code=404, content=fail("No file available for this book"))
    path = Path(book["file_path"])
    if not path.exists():
        return JSONResponse(status_code=404, content=fail("File not found on disk"))
    return Response(
        content=path.read_bytes(),
        media_type=mime_for_extension(book["extension"]),
        headers={
            "Content-Disposition": f'inline; filename="{path.name}"'
        },
    )


@router.get("/{book_id}/pdf/info")
def get_pdf_info(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    if not book["file_path"] or not book["file_path"].lower().endswith(".pdf"):
        return fail("Not a PDF file")
    path = Path(book["file_path"])
    if not path.exists():
        return fail("File not found")
    try:
        return ok(pdf_info(path))
    except Exception as exc:
        return fail(f"Failed: {exc}")


@router.get("/{book_id}/pdf/page/{page_number}")
def get_pdf_page(book_id: int, page_number: int, dpi: int = Query(default=144)):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return JSONResponse(status_code=404, content=fail("Book not found"))
    if not book["file_path"]:
        return JSONResponse(status_code=404, content=fail("No file"))
    path = Path(book["file_path"])
    try:
        image_bytes = render_pdf_page(path, page_number, dpi=dpi)
    except ValueError:
        return JSONResponse(status_code=404, content=fail("Page out of range"))
    except Exception as exc:
        return JSONResponse(status_code=500, content=fail(f"Render failed: {exc}"))
    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": f"max-age={86400 if page_number <= 10 else 3600}"
        },
    )


@router.get("/{book_id}")
def book_detail(book_id: int):
    book = fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
    if book is None:
        return fail(f"Book not found: {book_id}")
    progress = fetch_one(
        "SELECT * FROM reading_progress WHERE book_id = ?", (book_id,)
    )
    return ok(_book_dict(book, link_id=None, progress=progress))
