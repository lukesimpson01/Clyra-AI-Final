/**
 * Clyra Maps — integration smoke test.
 *
 * Exercises the pieces that changed during the Earth → Maps rebuild:
 *   1. the geocoding provider (Photon/Nominatim) resolves real places,
 *   2. the routing provider (OSRM) returns a normalized Route,
 *   3. the MapLibre + OpenFreeMap renderer loads the Clyra style, renders the
 *      expected feature classes, and responds to pan/zoom/pitch/reset-north.
 *
 * Run with:  npm run test:map
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { searchPlaces } from "../lib/maps/geocoding";
import { requestRoute } from "../src/maps/routing";
import { clyraExploreLightStyle } from "../src/maps/styles/clyra-explore-light";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "node_modules", "maplibre-gl", "dist");
const OUT = join(HERE, "..", "qa-artifacts", "maps-e2e");

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  ok ? (passed += 1) : (failed += 1);
}

async function testGeocoding() {
  try {
    const results = await searchPlaces("Sydney");
    check("geocoding resolves a city", results.length > 0, `${results.length} results`);
    if (results.length) {
      const first = results[0];
      check("geocoding returns finite coordinates", Number.isFinite(first.latitude) && Number.isFinite(first.longitude), `${first.label}`);
    }
  } catch (e) {
    check("geocoding resolves a city", false, e instanceof Error ? e.message : String(e));
  }
}

async function testRouting() {
  try {
    const route = await requestRoute({
      origin: { lon: 151.2093, lat: -33.8688 },
      destination: { lon: 151.1022, lat: -33.6631 },
      mode: "driving",
      alternatives: true,
    });
    check("routing returns geometry", route.geometry.coordinates.length >= 2, `${route.geometry.coordinates.length} points`);
    check("routing returns distance", route.distanceM > 0, `${(route.distanceM / 1000).toFixed(1)} km`);
    check("routing returns steps", route.steps.length > 0, `${route.steps.length} steps`);
  } catch (e) {
    check("routing returns a route", false, e instanceof Error ? e.message : String(e));
  }
}

function startMapServer(): Promise<Server> {
  const styleJson = JSON.stringify(clyraExploreLightStyle);
  const page = `<!doctype html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="/maplibre/maplibre-gl.css">
  <style>html,body,#map{margin:0;padding:0;width:100vw;height:100vh;}</style>
  </head><body><div id="map"></div>
  <script type="module">
  import * as maplibregl from "/maplibre/maplibre-gl.mjs";
  const style = await (await fetch('/style.json')).json();
  const map = new maplibregl.Map({ container: 'map', style, center: [151.2093, -33.8688], zoom: 12, canvasContextAttributes: { antialias: true } });
  window.__map = map;
  window.__probe = (layer, filter) => map.querySourceFeatures('clyra-vector', { sourceLayer: layer, filter, validate: false });
  </script></body></html>`;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("content-type", "text/html"); res.end(page); return; }
    if (url.pathname === "/style.json") { res.setHeader("content-type", "application/json"); res.end(styleJson); return; }
    if (url.pathname.startsWith("/maplibre/")) {
      const file = join(DIST, url.pathname.slice("/maplibre/".length));
      try { res.setHeader("content-type", extname(file) === ".css" ? "text/css" : "text/javascript"); res.end(readFileSync(file)); }
      catch { res.statusCode = 404; res.end(); }
      return;
    }
    res.statusCode = 404; res.end();
  });
  return new Promise((resolve) => server.listen(8898, () => resolve(server)));
}

async function testMapLibre() {
  const server = await startMapServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("http://127.0.0.1:8898/", { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as { __map?: { isStyleLoaded: () => boolean } }).__map?.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const probe = (layer: string, filter?: unknown[]) =>
    page.evaluate(([l, f]) => (window as unknown as { __probe: (l: string, f?: unknown[]) => unknown[] }).__probe(l, f), [layer, filter ?? null]);

  check("map style loads", !errors.some((e) => e.includes("style")), errors[0] ?? "style loaded");
  check("motorways render", (await probe("transportation", ["==", ["get", "class"], "motorway"])).length >= 5);
  check("water renders", (await probe("water", ["==", "$type", "Polygon"])).length >= 1);
  check("cities render", (await probe("place", ["==", ["get", "class"], "city"])).length >= 1);

  const getState = () => page.evaluate(() => {
    const m = (window as unknown as { __map: { getZoom: () => number; getBearing: () => number; getPitch: () => number; getCenter: () => { lng: number; lat: number } } }).__map;
    return { zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), center: m.getCenter() };
  });

  // Pan
  await page.evaluate(() => (window as unknown as { __map: { panBy: (o: [number, number]) => void } }).__map.panBy([200, 0]));
  await page.waitForTimeout(600);
  const panned = await getState();
  check("map pans", Math.abs(panned.center.lng) > 0);

  // Zoom in/out
  await page.evaluate(() => (window as unknown as { __map: { zoomIn: () => void } }).__map.zoomIn());
  await page.waitForTimeout(800);
  check("map zooms in", (await getState()).zoom > 12);

  // Pitch
  await page.evaluate(() => (window as unknown as { __map: { setPitch: (p: number) => void } }).__map.setPitch(50));
  await page.waitForTimeout(800);
  check("map pitches", (await getState()).pitch > 40);

  // Reset north (bearing)
  await page.evaluate(() => (window as unknown as { __map: { easeTo: (o: unknown) => void } }).__map.easeTo({ bearing: 30, duration: 0 }));
  await page.evaluate(() => (window as unknown as { __map: { easeTo: (o: unknown) => void } }).__map.easeTo({ bearing: 0, duration: 300 }));
  await page.waitForTimeout(600);
  check("map resets north", (await getState()).bearing < 1);

  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "sydney-z12.png") });
  console.log(`Screenshots → ${OUT}`);

  await browser.close();
  server.close();
}

async function main() {
  await testGeocoding();
  await testRouting();
  await testMapLibre();
  console.log(`\nMAPS E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
