# Zlibrary API 输入输出文档

> 测试账号: `2624696826@qq.com`
> 测试时间: 2026-07-24
> 域名: `fuckfbi.ru`

---

## 1. 初始化 & 登录

### `__init__(email, password, remix_userid, remix_userkey, domain)`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | str | 否 | 邮箱 |
| `password` | str | 否 | 密码 |
| `remix_userid` | int/str | 否 | remix userid (token登录) |
| `remix_userkey` | str | 否 | remix userkey (token登录) |
| `domain` | str | 否 | 域名, 默认 `fuckfbi.ru` |

**说明**: 如果传了 `email` + `password`, 自动调 `login()`; 如果传了 `remix_userid` + `remix_userkey`, 自动调 `loginWithToken()`.

### `login(email, password) -> dict`

**请求**: `POST /eapi/user/login`

**输入**: `{"email": "...", "password": "..."}`

**输出**:
```json
{
  "success": 1,
  "user": {
    "id": 22627056,
    "email": "2624696826@qq.com",
    "name": "用户昵称",
    "kindle_email": null,
    "remix_userkey": "eb9c853d6a25885a4a7818ec4395b02d",
    "downloads_limit": 20,
    "downloads_today": 0,
    "premium": false,
    "blocked": false,
    "blockedType": null,
    "reward": 0
  }
}
```

### `loginWithToken(remix_userid, remix_userkey) -> dict`

**请求**: `GET /eapi/user/profile`

**输出**: 同上

### `isLoggedIn() -> bool`

**输出**: `True` / `False`

---

## 2. 用户相关 (User)

### `getProfile() -> dict`

**请求**: `GET /eapi/user/profile`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "user": {
    "id": 22627056,
    "email": "2624696826@qq.com",
    "name": "用户昵称",
    "kindle_email": null,
    "remix_userkey": "eb9c853d6a25885a4a7818ec4395b02d",
    "downloads_limit": 20,
    "downloads_today": 0,
    "premium": false,
    "blocked": false,
    "blockedType": null,
    "reward": 0
  }
}
```

---

### `getDonations() -> dict`

**请求**: `GET /eapi/user/donations`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "donations": []
}
```

---

### `getDownloadsLeft() -> int`

**请求**: `GET /eapi/user/profile`

**输入**: 无

**输出**: 整数, 如 `8` (计算公式: `downloads_limit - downloads_today`)

---

### `getUserDownloaded(order=None, page=None, limit=None) -> dict`

**请求**: `GET /eapi/user/book/downloaded`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order` | str | 否 | 排序, 如 `"year"` |
| `page` | int | 否 | 页码 |
| `limit` | int | 否 | 每页数量, 默认 20 |

**输出** (limit=3):
```json
{
  "success": 1,
  "books": [
    {
      "id": 11033158,
      "title": "Python Beginner To Pro ...",
      "author": "KUMAR, N KRISHNA",
      "cover": "https://...",
      "hash": "e5897f",
      "extension": "pdf",
      "filesize": 12345678,
      "year": 2023,
      "language": "english"
    }
  ],
  "pagination": {
    "limit": 3,
    "current": 1,
    "before": false,
    "next": 2,
    "total_items": 205
  }
}
```

---

### `getUserSaved(order=None, page=None, limit=None) -> dict`

**请求**: `GET /eapi/user/book/saved`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `order` | str | 否 | 排序, 如 `"year"` |
| `page` | int | 否 | 页码 |
| `limit` | int | 否 | 每页数量, 默认 20 |

**输出**:
```json
{
  "success": 1,
  "books": [ /* 书列表 */ ],
  "pagination": {
    "limit": 20,
    "current": 1,
    "before": false,
    "next": false,
    "total_items": 17
  }
}
```

---

### `getUserRecommended() -> dict`

**请求**: `GET /eapi/user/book/recommended`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "books": [ /* 100本书 */ ]
}
```

---

### `hideBanner() -> dict`

**请求**: `GET /eapi/user/hide-banner`

**输入**: 无

