import { useCallback, useEffect, useRef, useState } from "react";
import { getElectronDesktop } from "../../lib/electron-runtime";

export type VoiceMediaMode = "camera" | "screen";
export type VoiceMediaSnapshot = { mode: VoiceMediaMode; image: string; width?: number; height?: number };

type Props = {
  mode: VoiceMediaMode;
  lowPower: boolean;
  onStop: () => void;
  onCaptureChange?: (capture: (() => VoiceMediaSnapshot | null) | null) => void;
  onAsk?: () => void;
  /** X-ray mirror camera filter (camera mode only). */
  xray?: boolean;
  screenRequest?: Promise<MediaStream> | null;
};

export function VoiceMediaSurface({ mode, onStop, onCaptureChange, xray = false, screenRequest }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const retryScreenRequestRef = useRef<Promise<MediaStream> | null>(null);
  const retryCapture = () => {
    // Retry also begins with an actual user click so screen permission works.
    if (mode === "screen") {
      try {
        retryScreenRequestRef.current = navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 15, max: 20 } }, audio: false,
        });
        void retryScreenRequestRef.current.catch(() => undefined);
      } catch (cause) {
        retryScreenRequestRef.current = Promise.reject(cause);
        void retryScreenRequestRef.current.catch(() => undefined);
      }
    }
    setRetry((n) => n + 1);
  };
  // Encode only one <=960px JPEG on an explicit request. The live stream
  // otherwise stays entirely on the user's machine.
  const captureFrame = useCallback((): VoiceMediaSnapshot | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { mode, image: canvas.toDataURL("image/jpeg", 0.76), width: canvas.width, height: canvas.height };
  }, [mode]);
  useEffect(() => {
    onCaptureChange?.(captureFrame);
    return () => onCaptureChange?.(null);
  }, [captureFrame, onCaptureChange]);

  // Camera and capture are acquired only when requested and always released
  // when the mode changes, the call ends, or the track is stopped externally.
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current;
    setReady(false);
    setError("");
    const start = async () => {
      try {
        if (!navigator.mediaDevices) throw new Error("Media capture is unavailable in this window.");
        // Not allowed yet: macOS's own pop-up first, then System Settings opens on the right page.
        const desktop = getElectronDesktop()?.dictation;
        // Screen goes through macOS's own picker, which needs no Screen Recording entry; only the camera needs its permission.
        const access = mode === "camera" ? await desktop?.ensureCamera?.().catch(() => null) : null;
        if (access && access.ok === false) throw new Error(access.error || (mode === "camera" ? "Camera access is off. Turn it on in System Settings (opened for you), then try again." : "Screen recording is off. Turn it on in System Settings (opened for you), then restart Clyra."));
        const capture = mode === "camera"
          ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } }, audio: false })
          : await (retry > 0 ? retryScreenRequestRef.current : screenRequest) ?? (() => { throw new Error("Please select your screen using the Screen button."); })();
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
        // Playback can fail *after* permission succeeded. Release every track
        // rather than leaving a lit camera indicator behind an error surface.
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (video) { video.pause(); video.srcObject = null; }
        if (mode === "camera" && cause instanceof Error && cause.name === "NotAllowedError") void getElectronDesktop()?.dictation?.openCameraSettings?.();
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to open the camera.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      if (video) { video.pause(); video.srcObject = null; }
    };
  }, [mode, retry, screenRequest]);

  return (
    <section className="clyra-voice-media" aria-label={mode === "camera" ? "Live camera preview" : "Screen share preview"}>
      <div className={"clyra-voice-media__viewport" + (mode === "camera" ? " clyra-voice-media__viewport--mirror" : "")}>
        <video ref={videoRef} autoPlay playsInline muted aria-label={mode === "camera" ? "Your camera" : "Your shared screen"} />
        {mode === "camera" && xray && ready ? (
          <iframe className="clyra-voice-media__xray" src="/xray-mirror/index.html#embed" title="X-ray mirror filter" allow="camera" />
        ) : null}
        {!ready && !error ? <p className="clyra-voice-media__message">Waiting for {mode === "camera" ? "camera" : "screen"} permission…</p> : null}
        {error ? (
          <div className="clyra-voice-media__recovery" role="alert">
            <p className="clyra-voice-media__message">{error}</p>
            <button type="button" onClick={retryCapture}>Try again</button>
          </div>
        ) : null}
      </div>
      <p className="clyra-voice-media__privacy">
        {mode === "camera" && xray
          ? "X-ray filter is an anatomy illustration pinned to your head, not a medical scan. Video stays local."
          : "Video stays local; one frame is shared only if you ask Clyra to inspect it."}
      </p>
    </section>
  );
}
