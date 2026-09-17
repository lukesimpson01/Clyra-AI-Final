import * as Cesium from 'cesium';
import { CITY_POIS } from './locations.js';
import { getActiveCameraMotion } from './cameraVerbs.js';

const MARK = '__clyraEarthBridge';
const PARENT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'file://',
]);
const LOCATION_TIMEOUT_MS = 10_000;
const ROUTE_TIMEOUT_MS = 18_000;
let currentLocation = null;
let idleSpinStarted = false;
let stopIdleSpin = null;
let suggestionController = null;
let parentLocationPending = null;
let startupFlightRequested = false;
let startupCancelledByManualInput = false;
let selectedPlacePin = null;
let selectedPlacePinImage = null;
let currentLocationIndicator = null;
let currentLocationHeadingCone = null;
let currentLocationPulse = 0;
let currentLocationPulseTimer = null;
let currentLocationRenderedHeading = Number.NaN;
let currentLocationTargetHeading = Number.NaN;
let clyraWorkspacePreparation = null;
let clyraLayerSubscription = null;
let routeProgressTimer = null;
// A Clyra Earth session begins as an uncluttered map.  The upstream viewer
// can restore a standalone share's layer state asynchronously after its own
// application-ready signal, so one initial OFF call is not enough to keep an
// old flight feed from reappearing when a person flies toward an airport.
// Record only deliberate Clyra requests here; every other live layer remains
// available through the visible controls but stays off until requested.
const clyraOptInLayers = new Set();

// Small, explicit city-centre anchors for the cinematic "from A to B" form.
// These are fixed geographic records, not model output: they let the camera
// begin an intercity sequence immediately when a remote geocoder is cold. All
// other place resolution continues through the configured geocoder below.
const INTERCITY_CITY_ANCHORS = Object.freeze({
  'los angeles': Object.freeze({ lat: 34.0522, lon: -118.2437, label: 'Los Angeles' }),
  'new york': Object.freeze({ lat: 40.7128, lon: -74.0060, label: 'New York' }),
  tokyo: Object.freeze({ lat: 35.6762, lon: 139.6503, label: 'Tokyo' }),
  london: Object.freeze({ lat: 51.5072, lon: -0.1276, label: 'London' }),
  sydney: Object.freeze({ lat: -33.8688, lon: 151.2093, label: 'Sydney' }),
  melbourne: Object.freeze({ lat: -37.8136, lon: 144.9631, label: 'Melbourne' }),
});

/**
 * Rotate the camera position around the Earth's centre while continually
 * looking back at that centre. Unlike a look-left/right verb, this keeps the
 * whole globe locked in the middle of the frame rather than panning away from
 * it. It is intentionally inexpensive: one small matrix rotation per render.
 */
function startCenteredEarthSpin(viewer, onManualInput = null) {
  stopIdleSpin?.();
  const canvas = viewer?.scene?.canvas;
  if (!viewer || !canvas) return;
  const axis = Cesium.Cartesian3.UNIT_Z;
  const scratchPosition = new Cesium.Cartesian3();
  const scratchDirection = new Cesium.Cartesian3();
  const scratchRight = new Cesium.Cartesian3();
  const scratchUp = new Cesium.Cartesian3();
  const scratchMatrix = new Cesium.Matrix3();
  let previous = performance.now();
  let timer = null;
  let stopped = false;
  const tick = () => {
    if (viewer.isDestroyed?.()) {
      stopIdleSpin?.();
      return;
    }
    const now = performance.now();
    const seconds = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    // About 0.8°/s: a living globe, not a distracting turntable.
    Cesium.Matrix3.fromRotationZ(seconds * Cesium.Math.toRadians(0.8), scratchMatrix);
    Cesium.Matrix3.multiplyByVector(scratchMatrix, viewer.camera.positionWC, scratchPosition);
    Cesium.Cartesian3.negate(scratchPosition, scratchDirection);
    Cesium.Cartesian3.normalize(scratchDirection, scratchDirection);
    Cesium.Cartesian3.cross(scratchDirection, axis, scratchRight);
    if (Cesium.Cartesian3.magnitudeSquared(scratchRight) < 1e-8)
      Cesium.Cartesian3.cross(scratchDirection, Cesium.Cartesian3.UNIT_Y, scratchRight);
    Cesium.Cartesian3.normalize(scratchRight, scratchRight);
    Cesium.Cartesian3.cross(scratchRight, scratchDirection, scratchUp);
    Cesium.Cartesian3.normalize(scratchUp, scratchUp);
    viewer.camera.setView({
      destination: scratchPosition,
      orientation: { direction: scratchDirection, up: scratchUp },
    });
    // Keep Cesium in request-render mode between gentle 30 fps idle updates.
    // This is visibly smooth at globe scale without burning a full 60 fps GPU
    // loop while the operator is simply looking at the Earth.
    viewer.scene.requestRender?.();
  };
  const schedule = () => {
    if (stopped || document.visibilityState === 'hidden' || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      tick();
      schedule();
    }, 1000 / 30);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      return;
    }
    // Avoid a catch-up leap when a backgrounded Earth tab becomes visible.
    previous = performance.now();
    schedule();
  };
  tick();
  schedule();
  const stop = () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    canvas.removeEventListener('pointerdown', stopForManual);
    canvas.removeEventListener('wheel', stopForManual);
    stopIdleSpin = null;
  };
  const stopForManual = () => {
    onManualInput?.();
    stop();
  };
  canvas.addEventListener('pointerdown', stopForManual, { passive: true, once: true });
  canvas.addEventListener('wheel', stopForManual, { passive: true, once: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  stopIdleSpin = stop;
}

function parentAllowed(origin) {
  if (PARENT_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
      && /^\d+$/.test(url.port);
  } catch {
    return false;
  }
}

function isClyraWorkspaceDocument() {
  return window.parent !== window
    && new URLSearchParams(window.location.search).get('clyra') === '1';
}

/**
 * Clyra launches are a fresh spatial workspace, not a continuation of the
 * upstream standalone application's share hash.  A previous follow/route
 * could otherwise restore into a new launch and cover the map with hundreds
 * of flight labels before the person has chosen a layer.  Keep the real
 * layers available, but begin with an untracked, clean road map every time.
 */
async function prepareClyraWorkspace() {
  if (!isClyraWorkspaceDocument()) return;
  const debug = window.__godsEyeView;
  const manager = debug?.dataManager;
  if (!debug?.viewer || !manager) return;
  await suppressNonOptInClyraLayers(manager);
  clyraLayerSubscription?.();
  clyraLayerSubscription = manager.subscribe?.((event) => {
    if (
      event?.type !== 'visibility'
      || !event.enabled
      || event.layerId === 'directions'
      || clyraOptInLayers.has(event.layerId)
    ) return;
    // The upstream share-restorer can settle later than its normal ready
    // lifecycle. Keep that state from turning an ordinary place search into a
    // wall of live-flight labels; this is intentionally a no-op for a person
    // who chose a layer through Clyra's aircraft/layers controls.
    void manager.setEnabled(event.layerId, false, { origin: 'clyra-clean-map' });
  }) || null;
  debug.viewer.trackedEntity = undefined;
  restoreFreeGlobeInput(debug.viewer);
  // Strip a stale standalone/share fragment only in this explicitly embedded
  // Clyra entry point. Direct God’s Eye share links preserve their behaviour.
  if (window.location.hash) {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }
  const result = await debug.runAction?.('zoom_to_globe', {
    duration: 0.65,
    waitForArrival: true,
  });
  if (result?.ok === false) throw new Error(compactResult(result));
}

async function suppressNonOptInClyraLayers(manager) {
  const enabled = manager?.getAll?.().filter((layer) => (
    layer?.enabled && layer.id !== 'directions' && !clyraOptInLayers.has(layer.id)
  )) || [];
  await Promise.allSettled(
    enabled.map((layer) => manager.setEnabled(layer.id, false, { origin: 'clyra-clean-map' })),
  );
}

async function setClyraLayerEnabled(debug, layerId, enabled) {
  if (enabled) clyraOptInLayers.add(layerId);
  else clyraOptInLayers.delete(layerId);
  const changed = await debug.dataManager?.setEnabled?.(layerId, enabled, { origin: 'clyra-command' });
  return {
    ok: changed !== false,
    action: 'set_layer_visibility',
    layerId,
    enabled,
    label: layerId === 'flights' ? 'Live Flights' : layerId,
  };
}

function reply(kind, payload = {}) {
  if (window.parent === window) return;
  window.parent.postMessage({ [MARK]: true, kind, ...payload }, '*');
}

/**
 * The route camera already owns the authoritative travelled distance. Mirror
 * that state to Clyra's directions card at a calm cadence, mapping the camera
 * geometry back onto OSRM's road distance so "in 400 m, turn right" remains a
 * real road instruction instead of a camera-only estimate.
 */
function stopRouteProgressBridge() {
  if (routeProgressTimer !== null) window.clearInterval(routeProgressTimer);
  routeProgressTimer = null;
}

function routeStepProgress(steps, traveledM, totalM) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  if (!safeSteps.length) return { index: 0, distanceToManeuverM: Math.max(0, totalM - traveledM), instruction: 'Continue on route' };
  let boundaryM = 0;
  for (let index = 0; index < safeSteps.length; index += 1) {
    boundaryM += Math.max(0, Number(safeSteps[index]?.distanceM) || 0);
    if (traveledM < boundaryM || index === safeSteps.length - 1) {
      return {
        index,
        distanceToManeuverM: Math.max(0, boundaryM - traveledM),
        instruction: safeSteps[index]?.instruction || 'Continue on route',
      };
    }
  }
  return { index: safeSteps.length - 1, distanceToManeuverM: 0, instruction: safeSteps.at(-1)?.instruction || 'Arrive at your destination' };
}

