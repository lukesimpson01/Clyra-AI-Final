#!/usr/bin/env python3
"""Actually shallow-clone every independently importable Landing Pages repository.

Safety: no upstream install/build/test scripts execute. Each repository is
cloned into a fresh temporary folder and then deleted. Evidence includes the
actual successful Git commit, source URL and the exact command a user can copy.
This is a source checkout test, not a deployed website functional test.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import json
import os
import re
import subprocess
import tempfile
import time
import shutil

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "lib/clyra-code/library/landing-pages.ts"
OUTPUT = ROOT / "landing-page-clone-results.json"
PATTERN = re.compile(r'repository: "(uiuxlabz/[a-z0-9-]+)"')
MAX_WORKERS = 5


def sources() -> list[str]:
    repos = PATTERN.findall(INVENTORY.read_text(encoding="utf-8"))
    if len(repos) != 75 or len(set(repos)) != 75:
        raise RuntimeError(f"Expected exactly 75 distinct landing-page source repositories, got {len(repos)}")
    return repos


def verify(repository: str) -> dict[str, str | float | bool]:
    url = f"https://github.com/{repository}.git"
    # The exact copyable UI command uses the same URL and '.git' suffix.
    clone_command = f"git clone {url}"
    error = "Unknown failure"
    for attempt in range(2):
        with tempfile.TemporaryDirectory(prefix="clyra-landing-clone-") as temp:
            checkout = Path(temp) / "source"
            cmd = ["git", "-c", "core.hooksPath=/dev/null", "clone", "--depth", "1",
                   "--single-branch", "--no-tags", url, str(checkout)]
            env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1")
            start = time.monotonic()
            try:
                result = subprocess.run(cmd, timeout=140, capture_output=True, text=True,
                                        check=False, env=env)
                if result.returncode:
                    raise RuntimeError(f"git clone exit {result.returncode}: {result.stderr[-650:]}")
                if not (checkout / "index.html").is_file():
                    raise RuntimeError("Checkout missing index.html")
                if not (checkout / "screenshot.png").is_file():
                    raise RuntimeError("Checkout missing upstream screenshot.png")
                sha = subprocess.check_output(
                    ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True, timeout=12,
                    env=env).strip()
                if not re.fullmatch(r"[0-9a-f]{40}", sha):
                    raise RuntimeError(f"Unrecognised Git revision: {sha}")
                elapsed = round(time.monotonic() - start, 2)
                return dict(repository=repository, url=url, clone_command=clone_command,
                            commit=sha, seconds=elapsed, success=True)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                error = str(exc)[-700:]
                if attempt == 0:
                    time.sleep(1.5)
    return dict(repository=repository, url=url, clone_command=clone_command,
                error=error, success=False)


def main() -> int:
    repos = sources()
    records: list[dict[str, str | bool | float]] = []
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        jobs = {pool.submit(verify, repo): repo for repo in repos}
        for future in as_completed(jobs):
            item = future.result()
            records.append(item)
            if item["success"]:
                print(f"PASS {item['clone_command']} @ {str(item['commit'])[:12]}", flush=True)
            else:
                print(f"FAIL {item['clone_command']}: {item['error']}", flush=True)
    records.sort(key=lambda x: repos.index(str(x["repository"])))
    passed = sum(bool(r["success"]) for r in records)
    OUTPUT.write_text(json.dumps(
        {"checked": len(records), "passed": passed, "failed": len(records) - passed,
         "tests": records}, indent=2) + "\n", encoding="utf-8")
    print(f"RESULT: {passed}/{len(repos)} actual shallow Git clones + index.html + screenshot.png checks")
    if passed != len(repos):
        print(f"Failed clone proof saved in {OUTPUT.name}; keep failing entries unverified.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
