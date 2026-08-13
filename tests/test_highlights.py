"""Focused tests for highlight persistence and API endpoints."""

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app import database
from app.auth import get_current_user_id
from app.main import app
from app.migrations import ensure_highlights_table, ensure_schema


class HighlightApiTest(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmp_db = Path(self._tmpdir.name) / "webrary-test.db"
        database.DATABASE_PATH = self.tmp_db
        ensure_schema()

        with database.db() as conn:
            for book_id in (1, 2):
                conn.execute(
                    "INSERT INTO books (id, title, created_at) VALUES (?, ?, 1)",
                    (book_id, f"Book {book_id}"),
                )
            for user_id in (1, 2):
                conn.execute(
                    """
                    INSERT INTO users (id, email, password_hash, created_at)
                    VALUES (?, ?, 'salt:hash', 1)
                    """,
                    (user_id, f"user{user_id}@example.com"),
                )

        self.current_user = {"id": 1}
        app.dependency_overrides[get_current_user_id] = lambda: self.current_user["id"]
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self._tmpdir.cleanup()

    def _create_epub(self, color="yellow", cfi="epubcfi(/6/4[chap]!/4[body]/10[text],/1:0,/1:12)"):
        return self.client.post(
            "/api/books/1/highlights",
            json={
                "format": "epub",
                "cfiRange": cfi,
                "quote": "some sentence",
                "color": color,
            },
        )

    def _create_txt(self):
        return self.client.post(
            "/api/books/1/highlights",
            json={
                "format": "txt",
                "page": 3,
                "startOffset": 10,
                "endOffset": 25,
                "quote": "txt sentence",
                "color": "green",
            },
        )

    def test_migration_is_idempotent(self):
        ensure_highlights_table()
        with database.db() as conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='book_highlights'"
            ).fetchone()
        self.assertIsNotNone(table)

    def test_create_and_list_epub_highlight(self):
        resp = self._create_epub()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["cfiRange"].startswith("epubcfi("), True)
        self.assertEqual(body["data"]["format"], "epub")

        listed = self.client.get("/api/books/1/highlights").json()
        self.assertEqual(len(listed["data"]), 1)
        self.assertEqual(listed["data"][0]["quote"], "some sentence")

    def test_txt_create_update_color(self):
        created = self._create_txt().json()
        self.assertTrue(created["success"])
        hid = created["data"]["id"]

        updated = self.client.put(
            f"/api/books/1/highlights/{hid}", json={"color": "blue"}
        ).json()
        self.assertTrue(updated["success"])
        self.assertEqual(updated["data"]["color"], "blue")

    def test_delete_highlight(self):
        created = self._create_epub().json()
        hid = created["data"]["id"]
        deleted = self.client.delete(f"/api/books/1/highlights/{hid}").json()
        self.assertTrue(deleted["success"])
        listed = self.client.get("/api/books/1/highlights").json()
        self.assertEqual(listed["data"], [])

    def test_user_isolation(self):
        self._create_epub()
        self.current_user["id"] = 2
        listed = self.client.get("/api/books/1/highlights").json()
        self.assertEqual(listed["data"], [])
        deleted = self.client.delete("/api/books/1/highlights/1").json()
        self.assertFalse(deleted["success"])

    def test_delete_book_cascades(self):
        created = self._create_txt().json()
        hid = created["data"]["id"]
        deleted = self.client.delete("/api/books/1").json()
        self.assertTrue(deleted["success"])
        with database.db() as conn:
            row = conn.execute(
                "SELECT id FROM book_highlights WHERE id = ?", (hid,)
            ).fetchone()
        self.assertIsNone(row)

    def test_validation(self):
        bad_txt = self.client.post(
            "/api/books/1/highlights",
            json={"format": "txt", "quote": "no offsets", "color": "green"},
        ).json()
        self.assertFalse(bad_txt["success"])
        bad_color = self.client.post(
            "/api/books/1/highlights",
            json={"format": "epub", "cfiRange": "epubcfi(/6/)", "quote": "x", "color": "red"},
        ).json()
        self.assertFalse(bad_color["success"])


if __name__ == "__main__":
    unittest.main()
