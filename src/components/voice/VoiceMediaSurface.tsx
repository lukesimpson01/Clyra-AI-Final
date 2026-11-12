import { useEffect, useRef, useState } from "react";
import { ScanLine, X, Zap } from "lucide-react";

export type VoiceMediaMode = "camera" | "screen";

type Landmark = { x: number; y: number; z: number; visibility?: number };
type PoseResult = { poseLandmarks?: Landmark[]; poseWorldLandmarks?: Landmark[] };
type PoseEngine = {
  setOptions: (options: Record<string, number | boolean>) => void;
  onResults: (listener: (result: PoseResult) => void) => void;
  send: (value: { image: HTMLVideoElement }) => Promise<void>;
  close: () => Promise<void> | void;
};
type PoseCtor = new (options: { locateFile: (file: string) => string }) => PoseEngine;

const POSE_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/";
let sharedPoseScript: Promise<void> | null = null;

function loadPose(): Promise<PoseCtor> {
  const getPose = () => (window as Window & { Pose?: PoseCtor }).Pose;
  if (getPose()) return Promise.resolve(getPose()!);
  if (!sharedPoseScript) {
    sharedPoseScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = POSE_BASE + "pose.js";
      script.async = true;
      script.onload = () => getPose() ? resolve() : reject(new Error("The pose engine was not initialized."));
      script.onerror = () => reject(new Error("The pose engine could not load. Check the connection."));
      document.head.append(script);
    }).catch((error) => {
      sharedPoseScript = null;
      throw error;
    });
  }
  return sharedPoseScript.then(() => {
    const ctor = getPose();
    if (!ctor) throw new Error("The pose engine is unavailable.");
    return ctor;
  });
}

// Original, low-cost anatomy-style visualization. Depth changes stroke
// opacity; this is a pose estimate, not a medical X-ray or volumetric scan.
const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  [0, 2], [2, 5], [5, 0], [0, 1], [1, 4], [4, 0],
];

function renderPose(canvas: HTMLCanvasElement, result: PoseResult) {
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const joints = result.poseLandmarks;
  if (!joints?.length) return;

  const world = result.poseWorldLandmarks;
  const visible = (point: Landmark | undefined) => point && (point.visibility ?? 1) >= 0.45;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [a, b] of BONES) {
    if (!visible(joints[a]) || !visible(joints[b])) continue;
    const p = joints[a], q = joints[b];
    const depth = world ? Math.abs((world[a]?.z ?? 0) + (world[b]?.z ?? 0)) * 0.5 : 0;
    const opacity = Math.max(0.42, 0.9 - depth * 0.7);
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.strokeStyle = "rgba(53,135,255," + (opacity * 0.27).toFixed(3) + ")";
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = "rgba(233,247,255," + opacity.toFixed(3) + ")";
    ctx.lineWidth = 3.4;
    ctx.stroke();
  }
  for (const index of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) {
    if (!visible(joints[index])) continue;
    const p = joints[index];
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 3.7, 0, Math.PI * 2);
    ctx.fillStyle = "#effaff";
    ctx.fill();
    ctx.strokeStyle = "#438ff9";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

type Props = {
  mode: VoiceMediaMode;
  lowPower: boolean;
  onStop: () => void;
};

export function VoiceMediaSurface({ mode, lowPower, onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  const [ready, setReady] = useState(false);
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [scanMessage, setScanMessage] = useState("");
  const [error, setError] = useState("");

  // Camera and capture are acquired only when requested and always released
  // when the mode changes, the call ends, or the track is stopped externally.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    setReady(false);
    setError("");
    setScanMessage("");
    const start = async () => {
      try {
        if (!navigator.mediaDevices) throw new Error("Media capture is unavailable in this window.");
        const capture = mode === "camera"
          ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }, audio: false })
          : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 20 } }, audio: false });
        if (cancelled) { capture.getTracks().forEach((track) => track.stop()); return; }
        stream = capture;
        capture.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", () => onStopRef.current(), { once: true });
        });
        if (!video) throw new Error("No video surface is available.");
        video.srcObject = capture;
        await video.play();
        if (!cancelled) setReady(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to open the camera.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) { video.pause(); video.srcObject = null; }
    };
  }, [mode]);

  // Run MediaPipe only when the local X-ray mode is enabled. No processing
  // during screen share, background tabs, or after the component is closed.
  useEffect(() => {
    if (!ready || !filterEnabled || mode !== "camera") {
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let cancelled = false;
    let frame = 0;
    let sending = false;
    let lastFrame = 0;
    let engine: PoseEngine | null = null;
    setScanMessage("Loading 3D pose tracking…");

    void loadPose().then((Pose) => {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      engine = new Pose({ locateFile: (file) => POSE_BASE + file });
      engine.setOptions({
        modelComplexity: 0,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      engine.onResults((result) => {
        if (cancelled || !canvasRef.current) return;
        if (video.videoWidth && video.videoHeight && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        renderPose(canvas, result);
        setScanMessage((previous) => previous ? "" : previous);
      });
      const tick = (now: number) => {
        if (cancelled) return;
        frame = window.requestAnimationFrame(tick);
        if (document.hidden || sending || video.readyState < 2 || now - lastFrame < (lowPower ? 170 : 90)) return;
        lastFrame = now;
        sending = true;
        void engine?.send({ image: video }).catch(() => {
          if (!cancelled) setScanMessage("Pose tracking paused. Try again with better lighting.");
        }).finally(() => { sending = false; });
      };
      frame = window.requestAnimationFrame(tick);
    }).catch((cause) => {
      if (!cancelled) setScanMessage(cause instanceof Error ? cause.message : "Pose tracking is unavailable.");
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      void engine?.close();
      const canvas = canvasRef.current;
      canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [filterEnabled, lowPower, mode, ready]);

  return (
    <section className="clyra-voice-media" aria-label={mode === "camera" ? "Live camera preview" : "Screen share preview"}>
      <header className="clyra-voice-media__header">
        <span className="clyra-voice-media__title"><span className="clyra-voice-media__live" />{mode === "camera" ? "Camera" : "Screen share"}</span>
        <div className="clyra-voice-media__actions">
          {mode === "camera" ? (
            <button type="button" data-active={filterEnabled} aria-pressed={filterEnabled} onClick={() => setFilterEnabled((previous) => !previous)}>
              <ScanLine size={15} strokeWidth={1.8} /> 3D pose
            </button>
          ) : null}
          <button type="button" aria-label="Stop media sharing" title="Stop sharing" onClick={onStop}><X size={17} /></button>
        </div>
      </header>
      <div className={"clyra-voice-media__viewport" + (mode === "camera" ? " clyra-voice-media__viewport--mirror" : "")}>
        <video ref={videoRef} autoPlay playsInline muted aria-label={mode === "camera" ? "Your camera" : "Your shared screen"} />
        {mode === "camera" && filterEnabled && ready ? <canvas ref={canvasRef} aria-hidden="true" /> : null}
        {!ready && !error ? <p className="clyra-voice-media__message">Waiting for {mode === "camera" ? "camera" : "screen"} permission…</p> : null}
        {error ? <p className="clyra-voice-media__message" role="alert">{error}</p> : null}
        {scanMessage && ready ? <p className="clyra-voice-media__scan-message"><Zap size={12} />{scanMessage}</p> : null}
      </div>
      <p className="clyra-voice-media__privacy">
        {mode === "camera" && filterEnabled
          ? "Local 3D pose estimate — not a medical scan. Video is not sent to the assistant."
          : "Live local preview. Video is not sent to the assistant."}
      </p>
    </section>
  );
}
