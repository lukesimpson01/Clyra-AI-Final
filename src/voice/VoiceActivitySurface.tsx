import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
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

export function VoiceActivitySurface({ task, surface, controlling, onToggleExpanded }: Props) {
  const reduced = useReducedMotion();
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
        {resolved.preview ? <img src={resolved.preview} alt="Live task preview" className="clyra-voice-activity__preview" /> : null}
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
