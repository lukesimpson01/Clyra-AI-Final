from __future__ import annotations

import asyncio
import re
from typing import Any

from youtube_engine.oembed import fetch_oembed_metadata
from youtube_engine.search_fallback import search_youtube_ddgs


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


async def search_youtube(query: str, *, max_results: int = 5) -> list[dict[str, Any]]:
    hits = await asyncio.to_thread(_search_sync, query, max_results)
    if hits:
        return hits
    return await search_youtube_ddgs(query, max_results=max_results)


def _search_sync(query: str, max_results: int) -> list[dict[str, Any]]:
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": True,
            "default_search": f"ytsearch{max_results}",
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)
        entries = info.get("entries") or []
        results: list[dict[str, Any]] = []
        for entry in entries:
            if not entry:
                continue
            video_id = entry.get("id") or entry.get("url", "").split("watch?v=")[-1][:11]
            if not video_id or not re.fullmatch(r"[\w-]{11}", str(video_id)):
                continue
            results.append(
                {
                    "video_id": str(video_id),
                    "title": str(entry.get("title") or "Untitled"),
                    "url": f"https://www.youtube.com/watch?v={video_id}",
                    "uploader": entry.get("uploader") or entry.get("channel"),
                    "duration": entry.get("duration"),
                }
            )
        return results
    except Exception:
        return []


async def fetch_video_metadata(video_id: str) -> dict[str, Any] | None:
    metadata = await asyncio.to_thread(_metadata_sync, video_id)
    if metadata:
        metadata["source"] = "yt_dlp"
        return metadata
    return await fetch_oembed_metadata(video_id)


def _metadata_sync(video_id: str) -> dict[str, Any] | None:
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": False,
            "writeautomaticsub": False,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        if not info:
            return None

        chapters = []
        for chapter in info.get("chapters") or []:
            start = float(chapter.get("start_time") or 0)
            chapters.append(
                {
                    "title": str(chapter.get("title") or "Chapter"),
                    "start_time": start,
                    "timestamp": _format_timestamp(start),
                }
            )

        return {
            "video_id": video_id,
            "title": str(info.get("title") or ""),
            "description": str(info.get("description") or ""),
            "uploader": info.get("uploader"),
            "channel": info.get("channel") or info.get("uploader"),
            "duration": info.get("duration"),
            "upload_date": info.get("upload_date"),
            "language": info.get("language"),
            "view_count": info.get("view_count"),
            "thumbnail": info.get("thumbnail"),
            "tags": [str(t) for t in (info.get("tags") or [])[:20]],
            "categories": [str(c) for c in (info.get("categories") or [])],
            "chapters": chapters,
            "webpage_url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}",
        }
    except Exception:
        return None
