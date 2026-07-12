from __future__ import annotations

from urllib.parse import urlparse, urlunparse


def normalize_url(url: str) -> str | None:
    raw = (url or "").strip()
    if not raw:
        return None
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    try:
        parsed = urlparse(raw)
        if not parsed.netloc:
            return None
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        clean = parsed._replace(
            netloc=host,
            fragment="",
            query="",
        )
        path = clean.path or "/"
        while "//" in path:
            path = path.replace("//", "/")
        clean = clean._replace(path=path)
        return urlunparse(clean)
    except Exception:
        return None


def host_from_url(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""
