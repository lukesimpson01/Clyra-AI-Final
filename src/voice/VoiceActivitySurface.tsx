import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { AgentCursorGlyph } from "../components/agent/AgentCursorGlyph";
import { ExternalLink, FileText, Globe2, Mail, Maximize2, Minimize2 } from "lucide-react";
import type { AgentSurface, AgentTask } from "./state/voiceSession";

type Props = {
  task: AgentTask;
  surface?: AgentSurface;
  controlling: boolean;
  onToggleExpanded: () => void;
};

function SurfaceIcon({ kind }: { kind: AgentSurface["kind"] }) {
  if (kind === "email") return <Mail size={18} strokeWidth={1.7} />;
  if (kind === "document" || kind === "file") return <FileText size={18} strokeWidth={1.7} />;
  return <Globe2 size={18} strokeWidth={1.7} />;
}

function ResultContent({ content }: { content: unknown }) {
  if (!content) return null;
  if (typeof content === "string") return <p className="clyra-voice-activity__summary">{content}</p>;
  if (typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const evidence = Array.isArray(record.evidence) ? record.evidence : [];
  const urls = Array.isArray((record.data as Record<string, unknown> | undefined)?.urls)
    ? ((record.data as Record<string, unknown>).urls as unknown[])
    : Array.isArray(record.urls)
      ? record.urls as unknown[]
      : [];
  const text = typeof record.text === "string" ? record.text : typeof record.detail === "string" ? record.detail : "";
  return (
    <div className="clyra-voice-activity__result">
      {text ? <p className="clyra-voice-activity__summary">{text}</p> : null}
      {[...urls, ...evidence.map((item) => typeof item === "object" && item ? (item as Record<string, unknown>).value : null)]
        .filter((item, index, values): item is string => typeof item === "string" && /^https?:\/\//.test(item) && values.indexOf(item) === index)
        .slice(0, 6)
        .map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="clyra-voice-activity__link">
            <span>{new URL(url).hostname.replace(/^www\./, "")}</span><ExternalLink size={13} />
          </a>
        ))}
    </div>
  );
}

type ConfirmedBrowserCursor = { id: number; at?: number; x: number; y: number; kind: string };
type BrowserSnapshot = { cursor?: ConfirmedBrowserCursor | null; viewport?: { width: number; height: number }; surfaceVisible?: boolean };

/** Live browser pixels and pointer events from the SAME browser service as
 * Chat and Vibe. No guessed target paths or screenshots painted as actions. */
function useVoiceBrowserActivity(enabled: boolean, taskId: string) {
  const [frame, setFrame] = useState<string | null>(null);
  const [cursor, setCursor] = useState<ConfirmedBrowserCursor | null>(null);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [embeddedCursor, setEmbeddedCursor] = useState(false);
  const imageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setCursor(null);
      setFrame(null);
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
      imageRef.current = null;
      return;
    }
    let running = true;
    let timer: number | null = null;
    const controller = new AbortController();
    const update = async () => {
      try {
        const stateResponse = await fetch("/api/openbrowser/state", { cache: "no-store", signal: controller.signal });
        if (!stateResponse.ok) throw new Error("Browser state is unavailable.");
        const payload = await stateResponse.json() as { ok?: boolean; state?: BrowserSnapshot };
        if (!running || !payload.ok || !payload.state) return;
        const state = payload.state;
        const w = Number(state.viewport?.width);
        const h = Number(state.viewport?.height);
        if (w > 0 && h > 0) setViewport({ width: w, height: h });
        setEmbeddedCursor(Boolean(state.surfaceVisible));
        const event = state.cursor;
        const fresh = event && Number.isFinite(event.x) && Number.isFinite(event.y)
          && event.at && Date.now() - event.at < 3_000;
        setCursor(fresh ? event : null);
        const imageResponse = await fetch("/api/openbrowser/frame?fresh=1", { cache: "no-store", signal: controller.signal });
        if (!running || !imageResponse.ok) return;
        const blob = await imageResponse.blob();
        if (!running) return;
        const next = URL.createObjectURL(blob);
        const previous = imageRef.current;
        imageRef.current = next;
        setFrame(next);
        if (previous) URL.revokeObjectURL(previous);
      } catch {
        // Preserve the last genuine frame; never synthesize page content.
      }
    };
    const tick = async () => {
      await update();
      if (running) timer = window.setTimeout(() => { void tick(); }, 850);
    };
    void tick();
    return () => {
      running = false;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
      if (imageRef.current) URL.revokeObjectURL(imageRef.current);
      imageRef.current = null;
    };
  }, [enabled, taskId]);
  return { frame, cursor, viewport, embeddedCursor };
}

export function VoiceActivitySurface({ task, surface, controlling, onToggleExpanded }: Props) {
  const reduced = useReducedMotion();
  const browser = useVoiceBrowserActivity(controlling && task.kind === "browser" && task.status === "running", task.id);
  const resolved: AgentSurface = surface || {
    id: task.id,
    kind: task.kind === "browser" ? "browser" : "app",
    title: task.kind === "browser" ? "Web research" : "Clyra task",
    subtitle: task.detail,
  };
  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.975 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.985 }}
      transition={{ duration: reduced ? 0.1 : 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={`clyra-voice-activity${resolved.expanded ? " clyra-voice-activity--expanded" : ""}${controlling ? " clyra-voice-activity--controlled" : ""}`}
      aria-label={`${resolved.title} activity surface`}
    >
      <header className="clyra-voice-activity__header">
        <div className="clyra-voice-activity__identity"><SurfaceIcon kind={resolved.kind} /><div><h2>{resolved.title}</h2><p>{resolved.subtitle || task.label}</p></div></div>
        <button type="button" className="clyra-voice-activity__expand" aria-label={resolved.expanded ? "Exit full screen" : "Full screen"} onClick={onToggleExpanded}>
          {resolved.expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </header>
      <div className="clyra-voice-activity__body">
        {task.kind === "browser" && (browser.frame || resolved.preview) ? (
          <div
            className="clyra-voice-activity__browser-frame"
            style={{
              position: "relative",
              width: "100%",
              maxWidth: Math.round(280 * (browser.viewport.width / browser.viewport.height)),
              aspectRatio: `${browser.viewport.width} / ${browser.viewport.height}`,
              overflow: "hidden",
              margin: "0 auto",
              borderRadius: 10,
            }}
          >
            <img src={browser.frame || resolved.preview} alt="Actual browser activity" className="clyra-voice-activity__preview" style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }} />
            {browser.cursor && !browser.embeddedCursor && (
              <div aria-hidden style={{
                position: "absolute",
                left: `${(browser.cursor.x / browser.viewport.width) * 100}%`,
                top: `${(browser.cursor.y / browser.viewport.height) * 100}%`,
                pointerEvents: "none",
              }}>
                <AgentCursorGlyph pressed={["click", "double_click", "right_click"].includes(browser.cursor.kind)} />
              </div>
            )}
          </div>
        ) : resolved.preview ? <img src={resolved.preview} alt="Task preview" className="clyra-voice-activity__preview" /> : null}
        {!resolved.preview && task.steps?.length ? (
          <ol className="clyra-voice-activity__steps">
            {task.steps.map((step) => <li key={step.id} data-status={step.status}><span aria-hidden /><p>{step.label}</p></li>)}
          </ol>
        ) : null}
        <AnimatePresence mode="wait"><motion.div key={task.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="clyra-voice-activity__status">{task.label}</motion.div></AnimatePresence>
        <ResultContent content={resolved.content} />
      </div>
    </motion.section>
  );
}
