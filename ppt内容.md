# Webrary 个人数字图书馆系统项目介绍

---

# 项目概述

## 项目定位

Webrary 是一个基于 Web 技术构建的个人数字图书馆系统。项目名称融合了 "Web" 与 "Library"，体现了系统的核心理念——通过浏览器即可访问个人的完整数字图书馆，无需安装任何客户端软件。

系统支持用户上传、管理和在线阅读电子书资源，通过浏览器即可完成从书籍存储、分类管理到沉浸式阅读的完整流程。

## 核心目标

项目旨在解决传统电子书管理方式中存在的诸多痛点：电子书文件分散存储于不同设备，难以统一管理；本地阅读软件受限于特定设备；更换设备后阅读进度无法同步；书籍信息缺少结构化的管理与检索手段；查找和整理大量电子书效率低下。

Webrary 通过 Web 化架构实现以下目标：

* 集中管理个人电子书资源，建立统一的图书数据库
* 支持跨平台、跨设备访问，随时随地进行阅读
* 在线解析并阅读电子书，摆脱客户端依赖
* 自动保存阅读进度，实现多设备无缝切换
* 提供个人书架管理，建立个性化阅读空间


## 功能全景

项目实现了电子书资源管理、在线阅读、个人书架、阅读历史记录、阅读进度同步等核心功能，并支持 EPUB、PDF、TXT 等主流电子书格式。同时集成了 Z-Library 资源接口，扩展了用户的资源获取渠道，形成了从"资源获取 → 图书管理 → 在线阅读 → 进度同步"的完整数字阅读闭环。

---

# 项目背景与需求分析

## 行业背景

随着数字化阅读的普及，个人积累的电子书资源日益增多。然而，传统电子书管理方式存在以下突出问题：

### 传统电子书管理的痛点

| 问题 | 具体表现 |
|------|---------|
| 文件分散存储 | 电子书文件散落在不同设备的文件夹中，缺乏统一管理入口 |
| 设备限制 | 本地阅读软件绑定特定设备，换设备后需要手动传输文件 |
| 进度割裂 | 更换设备后阅读进度无法同步，需要重新查找上次阅读位置 |
| 整理低效 | 查找和整理大量电子书效率低下，缺乏分类与过滤能力 |
| 格式壁垒 | 不同格式（EPUB/PDF/TXT）需要不同的阅读软件，切换繁琐 |

### 现有解决方案的不足

* 本地阅读器（如 Calibre）：功能强大但需要安装客户端，不支持在线访问
* 云存储方案（如网盘）：可以文件同步但无法在线阅读，缺乏阅读进度管理
* 商业阅读平台（如 Kindle）：生态封闭，无法容纳个人已有的电子书资源
* 开源阅读系统（如 Kavita、Komga）：功能偏向漫画/小说，对多格式电子书支持有限

## 项目解决方案

Webrary 针对上述痛点，提供一套基于浏览器的完整解决方案：

```
                        Webrary 解决方案

    传统痛点                              Webrary 应对

  文件分散存储    ────────→    集中式 Web 管理平台
  设备限制明显    ────────→    浏览器访问，全平台通用
  进度无法同步    ────────→    服务端存储，自动同步
  信息缺失        ────────→    自动元数据解析入库
  整理低效        ────────→    书架分类 + 搜索 + 筛选
  格式壁垒        ────────→    统一在线阅读（EPUB/PDF/TXT）
```

### 目标用户群体

* **个人电子书爱好者**：拥有大量电子书文件，需要一个统一管理平台
* **家庭用户**：希望建立家庭共享数字图书馆，集中管理家庭成员的阅读资源
* **NAS/私有云用户**：需要在自有服务器上部署私有化阅读服务
* **技术爱好者**：偏好开源可控的解决方案，重视数据自主权

---

# 系统模块总览

Webrary 按职责划分为四大核心模块，各模块职责清晰、边界明确，方便团队协作与后期维护：