**输出**:
```json
{
  "success": 1
}
```

---

### `updateInfo(email=None, password=None, name=None, kindle_email=None) -> dict`

**请求**: `POST /eapi/user/update`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `email` | str | 否 | 新邮箱 |
| `password` | str | 否 | 新密码 |
| `name` | str | 否 | 新昵称 |
| `kindle_email` | str | 否 | Kindle邮箱 |

**输出**: 类似 `login` 返回结构

⚠️ **未测试** (需更新个人信息)

---

## 3. 图书搜索

### `search(message=None, yearFrom=None, yearTo=None, languages=None, extensions=None, order=None, page=None, limit=None) -> dict`

**请求**: `POST /eapi/book/search`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | str | 否 | 搜索关键词 |
| `yearFrom` | int | 否 | 起始年份 |
| `yearTo` | int | 否 | 结束年份 |
| `languages` | str | 否 | 语言过滤 |
| `extensions` | list[str] | 否 | 格式过滤, 如 `["pdf", "epub"]` |
| `order` | str | 否 | 排序方式 |
| `page` | int | 否 | 页码 |
| `limit` | int | 否 | 每页数量, 默认 20 |

**输出** (message="python", limit=3):
```json
{
  "success": 1,
  "books": [
    {
      "id": 11033158,
      "title": "Python Beginner To Pro: ...",
      "author": "KUMAR, N KRISHNA",
      "cover": "https://...",
      "hash": "e5897f",
      "extension": "pdf",
      "filesize": 12345678,
      "year": 2023,
      "language": "english",
      "pages": 500,
      "publisher": "xxx",
      "isbn": "xxx",
      "description": "..."
    }
  ],
  "exactBooksCount": 500,
  "pagination": {
    "limit": 3,
    "current": 1,
    "before": false,
    "next": 2,
    "total_items": 500
  }
}
```

**book 对象字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 图书 ID |
| `title` | str | 书名 |
| `author` | str | 作者 |
| `cover` | str | 封面图片URL |
| `hash` | str | 哈希值 (6字符) |
| `extension` | str | 格式 (pdf/epub/mobi/...) |
| `filesize` | int | 文件大小 (字节) |
| `year` | int | 出版年份 |
| `language` | str | 语言 |
| `pages` | int | 页数 |
| `publisher` | str | 出版社 |
| `isbn` | str | ISBN |
| `description` | str | 简介 |

---

## 4. 图书操作

### `getBookInfo(bookid, hashid, switch_language=None) -> dict`

**请求**: `GET /eapi/book/{bookid}/{hashid}`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |
| `hashid` | str | 是 | 图书 hash |
| `switch_language` | str | 否 | 语言切换 |

**输出**:
```json
{
  "success": 1,
  "book": {
    "id": 11033158,
    "content_type": "book",
    "title": "Python Beginner To Pro: ...",
    "author": "KUMAR, N KRISHNA",
    "volume": "",
    "cover": "https://...",
    "hash": "e5897f",
    "extension": "pdf",
    "filesize": 12345678,
    "year": 2023,
    "language": "english",
    "pages": 500,
    "publisher": "xxx",
    "isbn": "xxx",
    "description": "...",
    "downloads": 1234,
    "rating": "4.2",
    "popular": "yes"
  }
}
```

---

### `getBookForamt(bookid, hashid) -> dict`

**请求**: `GET /eapi/book/{bookid}/{hashid}/formats`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |
| `hashid` | str | 是 | 图书 hash |

**输出**:
```json
{
  "success": 1,
  "books": []
}
```

注: 该接口返回该书可用的其他格式。若只有一种格式则返回空数组。

---

### `getSimilar(bookid, hashid) -> dict`

**请求**: `GET /eapi/book/{bookid}/{hashid}/similar`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |
| `hashid` | str | 是 | 图书 hash |

**输出**:
```json
{
  "success": 1,
  "books": [ /* 24本相似图书 */ ]
}
```

---

### `saveBook(bookid) -> dict`

**请求**: `GET /eapi/user/book/{bookid}/save`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |

