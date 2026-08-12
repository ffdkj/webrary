"""EPUB/PDF/TXT metadata, TOC and page rendering helpers."""

import codecs
import json
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup
from ebooklib import ITEM_COVER, ITEM_DOCUMENT, ITEM_IMAGE
from ebooklib.epub import Link, Section, read_epub
import fitz
import mobi

from ..config import UPLOAD_DIR


CHARS_PER_PAGE = 2000
TXT_CHAPTER_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万零〇0-9]+[章回节卷篇部]"
    r"|Chapter\s+\d+|CHAPTER\s+\d+"
    r"|序言|前言|楔子|尾声|后记|附录).*"
)
TXT_INDEX_SUFFIX = ".webrary-txt-index.json"
TXT_READ_CHUNK = 1024 * 1024
TXT_ENCODING_SAMPLE = 262144


def _meta_values(book: Any, name: str) -> List[str]:
    values = []
    try:
        for item in book.get_metadata("DC", name) or []:
            if isinstance(item, tuple) and item:
                value = item[0]
            else:
                value = getattr(item, "value", item)
            if value:
                values.append(str(value).strip())
    except Exception:
        pass
    return values


def _cover_format(media_type: Optional[str]) -> str:
    if media_type:
        lowered = media_type.lower()
        if "png" in lowered:
            return "png"
        if "webp" in lowered:
            return "webp"
    return "jpg"


def _find_epub_cover(book: Any) -> tuple:
    for item in book.get_items_of_type(ITEM_COVER):
        try:
            return item.get_content(), _cover_format(item.media_type)
        except Exception:
            continue

    image_items = []
    for item in book.get_items_of_type(ITEM_IMAGE):
        try:
            image_items.append((item, item.get_content(), _cover_format(item.media_type)))
        except Exception:
            continue
    if image_items:
        cover_matches = [
            entry for entry in image_items
            if "cover" in (entry[0].get_name() or "").lower()
        ]
        if cover_matches:
            cover_matches.sort(key=lambda entry: len(entry[1]), reverse=True)
            return cover_matches[0][1], cover_matches[0][2]
        image_items.sort(key=lambda entry: len(entry[1]), reverse=True)
        return image_items[0][1], image_items[0][2]

    for item in book.get_items_of_type(ITEM_DOCUMENT):
        media_type = getattr(item, "media_type", None) or ""
        if str(media_type).startswith("image/"):
            try:
                return item.get_content(), _cover_format(media_type)
            except Exception:
                continue
    return None, None


def _walk_epub_toc(items: List[Any], toc: List[Dict[str, Any]], level: int) -> None:
    for item in items or []:
        if isinstance(item, Link):
            toc.append(
                {
                    "title": item.title or "",
                    "chapterIndex": len(toc),
                    "startPage": None,
                    "href": item.href,
                    "level": level,
                }
            )
        elif isinstance(item, Section):
            title = getattr(item, "title", None) or ""
            href = getattr(item, "href", None)
            if title:
                toc.append(
                    {
                        "title": title,
                        "chapterIndex": len(toc),
                        "startPage": None,
                        "href": href,
                        "level": level,
                    }
                )
            _walk_epub_toc(getattr(item, "children", None) or [], toc, level + 1)


def _supplement_epub_toc(book: Any, toc: List[Dict[str, Any]]) -> None:
    existing_titles = {entry["title"] for entry in toc}
    for item in book.get_items_of_type(ITEM_DOCUMENT):
        href = item.get_name() or ""
        lowered = href.lower()
        if "toc" not in lowered and "nav" not in lowered:
            continue
        try:
            content = item.get_content().decode("utf-8", errors="ignore")
        except Exception:
            continue
        if "<a " not in content:
            continue
        soup = BeautifulSoup(content, "html.parser")
        h1 = soup.find("h1")
        section_title = h1.get_text(strip=True) if h1 else None
        if section_title and section_title not in existing_titles:
            toc.append(
                {
                    "title": section_title,
                    "chapterIndex": len(toc),
                    "startPage": None,
                    "href": href,
                    "level": 0,
                }
            )
            existing_titles.add(section_title)
        base_dir = href.rsplit("/", 1)[0] + "/" if "/" in href else ""
        for anchor in soup.find_all("a", href=True):
            title = anchor.get_text(strip=True)
            link_href = anchor.get("href", "")
            if not title or not link_href or link_href.startswith("#"):
                continue
            if title in existing_titles:
                continue
            toc.append(
                {
                    "title": title,
                    "chapterIndex": len(toc),
                    "startPage": None,
                    "href": base_dir + link_href,
                    "level": 1,
                }
            )
            existing_titles.add(title)