```
┌─────────────────────────────────────────────────────────┐
│                    Webrary 系统架构                       │
├───────────────┬───────────────┬───────────────┬─────────┤
│  webrary-     │  webrary-     │  webrary-     │ webrary-│
│  common       │  auth         │  biz          │ zlibrary│
│  公共基础      │  用户认证      │  核心业务      │ Z-Lib   │
├───────────────┼───────────────┼───────────────┼─────────┤
│ · 实体定义     │ · 注册登录    │ · 书架管理     │ · API   │
│ · 数据仓储     │ · Session管理 │ · 图书管理     │   对接  │
│ · DTO传输     │ · 拦截器      │ · 在线阅读器   │ · 在线  │
│ · 全局配置     │ · 密码加密    │ · 阅读进度     │   搜索  │
│ · 数据库设计   │ · 数据隔离    │ · 格式解析     │ · 异步  │
│               │               │ · 前端SPA     │   下载  │
└───────────────┴───────────────┴───────────────┴─────────┘
```

---

# 模块一：webrary-common —— 公共基础

> 演示人：成员A  
> 职责：项目概述、技术架构、数据库设计、部署方式  
> 代码范围：entities, repos, DTOs, config

## 1.1 模块定位

`webrary-common` 是整个系统的底层基础设施模块，为其他三个业务模块提供统一的数据模型、持久化接口和全局配置。所有模块都依赖 common 层中定义的实体类、Repository 接口和 DTO 传输对象，确保系统的数据一致性和代码复用。

## 1.2 系统技术架构

### 后端技术栈

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| Spring Boot 3.5 | 应用框架 | 生态成熟、自动配置、社区活跃 |
| Spring Data JPA + Hibernate | ORM 层 | 简化数据访问、支持自定义 JPQL 查询 |
| SQLite | 嵌入式数据库 | 零配置、单文件存储、适合个人部署 |
| Apache PDFBox | PDF 解析与渲染 | 纯 Java 实现，无需外部依赖 |
| RESTful API | 接口设计 | 前后端分离、标准化交互 |

### 前端技术栈

| 技术 | 用途 | 选型理由 |
|------|------|---------|
| HTML5 + CSS3 + Vanilla JS | 前端框架 | 无框架依赖，减少打包体积 |
| epub.js | EPUB 渲染引擎 | 成熟的 Web 端 EPUB 阅读方案 |
| Foliate.js | 阅读组件库 | 增强阅读交互体验 |
| 自定义暗色主题 | UI 设计系统 | 护眼阅读、统一视觉风格 |

### 文件处理能力

| 格式 | 解析方式 | 提取内容 |
|------|---------|---------|
| EPUB | ZIP解压 → NCX/XHTML 目录提取 | 书名、作者、封面、目录结构 |
| PDF | PDFBox 打开 → 信息/大纲提取 | 书名、页面数、目录大纲 |
| TXT | 编码检测 → 章节正则匹配 | 章节分页、编码识别 |

## 1.3 系统架构设计

系统采用经典三层架构 + SPA 前端的分层设计：

```
┌────────────────────────────────────────────┐
│              用户浏览器                       │
├────────────────────────────────────────────┤
│          Web 前端（SPA 单页应用）              │
│      index.html │ reader.html │ app.js      │
├────────────────────────────────────────────┤
│         Spring Boot 后端服务                  │
│  ┌───────────┬───────────┬───────────────┐  │
│  │Controller │  Service  │  Repository   │  │
│  │  接口层    │  业务层    │   数据层       │  │
│  └───────────┴───────────┴───────────────┘  │
├────────────────────────────────────────────┤
│   SQLite 数据库  +  电子书文件存储            │
└────────────────────────────────────────────┘
```

### 各层职责

| 层级 | 包含组件 | 职责描述 |
|------|---------|---------|
| **Controller 层** | BookController, AuthController, BookshelfController, ZlibraryController | 接收 HTTP 请求、参数校验、JSON 响应、路由分发 |
| **Service 层** | BookService, AuthService, DownloadService, EbookParserService, ZlibraryService | 核心业务逻辑处理、电子书格式解析、下载任务调度 |
| **Repository 层** | BookRepository, ShelfBookRepository, UserRepository, ReadingProgressRepository | JPA 数据持久化、自定义 JPQL 查询、事务管理 |
| **Model 层** | Book, Bookshelf, ShelfBook, User, ReadingProgress, UserZlibrary | JPA 实体映射数据库表，定于数据模型 |

## 1.4 数据库设计（SQLite）

### 核心数据表

