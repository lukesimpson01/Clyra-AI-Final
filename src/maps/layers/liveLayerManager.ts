import Supercluster from "supercluster";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Bounds, LayerMeta, LiveEntity, LiveLayerId } from "../core/types";

type PointFeature = GeoJSON.Feature<GeoJSON.Point, Record<string, unknown>>;
type LivePayload = { entities: LiveEntity[]; source: string; updatedAt: number; status: "live" | "delayed" };

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const configuration: Record<LiveLayerId, { label: string; source: string; color: string }> = {
  aircraft: { label: "Aircraft", source: "adsb.lol · public ADS-B", color: "#2364f5" },
  earthquakes: { label: "Earthquakes", source: "USGS · GeoJSON", color: "#e9734b" },
  satellites: { label: "Satellites", source: "No configured public catalogue", color: "#8065dd" },
  fires: { label: "Fires", source: "No configured public feed", color: "#d36242" },
  weather: { label: "Weather", source: "No configured public feed", color: "#3378c8" },
  cameras: { label: "Public cameras", source: "No permitted regional feed configured", color: "#59616c" },
};

function point(entity: LiveEntity): PointFeature {
  return { type: "Feature", geometry: { type: "Point", coordinates: entity.coordinates }, properties: { id: entity.id, type: entity.type, heading: entity.heading ?? null, altitude: entity.altitude ?? null, speed: entity.speed ?? null, label: String(entity.properties.callsign ?? entity.properties.title ?? entity.id), freshness: entity.freshness, magnitude: entity.properties.magnitude ?? null } };
}

