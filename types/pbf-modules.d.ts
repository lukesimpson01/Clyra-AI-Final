declare module "pbf";
declare module "@mapbox/vector-tile" {
  export class VectorTile {
    constructor(pbf: unknown);
    layers: Record<string, { length: number; feature(i: number): { properties: Record<string, unknown>; toGeoJSON(x: number, y: number, z: number): { geometry: unknown } }; } | undefined>;
  }
}