| 表名 | 说明 | 关键字段 | 关联关系 |
|------|------|---------|---------|
| users | 用户表 | id, email, password_hash, salt | 1:N → bookshelves |
| books | 图书表 | id, title, author, extension, file_path, cover_url | N:M → bookshelves (via shelf_books) |
| bookshelves | 书架表 | id, user_id, name, sort_order | 1:N → shelf_books |
| shelf_books | 书架-图书关联表 | id, shelf_id, book_id | UNIQUE(shelf_id, book_id) |
| reading_progress | 阅读进度表 | id, user_id, book_id, current_page, total_pages, finished | user_id + book_id 唯一 |
| user_zlibrary | Z-Library 配置表 | id, user_id, zlib_token, zlib_user_id | 1:1 → users |

### 实体关系图

```
Users ──1:N──→ Bookshelves ──1:N──→ ShelfBooks ──N:1──→ Books
  │                                                         │
  └──1:N──→ ReadingProgress ──N:1──────────────────────────┘
  │
  └──1:1──→ UserZlibrary
```

## 1.5 项目亮点 —— 轻量化部署

### 为什么选择 SQLite？

* 零配置：无需安装和配置独立数据库服务，开箱即用
* 单文件存储：数据库就是一个文件，备份和迁移极其简便
* 嵌入式架构：随应用一起启动，减少系统依赖
* 适用场景：个人/家庭部署场景下，SQLite 完全满足性能需求

### Docker 容器化部署

```bash
# 一键部署，映射数据目录确保数据持久化
docker run -d \
  -p 8080:8080 \
  -v ./data:/app/data \
  20off/webrary:1.1
```

部署特点：
* 多阶段构建优化（Maven 编译 → Alpine JRE 运行），镜像体积仅约 150MB
* 通过 `-v` 挂载数据目录，数据库和电子书文件持久保存在宿主机
* 适合个人服务器、NAS、云服务器等多种部署环境
* 单命令启动，无需额外环境配置

### 支持的部署场景

| 场景 | 说明 |
|------|------|
| 个人 PC | 本地运行，localhost:8080 访问 |
| NAS 设备 | 群晖/威联通 Docker 套件一键部署 |
| 云服务器 | 阿里云/腾讯云等轻量应用服务器 |
| 树莓派 | ARM 架构支持，低功耗家庭服务器 |

---

# 模块二：webrary-auth —— 用户认证

> 演示人：成员B  
> 职责：注册登录、会话管理、权限控制  
> 代码范围：AuthController, AuthService, AuthInterceptor, User entity

## 2.1 用户认证系统概述

`webrary-auth` 负责整个系统的用户身份认证与权限控制，实现用户账户的注册、登录与状态管理，确保每个用户的书籍数据相互隔离，是多用户体系的安全基石。

**核心设计原则**：
* 每个用户拥有独立的书库空间，数据完全隔离
* 基于 Session 的认证机制，简单可靠
* 密码采用盐值哈希存储，保障安全性
* 拦截器统一处理认证逻辑，减少业务代码侵入

**主要功能**：
* 用户注册（邮箱 + 密码）
* 用户登录与登出
* Session 会话管理
* 用户数据隔离
* 登录状态持久化（Session 有效期管理）

## 2.2 技术实现

### 密码安全方案

系统采用 **盐值 + SHA-256** 的密码存储策略：

```
注册流程：
  用户明文密码 + 随机16字节盐值 → SHA-256 → 哈希值
  存储格式：salt:hash（盐值与哈希值用冒号分隔）

登录验证：
  输入密码 + 数据库中盐值 → SHA-256 → 比对存储的哈希值
```

安全考量：
* 每次注册生成随机 16 字节盐值，避免相同密码产生相同哈希
* SHA-256 作为主流安全哈希算法，兼顾安全性与性能
* 盐值和哈希值分离存储，增加暴力破解难度

### AuthInterceptor 认证拦截器

```java
public class AuthInterceptor implements HandlerInterceptor {
    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) {
        // 1. 放行登录/注册接口（白名单机制）
        if (isAuthApi(request.getRequestURI())) return true;

        // 2. 放行静态资源（CSS/JS/图片等）
        if (isStaticResource(request.getRequestURI())) return true;

        // 3. 校验 Session 中的用户登录状态
        HttpSession session = request.getSession(false);
        if (session != null && session.getAttribute("user") != null) {
            return true;
        }

        // 4. 未登录 → 返回 401 未授权
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"error\":\"未登录，请先登录\"}");
        return false;
    }
}
```

