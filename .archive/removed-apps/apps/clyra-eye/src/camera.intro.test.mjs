import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { startClyraEyeIntro, locationConfidence, EARTH_VIEW_ALTITUDE_M, CURRENT_LOCATION_ALTITUDE_M } from './camera.js';
import { createStartupReadiness } from './app/startupReadiness.js';

function fakeViewer() {
  const listeners = new Map();
  const calls = { setView: [] };
  return {
    calls,
    scene: {
      canvas: {
        addEventListener: (type, fn) => listeners.set(type, fn),
        removeEventListener: (type) => listeners.delete(type),
        fire: (type) => listeners.get(type)?.({}),
      },
    },
    camera: {
      setView: (o) => calls.setView.push(o),
      positionCartographic: { height: 0 },
      cancelFlight: () => {},
    },
    imageryLayers: { get: () => ({ imageryProvider: { ready: true } }) },
    isDestroyed: () => false,
  };
}

// Frames run on timers so the motion engine works under node.
const frames = {
  requestFrame: (callback) => setTimeout(callback, 5),
  cancelFrame: (handle) => clearTimeout(handle),
};
const altitude = (cartesian) => Math.round(Cesium.Ellipsoid.WGS84.cartesianToCartographic(cartesian).height);
const device = (overrides = {}) => ({
  getCurrentPosition: (ok) => ok({ coords: { latitude: -33.8568, longitude: 151.2153, accuracy: 12, altitude: 40, heading: null, speed: null }, timestamp: 1 }),
  watchPosition: () => 1,
  clearWatch: () => {},
  ...overrides,
});
const denied = { getCurrentPosition: (_ok, err) => err({ code: 1 }) };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fast = { holdMs: 30, flightMs: 120, frames };

test('confidence follows device accuracy; no device fix is APPROXIMATE', () => {
  assert.equal(locationConfidence(10), 'PRECISE');
  assert.equal(locationConfidence(200), 'GOOD');
  assert.equal(locationConfidence(2000), 'APPROXIMATE');
  assert.equal(locationConfidence(null), 'APPROXIMATE');
});

test('device fix: placed at street level, the callout shows, then the scene motion engine flies to full Earth', async () => {
  const viewer = fakeViewer();
  const readiness = createStartupReadiness({ timeoutMs: 60_000 });
  const shown = [];
  const states = [];
  let settled = 0;
  startClyraEyeIntro(viewer, {
    ...fast,
    readiness,
    geolocation: device(),
    showCurrentLocation: (fix) => shown.push(fix),
    onState: (s) => states.push(s.phase),
    onSettled: () => { settled += 1; },
  });
  await wait(10);
  assert.equal(viewer.calls.setView.length, 1, 'placed before the flight');
  assert.equal(altitude(viewer.calls.setView[0].destination), CURRENT_LOCATION_ALTITUDE_M);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].confidence, 'PRECISE');
  await wait(200);
  const last = viewer.calls.setView.at(-1);
  assert.equal(altitude(last.destination), EARTH_VIEW_ALTITUDE_M, 'the flight ends at full Earth');
  assert.ok(viewer.calls.setView.length > 2, 'the camera moved through many poses, not one jump');
  assert.equal(settled, 1);
  assert.ok(states.includes('holding') && states.includes('flying') && states.at(-1) === 'settled');
  const snapshot = await readiness.ready;
  assert.equal(snapshot.timedOut, false);
});

test('the flight passes through intermediate altitudes in order (no snap)', async () => {
  const viewer = fakeViewer();
  startClyraEyeIntro(viewer, { ...fast, geolocation: device() });
  await wait(250);
  const heights = viewer.calls.setView.map((pose) => altitude(pose.destination));
  const flight = heights.slice(1);
  assert.ok(flight.length >= 3);
  for (let i = 1; i < flight.length; i++) assert.ok(flight[i] >= flight[i - 1], 'altitude rises monotonically');
});

test('location denied and no host fix: the view still starts, with no callout', async () => {
  const viewer = fakeViewer();
  const shown = [];
  const cleared = [];
  startClyraEyeIntro(viewer, {
    ...fast,
    geolocation: denied,
    hostLocation: () => null,
    fallback: { latitude: 30.2672, longitude: -97.7431 },
    showCurrentLocation: (fix) => shown.push(fix),
    clearCurrentLocation: () => cleared.push(true),
  });
  await wait(3500);
  assert.equal(shown.length, 0);
  assert.equal(cleared.length, 1);
  assert.equal(viewer.calls.setView.length > 0, true, 'still placed at the fallback');
});

test('location denied but the host has a fix: the callout is APPROXIMATE', async () => {
  const shown = [];
  const viewer = fakeViewer();
  startClyraEyeIntro(viewer, {
    ...fast,
    geolocation: denied,
    hostLocation: () => ({ lat: 51.5, lon: -0.12 }),
    showCurrentLocation: (fix) => shown.push(fix),
  });
  await wait(3600);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].source, 'host');
  assert.equal(shown[0].confidence, 'APPROXIMATE');
});

test('user input during the hold hands control over: the flight never starts', async () => {
  const viewer = fakeViewer();
  let settled = 0;
  startClyraEyeIntro(viewer, {
    ...fast,
    holdMs: 400,
    geolocation: device(),
    onSettled: () => { settled += 1; },
  });
  await wait(40);
  viewer.scene.canvas.fire('wheel');
  await wait(500);
  assert.equal(viewer.calls.setView.length, 1, 'only the placement pose, no flight');
  assert.equal(settled, 1);
});

test('user input during the flight stops it at once', async () => {
  const viewer = fakeViewer();
  let settled = 0;
  startClyraEyeIntro(viewer, {
    ...fast,
    flightMs: 2000,
    geolocation: device(),
    onSettled: () => { settled += 1; },
  });
  await wait(90);
  const before = viewer.calls.setView.length;
  viewer.scene.canvas.fire('pointerdown');
  await wait(100);
  assert.equal(viewer.calls.setView.length, before, 'no pose is applied after the hand-over');
  assert.equal(settled, 1);
});

test('cancelling the returned handle stops the sequence before any flight', async () => {
  const viewer = fakeViewer();
  const cancel = startClyraEyeIntro(viewer, { ...fast, holdMs: 200, geolocation: device() });
  cancel();
  await wait(300);
  assert.equal(viewer.calls.setView.length <= 1, true);
});
