/**
 * Embed mode and views in the running app.
 *
 * With `?embed=1` the app shows only the globe: clean view, with the HUD,
 * welcome and setup prompts hidden. A page that frames it changes what it
 * shows by posting `{ type: 'gev:view', id, view }`; the app applies the view
 * through its own actions and answers `{ type: 'gev:view-applied', id, ok,
 * steps }`. It announces `{ type: 'gev:ready' }` once it can take views.
 *
 * Annotations in a share link are drawn once the link has been restored,
 * embedded or not.
 */

import * as Cesium from 'cesium';
import { announceNavigationAuthority } from '../navigationPolicy.js';
import { annotationsFromParams, createView } from '../view/index.js';
import {
  holdContinuousRender,
  releaseContinuousRender,
} from '../renderGovernor.js';

export const EMBED_VIEW_MESSAGE = 'gev:view';
export const EMBED_APPLIED_MESSAGE = 'gev:view-applied';
export const EMBED_READY_MESSAGE = 'gev:ready';

const FOLLOW_LAYERS = {
  aircraft: 'flights',
  military_aircraft: 'military',
  satellite: 'satellites',
};
const FOLLOW_ATTEMPTS = 20;
const FOLLOW_RETRY_MS = 1000;
const FLIGHT_SECONDS = 2;

/**
 * Whether this page shows the app embedded: `?embed=1` when another page
 * frames it, or inline when a panel page loads the app into itself and sets
 * `globalThis.GEV_EMBED_INLINE` first.
 */
export function isEmbedded(location = globalThis.location) {
  return (
    isEmbeddedInline() ||
    new URLSearchParams(location?.search || '').get('embed') === '1'
  );
}

/** Whether a panel page loaded the app into itself. */
export function isEmbeddedInline() {
  return globalThis.GEV_EMBED_INLINE === true;
}

// A panel keeps drawing at about this rate when its host stops animation
// frames; see keepPanelRendering.
const PANEL_FRAME_MS = 33;
const MISSED_FRAMES_MS = 250;

/** A render error's details, including the plain objects workers report. */
function describeError(error) {
  if (error instanceof Error)
    return `${error.name}: ${error.message}\n${error.stack}`;
  try {
    return JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
  } catch {
    return String(error);
  }
}

/**
 * Keep the globe drawing in an inline panel. Some hosts report a panel on
 * screen as hidden, which stops the browser's animation frames and with them
 * Cesium's render loop; while frames stop arriving, draw from a timer.
 * Returns a function that stops it.
 */
export function keepPanelRendering(
  viewer,
  { windowRef = globalThis.window, now = () => performance.now() } = {},
) {
  let lastFrame = now();
  let frameRequest = null;
  const onFrame = () => {
    lastFrame = now();
    frameRequest = windowRef.requestAnimationFrame(onFrame);
  };
  frameRequest = windowRef.requestAnimationFrame(onFrame);
  // Cesium stops drawing after a render error, and so does the timer.
  // Report the error in full: workers report plain objects, which Cesium
  // prints as [object Object].
  let failed = false;
  const removeErrorListener = viewer.scene?.renderError?.addEventListener(
    (_scene, error) => {
      failed = true;
      console.error(
        "[God's Eye View panel] render error:",
        describeError(error),
      );
    },
  );
  const timer = windowRef.setInterval(() => {
    if (
      failed ||
      now() - lastFrame < MISSED_FRAMES_MS ||
      viewer.isDestroyed?.()
    )
      return;
    viewer.resize();
    viewer.render();
  }, PANEL_FRAME_MS);
  return () => {
    windowRef.clearInterval(timer);
    windowRef.cancelAnimationFrame(frameRequest);
    removeErrorListener?.();
  };
}

