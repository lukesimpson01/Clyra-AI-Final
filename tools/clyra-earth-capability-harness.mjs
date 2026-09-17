/**
 * Audits high-expectation natural-language requests against the real Clyra
 * Earth bridge. This deliberately stays independent of the UI harness so its
 * cinematic flight does not make manual-control checks timing-dependent.
 *
 * A request must either use a real deterministic action or return the precise
 * missing source/context. It must never fall through into a generic geocode
 * and fabricate a plausible answer.
 */
import { chromium } from 'playwright';

const earthUrl = process.env.CLYRA_EARTH_URL || 'http://127.0.0.1:5176/?welcome=0';
const browser = await chromium.launch({ headless: true });
const report = [];

function record(name, ok, detail) {
  report.push({ name, ok, detail });
  process.stdout.write(`${ok ? '✓' : '✗'} ${name} — ${detail}\n`);
}

const advancedRequests = [
  ['traffic-aware airport route', 'Find the fastest route from my current location to Sydney Airport, avoid tolls, avoid roads with heavy traffic, and show me where delays are happening.', /live traffic.*toll avoidance/i],
  ['road-trip stop planning', 'Plan a road trip from Sydney to Melbourne with a maximum of 2.5 hours driving between stops. Add highly rated food stops, fuel stations, viewpoints, and overnight accommodation.', /Multi-stop planning/i],
  ['amenity-rich cafe search', 'Show me every café within a 15-minute walk that is open right now, has at least a 4.4 rating, outdoor seating, and parking nearby.', /current POI provider/i],
  ['emergency hospital comparison', 'Take me to the nearest hospital with an emergency department. Compare driving time against the next two closest hospitals using current traffic.', /live traffic/i],
  ['turn-by-turn simulation', 'Show the route from my current location to this destination, then simulate the entire trip turn-by-turn as if I were driving it now.', /turn-by-turn navigation simulation/i],
  ['departure-time planning', 'I need to arrive at work by 8:30 AM tomorrow. Based on typical traffic, when should I leave, and what backup route should I use if the main road becomes congested?', /Departure-time and backup-route/i],
  ['fair meeting midpoint', 'Find a meeting point that gives these three people roughly equal driving times, then suggest cafés near that midpoint with parking.', /three actual origins/i],
  ['historical imagery analysis', 'Show me how this suburb has changed over the last 10 years using historical satellite imagery and explain the biggest changes you can identify.', /Historical imagery/i],
  ['land-use comparison', 'Find large undeveloped pieces of land within 30 km of this location and compare their road access, nearby suburbs, terrain, and surrounding infrastructure.', /Land-parcel and land-use/i],
  ['intercity cinematic flight', 'Fly me from Los Angeles to New York in 3D Earth view. Show major cities, mountain ranges, states, landmarks, and geographic features we pass over.', /Cinematic flight completed: Los Angeles.*New York/i, 30_000],
  ['selected-building details', 'What is this building I clicked on? Tell me what it is, its address, opening hours, entrances, nearby parking, public transport, and businesses inside it.', /Building details/i],
  ['beach comparison', 'Find the best beach within a 90-minute drive that has parking, toilets, restaurants nearby, and a walking trail. Compare at least five options.', /current POI provider/i],
  ['walking-tour optimiser', 'Create a walking tour through central London covering 10 major landmarks while minimizing unnecessary backtracking.', /Multi-stop planning/i],
  ['scenic routing', 'Find the most scenic driving route between these two locations, even if it takes up to 30 minutes longer than the fastest route.', /Scenic-route scoring/i],
  ['fuel along route', 'Show me all petrol stations along my route. My estimated range is 120 km, so recommend the safest place to stop without making a major detour.', /current POI provider/i],
  ['hiking safety terrain', 'Look at the terrain around this hiking location and identify steep sections, elevation changes, river crossings, nearby roads, and potential emergency access points.', /hiking safety assessment/i],
  ['group dinner planning', 'Find restaurants where five friends can meet tonight at 7 PM. They must be within 20 minutes of everyone, highly rated, have vegetarian options, parking, and still be open after 9 PM.', /Group dining plans/i],
  ['neighbourhood comparison', 'Compare this neighbourhood with these two other neighbourhoods for supermarkets, schools, train stations, parks, hospitals, gyms, restaurants, and commute times.', /Neighbourhood comparison/i],
  ['selected-aircraft telemetry', 'I clicked this aircraft on the Earth view. Tell me its flight number, aircraft type, origin, destination, altitude, speed, heading, estimated arrival time, and show its route.', /^Flight /i, 8_000],
  ['nearby discovery route', 'I want to explore somewhere interesting. Based on what is currently visible on the map, find five unusual nearby places I probably would not discover normally, explain why each is interesting, and create a route through all of them.', /Discovery recommendations/i],
];

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(earthUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__clyraEarthBridge && globalThis.__godsEyeView?.runAction, { timeout: 60_000 });
  for (const [name, phrase, expectation, timeoutMs = 8_000] of advancedRequests) {
    // The aircraft request is about a clicked plane. Establish exactly that
    // real tracked context first, then verify that the following question
    // reads it instead of falling back to a generic place action.
    if (name === 'selected-aircraft telemetry') {
      const selected = await page.evaluate(async () => Promise.race([
        globalThis.__clyraEarthBridge.execute('nearest aircraft').catch((error) => ({ error: String(error?.message || error) })),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 12_000)),
      ]));
      const selectedDetail = selected?.error || selected?.text || (selected?.timeout ? 'timed out' : 'no response');
      record('selected-aircraft setup', !selected?.timeout && /^Selected nearest aircraft:/i.test(selectedDetail), selectedDetail);
    }
    const result = await page.evaluate(async ({ phrase, timeoutMs }) => Promise.race([
      globalThis.__clyraEarthBridge.execute(phrase).catch((error) => ({ error: String(error?.message || error) })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs)),
    ]), { phrase, timeoutMs });
    const detail = result?.error || result?.text || (result?.timeout ? 'timed out' : 'no response');
    record(name, !result?.timeout && expectation.test(detail), detail);
  }
  const failed = report.filter((item) => !item.ok);
  if (failed.length) {
    process.stderr.write(`\n${failed.length} advanced capability check(s) failed.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`\n${report.length} advanced request checks passed.\n`);
  }
} finally {
  await browser.close();
}
