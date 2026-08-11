"""Bookshelf management endpoints."""

from fastapi import APIRouter, Depends

from ..auth import get_current_user_id
from ..database import db, fetch_all, fetch_one, next_id, now_ms
from ..schemas import BookshelfRequest, ReorderRequest, fail, ok


router = APIRouter(
    prefix="/api/bookshelves",
    tags=["bookshelves"],
    dependencies=[Depends(get_current_user_id)],
)


def _shelf_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "sortOrder": row["sort_order"],
        "bookCount": row["book_count"],
        "createdAt": row["created_at"],
    }


@router.get("")
def list_bookshelves():
    rows = fetch_all(
        """
        SELECT b.*,
               (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = b.id) AS book_count
        FROM bookshelves b
        ORDER BY b.sort_order ASC
        """
    )
    return ok([_shelf_dict(row) for row in rows])


@router.post("")
def create_bookshelf(request: BookshelfRequest):
    name = request.name.strip()
    if not name:
        return fail("书架名称不能为空")
    with db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM bookshelves"
        ).fetchone()["max_order"]
        shelf_id = next_id(conn, "bookshelves")
        conn.execute(
            "INSERT INTO bookshelves (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)",
            (shelf_id, name, int(max_order) + 1, now_ms()),
        )
    row = fetch_one(
        """
        SELECT b.*,
               (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = b.id) AS book_count
        FROM bookshelves b WHERE b.id = ?
        """,
        (shelf_id,),
    )
    return ok(_shelf_dict(row))


@router.put("/{shelf_id}")
def update_bookshelf(shelf_id: int, request: BookshelfRequest):
    name = request.name.strip()
    if not name:
        return fail("书架名称不能为空")
    with db() as conn:
        cur = conn.execute(
            "UPDATE bookshelves SET name = ? WHERE id = ?", (name, shelf_id)
        )
        if cur.rowcount == 0:
            return fail(f"Shelf not found: {shelf_id}")
    row = fetch_one(
        """
        SELECT b.*,
               (SELECT COUNT(*) FROM shelf_books sb WHERE sb.shelf_id = b.id) AS book_count
        FROM bookshelves b WHERE b.id = ?
        """,
        (shelf_id,),
    )
    return ok(_shelf_dict(row))


@router.delete("/{shelf_id}")
def delete_bookshelf(shelf_id: int):
    with db() as conn:
        shelf = conn.execute(
            "SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)
        ).fetchone()
        if shelf is None:
            return fail(f"Shelf not found: {shelf_id}")
        conn.execute("DELETE FROM shelf_books WHERE shelf_id = ?", (shelf_id,))
        conn.execute("DELETE FROM bookshelves WHERE id = ?", (shelf_id,))
    return ok("Shelf deleted", None)


@router.post("/reorder")
def reorder_bookshelves(request: ReorderRequest):
    for index, shelf_id in enumerate(request.shelf_ids):
        with db() as conn:
            cur = conn.execute(
                "UPDATE bookshelves SET sort_order = ? WHERE id = ?",
                (index, shelf_id),
            )
            if cur.rowcount == 0:
                return fail(f"Shelf not found: {shelf_id}")
    return ok("Reordered", None)


@router.get("/{shelf_id}/stats")
def shelf_stats(shelf_id: int):
    if fetch_one("SELECT id FROM bookshelves WHERE id = ?", (shelf_id,)) is None:
        return fail(f"Shelf not found: {shelf_id}")
    row = fetch_one(
        """
        SELECT COUNT(*) AS book_count,
               COALESCE(SUM(CASE WHEN p.is_finished = 1 THEN 1 ELSE 0 END), 0) AS finished_count,
               COALESCE(SUM(CASE WHEN p.id IS NULL OR (p.is_finished = 0 AND p.current_page = 0)
                                 THEN 1 ELSE 0 END), 0) AS unread_count
        FROM shelf_books sb
        LEFT JOIN reading_progress p ON p.book_id = sb.book_id
        WHERE sb.shelf_id = ?
        """,
        (shelf_id,),
    )
    return ok(
        {
            "bookCount": int(row["book_count"] or 0),
            "unreadCount": int(row["unread_count"] or 0),
            "finishedCount": int(row["finished_count"] or 0),
        }
    )
