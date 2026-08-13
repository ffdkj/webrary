"""Z-Library search, download and account integration endpoints."""

import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response

from ..auth import get_current_user_id
from ..config import UPLOAD_DIR, Z_LIBRARY_DEFAULT_DOMAIN
from ..database import db, fetch_one, next_id, now_ms
from ..schemas import SearchRequest, ZlibraryLoginRequest, fail, ok
from ..services.downloads import download_manager
from ..services.ebook import ensure_epub_conversion, mime_for_extension
from ..services.zlibrary_api import (
    ZlibraryApiClient,
    persist_zlibrary_login,
    user_zlibrary_client,
)


router = APIRouter(prefix="/api/zlibrary", tags=["zlibrary"])


def _to_int(value: Any, name: str = "value") -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {name}: {value}")


def _parse_shelf_ids(raw: Any) -> List[int]:
    if not isinstance(raw, list):
        return []
    return [_to_int(item, "shelfId") for item in raw]


def _safe_folder_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name or "默认书架")


def _save_download_bytes(
    file_bytes: bytes,
    extension: str,
    folder: Optional[str] = None,
) -> Path:
    base = UPLOAD_DIR / folder if folder else UPLOAD_DIR
    base.mkdir(parents=True, exist_ok=True)
    ext = (extension or "bin").lstrip(".") or "bin"
    filename = f"{uuid.uuid4()}.{ext}"
    path = base / filename
    path.write_bytes(file_bytes)
    return path


