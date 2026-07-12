from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

from youtube_engine.chunker import chunk_transcript
from youtube_engine.cleaner import clean_transcript_text, extract_entities, extract_keywords, extract_links
from youtube_engine.config import YouTubeConfig
from youtube_engine.metadata import fetch_video_metadata, search_youtube
from youtube_engine.oembed import fetch_oembed_metadata
from youtube_engine.models import TranscriptChunk, VideoChapter, YouTubeResearchResponse, YouTubeVideoResult
from youtube_engine.query_generator import generate_youtube_queries
from youtube_engine.ranker import score_video
from youtube_engine.transcript import fetch_transcript
from youtube_engine.url_normalizer import canonical_video_url, extract_video_id

ProgressCallback = Callable[[dict], Awaitable[None] | None]


class YouTubeResearchEngine:
    def __init__(self, config: YouTubeConfig | None = None) -> None:
        self.config = config or YouTubeConfig()

    async def research(
        self,
        query: str,
        *,
        video_url: str | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> YouTubeResearchResponse:
        started = time.time()

        async def emit(event: dict) -> None:
            if on_progress:
                maybe = on_progress(event)
                if asyncio.iscoroutine(maybe):
                    await maybe

        candidates: list[dict] = []
        direct_id = extract_video_id(video_url or query)
        if direct_id:
            candidates.append(
                {
                    "video_id": direct_id,
                    "title": "YouTube video",
                    "url": canonical_video_url(direct_id),
                }
            )
        else:
            queries = generate_youtube_queries(query)
            seen_ids: set[str] = set()
            for search_query in queries:
                hits = await search_youtube(search_query, max_results=self.config.max_results)
                for hit in hits:
                    vid = hit["video_id"]
                    if vid in seen_ids:
                        continue
                    seen_ids.add(vid)
                    candidates.append(hit)
                if len(candidates) >= self.config.max_results:
                    break

        candidates = candidates[: self.config.max_results]
        semaphore = asyncio.Semaphore(self.config.max_concurrent)
        results: list[YouTubeVideoResult] = []

        async def process_candidate(candidate: dict) -> YouTubeVideoResult | None:
            video_id = candidate["video_id"]
            preview = await fetch_oembed_metadata(video_id)
            progress_title = str(
                (preview or {}).get("title")
                or candidate.get("title")
                or "YouTube video"
            )
            await emit(
                {
                    "type": "video",
                    "video_id": video_id,
                    "title": progress_title,
                    "url": candidate.get("url") or canonical_video_url(video_id),
                }
            )

            async with semaphore:
                metadata = await fetch_video_metadata(video_id)
                if not metadata:
                    return YouTubeVideoResult(
                        score=0,
                        video_id=video_id,
                        title=str(candidate.get("title") or "YouTube video"),
                        url=canonical_video_url(video_id),
                        thumbnail=None,
                        uploader=None,
                        channel=None,
                        duration=None,
                        upload_date=None,
                        language=None,
                        views=None,
                        description=None,
                        error="Could not load video metadata. The video may be unavailable or blocked from this server.",
                    )

                segments, transcript_language = await fetch_transcript(
                    video_id,
                    preferred_languages=self.config.preferred_languages,
                )
                transcript_text = clean_transcript_text(
                    " ".join(str(seg.get("text") or "") for seg in segments)
                )[: self.config.max_transcript_chars]

                title = str(metadata.get("title") or candidate.get("title") or "")
                description = str(metadata.get("description") or "")
                snippet = str(candidate.get("snippet") or "").strip()
                if not description and snippet:
                    description = snippet
                chunks = chunk_transcript(
                    segments,
                    video_id=video_id,
                    title=title,
                    max_chars=self.config.max_chunk_chars,
                )
                keywords = extract_keywords(title, description, transcript_text)
                entities = extract_entities(title, description, transcript_text)
                links = extract_links(description)
                score = score_video(
                    query,
                    title=title,
                    description=description,
                    transcript_text=transcript_text,
                )

                chapters = [
                    VideoChapter(
                        title=str(ch.get("title") or "Chapter"),
                        start_time=float(ch.get("start_time") or 0),
                        timestamp=str(ch.get("timestamp") or "00:00"),
                    )
                    for ch in metadata.get("chapters") or []
                ]

                return YouTubeVideoResult(
                    score=score,
                    video_id=video_id,
                    title=title,
                    url=str(metadata.get("webpage_url") or canonical_video_url(video_id)),
                    thumbnail=metadata.get("thumbnail"),
                    uploader=metadata.get("uploader"),
                    channel=metadata.get("channel"),
                    duration=metadata.get("duration"),
                    upload_date=metadata.get("upload_date"),
                    language=metadata.get("language"),
                    views=metadata.get("view_count"),
                    description=description[:2500] if description else None,
                    chapters=chapters,
                    transcript_available=bool(transcript_text),
                    transcript_language=transcript_language,
                    transcript_chunks=chunks,
                    keywords=keywords,
                    entities=entities,
                    extracted_links=links,
                    summary=(
                        f"Primary topic: {title}. Keywords: {', '.join(keywords[:6])}."
                        if transcript_text
                        else (
                            f"Video: {title}. "
                            + (
                                f"Channel: {metadata.get('channel')}. "
                                if metadata.get("channel")
                                else ""
                            )
                            + "Transcript could not be fetched from this server; answer using available metadata and description only."
                        )
                    ),
                    error=(
                        None
                        if transcript_text
                        else "Transcript unavailable from this server. Metadata was loaded, but timed captions were blocked or missing."
                    ),
                )

        fetched = await asyncio.gather(*(process_candidate(c) for c in candidates))
        results = [r for r in fetched if r is not None]
        results.sort(key=lambda item: item.score, reverse=True)

        elapsed = int((time.time() - started) * 1000)
        response = YouTubeResearchResponse(
            query=query,
            search_time_ms=elapsed,
            total_results=len(results),
            videos=results,
        )
        await emit({"type": "complete", "response": response})
        return response
