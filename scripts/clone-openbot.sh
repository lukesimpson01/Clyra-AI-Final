#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
checkout="$repo_root/.reference/openbot"

if [[ -d "$checkout/.git" ]]; then
  git -C "$checkout" fetch --depth 1 origin main
  git -C "$checkout" checkout --detach origin/main
else
  mkdir -p "$(dirname "$checkout")"
  git clone --depth 1 --filter=blob:none https://github.com/CopilotKit/OpenBot.git "$checkout"
fi

git -C "$checkout" rev-parse HEAD
