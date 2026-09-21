/**
 * Clyra Maps — tile provider abstraction.
 *
 * Clyra is not hard-wired to one tile backend even though it ships with
 * OpenFreeMap as the default. The provider carries the vector-tile endpoint,
 * the glyph endpoint used for label rendering, and the attribution string the
 * UI must always surface. The local Clyra style (styles/clyra-explore-light.ts)
 * controls colour and layout; the provider only decides *where* the remote
 * vector data comes from.
 */

export interface MapTileProvider {
  id: string;
  label: string;
  /** Optional hosted style URL (OpenFreeMap's reference style), never the final UI. */
  styleUrl: string | null;
  /** Vector tile source URL / TileJSON endpoint. */
  vectorSourceUrl: string;
  /** SDF/PBF glyph endpoint used by symbol layers. */
  glyphsUrl: string;
  /** Required attribution, kept visible in the map corner. */
  attribution: string;
}

export const OpenFreeMapProvider: MapTileProvider = {
  id: "openfreemap",
  label: "OpenFreeMap",
  styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  vectorSourceUrl: "https://tiles.openfreemap.org/planet",
  glyphsUrl: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  attribution: "© OpenMapTiles © OpenStreetMap contributors",
};

/** The single provider used at runtime. Future providers register here only. */
export function resolveTileProvider(): MapTileProvider {
  return OpenFreeMapProvider;
}
