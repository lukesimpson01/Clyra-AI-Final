import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Application, BlurFilter, Graphics } from "pixi.js";

/** Energy follow rates. Attack is fast so a voice reads as immediate;
 * release is slow so the surface keeps moving between syllables. */
const ATTACK = 16;
const RELEASE = 3.4;

/** Back-to-front wave layers. Deeper layers sit higher, blur more and move
 * slower; the crest is brighter, tighter and quicker. */
const LAYERS = [
  { color: 0x2a4bd0, alpha: 0.5, blur: 30, amp: 30, speed: 0.62, offset: 0, rest: 0.66, lift: 0.1, blend: "screen" as const },
  { color: 0x4c8dff, alpha: 0.46, blur: 18, amp: 24, speed: 1, offset: 2.1, rest: 0.7, lift: 0.15, blend: "screen" as const },
  { color: 0x8fd0ff, alpha: 0.34, blur: 10, amp: 17, speed: 1.45, offset: 4.3, rest: 0.75, lift: 0.2, blend: "screen" as const },
];

export type VoiceFluidHandle = {
  /** 0-1 smoothed audio energy. Imperative so a 60fps mic/TTS analyser loop
   * never triggers a React re-render. */
  setEnergy: (energy: number) => void;
};

/**
 * Audio-reactive blue fluid field, GPU-rendered via Pixi (WebGL). Height,
 * displacement, and luminosity all derive from `setEnergy()`, driven by the
 * hook's real local/remote WebRTC audio-level events -- never from text
 * length or a timer.
 */
export const VoiceFluidField = forwardRef<VoiceFluidHandle, { className?: string }>(
  function VoiceFluidField({ className }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const energyRef = useRef(0);
    const displayEnergyRef = useRef(0);
    const phaseRef = useRef(0);

    useImperativeHandle(ref, () => ({
      setEnergy: (energy: number) => {
        energyRef.current = Math.max(0, Math.min(1, energy));
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      // React StrictMode double-invokes this effect in dev; a generation
      // token lets a stale init's continuation recognize it's been
      // superseded instead of racing the real instance's teardown. Pixi's
      // resize plugin (`resizeTo`) doesn't tolerate init/destroy overlap
      // well, so sizing is handled manually via ResizeObserver instead.
      let live = true;
      let destroyed = false;
      const app = new Application();
      // Three stacked wave layers instead of one flat band: a deep, heavily
      // blurred bed for glow, a mid body carrying most of the motion, and a
      // brighter crest on top. Different speeds and phase offsets keep them
      // from ever moving as one rigid shape.
      const layers = LAYERS.map((layer) => {
        const graphic = new Graphics();
        graphic.filters = [new BlurFilter({ strength: layer.blur, quality: 3 })];
        graphic.blendMode = "screen";
        return { ...layer, graphic };
      });
      let resizeObserver: ResizeObserver | null = null;

      const destroyOnce = () => {
        if (destroyed) return;
        destroyed = true;
        app.destroy(true, { children: true });
      };

      const initPromise = app
        .init({
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
        })
        .then(() => {
          if (!live) {
            destroyOnce();
            return;
          }
          host.appendChild(app.canvas);
          layers.forEach((layer) => app.stage.addChild(layer.graphic));

          resizeObserver = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) app.renderer.resize(width, height);
          });
          resizeObserver.observe(host);

          app.ticker.add((ticker) => {
            const dt = Math.min(ticker.deltaTime / 60, 0.05);
            // Asymmetric follow: rise almost immediately on a new sample so
            // speech reads as instant, then fall away slowly so the surface
            // keeps settling instead of snapping flat between syllables.
            const target = energyRef.current;
            const current = displayEnergyRef.current;
            const rate = target > current ? ATTACK : RELEASE;
            displayEnergyRef.current = current + (target - current) * Math.min(1, dt * rate);
            phaseRef.current += dt * (0.55 + displayEnergyRef.current * 2.1);

            const { width, height } = app.renderer;
            const energy = displayEnergyRef.current;
            const phase = phaseRef.current;
            const points = 48;

            for (const layer of layers) {
              const graphic = layer.graphic;
              // Each layer sits a little lower and swells a little more than
              // the one behind it, so louder audio opens a sense of depth
              // rather than just making one band taller.
              const baseline = height * (layer.rest - energy * layer.lift);
              // Keeps a visible swell at rest so an idle call still breathes
              // rather than flattening into a static band.
              const amplitude = layer.amp * (0.58 + energy * 1.3);
              const layerPhase = phase * layer.speed + layer.offset;

              graphic.clear();
              graphic.moveTo(0, height);
              for (let i = 0; i <= points; i++) {
                const x = (width / points) * i;
                // Three incommensurate harmonics: the surface never repeats
                // on a visible loop the way a single sine does.
                const wave =
                  Math.sin(layerPhase + i * 0.31) * amplitude +
                  Math.sin(layerPhase * 1.63 + i * 0.17) * amplitude * 0.42 +
                  Math.sin(layerPhase * 0.47 + i * 0.09) * amplitude * 0.28;
                graphic.lineTo(x, baseline + wave);
              }
              graphic.lineTo(width, height);
              graphic.closePath();
              graphic.fill({ color: layer.color, alpha: layer.alpha * (0.78 + energy * 0.45) });
            }
          });
        })
        .catch(() => undefined);

      return () => {
        live = false;
        resizeObserver?.disconnect();
        void initPromise.then(destroyOnce);
      };
    }, []);

    return <div ref={hostRef} className={className} />;
  },
);
