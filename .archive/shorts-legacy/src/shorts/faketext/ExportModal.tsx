// Export flow for Fake Text Story. Same render job the unified editor uses
// (lib/shorts/render.ts) — this just gives Fake Text its own entry point into
// it, with real progress (never frozen, never fake) and a real download link
// once FFmpeg has actually produced the file.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Sparkles, X } from "lucide-react";
import { shortsApi, subscribeJob, type JobSnapshot } from "../api";
import type { ShortsFps, ShortsResolution } from "../../../lib/shorts/schema";

type Quality = "fast" | "balanced" | "high";

export function ExportModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [resolution, setResolution] = useState<ShortsResolution>(1080);
  const [fps, setFps] = useState<ShortsFps>(30);
  const [quality, setQuality] = useState<Quality>("balanced");
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  useEffect(() => () => unsubscribe.current?.(), []);

  const start = async () => {
    setError(null);
    try {
      const { job: started } = await shortsApi.startRender(projectId, { resolution, fps, quality });
      setJob(started);
      unsubscribe.current = subscribeJob(started.id, setJob, (message) => setError(message));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export could not start.");
    }
  };

  const running = job && (job.status === "queued" || job.status === "running");
  const done = job?.status === "completed";
  const failed = job?.status === "failed";
  const result = done ? (job.result as { url?: string; file?: string; bytes?: number; durationMs?: number } | null) : null;

  return (
    <div className="ft-modal-overlay" onClick={() => !running && onClose()}>
      <div className="ft-modal" onClick={(event) => event.stopPropagation()}>
        <div className="ft-modal-header">
          <span className="ft-modal-title">Export</span>
          {!running ? (
            <button type="button" className="ft-icon-btn" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
          ) : null}
        </div>
        <div className="ft-modal-body">
          {!job ? (
            <>
              <div className="ft-control-grid ft-section">
                <div>
                  <div className="ft-field-label">Resolution</div>
                  <div className="ft-pill-group">
                    {([720, 1080] as ShortsResolution[]).map((value) => (
                      <button key={value} type="button" className={`ft-pill${resolution === value ? " active" : ""}`} onClick={() => setResolution(value)}>{value}p</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="ft-field-label">Frame rate</div>
                  <div className="ft-pill-group">
                    {([30, 60] as ShortsFps[]).map((value) => (
                      <button key={value} type="button" className={`ft-pill${fps === value ? " active" : ""}`} onClick={() => setFps(value)}>{value}fps</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="ft-section">
                <div className="ft-field-label">Quality</div>
                <div className="ft-pill-group">
                  {(["fast", "balanced", "high"] as Quality[]).map((value) => (
                    <button key={value} type="button" className={`ft-pill${quality === value ? " active" : ""}`} onClick={() => setQuality(value)}>{value[0].toUpperCase() + value.slice(1)}</button>
                  ))}
                </div>
              </div>
              {error ? <div className="ft-notice error">{error}</div> : null}
            </>
          ) : (
            <div style={{ padding: "6px 0" }}>
              {running ? (
                <div className="ft-export-phase">
                  <div className="ft-export-icon"><Loader2 size={28} strokeWidth={2} style={{ animation: "ft-spin 1s linear infinite" }} /></div>
                  <div className="ft-export-title">{job.status === "queued" ? "Preparing your video…" : "Rendering your video…"}</div>
                  <div className="ft-export-sub">{job.message || job.stageLabel || "This usually takes a minute or two."}</div>
                  <div className="ft-export-progress"><span style={{ width: `${Math.max(4, job.overall)}%` }} /></div>
                  <div className="ft-export-percent">{Math.round(job.overall)}% complete</div>
                </div>
              ) : done ? (
                <div className="ft-export-phase">
                  <div className="ft-export-icon done"><Check size={30} strokeWidth={2.4} /></div>
                  <div className="ft-export-title">Your video is ready!</div>
                  <div className="ft-export-sub">
                    {result?.bytes ? `${(result.bytes / 1_048_576).toFixed(1)} MB` : ""}
                    {result?.durationMs ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : ""}
                  </div>
                </div>
              ) : failed ? (
                <div className="ft-export-phase">
                  <div className="ft-export-icon failed"><AlertTriangle size={28} strokeWidth={2.2} /></div>
                  <div className="ft-export-title">Render failed</div>
                  <div className="ft-export-sub">{job.error || "The export failed. You can try again."}</div>
                </div>
              ) : null}
              {job.warnings.length ? (
                <div className="ft-notice" style={{ marginTop: 14 }}>{job.warnings.join(" ")}</div>
              ) : null}
            </div>
          )}
        </div>
        <div className="ft-modal-footer">
          {!job ? (
            <>
              <button type="button" className="ft-btn" onClick={onClose}>Cancel</button>
              <button type="button" className="ft-btn ft-btn--primary" onClick={() => void start()}><Sparkles size={14} strokeWidth={2} /> Export MP4</button>
            </>
          ) : done && result?.url ? (
            <>
              <button type="button" className="ft-btn" onClick={onClose}>Close</button>
              <a className="ft-btn ft-btn--primary" href={`${result.url}?download=1`} download>
                <Download size={14} strokeWidth={2} /> Download
              </a>
            </>
          ) : failed ? (
            <>
              <button type="button" className="ft-btn" onClick={onClose}>Close</button>
              <button type="button" className="ft-btn ft-btn--primary" onClick={() => { setJob(null); setError(null); }}>Try again</button>
            </>
          ) : (
            <button type="button" className="ft-btn" disabled>Exporting…</button>
          )}
        </div>
      </div>
    </div>
  );
}
