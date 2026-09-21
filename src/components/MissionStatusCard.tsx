import { useState } from "react";
import { Check, CircleAlert, Clock3, Loader2, RotateCcw, ShieldCheck } from "lucide-react";

export type MissionStatusStep = {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
};

export type MissionStatus = {
  id: string;
  state: string;
  plan: { objective: string; steps: MissionStatusStep[] };
  approval?: { stepId: string; toolId: string };
  error?: { message: string };
  updatedAt?: number;
};

function presentation(state: string) {
  if (state === "COMPLETED") return { label: "Verified complete", tone: "emerald" };
  if (state === "WAITING_FOR_APPROVAL") return { label: "Waiting for approval", tone: "amber" };
  if (state === "WAITING_FOR_USER") return { label: "Waiting for you", tone: "amber" };
  if (state === "PAUSED") return { label: "Paused safely", tone: "slate" };
  if (state === "FAILED") return { label: "Needs attention", tone: "rose" };
  if (state === "CANCELLED") return { label: "Stopped", tone: "slate" };
  return { label: "Working", tone: "blue" };
}

function stepIcon(status: MissionStatusStep["status"]) {
  if (status === "completed") return <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.4} />;
  if (status === "failed" || status === "cancelled") return <CircleAlert className="h-3.5 w-3.5 text-rose-500" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />;
  return <span className="h-2 w-2 rounded-full border border-slate-300 bg-white" />;
}

/** A compact, evidence-led task summary. It renders only persisted mission
 * state—there are no synthetic progress percentages or pretend controls. */
export function MissionStatusCard({
  mission,
  onResume,
}: {
  mission: MissionStatus;
  onResume?: (mission: MissionStatus) => Promise<void>;
}) {
  const [resuming, setResuming] = useState(false);
  const complete = mission.plan.steps.filter((step) => step.status === "completed").length;
  const total = Math.max(1, mission.plan.steps.length);
  const status = presentation(mission.state);
  const resumable = ["PAUSED", "RECOVERING", "READY", "EXECUTING", "OBSERVING", "VERIFYING", "REPLANNING"].includes(mission.state);
  const approval = mission.state === "WAITING_FOR_APPROVAL" && mission.approval;
  const tone = status.tone === "emerald"
    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
    : status.tone === "amber"
      ? "bg-amber-50 text-amber-700 ring-amber-100"
      : status.tone === "rose"
        ? "bg-rose-50 text-rose-700 ring-rose-100"
        : status.tone === "blue"
          ? "bg-blue-50 text-blue-700 ring-blue-100"
          : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <section className="mt-4 max-w-[620px] overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,.055)]" aria-label="Clyra task status">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#eff6ff,#fdf4ff)] text-blue-600 shadow-[inset_0_1px_0_rgba(255,255,255,.9)]">
          {mission.state === "COMPLETED" ? <ShieldCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12px] font-semibold tracking-[-.01em] text-slate-800">Clyra task</p>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${tone}`}>{status.label}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{mission.plan.objective}</p>
        </div>
      </div>
      <div className="px-4 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>{complete} of {total} verified</span>
          <span>{Math.round((complete / total) * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full transition-[width] duration-500 ${status.tone === "emerald" ? "bg-emerald-500" : status.tone === "rose" ? "bg-rose-400" : "bg-blue-500"}`} style={{ width: `${(complete / total) * 100}%` }} />
        </div>
        <div className="mt-3 space-y-2">
          {mission.plan.steps.slice(0, 4).map((step) => (
            <div key={step.id} className="flex items-center gap-2 text-[11px] leading-4 text-slate-600">
              <span className="grid h-4 w-4 shrink-0 place-items-center">{stepIcon(step.status)}</span>
              <span className={step.status === "completed" ? "text-slate-500" : "font-medium text-slate-700"}>{step.description}</span>
            </div>
          ))}
        </div>
        {mission.error?.message ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">{mission.error.message}</p> : null}
        {approval ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">Approval is required for this exact action before Clyra continues.</p> : null}
        {(resumable || approval) && onResume ? (
          <button
            type="button"
            onClick={() => {
              setResuming(true);
              void onResume(mission).finally(() => setResuming(false));
            }}
            disabled={resuming}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {resuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {approval ? "Approve & continue" : "Resume task"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
