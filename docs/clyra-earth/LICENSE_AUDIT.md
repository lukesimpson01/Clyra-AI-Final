# Clyra Earth — commercial licence audit

Clyra Earth is [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)
by Bilawal Sidhu, vendored at `vendor/gods-eye-view/` (upstream commit
`c9f9896`). Its **source code is MIT** and is safe to ship commercially.

**The MIT grant covers code only.** Upstream is explicit about this: bundled
datasets and 3D models keep their own licences, and several live providers
restrict commercial use. This file records what was checked, what was removed,
and what still needs gating before Clyra Earth ships in a paid product.

Sources audited: `vendor/gods-eye-view/LICENSE`, `DATA_SOURCES.md`,
`public/models/README.md`, `src/data/local_data/*/`.

---

## 1. Removed — NonCommercial, cannot ship

| Asset | Licence | Action |
|---|---|---|
| TeleGeography Submarine Cable Map (712 cables + 1,917 landing points) | **CC BY-NC-SA 3.0** | **Deleted.** |

`src/data/local_data/telegeography_submarine_cables/` is absent from the
vendored tree. The upstream licence record remains in `DATA_SOURCES.md`.

The submarine-cables *layer itself is untouched* and still wired into the HUD:
`src/layers/submarineCables/bundledSource.js` now resolves to explicitly empty
FeatureCollections marked unavailable, rather than attempting to fetch or
redistribute the removed payload. A licensed source can be integrated through
that source seam without modifying the tactical HUD.

## 2. Must be gated before commercial launch — **OPEN**

These are live providers, not bundled files, so nothing incompatible is
*redistributed* today. But they are reachable at runtime and must be disabled
or replaced before Clyra Earth ships commercially.

| Provider | Used for | Problem | Recommended action |
|---|---|---|---|
| **OpenSky Network** | Primary worldwide live-flight snapshot | Licence is **non-commercial research/education**; operational REST use in a product can require a prior written agreement with OpenSky | Default the flights layer to the **adsb.lol** path (ODbL, commercial-OK), and require an explicit operator-supplied OpenSky agreement before enabling it |
| **Google News RSS** | Cockpit regional-briefing headlines | Google News ToS restrict use to **personal, noncommercial** | Disable, or switch the briefing to **GDELT** (commercial use permitted with citation), which upstream already uses as the fallback |
| **Google Maps / Places / Street View** | Optional keyed basemap, 3D tiles, place search | Google's own terms, BYOK | Already opt-in and keyless-by-default (Esri imagery + Photon geocoding). Keep it BYOK; never ship a Clyra key |

## 3. Cleared for commercial use — attribution required

| Asset / source | Licence | Obligation |
|---|---|---|
| God's Eye View source code | MIT | Retain copyright + licence notice |
| Bundled 3D models (`airplane`, `jet`, `ship`, `bell206`, `c172`, `citation2`, `mq9`, `b789`, `atr72`) | CC BY 4.0 | Credit creator, link licence, state modifications — all recorded in `public/models/README.md`, which must ship |
| Datacenters (~4.3K), Dams (704) — OSM / OpenInfraMap extracts | ODbL 1.0 | "© OpenStreetMap contributors"; share-alike applies to the *data*, not Clyra's code |
| OpenStreetMap live (Overpass, Nominatim, Photon, OSRM routing, ALPR nodes) | ODbL 1.0 | "© OpenStreetMap contributors" |
| adsb.lol (flights, military, traces) | ODbL 1.0 | "adsb.lol (ODbL)" |
| Natural Earth physical regions | Public domain | Courtesy credit only |
| DataSF Analysis Neighborhoods | PDDL 1.0 | Courtesy credit only |
| NASA FIRMS active fires | CC0 / US public domain | Citation requested |
| USGS earthquakes | US public domain | "Data courtesy of the U.S. Geological Survey" |
| CelesTrak TLEs | US-gov origin, no licence | Citation requested |
| Launch Library 2 (The Space Devs) | Permissive ToS | Courtesy attribution |
| Open-Meteo | CC BY 4.0 | **Required** linked "Weather data by Open-Meteo.com" adjacent to the data |
| Live Traffic NSW, Fintraffic/Digitraffic | CC BY 4.0 | **Required** attribution |
| DriveBC, Ontario 511 | Open Government Licence (BC / Ontario) | **Required** attribution |
| Re:Earth Terrain (Mapterhorn) + EGM2008 | CC BY 4.0 / public domain | Required attribution |
| Radio Browser | Public domain directory | Audio is never proxied, cached or redistributed |
| TomTom Traffic | BYOK, live only | Off without a key; "Traffic flow data © TomTom" when live |

God's Eye View already surfaces every one of these in its **Data attribution**
popover. **That popover must not be removed or hidden** by any Clyra restyle —
it is how several of the licences above are satisfied.

---

## Standing rules for Clyra Earth

1. Never bundle a dataset into `vendor/gods-eye-view/src/data/local_data/`
   without recording its licence here first.
2. Never ship a Clyra-owned API key for a BYOK provider.
3. Keep the Data attribution popover reachable from the HUD.
4. Re-run this audit on every upstream sync — upstream may add datasets.
