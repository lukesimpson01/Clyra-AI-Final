# Clyra Code source-library extension — 11 November 2026

## Scope

This is a **Vibe Coder source-template catalogue update**, not an integration of donor
applications into Clyra's production code. The existing `TemplateLibrary` and
`/api/clyra-code/library` routes were preserved. `TEMPLATE_LIBRARY` increased
from **68 to 83** curated catalogue entries. No upstream source was
checked into this repository, built, executed, or merged as part of this change.

Every new record starts without a pinned commit, verified runtime, screenshots,
build commands, or claimed working capabilities. Clyra's existing source-import
flow resolves the remote Git revision, performs an isolated checkout, and
inspects source files; it does not run package installation scripts.

## Added to the curated catalogue (15)

| Category | Source | Why it is distinct |
| --- | --- | --- |
| Maps | FacilMap | Full collaborative map application; MapLibre is only the rendering layer |
| Maps Services | Photon | Self-hostable search/geocoding engine; Clyra currently consumes a public Photon endpoint |
| Maps Services | Valhalla | Self-hostable routing engine; alternative to Clyra's public OSRM demo dependency |
| AI Browsers | BrowserOS | Agentic Chromium browser source, offered as reference-only because of its build footprint |
| Graphic Design | Doory | Canva-style general graphics design, not the existing Figma-like canvas |
| Bookmarks | Karakeep | Dedicated searchable saved-content and AI-tagging service |
| Finance | Actual Budget | Financial budgeting application |
| AI App Builders | Bolt DIY | Prompt-to-app builder; unlike editor SDKs or coding-agent integrations |
| Deployment | Coolify | Self-hosted app and server deployment |
| Backend Services | PocketBase | Single-binary backend, unlike spreadsheet-style databases |
| Office Suites | CryptPad | Privacy-focused shared office suite |
| Media Servers | Jellyfin | Self-hosted media streaming server |
| Media Servers | Navidrome | Streaming user's own music, not a Spotify catalogue |
| Translation | LibreTranslate | Self-hosted translation service |
| Git Hosting | Gitea | Full hosted Git service, not merely GitHub integration |

## Deliberately not duplicated (9)

- **AppFlowy**, **AFFiNE**, **MapLibre GL JS** and **Cutawan** are already
  first-class entries in `lib/clyra-code/library/registry.ts`.
- **OpenFreeMap** public vector tiles are already used by Clyra Maps in
  `src/maps/MapController.ts`, `MapView.tsx`, and offline tiles.
- **SupoClip** overlaps the existing OpusClip alternatives (Chopify, Cutawan,
  ClipMint and more); avoid a redundant entry until it offers a validated
  differentiating capability.
- **OpenCut** overlaps existing CapCut-style video editor alternatives.
- **OpenBrowser** overlaps the new BrowserOS reference and the native Clyra
  browser; only one new Comet-style browser reference was added.
- **Memos** overlaps Clyra Notes and the existing Notion-style options.

## Keyless Maps policy and current limitations

- OpenFreeMap tiles allow keyless map display per the provider's usage terms,
  **not** unlimited geocoding, routing, or map-data redistribution.
- MapLibre is a renderer; Photon and Valhalla are services requiring hosting,
  infrastructure and suitable OpenStreetMap datasets.
- `lib/maps/providers.ts` currently consumes public Photon and OSRM endpoints,
  and contains a public Nominatim category-search fallback. That path is
  **not** installed into Clyra Code templates by this change, but must receive
  a policy/usage review before a generic commercial builder relies on it.
- In particular, do **not** use public `nominatim.openstreetmap.org` as generic
  geocoding/autocomplete infrastructure for Clyra's vibe-code template builder.
- Credit OpenStreetMap contributors and comply with each provider's usage policy.

## Licensing, setup and verification

- BrowserOS and FacilMap are AGPL-3.0 references, and Doory uses the
  Attribution Assurance License; review their precise terms before
  modifying or distributing them with Clyra.
- Bolt DIY's core may be MIT while external services (including WebContainer,
  provider accounts, or hosted inference) can have separate terms.
- All upstream repositories and their licences require a fresh review **at
  the pinned revision** before commercial incorporation. Catalogue labels are
  not permission to relicense commercial software.
- BrowserOS has a substantial Chromium build footprint. Jellyfin, Coolify,
  CryptPad and map services all need their own runtimes/configuration.
- No new record has status `runnable-now`; a source import is **not** a
  promise of a working application or fully compatible Clyra integration.

## Regression checks

The existing `tools/clyra-code-library-unit-tests.ts` now checks the
expanded set, unique source URLs, map engine modes and a browser reference-only
status. Run `npm run test:clyra-code-library` and `npm run lint` in the
normal project development environment. These checks were authored from
source and have not been represented as run in a live Clyra environment.
