#!/usr/bin/env bash
# Start OpenCluely Electron with Clyra API + Gemini vision + Async speech.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${ROOT}/apps/opencluely"
export CLYRA_API_BASE="${CLYRA_API_BASE:-http://127.0.0.1:31415}"
export CLYRA_CONTROL_PORT="${CLYRA_CONTROL_PORT:-3847}"
export OPENCLUELY_VISION_PROVIDER="${OPENCLUELY_VISION_PROVIDER:-gemini}"
export OPENCLUELY_VISION_MODEL="${OPENCLUELY_VISION_MODEL:-gemini-2.0-flash}"
export GEMINI_VISION_MODEL="${GEMINI_VISION_MODEL:-gemini-2.0-flash}"
export SPEECH_PROVIDER="${SPEECH_PROVIDER:-async}"
export ELECTRON_DISABLE_SECURITY_WARNINGS=1

# Load Clyra local secrets into the Electron process when present (gitignored).
if [[ -f "${ROOT}/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env.local"
  set +a
fi

# Ensure Clyra API is up
if ! curl -sf "${CLYRA_API_BASE}/" >/dev/null; then
  echo "WARN: Clyra API not reachable at ${CLYRA_API_BASE}"
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "WARN: GEMINI_API_KEY is empty — image analysis will fail until it is set in apps/opencluely/.env or .env.local"
fi

cd "${APP}"
ELECTRON_BIN="${APP}/node_modules/.bin/electron"
if [[ ! -x "${ELECTRON_BIN}" ]]; then
  echo "electron binary missing — run: bash scripts/clone-opencluely.sh"
  exit 1
fi

# Unique macOS TCC identity so Privacy → Microphone lists "OpenCluely".
if [[ "$(uname -s)" == "Darwin" ]]; then
  node "${ROOT}/tools/patch-electron-macos-privacy.mjs" opencluely >/dev/null || true
fi

# Headless-friendly Electron flags
# On macOS keep GPU enabled so the overlay feels native; Linux headless keeps the safer flags.
EXTRA_FLAGS=()
if [[ "$(uname -s)" != "Darwin" ]]; then
  EXTRA_FLAGS+=(--no-sandbox --disable-gpu --disable-dev-shm-usage)
fi

exec env -u ELECTRON_RUN_AS_NODE \
  "${ELECTRON_BIN}" . "${EXTRA_FLAGS[@]}" "$@"