拦截器设计特点：
* 白名单机制：显式声明哪些接口无需认证，其余全部拦截
* 统一响应格式：所有 401 响应返回统一 JSON 格式
* 低侵入性：业务 Controller 无需编写认证逻辑

### AuthController 端点设计

| 端点 | 方法 | 功能说明 | 认证要求 |
|------|------|---------|---------|
| /api/auth/register | POST | 用户注册（邮箱 + 密码） | 无需认证 |
| /api/auth/login | POST | 用户登录，建立 Session | 无需认证 |
| /api/auth/logout | POST | 用户登出，销毁 Session | 需认证 |
| /api/auth/me | GET | 获取当前登录用户信息 | 需认证 |

## 2.3 认证流程全景

```
┌─────────┐     ┌──────────────┐     ┌──────────────┐
│  新用户   │     │  注册接口      │     │  数据库        │
│  注册     │────→│  /register    │────→│  users 表      │
└─────────┘     │  生成盐值      │     │  存储 salt:hash│
                └──────────────┘     └──────────────┘

┌─────────┐     ┌──────────────┐     ┌──────────────┐
│  用户     │     │  登录接口      │     │  数据库        │
│  登录     │────→│  /login       │────→│  查询用户      │
└─────────┘     │  盐值+密码哈希  │     │  比对哈希值    │
                │  写入 Session   │     └──────────────┘
                └──────┬─────────┘
                       │ Session 建立
                       ↓
┌─────────────────────────────────────────────────┐
│  后续所有请求                                      │
│  → AuthInterceptor 检查 Session                   │
│  → 有 Session → 放行，执行业务逻辑                   │
│  → 无 Session → 返回 401，前端跳转登录页              │
└─────────────────────────────────────────────────┘
```

---

# 模块三：webrary-biz —— 核心业务

> 演示人：成员C  
> 职责：书架管理、图书管理、在线阅读器、阅读进度  
> 代码范围：BookshelfController, BookController, BookshelfService, BookService, EbookParserService, 前端 JS/HTML/CSS

## 3.1 模块定位

`webrary-biz` 是系统的业务核心模块，承载了电子书管理、在线阅读、书架组织三大核心业务场景。该模块横跨前后端，后端负责数据管理和格式解析，前端负责用户交互和阅读渲染，是系统功能最密集、用户感知最强的模块。

## 3.2 电子书管理系统

### 上传功能

用户可以上传自己的电子书文件（支持 EPUB / PDF / TXT），系统自动保存并入库：

**上传流程**：
1. 用户拖拽或点击选择本地电子书文件
2. 选择目标书架（或创建新书架）
3. 文件上传至服务端存储
4. 自动解析元数据（书名、作者、封面、目录）
5. 生成图书记录并入库
6. 前端实时显示新增图书

**支持格式**：

| 格式 | 扩展名 | 处理方式 |
|------|--------|---------|
| EPUB | .epub | ZIP解压 → XML解析 → 提取元数据与目录 |
| PDF | .pdf | PDFBox解析 → 提取信息与大纲 |
| TXT | .txt | 编码检测 → 正则匹配章节 |

### 元数据自动解析

系统通过 `EbookParserService` 自动提取电子书的关键信息，减少用户手动录入成本：

```java
// EbookParserService 核心解析流程
public EbookMetadata parse(Path filePath) {
    String ext = getExtension(filePath).toLowerCase();
    return switch (ext) {
        case "epub" -> parseEpub(filePath);
            // EPUB: ZIP解压 → 读取 container.xml 确定根文件
            //     → 解析 .opf 获取元数据 → 解析 NCX 获取目录
            //     → 提取 cover 封面图片
        case "pdf"  -> parsePdf(filePath);
            // PDF: PDFBox PDDocument.load() 打开文档
            //     → getDocumentInformation() 提取标题/作者
            //     → getDocumentCatalog() 提取目录大纲
        case "txt"  -> parseTxt(filePath);
            // TXT: juniversalchardet 检测文件编码
            //     → 正则匹配 "第X章" 式章节标题
            //     → 按章节拆分页面
        default -> throw new UnsupportedFormatException(ext);
    };
}
```

