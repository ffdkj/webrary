# Webrary

Self-hosted web book library manager with integrated Z-Library API client. Browse, search, download, upload, organize on bookshelves, and read books in-browser.

![Tech Stack](https://img.shields.io/badge/Java-17-blue) ![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.5-green) ![SQLite](https://img.shields.io/badge/SQLite-3-blue)

## Features

- **Bookshelf management** — create, rename, reorder, delete shelves; drag-and-drop book transfer
- **Z-Library integration** — login with credentials, browse popular books, search with filters (year, language, format), download directly to server
- **Background downloads** — async download queue with real-time progress tracking; add to shelf and download in one click
- **Upload support** — EPUB, PDF, TXT, MOBI, AZW3; auto-extracts metadata, cover, and table of contents
- **In-browser reader** — EPUB (epub.js), PDF (server-rendered PNG via PDFBox), TXT reader with chapter detection
- **Table of contents** — EPUB NCX + XHTML parsing, PDF outline extraction, TXT chapter auto-detection
- **Reading progress** — per-book tracking with continue-reading resume
- **MOBI/AZW3 conversion** — auto-convert to EPUB via Calibre `ebook-convert`
- **Full-text search** — Z-Library search with advanced filters
- **Dark theme UI** — custom design system, responsive layout, vanilla JavaScript SPA

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Java 17, Spring Boot 3.5, Spring Data JPA |
| Database | SQLite (via Hibernate SQLiteDialect) |
| HTTP Client | OkHttp 4.12 |
| EPUB Parsing | epublib-core 3.1 |
| PDF Rendering | Apache PDFBox 3.0.3 |
| Ebook Reader | epub.js + custom rendering |
| Frontend | Vanilla JS, CSS custom properties |

## Quick Start

### Prerequisites

- **JDK 17+**
- **Maven 3.6+**
- **Calibre** (optional — only for MOBI/AZW3 → EPUB conversion)

### Build & Run

```bash
cd spring-boot-app

# Build
mvn clean package -DskipTests

# Run
java -jar target/webrary-1.0.0.jar
```

The app starts on **http://localhost:8080**. The SQLite database (`data/webrary.db`) and upload directory (`data/uploads/`) are created automatically on first run.

### Run directly with Maven

```bash
cd spring-boot-app
mvn spring-boot:run
```

## Configuration

Edit `spring-boot-app/src/main/resources/application.yml`:

```yaml
server:
  port: 8080                    # HTTP port

spring:
  datasource:
    url: jdbc:sqlite:data/webrary.db
  servlet:
    multipart:
      max-file-size: 100MB
      max-request-size: 100MB

webrary:
  upload-dir: data/uploads      # Book file storage
  calibre:
    path: ebook-convert         # Calibre CLI path
```

## API Routes

### Auth (`/api/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |

### Bookshelves (`/api/bookshelves`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookshelves` | List all shelves |
| POST | `/api/bookshelves` | Create shelf |
| PUT | `/api/bookshelves/{id}` | Rename |
| DELETE | `/api/bookshelves/{id}` | Delete |
| POST | `/api/bookshelves/reorder` | Reorder |
| GET | `/api/bookshelves/{id}/stats` | Statistics |

### Books (`/api/books`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/books/shelf/{shelfId}` | Books in shelf |
| POST | `/api/books/shelf/{shelfId}` | Add to shelf |
| DELETE | `/api/books/shelf/{shelfId}/book/{bookId}` | Remove |
| POST | `/api/books/transfer` | Transfer between shelves |
| DELETE | `/api/books/{bookId}` | Delete |
| POST | `/api/books/upload` | Upload file |
| GET | `/api/books/{bookId}/toc` | Table of contents |
| GET | `/api/books/{bookId}/read` | Download file |
| GET | `/api/books/{bookId}/stream` | Stream inline |
| GET | `/api/books/{bookId}/progress` | Reading progress |
| PUT | `/api/books/{bookId}/progress` | Update progress |
| POST | `/api/books/{bookId}/convert` | Convert to EPUB |
| GET | `/api/books/{bookId}/pdf/info` | PDF metadata |
| GET | `/api/books/{bookId}/pdf/page/{n}` | Render PDF page |

### Z-Library (`/api/zlibrary`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/zlibrary/login` | Login |
| GET | `/api/zlibrary/status` | Check status |
| GET | `/api/zlibrary/downloads-left` | Quota |
| POST | `/api/zlibrary/search` | Search |
| GET | `/api/zlibrary/most-popular` | Popular books |
| GET | `/api/zlibrary/book/{id}/{hash}` | Book info |
| GET | `/api/zlibrary/book/{id}/{hash}/download/file` | Download |
| POST | `/api/zlibrary/download/start` | Async download |
| GET | `/api/zlibrary/download/list` | Task list |
| GET | `/api/zlibrary/download/status/{taskId}` | Task status |

## Project Structure

```
webrary/
├── spring-boot-app/
│   ├── pom.xml                         # Maven build
│   └── src/main/
│       ├── java/com/webrary/
│       │   ├── WebraryApplication.java # Entry point
│       │   ├── config/                 # AuthInterceptor, WebConfig, CORS
│       │   ├── controller/             # REST controllers (4)
│       │   ├── service/                # Business logic (7 services)
│       │   ├── dto/                    # Data transfer objects
│       │   ├── model/                  # JPA entities (7)
│       │   ├── repository/             # Spring Data repos
│       │   └── zlibrary/               # Z-Library HTTP client
│       └── resources/
│           ├── application.yml         # Configuration
│           └── static/
│               ├── index.html          # Main SPA
│               ├── reader.html         # In-browser reader
│               ├── css/style.css       # Design system
│               ├── js/app.js           # SPA logic
│               └── js/reader.js        # Reader logic
└── zlibrary_api_doc.md                 # Z-Library API reference
```

## License

MIT