def _parse_epub(path: Path) -> Dict[str, Any]:
    with open(path, "rb") as fh:
        book = read_epub(fh)

    title_values = _meta_values(book, "title")
    author_values = _meta_values(book, "creator")
    title = title_values[0] if title_values else None
    author = author_values[0] if author_values else None
    cover_bytes, cover_format = _find_epub_cover(book)

    toc: List[Dict[str, Any]] = []
    _walk_epub_toc(book.toc, toc, 0)
    if len(toc) < 10:
        _supplement_epub_toc(book, toc)

    return {
        "title": title,
        "author": author,
        "cover_bytes": cover_bytes,
        "cover_format": cover_format,
        "pages": None,
        "toc": toc,
    }


def _parse_pdf(path: Path) -> Dict[str, Any]:
    doc = fitz.open(path)
    try:
        metadata = doc.metadata or {}
        title = (metadata.get("title") or "").strip() or None
        author = (metadata.get("author") or "").strip() or None
        page_count = doc.page_count
        cover_bytes = None
        if page_count > 0:
            try:
                cover_bytes = doc[0].get_pixmap(dpi=72).tobytes("jpeg")
            except Exception:
                pass

        toc: List[Dict[str, Any]] = []
        for item in doc.get_toc(simple=True) or []:
            level, title, start_page = item[:3]
            page_number = int(start_page) if isinstance(start_page, int) else None
            toc.append(
                {
                    "title": title or "",
                    "chapterIndex": (page_number - 1) if page_number else len(toc),
                    "startPage": page_number,
                    "href": None,
                    "level": int(level),
                }
            )
        return {
            "title": title,
            "author": author,
            "cover_bytes": cover_bytes,
            "cover_format": "jpg",
            "pages": page_count,
            "toc": toc,
        }
    finally:
        doc.close()


