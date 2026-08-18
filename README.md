# Webrary FastAPI

Webrary 的 FastAPI 后端版本，包含完整前端静态资源，可直接部署使用。

## 功能

- 书架、上传、阅读进度、继续阅读
- EPUB / PDF / TXT / MOBI / AZW3 阅读支持
- Z-Library 搜索、下载、高级筛选、无限滚动
- 书签与摘抄（EPUB CFI / TXT 页码偏移），多用户隔离
- 会话登录与注册开关设置
- PWA 离线阅读：EPUB / MOBI / AZW3 / FB2 / TXT 可缓存到浏览器本地
  （Origin Private File System），断网也能阅读；PDF 暂不支持离线缓存

## PWA 离线缓存（OPFS）

书籍文件（除 PDF 外）会写入浏览器的 **Origin Private File System (OPFS)**，
不占用服务器磁盘，且与原页面同源隔离。

- **缓存方式**：书架卡片上的「离线缓存」按钮、右键菜单「缓存到本地（离线阅读）」、
  阅读器工具栏的缓存按钮；打开已缓存书籍时自动加载本地副本。
- **离线阅读**：EPUB 全本缓存后再无网络请求；TXT 在客户端按与服务端一致的算法
  重建页码与目录（`static/js/txt-pagination.js`），页码与在线模式一致。
- **进度补传**：离线阅读进度先存入本地队列，恢复联网后自动同步到服务器。
- **管理**：设置页「离线缓存（OPFS）」可查看占用、删除单个或清除全部。
- **实现文件**：`static/js/opfs-cache.js`（OPFS 读写/索引）、`static/js/txt-pagination.js`
  （TXT 分页移植）、`static/js/pwa.js`（网络状态 + 进度队列）、`static/sw.js`（应用壳缓存）。
- 校验命令：
  ```bash
  PYTHONPATH=. python3 tests/gen_txt_parity_data.py tests/data/txt_parity
  node tests/test_txt_pagination_parity.js tests/data/txt_parity
  ```

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