解析内容包括：

| 提取项 | 说明 | 来源 |
|--------|------|------|
| 书名 | 书籍标题 | OPF metadata / PDF info / 文件名 fallback |
| 作者 | 作者名称 | OPF creator / PDF author |
| 封面 | 书籍封面图片 | EPUB cover image / PDF 首页渲染 |
| 目录 | 章节结构 | NCX navMap / PDF outline / TXT 正则 |
| 文件信息 | 大小、格式、页数 | 文件系统属性 |

### 图书管理操作

用户可对个人书库进行多种管理操作：

| 操作 | 触发方式 | 说明 |
|------|---------|------|
| 查看全部图书 | 书架列表 | 展示个人所有书籍（网格/列表视图） |
| 按书架筛选 | 点击书架 | 查看指定书架下的图书集合 |
| 搜索图书 | 搜索框输入 | 按书名/作者实时搜索过滤 |
| 迁移书架 | 右键菜单 | 将图书移动到其他书架，支持批量操作 |
| 标记已读/未读 | 右键菜单 | 手动标记阅读状态 |
| 下载图书文件 | 右键菜单 | 下载电子书原始文件 |
| 删除图书 | 右键菜单 | 从书库中移除图书及关联文件 |
| 拖拽迁移 | 鼠标拖拽 | 拖动图书卡片到目标书架完成迁移 |

## 3.3 在线电子书阅读器

无需安装任何客户端软件，打开浏览器即可获得完整的阅读体验。

### EPUB 阅读

基于 **epub.js** 渲染引擎，提供沉浸式阅读体验：

| 功能 | 实现方式 | 用户体验 |
|------|---------|---------|
| 章节解析 | NCX/XHTML 自动提取 | 自动识别章节目录结构 |
| 目录侧边栏 | 点击展开/收起 | 快速跳转目标章节 |
| 连续阅读 | 滚动翻页 | 支持上下/左右翻页模式 |
| 进度记录 | 自动保存章节+位置 | 下次打开直接继续阅读 |
| 字体调节 | CSS 变量动态设置 | 字体大小/行间距可调 |
| 主题切换 | 明/暗/护眼三套主题 | 适应不同光线环境 |

### PDF 阅读

PDF 阅读通过服务端渲染 + 前端展示的方式实现：

```
PDF 文件
    │
    ▼
┌──────────────────────────┐
│ PDFBox 服务端渲染          │
│ · 解析 PDF 页面           │
│ · 渲染为 PNG 图片          │
│ · 提取目录大纲             │
└──────────┬───────────────┘
           │ PNG 图片流
           ▼
┌──────────────────────────┐
│ 前端 PDF 阅读器            │
│ · 单页/双页模式切换        │
│ · 适配宽度/适配高度        │
│ · 智能预加载（0~10页）     │
│ · 页码跳转与进度显示        │
│ · 大纲侧边栏导航           │
└──────────────────────────┘
```

**智能预加载机制**：
* 当前阅读页前后可配置预加载页数（默认 5 页）
* 平滑翻页体验，减少等待加载时间
* 预加载队列自动清理，控制内存占用

## 3.4 个人书架系统

实现类似实体书架的数字化管理体验，让用户像整理实体书一样整理数字图书。

### 书架核心功能

| 功能 | 操作方式 | 技术实现 |
|------|---------|---------|
| 创建书架 | 点击"新建书架"按钮 | 前端弹窗 + POST 接口 |
| 拖拽排序 | 鼠标拖拽书架卡片 | sort_order 字段 + 拖拽事件处理 |
| 重命名书架 | 右键菜单 → 编辑名称 | PUT 接口更新 name 字段 |
| 删除书架 | 右键菜单 → 确认删除 | 级联处理：书架删除后图书仍保留 |
| 添加图书 | 上传时选择目标书架 | 创建 ShelfBook 关联记录 |
| 迁移图书 | 右键菜单 → 选择目标 | 更新 shelf_id，支持批量 |
| 进度统计 | 书架头部进度条 | count + group by finished 聚合查询 |

### 书架数据模型

```
Bookshelf（书架）
  ├── id
  ├── user_id        → 所属用户
  ├── name            → 书架名称
  ├── sort_order      → 排序序号
  └── shelf_books     → 一对多关联 ShelfBook

ShelfBook（书架-图书关联）
  ├── shelf_id        → 所属书架
  └── book_id         → 关联图书（UNIQUE 约束）
```