const delay = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Fly the camera to a view's camera and resolve when the flight ends. */
function flyTo(viewer, camera) {
  announceNavigationAuthority('embed-view');
  // A programmatic flight must keep the scene in continuous render mode so the
  // move is a smooth cinematic glide even when every layer is idle.
  holdContinuousRender('embed-camera-flight');
  return new Promise((resolve) => {
    const settle = (result) => {
      releaseContinuousRender('embed-camera-flight');
      resolve(result);
    };
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        camera.lon,
        camera.lat,
        camera.altitude_m,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(camera.heading_deg),
        pitch: Cesium.Math.toRadians(camera.pitch_deg),
        roll: 0,
      },
      duration: FLIGHT_SECONDS,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: () => settle(true),
      cancel: () => settle(false),
    });
  });
}

/**
 * Make the app show a view: style and map, exactly the view's layers,
 * annotations, the camera, and the followed entity. Each step runs through the
 * app's own actions (`run(name, args)`); a failed step is reported and the
 * rest still run. Resolves to the steps and whether each succeeded.
 */
export async function applyView(
  view,
  { viewer, dataManager, run, signal, retryMs = FOLLOW_RETRY_MS },
) {
  const steps = [];
  const act = async (name, args) => {
    let result = null;
    try {
      result = await run(name, args);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    steps.push({
      step: name,
      ok: result?.ok !== false,
      ...(result?.error ? { error: result.error } : {}),
    });
    return result;
  };
  if (view.style) await act('set_visual_style', { style: view.style });
  if (view.map) await act('set_map_stack', { stack: view.map });
  const wanted = new Set(view.layers);
  for (const layer of dataManager.getAll()) {
    if (layer.enabled && !wanted.has(layer.id))
      await act('set_layer_visibility', { layerId: layer.id, enabled: false });
  }
  for (const layerId of view.layers) {
    if (!dataManager.isEnabled(layerId))
      await act('set_layer_visibility', { layerId, enabled: true });
  }
  if (!view.follow) await act('stop_tracking', {});
  // Annotations go first: drawing them may frame the marks, and the view's
  // own camera should have the last word.
  await act('clear_annotations', {});
  if (view.annotations.length)
    await act('annotate_map', { annotations: [...view.annotations] });
  if (!view.follow) {
    steps.push({ step: 'camera', ok: await flyTo(viewer, view.camera) });
    return steps;
  }
  // A followed entity owns the camera, and a camera flight would end the
  // follow, so fly to the view only while the entity is not there yet. It
  // appears once its layer has data; retry until then.
  const layerId = FOLLOW_LAYERS[view.follow.kind];
  const follow = async () => {
    try {
      return (
        (await run('track_entity', { query: view.follow.id, layerId }))?.ok ===
        true
      );
    } catch {
      return false;
    }
  };
  let followed = await follow();
  if (!followed) {
    steps.push({ step: 'camera', ok: await flyTo(viewer, view.camera) });
    for (let attempt = 1; attempt < FOLLOW_ATTEMPTS && !followed; attempt++) {
      if (signal?.aborted) break;
      await delay(retryMs, signal);
      followed = await follow();
    }
  }
  steps.push({ step: 'follow', ok: followed });
  if (followed && view.follow.cockpit)
    await act('control_cockpit', { action: 'enter', targetLayer: layerId });
  return steps;
}

/**
 * Install embed mode when the page asks for it, and draw any annotations the
 * opening link carries. Returns a function that removes the message handler.
 */
export function installViews({
  shell,
  viewer,
  dataManager,
  run,
  signal,
  location = globalThis.location,
  windowRef = globalThis.window,
}) {
  const ready = Promise.resolve(shell.initialRestorePromise).catch(() => {});
  const linked = annotationsFromParams(
    new URLSearchParams(String(location?.hash || '').replace(/^#/, '')),
  );
  if (linked.length)
    void ready.then(() => {
      if (!signal?.aborted) void run('annotate_map', { annotations: linked });
    });
  if (!isEmbedded(location)) return () => {};

  windowRef.document.body.classList.add('ui-embed');
  shell.setCleanView?.(true);
  // Clyra frames the globe with `theme=light`: the planet floats on a soft light backdrop instead of a starfield,
  // matching the light app around it.
  if (new URLSearchParams(location?.search || '').get('theme') === 'light') {
    windowRef.document.body.classList.add('ui-light');
    const scene = viewer.scene;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#eef1f5');
    if (scene.skyAtmosphere) scene.skyAtmosphere.brightnessShift = 0.15;
    scene.requestRender?.();
  }
  const stopRendering = isEmbeddedInline()
    ? keepPanelRendering(viewer, { windowRef })
    : () => {};
  // A framing page talks to the app across frames; an inline panel shares
  // the page with it and talks through the page's own window.
  const peer = isEmbeddedInline() ? windowRef : windowRef.parent;
  // Answers go back only to the origin that asked. An inline panel posts to
  // its own window, and a sandboxed framing page has no origin to name.
  const post = (message, origin = '*') => {
    if (peer && (peer !== windowRef || isEmbeddedInline()))
      peer.postMessage(message, origin);
  };
  // Views apply one at a time, in the order they arrive.
  let queue = ready;
  /* Clyra's controls around the globe: toggle one layer, zoom, and hear where the camera is (so its assistant can
     answer "what's here?"). Same parent-only rule as views. */
  const enabledLayers = () => (dataManager?.getAll?.() || []).filter((layer) => layer.enabled).map((layer) => layer.id);
  const reportCamera = () => {
    const carto = viewer.camera?.positionCartographic;
    if (!carto) return;
    post({
      type: 'clyra:camera',
      camera: {
        lat: Cesium.Math.toDegrees(carto.latitude),
        lon: Cesium.Math.toDegrees(carto.longitude),
        altitude_m: Math.round(carto.height),
      },
      layers: enabledLayers(),
    });
  };
  const removeMoveEnd = viewer.camera?.moveEnd?.addEventListener?.(reportCamera);
  const onClyraMessage = async (data) => {
    if (data.type === 'clyra:layer' && typeof data.layerId === 'string') {
      try { await run('set_layer_visibility', { layerId: data.layerId, enabled: Boolean(data.enabled) }); } catch { /* reported below */ }
      post({ type: 'clyra:layers', layers: enabledLayers() });
      return true;
    }
    if (data.type === 'clyra:zoom') {
      const height = viewer.camera.positionCartographic?.height || 1_000_000;
      if (data.direction === 'in') viewer.camera.zoomIn(height * 0.45);
      else viewer.camera.zoomOut(height * 0.8);
      return true;
    }
    if (data.type === 'clyra:report') { reportCamera(); return true; }
    return false;
  };
  const onMessage = (event) => {
    if (event.source === peer && typeof event.data?.type === 'string' && event.data.type.startsWith('clyra:')) {
      void onClyraMessage(event.data);
      return;
    }
    if (event.source !== peer || event.data?.type !== EMBED_VIEW_MESSAGE)
      return;
    const { id = null } = event.data;
    const replyOrigin =
      isEmbeddedInline() || !event.origin || event.origin === 'null'
        ? '*'
        : event.origin;
    let view;
    try {
      view = createView(event.data.view);
    } catch (error) {
      post(
        {
          type: EMBED_APPLIED_MESSAGE,
          id,
          ok: false,
          error: error.message,
        },
        replyOrigin,
      );
      return;
    }
    queue = queue.then(async () => {
      if (signal?.aborted) return;
      const steps = await applyView(view, { viewer, dataManager, run, signal });
      post(
        {
          type: EMBED_APPLIED_MESSAGE,
          id,
          ok: steps.every((step) => step.ok),
          steps,
        },
        replyOrigin,
      );
    });
  };
  windowRef.addEventListener('message', onMessage);
  void ready.then(() => {
    if (!signal?.aborted) { post({ type: EMBED_READY_MESSAGE }); reportCamera(); }
  });
  return () => {
    stopRendering();
    removeMoveEnd?.();
    windowRef.removeEventListener('message', onMessage);
  };
}