function startRouteProgressBridge(layer) {
  stopRouteProgressBridge();
  const route = layer?.getRoute?.();
  if (!route || !(Number(route.distanceM) > 0)) return;
  let observedMotion = false;
  const emit = () => {
    const motion = getActiveCameraMotion();
    if (motion?.kind === 'route' && Number(motion.totalM) > 0) {
      observedMotion = true;
      const fraction = Math.max(0, Math.min(1, Number(motion.traveledM) / Number(motion.totalM)));
      const traveledM = Math.min(Number(route.distanceM), Number(route.distanceM) * fraction);
      const step = routeStepProgress(route.steps, traveledM, Number(route.distanceM));
      reply('route-progress', {
        progress: {
          state: 'flying',
          traveledM: Math.round(traveledM),
          totalM: Math.round(Number(route.distanceM)),
          remainingM: Math.round(Math.max(0, Number(route.distanceM) - traveledM)),
          distanceToManeuverM: Math.round(step.distanceToManeuverM),
          stepIndex: step.index,
          instruction: step.instruction,
        },
      });
      return;
    }
    if (!observedMotion) return;
    const finalStep = routeStepProgress(route.steps, Number(route.distanceM), Number(route.distanceM));
    reply('route-progress', {
      progress: {
        state: 'arrived', traveledM: Math.round(Number(route.distanceM)), totalM: Math.round(Number(route.distanceM)),
        remainingM: 0, distanceToManeuverM: 0, stepIndex: finalStep.index, instruction: 'Arrive at your destination',
      },
    });
    stopRouteProgressBridge();
  };
  emit();
  routeProgressTimer = window.setInterval(emit, 250);
}

function compactResult(result) {
  if (!result || typeof result !== 'object') return String(result || 'Completed');
  if (result.ok === false) return result.error || 'The requested action could not be completed.';
  if (result.label) return `${result.label}`;
  if (result.action === 'set_layer_visibility')
    return `${result.label || result.layerId} ${result.enabled ? 'enabled' : 'disabled'}`;
  return 'Completed';
}

/**
 * Keep exactly one selected-place pin in the Cesium entity collection. The
 * marker is terrain-anchored, so unlike a DOM card it remains correctly
 * positioned while a person drags, tilts, or zooms the Earth. Reusing the
 * entity avoids scene growth across searches.
 */
function showSelectedPlacePin(viewer, result, fallbackLabel = null) {
  const latitude = Number(result?.latitude);
  const longitude = Number(result?.longitude);
  if (!viewer || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const entities = viewer.entities;
  if (!entities) return;
  if (!selectedPlacePin || !entities.contains?.(selectedPlacePin)) {
    selectedPlacePinImage ??= new Cesium.PinBuilder().fromColor(
      Cesium.Color.fromCssColorString('#2563eb'),
      46,
    );
    selectedPlacePin = entities.add({
      id: 'clyra-selected-place',
      name: 'Selected place',
      billboard: {
        image: selectedPlacePinImage,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: 2_000,
        scaleByDistance: new Cesium.NearFarScalar(1_000, 1, 250_000, 0.64),
      },
      label: {
        font: '600 14px system-ui, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#18212d'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -52),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 250_000),
      },
    });
  }
  selectedPlacePin.position = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0);
  selectedPlacePin.name = String(result?.label || fallbackLabel || 'Selected place');
  selectedPlacePin.label.text = selectedPlacePin.name;
  viewer.scene.requestRender?.();
}

function locationAccuracyRadiusM(location) {
  if (location?.source !== 'device') return 0;
  const accuracy = Number(location?.accuracyM);
  // A browser's accuracy is a radius, not a guarantee of a pin-perfect
  // position. Show it faithfully but cap it so an imprecise desktop fix does
  // not obscure an entire suburb.
  return Number.isFinite(accuracy) ? Math.max(12, Math.min(accuracy, 160)) : 0;
}

function pointAtBearing(latitude, longitude, bearingDeg, distanceM) {
  const angularDistance = distanceM / 6378137;
  const bearing = Cesium.Math.toRadians(bearingDeg);
  const lat = Cesium.Math.toRadians(latitude);
  const lon = Cesium.Math.toRadians(longitude);
  const targetLat = Math.asin(
    Math.sin(lat) * Math.cos(angularDistance)
      + Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const targetLon = lon + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
    Math.cos(angularDistance) - Math.sin(lat) * Math.sin(targetLat),
  );
  return Cesium.Cartesian3.fromDegrees(
    Cesium.Math.toDegrees(targetLon),
    Cesium.Math.toDegrees(targetLat),
    0,
  );
}

function normalizeHeadingDeg(value) {
  return ((value % 360) + 360) % 360;
}

/** Blend via the short arc so 359° → 1° is a tiny, calm turn—not a spin. */
function approachHeadingDeg(current, target, amount) {
  if (!Number.isFinite(current)) return normalizeHeadingDeg(target);
  const delta = ((target - current + 540) % 360) - 180;
  return normalizeHeadingDeg(current + delta * Math.max(0, Math.min(1, amount)));
}

function currentLocationConeHierarchy(location, heading) {
  const latitude = Number(location?.lat);
  const longitude = Number(location?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(heading)) return null;
  const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0);
  const coneDistance = Math.max(48, Math.min(120, locationAccuracyRadiusM(location) * 1.5));
  const left = pointAtBearing(latitude, longitude, heading - 26, coneDistance);
  const ahead = pointAtBearing(latitude, longitude, heading, coneDistance * 1.18);
  const right = pointAtBearing(latitude, longitude, heading + 26, coneDistance);
  return new Cesium.PolygonHierarchy([position, left, ahead, right]);
}

