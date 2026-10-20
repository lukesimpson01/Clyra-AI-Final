import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { MapController } from "./MapController";
import { registerTileCache } from "./offline";
import type { Coordinate } from "../../lib/maps/types";

/** OpenFreeMap's "liberty" style — a free, keyless, globally-hosted MapLibre
 * vector style built on OpenStreetMap data. No raster fallback: this keeps
 * the map crisp under zoom/rotate/pitch per Clyra's rendering requirements. */
const PRIMARY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Official MapLibre demo style — used only if OpenFreeMap is unreachable. */
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export interface MapViewHandle {
  getController: () => MapController | null;
  getMap: () => maplibregl.Map | null;
}

interface MapViewProps {
  initialCenter: Coordinate;
  initialZoom?: number;
  onReady?: (controller: MapController, map: maplibregl.Map) => void;
  onClick?: (coordinate: Coordinate, hint?: { name: string; kind?: string }) => void;
  onMoveEnd?: (center: Coordinate, zoom: number) => void;
  /** Fires only for gestures the user made (drag, wheel, pinch), not programmatic camera moves. */
  onUserMove?: () => void;
}

export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView(
  { initialCenter, initialZoom = 13, onReady, onClick, onMoveEnd, onUserMove },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const controllerRef = useRef<MapController | null>(null);
  // The map listener is bound once; reading the latest callback through a ref
  // keeps clicks from running against a stale selection/route closure.
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onUserMoveRef = useRef(onUserMove);
  onUserMoveRef.current = onUserMove;

  useImperativeHandle(ref, () => ({
    getController: () => controllerRef.current,
    getMap: () => mapRef.current,
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    registerTileCache();
    performance.mark("clyra-maps-init");
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: PRIMARY_STYLE_URL,
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: { compact: true },
      // Maps uses vector layers and no custom WebGL post-processing, so MSAA
      // is wasted GPU work here. A bounded tile cache also prevents a long
      // exploratory session from holding an ever-growing texture set.
      antialias: false,
      // Lighter on the GPU: cap device pixel ratio, skip cross-source label
      // collision work, and never fetch CJK glyph ranges from the network.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
      crossSourceCollisions: false,
      localIdeographFontFamily: "sans-serif",
      fadeDuration: 120,
      refreshExpiredTiles: false,
      maxTileCacheSize: 72,
      renderWorldCopies: false,
      pitchWithRotate: true,
      dragRotate: true,
    });
    mapRef.current = map;
    (window as unknown as { __clyraMap?: maplibregl.Map }).__clyraMap = map; // debugging/QA handle

    map.on("error", (e) => {
      // A style load failure (network down, provider offline) falls back to
      // the MapLibre demo style rather than leaving a blank/broken map.
      const message = String((e as { error?: { message?: string } })?.error?.message || "");
      if (/style|tile/i.test(message) && map.getStyle()?.sprite !== undefined) return;
    });

    let fellBack = false;
    map.on("error", () => {
      if (fellBack) return;
      if (!map.isStyleLoaded()) {
        fellBack = true;
        map.setStyle(FALLBACK_STYLE_URL);
      }
    });

    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.once("idle", () => {
      performance.mark("clyra-maps-idle");
      try {
        performance.measure("clyra-maps-first-paint", "clyra-maps-init", "clyra-maps-idle");
      } catch {
        // Marks unavailable: timing is diagnostic only.
      }
    });

    map.on("load", () => {
      performance.mark("clyra-maps-load");
      const controller = new MapController(map);
      controller.ensureLayers();
      controller.applyDetail();
      map.on("pitchend", () => controller.applyDetail());
      controller.ensureConeImage();
      controllerRef.current = controller;
      onReady?.(controller, map);
    });

    map.on("moveend", (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) onUserMoveRef.current?.();
    });

    map.on("click", (e) => {
      // The vector tiles already carry names for POIs and buildings, so the card
      // can show a real name instantly while the identify service fills in the rest.
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]];
      const hit = map.queryRenderedFeatures(box).find((f) => f.properties?.name && /poi|housenumber|aerodrome|place/.test(f.sourceLayer ?? ""));
      const hint = hit ? { name: String(hit.properties.name), kind: String(hit.properties.class ?? hit.properties.subclass ?? "") || undefined } : undefined;
      onClickRef.current?.([e.lngLat.lng, e.lngLat.lat], hint);
    });
    if (onMoveEnd) {
      map.on("moveend", () => {
        const c = map.getCenter();
        onMoveEnd([c.lng, c.lat], map.getZoom());
      });
    }

    return () => {
      controllerRef.current?.dispose();
      map.remove();
      mapRef.current = null;
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
});
