"""AI reader assistant routes for webrary.

Uses a small LangGraph RAG graph:
  retrieve (Chroma) -> generate (DeepSeek)
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user_id
from ..database import fetch_one
from ..schemas import fail, ok
from .rag import get_book_rag_index

router = APIRouter(
    prefix="/api/ai",
    tags=["ai-reader"],
    dependencies=[Depends(get_current_user_id)],
)

SYSTEM_PROMPT = """你是 webrary 的 AI 读书助手。
请只根据提供的书籍片段回答用户问题。
如果片段不足以回答，请明确说“根据目前索引的内容无法回答”。
回答使用中文，保持简洁。"""


class AskRequest(BaseModel):
    question: str
    top_k: int = 6


class IndexRequest(BaseModel):
    force: bool = True


def _get_book(book_id: int):
    book = fetch_one(
        "SELECT id, title, author, file_path, extension FROM books WHERE id = ?",
        (book_id,),
    )
    if book is None:
        raise HTTPException(status_code=404, detail=f"Book not found: {book_id}")
    return book


def _build_graph():
    """Build a two-node RAG graph: retrieve -> generate."""
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_core.tools import tool
        from langchain_openai import ChatOpenAI
        from langgraph.graph import END, StateGraph
        from typing_extensions import TypedDict
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("缺少 LangGraph/LangChain 依赖，请先 pip install -r requirements-agent.txt") from exc

    class RAGState(TypedDict):
        question: str
        book_id: int
        top_k: int
        chunks: List[dict]
        answer: str

    def retrieve(state: RAGState) -> dict:
        chunks = get_book_rag_index().search(
            state["question"],
            book_id=state["book_id"],
            top_k=state.get("top_k", 6),
        )
        return {"chunks": chunks}

    def generate(state: RAGState) -> dict:
        api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("缺少 DEEPSEEK_API_KEY，请在 .env 中配置")
        llm = ChatOpenAI(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            api_key=api_key,
            base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            temperature=float(os.getenv("AGENT_TEMPERATURE", "0.2")),
        )
        context = "\n\n".join(
            f"[片段 {i + 1}]\n{chunk.get('text', '')}" for i, chunk in enumerate(state.get("chunks", []))
        )
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(
                content=f"书籍片段：\n{context}\n\n问题：{state['question']}"
            ),
        ]
        resp = llm.invoke(messages)
        return {"answer": resp.content}

    graph = StateGraph(RAGState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("generate", generate)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "generate")
    graph.add_edge("generate", END)
    return graph.compile()


@router.post("/books/{book_id}/ask")
def ask_book(book_id: int, req: AskRequest):
    """Ask a question about a single book using RAG."""
    book = _get_book(book_id)
    if not req.question.strip():
        return fail("问题不能为空")
    try:
        graph = _build_graph()
        result = graph.invoke(
            {
                "question": req.question.strip(),
                "book_id": book_id,
                "top_k": req.top_k,
                "chunks": [],
                "answer": "",
            }
        )
        chunks = result.get("chunks", [])
        return ok(
            {
                "answer": result.get("answer", ""),
                "bookId": book_id,
                "title": book["title"],
                "sources": [
                    {
                        "text": c.get("text", "")[:200],
                        "score": c.get("score"),
                    }
                    for c in chunks
                ],
            }
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/books/{book_id}/index")
def index_book(book_id: int, req: Optional[IndexRequest] = None):
    """Build/rebuild the RAG index for one book."""
    book = _get_book(book_id)
    path = Path(book["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Book file not found: {path}")
    try:
        result = get_book_rag_index().ingest_book(
            book_id=book_id,
            path=path,
            extension=book["extension"] or "",
            title=book["title"] or "",
            author=book["author"] or "",
        )
        return ok(result)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/books/{book_id}/status")
def book_status(book_id: int):
    """Return whether the book has been indexed."""
    _get_book(book_id)
    try:
        total = get_book_rag_index().count_book(book_id)
        return ok({"bookId": book_id, "indexed": total > 0, "totalChunks": total})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc