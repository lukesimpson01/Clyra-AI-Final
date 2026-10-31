import * as Cesium from 'cesium';
import { overlayHost } from './layers/overlayHost.js';
import { anchoredCalloutPresentation } from '../data/bhoteKoshiLocator.js';
import { governorRequestRender } from '../renderGovernor.js';

// The CURRENT LOCATION callout is the same callout the Nepal incident scene uses:
// a card with an anchor dot and an elbow leader, revealed with the same timing
// (anchoredCalloutPresentation), published through the same world overlay.
export const CURRENT_LOCATION_SOURCE_ID = 'clyra-current-location';
const ACCENT = '#3977f6';

function formatCoordinate(value, positive, negative) {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

/** Card lines for a fix: its coordinates and how well the position is known. */
export function currentLocationDetails(fix) {
  const lines = [
    `${formatCoordinate(fix.latitude, 'N', 'S')}, ${formatCoordinate(fix.longitude, 'E', 'W')}`,
  ];
  const accuracy = Number.isFinite(fix.accuracy) ? ` · ±${Math.round(fix.accuracy)} m` : '';
  lines.push(`${fix.confidence ?? 'APPROXIMATE'}${accuracy}`);
  return lines;
}

/**
 * The overlay entry for one fix. Only a device fix is called CURRENT LOCATION;
 * a host fallback is APPROXIMATE LOCATION.
 */
export function currentLocationEntry(fix, presentation) {
  return {
    id: 'current-location-callout',
    position: Cesium.Cartesian3.fromDegrees(fix.longitude, fix.latitude, 0),
    variant: 'card',
    paintLane: 'ambient-card',
    title: fix.source === 'host' ? 'APPROXIMATE LOCATION' : 'CURRENT LOCATION',
    details: currentLocationDetails(fix),
    accent: ACCENT,
    sourceAlpha: () => presentation().alpha,
    presentationScale: () => presentation().scale,
    leaderProgress: () => presentation().leaderProgress,
    contentAlpha: () => presentation().contentAlpha,
    anchorDot: true,
    leaderStyle: 'elbow',
    priority: 1_000_000,
    protected: true,
    active: true,
    collisionGroup: 'ambient-card',
    zIndex: 60,
    minDistance: 0,
    maxDistance: 5_000_000,
    distanceFadeStartRatio: 0.9,
    distanceScale: { near: 1200, nearValue: 1, far: 4_000_000, farValue: 0.78 },
    edgeFade: 'none',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 36,
    leaderOffsetPx: 4,
    placement: 'right',
  };
}

/**
 * Owns the CURRENT LOCATION callout. `show` keeps the reveal running from its first
 * appearance, so a refined fix moves the card without restarting its animation.
 */
export function createCurrentLocationCallout({
  overlay = overlayHost,
  now = () => performance.now(),
  requestRender = governorRequestRender,
  schedule = (callback) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16)),
  cancel = (handle) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(handle) : clearTimeout(handle)),
} = {}) {
  let fix = null;
  let visibleAt = null;
  let frame = null;
  const presentation = () => anchoredCalloutPresentation(now() - (visibleAt ?? now()));

  const publish = () => {
    overlay.setEntries(CURRENT_LOCATION_SOURCE_ID, [currentLocationEntry(fix, presentation)], {
      cohortLimit: 1,
      collisionCapacity: 1,
      moving: false,
    });
    overlay.setVisible(CURRENT_LOCATION_SOURCE_ID, true);
  };

  // Each reveal frame republishes the entry: the overlay re-reads the reveal's alpha
  // only when it solves a publish. The last frame publishes the fully shown card.
  const animate = () => {
    frame = null;
    if (visibleAt === null) return;
    publish();
    requestRender('clyra-current-location-reveal');
    if (presentation().contentAlpha < 1) frame = schedule(animate);
  };

  return {
    show(next) {
      fix = next;
      if (visibleAt === null) visibleAt = now();
      publish();
      if (frame === null) animate();
    },
    clear() {
      fix = null;
      visibleAt = null;
      if (frame !== null) cancel(frame);
      frame = null;
      overlay.clearSource(CURRENT_LOCATION_SOURCE_ID);
      overlay.setVisible(CURRENT_LOCATION_SOURCE_ID, false);
    },
    get fix() {
      return fix;
    },
  };
}
