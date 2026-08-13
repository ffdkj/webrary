# Webrary FastAPI

Webrary 的 FastAPI 后端版本，包含完整前端静态资源，可直接部署使用。

## 功能

- 书架、上传、阅读进度、继续阅读
- EPUB / PDF / TXT / MOBI / AZW3 阅读支持
- Z-Library 搜索、下载、高级筛选、无限滚动
- 书签与摘抄（EPUB CFI / TXT 页码偏移），多用户隔离
- 会话登录与注册开关设置

## 本地运行

```bash
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

首次启动会自动创建 SQLite 数据库与全部表结构。数据库和上传文件存放在 `data/` 目录。

## Docker 部署

```bash
docker compose up -d --build
```

服务默认监听 `http://localhost:8000`。数据卷挂载在 `./data:/app/data`，升级或重建容器不会丢失数据。

生产环境请至少设置：

```bash
export SESSION_SECRET="a-long-random-secret"
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | dev secret | 会话签名密钥，生产环境必须修改 |
| `Z_LIBRARY_DEFAULT_DOMAIN` | `fuckfbi.ru` | Z-Library 默认域名 |
| `MAX_UPLOAD_BYTES` | `209715200` | 单文件上传大小上限（200MB） |
| `WEBRARY_DB` | `data/webrary.db` | 数据库文件路径 |
| `WEBRARY_UPLOAD_DIR` | `data/uploads` | 上传文件目录 |
| `WEBRARY_STATIC_DIR` | `static` | 前端静态资源目录 |

## 测试

```bash
python -m unittest discover -s tests
```
