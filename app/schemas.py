"""Pydantic request models and shared API response helpers."""

from typing import Any, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


def ok(message: Optional[str] = None, data: Any = None) -> dict:
    # Support both `ok(data)` and `ok(message, data)` call styles used by routes.
    if data is None and not isinstance(message, str):
        data = message
        message = None
    return {"success": True, "message": message, "data": data}


def fail(message: str, data: Any = None) -> dict:
    return {"success": False, "message": message, "data": data}


class CamelModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class AuthRequest(CamelModel):
    email: str
    password: str


class BookshelfRequest(CamelModel):
    name: str


class ReorderRequest(CamelModel):
    shelf_ids: List[int] = Field(alias="shelfIds")


class TransferRequest(CamelModel):
    from_shelf_id: int = Field(alias="fromShelfId")
    to_shelf_id: int = Field(alias="toShelfId")
    book_id: int = Field(alias="bookId")


class ReadingProgressRequest(CamelModel):
    current_page: int = Field(alias="currentPage", default=0)
    total_pages: int = Field(alias="totalPages", default=0)
    finished: bool = False


class BookAddRequest(CamelModel):
    zlib_id: Optional[int] = Field(default=None, alias="zlibId")
    zlib_hash: Optional[str] = Field(default=None, alias="zlibHash")
    title: Optional[str] = None
    author: Optional[str] = None
    cover_url: Optional[str] = Field(default=None, alias="coverUrl")
    extension: Optional[str] = None
    filesize: Optional[int] = None
    description: Optional[str] = None
    file_path: Optional[str] = Field(default=None, alias="filePath")
    uploaded: bool = False


class SearchRequest(CamelModel):
    message: str = ""
    year_from: Optional[int] = Field(default=None, alias="yearFrom")
    year_to: Optional[int] = Field(default=None, alias="yearTo")
    languages: Optional[Union[str, List[str]]] = None
    extensions: Optional[List[str]] = None
    order: Optional[str] = None
    page: Optional[int] = None
    limit: Optional[int] = None


class ZlibraryLoginRequest(CamelModel):
    email: str
    password: str
    domain: Optional[str] = None
    proxy_host: Optional[str] = Field(default=None, alias="proxyHost")
    proxy_port: Optional[int] = Field(default=None, alias="proxyPort")


class RegistrationSettingRequest(CamelModel):
    allow_registration: bool = Field(alias="allowRegistration")


class HighlightCreateRequest(CamelModel):
    format: str
    cfi_range: Optional[str] = Field(default=None, alias="cfiRange")
    page: Optional[int] = None
    start_offset: Optional[int] = Field(default=None, alias="startOffset")
    end_offset: Optional[int] = Field(default=None, alias="endOffset")
    quote: str
    color: str = "yellow"


class HighlightUpdateRequest(CamelModel):
    color: Optional[str] = None
