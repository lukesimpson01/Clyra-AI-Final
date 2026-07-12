from __future__ import annotations

import re

from youtube_engine.models import TranscriptChunk


def chunk_transcript(
    segments: list[dict],
    *,
    video_id: str,
    title: str,
    max_chars: int = 900,
) -> list[TranscriptChunk]:
    if not segments:
        return []

    chunks: list[TranscriptChunk] = []
    buffer = ""
    start_ts = segments[0].get("timestamp", "00:00")
    end_ts = start_ts

    def flush() -> None:
        nonlocal buffer, start_ts, end_ts
        text = buffer.strip()
        if text:
            chunks.append(
                TranscriptChunk(
                    chunk_number=len(chunks),
                    start_timestamp=start_ts,
                    end_timestamp=end_ts,
                    text=text,
                    char_count=len(text),
                )
            )
        buffer = ""

    for segment in segments:
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        ts = str(segment.get("timestamp") or end_ts)
        if not buffer:
            start_ts = ts
        candidate = f"{buffer} {text}".strip() if buffer else text
        if len(candidate) > max_chars and buffer:
            flush()
            start_ts = ts
            buffer = text
        else:
            buffer = candidate
        end_ts = ts

    flush()
    return chunks
