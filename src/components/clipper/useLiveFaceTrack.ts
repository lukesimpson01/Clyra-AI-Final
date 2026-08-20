/**
 * Live face tracking for the clipper preview.
 *
 * Uses MediaPipe Tasks Face Detector (BlazeFace, Apache-2.0 / open source)
 * via CDN so we stay in lock-step with the Python pipeline detector, then
 * applies a high-responsiveness exponential smoother so nods and pans
 * follow with essentially no perceptible lag.
 *
 * When a `referenceThumbnailUrl` is supplied (the person chosen in the
 * Select Face step before rendering — see `clipper_face_tracking.py`'s
 * `person_*` clustering / `selectedPersonId`), the detector also computes a
 * lightweight colour signature for each candidate face and prefers whichever
 * one matches that reference. This mirrors the backend's "lightweight RGB
 * histogram, no embeddings" person-matching approach (8GB-safe) so the live
 * preview and the final render track the same person instead of the preview
 * always following whichever face happens to be biggest on screen.
 */
import { useEffect, useRef, useState } from "react";
import { lowMemoryVideoMode, SmartCameraSolver } from "../../lib/clipper/smart-camera";

export type FaceTrackPoint = {
  /** 0–100 object-position X (face centre). */
  x: number;
  /** 0–100 object-position Y (face centre, slight headroom). */
  y: number;
  /** Zoom factor for vertical 9:16 framing. */
  zoom: number;
  confidence: number;
  /** True when this frame's tracked face matched the reference identity. */
  identityMatched?: boolean;
  /** Total faces seen in the current frame (for a "N people" indicator). */
  faceCount?: number;
};

type Detector = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { detections: Array<{ boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: Array<{ score?: number }> }> };
  close: () => void;
};

const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const HEADROOM = 0.18;
const DEFAULT_ZOOM = 1.55;

// A coarse colour grid is enough to tell "the person we picked" apart from
// someone else in frame without pulling in an embedding model — the same
// 8GB-safe stance the Python pipeline takes for its person clustering.
const SIGNATURE_GRID = 4;
const IDENTITY_MIN_SIMILARITY = 0.45;
type IdentitySignature = Float32Array;

function signatureFromImageData(data: Uint8ClampedArray): IdentitySignature {
  const signature = new Float32Array((data.length / 4) * 3);
  let out = 0;
  for (let i = 0; i < data.length; i += 4) {
    signature[out++] = data[i] / 255;
    signature[out++] = data[i + 1] / 255;
    signature[out++] = data[i + 2] / 255;
  }
  return signature;
}

function signatureSimilarity(a: IdentitySignature, b: IdentitySignature): number {
  if (a.length !== b.length || !a.length) return 0;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
  return Math.max(0, 1 - (diff / a.length) * 1.7);
}

/** Reduces the selected person's reference thumbnail to a colour signature. */
async function loadReferenceSignature(url: string): Promise<IdentitySignature | null> {
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("reference thumbnail failed to load"));
    });
    image.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = SIGNATURE_GRID;
    canvas.height = SIGNATURE_GRID;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, SIGNATURE_GRID, SIGNATURE_GRID);
    return signatureFromImageData(ctx.getImageData(0, 0, SIGNATURE_GRID, SIGNATURE_GRID).data);
  } catch {
    return null;
  }
}

let detectorPromise: Promise<Detector | null> | null = null;

async function loadDetector(): Promise<Detector | null> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    try {
      const vision = await import(
        /* @vite-ignore */
        // @ts-expect-error MediaPipe Tasks is loaded from CDN at runtime
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm"
      );
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_CDN);
      const detector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_CDN, delegate: "GPU" },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.45,
      });
      return detector as Detector;
    } catch (error) {
      console.warn("[clyra] Face detector unavailable", error);
      return null;
    }
  })();
  return detectorPromise;
}

type FaceBox = { originX: number; originY: number; width: number; height: number };
type IdentityContext = {
  reference: IdentitySignature;
  sample: (box: FaceBox) => IdentitySignature | null;
};

