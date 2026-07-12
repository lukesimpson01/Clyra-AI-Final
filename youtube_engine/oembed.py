from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import quote

from youtube_engine.url_normalizer import canonical_video_url


async def fetch_oembed_metadata(video_id: str) -> dict[str, Any] | None:
    return await asyncio.to_thread(_fetch_oembed_sync, video_id)


def _fetch_oembed_sync(video_id: str) -> dict[str, Any] | None:
    try:
        import httpx

        url = canonical_video_url(video_id)
        endpoint = f"https://www.youtube.com/oembed?url={quote(url, safe='')}&format=json"
        with httpx.Client(timeout=12.0, follow_redirects=True) as client:
            response = client.get(endpoint)
            response.raise_for_status()
            payload = response.json()

        title = str(payload.get("title") or "").strip()
        if not title:
            return None

        author = str(payload.get("author_name") or "").strip() or None
        thumbnail = str(payload.get("thumbnail_url") or "").strip() or None

        return {
            "video_id": video_id,
            "title": title,
            "description": None,
            "uploader": author,
            "channel": author,
            "duration": None,
            "upload_date": None,
            "language": None,
            "view_count": None,
            "thumbnail": thumbnail,
            "tags": [],
            "categories": [],
            "chapters": [],
            "webpage_url": url,
            "source": "oembed",
        }
    except Exception:
        return None
