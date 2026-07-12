from __future__ import annotations

from .providers.base import SearchHit


def merge_hits(all_hits: list[SearchHit]) -> list[SearchHit]:
    merged: list[SearchHit] = []
    seen_urls: set[str] = set()
    seen_hosts: dict[str, int] = {}

    for hit in sorted(all_hits, key=lambda h: h.position):
        key = hit.url.lower().split("#")[0]
        if key in seen_urls:
            continue
        host = hit.url.split("/")[2].lower().replace("www.", "") if "://" in hit.url else ""
        if host and seen_hosts.get(host, 0) >= 2:
            continue
        seen_urls.add(key)
        if host:
            seen_hosts[host] = seen_hosts.get(host, 0) + 1
        merged.append(hit)
    return merged
