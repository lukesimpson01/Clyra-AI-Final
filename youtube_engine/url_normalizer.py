from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}


def extract_video_id(url: str) -> str | None:
    raw = url.strip()
    if not raw:
        return None

    if re.fullmatch(r"[\w-]{11}", raw):
        return raw

    try:
        parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    except Exception:
        return None

    host = (parsed.hostname or "").lower()
    if host not in _YOUTUBE_HOSTS:
        return None

    if host.endswith("youtu.be"):
        candidate = parsed.path.lstrip("/").split("/")[0]
        return candidate if re.fullmatch(r"[\w-]{11}", candidate) else None

    if parsed.path.startswith("/shorts/"):
        candidate = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else ""
        return candidate if re.fullmatch(r"[\w-]{11}", candidate) else None

    if parsed.path.startswith("/watch"):
        video_ids = parse_qs(parsed.query).get("v", [])
        candidate = video_ids[0] if video_ids else ""
        return candidate if re.fullmatch(r"[\w-]{11}", candidate) else None

    if parsed.path.startswith("/embed/"):
        candidate = parsed.path.split("/")[2] if len(parsed.path.split("/")) > 2 else ""
        return candidate if re.fullmatch(r"[\w-]{11}", candidate) else None

    return None


def canonical_video_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"