def _ensure_progress(conn, book_id: int) -> None:
    row = conn.execute(
        "SELECT id FROM reading_progress WHERE book_id = ?", (book_id,)
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


@router.post("/login")
def zlibrary_login(
    request: ZlibraryLoginRequest,
    user_id: int = Depends(get_current_user_id),
):
    if not request.email or not request.password:
        return fail("Email and password are required")
    domain = (request.domain or "").strip() or Z_LIBRARY_DEFAULT_DOMAIN
    client = ZlibraryApiClient(domain, request.proxy_host, request.proxy_port)
    try:
        user_info = client.login(request.email, request.password)
    except Exception as exc:
        return fail(f"Login failed: {exc}")
    finally:
        client.close()
    persist_zlibrary_login(
        user_id,
        request.email,
        request.password,
        domain,
        request.proxy_host,
        request.proxy_port,
        user_info,
    )
    return ok("Login successful", user_info)


@router.get("/status")
def zlibrary_status(user_id: int = Depends(get_current_user_id)):
    with user_zlibrary_client(user_id) as client:
        return ok({"loggedIn": client.is_logged_in()})


@router.get("/logout")
def zlibrary_logout(user_id: int = Depends(get_current_user_id)):
    with user_zlibrary_client(user_id) as client:
        client.logout()
    return ok("Logged out", None)


@router.get("/profile")
def zlibrary_profile(user_id: int = Depends(get_current_user_id)):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            client.get_profile()
            return ok(client.get_user_info() or {})
        except Exception as exc:
            return fail(f"Failed to get profile: {exc}")


@router.get("/downloads-left")
def zlibrary_downloads_left(user_id: int = Depends(get_current_user_id)):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            client.get_profile()
            info = client.get_user_info() or {}
            left = int(info.get("downloadsLimit") or 0) - int(info.get("downloadsToday") or 0)
            return ok(max(0, left))
        except Exception as exc:
            return fail(f"Failed: {exc}")


@router.post("/search")
def zlibrary_search(
    request: SearchRequest,
    user_id: int = Depends(get_current_user_id),
):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        options: Dict[str, Any] = {}
        if request.year_from is not None:
            options["yearFrom"] = request.year_from
        if request.year_to is not None:
            options["yearTo"] = request.year_to
        if request.languages:
            options["languages"] = request.languages
        if request.extensions:
            options["extensions"] = request.extensions
        if request.order:
            options["order"] = request.order
        options["page"] = request.page or 1
        options["limit"] = request.limit or 10
        try:
            return ok(client.search(request.message or "", options))
        except Exception as exc:
            return fail(f"Search failed: {exc}")


@router.get("/most-popular")
def zlibrary_most_popular(user_id: int = Depends(get_current_user_id)):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            return ok(client.get_most_popular())
        except Exception as exc:
            return fail(f"Failed to get most popular: {exc}")


@router.get("/book/{book_id}/{hash_value}")
def zlibrary_book_info(
    book_id: int,
    hash_value: str,
    user_id: int = Depends(get_current_user_id),
):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            return ok(client.get_book_info(book_id, hash_value))
        except Exception as exc:
            return fail(f"Failed to get book info: {exc}")


@router.get("/book/{book_id}/{hash_value}/download")
def zlibrary_download_info(
    book_id: int,
    hash_value: str,
    user_id: int = Depends(get_current_user_id),
):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            return ok(client.get_download_link(book_id, hash_value))
        except Exception as exc:
            return fail(f"Failed to get download link: {exc}")


@router.get("/book/{zlib_id}/{zlib_hash}/download/file")
def zlibrary_download_file(
    zlib_id: int,
    zlib_hash: str,
    user_id: int = Depends(get_current_user_id),
    local_book_id: Optional[int] = Query(default=None, alias="localBookId"),
):
    if local_book_id is not None:
        book = fetch_one("SELECT * FROM books WHERE id = ?", (local_book_id,))
        if book and book.get("file_path"):
            path = Path(book["file_path"])
            if path.exists():
                return Response(
                    content=path.read_bytes(),
                    media_type=mime_for_extension(book["extension"]),
                    headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
                )

    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return JSONResponse(status_code=401, content=fail("Not logged in"))
        try:
            info = client.get_download_link(zlib_id, zlib_hash)
            file_bytes = client.download_book(zlib_id, zlib_hash)
        except Exception as exc:
            return JSONResponse(status_code=500, content=fail(f"Download failed: {exc}"))

    ext = (info.get("extension") or "bin").lstrip(".") or "bin"
    saved_path = _save_download_bytes(file_bytes, ext)
    saved_path, ext = ensure_epub_conversion(saved_path, ext)

    with db() as conn:
        book = None
        if local_book_id is not None:
            book = conn.execute(
                "SELECT * FROM books WHERE id = ?", (local_book_id,)
            ).fetchone()
        if book is None:
            book = conn.execute(
                "SELECT * FROM books WHERE zlib_id = ?", (zlib_id,)
            ).fetchone()
        if book is not None:
            conn.execute(
                """
                UPDATE books
                SET file_path = ?, is_uploaded = 1,
                    extension = CASE WHEN extension IS NULL OR extension = '' THEN ?
                                     WHEN ? != ? THEN ? ELSE extension END,
                    filesize = CASE WHEN filesize IS NULL OR filesize = 0 THEN ?
                                    ELSE filesize END
                WHERE id = ?
                """,
                (
                    str(saved_path),
                    ext,
                    ext,
                    ext,
                    ext,
                    len(file_bytes),
                    book["id"],
                ),
            )

    return Response(
        content=saved_path.read_bytes(),
        media_type=mime_for_extension(ext),
        headers={"Content-Disposition": f'attachment; filename="{saved_path.name}"'},
    )


@router.post("/download-save/{book_id}/{hash_value}")
def zlibrary_download_save(
    book_id: int,
    hash_value: str,
    user_id: int = Depends(get_current_user_id),
    shelf_name: str = Query(default="默认书架", alias="shelfName"),
):
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            info = client.get_download_link(book_id, hash_value)
            file_bytes = client.download_book(book_id, hash_value)
        except Exception as exc:
            return fail(f"Save failed: {exc}")

    ext = (info.get("extension") or "bin").lstrip(".") or "bin"
    safe_name = _safe_folder_name(shelf_name)
    saved_path = _save_download_bytes(file_bytes, ext, folder=safe_name)
    saved_path, ext = ensure_epub_conversion(saved_path, ext)
    relative_path = f"/uploads/{safe_name}/{saved_path.name}"
    return ok(
        {
            "filePath": str(saved_path),
            "relativePath": relative_path,
            "filename": saved_path.name,
            "extension": ext,
            "filesize": str(saved_path.stat().st_size),
        }
    )


@router.post("/add-to-shelf/{book_id}/{hash_value}/{shelf_id}")
def zlibrary_add_to_shelf(
    book_id: int,
    hash_value: str,
    shelf_id: int,
    metadata: Dict[str, Any],
    user_id: int = Depends(get_current_user_id),
):
    if fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)) is None:
        return fail(f"Shelf not found: {shelf_id}")
    shelf_name = metadata.get("shelfName") or "默认书架"
    with user_zlibrary_client(user_id) as client:
        if not client.is_logged_in():
            return fail("Not logged in")
        try:
            info = client.get_download_link(book_id, hash_value)
            file_bytes = client.download_book(book_id, hash_value)
        except Exception as exc:
            return fail(f"Failed: {exc}")

    ext = (info.get("extension") or "bin").lstrip(".") or "bin"
    saved_path = _save_download_bytes(file_bytes, ext, folder=_safe_folder_name(shelf_name))
    saved_path, ext = ensure_epub_conversion(saved_path, ext)

    with db() as conn:
        book = conn.execute(
            "SELECT * FROM books WHERE zlib_id = ?", (book_id,)
        ).fetchone()
        if book is None:
            new_book_id = next_id(conn, "books")
            conn.execute(
                """
                INSERT INTO books
                    (id, zlib_id, zlib_hash, title, author, cover_url, extension,
                     filesize, file_path, description, is_uploaded, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                """,
                (
                    new_book_id,
                    book_id,
                    hash_value or "",
                    metadata.get("title") or "",
                    metadata.get("author"),
                    metadata.get("coverUrl"),
                    ext,
                    len(file_bytes),
                    str(saved_path),
                    metadata.get("description"),
                    now_ms(),
                ),
            )
            book = conn.execute(
                "SELECT * FROM books WHERE id = ?", (new_book_id,)
            ).fetchone()
        else:
            conn.execute(
                "UPDATE books SET file_path = ?, is_uploaded = 1, extension = ? WHERE id = ?",
                (str(saved_path), ext, book["id"]),
            )
        link = conn.execute(
            "SELECT * FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
            (shelf_id, book["id"]),
        ).fetchone()
        if link is None:
            link_id = next_id(conn, "shelf_books")
            conn.execute(
                "INSERT INTO shelf_books (id, shelf_id, book_id, added_at) VALUES (?, ?, ?, ?)",
                (link_id, shelf_id, book["id"], now_ms()),
            )
            link = conn.execute(
                "SELECT * FROM shelf_books WHERE id = ?", (link_id,)
            ).fetchone()
        _ensure_progress(conn, book["id"])

    return ok(
        {
            "id": link["id"],
            "book": {
                "id": book["id"],
                "title": book["title"],
                "author": book["author"],
                "coverUrl": book["cover_url"],
                "extension": book["extension"],
                "filesize": book["filesize"],
                "filePath": book["file_path"],
                "zlibId": book["zlib_id"],
                "zlibHash": book["zlib_hash"],
            },
        }
    )


@router.post("/download/start")
def zlibrary_download_start(
    body: Dict[str, Any],
    user_id: int = Depends(get_current_user_id),
):
    try:
        zlib_id = _to_int(body.get("zlibId"), "zlibId")
        zlib_hash = str(body.get("zlibHash") or "")
        shelf_ids = _parse_shelf_ids(body.get("shelfIds"))
    except ValueError as exc:
        return fail(f"Failed: {exc}")
    task_id = download_manager.start(
        user_id,
        zlib_id,
        zlib_hash,
        body.get("title"),
        body.get("author"),
        body.get("coverUrl"),
        body.get("extension"),
        body.get("filesize"),
        body.get("description"),
        shelf_ids,
    )
    return ok({"taskId": task_id})


@router.get("/download/status/{task_id}")
def zlibrary_download_status(task_id: str, user_id: int = Depends(get_current_user_id)):
    task = download_manager.get_task(task_id)
    if task is None:
        return fail(f"Task not found: {task_id}")
    return ok(task)


@router.get("/download/list")
def zlibrary_download_list(user_id: int = Depends(get_current_user_id)):
    return ok(download_manager.get_all_tasks())