/**
 * Render one reusable location puck directly in Cesium.  It is intentionally
 * separate from a searched-place pin: a saved place is not disguised as a
 * precise device fix, and an accuracy halo/direction cone only appear when
 * the browser has actually supplied those measurements.
 */
function showCurrentLocationIndicator(viewer, location = currentLocation) {
  const latitude = Number(location?.lat);
  const longitude = Number(location?.lon);
  if (!viewer || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  const entities = viewer.entities;
  if (!entities) return;
  const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, 0);
  if (!currentLocationIndicator || !entities.contains?.(currentLocationIndicator)) {
    currentLocationIndicator = entities.add({
      id: 'clyra-current-location',
      name: 'Current location',
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString('#2563eb'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 3,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(600, 1, 300_000, 0.72),
      },
      ellipse: {
        semiMajorAxis: new Cesium.CallbackProperty(() => {
          const radius = locationAccuracyRadiusM(currentLocation);
          return radius ? radius + currentLocationPulse * 26 : 1;
        }, false),
        semiMinorAxis: new Cesium.CallbackProperty(() => {
          const radius = locationAccuracyRadiusM(currentLocation);
          return radius ? radius + currentLocationPulse * 26 : 1;
        }, false),
        material: Cesium.Color.fromCssColorString('#2563eb').withAlpha(0.11),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#2563eb').withAlpha(0.32),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        show: new Cesium.CallbackProperty(
          () => locationAccuracyRadiusM(currentLocation) > 0,
          false,
        ),
      },
    });
  }
  currentLocationIndicator.position = position;
  currentLocationIndicator.name = location.source === 'device'
    ? 'Current location'
    : `Current location — ${location.label || 'saved place'}`;

  const heading = Number(location?.heading);
  if (Number.isFinite(heading) && location.source === 'device') {
    currentLocationTargetHeading = normalizeHeadingDeg(heading);
    if (!Number.isFinite(currentLocationRenderedHeading)) currentLocationRenderedHeading = currentLocationTargetHeading;
    const hierarchy = currentLocationConeHierarchy(location, currentLocationRenderedHeading);
    if (!currentLocationHeadingCone || !entities.contains?.(currentLocationHeadingCone)) {
      currentLocationHeadingCone = entities.add({
        id: 'clyra-current-location-heading',
        polygon: {
          hierarchy,
          material: Cesium.Color.fromCssColorString('#2563eb').withAlpha(0.16),
          outline: false,
          perPositionHeight: false,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    } else {
      currentLocationHeadingCone.polygon.hierarchy = hierarchy;
      currentLocationHeadingCone.show = true;
    }
  } else if (currentLocationHeadingCone) {
    currentLocationHeadingCone.show = false;
    currentLocationRenderedHeading = Number.NaN;
    currentLocationTargetHeading = Number.NaN;
  }

  // A short pulse communicates a new device fix without keeping the globe in
  // a permanent render loop.  The request-render governor returns to idle at
  // the end of the one-and-a-half-second acknowledgement.
  if (location.source === 'device') {
    if (currentLocationPulseTimer) window.clearInterval(currentLocationPulseTimer);
    let frame = 0;
    currentLocationPulse = 1;
    currentLocationPulseTimer = window.setInterval(() => {
      frame += 1;
      currentLocationPulse = Math.max(0, 1 - frame / 18);
      if (currentLocationHeadingCone?.show && Number.isFinite(currentLocationTargetHeading)) {
        // The pulse is also the tiny render window used to ease live-device
        // heading updates. It keeps a new compass sample from snapping the fan
        // while returning the otherwise idle globe to request-render mode.
        currentLocationRenderedHeading = approachHeadingDeg(
          currentLocationRenderedHeading,
          currentLocationTargetHeading,
          1 - Math.exp(-8 * .08),
        );
        const hierarchy = currentLocationConeHierarchy(currentLocation, currentLocationRenderedHeading);
        if (hierarchy) currentLocationHeadingCone.polygon.hierarchy = hierarchy;
      }
      viewer.scene.requestRender?.();
      if (frame >= 18) {
        window.clearInterval(currentLocationPulseTimer);
        currentLocationPulseTimer = null;
        currentLocationPulse = 0;
      }
    }, 80);
  }
  viewer.scene.requestRender?.();
}

function rememberCurrentLocation(location, viewer = window.__godsEyeView?.viewer) {
  currentLocation = location;
  showCurrentLocationIndicator(viewer, location);
  return location;
}

/** Restore native globe controls on a direct canvas gesture unless a real
 * follow/cockpit mode owns the camera. This makes a cancelled transition or a
 * stale mode unable to leave ordinary explore mode feeling unresponsive. */
function restoreFreeGlobeInput(viewer) {
  const controls = viewer?.scene?.screenSpaceCameraController;
  const cockpit = window.__godsEyeView?.styleManager?.getCockpitState?.();
  if (!controls || viewer?.trackedEntity || cockpit?.active) return;
  controls.enableInputs = true;
  controls.enableRotate = true;
  controls.enableTranslate = true;
  controls.enableZoom = true;
  controls.enableTilt = true;
  controls.enableLook = true;
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function explicitEarthAction(text) {
  const match = /^\/earth\s+([a-z_]+)(?:\s+(\{.*\}))?$/i.exec(text);
  if (!match) return null;
  try {
    return { name: match[1], args: match[2] ? JSON.parse(match[2]) : {} };
  } catch {
    throw new Error('Use valid JSON after an /earth action name.');
  }
}

function routeIntent(text) {
  const value = normalizeText(text);
  // Keep routing commands deliberately narrow, but accept natural prefixes
  // such as "find the fastest route from … to …".  Route constraints are
  // evaluated separately below; they must never become part of the geocoder
  // query for the destination.
  const from = /(?:^|\b)(?:directions|route|navigate|drive|walk|cycle|bike|take me|get me|find(?: me)? (?:the )?(?:fastest|shortest)?\s*route|plan (?:a )?road trip)\s+(?:from\s+)?(.+?)\s+(?:to|→)\s+(.+)$/i.exec(value);
  if (from) {
    const origin = stripRouteQualifier(from[1]);
    const destination = stripRouteQualifier(from[2]);
    return {
      origin: /^(?:my\s+)?current location$/i.test(origin) ? null : origin,
      destination,
    };
  }
  const to = /^(?:directions(?:\s+to)?|navigate(?:\s+me)?\s+to|drive\s+to|walk\s+to|cycle\s+to|bike\s+to|take\s+me\s+to|get\s+me\s+to|route\s+to)\s+(.+)$/i.exec(value);
  return to ? { origin: null, destination: stripRouteQualifier(to[1]) } : null;
}

/** A saved current location is an explicit user choice, never an inferred GPS fix. */
function currentLocationIntent(text) {
  const match = /^(?:(?:set|use)\s+)?(?:my\s+)?(?:current\s+)?location\s+(?:is|=|to|as)\s+(.+)$/i.exec(normalizeText(text));
  const query = match ? stripRouteQualifier(match[1]) : '';
  return query || null;
}

function stripRouteQualifier(value) {
  return normalizeText(value)
    .replace(/\s+\bin\s+(?:a\s+)?3d(?:\s+earth)?(?:\s+view)?\b.*/i, '')
    // Commas belong to both addresses and decimal coordinate pairs. Only treat
    // one as a route-constraint separator when an actual qualifier follows it;
    // this preserves input such as "-33.9461, 151.1772" and "Bondi, NSW".
    .replace(/\s*(?:,|;)\s*(?:avoid|with|then|and\s+(?:show|add|compare)|that\s+(?:has|is)|using)\b.*/i, '')
    .replace(/\s+\b(?:avoid|with|then|and\s+(?:show|add|compare)|that\s+(?:has|is)|using)\b.*/i, '')
    // The visible Clyra route sheet changes the provider profile by appending
    // a mode phrase to the same natural-language route. Remove it before
    // geocoding so “Sydney Opera House on foot” does not become a fake place.
    .replace(/\s+\b(?:on\s+foot|by\s+(?:car|bike)|walking|cycling)\b.*$/i, '')
    .trim();
}

/**
 * Identifies requests that need a data product Clyra does not have in this
 * build.  This is intentionally before generic location/layer matching: a
 * phrase such as "historical satellite imagery" must not turn on the live
 * satellite layer, and a traffic request must not present our visual traffic
 * simulation as real congestion.
 *
 * This is a product boundary, not a language-model fallback. Each response
 * names the exact source or missing context required to safely execute it.
 */
function unsupportedRequest(text) {
  const value = normalizeText(text);
  const lower = value.toLowerCase();
  const routeWords = /\b(route|directions?|drive|driving|walk(?:ing)?|cycle|trip|navigate|arrival|leave)\b/.test(lower);

  if (/\b(historical|last\s+\d+\s+years?|over\s+the\s+last)\b.*\b(satellite|imagery|aerial)\b|\b(satellite|imagery|aerial)\b.*\b(historical|last\s+\d+\s+years?)\b/.test(lower)) {
    return 'Historical imagery is not connected in this build, so Clyra cannot verify a ten-year change analysis. Connect a licensed historical-imagery source, then this request can compare dated scenes instead of guessing.';
  }
  if (/\b(undeveloped|land use|land-use|surrounding infrastructure|parcel)\b/.test(lower)) {
    return 'Land-parcel and land-use analysis needs a parcel/zoning dataset for this region. Clyra will not label land as undeveloped or infer road access from imagery alone.';
  }
  if (/\b(steep sections?|elevation changes?|river crossings?|emergency access)\b/.test(lower)) {
    return 'A hiking safety assessment needs a verified elevation, hydrography, trail, and emergency-access dataset. The current terrain renderer is visual only, so Clyra will not infer hazards from the camera view.';
  }
  if (/\b(historical satellite|building I clicked|businesses inside|opening hours|entrances)\b/.test(lower)) {
    return 'Building details, entrances, opening hours, and tenants require a selected feature plus a verified place/building provider. Select a building and connect that source; Clyra will not invent indoor or opening-hours information.';
  }
  if (/\b(scenic|scenery)\b.*\b(route|drive|driving)\b|\b(route|drive|driving)\b.*\b(scenic|scenery)\b/.test(lower)) {
    return 'Scenic-route scoring is not configured. It needs a verified scenic-road/landscape model; the current road router only optimizes normal car, walk, and bike geometry.';
  }
  if (/\b(turn[- ]by[- ]turn|simulate (?:the )?(?:entire )?(?:trip|drive)|as if i were driving)\b/.test(lower)) {
    return 'Clyra can show real route steps and run its separate cinematic Fly Route, but live turn-by-turn navigation simulation is not installed yet. It will not label a camera fly-through as GPS navigation.';
  }
  if (/\b(arrive|leave|tomorrow|typical traffic|backup route)\b/.test(lower) && routeWords) {
    return 'Departure-time and backup-route advice needs historical and live traffic coverage for the route. This build has no configured traffic provider, so it cannot calculate a trustworthy leave time.';
  }
  if (/\b(heavy traffic|current traffic|traffic|delays?|congested|avoid tolls?|tolls?)\b/.test(lower) && routeWords) {
    return 'Clyra can make a road-following route, but live traffic, delay locations, and toll avoidance are not configured. The visible traffic layer is a simulation when no provider is connected, and is never used as current routing data.';
  }
  if (/\b(restaurants?|dinner)\b/.test(lower) && /\b(friends?|people|everyone|meet)\b/.test(lower)) {
    return 'Group dining plans need every person’s actual origin, arrival constraints, and a current POI provider with ratings, hours, dietary details, and parking. Clyra will not infer those details or rank venues from incomplete data.';
  }
  if (/\b(equal driving times?|meeting point|these three people|everyone)\b/.test(lower)) {
    return 'Finding a fair meeting point needs the three actual origins and route-time data. Provide the three locations and configure a routing/traffic provider; Clyra will not assume where anyone is.';
  }
  if (/\b(road trip|multiple stops|maximum\s+\d|overnight accommodation|reorder stops|walking tour)\b/.test(lower)) {
    return 'Multi-stop planning and route optimisation are not installed in the current route engine. Clyra supports one verified A→B road route at a time and will not pretend to have optimised a tour.';
  }
  if (/\b(compare (?:this )?(?:neighbou?rhood|suburb)|supermarkets|schools|train stations|commute times)\b/.test(lower)) {
    return 'Neighbourhood comparison needs the named areas plus current amenity and commute datasets. Clyra does not have those verified regional datasets connected yet, so it cannot produce a trustworthy comparison.';
  }
  if (/\b(unusual nearby|probably wouldn'?t discover|somewhere interesting|five unusual)\b/.test(lower)) {
    return 'Discovery recommendations need a viewport/current location and a curated POI dataset. Clyra will not manufacture “unusual” places or create a multi-stop route without those inputs.';
  }
  if (/\b(petrol stations?|fuel stations?|caf[eé]s?|restaurants?|beach|hospital|emergency department|parking|outdoor seating|vegetarian|rating|open right now|highly rated|nearby)\b/.test(lower)) {
    return 'This request needs a current POI provider with ratings, hours, amenities, and availability. Clyra’s geocoder resolves places but does not have verified business attributes, so it will not recommend or rank venues from incomplete data.';
  }
  return null;
}

function flightBetweenIntent(text) {
  const match = /^(?:fly(?:\s+me)?|take\s+me)\s+from\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i.exec(normalizeText(text));
  if (!match) return null;
  return { origin: stripRouteQualifier(match[1]), destination: stripRouteQualifier(match[2]) };
}

function routeMode(text) {
  if (/\b(walk|walking|on foot)\b/i.test(text)) return 'foot';
  if (/\b(cycle|cycling|bike|biking)\b/i.test(text)) return 'bike';
  return 'car';
}

function requestedLayer(text) {
  const lower = text.toLowerCase();
  if (/\b(aircraft|planes?|flights?)\b/.test(lower)) return 'flights';
  if (/\b(ships?|vessels?|boats?)\b/.test(lower)) return 'ais-live-vessels';
  if (/\b(cctv|cameras?)\b/.test(lower)) return 'cctv';
  if (/\b(fires?|wildfires?)\b/.test(lower)) return 'local-firms';
  if (/\b(satellites?)\b/.test(lower)) return 'satellites';
  if (/\b(earthquakes?|quakes?)\b/.test(lower)) return 'earthquakes';
  return null;
}

function requestedPanel(text) {
  const lower = text.toLowerCase();
  if (/\b(data|layers?)\b/.test(lower)) return 'data-panel';
  if (/\b(control|settings?)\b/.test(lower)) return 'control-panel';
  if (/\b(location|search)\b/.test(lower)) return 'location-bar';
  if (/\b(scene|cinematic)\b/.test(lower)) return 'scene-panel';
  if (/\b(cctv|camera)\b/.test(lower)) return 'cctv-panel';
  return null;
}

function currentPosition() {
  // A route should never begin from a stale desktop position. The trusted
  // parent also filters coarse samples before this cache is updated.
  if (currentLocation && (currentLocation.source === 'saved'
    || (Date.now() - currentLocation.timestamp < 15_000
      && Number(currentLocation.accuracyM) <= 250))) {
    showCurrentLocationIndicator(window.__godsEyeView?.viewer, currentLocation);
    return Promise.resolve(currentLocation);
  }
  // The Earth renderer is framed from a separate loopback origin. Delegate
  // permission to Clyra's trusted top-level document so the user sees one
  // clear, product-level request rather than an opaque iframe-origin prompt.
  const parentRequest = requestParentLocation();
  if (parentRequest) return parentRequest;
  if (!navigator.geolocation)
    return Promise.reject(new Error('Current location is unavailable. Enter an origin to create this route.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Current location timed out. Enter an origin to create this route.')),
      LOCATION_TIMEOUT_MS,
    );
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        const location = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracyM: position.coords.accuracy,
          ...(Number.isFinite(Number(position.coords.heading))
            && Number(position.coords.heading) >= 0
            && Number(position.coords.heading) < 360
            ? { heading: Number(position.coords.heading) }
            : {}),
          timestamp: Date.now(),
          label: 'Current Location',
          source: 'device',
        };
        if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) {
          reject(new Error('Current location did not return usable coordinates. Enter an origin to create this route.'));
          return;
        }
        if (!Number.isFinite(location.accuracyM) || location.accuracyM > 250) {
          reject(new Error('Clyra only found an approximate location. Turn on Precise Location, then try again or enter an origin manually.'));
          return;
        }
        resolve(rememberCurrentLocation(location));
      },
      () => {
        clearTimeout(timer);
        reject(new Error('Location permission is required for Current Location. Enter an origin to create this route.'));
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

function requestParentLocation() {
  if (window.parent === window) return null;
  if (parentLocationPending) return parentLocationPending.promise;
  let resolvePending;
  let rejectPending;
  const promise = new Promise((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  const timer = window.setTimeout(() => {
    settleParentLocation(null, 'Current location timed out. Check Location Services and try again.');
  }, LOCATION_TIMEOUT_MS + 3_000);
  parentLocationPending = { promise, resolve: resolvePending, reject: rejectPending, timer };
  reply('location-request');
  return promise;
}

function settleParentLocation(payload, errorMessage = null) {
  const pending = parentLocationPending;
  if (!pending) return;
  parentLocationPending = null;
  window.clearTimeout(pending.timer);
  const lat = Number(payload?.lat);
  const lon = Number(payload?.lon);
  const accuracyM = Number(payload?.accuracyM);
  const heading = Number(payload?.heading);
  const source = payload?.source === 'saved' ? 'saved' : 'device';
  const label = normalizeText(payload?.label);
  const validCoordinates = Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const validDeviceFix = Number.isFinite(accuracyM) && accuracyM >= 0 && accuracyM <= 250;
  if (validCoordinates && (source === 'saved' ? Boolean(label) : validDeviceFix)) {
    const location = {
      lat,
      lon,
      accuracyM: validDeviceFix ? accuracyM : undefined,
      ...(Number.isFinite(heading) && heading >= 0 && heading < 360 ? { heading } : {}),
      timestamp: Number.isFinite(Number(payload?.timestamp)) ? Number(payload.timestamp) : Date.now(),
      label: source === 'saved' ? label : 'Current Location',
      source,
    };
    pending.resolve(rememberCurrentLocation(location));
    return;
  }
  pending.reject(new Error(errorMessage || 'Clyra only found an approximate location. Turn on Precise Location, then try again or enter an origin manually.'));
}

async function setCurrentLocation(debug, query) {
  const placeSearch = debug?.placeSearch;
  if (!placeSearch) throw new Error('Location search is still starting. Try again in a moment.');
  const place = await geocode(placeSearch, query);
  const location = {
    ...place,
    timestamp: Date.now(),
    source: 'saved',
  };
  rememberCurrentLocation(location, debug?.viewer);
  return {
    text: `Current location set to ${place.label}.`,
    data: { currentLocation },
  };
}

async function runStartupLocationFlight() {
  if (startupFlightRequested || startupCancelledByManualInput) return;
  startupFlightRequested = true;
  try {
    const position = await currentPosition();
    // A gesture always wins over presentation motion. If someone starts to
    // explore while the OS location request is pending, leave their globe
    // exactly where they put it.
    if (startupCancelledByManualInput) return;
    stopIdleSpin?.();
    const debug = window.__godsEyeView;
    const result = await debug?.runAction?.('fly_to_location', {
      latitude: position.lat,
      longitude: position.lon,
      rangeM: 1200,
      duration: 3.6,
    });
    if (result?.ok !== true) throw new Error(compactResult(result));
  } catch {
    // A declined or unavailable location must never interrupt launch. The
    // globe remains centered and immediately usable; an explicit Current
    // Location command gives the person the actionable permission message.
  }
}

async function geocode(placeSearch, query) {
  // Prefer Clyra's bounded same-origin geocoder. The browser-side provider
  // chain is useful as a fallback, but can wait behind a public upstream while
  // this endpoint already has a clean, normalized answer for the manual search
  // and command bar. Keeping both paths uses the existing provider system
  // without letting an autocomplete request feel stuck.
  const local = await geocodeFromClyraEndpoint(query);
  if (local) return local;
  const outcome = await placeSearch.geocode(query);
  const place = outcome?.place;
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng))
    throw new Error(`No location was found for “${query}”.`);
  return { lat: place.lat, lon: place.lng, label: place.label || query };
}

/**
 * Resolve one real result from Clyra's existing same-origin geocoder.
 * Suggestions pass an AbortSignal when the person keeps typing; commands use
 * the same short timeout but can still fall back to the configured place
 * providers when this service is unavailable.
 */
async function geocodeFromClyraEndpoint(query, { signal = null } = {}) {
  const value = normalizeText(query);
  if (!value) return null;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener?.('abort', cancel, { once: true });
  const timer = window.setTimeout(cancel, 4_500);
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(value)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const result = data?.results?.find((entry) => {
      const lat = Number(entry?.geometry?.location?.lat);
      const lon = Number(entry?.geometry?.location?.lng);
      return Number.isFinite(lat) && Number.isFinite(lon);
    });
    if (!result) return null;
    const lat = Number(result.geometry.location.lat);
    const lon = Number(result.geometry.location.lng);
    const primary = normalizeText(result.address_components?.[0]?.long_name);
    const label = primary || normalizeText(result.formatted_address) || value;
    const detail = Array.isArray(result.types) ? normalizeText(result.types[0]) : '';
    return { lat, lon, label, detail: detail || undefined };
  } catch {
    // An aborted or offline autocomplete is intentionally quiet. The caller
    // either starts a newer request or falls back to the configured geocoder.
    return null;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener?.('abort', cancel);
  }
}

/**
 * Resolve one live search suggestion through the exact geocoder used by
 * fly-to and directions.  Keeping this at the bridge prevents the host UI
 * from inventing place names or making a parallel provider request.
 */
async function suggest(query) {
  const value = normalizeText(query);
  suggestionController?.abort();
  if (value.length < 3) return { query: value, places: [] };
  const needle = value.toLocaleLowerCase();
  // Instant suggestions come only from the same bundled location catalogue the
  // existing offline geocoder uses. They are real named places, not generated
  // completions; a broader provider result is appended below when available.
  const local = Object.values(CITY_POIS)
    .flatMap((city) => [
      { label: city.name, detail: 'City' },
      ...(city.pois || []).map((poi) => ({ label: `${poi.name}, ${city.name}`, detail: 'Landmark' })),
    ])
    .filter((place) => place.label.toLocaleLowerCase().includes(needle))
    .slice(0, 5);
  if (local.length) return { query: value, places: local };
  const controller = new AbortController();
  suggestionController = controller;
  try {
    const place = await geocodeFromClyraEndpoint(value, { signal: controller.signal });
    if (controller.signal.aborted || suggestionController !== controller) return null;
    return {
      query: value,
      places: place && Number.isFinite(place.lat) && Number.isFinite(place.lon)
        ? [{ label: place.label || value, detail: place.detail }]
        : [],
    };
  } finally {
    if (suggestionController === controller) suggestionController = null;
  }
}

async function awaitRoute(layer) {
  const deadline = Date.now() + ROUTE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = layer.getRouteState?.();
    if (state?.status === 'ready') return layer.getRoute?.();
    if (state?.status === 'error') throw new Error(state.error || 'No road route was found.');
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('Routing timed out. Please try again.');
}

/**
 * Frame the actual road geometry after it is available.  A route result should
 * not leave a person staring at only the departure suburb: the overview is a
 * short, interruptible Cesium flight that keeps both endpoints and the blue
 * line legible.  It derives its bounds from the returned route points (never
 * a straight origin/destination shortcut), so it also works for detours.
 */
async function frameRouteOverview(viewer, route) {
  const geometry = Array.isArray(route?.geometry) ? route.geometry : [];
  if (!viewer?.camera || geometry.length < 2) return;
  const positions = geometry
    .map(([longitude, latitude]) => {
      const lon = Number(longitude);
      const lat = Number(latitude);
      return Number.isFinite(lon) && Number.isFinite(lat)
        ? Cesium.Cartesian3.fromDegrees(lon, lat, 0)
        : null;
    })
    .filter(Boolean);
  if (positions.length < 2) return;
  const sphere = Cesium.BoundingSphere.fromPoints(positions);
  const range = Math.max(3_600, sphere.radius * 2.25);
  const center = Cesium.Cartographic.fromCartesian(sphere.center);
  if (!center) return;
  await new Promise((resolve) => {
    // A direct surface destination is more dependable than a bounding-sphere
    // offset while Cesium is still resolving terrain for a fresh route. The
    // altitude comes from the real route extent, and the vertical map angle
    // leaves every road segment readable rather than favouring one endpoint.
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, range),
      duration: 1.8,
      orientation: {
        heading: 0,
        pitch: -Cesium.Math.PI_OVER_TWO,
        roll: 0,
      },
      complete: resolve,
      cancel: resolve,
    });
  });
  viewer.scene.requestRender?.();
}

