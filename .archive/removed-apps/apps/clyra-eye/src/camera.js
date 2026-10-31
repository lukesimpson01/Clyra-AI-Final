import * as Cesium from 'cesium';
import { createCameraMotion } from './scenes/cameraMotion.js';

/**
 * Camera presets for notable locations.
 * Phase 1 default: fly to Austin, TX on load.
 */
export const CAMERA_PRESETS = {
  austin: {
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 800),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0.0,
    },
  },
  sf: {
    destination: Cesium.Cartesian3.fromDegrees(-122.4194, 37.7749, 1000),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
  nyc: {
    destination: Cesium.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200),
    orientation: {
      heading: Cesium.Math.toRadians(-20),
      pitch: Cesium.Math.toRadians(-30),
      roll: 0.0,
    },
  },
};

/**
 * Fly the camera to a preset location with a smooth animation.
 */
export function flyToPreset(viewer, presetName, duration = 3.0) {
  const preset = CAMERA_PRESETS[presetName];
  if (!preset) return;

  viewer.camera.flyTo({
    destination: preset.destination,
    orientation: preset.orientation,
    duration,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Set camera to Austin on load with a cinematic fly-in.
 * @returns {Function} Cancels the pending or active startup flight.
 */
export function flyToAustin(viewer) {
  // Start from a high altitude, then fly down
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 25000),
    orientation: {
      heading: Cesium.Math.toRadians(0),
      pitch: Cesium.Math.toRadians(-90),
      roll: 0.0,
    },
  });

  // Cinematic fly-in after a brief pause
  const timer = setTimeout(() => {
    if (viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 600),
      orientation: {
        heading: Cesium.Math.toRadians(15),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0.0,
      },
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }, 500);
  return () => {
    clearTimeout(timer);
    if (!viewer.isDestroyed()) viewer.camera.cancelFlight();
  };
}

/** Street-level start over the current location, and the full-Earth end altitude. */
export const CURRENT_LOCATION_ALTITUDE_M = 500;
export const CURRENT_LOCATION_HOLD_MS = 1000;
export const EARTH_VIEW_ALTITUDE_M = 18_000_000;
export const EARTH_FLIGHT_MS = 9000;
const IMAGERY_TIMEOUT_MS = 20_000;
const LOCATION_TIMEOUT_MS = 10_000;

/** Confidence from a device fix's reported accuracy. Anything without a device fix is APPROXIMATE. */
export function locationConfidence(accuracyM) {
  if (!Number.isFinite(accuracyM)) return 'APPROXIMATE';
  if (accuracyM <= 50) return 'PRECISE';
  if (accuracyM <= 500) return 'GOOD';
  return 'APPROXIMATE';
}

function fromDevice(position) {
  const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;
  return {
    latitude,
    longitude,
    altitude: Number.isFinite(altitude) ? altitude : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    heading: Number.isFinite(heading) ? heading : null,
    speed: Number.isFinite(speed) ? speed : null,
    timestamp: position.timestamp,
  };
}

/**
 * Clyra Eye launch sequence, in order:
 *   1. Locate: the device's own geolocation (high accuracy, 10 s), else the host's
 *      location (approximate), else nothing (no callout is drawn).
 *   2. Place: load the local imagery, put the camera at street level over the
 *      location, and reveal the CURRENT LOCATION callout (same as the Nepal callout).
 *   3. Hold, then fly out to full Earth with the scene motion engine (the same
 *      sampler and cubic curve the Nepal scenes use). Any user input ends it.
 * Each step settles a readiness gate, so the loader stays until the start is ready.
 * @returns {Function} Cancels the sequence and any active flight.
 */
export function startClyraEyeIntro(
  viewer,
  {
    readiness = null,
    onStatus = () => {},
    onState = () => {},
    onSettled = () => {},
    showCurrentLocation = () => {},
    clearCurrentLocation = () => {},
    geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : null,
    hostLocation = () => (typeof window !== 'undefined' ? window.__clyraEyeLocation ?? null : null),
    fallback = { latitude: 30.2672, longitude: -97.7431 },
    watchMs = 4000,
    holdMs = CURRENT_LOCATION_HOLD_MS,
    flightMs = EARTH_FLIGHT_MS,
    frames = {},
  } = {},
) {
  let cancelled = false;
  let finished = false;
  let phase = 'locating';
  let flightStarted = false;
  let stopWatch = null;
  const timers = [];
  const abort = new AbortController();
  const canvas = viewer.scene?.canvas;
  const settleGate = (gate, ok) => readiness?.settle(gate, ok);
  // Location facts survive later reports, so the loader and tests can read them at any phase.
  const carried = {};
  const report = (patch = {}) => {
    Object.assign(carried, patch);
    onState({
      phase,
      // The camera's true height above the ellipsoid, in metres.
      altitude: Math.round(viewer.camera.positionCartographic?.height ?? 0),
      ...carried,
    });
  };

  const wait = (ms) =>
    new Promise((resolve) => {
      timers.push(setTimeout(resolve, ms));
    });
  const nextFrame = () =>
    new Promise((resolve) => {
      const request = frames.requestFrame ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(cb, 16));
      request(() => resolve());
    });

  // Why the device fix failed, so a missing OS permission is visible, not silent.
  let locationError = null;
  const deviceFix = () =>
    new Promise((resolve) => {
      if (!geolocation?.getCurrentPosition) {
        locationError = 'UNSUPPORTED';
        return resolve(null);
      }
      geolocation.getCurrentPosition(
        (position) => resolve(fromDevice(position)),
        (error) => {
          locationError = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' }[error?.code] ?? 'UNKNOWN';
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
      );
    });

  const hostFix = async () => {
    for (let waited = 0; waited < 3000 && !cancelled; waited += 250) {
      const host = hostLocation();
      if (host && Number.isFinite(host.lat) && Number.isFinite(host.lon)) {
        return { latitude: host.lat, longitude: host.lon, altitude: null, accuracy: null, heading: null, speed: null, timestamp: Date.now(), source: 'host' };
      }
      await wait(250);
    }
    return null;
  };

  // Keep refining the device fix briefly: a better accuracy moves the callout, never the camera.
  const refine = (current) => {
    if (!geolocation?.watchPosition || current.source === 'host') return;
    const id = geolocation.watchPosition(
      (position) => {
        if (cancelled || finished) return;
        const next = fromDevice(position);
        if (next.accuracy != null && (current.accuracy == null || next.accuracy < current.accuracy)) {
          Object.assign(current, next, { confidence: locationConfidence(next.accuracy) });
          showCurrentLocation(current);
          report({ location: { ...current } });
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0 },
    );
    stopWatch = () => geolocation.clearWatch?.(id);
    timers.push(setTimeout(() => stopWatch?.(), watchMs));
  };

  const imageryReady = () => {
    const layer = viewer.imageryLayers?.get?.(0);
    return !layer || layer.imageryProvider?.ready !== false;
  };

  const waitForImagery = async () => {
    const deadline = Date.now() + IMAGERY_TIMEOUT_MS;
    while (!cancelled && Date.now() < deadline && !imageryReady()) await wait(200);
    return imageryReady();
  };

  const applyPose = (pose) => {
    if (viewer.isDestroyed?.()) return false;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(pose.lon, pose.lat, pose.alt),
      orientation: {
        heading: Cesium.Math.toRadians(pose.heading),
        pitch: Cesium.Math.toRadians(pose.pitch),
        roll: Cesium.Math.toRadians(pose.roll),
      },
    });
    return true;
  };

  const motion = createCameraMotion({
    applyPose,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: frames.now,
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    // A sequence that ends early leaves no critical gate pending: it degrades instead.
    for (const gate of ['location', 'cameraPlaced', 'localImagery']) settleGate(gate, false);
    phase = cancelled ? 'cancelled' : 'settled';
    stopWatch?.();
    canvas?.removeEventListener('wheel', interrupt);
    canvas?.removeEventListener('pointerdown', interrupt);
    report();
    onSettled();
  };

  // Hand control to the user immediately: the flight stops and the sequence ends.
  function interrupt() {
    if (finished) return;
    cancelled = true;
    timers.forEach(clearTimeout);
    abort.abort();
    finish();
  }
  canvas?.addEventListener('wheel', interrupt, { passive: true });
  canvas?.addEventListener('pointerdown', interrupt, { passive: true });

  (async () => {
    report();
    onStatus('Locating device');
    const device = await deviceFix();
    // The device error is recorded before any host fallback, so it stays visible.
    report({ locationError: device ? null : locationError });
    let fix = device;
    if (!fix && !cancelled) fix = await hostFix();
    if (cancelled || viewer.isDestroyed?.()) return finish();
    settleGate('location', true);
    if (fix) {
      fix.confidence = fix.source === 'host' ? 'APPROXIMATE' : locationConfidence(fix.accuracy);
      report({ location: fix });
    }

    phase = 'loading';
    onStatus('Loading terrain');
    const imagery = await waitForImagery();
    if (cancelled || viewer.isDestroyed?.()) return finish();
    settleGate('localImagery', imagery);

    const at = fix ?? fallback;
    const lat = at.latitude;
    const lon = at.longitude;
    phase = 'placing';
    onStatus('Preparing scene');
    applyPose({ lat, lon, alt: CURRENT_LOCATION_ALTITUDE_M, heading: 0, pitch: -60, roll: 0 });
    settleGate('cameraPlaced', true);
    if (fix) {
      showCurrentLocation(fix);
      refine(fix);
    } else {
      clearCurrentLocation();
    }
    onStatus('Ready');

    phase = 'holding';
    report({ location: fix ?? null });
    // The placed scene, with its callout, must have drawn a frame before the hold begins.
    await nextFrame();
    if (cancelled || viewer.isDestroyed?.()) return finish();
    await wait(holdMs);
    if (cancelled || viewer.isDestroyed?.()) return finish();

    phase = 'flying';
    flightStarted = true;
    report({ flightStarted });
    const move = {
      from: { lat, lon, alt: CURRENT_LOCATION_ALTITUDE_M, heading: 0, pitch: -60, roll: 0 },
      to: { lat, lon, alt: EARTH_VIEW_ALTITUDE_M, heading: 0, pitch: -90, roll: 0 },
      durationSec: flightMs / 1000,
      easing: 'cubic',
    };
    motion.play(move, { signal: abort.signal }).then(() => finish(), () => finish());
  })();

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
    stopWatch?.();
    abort.abort();
    canvas?.removeEventListener('wheel', interrupt);
    canvas?.removeEventListener('pointerdown', interrupt);
  };
}
