#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys

from research_engine.engine import ResearchEngine


async def main() -> None:
    query = " ".join(sys.argv[1:]).strip()
    if not query:
        print(json.dumps({"type": "error", "message": "query required"}))
        sys.exit(1)

    async def on_progress(event: dict) -> None:
        if event.get("type") == "complete":
            resp = event["response"]
            payload = {
                "type": "complete",
                "query": resp.query,
                "search_time_ms": resp.search_time_ms,
                "providers": resp.providers,
                "total_results": resp.total_results,
                "results": [
                    {
                        "title": r.title,
                        "url": r.url,
                        "final_url": r.final_url,
                        "host": r.host,
                        "snippet": r.snippet,
                        "status_code": r.status_code,
                        "content_type": r.content_type,
                        "extraction_success": r.extraction_success,
                        "score": r.score,
                        "title_extracted": r.title_extracted,
                        "chunks": [
                            {"index": c.index, "text": c.text, "char_count": c.char_count}
                            for c in r.chunks
                        ],
                        "error": r.error,
                    }
                    for r in resp.results
                ],
            }
            print(json.dumps(payload), flush=True)
        else:
            print(json.dumps(event), flush=True)

    engine = ResearchEngine()
    await engine.research(query, on_progress=on_progress)


if __name__ == "__main__":
    asyncio.run(main())
