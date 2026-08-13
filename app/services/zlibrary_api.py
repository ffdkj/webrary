"""Z-Library EAPI client, adapted from bipinkrish/Zlibrary-API."""

import os
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

import requests

from ..config import Z_LIBRARY_DEFAULT_DOMAIN
from ..database import db, fetch_one, next_id, now_ms


DEFAULT_HEADERS = {
    "Content-Type": "application/x-www-form-urlencoded",
    "accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8,"
        "application/signed-exchange;v=b3;q=0.7"
    ),
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/110.0.0.0 Safari/537.36"
    ),
}


class ZlibraryApiClient:
    def __init__(
        self,
        domain: Optional[str] = None,
        proxy_host: Optional[str] = None,
        proxy_port: Optional[int] = None,
    ):
        self.domain = (domain or Z_LIBRARY_DEFAULT_DOMAIN).strip() or Z_LIBRARY_DEFAULT_DOMAIN
        self._headers = DEFAULT_HEADERS.copy()
        self._cookies: Dict[str, str] = {"siteLanguageV2": "en"}
        self._user_info: Optional[Dict[str, Any]] = None
        self._logged_in = False
        self._session = requests.Session()
        self._session.headers.update(self._headers)
        os.environ.pop("SSLKEYLOGFILE", None)
        if proxy_host and proxy_port and int(proxy_port) > 0:
            proxy = f"http://{proxy_host}:{proxy_port}"
            self._session.proxies.update({"http": proxy, "https": proxy})

    @property
    def base_url(self) -> str:
        return f"https://{self.domain}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        cookies: Optional[Dict[str, str]] = None,
        override: bool = False,
    ) -> Dict[str, Any]:
        if not self.is_logged_in() and not override:
            raise RuntimeError("Not logged in")
        request_cookies = self._cookies if cookies is None else cookies
        url = self.base_url + path
        kwargs = {"cookies": request_cookies, "timeout": 60}
        if params:
            kwargs["params"] = params
        if method.upper() == "GET":
            response = self._session.get(url, **kwargs)
        else:
            kwargs["data"] = data or {}
            response = self._session.post(url, **kwargs)
        try:
            return response.json()
        except ValueError:
            raise RuntimeError(
                f"Z-Library returned invalid response (HTTP {response.status_code})"
            )

    def _apply_user(self, response: Dict[str, Any]) -> bool:
        if not response.get("success"):
            return False
        user = response.get("user") or {}
        self._user_info = {
            "id": user.get("id"),
            "email": user.get("email"),
            "name": user.get("name"),
            "kindleEmail": user.get("kindle_email"),
            "remixUserkey": user.get("remix_userkey"),
            "downloadsToday": int(user.get("downloads_today") or 0),
            "downloadsLimit": int(user.get("downloads_limit") or 0),
            "confirmed": bool(user.get("confirmed")),
            "isPremium": bool(user.get("isPremium") or user.get("is_premium")),
        }
        if user.get("id") is not None:
            self._cookies["remix_userid"] = str(user["id"])
        if user.get("remix_userkey"):
            self._cookies["remix_userkey"] = user["remix_userkey"]
        self._logged_in = True
        return True

    def login(self, email: str, password: str) -> Dict[str, Any]:
        response = self._request_json(
            "POST",
            "/eapi/user/login",
            data={"email": email, "password": password},
            override=True,
        )
        self._apply_user(response)
        if not self.is_logged_in():
            raise RuntimeError(response.get("error") or "Z-Library login failed")
        return self.get_user_info()

    def login_with_token(
        self, remix_user_id: Any, remix_user_key: str
    ) -> Dict[str, Any]:
        cookies = {
            "siteLanguageV2": "en",
            "remix_userid": str(remix_user_id),
            "remix_userkey": str(remix_user_key),
        }
        response = self._request_json(
            "GET", "/eapi/user/profile", cookies=cookies, override=True
        )
        self._apply_user(response)
        return response

    def is_logged_in(self) -> bool:
        return self._logged_in

    def get_user_info(self) -> Optional[Dict[str, Any]]:
        return self._user_info

    def get_profile(self) -> Dict[str, Any]:
        response = self._request_json("GET", "/eapi/user/profile")
        self._apply_user(response)
        return response

    def get_downloads_left(self) -> int:
        if not self._user_info:
            return 0
        return max(
            0,
            int(self._user_info.get("downloadsLimit") or 0)
            - int(self._user_info.get("downloadsToday") or 0),
        )

    def search(
        self, query: str, options: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        options = options or {}
        data: Dict[str, Any] = {"message": query or ""}
        for key in ("yearFrom", "yearTo", "order"):
            if options.get(key) is not None:
                data[key] = str(options[key])
        languages = options.get("languages")
        if languages:
            if isinstance(languages, str):
                languages = [languages]
            data["languages[]"] = [str(lang) for lang in languages]
        if options.get("extensions"):
            data["extensions[]"] = [str(ext) for ext in options["extensions"]]
        data["page"] = str(options.get("page") or 1)
        data["limit"] = str(options.get("limit") or 10)
        return self._request_json("POST", "/eapi/book/search", data=data)

    def get_most_popular(self) -> Dict[str, Any]:
        return self._request_json("GET", "/eapi/book/most-popular")

    def get_book_info(self, book_id: int, hash_value: str) -> Dict[str, Any]:
        return self._request_json("GET", f"/eapi/book/{book_id}/{hash_value}")

    def get_download_link(self, book_id: int, hash_value: str) -> Dict[str, Any]:
        response = self._request_json("GET", f"/eapi/book/{book_id}/{hash_value}/file")
        file_data = response.get("file")
        if not file_data:
            raise RuntimeError(response.get("error") or "No download file info available")
        return {
            "downloadLink": file_data.get("downloadLink"),
            "filename": file_data.get("filename"),
            "description": file_data.get("description"),
            "author": file_data.get("author"),
            "extension": file_data.get("extension"),
            "filesize": file_data.get("filesize"),
        }

    def download_book(
        self, book_id: int, hash_value: str, on_progress=None
    ) -> bytes:
        info = self.get_download_link(book_id, hash_value)
        download_link = info.get("downloadLink")
        if not download_link:
            raise RuntimeError("No download link available")
        headers = self._headers.copy()
        if "://" in download_link:
            headers["authority"] = download_link.split("/")[2]
        with self._session.get(
            download_link, headers=headers, stream=True, timeout=120
        ) as response:
            if response.status_code != 200:
                raise RuntimeError(f"Download failed (HTTP {response.status_code})")
            chunks = []
            total = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    chunks.append(chunk)
                    total += len(chunk)
                    if on_progress:
                        on_progress(total)
            return b"".join(chunks)

    def logout(self) -> None:
        self._cookies = {"siteLanguageV2": "en"}
        self._user_info = None
        self._logged_in = False

    def close(self) -> None:
        self._session.close()


def get_zlibrary_row(user_id: int) -> Optional[Dict[str, Any]]:
    return fetch_one("SELECT * FROM user_zlibrary WHERE user_id = ?", (user_id,))


def build_client_for_user(user_id: int) -> ZlibraryApiClient:
    row = get_zlibrary_row(user_id)
    if not row:
        return ZlibraryApiClient()
    client = ZlibraryApiClient(
        row.get("domain"), row.get("proxy_host"), row.get("proxy_port")
    )
    if row.get("remix_userid") and row.get("remix_userkey"):
        try:
            client.login_with_token(row["remix_userid"], row["remix_userkey"])
        except Exception:
            pass
    if (
        not client.is_logged_in()
        and row.get("zlibrary_email")
        and row.get("zlibrary_password")
    ):
        try:
            client.login(row["zlibrary_email"], row["zlibrary_password"])
        except Exception:
            pass
    return client


@contextmanager
def user_zlibrary_client(user_id: int):
    client = build_client_for_user(user_id)
    try:
        yield client
    finally:
        client.close()


def persist_zlibrary_login(
    user_id: int,
    email: str,
    password: str,
    domain: str,
    proxy_host: Optional[str],
    proxy_port: Optional[int],
    user_info: Dict[str, Any],
) -> None:
    with db() as conn:
        existing = conn.execute(
            "SELECT id FROM user_zlibrary WHERE user_id = ?", (user_id,)
        ).fetchone()
        values = (
            email,
            password,
            str(user_info.get("id")) if user_info.get("id") is not None else None,
            user_info.get("remixUserkey"),
            domain,
            proxy_host,
            proxy_port,
            now_ms(),
        )
        if existing:
            conn.execute(
                """
                UPDATE user_zlibrary
                SET zlibrary_email = ?, zlibrary_password = ?, remix_userid = ?,
                    remix_userkey = ?, domain = ?, proxy_host = ?, proxy_port = ?,
                    updated_at = ?
                WHERE user_id = ?
                """,
                values + (user_id,),
            )
        else:
            row_id = next_id(conn, "user_zlibrary")
            conn.execute(
                """
                INSERT INTO user_zlibrary
                    (id, user_id, zlibrary_email, zlibrary_password, remix_userid,
                     remix_userkey, domain, proxy_host, proxy_port, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (row_id, user_id) + values,
            )
