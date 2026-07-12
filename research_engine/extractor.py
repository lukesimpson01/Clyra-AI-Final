from __future__ import annotations

import re

import httpx
from bs4 import BeautifulSoup

try:
    import trafilatura
except ImportError:  # pragma: no cover
    trafilatura = None


def extract_main_content(html: str, url: str, limit: int) -> tuple[str, str | None, bool]:
    if trafilatura:
        try:
            downloaded = trafilatura.extract(
                html,
                url=url,
                include_comments=False,
                include_tables=True,
                favor_precision=True,
            )
            if downloaded and len(downloaded.strip()) > 80:
                title = trafilatura.extract_metadata(html, default_url=url)
                title_text = getattr(title, "title", None) if title else None
                return downloaded.strip()[:limit], title_text, True
        except Exception:
            pass

    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "svg", "noscript", "iframe", "nav", "footer", "header", "aside"]):
        tag.decompose()
    title = soup.title.get_text(strip=True) if soup.title else None
    text = soup.get_text("\n", strip=True)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:limit], title, bool(text.strip())
