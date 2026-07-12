from __future__ import annotations

import re


def generate_search_queries(query: str) -> list[str]:
    clean = re.sub(r"\s+", " ", query.strip())
    if not clean:
        return []
    queries = [clean]
    lowered = clean.lower().rstrip("?")
    if lowered.startswith("what is "):
        queries.append(clean.replace("what is ", "", 1).strip() + " official")
    if "fable" in lowered and "ai" in lowered:
        queries.append("Fable AI company product")
    # dedupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = q.lower()
        if key not in seen:
            seen.add(key)
            out.append(q)
    return out[:3]
