"""Runtime configuration for the FastAPI backend."""

import os
from pathlib import Path


def _project_root() -> Path:
    # fastapi-app/app/config.py -> fastapi-app -> repo root
    return Path(__file__).resolve().parent.parent.parent


PROJECT_ROOT = _project_root()

DEFAULT_DB_PATH = PROJECT_ROOT / "fastapi-app" / "data" / "webrary.db"
DEFAULT_UPLOAD_DIR = PROJECT_ROOT / "fastapi-app" / "data" / "uploads"
DEFAULT_STATIC_DIR = PROJECT_ROOT / "spring-boot-app" / "src" / "main" / "resources" / "static"

DATABASE_PATH = Path(os.environ.get("WEBRARY_DB", str(DEFAULT_DB_PATH))).resolve()
UPLOAD_DIR = Path(os.environ.get("WEBRARY_UPLOAD_DIR", str(DEFAULT_UPLOAD_DIR))).resolve()
STATIC_DIR = Path(os.environ.get("WEBRARY_STATIC_DIR", str(DEFAULT_STATIC_DIR))).resolve()

SESSION_SECRET = os.environ.get("SESSION_SECRET", "webrary-dev-secret-change-me")
SESSION_COOKIE = "webrary_session"
SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE", str(7 * 24 * 3600)))

Z_LIBRARY_DEFAULT_DOMAIN = os.environ.get("Z_LIBRARY_DEFAULT_DOMAIN", "fuckfbi.ru")

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))
