from __future__ import annotations

import re


_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "is", "are", "was", "were", "be", "been", "this", "that", "it", "you",
    "your", "what", "how", "why", "when", "where", "who", "video", "youtube",
}


def clean_transcript_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"(\b\w+\b)(?:\s+\1){2,}", r"\1", text, flags=re.I)
    return text


def extract_keywords(*texts: str, limit: int = 12) -> list[str]:
    joined = " ".join(t for t in texts if t)
    words = re.findall(r"[A-Za-z][A-Za-z0-9+#.-]{2,}", joined)
    counts: dict[str, int] = {}
    for word in words:
        key = word.lower()
        if key in _STOP_WORDS:
            continue
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], -len(item[0])))
    return [word for word, _ in ranked[:limit]]


def extract_entities(*texts: str, limit: int = 10) -> list[str]:
    joined = " ".join(t for t in texts if t)
    patterns = [
        r"\b(?:Python|JavaScript|TypeScript|React|Node\.js|Unity|Unreal|Rust|Go|Java)\b",
        r"\b(?:GitHub|OpenAI|Anthropic|Google|Microsoft|Apple|NVIDIA)\b",
        r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b",
    ]
    found: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        for match in re.findall(pattern, joined):
            key = match.strip()
            if key.lower() in seen:
                continue
            seen.add(key.lower())
            found.append(key)
            if len(found) >= limit:
                return found
    return found


def extract_links(description: str) -> list[str]:
    if not description:
        return []
    links = re.findall(r"https?://[^\s)>\"]+", description)
    unique: list[str] = []
    seen: set[str] = set()
    for link in links:
        clean = link.rstrip(".,)")
        if clean not in seen:
            seen.add(clean)
            unique.append(clean)
    return unique[:12]