## 3.5 阅读历史与进度同步

系统自动记录用户的阅读状态，实现「打开网页即可继续上次阅读」的无感体验。

### 进度记录机制

```
阅读中自动保存：
  · 当前阅读位置（EPUB: 章节+段落 | PDF: 页码）
  · 阅读时间戳（创建时间 + 最近更新时间）
  · 阅读进度百分比（已读页数 / 总页数）
  · 是否完成（finished 标记）

ReadingProgress 表结构：
  ┌─────────────┬────────────────────────────────────┐
  │ user_id      │ 关联用户                           │
  │ book_id      │ 关联图书                           │
  │ current_page │ 当前页码/章节位置                   │
  │ total_pages  │ 总页数                             │
  │ page_data    │ JSON 扩展数据（章节名、段落位置等）   │
  │ finished     │ 是否读完（布尔标记）                 │
  │ created_at   │ 首次阅读时间                        │
  │ updated_at   │ 最近阅读时间                        │
  └─────────────┴────────────────────────────────────┘
```

### 历史页面

| 功能 | 说明 |
|------|------|
| 进度百分比 | 每个图书卡片显示阅读进度环形图 |
| 一键继续 | 点击"继续阅读"直接跳转到上次位置 |
| 阅读时间线 | 历史页面按时间倒序列出近期阅读记录 |
| 标记已读/未读 | 手动管理阅读状态，支持批量标记 |

## 3.6 前端架构

采用 **Vanilla JavaScript SPA** 单页应用架构，零框架依赖：

| 文件 | 说明 | 规模 |
|------|------|------|
| index.html | 主页面：书架网格、搜索栏、图书详情弹窗、上传弹窗、右键菜单 | 主入口 |
| reader.html | 阅读器页面：EPUB/PDF/TXT 渲染容器、目录侧边栏、工具栏 | 阅读入口 |
| app.js | SPA 路由分发、全局状态管理、API 封装调用、UI 交互逻辑 | ~2800 行 |
| reader.js | 阅读器核心逻辑：epub.js 初始化、PDF 渲染、进度上报、预加载 | ~1050 行 |
| style.css | 暗色主题设计系统：CSS 变量、组件样式、响应式布局 | 全局样式 |

### 自定义 UI 组件体系

不使用第三方 UI 库，全部自研：

| 组件 | 用途 |
|------|------|
| 模态弹窗（Modal） | 图书详情、上传、设置、确认操作 |
| 右键菜单（ContextMenu） | 图书/书架操作菜单 |
| Toast 通知 | 操作结果反馈（成功/失败/加载中） |
| 进度环形图 | 书架和图书的阅读进度可视化 |
| 拖拽排序 | 书架排序、图书迁移的拖拽交互 |

## 3.7 项目亮点 —— 完整阅读闭环

```
  上传图书
    │ 拖拽/点击上传 → 自动解析元数据 → 秒级入库
    ▼
  自动解析
    │ EPUB→NCX/OPF  |  PDF→PDFBox  |  TXT→正则
    ▼
  加入书架
    │ 选择目标书架 → 创建关联 → 书架实时更新
    ▼
  在线阅读
    │ epub.js 渲染  |  PDFBox 服务端转 PNG  |  目录跳转
    ▼
  保存进度
    │ 翻页时自动上报 → ReadingProgress 更新 → 进度百分比计算
    ▼
  继续阅读
    │ 打开系统 → 首页"继续阅读" → 跳转上次位置
```

从上传到阅读再到续读的无缝体验：拖拽上传、元数据秒级解析、一键打开阅读器、阅读进度无声保存、随时随地继续——形成完整的数字阅读流程闭环。

---

# 模块四：webrary-zlibrary —— Z-Library 集成

> 演示人：成员D  
> 职责：Z-Library API 对接、在线搜索、下载管理、未来扩展  
> 代码范围：ZlibraryController, ZlibraryService, ZlibraryApiClient, DownloadService

## 4.1 模块定位

