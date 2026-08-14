"""In-memory background download task manager."""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from ..config import UPLOAD_DIR
from ..database import db, fetch_one, next_id, now_ms
from .ebook import ensure_epub_conversion
from .zlibrary_api import build_client_for_user


class DownloadManager:
    def __init__(self, max_workers: int = 3) -> None:
        self._tasks: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="zlib-download")

    def start(
        self,
        user_id: int,
        zlib_id: int,
        zlib_hash: str,
        title: Optional[str],
        author: Optional[str],
        cover_url: Optional[str],
        extension: Optional[str],
        filesize: Optional[int],
        description: Optional[str],
        shelf_ids: Optional[List[int]],
    ) -> str:
        task_id = str(uuid.uuid4())
        task = {
            "taskId": task_id,
            "bookId": None,
            "title": title,
            "author": author,
            "coverUrl": cover_url,
            "extension": extension,
            "totalBytes": filesize,
            "downloadedBytes": 0,
            "status": "DOWNLOADING",
            "errorMessage": None,
            "createdAt": now_ms(),
        }
        with self._lock:
            self._tasks[task_id] = task
        self._executor.submit(
            self._execute,
            user_id,
            task_id,
            zlib_id,
            zlib_hash,
            description,
            shelf_ids or [],
        )
        return task_id

    def _execute(
        self,
        user_id: int,
        task_id: str,
        zlib_id: int,
        zlib_hash: str,
        description: Optional[str],
        shelf_ids: List[int],
    ) -> None:
        task = self._tasks.get(task_id)
        if task is None:
            return
        client = None
        try:
            client = build_client_for_user(user_id)
            if not client.is_logged_in():
                raise RuntimeError("Not logged in to Z-Library")

            info = client.get_download_link(zlib_id, zlib_hash)
            if info.get("filesize"):
                task["totalBytes"] = int(info["filesize"])
            extension = info.get("extension") or task.get("extension") or "bin"

            def on_progress(downloaded: int) -> None:
                task["downloadedBytes"] = downloaded

            file_bytes = client.download_book(zlib_id, zlib_hash, on_progress=on_progress)
            task["status"] = "SAVING"
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4()}.{extension.lstrip('.')}"
            saved_path = UPLOAD_DIR / filename
            saved_path.write_bytes(file_bytes)

            task["status"] = "CONVERTING"
            saved_path, extension = ensure_epub_conversion(saved_path, extension)
            file_bytes = saved_path.read_bytes()
            book_id = self._save_book(
                zlib_id,
                zlib_hash,
                task,
                description,
                file_bytes,
                saved_path,
                extension,
            )
            task["bookId"] = book_id

            for shelf_id in shelf_ids:
                self._add_shelf_link(shelf_id, book_id)

            task["status"] = "COMPLETED"
            task["downloadedBytes"] = task.get("totalBytes") or len(file_bytes)
        except Exception as exc:
            task["status"] = "FAILED"
            task["errorMessage"] = str(exc)
        finally:
            if client is not None:
                client.close()

    @staticmethod
    def _save_book(
        zlib_id: int,
        zlib_hash: str,
        task: Dict[str, Any],
        description: Optional[str],
        file_bytes: bytes,
        saved_path,
        extension: str,
    ) -> int:
        with db() as conn:
            existing = conn.execute(
                "SELECT id FROM books WHERE zlib_id = ?", (zlib_id,)
            ).fetchone()
            extension = extension.lstrip(".")
            if existing:
                book_id = int(existing["id"])
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
                        extension,
                        extension,
                        extension,
                        extension,
                        len(file_bytes),
                        book_id,
                    ),
                )
            else:
                book_id = next_id(conn, "books")
                conn.execute(
                    """
                    INSERT INTO books
                        (id, zlib_id, zlib_hash, title, author, cover_url, extension,
                         filesize, file_path, description, is_uploaded, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """,
                    (
                        book_id,
                        zlib_id,
                        zlib_hash or "",
                        task.get("title") or "",
                        task.get("author"),
                        task.get("coverUrl"),
                        extension,
                        len(file_bytes),
                        str(saved_path),
                        description,
                        now_ms(),
                    ),
                )
        with db() as conn:
            progress = conn.execute(
                "SELECT id FROM reading_progress WHERE book_id = ?", (book_id,)
            ).fetchone()
            if progress is None:
                progress_id = next_id(conn, "reading_progress")
                conn.execute(
                    """
                    INSERT INTO reading_progress
                        (id, book_id, current_page, total_pages, is_finished, last_read_at)
                    VALUES (?, ?, 0, 0, 0, NULL)
                    """,
                    (progress_id, book_id),
                )
        return book_id

    @staticmethod
    def _add_shelf_link(shelf_id: int, book_id: int) -> None:
        with db() as conn:
            shelf = conn.execute(
                "SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)
            ).fetchone()
            if shelf is None:
                return
            link = conn.execute(
                "SELECT id FROM shelf_books WHERE shelf_id = ? AND book_id = ?",
                (shelf_id, book_id),
            ).fetchone()
            if link is None:
                link_id = next_id(conn, "shelf_books")
                conn.execute(
                    "INSERT INTO shelf_books (id, shelf_id, book_id, added_at) VALUES (?, ?, ?, ?)",
                    (link_id, shelf_id, book_id, now_ms()),
                )

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._tasks.get(task_id)

    def get_all_tasks(self) -> List[Dict[str, Any]]:
        with self._lock:
            tasks = list(self._tasks.values())
        tasks.sort(key=lambda item: item.get("createdAt") or 0, reverse=True)
        return tasks

    def clear_completed(self) -> None:
        with self._lock:
            self._tasks = {
                task_id: task
                for task_id, task in self._tasks.items()
                if task.get("status") not in ("COMPLETED", "FAILED")
            }


download_manager = DownloadManager()
