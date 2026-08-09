# Platform support — Clyra + OpenCluely

Clyra and OpenCluely target **macOS**, **Windows**, and **Linux**.

## Quick start (all platforms)

```bash
npm install
# Put keys in .env.local (never commit):
#   GEMINI_API_KEY=...
#   ASYNC_API_KEY=...
#   ASYNC_STT_ENABLED=true
#   DEEPSEEK_API_KEY=...

npm run opencluely:clone   # node scripts/clone-opencluely.mjs
npm run opencluely:start   # node scripts/start-opencluely-electron.mjs
npm run desktop:dev        # Clyra Electron
npm run dev:source         # Clyra web/API server
```

Node launchers work on macOS, Windows (PowerShell/cmd), and Linux. Bash `.sh` scripts remain as optional Unix helpers (`opencluely:clone:sh` / `opencluely:start:sh`).

## macOS

| Feature | Requirement |
|---------|-------------|
| Screen vision | **Screen Recording** for OpenCluely / Clyra |
| Mic / Async STT | **Microphone** permission |
| Take Control | **Accessibility** + optional `pip install pyobjc-framework-Quartz` or Homebrew `cliclick` |
| Packaging | `build/entitlements.mac.plist` (Hardened Runtime) |

Privacy strings are set for Microphone, Camera, Screen Recording, and Apple Events.

## Windows

| Feature | Requirement |
|---------|-------------|
| Screen vision | Works via PowerShell GDI+ / Electron `desktopCapturer` |
| Mic / Async STT | Renderer Web Audio capture (no sox) |
| Take Control | Built-in PowerShell mouse_event + SendKeys |
| Image resize | Optional ImageMagick **`magick`** (never bare `convert.exe`) |
| Python OCR fallback | `py -3` or `python` on PATH |

## Linux

| Feature | Requirement |
|---------|-------------|
| Take Control | `xdotool` |
| Visual scan backdrop | `scrot` or ImageMagick `import` (optional) |
| Mic (fallback) | `arecord` or `sox` if not using renderer capture |

## Shared cloud APIs

- **Gemini** — image analysis (`GEMINI_API_KEY`)
- **Async.com** — TTS/STT (`ASYNC_API_KEY`)
- Offline Ollama/gemma3 vision is removed

## Build

```bash
npm run desktop:build          # Clyra → mac dmg/zip, win nsis, linux AppImage/deb
cd apps/opencluely && npm run build:mac   # after clone
cd apps/opencluely && npm run build:win
```
