from __future__ import annotations

import asyncio

from .base import SearchHit, SearchProvider


class DuckDuckGoProvider(SearchProvider):
    name = "duckduckgo"

    async def search(self, query: str, max_results: int = 8) -> list[SearchHit]:
        return await asyncio.to_thread(self._search_sync, query, max_results)

    def _search_sync(self, query: str, max_results: int) -> list[SearchHit]:
        try:
            try:
                from ddgs import DDGS
            except ImportError:
                from duckduckgo_search import DDGS

            hits: list[SearchHit] = []
            with DDGS() as ddgs:
                for i, row in enumerate(ddgs.text(query, max_results=max_results)):
                    url = str(row.get("href") or row.get("url") or "").strip()
                    if not url.startswith("http"):
                        continue
                    hits.append(
                        SearchHit(
                            title=str(row.get("title") or url),
                            url=url,
                            snippet=str(row.get("body") or row.get("snippet") or ""),
                            position=i + 1,
                            provider=self.name,
                        )
                    )
            return hits
        except Exception:
            return []
