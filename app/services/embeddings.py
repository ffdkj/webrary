"""Embedding provider for webrary RAG.

Supports Gemini Embedding (multi-key) with a deterministic hash fallback.
Local sentence-transformers can be enabled by installing the optional dependency.
"""

from __future__ import annotations

import hashlib
import os
import threading
from typing import List

try:
    from google import genai
except Exception:  # pragma: no cover - optional
    genai = None

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # pragma: no cover - optional
    SentenceTransformer = None

GEMINI_EMBED_MODELS = ("text-embedding-004", "gemini-embedding-001", "models/text-embedding-004")
DEFAULT_DIM = 256


def _load_gemini_keys() -> List[str]:
    raw = os.getenv("GEMINI_API_KEYS", "").strip()
    if not raw:
        return []
    parts = raw.replace("，", ",").replace("\n", ",").split(",")
    return [p.strip() for p in parts if p.strip()]


class HashEmbedding:
    def __init__(self, dimensions: int = DEFAULT_DIM):
        self.dimensions = dimensions

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        vectors = []
        for text in texts:
            vec = [0.0] * self.dimensions
            tokens = self._tokenize(text)
            for token in tokens:
                digest = hashlib.md5(token.encode("utf-8")).digest()
                idx = int.from_bytes(digest[:4], "little") % self.dimensions
                sign = 1.0 if digest[4] % 2 == 0 else -1.0
                vec[idx] += sign
            norm = sum(x * x for x in vec) ** 0.5
            if norm > 0:
                vec = [x / norm for x in vec]
            vectors.append(vec)
        return vectors

    def _tokenize(self, text: str) -> List[str]:
        text = (text or "").lower()
        tokens = []
        for i in range(len(text)):
            ch = text[i]
            if ch.isalnum():
                tokens.append(ch)
                if i + 1 < len(text) and text[i + 1].isalnum():
                    tokens.append(text[i:i + 2])
        return tokens or [text]


class EmbeddingProvider:
    def __init__(self):
        self.gemini_keys = _load_gemini_keys()
        self._key_index = 0
        self._lock = threading.Lock()
        self._local_model = None
        self._local_model_name = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-zh-v1.5")

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        if self.gemini_keys:
            try:
                return self._gemini_embed(texts)
            except Exception as exc:
                print(f"[WebraryEmbedding] Gemini failed, falling back: {exc}")
        try:
            return self._local_embed(texts)
        except Exception as exc:
            print(f"[WebraryEmbedding] Local embedding failed, using hash fallback: {exc}")
        return HashEmbedding().embed_texts(texts)

    def _next_key(self) -> str:
        with self._lock:
            key = self.gemini_keys[self._key_index % len(self.gemini_keys)]
            self._key_index += 1
            return key

    def _gemini_embed(self, texts: List[str]) -> List[List[float]]:
        if genai is None:
            raise RuntimeError("google-genai is not installed")
        results: List[List[float]] = []
        batch_size = 16
        for start in range(0, len(texts), batch_size):
            batch = texts[start:start + batch_size]
            last_error = None
            for _ in range(len(self.gemini_keys)):
                key = self._next_key()
                try:
                    client = genai.Client(api_key=key)
                    for model in GEMINI_EMBED_MODELS:
                        try:
                            resp = client.models.embed_content(model=model, contents=batch)
                            embeddings = [item.values for item in resp.embeddings]
                            if embeddings:
                                results.extend(embeddings)
                                last_error = None
                                break
                        except Exception as exc:
                            last_error = exc
                    if last_error is None:
                        break
                except Exception as exc:
                    last_error = exc
            if last_error is not None:
                raise last_error
        return results

    def _local_embed(self, texts: List[str]) -> List[List[float]]:
        if SentenceTransformer is None:
            raise RuntimeError("sentence-transformers is not installed")
        if self._local_model is None:
            self._local_model = SentenceTransformer(self._local_model_name)
        embeddings = self._local_model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()