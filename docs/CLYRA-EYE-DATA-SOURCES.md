# Clyra Eye — Status, Data Sources and Open Work

Clyra Eye is the original God's Eye View app (MIT, Bilawal Sidhu), vendored at
`apps/clyra-eye/` at the upstream commit recorded in `apps/clyra-eye/UPSTREAM_COMMIT`.
Its UI, layout and behaviour come from that app. Clyra hosts it in the Eye
workspace (`src/components/eye/ClyraEyeWorkspace.tsx`) and adds nothing on top.

## Running it

```bash
npm run eye:install   # once: installs apps/clyra-eye dependencies
npm run eye:dev       # serves the app on http://localhost:5179 for the Clyra host
```

`eye:dev` runs `apps/clyra-eye/scripts/dev-for-clyra.mjs`, which sets
`CLYRA_HOST_FRAME_ANCESTORS` (default: Clyra's dev origins). That opt-in lets
those origins frame the full app. Unset, the upstream rule (`X-Frame-Options: DENY`)
holds, and standalone `npm run dev` in `apps/clyra-eye` keeps it.

## Verified

- Keyless boot: the app starts with an empty environment, shows its first-view
  dialog, the HUD, and Esri imagery. No Google, OpenAI or Ion key is needed.
- Static audit: the Google Fonts CDN is removed (fonts are self-hosted from
  `@fontsource/*` and `material-symbols`), and the CSP no longer allows Google font hosts.
- Server: the local ADS-B receiver route (`/api/local-receivers/aircraft`) and its
  file are removed. It now returns 404.
- Google Places and OpenAI HUD-summary routes return keyless responses when no key
  is set, without contacting Google or OpenAI (checked in `server/providers/`).
- Runtime: in the sampled windows the page made no external requests. The
  browser's resource-timing buffer is capped, so this is a sample, not a full trace.

## Not working yet

- **Framing inside Clyra.** The iframe in Clyra's pane is still blank. Chrome
  reports `frame-ancestors 'none'`, although the server returns the Clyra origin
  policy when queried with curl and with browser-style headers. I did not
  resolve this. It could be a cache or proxy in the pane, or a problem in
  how the host sends headers.
- **Provider removal.** The upstream still contains code for Google (Places,
  geocoding, 3D tiles, Street View), OpenAI (realtime voice, HUD summary),
  TomTom, AISStream, OpenSky, adsbdb, the local ADS-B layer and the RTL-SDR
  controller (`@jtarrio/webrtlsdr`). These are about 150 source files. Several
  paths are key-gated. They are not removed, so the spec's removal rule is not met.
- **Production build.** `/api` routes come from Vite plugins, so the app needs its
  dev or preview server. A packaged Electron build is not wired.
- **Clyra integration beyond the workspace.** Command-palette entries and an Eye
  settings panel are not added. Clyra's own AI tools are not connected.
- **Build and format.** `npm run build` and `npm run format:check` have not been run
  in `apps/clyra-eye`.

## Public data sources (upstream)

The upstream documents its sources in `apps/clyra-eye/DATA_SOURCES.md` and keeps
each source's attribution in-app. Sources that are not allowed in Clyra (by the
spec's rules) are the paid, proprietary and non-commercial ones listed under
"Not working yet". Each must be removed or disabled before a commercial release.