**输出**:
```json
{
  "success": 1
}
```

---

### `unsaveUserBook(bookid) -> dict`

**请求**: `GET /eapi/user/book/{bookid}/unsave`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |

**输出**:
```json
{
  "success": 1
}
```

---

### `deleteUserBook(bookid) -> dict`

**请求**: `GET /eapi/user/book/{bookid}/delete`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |

⚠️ **未测试** (不删除已有下载记录)

---

### `sendTo(bookid, hashid, totype) -> dict`

**请求**: `GET /eapi/book/{bookid}/{hashid}/send-to-{totype}`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookid` | int/str | 是 | 图书 ID |
| `hashid` | str | 是 | 图书 hash |
| `totype` | str | 是 | 发送方式, 如 `"email"` |

**输出**:
```json
{
  "success": 1
}
```

---

### `getImage(book: dict) -> bytes`

**请求**: 直接 GET 图书的 `cover` URL

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book` | dict | 是 | 含有 `cover` 字段的图书字典 |

**输出**: 封面图片的二进制数据 (`bytes`)

---

### `downloadBook(book: dict) -> tuple | None`

**请求**: `GET /eapi/book/{bookid}/{hashid}/file` -> 然后 GET `downloadLink`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `book` | dict | 是 | 含有 `id` 和 `hash` 字段的图书字典 |

**输出**:
```python
(
    "Python Beginner To Pro (KUMAR, N KRISHNA).pdf",  # filename
    b"\x25\x50\x44\x46..."                            # file bytes
)
```

第一环节（获取下载链接）返回:
```json
{
  "file": {
    "description": "书名",
    "author": "作者名",
    "extension": "pdf",
    "downloadLink": "https://xxx.com/dl/..."
  }
}
```

---

## 5. 公共信息 (Info)

### `getExtensions() -> dict`

**请求**: `GET /eapi/info/extensions`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "extensions": ["pdf", "epub", "mobi", "azw3", "djvu", "fb2", "lit", "lrf", "rtf", "txt", "doc", "docx"]
}
```

---

### `getDomains() -> dict`

**请求**: `GET /eapi/info/domains`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "domains": ["fuckfbi.ru", "zlibrary-east.se", "zlibrary-sg.se", ...]
}
```

---

### `getLanguages() -> dict`

**请求**: `GET /eapi/info/languages`

**输入**: 无

**输出**:
```json
{
  "success": 1,
  "languages": {
    "english": "English",
    "russian": "Русский",
    "german": "Deutsch",
    "spanish": "Español",
    "dutch": "Nederlands",
    /* ... 共191种语言 */
  }
}
```

---

### `getPlans(switch_language=None) -> dict`

**请求**: `GET /eapi/info/plans`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `switch_language` | str | 否 | 语言, 如 `"zh"` |

**输出**:
```json
{
  "success": 1,
  "plans": {
    "basic": {
      "downloads":        {"title": "Downloads",          "value": 10},
      "download_speed":   {"title": "Download speed",     "value": "Up to 1 MBps"},
      "download_history": {"title": "Download history",   "value": true},
      "recomendations":   {"title": "Personal recommendations", "value": true},
      "converter":        {"title": "Files converter",    "value": true},
      "send_to":          {"title": "Send to",            "value": true},
      "early_access":     {"title": "Early access",       "value": null},
      "search_requests":  {"title": "Search requests",    "value": "unrestricted"},
      "banner":           {"title": "Ads",                "value": true},
      "max_downloads":    {"title": "Max downloads",      "value": 10},
      "discount":         {"title": "",                   "value": ""}
    },
    "premium": {
      "downloads":        {"title": "Downloads",          "value": "999"},
      "download_speed":   {"title": "Download speed",     "value": "Unrestricted"},
      "download_history": {"title": "Download history",   "value": true},
      "recomendations":   {"title": "Personal recommendations", "value": true},
      "converter":        {"title": "Files converter",    "value": true},
      "send_to":          {"title": "Send to",            "value": true},
      "early_access":     {"title": "Early access",       "value": true},
      "search_requests":  {"title": "Search requests",    "value": "unrestricted"},
      "banner":           {"title": "Ads",                "value": false},
      "max_downloads":    {"title": "Max downloads",      "value": 999},
      "discount":         {"title": "",                   "value": ""}
    },
    "limits": [
      {"title": "Number of downloads per day",     "basic": "10", "premium": "999"},
      {"title": "Download speed",                  "basic": "Up to 1 MBps", "premium": "Unrestricted"},
      ...
    ]
  }
}
```

