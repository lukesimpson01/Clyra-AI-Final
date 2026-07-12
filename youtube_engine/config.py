from __future__ import annotations

from dataclasses import dataclass


@dataclass
class YouTubeConfig:
    timeout_seconds: float = 20.0
    max_results: int = 5
    max_concurrent: int = 4
    max_transcript_chars: int = 12000
    max_chunk_chars: int = 900
    preferred_languages: tuple[str, ...] = ("en", "en-US", "en-GB")
    user_agent: str = "ClyraYouTubeResearch/1.0"
