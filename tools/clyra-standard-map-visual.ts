/**
 * Clyra Standard Map — visual/regression harness.
 *
 * Renders the MapLibre Explore style (styles/clyra-explore-light.ts) against a
 * live Shortbread vector source, then verifies the cartography structurally
 * and captures a screenshot matrix (zoom + location + pitch). Run with:
 *
 *   npm run test:map:visual
 *
 * The standalone render isolates the map from the desktop shell's auth and
 * WebContentsView so the style and tile pipeline can be regression-tested
 * headlessly. It does not ship in the production bundle.
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { clyraExploreLightStyle } from "../src/maps/styles/clyra-explore-light";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "..", "node_modules", "maplibre-gl", "dist");
const OUT = join(HERE, "..", "qa-artifacts", "map");

const styleJson = JSON.stringify(clyraExploreLightStyle);

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/maplibre/maplibre-gl.css">
<style>html,body,#map{margin:0;padding:0;width:100vw;height:100vh;}</style>
</head><body><div id="map"></div>
<script type="module">
import * as maplibregl from "/maplibre/maplibre-gl.mjs";
const style = await (await fetch('/style.json')).json();
const map = new maplibregl.Map({ container: 'map', style, center: [151.2093, -33.8688], zoom: 12, canvasContextAttributes: { antialias: true } });
window.__map = map;
window.__probe = (sourceLayer, filter) => map.querySourceFeatures('clyra-vector', { sourceLayer, filter, validate: false });
</script></body></html>`;

function startServer(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/") { res.setHeader("content-type", "text/html"); res.end(PAGE); return; }
    if (url.pathname === "/style.json") { res.setHeader("content-type", "application/json"); res.end(styleJson); return; }
    if (url.pathname.startsWith("/maplibre/")) {
      const file = join(DIST, url.pathname.slice("/maplibre/".length));
      try { res.setHeader("content-type", extname(file) === ".css" ? "text/css" : "text/javascript"); res.end(readFileSync(file)); }
      catch { res.statusCode = 404; res.end(); }
      return;
    }
    res.statusCode = 404; res.end();
  });
  return new Promise((resolve) => server.listen(8899, () => resolve(server)));
}

interface Check { name: string; ok: boolean; detail: string }

async function main() {
  const fs = await import("node:fs");
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("fonts")) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto("http://127.0.0.1:8899/", { waitUntil: "load" });
  await page.waitForFunction(() => (window as unknown as { __map?: { isStyleLoaded: () => boolean } }).__map?.isStyleLoaded(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const probe = (layer: string, filter?: unknown[]) =>
    page.evaluate(([l, f]) => (window as unknown as { __probe: (l: string, f?: unknown[]) => unknown[] }).__probe(l, f), [layer, filter ?? null]);

  const checks: Check[] = [];
  const count = async (layer: string, filter: unknown[]) => (await probe(layer, filter)).length;
  const expectGt = async (name: string, layer: string, filter: unknown[], min: number) => {
    const n = await count(layer, filter);
    checks.push({ name, ok: n >= min, detail: `${n} features (>= ${min})` });
  };

  await expectGt("motorways render", "transportation", ["==", ["get", "class"], "motorway"], 10);
  await expectGt("primary roads render", "transportation", ["==", ["get", "class"], "primary"], 10);
  await expectGt("minor roads render", "transportation", ["==", ["get", "class"], "minor"], 10);
  await expectGt("water polygons render", "water", ["==", "$type", "Polygon"], 1);
  await expectGt("cities render", "place", ["==", ["get", "class"], "city"], 1);
  await expectGt("suburbs render", "place", ["in", ["get", "class"], ["literal", ["suburb", "quarter", "neighbourhood"]]], 10);

  // Screenshot matrix.
  const shots: Array<[string, [number, number], number, number]> = [
    ["sydney-z8", [151.0, -33.85], 8, 0],
    ["sydney-z10", [151.0, -33.85], 10, 0],
    ["sydney-cbd-z12", [151.2093, -33.8688], 12, 0],
    ["sydney-harbour-z13", [151.2220, -33.8523], 13, 0],
    ["sydney-cbd-z14", [151.2093, -33.8688], 14, 0],
    ["sydney-cbd-z16", [151.2093, -33.8688], 16, 0],
    ["sydney-cbd-z16-pitch45", [151.2093, -33.8688], 16, 45],
    ["hornsby-z14", [151.1022, -33.6631], 14, 0],
    ["newyork-z11", [-74.0060, 40.7128], 11, 0],
  ];
  for (const [name, center, zoom, pitch] of shots) {
    await page.evaluate(([c, z, p]) => (window as unknown as { __map: { jumpTo: (o: unknown) => void } }).__map.jumpTo({ center: c, zoom: z, pitch: p, bearing: 0 }), [center, zoom, pitch]);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  }

  // Buildings must have 3D heights at close zoom.
  await page.evaluate(() => (window as unknown as { __map: { jumpTo: (o: unknown) => void } }).__map.jumpTo({ center: [151.2093, -33.8688], zoom: 16, pitch: 45, bearing: 0 }));
  await page.waitForTimeout(3000);
  const buildingStat = await page.evaluate(() => {
    const feats = (window as unknown as { __probe: (l: string) => { properties?: Record<string, unknown> }[] }).__probe("building");
    const withHeight = feats.filter((f) => Number(f.properties?.render_height) > 0).length;
    return { count: feats.length, withHeight };
  });
  checks.push({ name: "3D buildings have heights", ok: buildingStat.withHeight > 10, detail: `${buildingStat.withHeight}/${buildingStat.count} with height` });

  await browser.close();
  server.close();

  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name} — ${c.detail}`);
    if (!c.ok) failed += 1;
  }
  if (errors.length) {
    console.log(`\n${errors.length} non-font resource errors:`);
    for (const e of errors.slice(0, 10)) console.log("  ", e.slice(0, 180));
  }
  console.log(`\nScreenshots → ${OUT}`);
  console.log(failed === 0 ? "\nMAP VISUAL: PASS" : `\nMAP VISUAL: FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