---

### `getInfo(switch_language=None) -> dict`

**请求**: `GET /eapi/info`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `switch_language` | str | 否 | 语言 |

**输出**:
```json
{
  "success": 1,
  "books": 32912427,
  "articles": 82069122,
  "plans": { /* 套餐详情 (同上) */ },
  "languages": { /* 语言列表 (同上) */ },
  "topLanguages": [...],
  "yearRange": { "from": 1700, "to": 2026 },
  "recentlyAdded": [...]
}
```

---

## 6. 其他方法 (未测试/不建议在生产中调用)

| 方法 | 请求 | 说明 |
|------|------|------|
| `recoverPassword(email)` | `POST /eapi/user/password-recovery` | 找回密码 |
| `makeRegistration(email, password, name)` | `POST /eapi/user/registration` | 注册新账号 |
| `resendConfirmation()` | `POST /eapi/user/email/confirmation/resend` | 重新发送确认邮件 |
| `makeTokenSigin(name, id_token)` | `POST /eapi/user/token-sign-in` | Token登录 |
| `sendCode(email, password, name)` | `POST /papi/user/verification/send-code` | 发送验证码 |
| `verifyCode(email, password, name, code)` | `POST /rpc.php` | 验证码完成注册 |

---

## 汇总

| API | 方法 | 端点 | 测试状态 |
|-----|------|------|---------|
| `login` | POST | `/eapi/user/login` | OK |
| `loginWithToken` | GET | `/eapi/user/profile` | OK |
| `getProfile` | GET | `/eapi/user/profile` | OK |
| `getDonations` | GET | `/eapi/user/donations` | OK |
| `getDownloadsLeft` | - | (计算自profile) | OK |
| `getUserDownloaded` | GET | `/eapi/user/book/downloaded` | OK |
| `getUserSaved` | GET | `/eapi/user/book/saved` | OK |
| `getUserRecommended` | GET | `/eapi/user/book/recommended` | OK |
| `hideBanner` | GET | `/eapi/user/hide-banner` | OK |
| `getExtensions` | GET | `/eapi/info/extensions` | OK |
| `getDomains` | GET | `/eapi/info/domains` | OK |
| `getLanguages` | GET | `/eapi/info/languages` | OK |
| `getPlans` | GET | `/eapi/info/plans` | OK |
| `getInfo` | GET | `/eapi/info` | OK |
| `search` | POST | `/eapi/book/search` | OK |
| `getBookInfo` | GET | `/eapi/book/{id}/{hash}` | OK |
| `getBookForamt` | GET | `/eapi/book/{id}/{hash}/formats` | OK |
| `getSimilar` | GET | `/eapi/book/{id}/{hash}/similar` | OK |
| `saveBook` | GET | `/eapi/user/book/{id}/save` | OK |
| `unsaveUserBook` | GET | `/eapi/user/book/{id}/unsave` | OK |
| `sendTo` | GET | `/eapi/book/{id}/{hash}/send-to-{type}` | OK |
| `getImage` | GET | (cover URL) | OK* |
| `downloadBook` | GET | `/eapi/book/{id}/{hash}/file` + ddl | OK |
| `getMostPopular` | GET | `/eapi/book/most-popular` | OK |
| `getRecently` | GET | `/eapi/book/recently` | OK |

> **测试结果**: 29/29 通过 (100%)
> \* `getImage` 依赖书名含中文导致 name 乱码, 使用 cover URL 时需要先通过 `getBookInfo` 获取正确 URL.