function formatRoute(route, origin, destination) {
  const km = route.distanceM >= 1000
    ? `${(route.distanceM / 1000).toFixed(route.distanceM >= 10000 ? 0 : 1)} km`
    : `${Math.round(route.distanceM)} m`;
  const minutes = Math.max(1, Math.round(route.durationS / 60));
  return `Route ready: ${origin.label} → ${destination.label} · ${km} · ${minutes} min`;
}

async function createRoute(debug, intent, text) {
  stopRouteProgressBridge();
  const { dataManager, placeSearch } = debug;
  if (!dataManager || !placeSearch) throw new Error('Directions are still starting. Try again in a moment.');
  const origin = intent.origin ? await geocode(placeSearch, intent.origin) : await currentPosition();
  const destination = await geocode(placeSearch, intent.destination);
  await dataManager.setEnabled('directions', true, { origin: 'clyra-command' });
  const layer = dataManager.layers.get('directions')?.module;
  if (!layer?.placeEndpoint) throw new Error('Directions are unavailable.');
  layer.setParams({ clear: true, mode: routeMode(text) });
  layer.placeEndpoint('a', origin);
  layer.placeEndpoint('b', destination);
  const route = await awaitRoute(layer);
  await frameRouteOverview(debug.viewer, route);
  return { text: formatRoute(route, origin, destination), data: { origin, destination, route } };
}