`webrary-zlibrary` 负责与 Z-Library 平台的接口集成，扩展个人数字图书馆的资源获取渠道。用户可以在 Webrary 系统内直接搜索、浏览和下载 Z-Library 上的电子书资源，并自动入库管理，实现"一站式"书库建设体验。

## 4.2 Z-Library 资源整合概述

### 核心能力

| 能力 | 说明 | 用户价值 |
|------|------|---------|
| 账号绑定 | 用户绑定个人 Z-Library 账号 | 复用已有账号，无需重复注册 |
| 在线搜索 | 在系统内直接搜索 Z-Library 资源 | 无需切换网站，一站式操作 |
| 热门浏览 | 查看 Z-Library 热门/推荐书籍 | 发现感兴趣的新书 |
| 详情查看 | 获取书籍简介、评分、格式等信息 | 下载前充分了解书籍 |
| 多维筛选 | 按格式、语言、年份过滤结果 | 精准定位所需资源 |
| 异步下载 | 后台下载 + 自动入库 | 不阻塞用户操作，下载即入库 |

## 4.3 技术实现

### ZlibraryApiClient —— API 通信层

封装 Z-Library HTTP 通信的客户端类，统一管理所有外部 API 调用：

```java
public class ZlibraryApiClient {
    // 认证相关
    public boolean login(String email, String password);
    // → 登录换取 JWT Token，后续请求携带 Token

    // 搜索资源
    public SearchResult search(String query, String year,
                                String lang, String format);
    // → 支持多维度筛选，返回分页搜索结果

    // 书籍详情
    public BookInfo getBookInfo(Long bookId, String hash);
    // → 获取书籍元数据、简介、评分、可用格式

    // 获取下载链接
    public String getDownloadUrl(Long bookId, String hash, String format);
    // → 返回临时下载 URL（有时效性）

    // 热门书籍
    public List<BookInfo> getPopular(int count);
    // → 获取推荐/热门书籍列表
}
```

### ZlibraryController 端点设计

| 端点 | 方法 | 功能 | 认证 |
|------|------|------|------|
| /api/zlibrary/login | POST | 绑定/更新 Z-Library 账号 | 需登录 |
| /api/zlibrary/search | POST | 在线搜索书籍资源 | 需登录 |
| /api/zlibrary/book/{id}/{hash} | GET | 获取书籍详细信息 | 需登录 |
| /api/zlibrary/download/{id}/{hash} | POST | 提交异步下载任务 | 需登录 |
| /api/zlibrary/popular | GET | 获取热门推荐书籍 | 需登录 |
| /api/zlibrary/tasks | GET | 查看下载任务状态列表 | 需登录 |

## 4.4 异步下载管理系统

### 下载架构设计

```
用户操作                          系统处理
────────                          ────────
发起下载请求
    │
    ▼
┌──────────────────┐
│ ZlibraryController│  → 校验参数，创建 DownloadTask
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ DownloadService   │  → 加入线程池异步队列
│                    │  → 立即返回 task_id 给前端
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────────────┐
│        异步下载流水线（线程池）          │
│                                      │
│  PENDING ──→ DOWNLOADING ──→ COMPLETED│
│                              ↘        │
│                              FAILED   │
│                                      │
│  1. 从 Z-Library 获取下载链接           │
│  2. 下载文件到本地存储                   │
│  3. 调用 EbookParserService 解析元数据  │
│  4. 创建 Book 记录入库                  │
│  5. 添加到用户指定书架                   │
│  6. 更新 DownloadTask 状态为 COMPLETED   │
└──────────────────────────────────────┘
       │
       ▼
  前端轮询 /api/zlibrary/tasks
  → 实时更新下载进度 UI
  → COMPLETED 时刷新图书列表
```

### DownloadService 核心逻辑

```java
public class DownloadService {
    // 线程池：控制并发下载数量
    private final ExecutorService executor =
        Executors.newFixedThreadPool(3);

    // 启动异步下载
    public String startDownload(String url, String title,
                                 String format, Long shelfId) {
        DownloadTask task = new DownloadTask();
        task.setStatus("PENDING");
        // 保存任务 → 提交线程池
        taskRepo.save(task);
        executor.submit(() -> executeDownload(task));
        return task.getId();
    }

    // 下载执行流水线
    private void executeDownload(DownloadTask task) {
        updateStatus(task, "DOWNLOADING");
        // 1. 下载文件
        // 2. 解析元数据
        // 3. 入库
        // 4. 关联书架
        // 5. 标记完成
        updateStatus(task, "COMPLETED");
    }
}
```

