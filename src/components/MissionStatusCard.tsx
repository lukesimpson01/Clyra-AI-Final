import { useState } from "react";
import { Check, ChevronDown, CircleAlert, Clock3, Loader2, Pause, RotateCcw, ShieldCheck, Square } from "lucide-react";

export type MissionStatusStep = {
  id: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "blocked" | "cancelled";
};

export type MissionStatus = {
  id: string;
  state: string;
  plan: { objective: string; steps: MissionStatusStep[] };
  /** Delegated work is compactly exposed only when a mission actually fans out. */
  agents?: Array<{
    id: string;
    label: string;
    status: "working" | "completed" | "failed";
    app?: string;
    startedAt?: number;
  }>;
  /** Runtime events are operational state only—never model deliberation. */
  traces?: Array<{ at: number; state: string; event: string; stepId?: string; toolId?: string; errorCode?: string }>;
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
  onPause,
  onStop,
  onApprove,
}: {
  mission: MissionStatus;
  onResume?: (mission: MissionStatus) => Promise<void>;
  onPause?: (mission: MissionStatus) => Promise<void>;
  onStop?: (mission: MissionStatus) => Promise<void>;
  onApprove?: (mission: MissionStatus) => Promise<void>;
}) {
  const [control, setControl] = useState<"resume" | "pause" | "stop" | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const complete = mission.plan.steps.filter((step) => step.status === "completed").length;
  const total = Math.max(1, mission.plan.steps.length);
  const status = presentation(mission.state);
  const resumable = ["PAUSED", "RECOVERING", "READY", "EXECUTING", "OBSERVING", "VERIFYING", "REPLANNING"].includes(mission.state);
  const pausable = ["UNDERSTANDING", "PLANNING", "READY", "EXECUTING", "OBSERVING", "VERIFYING", "REPLANNING", "RECOVERING"].includes(mission.state);
  const stoppable = !["COMPLETED", "FAILED", "CANCELLED"].includes(mission.state);
  const approval = mission.state === "WAITING_FOR_APPROVAL" && mission.approval;
  const activity = (mission.traces || [])
    .filter((trace) => trace.event && !/objective accepted|plan validated/i.test(trace.event))
    .slice(-3)
  const agents = mission.agents || [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) || agents[0];
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
    <section className="mt-4 max-w-[620px] overflow-hidden rounded-[20px] border border-blue-100/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,.055)]" aria-label="Mission workspace">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#eff6ff,#fdf4ff)] text-blue-600 shadow-[inset_0_1px_0_rgba(255,255,255,.9)]">
          {mission.state === "COMPLETED" ? <ShieldCheck className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12px] font-semibold tracking-[-.01em] text-slate-800">Mission</p>
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
          {mission.plan.steps.slice(0, activityOpen ? 12 : 3).map((step) => (
            <div key={step.id} className="flex items-center gap-2 text-[11px] leading-4 text-slate-600">
              <span className="grid h-4 w-4 shrink-0 place-items-center">{stepIcon(step.status)}</span>
              <span className={step.status === "completed" ? "text-slate-500" : "font-medium text-slate-700"}>{step.description}</span>
            </div>
          ))}
        </div>
        {agents.length > 1 ? (
          <div className="mt-3 border-t border-slate-100 pt-3" aria-label="Clyra agents">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[9px] font-semibold uppercase tracking-[.12em] text-slate-400">Agents</p>
              <span className="text-[10px] font-medium text-slate-400">{agents.filter((agent) => agent.status === "completed").length}/{agents.length} complete</span>
            </div>
            <div className="-mx-1 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Active Clyra agents">
              {agents.map((agent) => {
                const selected = agent.id === selectedAgent?.id;
                const done = agent.status === "completed";
                const failed = agent.status === "failed";
                return (
                  <button
                    key={agent.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[10px] font-semibold transition-colors ${selected ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-400" : failed ? "bg-rose-400" : selected ? "animate-pulse bg-blue-300" : "bg-blue-500"}`} />
                    {agent.label}
                  </button>
                );
              })}
            </div>
            {selectedAgent ? <p className="mt-1.5 text-[10px] leading-4 text-slate-500" role="tabpanel">{selectedAgent.status === "working" ? "Working" : selectedAgent.status === "completed" ? "Completed" : "Needs attention"}{selectedAgent.app ? ` · ${selectedAgent.app}` : ""}</p> : null}
          </div>
        ) : null}
        {activity.length && activityOpen ? (
          <div className="mt-3 border-t border-slate-100 pt-2.5" aria-label="Task activity">
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-[.12em] text-slate-400">Activity</p>
            <div className="space-y-1.5">
              {activity.map((trace, index) => (
                <div key={`${trace.at}-${trace.event}-${index}`} className="flex items-start gap-2 text-[10px] leading-4 text-slate-500">
                  <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${index === activity.length - 1 && !["COMPLETED", "FAILED", "CANCELLED"].includes(mission.state) ? "bg-blue-500" : "bg-slate-300"}`} />
                  <span>{trace.event}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {mission.error?.message ? <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-4 text-rose-700">{mission.error.message}</p> : null}
        {approval ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">Approval is required for this exact action before Clyra continues.</p> : null}
        {(activity.length || resumable || approval || pausable || stoppable) ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setActivityOpen((open) => !open)} className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50">
              {activityOpen ? "Hide activity" : "View activity"}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${activityOpen ? "rotate-180" : ""}`} />
            </button>
            {approval && onApprove ? (
              <button
                type="button"
                onClick={() => {
                  setControl("resume");
                  void onApprove(mission).finally(() => setControl(null));
                }}
                disabled={control !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {control === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Approve & continue
              </button>
            ) : null}
            {!approval && resumable && onResume ? (
              <button
                type="button"
                onClick={() => {
                  setControl("resume");
                  void onResume(mission).finally(() => setControl(null));
                }}
                disabled={control !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {control === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Resume task
              </button>
            ) : null}
            {pausable && onPause ? (
              <button
                type="button"
                onClick={() => {
                  setControl("pause");
                  void onPause(mission).finally(() => setControl(null));
                }}
                disabled={control !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {control === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                Pause
              </button>
            ) : null}
            {stoppable && onStop ? (
              <button
                type="button"
                onClick={() => {
                  setControl("stop");
                  void onStop(mission).finally(() => setControl(null));
                }}
                disabled={control !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {control === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
                Stop
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
