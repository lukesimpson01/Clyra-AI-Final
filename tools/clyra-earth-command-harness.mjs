/**
 * End-to-end Clyra Earth command harness.
 *
 * This intentionally exercises the natural-language bridge, not an LLM mock:
 * every phrase goes through `window.__clyraEarthBridge.execute`, which in turn
 * selects deterministic Earth actions.  The harness is runnable against the
 * same loopback hosts used by Clyra desktop.
 *
 *   npm run test:earth:harness
 */
import { chromium } from 'playwright';

const appUrl = process.env.CLYRA_APP_URL || 'http://127.0.0.1:3000/';
const earthUrl = process.env.CLYRA_EARTH_URL || 'http://127.0.0.1:5176/?welcome=0';
const harnessScope = process.env.CLYRA_EARTH_HARNESS || 'all';
const browser = await chromium.launch({ headless: true });
let hostBrowser = null;
let hostContext = null;
const report = [];

function record(name, ok, detail) {
  report.push({ name, ok, detail });
  process.stdout.write(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

try {
  const earth = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await earth.goto(earthUrl, { waitUntil: 'domcontentloaded' });
  await earth.waitForFunction(() => globalThis.__clyraEarthBridge && globalThis.__godsEyeView?.runAction, { timeout: 30_000 });

  // Exercise the actual Cesium canvas rather than treating command-bar zoom
  // as a substitute for a person's mouse/trackpad. This catches a controller
  // accidentally left disabled by a previous mode.
  const cameraState = () => earth.evaluate(() => {
    const camera = globalThis.__godsEyeView?.viewer?.camera;
    const cartographic = camera?.positionCartographic;
    return cartographic ? {
      height: cartographic.height,
      longitude: cartographic.longitude,
      heading: camera.heading,
    } : null;
  });
  const canvas = earth.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  const beforeGesture = await cameraState();
  if (canvasBox && beforeGesture) {
    await earth.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await earth.mouse.wheel(0, -700);
    await earth.waitForTimeout(750);
    const afterWheel = await cameraState();
    record(
      'physical wheel zoom',
      Boolean(afterWheel && afterWheel.height < beforeGesture.height),
      afterWheel ? `${Math.round(beforeGesture.height)} m → ${Math.round(afterWheel.height)} m` : 'camera unavailable',
    );
    await earth.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await earth.mouse.down();
    await earth.mouse.move(canvasBox.x + canvasBox.width / 2 + 140, canvasBox.y + canvasBox.height / 2 + 18, { steps: 10 });
    await earth.mouse.up();
    await earth.waitForTimeout(350);
    const afterDrag = await cameraState();
    const delta = afterDrag
      ? Math.max(
        Math.abs(afterDrag.longitude - (afterWheel?.longitude ?? beforeGesture.longitude)),
        Math.abs(afterDrag.heading - (afterWheel?.heading ?? beforeGesture.heading)),
      )
      : 0;
    record('physical canvas drag', delta > 0.0001, afterDrag ? `camera changed by ${delta.toFixed(4)} rad` : 'camera unavailable');
  } else {
    record('physical wheel zoom', false, 'canvas unavailable');
    record('physical canvas drag', false, 'canvas unavailable');
  }

  async function command(text, timeoutMs = 15_000) {
    return earth.evaluate(async ({ text, timeoutMs }) => Promise.race([
      globalThis.__clyraEarthBridge.execute(text).catch((error) => ({ error: String(error?.message || error) })),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), timeoutMs)),
    ]), { text, timeoutMs });
  }

  // Manual map controls and direct-action escape hatch.
  for (const [name, phrase, timeoutMs] of [
    ['manual full-globe control', 'zoom to globe'],
    ['manual zoom in', 'zoom in a little'],
    ['manual zoom out', 'zoom out a little'],
    ['AI place command', 'fly to Austin'],
    // A first live-flight refresh can outlast the normal command response on
    // a cold provider connection; this remains the real action, just with a
    // release-sized budget rather than a flaky UI-sized one.
    ['AI phrase: show aircraft', 'show flights', 35_000],
    ['AI phrase: hide aircraft', 'hide flights'],
    ['AI phrase: show ships', 'show ships'],
    ['direct deterministic Earth action', '/earth zoom_to_globe {}'],
  ]) {
    const result = await command(phrase, timeoutMs);
    record(name, !result?.timeout && Boolean(result?.text), result?.text || (result?.timeout ? 'timed out' : 'no result'));
  }

  // Permission is a hard product boundary: a current-location request must
  // never silently make up an origin in a browser that has denied it.
  const currentLocationRoute = await command('take me to Austin', 12_000);
  record(
    'current-location permission guardrail',
    /Current Location|location permission/i.test(currentLocationRoute?.error || currentLocationRoute?.text || ''),
    currentLocationRoute?.error || currentLocationRoute?.text || 'no permission response',
  );
  const noRouteFlight = await command('fly the route', 8_000);
  record(
    'Fly Route requires a route',
    /Create a route/i.test(noRouteFlight?.error || noRouteFlight?.text || ''),
    noRouteFlight?.error || noRouteFlight?.text || 'no guardrail response',
  );

  // A real road-following route, with an explicit origin so headless browser
  // geolocation cannot make this deterministic test depend on device consent.
  const route = await command('directions from Austin to Frost Bank Tower', 20_000);
  record(
    'AI route with custom origin',
    !route?.timeout && /^Route ready:/.test(route?.text || ''),
    route?.text || (route?.timeout ? 'timed out' : 'no route summary'),
  );
  const flight = await command('fly the route', 10_000);
  record(
    'Fly Route after route creation',
    !flight?.timeout && /Cinematic route flight started/i.test(flight?.text || ''),
    flight?.text || (flight?.timeout ? 'timed out' : 'no flight acknowledgement'),
  );
  // Restored Fly Mode is intentionally map-first: a blue current-position dot
  // and forward indicator move along the verified route. A prior experimental
  // Drive presentation must never be silently reintroduced here.
  await earth.waitForTimeout(500);
  const flyPresentation = await earth.evaluate(() => {
    const entities = globalThis.__godsEyeView?.viewer?.entities?.values || [];
    const parts = entities.filter((entity) => String(entity.id || '').startsWith('directions:drive-sedan:'));
    const dot = entities.find((entity) => entity.id === 'directions:simulated-position');
    return { parts: parts.length, visibleParts: parts.filter((entity) => entity.show !== false).length, dotVisible: dot?.show !== false };
  });
  record(
    'Fly Mode keeps dot and forward indicator only',
    flyPresentation.parts === 0 && flyPresentation.visibleParts === 0 && flyPresentation.dotVisible === true,
    `${flyPresentation.parts} sedan parts, ${flyPresentation.visibleParts} visible, indicator ${flyPresentation.dotVisible ? 'visible' : 'hidden'}`,
  );
  const stoppedFlight = await earth.evaluate(() => {
    const layer = globalThis.__godsEyeView?.dataManager?.layers?.get('directions')?.module;
    return layer?.controlFlight?.('stop');
  });
  await earth.waitForTimeout(100);
  const stoppedPresentation = await earth.evaluate(() => {
    const entities = globalThis.__godsEyeView?.viewer?.entities?.values || [];
    const dot = entities.find((entity) => entity.id === 'directions:simulated-position');
    return { dotVisible: dot?.show !== false };
  });
  record(
    'Fly Route Stop releases its camera and indicator',
    stoppedFlight?.ok === true && stoppedPresentation.dotVisible === false,
    `${stoppedFlight?.ok ? 'stopped' : 'not stopped'} · indicator ${stoppedPresentation.dotVisible ? 'visible' : 'hidden'}`,
  );
  const driveWorld = await earth.evaluate(() => {
    const sources = globalThis.__godsEyeView?.viewer?.dataSources?.getByName?.('clyra-drive-world') || [];
    return sources.length;
  });
  record(
    'retired Drive world is absent',
    driveWorld === 0,
    `${driveWorld} Drive-world sources attached`,
  );

  const suggestions = await earth.evaluate(() => globalThis.__clyraEarthBridge.suggest('Austin'));
  record(
    'deterministic place suggestions',
    Array.isArray(suggestions?.places) && suggestions.places.some((place) => place.label === 'Austin'),
    suggestions?.places?.map((place) => place.label).join(', ') || 'no suggestions',
  );

  // Fly Route intentionally owns a render loop. Close this independent direct
  // tab before measuring the host UI so a headless GPU does not make the
  // visible-workspace interaction test compete with an unrelated playback.
  await earth.close();

  if (harnessScope !== 'bridge') {
  // Host UI: manual search suggestions plus the nested Aircraft menu are
  // tested in the actual Clyra frame rather than only by bridge invocation.
  // Run the user-facing host checks in a separate Chromium process. The first
  // phase deliberately leaves a cinematic route in motion; sharing that GPU
  // process made the subsequent React-menu assertion timing-dependent on
  // hardware shader compilation rather than on Clyra's actual UI behaviour.
  hostBrowser = await chromium.launch({ headless: true });
  // The current-location path is intentionally permissioned at Clyra's
  // top-level origin, then passed to the framed Earth renderer. Granting a
  // deterministic browser test position exercises that exact cross-origin
  // bridge without ever inventing a coordinate in product code.
  hostContext = await hostBrowser.newContext({
    geolocation: { latitude: -33.8688, longitude: 151.2093, accuracy: 12 },
    permissions: ['geolocation'],
  });
  const host = await hostContext.newPage();
  await host.setViewportSize({ width: 1280, height: 800 });
  await host.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await host.waitForTimeout(300);
  await host.keyboard.press('Meta+k');
  const launchEarth = host.getByLabel('Open Clyra Earth');
  await launchEarth.waitFor({ timeout: 5_000 });
  await launchEarth.click({ noWaitAfter: true });
  await host.locator('.clyra-earth[data-ready]').waitFor({ timeout: 30_000 });
  // Clyra deliberately keeps an off-screen prewarm Earth iframe. Read the
  // visible workspace frame, not the first loopback frame (which may be the
  // prewarm document and therefore has no active route/camera state).
  const earthFrameElement = await host.locator('.clyra-earth__frame').elementHandle();
  const earthFrame = await earthFrameElement?.contentFrame();
  await host.waitForTimeout(7_000);
  const startupHeight = earthFrame ? await earthFrame.evaluate(() => (
    globalThis.__godsEyeView?.viewer?.camera?.positionCartographic?.height ?? Number.POSITIVE_INFINITY
  )) : Number.POSITIVE_INFINITY;
  record(
    'opening current-location fly-in',
    // The sequence intentionally holds a calm whole-Earth view for three
    // seconds, then takes a 3.6 s interruptible descent. At this checkpoint
    // assert that the camera has genuinely left the 18,000 km globe orbit;
    // the following location-control check verifies the exact endpoint.
    startupHeight < 17_000_000,
    Number.isFinite(startupHeight) ? `${Math.round(startupHeight)} m camera height (descent underway)` : 'Earth runtime unavailable',
  );
  const search = host.getByLabel('Search places or coordinates');
  await search.fill('Austin');
  await host.getByRole('option', { name: /Austin/ }).first().waitFor({ timeout: 5_000 });
  record('manual upper-left search UI', await host.getByRole('option', { name: /Austin/ }).count() >= 1, 'Austin suggestions visible');
  // The upper-left crosshair must request the trusted GPS bridge directly;
  // it must never forward the literal phrase "my location" to geocoding.
  await host.getByLabel('Use current location as search context').click();
  const locationStatus = host.locator('.clyra-earth__puck-status');
  await locationStatus.waitFor({ timeout: 8_000 });
  await host.waitForFunction(() => {
    const status = document.querySelector('.clyra-earth__puck-status');
    return status?.getAttribute('data-tone') === 'success';
  }, { timeout: 10_000 });
  record(
    'search crosshair uses top-level current location bridge',
    /-33\.8688, 151\.2093/.test(await locationStatus.innerText()),
    await locationStatus.innerText(),
  );
  // This is the same route a person takes from the visible command bar: the
  // permissioned top-level location is the A endpoint, and a decimal-degree
  // destination proves commas are preserved rather than stripped as prose.
  const routeCommand = host.locator('.clyra-earth__puck-input');
  await routeCommand.fill('directions to -33.9461, 151.1772');
  await host.getByLabel('Send command').click();
  // Select Clyra's own route sheet directly. The embedded Earth document also
  // contains a directions label, so a generic accessibility-label locator can
  // accidentally observe an empty upstream shell instead of this UI.
  const routePanel = host.locator('.clyra-earth__directions');
  await routePanel.waitFor({ timeout: 25_000 });
  const routePanelText = await routePanel.innerText();
  const routeStatusText = await locationStatus.innerText();
  record(
    'current-location route directions UI',
    /Current Location/i.test(routePanelText) && /Driving|Walking|Cycling/.test(routePanelText),
    `${routePanelText.replace(/\s+/g, ' ').slice(0, 220)} · ${routeStatusText}`,
  );
  if (earthFrame) await earthFrame.waitForFunction(() => (
    globalThis.__godsEyeView?.dataManager?.layers?.get('directions')?.module?.getRouteState?.()?.status === 'ready'
  ), { timeout: 5_000 }).catch(() => {});
  const routeVisual = earthFrame ? await earthFrame.evaluate(() => {
    const viewer = globalThis.__godsEyeView?.viewer;
    const layer = globalThis.__godsEyeView?.dataManager?.layers?.get('directions')?.module;
    const route = layer?.getRoute?.();
    const entity = viewer?.entities?.getById?.('directions:route');
    const uniforms = entity?.polyline?.material?.getValue?.(undefined, {});
    const color = uniforms?.color;
    return {
      status: layer?.getRouteState?.()?.status,
      points: route?.geometry?.length || 0,
      steps: route?.steps?.length || 0,
      blue: Boolean(color && Math.abs(color.red - 37 / 255) < .01 && Math.abs(color.green - 99 / 255) < .01 && Math.abs(color.blue - 235 / 255) < .01),
    };
  }) : null;
  record(
    'blue road-following route geometry',
    Boolean(routeVisual?.status === 'ready' && routeVisual.points >= 2 && routeVisual.steps >= 1 && routeVisual.blue),
    routeVisual ? `${routeVisual.points} road points · ${routeVisual.steps} steps · blue ${routeVisual.blue}` : 'Earth runtime unavailable',
  );
  // Use a fresh visible workspace for the independent Aircraft control test.
  // This mirrors a person returning to Earth from the launcher, while keeping
  // the search result assertion isolated from a transient suggestion sheet.
  await host.close();
  const aircraftHost = await hostContext.newPage();
  await aircraftHost.setViewportSize({ width: 1280, height: 800 });
  await aircraftHost.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await aircraftHost.waitForTimeout(300);
  await aircraftHost.keyboard.press('Meta+k');
  const launchAircraftEarth = aircraftHost.getByLabel('Open Clyra Earth');
  await launchAircraftEarth.waitFor({ timeout: 5_000 });
  await launchAircraftEarth.click({ noWaitAfter: true });
  await aircraftHost.locator('.clyra-earth[data-ready]').waitFor({ timeout: 30_000 });
  const aircraftTools = aircraftHost.getByLabel('Aircraft tools');
  // Each menu row includes a visual chevron, so use its accessible button
  // name rather than an exact text-node match that would omit the chevron.
  const cockpitEntry = aircraftHost.getByRole('button', { name: /Enter Cockpit/ });
  await aircraftTools.click();
  // Assert the menu's semantic content as soon as it is mounted. Its quiet
  // opacity animation may be slowed by an initial Cesium shader compile in
  // headless Chromium; visibility is intentionally verified by the following
  // physical action instead of treating that cosmetic frame as a missing menu.
  await cockpitEntry.waitFor({ state: 'attached', timeout: 15_000 });
  record('nested Aircraft menu', await cockpitEntry.count() === 1, 'Cockpit is inside Aircraft tools');
  if (await cockpitEntry.count() === 1) {
    await aircraftHost.getByRole('button', { name: /Show live aircraft/ }).click();
    await aircraftHost.locator('.clyra-earth__puck-status').waitFor({ timeout: 5_000 });
    record('Aircraft UI action dispatches', await aircraftHost.locator('.clyra-earth__puck-status').isVisible(), 'bridge command acknowledged');
  } else {
    record('Aircraft UI action dispatches', false, 'Aircraft menu did not open');
  }
  }

  const failures = report.filter((item) => !item.ok);
  if (failures.length) {
    process.stderr.write(`\n${failures.length} Earth harness check(s) failed.\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`\n${report.length} Clyra Earth checks passed.\n`);
  }
} finally {
  await hostContext?.close();
  await hostBrowser?.close();
  await browser.close();
}
