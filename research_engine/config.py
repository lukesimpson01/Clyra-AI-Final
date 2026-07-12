from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ResearchConfig:
    timeout_seconds: float = 12.0
    max_pages: int = 6
    max_concurrent_fetches: int = 12
    max_chunk_chars: int = 900
    max_extract_chars: int = 12000
    cache_ttl_seconds: int = 3600
    user_agent: str = "ClyraResearch/1.0 (+https://clyra.ai)"
    retry_count: int = 2
