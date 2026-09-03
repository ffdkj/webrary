# webrary AI 读书助手架构

## 功能

对用户上传的 EPUB/TXT 建立 RAG 索引，支持对单本书提问。

## 数据流

```
上传/已有书籍
  → app/services/rag.extract_book_text：EPUB 提取 HTML 文本 / TXT 读取 UTF-8
  → chunk_text：按 RAG_CHUNK_SIZE / RAG_CHUNK_OVERLAP 分块
  → EmbeddingProvider：Gemini 多 Key 轮换 → 本地 → hash 回退
  → Chroma collection `book_chunks` 持久化到 data/chroma_books/

用户提问 POST /api/ai/books/{id}/ask
  → LangGraph StateGraph：
      retrieve -> search(query, book_id) 取 Top-K 片段
      generate -> DeepSeek 根据片段生成回答
  → 返回 answer + sources
```

## 主要模块

| 模块 | 职责 |
|---|---|
| `app/services/embeddings.py` | Embedding Provider |
| `app/services/rag.py` | 文本提取、分块、Chroma 索引、检索 |
| `app/routers/ai_reader.py` | `/api/ai/books/{id}/ask`、`/index`、`/status` |

## 配置

参考 `.env.example`：

- `DEEPSEEK_API_KEY`：主 LLM
- `GEMINI_API_KEYS`：Embedding 多 Key
- `RAG_CHUNK_SIZE` / `RAG_CHUNK_OVERLAP`
- `AGENT_MOCK_MODE`：无 Key 演示

## 测试

```bash
python -m unittest discover -s tests -p 'test_*.py'
```