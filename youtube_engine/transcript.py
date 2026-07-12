from __future__ import annotations

import asyncio
import re
from typing import Any


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


async def fetch_transcript(
    video_id: str,
    *,
    preferred_languages: tuple[str, ...] = ("en", "en-US", "en-GB"),
) -> tuple[list[dict[str, Any]], str | None]:
    return await asyncio.to_thread(_fetch_transcript_sync, video_id, preferred_languages)


def _fetch_transcript_sync(
    video_id: str,
    preferred_languages: tuple[str, ...],
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        api = YouTubeTranscriptApi()
        transcript_list = api.list(video_id)

        transcript = None
        language = None
        for lang in preferred_languages:
            try:
                transcript = transcript_list.find_transcript([lang])
                language = lang
                break
            except Exception:
                continue

        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(["en"])
                language = "en"
            except Exception:
                try:
                    transcript = next(iter(transcript_list))
                    language = getattr(transcript, "language_code", None)
                except Exception:
                    return [], None

        fetched = transcript.fetch()
        segments: list[dict[str, Any]] = []
        for item in fetched:
            start = float(getattr(item, "start", item.get("start", 0)) if isinstance(item, dict) else item.start)
            text = str(getattr(item, "text", item.get("text", "")) if isinstance(item, dict) else item.text)
            text = re.sub(r"\s+", " ", text).strip()
            if not text:
                continue
            duration = float(getattr(item, "duration", item.get("duration", 0)) if isinstance(item, dict) else getattr(item, "duration", 0))
            segments.append(
                {
                    "start": start,
                    "end": start + duration,
                    "timestamp": _format_timestamp(start),
                    "text": text,
                }
            )
        return segments, language
    except Exception:
        return [], None
