# Recon: Apple Maps → Clyra Maps

Scope: macOS Maps app UX and features, plus Google-style AI. Clean room: features and flows only, no code, assets or wording copied.

## Sources
- Maps.app on this machine, `/System/Applications/Maps.app`, inspected with REA 6.5.0:
  - `rea analyze` needs a Ghidra/Hopper/IDA engine; none installed and none installed by us, so the binary was **not** decompiled.
  - `rea decode-interface-builder`: only the launch storyboard is bundled; no screen layout recovered.
  - The bundled string table's **key names** (not the text) were read as a feature checklist.
- Public Apple Maps documentation and general product knowledge.

## Feature areas seen in the string table keys
Map modes (Explore/Driving/Transit/Satellite, 2D/3D), Flyover tours, Look Around, dropped pin (move/remove),
Directions (Drive/Walk/Transit/Cycle), route options (avoid tolls/highways/hills/stairs/busy roads), add stops,
route callouts ("N min faster"), depart/arrive-by time, transit fares/hours and line choices, EV charging routing,
Shared ETA, Library (Favorites, Home/Work, Guides, Recents), parked car, offline maps, ratings/photos,
weather and AQI, incident reporting, ride-sharing, CarPlay, Wallet transit cards.

## Out of scope (cannot or should not be cloned)
Apple's own map data, Flyover imagery, Look Around imagery, ride-sharing partners, Wallet/Apple Pay, CarPlay, Find My,
Siri, incident/UGC backend, hills/stairs/busy-road avoidance (no open routing data for these).

## Public services Clyra uses (all keyless)
OpenFreeMap tiles · Photon search · Overpass POIs · OSRM + FOSSGIS foot/bike routing · Transitous transit ·
Panoramax/KartaView street imagery · Mangrove reviews · Open-Meteo weather/air quality · Esri World Imagery.
