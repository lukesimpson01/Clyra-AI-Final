#!/usr/bin/env bash
# Thin Unix wrapper — prefer: npm run opencluely:start (Node, cross-platform)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "${ROOT}/scripts/start-opencluely-electron.mjs" "$@"
