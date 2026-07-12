from __future__ import annotations

import re


def score_video(query: str, *, title: str, description: str, transcript_text: str) -> float:
    query_terms = set(re.findall(r"[a-z0-9]{3,}", query.lower()))
    if not query_terms:
        return 0.0

    title_terms = set(re.findall(r"[a-z0-9]{3,}", title.lower()))
    desc_terms = set(re.findall(r"[a-z0-9]{3,}", description.lower()[:1200]))
    transcript_terms = set(re.findall(r"[a-z0-9]{3,}", transcript_text.lower()[:4000]))

    title_overlap = len(query_terms & title_terms) / max(len(query_terms), 1)
    desc_overlap = len(query_terms & desc_terms) / max(len(query_terms), 1)
    transcript_overlap = len(query_terms & transcript_terms) / max(len(query_terms), 1)

    score = title_overlap * 40 + desc_overlap * 20 + transcript_overlap * 25
    if transcript_text:
        score += 10
    if len(title) > 8:
        score += 5
    return round(score, 2)
