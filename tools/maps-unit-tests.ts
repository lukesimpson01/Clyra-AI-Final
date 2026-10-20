/** Unit tests for Clyra Maps logic that needs no browser. Run: npm run test:maps
 * Set MAPS_LIVE=1 to also hit the public services (routing, transit). */
import assert from "node:assert/strict";
import { decodePolyline, planTransit } from "../lib/maps/transit";
import { aqiCategory } from "../lib/maps/airQuality";
import { routingProvider } from "../lib/maps/providers";
import { lonLatToTile, tilesForBounds } from "../src/maps/offline";
import { VoiceGuide } from "../src/navigation/VoiceGuide";
import type { NavigationStep } from "../lib/maps/types";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

await test("polyline decoder: Google reference string (precision 5)", () => {
  const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
  assert.deepEqual(pts.map((p) => [Number(p[1].toFixed(3)), Number(p[0].toFixed(3))]), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

await test("polyline decoder: precision-7 longitudes beyond 32 bits", () => {
  // Encode 151.156, -33.9155 at precision 7 and round-trip it.
  const enc = (n: number) => {
    let x = Math.round(n);
    x = x < 0 ? -x * 2 - 1 : x * 2;
    let out = "";
    while (x >= 32) {
      out += String.fromCharCode((32 | x % 32) + 63);
      x = Math.floor(x / 32);
    }
    return out + String.fromCharCode(x + 63);
  };
  const s = enc(-33.9155 * 1e7) + enc(151.156 * 1e7);
  const [pt] = decodePolyline(s, 7);
  assert.ok(Math.abs(pt[0] - 151.156) < 1e-6 && Math.abs(pt[1] + 33.9155) < 1e-6, JSON.stringify(pt));
});

await test("AQI categories follow the US scale", () => {
  assert.equal(aqiCategory(20), "Good");
  assert.equal(aqiCategory(75), "Moderate");
  assert.equal(aqiCategory(120), "Unhealthy for sensitive groups");
  assert.equal(aqiCategory(350), "Hazardous");
});

await test("tile maths: known tile for Sydney at z10", () => {
  assert.deepEqual(lonLatToTile(151.2093, -33.8688, 10), [942, 614]);
});

await test("tilesForBounds is capped and covers every zoom", () => {
  const small = tilesForBounds([[151.15, -33.9], [151.17, -33.88]]);
  assert.ok(small.length > 7 && small.length <= 700);
  assert.deepEqual([...new Set(small.map((t) => t[0]))], [9, 10, 11, 12, 13, 14, 15]);
  assert.ok(tilesForBounds([[100, -60], [170, 10]]).length <= 700);
});

await test("voice guide announces each band once and never when muted", () => {
  const said: string[] = [];
  const g = new VoiceGuide();
  (globalThis as any).window = { speechSynthesis: { cancel() {}, speak: (u: { text: string }) => said.push(u.text) } };
  (globalThis as any).SpeechSynthesisUtterance = class { constructor(public text: string) {} };
  const step = { instruction: "Turn left onto Pitt Street", geometryStartIndex: 5 } as NavigationStep;
  g.update(step, 900);
  g.update(step, 390);
  g.update(step, 380);
  g.update(step, 140);
  g.update(step, 20);
  assert.equal(said.length, 3, said.join(" | "));
  assert.match(said[0], /^In 400 metres, turn left/);
  assert.equal(said[2], "Turn left onto Pitt Street");
  g.muted = true;
  g.update({ ...step, geometryStartIndex: 9 }, 20);
  assert.equal(said.length, 3);
  delete (globalThis as any).window;
});

if (process.env.MAPS_LIVE) {
  await test("live: walking ETA is realistic (not car speed)", async () => {
    const r = await routingProvider.route({ origin: [151.156, -33.9155], destination: [151.2093, -33.8688], options: { mode: "walk" } });
    assert.ok(r);
    const kmh = (r.distanceMeters / 1000) / (r.durationSeconds / 3600);
    assert.ok(kmh > 3 && kmh < 7, `walking speed ${kmh.toFixed(1)} km/h`);
  });
  await test("live: cycling ETA is realistic", async () => {
    const r = await routingProvider.route({ origin: [151.156, -33.9155], destination: [151.2093, -33.8688], options: { mode: "bike" } });
    assert.ok(r);
    const kmh = (r.distanceMeters / 1000) / (r.durationSeconds / 3600);
    assert.ok(kmh > 9 && kmh < 30, `cycling speed ${kmh.toFixed(1)} km/h`);
  });
  await test("live: multi-stop route is longer than the direct route", async () => {
    const base = { origin: [151.156, -33.9155] as [number, number], destination: [151.2093, -33.8688] as [number, number] };
    const direct = await routingProvider.route({ ...base, options: { mode: "drive" } });
    const via = await routingProvider.route({ ...base, options: { mode: "drive", waypoints: [[151.18, -33.89]] } });
    assert.ok(direct && via && via.distanceMeters >= direct.distanceMeters * 0.99);
  });
  await test("live: transit returns itineraries with vehicle legs inside the trip area", async () => {
    const its = await planTransit([151.156, -33.9155], [151.2093, -33.8688]);
    assert.ok(its.length > 0);
    for (const l of its[0].legs.flatMap((x) => x.geometry)) assert.ok(l[0] > 151 && l[0] < 151.3 && l[1] < -33.8 && l[1] > -34);
  });
}

console.log(`\n${passed} passed`);
