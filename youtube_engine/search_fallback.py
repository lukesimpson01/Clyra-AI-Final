from __future__ import annotations

import asyncio
import re
from typing import Any

from youtube_engine.url_normalizer import extract_video_id


async def search_youtube_ddgs(query: str, *, max_results: int = 5) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_search_ddgs_sync, query, max_results)


def _search_ddgs_sync(query: str, max_results: int) -> list[dict[str, Any]]:
    try:
        from ddgs import DDGS

        results: list[dict[str, Any]] = []
        seen: set[str] = set()
        search_query = f"site:youtube.com {query}".strip()

        with DDGS() as ddgs:
            hits = list(ddgs.text(search_query, max_results=max_results * 2))

        for hit in hits:
            href = str(hit.get("href") or "")
            video_id = extract_video_id(href)
            if not video_id or video_id in seen:
                continue
            seen.add(video_id)
            title = str(hit.get("title") or "YouTube video").strip()
            title = re.sub(r"\s*-\s*YouTube$", "", title, flags=re.IGNORECASE)
            results.append(
                {
                    "video_id": video_id,
                    "title": title or "YouTube video",
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "uploader": None,
                    "duration": None,
                    "snippet": str(hit.get("body") or "").strip() or None,
                }
            )
            if len(results) >= max_results:
                break

        return results
    except Exception:
        return []
