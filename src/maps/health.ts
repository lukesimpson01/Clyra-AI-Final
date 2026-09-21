/**
 * Clyra Maps — map health monitor.
 *
 * A canvas existing does not mean the map rendered. This tracks the MapLibre
 * lifecycle (style load → tile load → idle) and publishes a machine-checkable
 * debug snapshot on `window.__CLYRA_MAP_DEBUG__` so Playwright and the UI can
 * decide whether real cartography is on screen.
 *
 * `queryRenderedFeatures()` forces a synchronous GPU readback, so it is never
 * called from hot paths — it is only sampled once the map reaches `idle`, and
 * the rendered-feature count is kept monotonic so a transient software-WebGL
 * readback stall can never flap the map back to "empty".
 */
import type { Map as MapLibreMap } from "maplibre-gl";

export type MapHealthState =
  | "INITIALIZING"
  | "STYLE_LOADING"
  | "TILES_LOADING"
  | "READY"
  | "DEGRADED"
  | "FAILED";

export interface MapDebugInfo {
  state: MapHealthState;
  styleLoaded: boolean;
  tilesLoaded: boolean;
  renderedFeatureCount: number;
  center: [number, number];
  zoom: number;
  lastError: string | null;
  sources: string[];
}

declare global {
  interface Window {
    __CLYRA_MAP_DEBUG__?: MapDebugInfo;
  }
}

export class MapHealthMonitor {
  private state: MapHealthState = "INITIALIZING";
  private lastError: string | null = null;
  private styleLoadedFlag = false;
  private idleOnce = false;
  private cachedCount = 0;
  private cachedTilesLoaded = false;
  private disposed = false;

  constructor(
    private readonly map: MapLibreMap,
    private readonly onState?: (state: MapHealthState) => void,
  ) {
    this.publish();
    map.on("style.load", this.onStyleLoad);
    map.on("load", this.onLoad);
    map.on("idle", this.onIdle);
    map.on("error", this.onError);
  }

  private onStyleLoad = () => {
    this.styleLoadedFlag = true;
    this.setState("TILES_LOADING");
  };

  private onLoad = () => {
    this.styleLoadedFlag = true;
    this.setState("TILES_LOADING");
    this.publish();
  };

  private onIdle = () => {
    this.idleOnce = true;
    this.refresh();
  };

  private onError = (event: { error?: { message?: string } }) => {
    this.lastError = event?.error?.message ?? "MapLibre error";
    this.refresh();
  };

  private setState(next: MapHealthState) {
    if (this.state === next) return;
    this.state = next;
    this.onState?.(next);
    this.publish();
  }

  private refresh() {
    if (!this.styleLoadedFlag) return;
    this.cachedTilesLoaded = this.cachedTilesLoaded || this.safeAreTilesLoaded();
    if (this.lastError) {
      this.setState(this.cachedTilesLoaded ? "DEGRADED" : "FAILED");
    } else if (this.cachedTilesLoaded && this.idleOnce) {
      // Only sample rendered features once the map has settled, and never let
      // the count regress.
      this.cachedCount = Math.max(this.cachedCount, this.safeQueryRenderedFeatureCount());
      this.setState("READY");
    } else {
      this.setState("TILES_LOADING");
    }
    this.publish();
  }

  private safeAreTilesLoaded(): boolean {
    try {
      return typeof this.map.areTilesLoaded === "function" ? this.map.areTilesLoaded() : true;
    } catch {
      return false;
    }
  }

  private safeQueryRenderedFeatureCount(): number {
    try {
      return this.map.queryRenderedFeatures().length;
    } catch {
      return 0;
    }
  }

  private sources(): string[] {
    try {
      const style = this.map.getStyle();
      return style?.sources ? Object.keys(style.sources) : [];
    } catch {
      return [];
    }
  }

  info(): MapDebugInfo {
    const center = this.map.getCenter();
    return {
      state: this.state,
      styleLoaded: this.styleLoadedFlag,
      tilesLoaded: this.cachedTilesLoaded,
      renderedFeatureCount: this.cachedCount,
      center: [center.lng, center.lat],
      zoom: this.map.getZoom(),
      lastError: this.lastError,
      sources: this.sources(),
    };
  }

  private publish() {
    if (this.disposed || typeof window === "undefined") return;
    window.__CLYRA_MAP_DEBUG__ = this.info();
  }

  /** Cheap refresh of the published snapshot (center/zoom only). */
  update() {
    this.publish();
  }

  dispose() {
    this.disposed = true;
    this.map.off("style.load", this.onStyleLoad);
    this.map.off("load", this.onLoad);
    this.map.off("idle", this.onIdle);
    this.map.off("error", this.onError);
    if (typeof window !== "undefined") delete window.__CLYRA_MAP_DEBUG__;
  }
}
