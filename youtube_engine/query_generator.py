from __future__ import annotations

import re


def generate_youtube_queries(user_query: str, *, max_queries: int = 4) -> list[str]:
    base = user_query.strip()
    if not base:
        return []

    queries = [base]
    lowered = base.lower()

    if "youtube" in lowered or "video" in lowered:
        cleaned = re.sub(r"\b(?:youtube|video|analyse|analyze|summarize|summary of)\b", "", lowered, flags=re.I)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if cleaned and cleaned not in queries:
            queries.append(cleaned)

    if "tutorial" not in lowered:
        queries.append(f"{base} tutorial")

    if "explained" not in lowered:
        queries.append(f"{base} explained")

    unique: list[str] = []
    seen: set[str] = set()
    for query in queries:
        key = query.lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique.append(query.strip())

    return unique[:max_queries]
