from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ResearchChunk:
    index: int
    text: str
    char_count: int


@dataclass
class ResearchResult:
    title: str
    url: str
    final_url: str
    host: str
    snippet: str
    status_code: int | None
    content_type: str | None
    extraction_success: bool
    score: float
    title_extracted: str | None = None
    published: str | None = None
    language: str | None = None
    chunks: list[ResearchChunk] = field(default_factory=list)
    error: str | None = None


@dataclass
class ResearchResponse:
    query: str
    search_time_ms: int
    providers: list[str]
    total_results: int
    results: list[ResearchResult]