function isVisible(entity: LiveEntity, bounds: Bounds): boolean {
  const [[west, south], [east, north]] = bounds;
  const [lon, lat] = entity.coordinates;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export class LiveLayerManager {
  private readonly entities = new Map<LiveLayerId, LiveEntity[]>();
  private readonly metadata = new Map<LiveLayerId, LayerMeta>(Object.entries(configuration).map(([id, value]) => [id as LiveLayerId, { id: id as LiveLayerId, label: value.label, source: value.source, status: "idle", detail: "Off" }]));
  private readonly enabled = new Set<LiveLayerId>();
  private readonly controllers = new Map<LiveLayerId, AbortController>();
  private qualityLimit = 550;

  constructor(private readonly map: MapLibreMap) { this.addSources(); }

  setQualityLimit(limit: number): void { this.qualityLimit = limit; this.renderAll(); }
  isEnabled(id: LiveLayerId): boolean { return this.enabled.has(id); }
  snapshot(): LayerMeta[] { return [...this.metadata.values()]; }
  entitiesFor(id: LiveLayerId): LiveEntity[] { return this.entities.get(id) ?? []; }

  async toggle(id: LiveLayerId, bounds: Bounds, zoom: number): Promise<void> {
    if (this.enabled.has(id)) { this.disable(id); return; }
    this.enabled.add(id);
    await this.load(id, bounds, zoom);
  }

  async refreshViewport(bounds: Bounds, zoom: number): Promise<void> {
    await Promise.all([...this.enabled].map((id) => this.load(id, bounds, zoom)));
  }

  dispose(): void { for (const controller of this.controllers.values()) controller.abort(); this.controllers.clear(); }

  private disable(id: LiveLayerId): void {
    this.enabled.delete(id); this.controllers.get(id)?.abort();
    this.metadata.set(id, { ...this.metadata.get(id)!, status: "idle", detail: "Off" });
    this.setData(id, EMPTY);
  }

  private async load(id: LiveLayerId, bounds: Bounds, zoom: number): Promise<void> {
    this.controllers.get(id)?.abort();
    const controller = new AbortController(); this.controllers.set(id, controller);
    const old = this.metadata.get(id)!;
    this.metadata.set(id, { ...old, status: "loading", detail: "Loading viewport…" });
    try {
      const payload = await this.fetch(id, bounds, controller.signal);
      if (!this.enabled.has(id) || controller.signal.aborted) return;
      this.entities.set(id, payload.entities);
      this.metadata.set(id, { ...old, status: payload.status, updatedAt: payload.updatedAt, detail: payload.status === "live" ? "Live" : "Delayed public feed" });
      this.render(id, bounds, zoom);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.metadata.set(id, { ...old, status: "error", detail: error instanceof Error ? error.message : "Layer unavailable" });
      this.setData(id, EMPTY);
    }
  }

  private async fetch(id: LiveLayerId, bounds: Bounds, signal: AbortSignal): Promise<LivePayload> {
    if (id === "earthquakes") {
      const response = await fetch("/api/maps/live/earthquakes", { signal });
      if (!response.ok) throw new Error("Earthquake feed unavailable");
      const feed = await response.json() as { features?: Array<{ id?: string; geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }> };
      const entities: LiveEntity[] = (feed.features ?? []).flatMap((feature) => {
        const lon = Number(feature.geometry?.coordinates?.[0]); const lat = Number(feature.geometry?.coordinates?.[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
        const props = feature.properties ?? {};
        return [{ id: `usgs:${feature.id ?? `${lon},${lat}`}`, type: "earthquake", source: "USGS", coordinates: [lon, lat], timestamp: Number(props.time) || Date.now(), freshness: "live", properties: { title: typeof props.title === "string" ? props.title : "Earthquake", magnitude: Number(props.mag) || 0, depthKm: Number(feature.geometry?.coordinates?.[2]) || null, url: typeof props.url === "string" ? props.url : null } }];
      }).filter((entity) => isVisible(entity, bounds));
      return { entities, source: "USGS", updatedAt: Date.now(), status: "live" };
    }
    if (id === "aircraft") {
      const [[west, south], [east, north]] = bounds;
      const lat = (south + north) / 2; const lon = (west + east) / 2;
      const diagonal = Math.max(Math.abs(east - west), Math.abs(north - south));
      const radius = Math.max(8, Math.min(150, diagonal * 38));
      const response = await fetch(`/api/maps/live/aircraft?lat=${lat}&lon=${lon}&radius=${radius}`, { signal });
      if (!response.ok) throw new Error("Aircraft feed unavailable");
      const feed = await response.json() as { ac?: Array<Record<string, unknown>> };
      const entities: LiveEntity[] = (feed.ac ?? []).flatMap((aircraft) => {
        const longitude = Number(aircraft.lon); const latitude = Number(aircraft.lat);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
        return [{ id: `adsb:${String(aircraft.hex ?? `${longitude},${latitude}`)}`, type: "aircraft", source: "adsb.lol", coordinates: [longitude, latitude], heading: Number.isFinite(Number(aircraft.track)) ? Number(aircraft.track) : undefined, speed: Number.isFinite(Number(aircraft.gs)) ? Number(aircraft.gs) : undefined, altitude: Number.isFinite(Number(aircraft.alt_baro)) ? Number(aircraft.alt_baro) : undefined, timestamp: Date.now(), freshness: "live", properties: { callsign: typeof aircraft.flight === "string" ? aircraft.flight.trim() : "Unknown flight", aircraftType: typeof aircraft.t === "string" ? aircraft.t : null, registration: typeof aircraft.r === "string" ? aircraft.r : null } }];
      }).filter((entity) => isVisible(entity, bounds));
      return { entities, source: "adsb.lol", updatedAt: Date.now(), status: "live" };
    }
    throw new Error(`${configuration[id].label} is not configured. No simulated data is shown.`);
  }

  private renderAll(): void {
    const bounds = this.map.getBounds(); const b: Bounds = [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]];
    for (const id of this.enabled) this.render(id, b, this.map.getZoom());
  }

  private render(id: LiveLayerId, bounds: Bounds, zoom: number): void {
    const features = (this.entities.get(id) ?? []).filter((entity) => isVisible(entity, bounds)).slice(0, this.qualityLimit).map(point);
    const index = new Supercluster<Record<string, unknown>, Record<string, unknown>>({ radius: 56, maxZoom: 16, minPoints: 3 });
    index.load(features);
    const [[west, south], [east, north]] = bounds;
    this.setData(id, { type: "FeatureCollection", features: index.getClusters([west, south, east, north], Math.floor(zoom)) as PointFeature[] });
  }

  private addSources(): void {
    for (const id of Object.keys(configuration) as LiveLayerId[]) {
      const source = `clyra-live-${id}`;
      if (!this.map.getSource(source)) this.map.addSource(source, { type: "geojson", data: EMPTY });
      const layer = `clyra-live-${id}-points`;
      if (!this.map.getLayer(layer)) this.map.addLayer({ id: layer, type: "circle", source, paint: { "circle-radius": ["case", ["has", "point_count"], 15, ["interpolate", ["linear"], ["zoom"], 4, 4, 12, 7]], "circle-color": configuration[id].color, "circle-opacity": 0.9, "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
      const labels = `clyra-live-${id}-labels`;
      if (!this.map.getLayer(labels)) this.map.addLayer({ id: labels, type: "symbol", source, minzoom: 7, layout: { "text-field": ["case", ["has", "point_count"], ["to-string", ["get", "point_count"]], ["get", "label"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true }, paint: { "text-color": "#202126", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
    }
  }

  private setData(id: LiveLayerId, value: GeoJSON.FeatureCollection): void { (this.map.getSource(`clyra-live-${id}`) as GeoJSONSource | undefined)?.setData(value); }
}
