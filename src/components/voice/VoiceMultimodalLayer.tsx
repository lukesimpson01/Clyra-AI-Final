import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Check, CircleStop, Mic2, Monitor, MousePointer2, X } from "lucide-react";
import { getElectronDesktop } from "../../lib/electron-runtime";
import { RollingVoiceFrames, setVoiceVisualMode, type VoiceVisualIntent, type VoiceVisualSource, type VoiceVisionFrame } from "../../voice/multimodal";
import type { VoiceCallHostCall } from "./VoiceCallHost";
import "./voice-multimodal.css";

type ShareSource = { id: string; name: string; thumbnail?: string };
type VisionReply = { ok: boolean; text: string; point?: { x: number; y: number; width: number; height: number; confidence: number } };
type Pointer = NonNullable<VisionReply["point"]>;

const wantsVisualAnswer = (text: string) => /\b(?:what|where|which|how|read|look at|can you see|point|show me|identify|help me|explain)\b/i.test(text);
const isLocalOrWebPreview = (value: string | undefined) => {
  if (!value) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) &&
      !(u.origin === window.location.origin && (u.pathname === "/" || u.pathname === "/index.html"));
  } catch { return false; }
};

/** Non-replacing, same-call visual layer. All actual audio and missions stay in useVoiceCall. */
export function VoiceMultimodalLayer({ call }: { call: VoiceCallHostCall }) {
  const [mode, setMode] = useState<"voice" | VoiceVisualSource>("voice");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [sources, setSources] = useState<ShareSource[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [pendingControl, setPendingControl] = useState("");
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const [taskImage, setTaskImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef({
    camera: new RollingVoiceFrames(),
    screen: new RollingVoiceFrames(),
  });
  const modeRef = useRef<"voice" | VoiceVisualSource>("voice");
  const contextRef = useRef("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inFlightRef = useRef(false);

  const updateMode = useCallback((next: "voice" | VoiceVisualSource) => {
    modeRef.current = next;
    setVoiceVisualMode(next);
    setMode(next);
    setPointer(null);
  }, []);

  const stopVisual = useCallback(() => {
    mediaRef.current?.getTracks().forEach(track => track.stop());
    mediaRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    bufferRef.current.camera.clear();
    bufferRef.current.screen.clear();
    setChoosing(false);
    setPendingQuestion("");
    setPendingControl("");
    setHint("");
    updateMode("voice");
    void getElectronDesktop()?.voice?.stopControl?.().catch(() => undefined);
  }, [updateMode]);

  useEffect(() => () => {
    mediaRef.current?.getTracks().forEach(track => track.stop());
    bufferRef.current.camera.clear();
    bufferRef.current.screen.clear();
    setVoiceVisualMode("voice");
    void getElectronDesktop()?.voice?.stopControl?.().catch(() => undefined);
  }, []);

  const beginStream = useCallback(async (source: VoiceVisualSource, stream: MediaStream) => {
    mediaRef.current?.getTracks().forEach(track => track.stop());
    bufferRef.current.camera.clear();
    bufferRef.current.screen.clear();
    mediaRef.current = stream;
    updateMode(source);
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    }
    const activeTrack = stream.getVideoTracks()[0];
    if (activeTrack) activeTrack.addEventListener("ended", () => {
      if (mediaRef.current === stream) {
        mediaRef.current = null;
        bufferRef.current[source].clear();
        updateMode("voice");
        setHint(source === "screen" ? "Screen sharing stopped." : "Camera disconnected.");
        void getElectronDesktop()?.voice?.stopControl?.().catch(() => undefined);
      }
    }, { once: true });
  }, [updateMode]);

  const startCamera = useCallback(async () => {
    setBusy(true);
    setHint("Requesting camera access…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera capture is unavailable in this desktop runtime.");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
        audio: false,
      });
      await beginStream("camera", stream);
      setHint("");
      return true;
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Camera permission was not granted.");
      return false;
    } finally { setBusy(false); }
  }, [beginStream]);

  const captureFrame = useCallback((source = modeRef.current): VoiceVisionFrame | null => {
    if (source === "voice" || modeRef.current !== source || !mediaRef.current) return null;
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return null;
    const width = Math.max(1, Math.round(Math.min(960, video.videoWidth)));
    const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d", { alpha: false })?.drawImage(video, 0, 0, width, height);
    const frame = { source, width, height, image: canvas.toDataURL("image/jpeg", 0.66), time: Date.now() };
    bufferRef.current[source].add(frame);
    return frame;
  }, []);

  useEffect(() => {
    if (mode === "voice") return;
    // The user is often working in another desktop window. Continue the
    // consented local rolling buffer while Clyra is in the background.
    // Use fewer frames on 4-core systems to keep the microphone responsive.
    const slowMachine = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4;
    const id = window.setInterval(() => {
      if (!inFlightRef.current) {
        inFlightRef.current = true;
        try { captureFrame(mode); } finally { inFlightRef.current = false; }
      }
    }, slowMachine ? 1350 : 900);
    return () => window.clearInterval(id);
  }, [mode, captureFrame]);

  useEffect(() => {
    const update = () => {
      const r = videoRef.current?.getBoundingClientRect();
      if (r) setPreviewSize({ width: Math.max(1, r.width), height: Math.max(1, r.height) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mode]);

  const waitForFrame = useCallback(async () => {
    for (let i = 0; i < 15; i++) {
      const frame = captureFrame();
      if (frame) return frame;
      await new Promise(resolve => window.setTimeout(resolve, 120));
    }
    return null;
  }, [captureFrame]);

  const inspect = useCallback(async (question: string, pointRequested = false) => {
    const source = modeRef.current;
    if (source === "voice") {
      call.respondVisual("Turn on the camera or share your screen first.");
      return;
    }
    setBusy(true);
    setHint("Analysing the recent frames…");
    try {
      const fresh = await waitForFrame();
      if (!fresh) {
        call.respondVisual("I couldn't capture a clear frame. Please try again.");
        return;
      }
      const frames = bufferRef.current[source].select(Date.now(), 4);
      const reply = await call.answerWithVision(question, frames);
      contextRef.current = reply.ok ? reply.text : contextRef.current;
      setPointer(pointRequested && reply.point && reply.point.confidence >= 0.75 ? reply.point : null);
      setHint(reply.ok ? "" : reply.text);
    } finally { setBusy(false); }
  }, [call, waitForFrame]);

  const listSources = useCallback(async (question = "") => {
    setPendingQuestion(question);
    setHint("");
    const desktop = getElectronDesktop();
    if (desktop?.voice?.listSources) {
      try {
        const result = await desktop.voice.listSources();
        if (!result.ok || !result.sources?.length) throw new Error(result.error || "No shareable windows or displays found.");
        setSources(result.sources);
        setChoosing(true);
      } catch (error) {
        setHint(error instanceof Error ? error.message : "Screen sharing is unavailable.");
      }
    } else {
      setSources([]);
      setChoosing(true);
    }
  }, []);

  const shareScreen = useCallback(async (sourceId?: string) => {
    setBusy(true);
    setHint("Choose a window or display to share…");
    try {
      const desktop = getElectronDesktop();
      if (sourceId && desktop?.voice?.selectSource) {
        const selection = await desktop.voice.selectSource(sourceId);
        if (!selection.ok) throw new Error(selection.error || "That sharing source is no longer available.");
      }
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is not supported here.");
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
      await beginStream("screen", stream);
      setChoosing(false);
      setHint("");
      const question = pendingQuestion;
      setPendingQuestion("");
      if (wantsVisualAnswer(question)) await inspect(question);
      else if (question) call.respondVisual("I can see your shared screen now.");
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Screen sharing was cancelled.");
    } finally { setBusy(false); }
  }, [beginStream, call, inspect, pendingQuestion]);

  const runGuide = useCallback(async (question: string) => {
    if (modeRef.current === "voice") { await listSources(question); return; }
    if (modeRef.current !== "screen") { await inspect(question, true); return; }
    setBusy(true);
    try {
      const result = await getElectronDesktop()?.voice?.guide?.(question);
      if (result?.ok === false) setHint(result.error || "I could not locate that target.");
      await inspect(question, true);
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Visual guidance failed.");
    } finally { setBusy(false); }
  }, [inspect, listSources]);

  const handleIntent = useCallback(async (intent: VoiceVisualIntent) => {
    if (intent.action === "voice-only") {
      stopVisual();
      call.respondVisual("Visual capture is off. We can keep talking.");
    } else if (intent.action === "enable-camera") {
      if (modeRef.current !== "camera" && !(await startCamera())) {
        call.respondVisual("Camera access wasn't available. Use the camera button to try again.");
      } else if (wantsVisualAnswer(intent.question)) await inspect(intent.question);
      else call.respondVisual("Camera is on. What would you like me to look at?");
    } else if (intent.action === "enable-screen") {
      if (modeRef.current === "screen") await inspect(intent.question);
      else await listSources(intent.question);
    } else if (intent.action === "inspect") await inspect(intent.question);
    else if (intent.action === "point") await runGuide(intent.question);
    else if (intent.action === "control") setPendingControl(intent.question);
  }, [call, inspect, listSources, runGuide, startCamera, stopVisual]);

  useEffect(() => {
    const listener = (event: Event) => {
      const intent = (event as CustomEvent<VoiceVisualIntent>).detail;
      if (intent?.action) void handleIntent(intent).catch(error => {
        call.respondVisual(error instanceof Error ? error.message : "The visual request failed.");
      });
    };
    window.addEventListener("clyra:voice-visual-intent", listener);
    return () => window.removeEventListener("clyra:voice-visual-intent", listener);
  }, [call, handleIntent]);

  const allowControl = useCallback(async () => {
    const instruction = pendingControl;
    setPendingControl("");
    if (!instruction || modeRef.current !== "screen") return;
    setBusy(true);
    try {
      const native = await getElectronDesktop()?.voice?.beginControl?.();
      if (native?.ok === false) throw new Error(native.error || "Desktop control was not granted.");
      await call.startVoiceMission(`${instruction}\n\nVisual context from the shared screen (observed, may be stale): ${contextRef.current.slice(0, 650)}. Observe the current desktop before acting; verify each action and ask for confirmation for consequential changes.`);
    } catch (error) {
      setHint(error instanceof Error ? error.message : "Couldn't start screen control.");
    } finally { setBusy(false); }
  }, [call, pendingControl]);

  const activeTask = call.activeTask && call.activeTask.status !== "complete" ? call.activeTask : null;
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (choosing) {
        event.preventDefault();
        setChoosing(false);
        setPendingQuestion("");
        return;
      }
      if (pendingControl) {
        event.preventDefault();
        setPendingControl("");
        return;
      }
      if (activeTask && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        call.stopTask();
        void getElectronDesktop()?.voice?.stopControl?.().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [choosing, pendingControl, activeTask?.id, call.stopTask]);
  useEffect(() => {
    if (!activeTask || activeTask.kind !== "browser") {
      setTaskImage(null);
      return;
    }
    let live = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const frame = await getElectronDesktop()?.voice?.taskFrame?.();
        if (live && frame?.ok && frame.image) setTaskImage(frame.image);
      } catch { /* Browser surface may not be active yet. */ }
      finally { refreshing = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1350);
    return () => { live = false; window.clearInterval(timer); };
  }, [activeTask?.id, activeTask?.kind]);
  const activeSurface = call.activeSurface;
  const previewUrl = activeSurface && isLocalOrWebPreview(activeSurface.url) ? activeSurface.url : null;
  const frameWidth = videoRef.current?.videoWidth || 1;
  const frameHeight = videoRef.current?.videoHeight || 1;
  const scale = mode === "camera" ? Math.max(previewSize.width / frameWidth, previewSize.height / frameHeight) : Math.min(previewSize.width / frameWidth, previewSize.height / frameHeight);
  const fittedWidth = frameWidth * scale;
  const fittedHeight = frameHeight * scale;
  const left = (previewSize.width - fittedWidth) / 2;
  const top = (previewSize.height - fittedHeight) / 2;
  const rawPointX = pointer ? left + (pointer.x + pointer.width / 2) * fittedWidth : 0;
  const pointX = mode === "camera" ? previewSize.width - rawPointX : rawPointX;
  const pointY = pointer ? top + (pointer.y + pointer.height / 2) * fittedHeight : 0;

  return (
    <div className="clyra-voice-multimodal" data-mode={mode} data-busy={busy} aria-label="Voice call visual capabilities">
      <video
        ref={videoRef}
        className={`clyra-voice-multimodal__video ${mode === "camera" ? "is-camera" : ""}`}
        autoPlay muted playsInline aria-label={mode === "camera" ? "Live camera preview" : "Shared screen preview"}
      />
      <div className="clyra-voice-multimodal__tint" aria-hidden="true" />
      {mode !== "voice" && pointer ? <div className="clyra-voice-multimodal__point" style={{ left: pointX, top: pointY }} aria-hidden="true"><span /></div> : null}
      <div className="clyra-voice-multimodal__toolbar" role="toolbar" aria-label="Visual call controls">
        <span className="clyra-voice-multimodal__status">{mode === "camera" ? "Camera on" : mode === "screen" ? "Sharing screen" : "Voice call"}</span>
        <button className={mode === "camera" ? "is-selected" : ""} onClick={() => { if (mode === "camera") stopVisual(); else void startCamera(); }} aria-label={mode === "camera" ? "Turn camera off" : "Turn camera on"} title="Camera">{mode === "camera" ? <CameraOff size={16} /> : <Camera size={16} />}</button>
        <button className={mode === "screen" ? "is-selected" : ""} onClick={() => { if (mode === "screen") stopVisual(); else void listSources(); }} aria-label={mode === "screen" ? "Stop screen sharing" : "Share screen"} title="Screen share"><Monitor size={16} /></button>
        {mode !== "voice" ? <button onClick={stopVisual} aria-label="Return to voice only" title="Voice only"><Mic2 size={16} /></button> : null}
        {mode === "screen" ? <button onClick={() => setPendingControl("Help me complete my current task using the desktop tools.")} aria-label="Request AI control" title="AI control"><MousePointer2 size={16} /></button> : null}
      </div>

      {hint && !choosing ? <div className="clyra-voice-multimodal__hint" role="status">{hint}</div> : null}

      {activeTask ? <section className="clyra-voice-multimodal__stage" aria-label="Live Clyra task progress">
        <header><span className="clyra-voice-multimodal__stage-dot" /><span>{activeSurface?.title || "Clyra is working"}</span><button onClick={call.stopTask} aria-label="Stop agent task" title="Stop"><CircleStop size={18} /></button></header>
        {taskImage && activeTask.kind === "browser" ? <div className="clyra-voice-multimodal__stage-live"><img src={taskImage} alt="Live capture of the real Clyra browser workspace" /></div> :
        previewUrl ? <iframe title="Live task workspace" src={previewUrl} sandbox="allow-scripts allow-same-origin allow-forms" /> : <div className="clyra-voice-multimodal__stage-body">
          <h3>{activeTask.label}</h3>
          <p>{activeTask.detail || activeSurface?.subtitle || "Live steps from the Clyra agent harness appear here."}</p>
          {activeTask.steps?.length ? <ol>{activeTask.steps.map(step => <li key={step.id} data-status={step.status}><span>{step.status === "complete" ? <Check size={13} /> : step.status === "active" ? "·" : ""}</span>{step.label}</li>)}</ol> : null}
        </div>}
        <footer>{activeTask.status === "paused" ? "Agent paused" : "Live agent task"} · {activeTask.kind === "computer" ? "Native cursor shows actual desktop actions" : "Using Clyra tools"}</footer>
      </section> : null}

      {choosing ? <div className="clyra-voice-multimodal__sheet">
        <div className="clyra-voice-multimodal__sheet-heading"><span><Monitor size={18} /> Choose what to share</span><button onClick={() => { setChoosing(false); setPendingQuestion(""); call.respondVisual("Screen sharing wasn't started."); }} aria-label="Cancel sharing"><X size={18} /></button></div>
        <p>Only the display or window you choose will be shared. You can stop at any time.</p>
        {sources.length ? <div className="clyra-voice-multimodal__sources">{sources.map(source => <button key={source.id} disabled={busy} onClick={() => void shareScreen(source.id)}>{source.thumbnail ? <img src={source.thumbnail} alt="" /> : <Monitor size={28} />}<span>{source.name}</span></button>)}</div> :
          <button className="clyra-voice-multimodal__share-action" disabled={busy} onClick={() => void shareScreen()}>Open system screen picker</button>}
      </div> : null}

      {pendingControl ? <div className="clyra-voice-multimodal__consent" role="dialog" aria-modal="true" aria-label="Allow Clyra to control the desktop">
        <MousePointer2 size={22} />
        <h3>Allow Clyra to control your screen?</h3>
        <p>Clyra will use its existing agent tools, show real progress, verify actions and ask before consequential changes. Stop it at any moment.</p>
        <div><button onClick={() => { setPendingControl(""); call.respondVisual("Okay, I won't take control."); }}>Not now</button><button onClick={() => void allowControl()}>Allow this task</button></div>
      </div> : null}

      {call.responseText && <div className="clyra-voice-multimodal__transcript" aria-live="polite">{call.responseText}</div>}
      {call.requiresApproval ? <div className="clyra-voice-multimodal__approval" role="dialog" aria-label="Agent approval">
        <strong>{call.requiresApproval.title}</strong><p>{call.requiresApproval.detail}</p>
        <button onClick={call.rejectApproval}>Cancel</button><button onClick={call.confirmApproval}>Approve</button>
      </div> : null}
      {mode === "camera" && busy ? <div className="clyra-voice-multimodal__busy" aria-label="Analysing" /> : null}
    </div>
  );
}
