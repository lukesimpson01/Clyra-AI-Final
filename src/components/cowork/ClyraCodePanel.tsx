import { useMemo, useRef, useEffect } from "react";
import { Check, FileCode2, Loader2 } from "lucide-react";
import type { VibeCodeTaskState } from "../../hooks/useVibeCodeTask";
import "./cowork.css";

function partLabel(part: { type: string; tool?: string; text?: string; state?: { title?: string; status?: string } }) {
  if (part.type === "text") return null;
  return part.state?.title || part.tool || part.type;
}

/**
 * A live, read-only view of a real Clyra Code (Vibe Coder) run: the same
 * message/tool-part stream and the same running dev-server preview the
 * standalone Vibe Coder app shows, mounted inside Cowork's panel rather than
 * re-described. Nothing here is synthesized — every row is a real message
 * part or a real diff/preview poll result.
 */
export function ClyraCodePanel({ task }: { task: VibeCodeTaskState }) {
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [task.messages.length]);

  const previewUrl = task.projectId && task.preview?.status === "running"
    ? `/api/vibe/projects/${encodeURIComponent(task.projectId)}/preview/`
    : null;

  const rows = useMemo(() => task.messages.flatMap((message) =>
    message.parts.map((part) => ({ id: part.id, role: message.info.role, part }))), [task.messages]);

  return (
    <div className="cowork cowork-terminal" style={{ height: "100%" }}>
      <div className="cowork-panel-header">
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FileCode2 size={13} />
          Code — {task.objective.slice(0, 48)}{task.objective.length > 48 ? "…" : ""}
        </span>
        {task.diff.length ? <span style={{ fontSize: 11, color: "var(--agents-tertiary)" }}>{task.diff.length} file{task.diff.length === 1 ? "" : "s"} changed</span> : null}
      </div>
      <div className="cowork-terminal-log clyra-scroll" ref={logRef} style={{ flex: previewUrl ? "0 0 40%" : 1 }}>
        {task.error ? <p style={{ color: "var(--agents-danger)" }}>{task.error}</p> : null}
        {!rows.length && !task.error ? <p style={{ color: "var(--agents-tertiary)" }}>Starting a real Clyra Code project — the same runtime Vibe Coder uses…</p> : null}
        {rows.map(({ id, role, part }) => {
          if (part.type === "text") {
            return part.text ? <div key={id} className="cowork-terminal-entry">{role === "user" ? <strong>{part.text}</strong> : part.text}</div> : null;
          }
          const label = partLabel(part);
          if (!label) return null;
          const status = part.state?.status;
          return (
            <div key={id} className="cowork-terminal-entry" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--agents-secondary)" }}>
              {status === "running" || status === "pending" ? <Loader2 size={12} className="animate-spin" /> : status === "error" ? null : <Check size={12} color="var(--agents-success)" />}
              {label}
              {status === "error" && part.state?.error ? <span className="cowork-terminal-entry__err">— {part.state.error}</span> : null}
            </div>
          );
        })}
      </div>
      {previewUrl ? (
        <div style={{ flex: 1, minHeight: 0, borderTop: "1px solid var(--agents-divider)" }}>
          <iframe title="Live preview" src={previewUrl} style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />
        </div>
      ) : task.projectId ? (
        <div style={{ padding: "10px 14px", fontSize: 11.5, color: "var(--agents-tertiary)", borderTop: "1px solid var(--agents-divider)" }}>
          {task.preview?.lastError?.message || "Starting the live preview…"}
        </div>
      ) : null}
    </div>
  );
}
