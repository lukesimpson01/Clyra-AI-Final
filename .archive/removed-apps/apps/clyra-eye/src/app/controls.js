import { catalogControlServices } from './catalog.js';
import { StyleManager } from '../ui/composition.js';
import { startClyraEyeIntro } from '../camera.js';
import { clyraEyeStartupReadiness } from './startupReadiness.js';
import { createCurrentLocationCallout } from './currentLocation.js';
import { getWorldOverlayDiagnostics } from '../overlays/worldOverlay.js';
import { initCockpitCloudEffects } from '../cockpitCloudEffects.js';

/** Construct the existing controls and camera presentation. */
export function createApplicationControls({
  scene: { viewer, mapStackController, operations },
  loaderStatus,
  Controls = StyleManager,
  services,
  catalog,
  placeSearch,
  defer,
}) {
  // Initialize the style manager (post-processing, HUD, locations, share links)
  const styleManager = new Controls(viewer, {
    services: {
      ...services,
      ...operations.surface.controlServices,
      searchAndFlyTo: operations.searchAndFlyTo,
      fetchRegionalBrief: (...args) =>
        operations.requests.regional.getBrief(...args),
      ...catalogControlServices(catalog),
    },
    requestServices: operations.requests,
    mapStackController,
    placeSearch,
  });
  defer(() => styleManager.orbitController.stop());
  defer(() => styleManager.hud.destroy());
  defer(() => styleManager.dispose());
  // The previous multi-canvas weather compositor remains disabled. Cockpit
  // clouds use a separate, capped low-resolution GPU pass that never attaches
  // Cesium fog or post-process stages and is fully stopped in map mode.
  const weatherEffects = null;
  const cockpitCloudEffects = initCockpitCloudEffects(viewer, {
    weatherService: operations.requests.weather,
  });
  defer(() => cockpitCloudEffects?.destroy());

  // If no share link state, do default fly-to Austin
  if (!styleManager.hasShareState) {
    // Launch starts with nothing enabled: drop any layer state saved by earlier
    // sessions so that only the launch sequence decides what turns on.
    try {
      localStorage.removeItem('gev:layer-state:v2');
    } catch {
      // Storage can be unavailable; the intro still runs.
    }
    // The HUD panels stay hidden until the launch sequence reaches full Earth.
    document.body.classList.add('eye-intro');
    const currentLocation = createCurrentLocationCallout();
    // Read by the desktop smoke test: which overlay sources were actually painted.
    window.__clyraEyeOverlayDiagnostics = getWorldOverlayDiagnostics;
    defer(
      startClyraEyeIntro(viewer, {
        readiness: clyraEyeStartupReadiness,
        onStatus: (text) => {
          loaderStatus.textContent = text;
        },
        onState: (state) => {
          // Read by the desktop smoke test and by the AI's launch-state context.
          window.__clyraEyeIntro = { ...state, readiness: clyraEyeStartupReadiness.snapshot() };
        },
        showCurrentLocation: (fix) => currentLocation.show(fix),
        clearCurrentLocation: () => currentLocation.clear(),
        onSettled: () => {
          document.body.classList.remove('eye-intro');
          window.dispatchEvent(new Event('clyra-eye:intro-settled'));
        },
      }),
    );
  } else {
    loaderStatus.textContent = 'Restoring shared view...';
  }

  return { styleManager, weatherEffects, cockpitCloudEffects };
}
