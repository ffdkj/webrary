"""RAG service for webrary: build searchable Chroma indexes over book text."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup
from ebooklib import ITEM_DOCUMENT, read_epub

try:
    import chromadb
except Exception:  # pragma: no cover - optional
    chromadb = None

from ..config import PROJECT_ROOT
from .ebook import ensure_epub_conversion, txt_text_utf8
from .embeddings import EmbeddingProvider

CHROMA_DIR = PROJECT_ROOT / "data" / "chroma_books"
COLLECTION_NAME = "book_chunks"
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "100"))


def extract_book_text(path: Path, extension: str) -> str:
    """Extract plain text from EPUB/TXT (and converted MOBI/AZW3)."""
    ext = (extension or "").lower().lstrip(".")
    if ext == "txt":
        return txt_text_utf8(path).decode("utf-8", errors="ignore")

    epub_path = path
    if ext in ("mobi", "azw3"):
        epub_path, ext = ensure_epub_conversion(path, ext)
    if ext != "epub":
        return ""

    try:
        with open(epub_path, "rb") as fh:
            book = read_epub(fh)
        parts = []
        for item in book.get_items_of_type(ITEM_DOCUMENT):
            try:
                content = item.get_content().decode("utf-8", errors="ignore")
            except Exception:
                continue
            soup = BeautifulSoup(content, "html.parser")
            text = soup.get_text("\n", strip=True)
            if text:
                parts.append(text)
        return "\n\n".join(parts)
    finally:
        # If we created a temporary converted file, remove it.
        if epub_path != path:
            epub_path.unlink(missing_ok=True)


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks by character count."""
    text = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if not text:
        return []
    chunks = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        # Prefer breaking near a paragraph boundary.
        if end < n:
            boundary = text.rfind("\n\n", start + chunk_size // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(text[start:end].strip())
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


class BookRAGIndex:
    def __init__(self, chroma_dir: Path = CHROMA_DIR):
        self.chroma_dir = chroma_dir
        self.embedding = EmbeddingProvider()
        self._client: Any = None
        self._collection: Any = None

    @property
    def client(self):
        if chromadb is None:
            raise RuntimeError("chromadb is not installed; run `pip install -r requirements-agent.txt`")
        if self._client is None:
            self.chroma_dir.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(path=str(self.chroma_dir))
        return self._client

    @property
    def collection(self):
        if self._collection is None:
            self._collection = self.client.get_or_create_collection(
                name=COLLECTION_NAME,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    def count(self) -> int:
        try:
            return self.collection.count()
        except Exception:
            return 0

    def ingest_book(self, book_id: int, path: Path, extension: str, title: str = "", author: str = "") -> Dict[str, Any]:
        """Extract text, chunk it, and upsert into Chroma."""
        text = extract_book_text(path, extension)
        if not text:
            return {"status": "error", "reason": "no-text", "book_id": book_id}
        chunks = chunk_text(text)
        if not chunks:
            return {"status": "error", "reason": "no-chunks", "book_id": book_id}

        # Remove previous chunks for this book.
        self.delete_book(book_id)

        ids = [f"{book_id}:{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "book_id": str(book_id),
                "title": title or "",
                "author": author or "",
                "chunk_index": i,
            }
            for i in range(len(chunks))
        ]
        embeddings = self.embedding.embed_texts(chunks)
        self.collection.upsert(
            ids=ids,
            documents=chunks,
            metadatas=metadatas,
            embeddings=embeddings,
        )
        return {"status": "ok", "book_id": book_id, "chunks": len(chunks)}

    def delete_book(self, book_id: int) -> None:
        try:
            self.collection.delete(where={"book_id": str(book_id)})
        except Exception:
            pass

    def count_book(self, book_id: int) -> int:
        try:
            return len(self.collection.get(where={"book_id": str(book_id)}, include=["metadatas"])["ids"])
        except Exception:
            return 0

    def search(self, query: str, book_id: Optional[int] = None, top_k: int = 6) -> List[Dict[str, Any]]:
        query_vec = self.embedding.embed_texts([query])[0]
        where = {"book_id": str(book_id)} if book_id is not None else None
        res = self.collection.query(
            query_embeddings=[query_vec],
            n_results=top_k,
            where=where,
        )
        results: List[Dict[str, Any]] = []
        metadatas = res.get("metadatas") or [[]]
        documents = res.get("documents") or [[]]
        distances = res.get("distances") or [[]]
        for i, meta in enumerate(metadatas[0]):
            item = dict(meta or {})
            item["score"] = 1.0 - float(distances[0][i]) if distances and distances[0] else None
            item["text"] = documents[0][i] if documents and documents[0] else ""
            results.append(item)
        return results


_book_rag_index: Optional[BookRAGIndex] = None


def get_book_rag_index() -> BookRAGIndex:
    global _book_rag_index
    if _book_rag_index is None:
        _book_rag_index = BookRAGIndex()
    return _book_rag_index