def _decode_txt_bytes(data: bytes) -> tuple:
    """Decode TXT bytes, preferring UTF-8 and detecting common CJK encodings."""
    if data.startswith(codecs.BOM_UTF8):
        return data.decode("utf-8-sig"), "utf-8"
    if data.startswith(codecs.BOM_UTF16_LE):
        return data.decode("utf-16"), "utf-16-le"
    if data.startswith(codecs.BOM_UTF16_BE):
        return data.decode("utf-16"), "utf-16-be"
    for encoding in ("utf-8", "utf-16"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    try:
        import charset_normalizer

        match = charset_normalizer.from_bytes(data[:262144]).best()
        if match and match.encoding:
            try:
                return data.decode(match.encoding), match.encoding
            except (LookupError, UnicodeDecodeError):
                pass
    except Exception:
        pass
    for encoding in ("gb18030", "big5", "shift_jis"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "latin-1"


def _txt_index_path(path: Path) -> Path:
    return Path(str(path) + TXT_INDEX_SUFFIX)


def _line_byte_encoding(encoding: str) -> str:
    lowered = encoding.lower()
    if lowered in ("utf-16", "utf_16"):
        return "utf-16-le"
    if lowered.endswith(("-sig", "_sig")):
        return encoding[:-4]
    return encoding


def _validate_txt_encoding(path: Path, sample: bytes) -> str:
    try:
        _, chosen = _decode_txt_bytes(sample)
    except Exception:
        chosen = "latin-1"
    candidates = [chosen]
    for fallback in ("gb18030", "big5", "shift_jis", "latin-1"):
        if fallback != chosen:
            candidates.append(fallback)
    for encoding in candidates:
        try:
            decoder = codecs.getincrementaldecoder(encoding)()
            with open(path, "rb") as fh:
                while True:
                    chunk = fh.read(TXT_READ_CHUNK)
                    if not chunk:
                        break
                    decoder.decode(chunk)
            decoder.decode(b"", final=True)
            return encoding
        except (LookupError, UnicodeDecodeError):
            continue
    return "latin-1"


def _build_txt_index(path: Path) -> Dict[str, Any]:
    with open(path, "rb") as fh:
        sample = fh.read(TXT_ENCODING_SAMPLE)
    encoding = _validate_txt_encoding(path, sample)
    byte_encoding = _line_byte_encoding(encoding)

    bom_size = 0
    if sample.startswith(codecs.BOM_UTF8):
        bom_size = len(codecs.BOM_UTF8)
    elif sample.startswith(codecs.BOM_UTF16_LE):
        bom_size = len(codecs.BOM_UTF16_LE)
    elif sample.startswith(codecs.BOM_UTF16_BE):
        bom_size = len(codecs.BOM_UTF16_BE)

    pages: List[List[int]] = []
    toc: List[Dict[str, Any]] = []
    current_start = bom_size
    char_count = 0
    byte_offset = bom_size
    page_no = 1
    pending = ""
    decoder = codecs.getincrementaldecoder(encoding)()

    def flush_line(line: str) -> None:
        nonlocal current_start, char_count, byte_offset, page_no
        if char_count > 0 and char_count + len(line) > CHARS_PER_PAGE:
            pages.append([current_start, byte_offset])
            current_start = byte_offset
            char_count = 0
            page_no += 1

        stripped = line.strip()
        if TXT_CHAPTER_RE.match(stripped):
            toc.append(
                {
                    "title": stripped,
                    "chapterIndex": len(toc),
                    "startPage": page_no,
                    "href": None,
                    "level": 0,
                }
            )

        char_count += len(line)
        byte_offset += len(line.encode(byte_encoding))

    with open(path, "rb") as fh:
        if bom_size:
            fh.seek(bom_size)
        while True:
            chunk = fh.read(TXT_READ_CHUNK)
            if not chunk:
                break
            pending += decoder.decode(chunk)
            parts = pending.split("\n")
            pending = parts.pop()
            for part in parts:
                flush_line(part + "\n")
    pending += decoder.decode(b"", final=True)
    if pending:
        flush_line(pending)

    if char_count > 0 or not pages:
        pages.append([current_start, byte_offset])

    stat = path.stat()
    index = {
        "version": 1,
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "encoding": encoding,
        "total_pages": len(pages),
        "pages": pages,
        "toc": toc,
    }
    try:
        _txt_index_path(path).write_text(
            json.dumps(index, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass
    return index


def _load_txt_index(path: Path) -> Dict[str, Any]:
    try:
        stat = path.stat()
        index = json.loads(_txt_index_path(path).read_text(encoding="utf-8"))
        if (
            index.get("version") == 1
            and index.get("size") == stat.st_size
            and index.get("mtime_ns") == stat.st_mtime_ns
        ):
            return index
    except Exception:
        pass
    return _build_txt_index(path)


def _parse_txt(path: Path) -> Dict[str, Any]:
    index = _load_txt_index(path)
    return {
        "title": None,
        "author": None,
        "cover_bytes": None,
        "cover_format": None,
        "pages": index["total_pages"],
        "toc": index["toc"],
    }


def txt_info(path: Path) -> Dict[str, Any]:
    index = _load_txt_index(path)
    return {
        "totalPages": index["total_pages"],
        "encoding": index["encoding"],
    }


def txt_page(path: Path, page_number: int) -> Dict[str, Any]:
    index = _load_txt_index(path)
    total_pages = index["total_pages"]
    if page_number < 1 or page_number > total_pages:
        raise ValueError("Page out of range")
    start, end = index["pages"][page_number - 1]
    with open(path, "rb") as fh:
        fh.seek(start)
        content = fh.read(end - start).decode(index["encoding"], errors="replace")
    return {
        "page": page_number,
        "totalPages": total_pages,
        "encoding": index["encoding"],
        "content": content,
    }


def txt_text_utf8(path: Path) -> bytes:
    index = _load_txt_index(path)
    encoding = index["encoding"]
    bom_size = index["pages"][0][0] if index["pages"] else 0
    decoder = codecs.getincrementaldecoder(encoding)()
    encoder = codecs.getincrementalencoder("utf-8")()
    chunks: List[bytes] = []
    with open(path, "rb") as fh:
        if bom_size:
            fh.seek(bom_size)
        while True:
            chunk = fh.read(TXT_READ_CHUNK)
            if not chunk:
                break
            encoded = encoder.encode(decoder.decode(chunk))
            if encoded:
                chunks.append(encoded)
    tail = encoder.encode(decoder.decode(b"", final=True))
    if tail:
        chunks.append(tail)
    tail = encoder.encode("", final=True)
    if tail:
        chunks.append(tail)
    return b"".join(chunks)


def convert_kindle_to_epub(path: Path, extension: str = "mobi") -> Path:
    """Convert an unencrypted MOBI/AZW3 file to EPUB using KindleUnpack."""
    ext = (extension or "").lower().lstrip(".")
    if ext not in ("mobi", "azw3"):
        raise ValueError(f"Unsupported Kindle format: {ext}")
    tempdir, filepath = mobi.extract(str(path))
    try:
        extracted = Path(filepath)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        target = UPLOAD_DIR / f"{uuid.uuid4()}.epub"
        if extracted.is_file() and extracted.suffix.lower() == ".epub":
            shutil.copy2(extracted, target)
            return target

        root = extracted.parent
        if not (root / "content.opf").exists():
            raise RuntimeError("Unpacked Kindle book has no content.opf")

        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                "mimetype",
                "application/epub+zip",
                compress_type=zipfile.ZIP_STORED,
            )
            zf.writestr(
                "META-INF/container.xml",
                '<?xml version="1.0" encoding="UTF-8"?>\n'
                '<container version="1.0" '
                'xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n'
                '  <rootfiles>'
                '<rootfile full-path="mobi7/content.opf" '
                'media-type="application/oebps-package+xml"/>'
                '</rootfiles>\n'
                '</container>\n',
            )
            base = Path(tempdir)
            for file in sorted(base.rglob("*")):
                if file.is_file():
                    zf.write(file, file.relative_to(base).as_posix())
        return target
    finally:
        shutil.rmtree(tempdir, ignore_errors=True)


def ensure_epub_conversion(path: Path, extension: str) -> tuple:
    """Convert MOBI/AZW3 to EPUB and remove the original file."""
    ext = (extension or "").lower().lstrip(".")
    if ext in ("mobi", "azw3"):
        converted = convert_kindle_to_epub(path, ext)
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return converted, "epub"
    return path, ext or "bin"


def parse_file(path: Path, extension: str = "") -> Dict[str, Any]:
    ext = (extension or "").lower().lstrip(".")
    if ext == "epub":
        return _parse_epub(path)
    if ext == "pdf":
        return _parse_pdf(path)
    if ext == "txt":
        return _parse_txt(path)
    if ext in ("mobi", "azw3"):
        converted = convert_kindle_to_epub(path, ext)
        try:
            return _parse_epub(converted)
        finally:
            converted.unlink(missing_ok=True)
    return {
        "title": None,
        "author": None,
        "cover_bytes": None,
        "cover_format": None,
        "pages": None,
        "toc": [],
    }


def render_pdf_page(path: Path, page_number: int, dpi: int = 144) -> bytes:
    doc = fitz.open(path)
    try:
        if page_number < 1 or page_number > doc.page_count:
            raise ValueError("Page out of range")
        pix = doc[page_number - 1].get_pixmap(dpi=dpi)
        return pix.tobytes("png")
    finally:
        doc.close()


def pdf_info(path: Path) -> Dict[str, Any]:
    doc = fitz.open(path)
    try:
        metadata = doc.metadata or {}
        return {
            "totalPages": doc.page_count,
            "title": (metadata.get("title") or "").strip() or None,
            "author": (metadata.get("author") or "").strip() or None,
        }
    finally:
        doc.close()


def mime_for_extension(extension: str) -> str:
    ext = (extension or "").lower().lstrip(".")
    return {
        "pdf": "application/pdf",
        "epub": "application/epub+zip",
        "mobi": "application/x-mobipocket-ebook",
        "azw3": "application/vnd.amazon.ebook",
        "txt": "text/plain; charset=utf-8",
        "fb2": "application/x-fictionbook+xml",
        "djvu": "image/vnd.djvu",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(ext, "application/octet-stream")
