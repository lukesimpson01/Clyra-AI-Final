/**
 * Clyra Maps — destination preloading.
 *
 * Before a long camera flight, the target area's vector tiles are loaded
 * off-screen so the visible map never lands on a gray, half-loaded region. A
 * temporary, non-interactive MapLibre instance is created, pointed at the
 * destination, warmed to `idle`, then destroyed immediately — it never sticks
 * around as a second renderer. On low-memory devices the primary map's own
 * progressive zoom is used instead (no second renderer at all).
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { createStandardMap } from "../components/maps/mapRenderer";

const LOW_MEMORY_DEVICE_GB = 4;

export function shouldPreloadDestination(): boolean {
  const memory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory);
  return !Number.isFinite(memory) || memory > LOW_MEMORY_DEVICE_GB;
}

export class MapDestinationPreloader {
  private map: MapLibreMap | null = null;
  private container: HTMLDivElement | null = null;
  private token = 0;

  /** Preload the destination tiles, resolving when the offscreen map is idle. */
  async preload(center: [number, number], zoom: number, timeoutMs = 6000): Promise<void> {
    if (!shouldPreloadDestination()) return;
    const token = ++this.token;
    this.dispose();

    const container = document.createElement("div");
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      width: "512px",
      height: "512px",
      pointerEvents: "none",
      opacity: "0",
    });
    document.body.appendChild(container);
    this.container = container;

    const map = createStandardMap({
      container,
      center,
      zoom,
      attributionControl: false,
    });
    this.map = map;

    await new Promise<void>((resolve) => {
      const finish = () => {
        window.clearTimeout(timer);
        map.off("idle", onIdle);
        resolve();
      };
      const onIdle = () => {
        if (token === this.token) finish();
      };
      const timer = window.setTimeout(() => {
        if (token === this.token) finish();
      }, timeoutMs);
      map.on("idle", onIdle);
    });

    // Only tear down if we're still the active preload (a newer one won).
    if (token === this.token) this.dispose();
  }

  dispose(): void {
    this.token += 1;
    try {
      this.map?.remove();
    } catch {
      // Map may already be torn down.
    }
    this.map = null;
    this.container?.remove();
    this.container = null;
  }
}
