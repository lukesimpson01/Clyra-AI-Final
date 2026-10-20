import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentLocationCallout, currentLocationEntry, currentLocationDetails } from './currentLocation.js';

function fakeOverlay() {
  const calls = { setEntries: [], setVisible: [], clearSource: [] };
  return {
    calls,
    setEntries: (...args) => calls.setEntries.push(args),
    setVisible: (...args) => calls.setVisible.push(args),
    clearSource: (...args) => calls.clearSource.push(args),
  };
}

const fix = { latitude: -33.8568, longitude: 151.2153, accuracy: 12, confidence: 'PRECISE', source: undefined };

test('the callout uses the Nepal incident card shape: card, anchor dot, elbow leader, protected', () => {
  const entry = currentLocationEntry(fix, () => ({ alpha: 1, scale: 1, leaderProgress: 1, contentAlpha: 1 }));
  assert.equal(entry.variant, 'card');
  assert.equal(entry.anchorDot, true);
  assert.equal(entry.leaderStyle, 'elbow');
  assert.equal(entry.protected, true);
  assert.equal(entry.placement, 'right');
  assert.equal(entry.title, 'CURRENT LOCATION');
});

test('a host fallback is titled APPROXIMATE LOCATION, never CURRENT LOCATION', () => {
  const entry = currentLocationEntry({ ...fix, source: 'host', confidence: 'APPROXIMATE' }, () => ({ alpha: 1, scale: 1, leaderProgress: 1, contentAlpha: 1 }));
  assert.equal(entry.title, 'APPROXIMATE LOCATION');
});

test('the card lists the coordinates and the confidence with its accuracy', () => {
  const lines = currentLocationDetails(fix);
  assert.equal(lines[0], '33.8568° S, 151.2153° E');
  assert.equal(lines[1], 'PRECISE · ±12 m');
});

test('show publishes one overlay source; clear removes it', () => {
  const overlay = fakeOverlay();
  let clock = 0;
  const callout = createCurrentLocationCallout({ overlay, now: () => clock, requestRender: () => {}, schedule: () => null, cancel: () => {} });
  callout.show(fix);
  // The reveal republishes each frame, so there may be several publishes; each one is the single card.
  assert.ok(overlay.calls.setEntries.length >= 1);
  for (const [sourceId, entries] of overlay.calls.setEntries) {
    assert.equal(sourceId, 'clyra-current-location');
    assert.equal(entries.length, 1);
  }
  assert.equal(overlay.calls.setVisible.at(-1)[1], true);
  callout.clear();
  assert.equal(overlay.calls.clearSource.length, 1);
  assert.equal(overlay.calls.setVisible.at(-1)[1], false);
  assert.equal(callout.fix, null);
});

test('a refined fix updates the card without restarting its reveal', () => {
  const overlay = fakeOverlay();
  let clock = 0;
  const callout = createCurrentLocationCallout({ overlay, now: () => clock, requestRender: () => {}, schedule: () => null, cancel: () => {} });
  callout.show(fix);
  clock = 500;
  callout.show({ ...fix, accuracy: 4, confidence: 'PRECISE' });
  const entry = overlay.calls.setEntries.at(-1)[1][0];
  assert.match(entry.details[1], /±4 m/);
  // The reveal continued from its first appearance: 500 ms in, the card is partly visible.
  assert.ok(entry.contentAlpha() < 1);
});

test('the reveal keeps requesting frames until the card is fully shown', () => {
  const overlay = fakeOverlay();
  let clock = 0;
  const renders = [];
  const pending = [];
  const callout = createCurrentLocationCallout({
    overlay,
    now: () => clock,
    requestRender: (reason) => renders.push(reason),
    schedule: (cb) => { pending.push(cb); return pending.length; },
    cancel: () => {},
  });
  callout.show(fix);
  while (pending.length) {
    clock += 100;
    const next = pending.shift();
    next();
    if (clock > 5000) break;
  }
  assert.ok(renders.length >= 5, 'frames were requested during the reveal');
  assert.ok(renders.every((r) => r === 'clyra-current-location-reveal'));
});
