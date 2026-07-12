from __future__ import annotations

import asyncio
import time
from typing import Awaitable, Callable

import httpx

from .cleaner import chunk_text, clean_text
from .config import ResearchConfig
from .extractor import extract_main_content
from .models import ResearchChunk, ResearchResponse, ResearchResult
from .query_generator import generate_search_queries
from .aggregator import merge_hits
from .providers.duckduckgo_provider import DuckDuckGoProvider
from .providers.base import SearchHit
from .ranker import score_result
from .url_normalizer import host_from_url, normalize_url


ProgressCallback = Callable[[dict], Awaitable[None] | None]


class ResearchEngine:
    def __init__(self, config: ResearchConfig | None = None) -> None:
        self.config = config or ResearchConfig()
        self.providers = [DuckDuckGoProvider()]

    async def research(self, query: str, on_progress: ProgressCallback | None = None) -> ResearchResponse:
        started = time.time()
        queries = generate_search_queries(query)
        all_hits: list[SearchHit] = []

        async def emit(event: dict) -> None:
            if on_progress:
                maybe = on_progress(event)
                if asyncio.iscoroutine(maybe):
                    await maybe

        for q in queries:
            for provider in self.providers:
                hits = await provider.search(q, max_results=self.config.max_pages + 2)
                all_hits.extend(hits)

        merged = merge_hits(all_hits)[: self.config.max_pages]
        results: list[ResearchResult] = []

        sem = asyncio.Semaphore(self.config.max_concurrent_fetches)

        async with httpx.AsyncClient(
            http2=True,
            timeout=self.config.timeout_seconds,
            follow_redirects=True,
            headers={"User-Agent": self.config.user_agent, "Accept-Encoding": "gzip, deflate, br"},
        ) as client:

            async def fetch_one(hit: SearchHit) -> ResearchResult | None:
                normalized = normalize_url(hit.url)
                if not normalized:
                    return None
                host = host_from_url(normalized)
                await emit({"type": "site", "host": host, "title": hit.title, "url": normalized})

                async with sem:
                    try:
                        response = await client.get(normalized)
                        html = response.text
                        extracted, title_extracted, ok = extract_main_content(
                            html,
                            normalized,
                            self.config.max_extract_chars,
                        )
                        cleaned = clean_text(extracted)
                        chunks = [
                            ResearchChunk(index=i, text=c, char_count=len(c))
                            for i, c in enumerate(chunk_text(cleaned, self.config.max_chunk_chars))
                        ]
                        score = score_result(query, hit, cleaned, ok)
                        return ResearchResult(
                            title=hit.title,
                            url=hit.url,
                            final_url=str(response.url),
                            host=host,
                            snippet=hit.snippet,
                            status_code=response.status_code,
                            content_type=response.headers.get("content-type"),
                            extraction_success=ok and bool(cleaned),
                            score=score,
                            title_extracted=title_extracted,
                            chunks=chunks,
                        )
                    except Exception as exc:
                        return ResearchResult(
                            title=hit.title,
                            url=hit.url,
                            final_url=normalized,
                            host=host,
                            snippet=hit.snippet,
                            status_code=None,
                            content_type=None,
                            extraction_success=False,
                            score=0,
                            error=str(exc),
                            chunks=[],
                        )

            fetched = await asyncio.gather(*(fetch_one(hit) for hit in merged))
            results = [r for r in fetched if r is not None]

        results.sort(key=lambda r: r.score, reverse=True)
        elapsed = int((time.time() - started) * 1000)
        response = ResearchResponse(
            query=query,
            search_time_ms=elapsed,
            providers=[p.name for p in self.providers],
            total_results=len(results),
            results=results,
        )
        await emit({"type": "complete", "response": response})
        return response