/**
 * Own Fly Route playback through Directions—not through an unrelated camera
 * tween—so pause and resume operate on the same visible blue-route traveller.
 */
function controlRouteFlight(debug, action, options = {}) {
  const layer = debug?.dataManager?.layers?.get('directions')?.module;
  if (!layer?.controlFlight) throw new Error('Create and start a Fly Route before using its controls.');
  if (action === 'overview') {
    const route = layer.getRoute?.();
    if (!route) throw new Error('Create a route before returning to overview.');
    // A route dolly is the camera owner; returning to overview must release it
    // first or the next animation frame would take the camera straight back.
    layer.controlFlight('stop');
    stopRouteProgressBridge();
    return frameRouteOverview(debug.viewer, route).then(() => ({
      text: 'Route overview restored.',
      data: { route },
    }));
  }
  const result = layer.controlFlight(action, options);
  if (!result?.ok) throw new Error(result?.error || 'Fly Route control is unavailable.');
  if (action === 'stop') stopRouteProgressBridge();
  const copy = action === 'pause'
    ? 'Fly Route paused.'
    : action === 'stop'
      ? 'Fly Route stopped.'
      : 'Rejoining the route smoothly.';
  return { text: copy, data: { flight: result.flight } };
}

function firstText(...values) {
  return values.map((value) => normalizeText(value)).find(Boolean) || null;
}

