// Progress for a server job. The bar shows the server's monotonic overall value,
// and the stage and counts come from the same event, so nothing here is invented.
// It never shows 100% until the server reports completion with an output.

import { X } from "lucide-react";
import type { JobSnapshot } from "../api";

export function JobPanel({ job, onCancel }: { job: JobSnapshot | null; onCancel: () => void }) {
  if (!job) return null;
  const active = job.status === "queued" || job.status === "running";
  const percent = job.status === "completed" ? 100 : Math.min(99, Math.floor(job.overall));
  const label = job.status === "completed" ? "Done" : job.status === "failed" ? "Failed" : job.status === "cancelled" ? "Cancelled" : job.stageLabel;
  const counts = job.total > 0 ? `${job.completed.toLocaleString()} of ${job.total.toLocaleString()}` : null;
  return (
    <div className="sh-card" style={{ marginTop: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10 }} role="status" aria-live="polite">
      <div className="sh-row">
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="sh-muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{job.status === "failed" || job.status === "cancelled" ? "" : `${percent}%`}</span>
      </div>
      <div className={`sh-progress${active ? " sh-progress--shimmer" : ""}`}>
        <span style={{ width: `${job.status === "failed" ? 0 : percent}%` }} />
      </div>
      <div className="sh-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {job.message}
        {counts ? <span style={{ display: "block", marginTop: 2 }}>{counts}</span> : null}
        {job.status === "completed" && job.result?.url ? <span style={{ display: "block", marginTop: 2 }}>Saved to the project's exports.</span> : null}
      </div>
      {job.warnings.map((warning) => (
        <div key={warning} className="sh-notice" style={{ color: "var(--sh-warning)" }}>{warning}</div>
      ))}
      {job.status === "failed" && job.error ? <div className="sh-error">{job.error}</div> : null}
      {active ? (
        <button type="button" className="sh-btn sh-btn--sm" onClick={onCancel} style={{ alignSelf: "flex-start" }}>
          <X size={13} strokeWidth={1.6} /> Cancel
        </button>
      ) : null}
    </div>
  );
}
