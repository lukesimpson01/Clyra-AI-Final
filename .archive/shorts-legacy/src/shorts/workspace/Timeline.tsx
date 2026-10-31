// Timeline for every Shorts tool. Tracks are derived from the project's items
// and captions, so the timeline always reflects what the preview will render.
// Dragging keeps a local preview and commits once on release, which makes a
// whole drag a single undo step instead of one per pointer move.

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { captionPages } from "../../../lib/shorts/templates";
import { projectDurationMs, type ShortsProject, type TimelineItem } from "../../../lib/shorts/schema";
import { SNAP_MS } from "../../../lib/shorts/ops";
import { formatClock } from "../format";

export type TimelineProps = {
  project: ShortsProject;
  timeMs: number;
  zoom: number;
  onZoom: (value: number) => void;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onSeek: (ms: number) => void;
  onMove: (id: string, startMs: number) => void;
  onResize: (id: string, durationMs: number) => void;
};

const TRACK_HEIGHT = 40;
const LABEL_WIDTH = 96;

type TrackId = "video" | "story" | "titles" | "narration" | "captions";

const TRACKS: Array<{ id: TrackId; label: string }> = [
  { id: "video", label: "Video" },
  { id: "story", label: "Story" },
  { id: "titles", label: "Titles" },
  { id: "narration", label: "Narration" },
  { id: "captions", label: "Captions" },
];

function trackOf(item: TimelineItem): TrackId {
  if (item.type === "title") return "titles";
  if (item.type === "narration") return "narration";
  return "story";
}