/**
 * Reads the selected entity through the existing God’s Eye context store. It
 * deliberately reports only fields supplied by the active flight source; the
 * cockpit remains the richer continuously updating presentation.
 */
async function inspectSelectedAircraft(debug) {
  // Tracking is the canonical selection state for God’s Eye aircraft. The
  // visual entity context is intentionally independent, so check the live
  // flight module first rather than incorrectly saying a tracked aircraft is
  // not selected.
  const tracked = ['flights', 'military']
    .map((id) => debug.dataManager?.layers?.get(id)?.module?.getTrackedInfo?.())
    .find(Boolean);
  if (tracked) {
    const ft = Number.isFinite(tracked.altitudeM) ? `${Math.round(tracked.altitudeM * 3.28084).toLocaleString()} ft` : 'Unavailable';
    const speed = Number.isFinite(tracked.velocityMps) ? `${Math.round(tracked.velocityMps * 3.6)} km/h` : 'Unavailable';
    const track = Number.isFinite(tracked.track) ? `${Math.round(tracked.track)}°` : 'Unavailable';
    const coordinates = Number.isFinite(tracked.latitude) && Number.isFinite(tracked.longitude)
      ? `${tracked.latitude.toFixed(4)}, ${tracked.longitude.toFixed(4)}`
      : 'Unavailable';
    const identity = firstText(tracked.callsign, tracked.registration, tracked.icao24) || 'Unknown';
    const type = firstText(tracked.typeName, tracked.typeCode, tracked.airline) || 'Unavailable';
    const route = tracked.origin || tracked.destination
      ? `${tracked.origin || 'Unavailable'} → ${tracked.destination || 'Unavailable'}`
      : 'Unavailable';
    return {
      text: `Flight ${identity} · ${type} · ${route} · ${ft} · ${speed} · track ${track} · ${coordinates}. Fields not supplied by the live feed remain unavailable.`,
      data: tracked,
    };
  }
  const context = await debug.runAction('get_entity_context', { scope: 'selected' });
  const selected = context?.selected;
  if (!selected) {
    const flightLayer = debug.dataManager?.getAll?.().find((layer) => layer.id === 'flights');
    const feedHint = flightLayer?.enabled
      ? 'No aircraft is selected.'
      : 'Live Flights is off; enable it and select an aircraft first.';
    throw new Error(`${feedHint} Clyra will only report telemetry for an actual selected flight.`);
  }
  const properties = selected.properties || selected.data || selected;
  const callsign = firstText(properties.callsign, properties.flightNumber, properties.flight, selected.label, selected.title);
  const type = firstText(properties.typeName, properties.aircraftType, properties.typeCode, properties.model);
  const origin = firstText(properties.origin, properties.routeOrigin, properties.departure);
  const destination = firstText(properties.destination, properties.routeDestination, properties.arrival);
  const supplied = [
    callsign && `Flight ${callsign}`,
    type && type,
    origin || destination ? `${origin || 'Unknown'} → ${destination || 'Unknown'}` : null,
  ].filter(Boolean);
  return {
    text: supplied.length
      ? `${supplied.join(' · ')}. Open Cockpit for the live telemetry supplied by this feed.`
      : 'Aircraft selected. Open Cockpit for the live telemetry supplied by this feed.',
    data: context,
  };
}

