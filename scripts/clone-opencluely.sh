#!/usr/bin/env bash
# Thin Unix wrapper — prefer: npm run opencluely:clone (Node, cross-platform)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "${ROOT}/scripts/clone-opencluely.mjs" "$@"
