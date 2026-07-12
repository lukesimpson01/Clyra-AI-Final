#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import sys

from youtube_engine.engine import YouTubeResearchEngine


def serialize_response(resp) -> dict:
    return {
        "type": "complete",
        "query": resp.query,
        "search_time_ms": resp.search_time_ms,
        "total_results": resp.total_results,
        "videos": [
            {
                "score": v.score,
                "video_id": v.video_id,
                "title": v.title,
                "url": v.url,
                "thumbnail": v.thumbnail,
                "uploader": v.uploader,
                "channel": v.channel,
                "duration": v.duration,
                "upload_date": v.upload_date,
                "language": v.language,
                "views": v.views,
                "description": v.description,
                "chapters": [
                    {
                        "title": c.title,
                        "start_time": c.start_time,
                        "timestamp": c.timestamp,
                    }
                    for c in v.chapters
                ],
                "transcript_available": v.transcript_available,
                "transcript_language": v.transcript_language,
                "transcript_chunks": [
                    {
                        "chunk_number": c.chunk_number,
                        "start_timestamp": c.start_timestamp,
                        "end_timestamp": c.end_timestamp,
                        "text": c.text,
                        "char_count": c.char_count,
                    }
                    for c in v.transcript_chunks
                ],
                "keywords": v.keywords,
                "entities": v.entities,
                "extracted_links": v.extracted_links,
                "summary": v.summary,
                "error": v.error,
            }
            for v in resp.videos
        ],
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="Clyra YouTube research pipeline")
    parser.add_argument("query", help="Research query or YouTube URL")
    parser.add_argument("--url", dest="video_url", default=None, help="Direct YouTube URL")
    args = parser.parse_args()

    query = str(args.query or "").strip()
    video_url = str(args.video_url or "").strip() or None

    if not query:
        print(json.dumps({"type": "error", "message": "query required"}))
        sys.exit(1)

    async def on_progress(event: dict) -> None:
        if event.get("type") == "complete":
            print(json.dumps(serialize_response(event["response"])), flush=True)
        else:
            print(json.dumps(event), flush=True)

    engine = YouTubeResearchEngine()
    await engine.research(query, video_url=video_url, on_progress=on_progress)


if __name__ == "__main__":
    asyncio.run(main())
