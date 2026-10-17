import { useState } from "react";
import { CalendarClock, Check, CircleAlert, Loader2, Pause, Play, TimerReset } from "lucide-react";

export type AutomationStatus = {
  id: string;
  name: string;
  objective: string;
  trigger: string;
  state: "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED";
  nextRunAt: number | null;
  connectedCapabilities: string[];
  lastResult?: { state: string; message: string; missionId: string; at: number };
};

function statePresentation(state: AutomationStatus["state"]) {
  if (state === "ACTIVE") return { label: "Scheduled", tone: "bg-blue-50 text-blue-700 ring-blue-100" };
  if (state === "PAUSED") return { label: "Schedule paused", tone: "bg-slate-100 text-slate-600 ring-slate-200" };
  if (state === "COMPLETED") return { label: "Completed", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
  return { label: "Needs attention", tone: "bg-rose-50 text-rose-700 ring-rose-100" };
}

function displayTime(value: number | null) {
  if (!value) return "No future run";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Displays persisted automation state only. Controls call the server first;
 * no schedule status or last-run result is fabricated in the client. */
export function AutomationStatusCard({
  automation,
  onPause,
  onResume,
  onRun,
}: {
  automation: AutomationStatus;
  onPause?: (automation: AutomationStatus) => Promise<void>;
  onResume?: (automation: AutomationStatus) => Promise<void>;
  onRun?: (automation: AutomationStatus) => Promise<void>;
}) {
  const [control, setControl] = useState<"pause" | "resume" | "run" | null>(null);
  const presentation = statePresentation(automation.state);
  const canRun = automation.state === "ACTIVE";
  const canPause = automation.state === "ACTIVE";
  const canResume = automation.state === "PAUSED";
  const lastSucceeded = automation.lastResult?.state === "COMPLETED";

  const trigger = (action: "pause" | "resume" | "run", handler?: (automation: AutomationStatus) => Promise<void>) => {
    if (!handler) return;
    setControl(action);
    void handler(automation).finally(() => setControl(null));
  };

  return (
    <section className="mt-4 max-w-[620px] overflow-hidden rounded-[20px] border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,.055)]" aria-label="Clyra automation status">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3.5">
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#eff6ff,#fdf4ff)] text-blue-600 shadow-[inset_0_1px_0_rgba(255,255,255,.9)]">
          {automation.state === "COMPLETED" ? <Check className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[12px] font-semibold tracking-[-.01em] text-slate-800">{automation.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ring-1 ${presentation.tone}`}>{presentation.label}</span>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{automation.objective}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 pb-3.5 pt-3">
        <div className="flex items-center justify-between gap-3 text-[11px] text-slate-600">
          <span className="inline-flex min-w-0 items-center gap-1.5"><TimerReset className="h-3.5 w-3.5 shrink-0 text-slate-400" />{automation.trigger}</span>
          <span className="shrink-0 font-medium text-slate-500">{displayTime(automation.nextRunAt)}</span>
        </div>
        {automation.connectedCapabilities.length ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Connected capabilities">
            {automation.connectedCapabilities.map((capability) => (
              <span key={capability} className="rounded-md bg-slate-100 px-2 py-1 text-[9px] font-semibold capitalize tracking-[.02em] text-slate-500">{capability}</span>
            ))}
          </div>
        ) : null}
        {automation.lastResult ? (
          <div className={`rounded-xl px-3 py-2 text-[11px] leading-4 ${lastSucceeded ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
            <span className="mr-1 inline-flex align-[-2px]">{lastSucceeded ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}</span>
            {automation.lastResult.message}
          </div>
        ) : null}
        {(canRun || canPause || canResume) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            {canRun && onRun ? (
              <button type="button" onClick={() => trigger("run", onRun)} disabled={control !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                {control === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Run now
              </button>
            ) : null}
            {canPause && onPause ? (
              <button type="button" onClick={() => trigger("pause", onPause)} disabled={control !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                {control === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                Pause schedule
              </button>
            ) : null}
            {canResume && onResume ? (
              <button type="button" onClick={() => trigger("resume", onResume)} disabled={control !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
                {control === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Resume schedule
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
