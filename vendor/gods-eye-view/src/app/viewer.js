import * as Cesium from 'cesium';

/** Create the standard globe viewer in caller-owned, visible containers. */
export function createApplicationViewer({ container, creditContainer }) {
  if (!container || !creditContainer)
    throw new TypeError('Viewer and credit containers are required');
  const deviceMemory = Number(window.navigator?.deviceMemory);
  const memoryConstrained = Number.isFinite(deviceMemory) && deviceMemory <= 4;
  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    // Four-sample MSAA plus a permanently preserved back buffer is expensive
    // on Retina and integrated GPUs, particularly while dragging near street
    // level. Two samples retain clean route and label edges while leaving the
    // browser room to keep direct camera input responsive.
    msaaSamples: memoryConstrained ? 1 : 2,
    contextOptions: { webgl: { preserveDrawingBuffer: false } },
  });
  try {
    viewer.targetFrameRate = 60;
    // Do not render a 2× or 3× canvas just because the surrounding product is
    // on a high-density display. Road tiles already carry their own label
    // detail; a 1.3× ceiling keeps direct drag and wheel zoom responsive on
    // integrated GPUs while preserving crisp route edges at normal window
    // sizes. Normal-memory machines get a little more backing resolution at
    // oblique street level; 4 GB machines deliberately stay at 1×.
    viewer.resolutionScale = memoryConstrained
      ? 1
      : Math.min(window.devicePixelRatio || 1, 1.5);
    // Keep the globe a direct-manipulation surface. Be explicit about every
    // primary controller rather than relying on Cesium defaults: a previous
    // mode can otherwise leave a new Earth session looking alive while drag or
    // wheel input has been silently disabled. Cockpit and tracked-entity modes
    // may still take ownership later, but the normal globe always starts free.
    const cameraControls = viewer.scene.screenSpaceCameraController;
    cameraControls.enableInputs = true;
    cameraControls.enableRotate = true;
    cameraControls.enableTranslate = true;
    cameraControls.enableZoom = true;
    cameraControls.enableTilt = true;
    cameraControls.enableLook = true;
    cameraControls.inertiaSpin = 0.84;
    cameraControls.inertiaZoom = 0.78;
    cameraControls.inertiaTranslate = 0.82;
    // Let the canvas, rather than the containing workspace, own pinch and
    // drag gestures. This preserves one-to-one panning on touch devices and
    // keeps trackpad scrolling mapped to Cesium's continuous wheel zoom.
    const canvas = viewer.scene.canvas;
    canvas.style.touchAction = 'none';
    canvas.style.overscrollBehavior = 'contain';
    canvas.style.userSelect = 'none';
    canvas.style.cursor = 'grab';
    canvas.setAttribute('aria-label', 'Interactive Earth. Drag to pan and scroll to zoom.');

    // Cesium owns the actual camera gesture. These passive listeners only make
    // the physical state immediately legible; they never cancel, synthesize or
    // compete with its pointer events. A visible grab/grabbing transition is
    // especially useful in the embedded Clyra workspace where the canvas has
    // no stock Cesium controls around it.
    const showGrabbing = (event) => {
      if (event.pointerType !== 'mouse' || event.button === 0) canvas.style.cursor = 'grabbing';
    };
    const showGrab = () => { canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerdown', showGrabbing, { passive: true });
    canvas.addEventListener('pointerup', showGrab, { passive: true });
    canvas.addEventListener('pointercancel', showGrab, { passive: true });
    canvas.addEventListener('lostpointercapture', showGrab, { passive: true });
    viewer.scene.globe.show = false;
    // This is the colour visible while a new road tile is arriving.  It makes
    // map motion read as one calm, warm surface rather than flashing Cesium's
    // default dark globe between raster requests.
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#edf1ec');
    viewer.scene.globe.tileCacheSize = memoryConstrained ? 96 : 160;
    // Clyra's whole-Earth opening should read like a calm spatial workspace,
    // not a tactical space scene. The map remains untouched; only the empty
    // canvas around it uses the same warm neutral as the product surface.
    viewer.scene.skyBox.show = false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#edf1ec');
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.atmosphereLightIntensity = 18;
    viewer.scene.skyAtmosphere.saturationShift = -0.18;
    viewer.scene.skyAtmosphere.brightnessShift = -0.04;
    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