### 下载状态机

```
PENDING ────→ DOWNLOADING ────→ COMPLETED
                                 ↘ (异常)
                                 FAILED
```

* **PENDING**：任务已创建，等待线程池调度
* **DOWNLOADING**：正在下载文件或解析处理中
* **COMPLETED**：下载完成，图书已入库并关联书架
* **FAILED**：下载失败（网络异常、文件损坏等），记录错误信息

## 4.5 后续优化方向

### AI 阅读助手

* AI 自动总结章节核心内容
* 针对书籍内容的智能问答
* 生词解释与即时翻译
* 个性化阅读推荐

### 多用户共享

* 家庭成员共享书库（同一家庭组）
* 细粒度权限管理（查看/编辑/下载）
* 共享书架与阅读笔记

### 云同步增强

* 多设备阅读进度实时同步
* 自动备份书库数据
* 阅读笔记云存储

### 更多格式支持

* MOBI / AZW3（Kindle 格式）
* FB2（FictionBook）
* DJVU（扫描版电子书）
* Markdown / HTML 文档

---

# 项目应用价值

## 适用场景

| 场景 | 说明 | 核心优势 |
|------|------|---------|
| 个人电子书管理平台 | 集中管理个人全部电子书资源 | 统一管理、在线阅读 |
| 家庭数字图书馆 | 家庭成员共享阅读资源 | 数据隔离 + 共享支持 |
| 私有化阅读服务 | 部署在自有服务器上 | 数据自主可控 |
| NAS 电子书系统 | 配合 NAS 搭建家庭书库 | 轻量部署、资源充裕 |
| 研究资料管理 | 管理 PDF 论文和参考资料 | PDF 在线批注、目录导航 |

## 相比传统方案的竞争优势

| 对比维度 | Webrary | 本地阅读器（Calibre） | 云存储（网盘） | 商业平台（Kindle） |
|---------|---------|---------------------|---------------|-------------------|
| 在线访问 | ✓ 浏览器即用 | ✗ 需安装客户端 | ✓ | ✓ |
| 数据自主 | ✓ 完全自主 | ✓ 本地存储 | ✗ 云端受限 | ✗ 平台锁定 |
| 私有部署 | ✓ 支持 | ✗ | ✗ | ✗ |
| 进度同步 | ✓ 服务端存储 | ✗ | ✗ 无阅读功能 | ✓ 平台内 |
| 多格式阅读 | ✓ EPUB/PDF/TXT | ✓ 丰富 | ✗ 无阅读功能 | ✗ 格式有限 |
| 开源可控 | ✓ 完全开源 | ✓ 开源 | ✗ | ✗ |
| 资源扩展 | ✓ Z-Library集成 | ✗ | ✗ | ✓ 自有商店 |

---

# 总结

## 项目回顾

Webrary 是一个面向个人数字阅读场景设计的 Web 化电子书管理系统。通过 **Spring Boot 后端 + SQLite 轻量数据库 + 现代 Web 前端技术** 的技术组合，实现了电子书管理、在线阅读、书架组织、阅读进度同步等完整功能。

## 技术亮点

* **轻量化架构**：Spring Boot + SQLite，免配置、单文件、150MB Docker 镜像
* **多格式阅读**：EPUB（epub.js）、PDF（PDFBox 渲染）、TXT（正则分章）统一在线体验
* **完整闭环**：上传 → 解析 → 书架 → 阅读 → 进度 → 续读，无缝衔接
* **资源扩展**：集成 Z-Library API，在线搜索下载，异步任务调度
* **无框架前端**：Vanilla JS SPA，自定义 UI 组件体系，零依赖

## 模块化设计

四个模块职责清晰、边界分明：`webrary-common` 提供底层基础设施，`webrary-auth` 保障用户认证与数据隔离，`webrary-biz` 承载核心业务与阅读体验，`webrary-zlibrary` 扩展资源获取渠道。

## 未来展望

项目具备良好的扩展性和实际应用价值，后续可在 AI 阅读助手、多用户共享、云同步、更多格式支持等方向持续演进，为个人和家庭用户提供更完善的数字图书馆解决方案。
