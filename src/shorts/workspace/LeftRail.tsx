// Left rail: what can be added to this project, and where its media comes from.
// Only actions that work are enabled. Music and SFX live in the editor's Audio
// tab (real local library folders). What still needs a licensed/stock
// provider (B-roll, image backgrounds) is listed here as unavailable, with why.

import { useRef, useState } from "react";
import { Film, ImagePlus, Lock, MessageSquarePlus, Mic, Plus, Type, Upload } from "lucide-react";
import { uploadVideoFile } from "../api";
import type { TimelineItemType, ShortsProject } from "../../../lib/shorts/schema";
import { kindLabel, relativeTime } from "../ShortsHome";
import { formatClock } from "../format";

export type LeftRailProps = {
  project: ShortsProject;
  onAdd: (type: TimelineItemType) => void;
  onProjectPatch: (next: ShortsProject, label: string) => void;
  onAttachVideo: (uploadId: string, name: string) => Promise<void>;
};

const ADDABLE: Record<ShortsProject["kind"], Array<{ type: TimelineItemType; label: string; icon: typeof Type }>> = {
  "ai-clip": [{ type: "title", label: "Title card", icon: Type }, { type: "narration", label: "Narration line", icon: Mic }],
  "fake-text": [{ type: "message", label: "Chat message", icon: MessageSquarePlus }],
  "would-rather": [{ type: "choice", label: "Would you rather", icon: Plus }],
  "reddit-story": [{ type: "story", label: "Story post", icon: Plus }],
  "narrated-story": [{ type: "narration", label: "Narration line", icon: Mic }, { type: "title", label: "Title card", icon: Type }],
  quiz: [{ type: "quiz", label: "Quiz question", icon: Plus }],
  list: [{ type: "title", label: "Title card", icon: Type }, { type: "list-item", label: "List item", icon: Plus }],
  "gameplay-story": [{ type: "story", label: "Story post", icon: Plus }, { type: "title", label: "Title card", icon: Type }],
  "caption-video": [{ type: "title", label: "Title card", icon: Type }],
  "cut-crop": [],
};

const UNAVAILABLE = [
  { label: "B-roll", reason: "Needs a stock provider with licence checks. Not connected yet.", icon: Film },
  { label: "Image background", reason: "Image backgrounds aren't supported yet. Use a video or a colour.", icon: ImagePlus },
];

export function LeftRail({ project, onAdd, onProjectPatch, onAttachVideo }: LeftRailProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addable = ADDABLE[project.kind];
  const canAttach = project.kind !== "fake-text" && project.kind !== "would-rather" && project.kind !== "quiz" && project.kind !== "list";

  const attach = async (file: File) => {
    setError(null);
    setBusy("Uploading");
    try {
      const uploaded = await uploadVideoFile(file);
      setBusy("Reading");
      await onAttachVideo(uploaded.uploadId, uploaded.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The video could not be added.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: "14px 14px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
      <section>
        <div className="sh-section-title">Project</div>
        <div className="sh-card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{kindLabel(project.kind)}</span>
          <span className="sh-muted" style={{ fontSize: 12 }}>Updated {relativeTime(project.updatedAt)}</span>
          {project.source ? (
            <span className="sh-muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={project.source.title}>
              {project.source.origin === "youtube" ? "YouTube" : "Upload"}: {project.source.title}
            </span>
          ) : null}
          {project.source ? <span className="sh-muted" style={{ fontSize: 12 }}>{formatClock(project.source.durationMs)} · {project.source.width}×{project.source.height}</span> : null}
        </div>
      </section>

      {addable.length ? (
        <section>
          <div className="sh-section-title">Add</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {addable.map((entry) => {
              const Icon = entry.icon;
              return (
                <button key={entry.type} type="button" className="sh-btn" style={{ justifyContent: "flex-start", height: 34 }} onClick={() => onAdd(entry.type)}>
                  <Icon size={14} strokeWidth={1.6} /> {entry.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {canAttach ? (
        <section>
          <div className="sh-section-title">Video</div>
          <button type="button" className="sh-btn" style={{ justifyContent: "flex-start", height: 34, width: "100%" }} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            <Upload size={14} strokeWidth={1.6} /> {busy ?? (project.source ? "Replace video" : "Add video")}
          </button>
          <input ref={fileInput} type="file" accept="video/*,.mkv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ""; }} />
          <p className="sh-hint">MP4, MOV, M4V, WebM or MKV. The file is copied into this project, and your original is not changed.</p>
          {error ? <p className="sh-error" style={{ marginTop: 6, fontSize: 12.5 }}>{error}</p> : null}
        </section>
      ) : null}

      <section>
        <div className="sh-section-title">Look</div>
        <div className="sh-field">
          <span className="sh-label">Accent</span>
          <input type="color" aria-label="Accent colour" value={project.template.accent} onChange={(event) => onProjectPatch({ ...project, template: { ...project.template, accent: event.target.value } }, "Change accent colour")} style={{ width: 56, height: 32, border: 0, background: "none" }} />
        </div>
      </section>

      <section>
        <div className="sh-section-title">Media not available</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {UNAVAILABLE.map((entry) => {
            const Icon = entry.icon;
            return (
              <div key={entry.label} className="sh-card" style={{ padding: "9px 10px", opacity: 0.8, boxShadow: "none" }} title={entry.reason}>
                <div className="sh-row" style={{ justifyContent: "flex-start", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                  <Icon size={14} strokeWidth={1.6} className="sh-muted" /> {entry.label}
                  <Lock size={12} strokeWidth={1.6} className="sh-muted" style={{ marginLeft: "auto" }} />
                </div>
                <div className="sh-muted" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.4 }}>{entry.reason}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
