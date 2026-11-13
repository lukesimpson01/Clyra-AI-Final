#!/usr/bin/env python3
"""Vendor authentic, upstream-supplied landing-page screenshot.png images.

Do not invent screenshots, synthesize layouts, scrape preview thumbnails, or
mark a template as locally built/runnable. All inputs are screenshots committed
to the individual upstream open-source repositories. Source links and copyright
notices remain visible in Clyra Code's template details.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
import re
import sys
import time

from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "lib/clyra-code/library/landing-pages.ts"
DEST = ROOT / "public/library-shots"
PATTERN = re.compile(r'^\s*\{ id: "(landing-[^"]+)",.*?screenshotSource: "(https://[^"]+)" \},\s*$', re.M)
MAX_BYTES = 12 * 1024 * 1024
SCREENSHOT_SIZE = (1200, 750)
USER_AGENT = "Clyra-Code-Landing-Capture/1.0 (upstream-public-repo-screenshots)"


def source_rows() -> list[tuple[str, str]]:
    rows = PATTERN.findall(INVENTORY.read_text(encoding="utf-8"))
    if len(rows) != 75 or len(set(key for key, _url in rows)) != len(rows):
        raise RuntimeError(f"Expected 75 unique screenshot records, found {len(rows)}")
    if any(not url.startswith("https://raw.githubusercontent.com/uiuxlabz/") or not url.endswith("/main/screenshot.png")
           for _id, url in rows):
        raise RuntimeError("Unrecognised screenshot provenance; refusing external URL")
    return rows


def capture(item: tuple[str, str]) -> tuple[str, int]:
    template_id, url = item
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/png"})
            with urlopen(req, timeout=22) as response:
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status} from {url}")
                raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES or raw[:8] != b"\x89PNG\r\n\x1a\n":
                raise RuntimeError(f"Not a valid PNG or exceeds {MAX_BYTES} bytes: {url}")
            with Image.open(BytesIO(raw)) as image:
                image.load()
                if image.width < 500 or image.height < 300:
                    raise RuntimeError(f"Screenshot unexpectedly small ({image.size}): {url}")
                clean = ImageOps.exif_transpose(image).convert("RGB")
                # Keep the real hero/first fold and optimise to predictable
                # fixed dimensions without changing the actual UI content.
                preview = ImageOps.fit(clean, SCREENSHOT_SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.0))
                target = DEST / f"{template_id}.jpg"
                preview.save(target, format="JPEG", quality=82, optimize=True, progressive=True)
                if target.stat().st_size < 8_000:
                    raise RuntimeError(f"Suspiciously empty JPEG: {target}")
                return template_id, target.stat().st_size
        except (OSError, RuntimeError, UnidentifiedImageError, ValueError) as error:
            last_error = error
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"{template_id}: could not verify source screenshot: {last_error}")


def main() -> int:
    DEST.mkdir(parents=True, exist_ok=True)
    rows = source_rows()
    completed: dict[str, int] = {}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(capture, row): row[0] for row in rows}
        for future in as_completed(futures):
            item = futures[future]
            try:
                key, size = future.result()
                completed[key] = size
                print(f"CAPTURED {key} ({size // 1024} KB)", flush=True)
            except Exception as error:
                errors.append(f"{item}: {error}")
                print(f"FAILED {item}: {error}", file=sys.stderr, flush=True)
    if errors or len(completed) != len(rows):
        for error in errors:
            print(error, file=sys.stderr)
        print(f"FAILED: {len(completed)}/{len(rows)} genuine screenshot files.", file=sys.stderr)
        return 1
    print(f"PASS: {len(completed)} verified upstream screenshots optimised locally, total {sum(completed.values()) // 1024} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