/** Select the closest loaded aircraft to the camera focus, without a hidden location field. */
async function selectNearestAircraft(debug) {
  const cartographic = debug.viewer?.camera?.positionCartographic;
  if (!cartographic) throw new Error('Earth camera is not ready to select an aircraft. Try again in a moment.');
  await setClyraLayerEnabled(debug, 'flights', true);
  const layer = debug.dataManager?.layers?.get('flights')?.module;
  if (!layer?.getNearby) throw new Error('Live Flights is still starting. Try again in a moment.');
  // Query on the Earth surface beneath the camera: this yields a genuinely
  // nearest loaded contact, not the first item in a feed that happened to be
  // received. The bounded wait covers the normal first viewport refresh.
  const focus = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
  let aircraft = null;
  for (let attempt = 0; attempt < 18 && !aircraft; attempt += 1) {
    aircraft = layer.getNearby(focus, Number.POSITIVE_INFINITY, 1, { includeHidden: true })?.[0] || null;
    if (!aircraft) await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!aircraft?.icao24) {
    throw new Error('Live Flights is enabled, but no airborne aircraft is loaded near this view yet. Pan to an active air corridor or try again after the feed refreshes.');
  }
  const result = await debug.runAction('track_entity', { query: aircraft.icao24, layerId: 'flights' });
  if (result?.ok !== true) throw new Error(compactResult(result));
  const label = firstText(aircraft.callsign, result.label, aircraft.id) || 'aircraft';
  return { text: `Selected nearest aircraft: ${label}. Open Cockpit for the live flight view.`, data: { result, aircraft } };
}

function intercityAnchor(value) {
  return INTERCITY_CITY_ANCHORS[normalizeText(value).toLocaleLowerCase()] || null;
}

async function flyIntercityEndpoint(debug, value, { globe = false } = {}) {
  const anchor = intercityAnchor(value);
  const args = anchor
    ? {
      latitude: anchor.lat,
      longitude: anchor.lon,
      // An Earth-scale stop makes long moves legible as a real geographic
      // transition instead of a straight local tween between two city cameras.
      ...(globe ? { rangeM: 18_000_000, duration: 1.65 } : { rangeM: 12_000, duration: 2.1 }),
      waitForArrival: true,
    }
    : { query: value, waitForArrival: true };
  const result = await debug.runAction('fly_to_location', args);
  if (result?.ok !== true) throw new Error(compactResult(result));
  return { ...result, label: anchor?.label || result.label || value };
}

/**
 * Use the existing camera action for every leg. The Earth-scale midpoint is
 * deliberately separate from city arrivals so crossing continents never reads
 * as a single direct tween. No path annotation is claimed without its source.
 */
async function flyBetween(debug, intent) {
  const origin = await flyIntercityEndpoint(debug, intent.origin);
  await flyIntercityEndpoint(debug, intent.origin, { globe: true });
  await flyIntercityEndpoint(debug, intent.destination, { globe: true });
  const destination = await flyIntercityEndpoint(debug, intent.destination);
  return {
    text: `Cinematic flight completed: ${origin.label} → ${destination.label}. Named cities, terrain, and landmarks along the corridor need a verified route-annotation dataset before Clyra can narrate them.`,
    data: { origin, destination },
  };
}