function pickBest(
  detections: Array<{
    boundingBox?: FaceBox;
    categories?: Array<{ score?: number }>;
  }>,
  videoW: number,
  videoH: number,
  previous: FaceTrackPoint | null,
  identity?: IdentityContext,
): FaceTrackPoint | null {
  let best: FaceTrackPoint | null = null;
  let bestRank = 0;
  let bestIdentityMatched = false;
  let faceCount = 0;
  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) continue;
    faceCount += 1;
    const score = detection.categories?.[0]?.score ?? 0.5;
    const area = (box.width / videoW) * (box.height / videoH);
    const cx = (box.originX + box.width / 2) / videoW;
    const cy = (box.originY + box.height * (0.5 - HEADROOM)) / videoH;
    const distance = previous ? Math.hypot(cx * 100 - previous.x, cy * 100 - previous.y) / 100 : 0;
    // Once a subject is acquired, continuity beats a momentarily larger face.
    let rank = score * (0.35 + area) - Math.min(0.42, distance * 0.82);
    let identityMatched = false;
    if (identity) {
      const sample = identity.sample(box);
      if (sample) {
        const similarity = signatureSimilarity(sample, identity.reference);
        if (similarity >= IDENTITY_MIN_SIMILARITY) {
          // Favour the selected person over a bigger/closer face. This is an
          // additive boost rather than a penalty on non-matches: a coarse
          // colour signature from a live 8fps proxy can be inconclusive, and
          // an inconclusive read should never cost tracking altogether — it
          // just falls back to the existing size/continuity heuristic below.
          rank += similarity * 1.8;
          identityMatched = true;
        }
      }
    }
    if (rank <= bestRank) continue;
    bestRank = rank;
    bestIdentityMatched = identityMatched;
    // Tighter crop when the face is small so the subject stays dominant.
    const faceFrac = Math.max(box.width / videoW, box.height / videoH);
    const zoom = Math.min(2.4, Math.max(1.25, DEFAULT_ZOOM * (0.22 / Math.max(0.08, faceFrac))));
    best = {
      x: Math.min(100, Math.max(0, cx * 100)),
      y: Math.min(100, Math.max(0, cy * 100)),
      zoom,
      confidence: score,
    };
  }
  if (best) {
    best.faceCount = faceCount;
    if (identity) best.identityMatched = bestIdentityMatched;
  }
  return best;
}

/**
 * When `enabled`, continuously detects the dominant face in `video` and
 * returns a smoothed crop centre suitable for CSS object-position / scale.
 */