export function Timeline({ project, timeMs, zoom, onZoom, selectedIds, onSelect, onSeek, onMove, onResize }: TimelineProps) {
  const duration = projectDurationMs(project);
  const pxPerMs = zoom / 1000;
  const width = Math.max(600, Math.round(duration * pxPerMs) + LABEL_WIDTH + 120);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<{ id: string; startMs?: number; durationMs?: number } | null>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; startX: number; origin: number; moved: boolean } | null>(null);

  const pages = useMemo(() => (project.captions.enabled ? captionPages(project.captions.words, project.captions.style.wordsPerPage) : []), [project.captions]);
  const rulerStep = zoom >= 120 ? 1000 : zoom >= 50 ? 2000 : 5000;

  const seekFromX = (clientX: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left - LABEL_WIDTH + scroller.scrollLeft;
    onSeek(Math.max(0, x / pxPerMs));
  };

  const startDrag = (event: ReactPointerEvent, item: TimelineItem, mode: "move" | "resize") => {
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { id: item.id, mode, startX: event.clientX, origin: mode === "move" ? item.startMs : item.durationMs, moved: false };
    if (mode === "move" && !event.shiftKey && !selectedIds.includes(item.id)) onSelect([item.id]);
    if (mode === "move" && event.shiftKey) onSelect(selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id]);
  };

  const moveDrag = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const deltaMs = (event.clientX - current.startX) / pxPerMs;
    if (Math.abs(event.clientX - current.startX) > 3) current.moved = true;
    if (current.mode === "move") {
      const snapped = Math.max(0, Math.round((current.origin + deltaMs) / SNAP_MS) * SNAP_MS);
      setPreview({ id: current.id, startMs: snapped });
    } else {
      const snapped = Math.max(SNAP_MS, Math.round((current.origin + deltaMs) / SNAP_MS) * SNAP_MS);
      setPreview({ id: current.id, durationMs: snapped });
    }
  };

  const endDrag = (item: TimelineItem) => {
    const current = drag.current;
    drag.current = null;
    const pending = preview;
    setPreview(null);
    if (!current) return;
    if (!current.moved) return;
    if (current.mode === "move" && pending?.startMs !== undefined && pending.startMs !== item.startMs) onMove(item.id, pending.startMs);
    if (current.mode === "resize" && pending?.durationMs !== undefined && pending.durationMs !== item.durationMs) onResize(item.id, pending.durationMs);
  };

  const playheadX = LABEL_WIDTH + timeMs * pxPerMs;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-row" style={{ height: 34, padding: "0 12px", borderBottom: "1px solid var(--sh-line)", flexShrink: 0, justifyContent: "flex-start", gap: 12 }}>
        <span className="sh-section-title" style={{ margin: 0 }}>Timeline</span>
        <span className="sh-muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{formatClock(duration)}</span>
        <div style={{ flex: 1 }} />
        <button type="button" className="sh-icon-btn" aria-label="Zoom out" onClick={() => onZoom(Math.max(30, zoom - 10))} style={{ width: 26, height: 26 }}>−</button>
        <input type="range" min={30} max={240} step={5} value={zoom} onChange={(event) => onZoom(Number(event.target.value))} aria-label="Timeline zoom" style={{ width: 120 }} />
        <button type="button" className="sh-icon-btn" aria-label="Zoom in" onClick={() => onZoom(Math.min(240, zoom + 10))} style={{ width: 26, height: 26 }}>+</button>
      </div>

      <div ref={scrollRef} className="clyra-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
        <div style={{ width, position: "relative", minHeight: "100%" }}>
          <div
            onPointerDown={(event) => {
              seekFromX(event.clientX);
              (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
              const move = (ev: PointerEvent) => seekFromX(ev.clientX);
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            style={{ position: "sticky", top: 0, zIndex: 3, height: 24, background: "var(--sh-surface)", borderBottom: "1px solid var(--sh-line)", cursor: "pointer" }}
            role="slider"
            aria-label="Timeline ruler"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Math.round(timeMs)}
          >
            {Array.from({ length: Math.floor(duration / rulerStep) + 1 }, (_, index) => index * rulerStep).map((tick) => (
              <div key={tick} style={{ position: "absolute", left: LABEL_WIDTH + tick * pxPerMs, top: 0, bottom: 0, borderLeft: "1px solid var(--sh-line-2)", paddingLeft: 4, fontSize: 10.5, color: "var(--sh-ink-3)", fontVariantNumeric: "tabular-nums", lineHeight: "24px", pointerEvents: "none" }}>
                {formatClock(tick).replace(/\.\d$/, "")}
              </div>
            ))}
          </div>

          {TRACKS.map((track) => {
            const rowItems = track.id === "video" || track.id === "captions" ? [] : project.items.filter((item) => trackOf(item) === track.id);
            return (
              <div key={track.id} style={{ display: "flex", height: TRACK_HEIGHT, borderBottom: "1px solid var(--sh-line)", position: "relative" }}>
                <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, background: "var(--sh-surface)", display: "flex", alignItems: "center", paddingLeft: 12, fontSize: 12, color: "var(--sh-ink-2)", fontWeight: 500, borderRight: "1px solid var(--sh-line)" }}>
                  {track.label}
                </div>
                <div style={{ position: "relative", flex: 1 }}>
                  {track.id === "video" && project.background.type === "video" ? (
                    <div style={{ position: "absolute", left: 0, top: 6, height: TRACK_HEIGHT - 12, width: duration * pxPerMs, borderRadius: 8, background: "repeating-linear-gradient(90deg, var(--sh-blue-soft) 0 22px, transparent 22px 26px)", border: "1px solid var(--sh-blue-soft)", display: "flex", alignItems: "center", paddingLeft: 10, fontSize: 11.5, color: "var(--sh-blue-ink)", boxSizing: "border-box" }}>
                      {project.source?.title || project.background.file}
                    </div>
                  ) : null}
                  {track.id === "video" && project.background.type !== "video" ? (
                    <div style={{ position: "absolute", left: 10, top: 12, fontSize: 11.5, color: "var(--sh-ink-3)" }}>Solid or gradient background</div>
                  ) : null}
                  {track.id === "captions" ? pages.map((page, index) => (
                    <div key={index} style={{ position: "absolute", left: page.startMs * pxPerMs, width: Math.max(8, (page.endMs - page.startMs) * pxPerMs), top: 6, height: TRACK_HEIGHT - 12, borderRadius: 6, background: "var(--sh-hover)", border: "1px solid var(--sh-line-2)", overflow: "hidden", fontSize: 11, color: "var(--sh-ink-2)", padding: "0 6px", lineHeight: "26px", whiteSpace: "nowrap", textOverflow: "ellipsis", boxSizing: "border-box" }}>
                      {page.words.map((word) => word.text).join(" ")}
                    </div>
                  )) : null}
                  {track.id === "captions" && pages.length === 0 ? (
                    <div style={{ position: "absolute", left: 10, top: 12, fontSize: 11.5, color: "var(--sh-ink-3)" }}>No captions yet. Turn captions on in the Captions tab.</div>
                  ) : null}
                  {rowItems.map((item) => {
                    const shown = preview && preview.id === item.id ? { ...item, startMs: preview.startMs ?? item.startMs, durationMs: preview.durationMs ?? item.durationMs } : item;
                    const selected = selectedIds.includes(item.id);
                    const typingWidth = item.type === "message" ? item.typingMs * pxPerMs : 0;
                    return (
                      <div
                        key={item.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected}
                        aria-label={itemLabel(item)}
                        data-item-id={item.id}
                        onPointerDown={(event) => startDrag(event, item, "move")}
                        onPointerMove={moveDrag}
                        onPointerUp={() => endDrag(item)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect([item.id]); } }}
                        style={{
                          position: "absolute",
                          left: shown.startMs * pxPerMs,
                          width: Math.max(14, shown.durationMs * pxPerMs),
                          top: 5,
                          height: TRACK_HEIGHT - 10,
                          borderRadius: 9,
                          background: selected ? "var(--sh-blue)" : colorFor(item),
                          color: selected ? "#fff" : "var(--sh-ink)",
                          border: `1px solid ${selected ? "var(--sh-blue-ink)" : "var(--sh-line-2)"}`,
                          boxShadow: selected ? "0 4px 12px rgba(30,111,255,0.3)" : "var(--sh-shadow-sm)",
                          fontSize: 11.5,
                          lineHeight: "28px",
                          padding: "0 10px",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          cursor: "grab",
                          boxSizing: "border-box",
                          userSelect: "none",
                          touchAction: "none",
                        }}
                      >
                        {typingWidth > 0 ? <span aria-hidden style={{ position: "absolute", left: -typingWidth, top: 0, bottom: 0, width: typingWidth, borderRadius: "9px 0 0 9px", background: "repeating-linear-gradient(90deg, var(--sh-line) 0 4px, transparent 4px 8px)", pointerEvents: "none" }} /> : null}
                        {itemLabel(item)}
                        <span
                          aria-hidden
                          onPointerDown={(event) => startDrag(event, item, "resize")}
                          onPointerMove={moveDrag}
                          onPointerUp={() => endDrag(item)}
                          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize" }}
                        />
                      </div>
                    );
                  })}
                  {track.id === "story" && rowItems.length === 0 ? (
                    <div style={{ position: "absolute", left: 10, top: 12, fontSize: 11.5, color: "var(--sh-ink-3)" }}>Add story items from the left panel.</div>
                  ) : null}
                </div>
              </div>
            );
          })}

          <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: playheadX, width: 1.5, background: "var(--sh-blue)", pointerEvents: "none", zIndex: 4, transition: "left 0ms" }}>
            <span style={{ position: "absolute", top: 0, left: -5, width: 11, height: 11, borderRadius: 3, background: "var(--sh-blue)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function colorFor(item: TimelineItem) {
  switch (item.type) {
    case "message":
      return item.side === "right" ? "rgba(8,119,249,0.16)" : "var(--sh-surface-2)";
    case "choice":
      return "rgba(255,93,108,0.14)";
    case "quiz":
      return "rgba(23,169,118,0.16)";
    case "list-item":
      return "rgba(255,138,61,0.18)";
    case "story":
      return "rgba(83,98,126,0.12)";
    case "title":
      return "rgba(124,92,255,0.16)";
    case "narration":
      return "rgba(8,119,249,0.1)";
    default:
      return "var(--sh-surface-2)";
  }
}

export function itemLabel(item: TimelineItem): string {
  switch (item.type) {
    case "message":
      return `${item.sender}: ${item.text}`;
    case "choice":
      return `${item.left} / ${item.right}`;
    case "quiz":
      return item.question;
    case "list-item":
      return `#${item.rank} ${item.title}`;
    case "story":
      return item.title;
    case "title":
      return item.text;
    case "narration":
      return item.text;
  }
}