async function execute(text) {
  const debug = window.__godsEyeView;
  if (!debug?.runAction) throw new Error('Clyra Earth is still starting. Try again in a moment.');
  startupCancelledByManualInput = true;
  stopIdleSpin?.();
  // Stopping the presentation spin is enough. Calling the general camera
  // “stop” action here used to release an active aircraft/route tracker before
  // a follow-up question could read it, which made “what is this aircraft?”
  // falsely report that nothing was selected.
  const value = normalizeText(text);
  if (!value) throw new Error('Enter a place or command.');
  const direct = explicitEarthAction(value);
  if (direct) {
    if (direct.name === 'route_flight_control') {
      return controlRouteFlight(debug, direct.args?.action, direct.args || {});
    }
    if (direct.name === 'set_layer_visibility' && typeof direct.args?.layerId === 'string') {
      if (direct.args.enabled) clyraOptInLayers.add(direct.args.layerId);
      else clyraOptInLayers.delete(direct.args.layerId);
    }
    const result = await debug.runAction(direct.name, direct.args);
    if (result?.ok === false) throw new Error(compactResult(result));
    return { text: compactResult(result), data: result };
  }
  const boundary = unsupportedRequest(value);
  if (boundary) throw new Error(boundary);
  const locationChange = currentLocationIntent(value);
  if (locationChange) return setCurrentLocation(debug, locationChange);
  if (/\b(?:what'?s|what is|tell me about|details? (?:for|of))\b.*\b(?:aircraft|plane|flight)\b|\b(?:flight number|aircraft type|estimated arrival)\b/i.test(value)) {
    return inspectSelectedAircraft(debug);
  }
  const intercityFlight = flightBetweenIntent(value);
  if (intercityFlight) return flyBetween(debug, intercityFlight);
  const intent = routeIntent(value);
  if (intent) return createRoute(debug, intent, value);
  if (/^(?:fly\s+(?:the\s+)?route|start\s+fly(?:ing)?|play\s+(?:the\s+)?route)$/i.test(value)) {
    const layer = debug.dataManager?.layers?.get('directions')?.module;
    if (!layer?.getRoute?.()) throw new Error('Create a route before flying it.');
    if (!layer.setParams({ fly: true })) throw new Error('Clyra could not start the route flight.');
    startRouteProgressBridge(layer);
    return { text: 'Cinematic route flight started.' };
  }
  if (/^(?:pause|resume)(?:\s+(?:the\s+)?(?:route|flight))?$/i.test(value)) {
    const action = /^pause/i.test(value) ? 'pause' : 'resume';
    return controlRouteFlight(debug, action);
  }
  if (/^(?:go back to|show)\s+(?:my\s+)?location$/i.test(value)) {
    const position = await currentPosition();
    const result = await debug.runAction('fly_to_location', {
      latitude: position.lat,
      longitude: position.lon,
      waitForArrival: true,
    });
    showCurrentLocationIndicator(debug.viewer, position);
    const accuracy = Number.isFinite(position.accuracyM)
      ? (position.accuracyM >= 1_000 ? `±${(position.accuracyM / 1_000).toFixed(1)} km` : `±${Math.round(position.accuracyM)} m`)
      : 'unknown accuracy';
    return {
      text: position.source === 'saved'
        ? `Current location: ${position.label}.`
        : `Current location: ${position.lat.toFixed(4)}, ${position.lon.toFixed(4)} · ${accuracy}`,
      data: { ...result, location: position },
    };
  }
  const layerId = requestedLayer(value);
  if (layerId && /\b(show|enable|turn on|display|hide|disable|turn off)\b/i.test(value)) {
    const enabled = !/\b(hide|disable|turn off)\b/i.test(value);
    const result = await setClyraLayerEnabled(debug, layerId, enabled);
    return { text: compactResult(result), data: result };
  }
  if (/^(?:show|open)\s+(?:the\s+)?(?:data\s+)?layers?$/i.test(value)) {
    const result = await debug.runAction('show_data_layers_menu', {});
    return { text: compactResult(result), data: result };
  }
  const panelId = requestedPanel(value);
  if (panelId && /\b(open|show|close|hide)\b/i.test(value)) {
    const open = !/\b(close|hide)\b/i.test(value);
    const result = await debug.runAction('set_panel_open', { panelId, open });
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:zoom out|zoom in)\b/i.test(value)) {
    const result = await debug.runAction('adjust_camera_zoom', {
      direction: /zoom out/i.test(value) ? 'out' : 'in',
      amount: /\b(lot|far|way)\b/i.test(value) ? 'lot' : /\b(slight|little|bit)\b/i.test(value) ? 'little' : 'medium',
    });
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:whole earth|full globe|world view|zoom to globe)\b/i.test(value)) {
    const result = await debug.runAction('zoom_to_globe', {});
    return { text: compactResult(result), data: result };
  }
  if (/^(?:follow|track)\s+(.+)$/i.test(value)) {
    const query = /^(?:follow|track)\s+(.+)$/i.exec(value)?.[1];
    const result = await debug.runAction('track_entity', { query });
    return { text: compactResult(result), data: result };
  }
  if (/^(?:stop following|stop tracking)$/i.test(value)) {
    const result = await debug.runAction('stop_tracking', {});
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:enter|open)\s+cockpit\b/i.test(value)) {
    const result = await debug.runAction('control_cockpit', { action: 'enter' });
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:exit|close)\s+cockpit\b/i.test(value)) {
    const result = await debug.runAction('control_cockpit', { action: 'exit' });
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:show|hide)\s+(?:the\s+)?hud\b/i.test(value)) {
    const result = await debug.runAction('set_hud', { visible: /\bhide\b/i.test(value) ? 'off' : 'on' });
    return { text: compactResult(result), data: result };
  }
  const style = /\b(retro|surveillance|thermal|anime|noir|snow|normal)\b/i.exec(value)?.[1]?.toLowerCase();
  if (style && /\b(?:style|view|mode|make)\b/i.test(value)) {
    const result = await debug.runAction('set_visual_style', { style });
    return { text: compactResult(result), data: result };
  }
  if (/\b(?:nearest|closest)\s+(?:aircraft|plane|flight)\b/i.test(value)) {
    return selectNearestAircraft(debug);
  }
  const location = /^(?:take me to|go to|fly to|show|find|where is)\s+(.+)$/i.exec(value);
  const result = await debug.runAction('fly_to_location', {
    query: location ? location[1] : value,
    waitForArrival: true,
  });
  if (result?.ok !== true) throw new Error(compactResult(result));
  showSelectedPlacePin(debug.viewer, result, location ? location[1] : value);
  return { text: compactResult(result), data: result };
}

export function installClyraEarthBridge({ application }) {
  const canvas = window.__godsEyeView?.viewer?.scene?.canvas;
  canvas?.addEventListener(
    'pointerdown',
    () => restoreFreeGlobeInput(window.__godsEyeView?.viewer),
    { passive: true },
  );
  const emitReady = () => {
    if (application.getState?.().status !== 'ready') return;
    if (isClyraWorkspaceDocument() && !clyraWorkspacePreparation) {
      clyraWorkspacePreparation = prepareClyraWorkspace()
        .catch((error) => {
          // A clean launch should not become unusable if an optional old layer
          // release fails. The normal Earth startup remains authoritative.
          console.warn('[Clyra Earth] clean-start preparation failed:', error);
        })
        .finally(() => {
          // Keep the resolved promise as the completion marker; a later ping
          // must not redo the reset and interrupt the person's map session.
          reply('ready');
        });
      return;
    }
    if (isClyraWorkspaceDocument() && clyraWorkspacePreparation) return;
    // Application readiness precedes the loading cover's CSS transition by a
    // few frames. The surrounding Clyra UI must wait until the Earth document
    // has actually hidden its own loader.
    const loadingScreen = document.querySelector('#loading-screen');
    if (loadingScreen && !loadingScreen.classList.contains('hidden')) return;
    reply('ready');
  };
  application.subscribe?.(emitReady);
  application.subscribe?.(() => {
    if (idleSpinStarted || application.getState?.().status !== 'ready') return;
    // The embedded Clyra surface opens as a calm living globe. Manual input
    // and execute() both release this presentation immediately.
    if (window.parent === window || new URLSearchParams(window.location.search).has('prewarm')) return;
    if (isClyraWorkspaceDocument()) {
      // A Clyra document first releases stale shared layers and returns to a
      // globe view. Start the presentation spin only after that hand-off so
      // two camera owners never fight during launch.
      if (clyraWorkspacePreparation) {
        void clyraWorkspacePreparation.finally(() => {
          if (idleSpinStarted || startupCancelledByManualInput) return;
          idleSpinStarted = true;
          startCenteredEarthSpin(window.__godsEyeView?.viewer, () => {
            startupCancelledByManualInput = true;
          });
        });
      }
      return;
    }
    idleSpinStarted = true;
    startCenteredEarthSpin(window.__godsEyeView?.viewer, () => {
      startupCancelledByManualInput = true;
    });
  });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !parentAllowed(event.origin)) return;
    const message = event.data;
    if (!message || message[MARK] !== true) return;
    if (message.kind === 'ping') {
      emitReady();
      return;
    }
    if (message.kind === 'suggest' && typeof message.query === 'string') {
      void suggest(message.query)
        .then((result) => { if (result) reply('suggestion', result); })
        .catch(() => reply('suggestion', { query: message.query, places: [] }));
      return;
    }
    if (message.kind === 'location') {
      settleParentLocation(message.location);
      return;
    }
    if (message.kind === 'location-error') {
      settleParentLocation(null, typeof message.text === 'string' ? message.text : null);
      return;
    }
    if (message.kind === 'startup-location') {
      void runStartupLocationFlight();
      return;
    }
    if (message.kind === 'route-flight-control') {
      const allowed = new Set(['pause', 'resume', 'stop', 'overview']);
      if (!allowed.has(message.action)) return;
      void Promise.resolve()
        .then(() => controlRouteFlight(window.__godsEyeView, message.action))
        .then((result) => reply('result', result))
        .catch((error) => {
          reply('error', { text: error instanceof Error ? error.message : String(error) });
        });
      return;
    }
    if (message.kind !== 'command' || typeof message.text !== 'string') return;
    void execute(message.text)
      .then((result) => reply('result', result))
      .catch((error) => reply('error', { text: error instanceof Error ? error.message : String(error) }));
  });
  // Expose the same deterministic suggestion operation that serves the
  // upper-left manual search.  This is deliberately a tool-shaped API rather
  // than a second geocoder: UI automation and future Clyra agents exercise
  // precisely the provider-backed path a person sees while typing.
  window.__clyraEarthBridge = Object.freeze({ execute, currentPosition, suggest });
}
