from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TranscriptChunk:
    chunk_number: int
    start_timestamp: str
    end_timestamp: str
    text: str
    char_count: int


@dataclass
class VideoChapter:
    title: str
    start_time: float
    timestamp: str


@dataclass
class YouTubeVideoResult:
    score: float
    video_id: str
    title: str
    url: str
    thumbnail: str | None
    uploader: str | None
    channel: str | None
    duration: int | None
    upload_date: str | None
    language: str | None
    views: int | None
    description: str | None
    chapters: list[VideoChapter] = field(default_factory=list)
    transcript_available: bool = False
    transcript_language: str | None = None
    transcript_chunks: list[TranscriptChunk] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    extracted_links: list[str] = field(default_factory=list)
    summary: str | None = None
    error: str | None = None


@dataclass
class YouTubeResearchResponse:
    query: str
    search_time_ms: int
    total_results: int
    videos: list[YouTubeVideoResult]