export function useLiveFaceTrack(
  video: HTMLVideoElement | null,
  enabled: boolean,
  /** Thumbnail of the person chosen in Select Face, before generation. */
  referenceThumbnailUrl?: string | null,
): FaceTrackPoint | null {
  const [point, setPoint] = useState<FaceTrackPoint | null>(null);
  const smoothRef = useRef<FaceTrackPoint | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(-1);
  const lastDetectionAtRef = useRef(0);
  const solverRef = useRef(new SmartCameraSolver());
  const intervalRef = useRef(lowMemoryVideoMode() ? 170 : 125);
  const referenceSignatureRef = useRef<IdentitySignature | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const identitySamplingDisabledRef = useRef(false);

  // Reduce the selected person's thumbnail to a colour signature whenever it
  // changes. Read via a ref inside the detection loop below so switching the
  // selected person never has to restart (and re-warm) the detector itself.
  useEffect(() => {
    referenceSignatureRef.current = null;
    identitySamplingDisabledRef.current = false;
    if (!referenceThumbnailUrl) return;
    let cancelled = false;
    void loadReferenceSignature(referenceThumbnailUrl).then((signature) => {
      if (!cancelled) referenceSignatureRef.current = signature;
    });
    return () => {
      cancelled = true;
    };
  }, [referenceThumbnailUrl]);

  useEffect(() => {
    if (!enabled || !video) {
      smoothRef.current = null;
      solverRef.current.reset();
      setPoint(null);
      if (rafRef.current != null) {
        video?.cancelVideoFrameCallback?.(rafRef.current as never);
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    let cancelled = false;
    let detector: Detector | null = null;

    // Crops a candidate face out of the current video frame and reduces it
    // to the same coarse colour signature used for the reference thumbnail.
    // Wrapped defensively: a cross-origin video source would throw on
    // getImageData, in which case identity matching quietly turns itself
    // off and tracking falls back to the existing size/continuity ranking.
    const sampleIdentity = (box: FaceBox): IdentitySignature | null => {
      if (identitySamplingDisabledRef.current || !video) return null;
      try {
        let canvas = sampleCanvasRef.current;
        if (!canvas) {
          canvas = document.createElement("canvas");
          canvas.width = SIGNATURE_GRID;
          canvas.height = SIGNATURE_GRID;
          sampleCanvasRef.current = canvas;
        }
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        const videoW = video.videoWidth || 0;
        const videoH = video.videoHeight || 0;
        const sx = Math.max(0, Math.min(box.originX, videoW - 1));
        const sy = Math.max(0, Math.min(box.originY, videoH - 1));
        const sw = Math.max(0, Math.min(box.width, videoW - sx));
        const sh = Math.max(0, Math.min(box.height, videoH - sy));
        if (sw < 2 || sh < 2) return null;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SIGNATURE_GRID, SIGNATURE_GRID);
        return signatureFromImageData(ctx.getImageData(0, 0, SIGNATURE_GRID, SIGNATURE_GRID).data);
      } catch {
        identitySamplingDisabledRef.current = true;
        return null;
      }
    };

    const tick = (now: number) => {
      if (cancelled || !video || video.readyState < 2) {
        schedule();
        return;
      }
      // Skip duplicate timestamps from rVFC when paused.
      if (now === lastTsRef.current && !video.paused) {
        schedule();
        return;
      }
      lastTsRef.current = now;
      if (now - lastDetectionAtRef.current < intervalRef.current) {
        schedule();
        return;
      }
      lastDetectionAtRef.current = now;
      try {
        if (detector) {
          const result = detector.detectForVideo(video, performance.now());
          const referenceSignature = referenceSignatureRef.current;
          const identity: IdentityContext | undefined = referenceSignature
            ? { reference: referenceSignature, sample: sampleIdentity }
            : undefined;
          const next = pickBest(result.detections || [], video.videoWidth || 1, video.videoHeight || 1, smoothRef.current, identity);
          if (next) {
            const prev = smoothRef.current;
            const movement = prev ? Math.hypot(next.x - prev.x, next.y - prev.y) : 0;
            // Stable shots spend less compute on repeated detections. Fast
            // movement or uncertain observations temporarily increases cadence.
            intervalRef.current = lowMemoryVideoMode()
              ? movement > 7 || next.confidence < 0.6 ? 105 : 180
              : movement > 7 || next.confidence < 0.6 ? 68 : movement < 1.4 ? 175 : 112;
            const solved = solverRef.current.update({ ...next, timestampMs: now });
            const smoothed: FaceTrackPoint = {
              x: solved.x,
              y: solved.y,
              zoom: solved.zoom,
              confidence: solved.confidence,
              identityMatched: next.identityMatched,
              faceCount: next.faceCount,
            };
            smoothRef.current = smoothed;
            setPoint(smoothed);
          } else {
            // Confidence loss asks the detector to reacquire promptly without
            // moving the existing virtual camera to an unrelated target.
            intervalRef.current = lowMemoryVideoMode() ? 110 : 70;
          }
        }
      } catch {
        /* transient decode glitches ignored */
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        rafRef.current = video.requestVideoFrameCallback((ts) => tick(ts)) as unknown as number;
      } else {
        rafRef.current = requestAnimationFrame(() => tick(performance.now()));
      }
    };

    void loadDetector().then((loaded) => {
      if (cancelled) return;
      detector = loaded;
      schedule();
    });

    return () => {
      cancelled = true;
      if (rafRef.current != null) {
        video.cancelVideoFrameCallback?.(rafRef.current as never);
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [video, enabled]);

  return point;
}
