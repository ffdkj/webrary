# webrary AI 读书助手演示

## 1. 安装

```bash
pip install -r requirements.txt
pip install -r requirements-agent.txt
```

## 2. 配置

```bash
cp .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY 必填；GEMINI_API_KEYS 用于 Embedding（可选）
```

## 3. 启动

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 4. 先建索引

需要先有用户会话（登录后 Cookie）。以下用 `-b cookies.txt` 保持登录。

```bash
# 上传/已有书籍后，为 bookId=1 建立索引
curl -X POST http://127.0.0.1:8000/api/ai/books/1/index \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"force": true}'
```

## 5. 提问

```bash
curl -X POST http://127.0.0.1:8000/api/ai/books/1/ask \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d '{"question": "这本书的主角有什么特点？", "top_k": 6}'
```

响应示例：

```json
{
  "success": true,
  "message": null,
  "data": {
    "answer": "根据书中片段，主角……",
    "bookId": 1,
    "title": "书名",
    "sources": []
  }
}
```

## 6. 状态

```bash
curl http://127.0.0.1:8000/api/ai/books/1/status -b cookies.txt
```

## 7. 面试讲解要点

- 只对 EPUB/TXT 提取纯文本并分块，避免全文塞给 LLM。
- LangGraph 两节点图：`retrieve` → `generate`，状态在 State 中流转。
- Chroma 持久化在 `data/chroma_books/`，`data/` 已 gitignore。
- Embedding 使用 Gemini 多 Key 轮换，失败自动回退本地/hash。