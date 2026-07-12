from __future__ import annotations

import asyncio
import os
import re
import xml.etree.ElementTree as ET
from typing import Any


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _build_transcript_api():
    from youtube_transcript_api import YouTubeTranscriptApi

    ws_user = os.environ.get("YTT_WEBSHARE_USERNAME") or os.environ.get(
        "WEBSHARE_PROXY_USERNAME"
    )
    ws_pass = os.environ.get("YTT_WEBSHARE_PASSWORD") or os.environ.get(
        "WEBSHARE_PROXY_PASSWORD"
    )
    if ws_user and ws_pass:
        from youtube_transcript_api.proxies import WebshareProxyConfig

        return YouTubeTranscriptApi(
            proxy_config=WebshareProxyConfig(
                proxy_username=ws_user,
                proxy_password=ws_pass,
                retries_when_blocked=3,
            )
        )

    proxy = (
        os.environ.get("YOUTUBE_HTTP_PROXY")
        or os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
    )
    if proxy:
        from youtube_transcript_api.proxies import GenericProxyConfig

        return YouTubeTranscriptApi(
            proxy_config=GenericProxyConfig(http_url=proxy, https_url=proxy)
        )

    return YouTubeTranscriptApi()


def _segments_from_fetched(fetched: Any) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for item in fetched:
        if isinstance(item, dict):
            start = float(item.get("start", 0))
            text = str(item.get("text", ""))
            duration = float(item.get("duration", 0))
        else:
            start = float(getattr(item, "start", 0))
            text = str(getattr(item, "text", ""))
            duration = float(getattr(item, "duration", 0))

        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue
        segments.append(
            {
                "start": start,
                "end": start + duration,
                "timestamp": _format_timestamp(start),
                "text": text,
            }
        )
    return segments


def _segments_from_timedtext_xml(raw: str) -> list[dict[str, Any]]:
    try:
        root = ET.fromstring(raw)
    except Exception:
        return []

    segments: list[dict[str, Any]] = []
    for node in root.findall("text"):
        text = re.sub(r"\s+", " ", (node.text or "")).strip()
        if not text:
            continue
        start = float(node.attrib.get("start", 0))
        duration = float(node.attrib.get("dur", 0))
        segments.append(
            {
                "start": start,
                "end": start + duration,
                "timestamp": _format_timestamp(start),
                "text": text,
            }
        )
    return segments


def _fetch_timedtext_sync(video_id: str, language: str = "en") -> list[dict[str, Any]]:
    try:
        import httpx

        params = f"v={video_id}&lang={language}&fmt=vtt"
        url = f"https://www.youtube.com/api/timedtext?{params}"
        with httpx.Client(timeout=15.0, follow_redirects=True) as client:
            response = client.get(url)
            if response.status_code != 200 or not response.text.strip():
                return []
            return _segments_from_timedtext_xml(response.text)
    except Exception:
        return []


async def fetch_transcript(
    video_id: str,
    *,
    preferred_languages: tuple[str, ...] = ("en", "en-US", "en-GB"),
) -> tuple[list[dict[str, Any]], str | None]:
    return await asyncio.to_thread(
        _fetch_transcript_sync, video_id, preferred_languages
    )


def _fetch_transcript_sync(
    video_id: str,
    preferred_languages: tuple[str, ...],
) -> tuple[list[dict[str, Any]], str | None]:
    try:
        api = _build_transcript_api()
        transcript_list = api.list(video_id)

        transcript = None
        language = None
        for lang in preferred_languages:
            try:
                transcript = transcript_list.find_transcript([lang])
                language = lang
                break
            except Exception:
                continue

        if transcript is None:
            try:
                transcript = transcript_list.find_generated_transcript(["en"])
                language = "en"
            except Exception:
                try:
                    transcript = next(iter(transcript_list))
                    language = getattr(transcript, "language_code", None)
                except Exception:
                    transcript = None

        if transcript is not None:
            fetched = transcript.fetch()
            segments = _segments_from_fetched(fetched)
            if segments:
                return segments, language
    except Exception:
        pass

    for lang in preferred_languages:
        segments = _fetch_timedtext_sync(video_id, lang)
        if segments:
            return segments, lang

    return [], None
