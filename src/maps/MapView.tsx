import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MapController } from "./MapController";
import { registerTileCache } from "./offline";
import type { Coordinate } from "../../lib/maps/types";

/** OpenFreeMap's "liberty" style — a free, keyless, globally-hosted MapLibre
 * vector style built on OpenStreetMap data. No raster fallback: this keeps
 * the map crisp under zoom/rotate/pitch per Clyra's rendering requirements. */
const PRIMARY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Official MapLibre demo style — used only if OpenFreeMap is unreachable. */
const FALLBACK_STYLE_URL = "https://demotiles.maplibre.org/style.json";

/* A picture of the last map you looked at. It is shown the instant Maps opens, while MapLibre sets up WebGL and
   decodes tiles, then cross-fades into the live map — the way Apple Maps reopens. Only used when the map is
   reopening exactly where the picture was taken. */
const SNAPSHOT_KEY = "clyra.mapSnapshot";
interface MapSnapshot { url: string; center: Coordinate; zoom: number; bearing: number; pitch: number; at: number }
function readSnapshot(center: Coordinate): MapSnapshot | null {
  try {
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null") as MapSnapshot | null;
    if (!snap?.url || !Array.isArray(snap.center)) return null;
    if (Math.abs(snap.center[0] - center[0]) > 1e-5 || Math.abs(snap.center[1] - center[1]) > 1e-5) return null;
    if (Date.now() - snap.at > 7 * 86_400_000) return null;
    return snap;
  } catch { return null; }
}

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
  const [snapshot] = useState(() => readSnapshot(initialCenter));
  const [snapshotState, setSnapshotState] = useState<"shown" | "fading" | "gone">(snapshot ? "shown" : "gone");
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
      zoom: snapshot?.zoom ?? initialZoom,
      bearing: snapshot?.bearing ?? 0,
      pitch: snapshot?.pitch ?? 0,
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
      // Resizing is handled below: MapLibre's own observer also fires when the map's node is merely moved (Task
      // View adopts each app's DOM), and every such call rebuilds the WebGL drawing buffer.
      trackResize: false,
    });
    mapRef.current = map;
    {
      const node = containerRef.current;
      let lastW = node.clientWidth;
      let lastH = node.clientHeight;
      const resizeObserver = new ResizeObserver(() => {
        const w = node.clientWidth;
        const h = node.clientHeight;
        if (!w || !h || (w === lastW && h === lastH)) return;
        lastW = w; lastH = h;
        map.resize();
      });
      resizeObserver.observe(node);
      map.once("remove", () => resizeObserver.disconnect());
    }
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
      // The live map is fully drawn: let the picture go.
      setSnapshotState((state) => (state === "shown" ? "fading" : state));
      window.setTimeout(() => setSnapshotState("gone"), 420);
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

    /* Keep the reopening picture current: after the map settles (at most every 10 s), copy the frame that was just
       drawn, at CSS size and modest quality so it stays small. */
    let lastCapture = 0;
    let captureTimer = 0;
    const capture = () => {
      if (map.isMoving() || Date.now() - lastCapture < 10_000) return;
      window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => {
        map.once("render", () => {
          try {
            const source = map.getCanvas();
            const w = source.clientWidth, h = source.clientHeight;
            if (!w || !h) return;
            const scaled = document.createElement("canvas");
            scaled.width = w; scaled.height = h;
            scaled.getContext("2d")?.drawImage(source, 0, 0, w, h);
            const c = map.getCenter();
            localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
              url: scaled.toDataURL("image/jpeg", 0.62), center: [c.lng, c.lat], zoom: map.getZoom(),
              bearing: map.getBearing(), pitch: map.getPitch(), at: Date.now(),
            } satisfies MapSnapshot));
            lastCapture = Date.now();
          } catch { /* storage full or canvas unavailable: the next open simply starts without a picture */ }
        });
        map.triggerRepaint();
      }, 1200);
    };
    map.on("idle", capture);
    map.once("remove", () => window.clearTimeout(captureTimer));

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

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {snapshot && snapshotState !== "gone" ? (
        <img
          src={snapshot.url}
          alt=""
          aria-hidden
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
          style={{ opacity: snapshotState === "shown" ? 1 : 0, transition: "opacity 380ms cubic-bezier(.22,1,.36,1)" }}
        />
      ) : null}
    </>
  );
});
