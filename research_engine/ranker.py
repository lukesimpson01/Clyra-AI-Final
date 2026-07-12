from __future__ import annotations

import re

from .providers.base import SearchHit


def score_result(
    query: str,
    hit: SearchHit,
    extracted: str,
    extraction_success: bool,
) -> float:
    q_tokens = set(re.findall(r"[a-z0-9]+", query.lower()))
    title_tokens = set(re.findall(r"[a-z0-9]+", hit.title.lower()))
    snippet_tokens = set(re.findall(r"[a-z0-9]+", hit.snippet.lower()))
    body_tokens = set(re.findall(r"[a-z0-9]+", extracted.lower()[:2000]))

    overlap = len(q_tokens & (title_tokens | snippet_tokens | body_tokens))
    score = max(0.0, 12 - hit.position)
    score += overlap * 2.2
    if extraction_success:
        score += 4
    score += min(len(extracted) / 1200, 3)
    host = hit.url.split("/")[2] if "://" in hit.url else ""
    if any(x in host for x in ("wikipedia.org", "github.com", "official", ".gov")):
        score += 1.5
    return round(score, 3)
