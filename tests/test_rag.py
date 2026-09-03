"""Focused tests for the RAG chunking logic."""

import unittest

from app.services.rag import chunk_text


class ChunkTextTest(unittest.TestCase):
    def test_chunk_text_splits_long_text(self):
        text = "word " * 1000
        chunks = chunk_text(text, chunk_size=200, overlap=20)
        self.assertGreater(len(chunks), 1)
        for chunk in chunks:
            self.assertLessEqual(len(chunk), 220)

    def test_chunk_text_short_text(self):
        text = "hello world"
        chunks = chunk_text(text, chunk_size=800, overlap=100)
        self.assertEqual(chunks, ["hello world"])

    def test_chunk_text_empty(self):
        self.assertEqual(chunk_text(""), [])


if __name__ == "__main__":
    unittest.main()