import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3 } from "lucide-react";
import { api, type VibeUsageAnalytics } from "./api";
import { cn } from "../../lib/utils";

type Range = "all" | "30d" | "7d";
type Tab = "overview" | "models";
type HeatmapCell = VibeUsageAnalytics["heatmap"][number];

const ranges: Array<[Range, string]> = [["all", "All"], ["30d", "30d"], ["7d", "7d"]];
const tabs: Array<[Tab, string]> = [["overview", "Overview"], ["models", "Models"]];
const number = (value: number) => new Intl.NumberFormat().format(value);
const compactTokens = (value: number) => {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return number(value);
};
const duration = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s` : `${ms}ms`;
const percentage = (value: number, total: number) => total ? `${Math.round((value / total) * 100)}%` : "0%";
const dayLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const weekdayIndex = (value: string) => (new Date(`${value}T12:00:00`).getDay() + 6) % 7;
const dayTooltip = (cell: HeatmapCell) => {
  if (!cell.sessions && !cell.messages && !cell.tokens && !cell.runs) return `${dayLabel(cell.date)}\nNo activity`;
  return [dayLabel(cell.date), cell.sessions ? `${cell.sessions} ${cell.sessions === 1 ? "session" : "sessions"}` : null, cell.messages ? `${cell.messages} ${cell.messages === 1 ? "message" : "messages"}` : null, cell.tokens ? `${compactTokens(cell.tokens)} tokens` : null, cell.runs ? `${cell.runs} coding ${cell.runs === 1 ? "run" : "runs"}` : null].filter(Boolean).join("\n");
};

function moveWithArrowKey<T extends string>(event: KeyboardEvent<HTMLButtonElement>, items: readonly T[], current: T, set: (value: T) => void) {
  const index = items.indexOf(current);
  const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? items[(index + 1) % items.length]
    : event.key === "ArrowLeft" || event.key === "ArrowUp" ? items[(index - 1 + items.length) % items.length]
      : event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1)! : null;
  if (next) { event.preventDefault(); set(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-usage-value="${next}"]`)?.focus(); }
}

function Skeleton() {
  return <div className="mt-4 animate-pulse" aria-label="Loading usage analytics">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[82px] rounded-[10px] bg-black/[0.045] dark:bg-white/[0.07]" />)}</div>
    <div className="mt-4 h-[156px] rounded-[10px] bg-black/[0.035] dark:bg-white/[0.055]" />
  </div>;
}

export function UsageAnalytics({ className }: { className?: string }) {
  const [range, setRange] = useState<Range>("all");
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<VibeUsageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void api.vibeUsage(range).then((next) => { if (live) { setData(next); setLoading(false); } }).catch(() => { if (live) { setData(null); setLoading(false); } });
    return () => { live = false; };
  }, [range]);

  const calendar = useMemo<Array<HeatmapCell | null>>(() => {
    if (!data?.heatmap.length) return [];
    const cells: Array<HeatmapCell | null> = [...Array(weekdayIndex(data.calendarStart)).fill(null), ...data.heatmap];
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [data]);

  const empty = !!data && data.sessions === 0 && data.messages === 0 && data.totalTokens === 0;
  const metrics = data ? [
    ["Sessions", empty ? "—" : number(data.sessions)], ["Messages", empty ? "—" : number(data.messages)], ["Total tokens", empty ? "—" : compactTokens(data.totalTokens)], ["Active days", empty ? "—" : number(data.activeDays)],
    ["Current streak", empty ? "—" : `${data.currentStreak}d`], ["Longest streak", empty ? "—" : `${data.longestStreak}d`], ["Peak hour", data.peakHour ?? "—"], ["Models used", empty ? "—" : number(data.models.length)],
  ] : [];
  const totalRequests = data?.models.reduce((sum, model) => sum + model.requests, 0) ?? 0;
  const fastest = data?.models.reduce<VibeUsageAnalytics["models"][number] | null>((best, model) => !best || model.avgLatencyMs < best.avgLatencyMs ? model : best, null) ?? null;
  const highestTokens = data?.models.length ? [...data.models].sort((a, b) => b.totalTokens - a.totalTokens)[0] : null;

  return <section aria-label="Usage analytics" className={cn("cc-usage-card mt-6 w-full overflow-hidden rounded-[18px] border border-black/[0.045] bg-[#F4F4F3] p-5 text-left shadow-none dark:border-white/[0.08] dark:bg-[#1D1E1F]", className)}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-0.5" role="tablist" aria-label="Usage analytics view">
        {tabs.map(([item, label]) => <button key={item} data-usage-value={item} type="button" role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)} onKeyDown={(event) => moveWithArrowKey<Tab>(event, ["overview", "models"], tab, setTab)} className={cn("h-7 rounded-[8px] px-2.5 text-[13px] font-medium transition-colors duration-[180ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45", tab === item ? "bg-white text-[#34363B] shadow-[0_1px_2px_rgba(0,0,0,.035)] dark:bg-white/[0.11] dark:text-white" : "text-[#8A8C91] hover:text-[#55575C] dark:hover:text-white")}>{label}</button>)}
      </div>
      <div className="flex items-center gap-0.5" role="group" aria-label="Usage analytics time range">
        {ranges.map(([value, label]) => <button key={value} data-usage-value={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)} onKeyDown={(event) => moveWithArrowKey<Range>(event, ["all", "30d", "7d"], range, setRange)} className={cn("h-7 rounded-[8px] px-2.5 text-[13px] font-medium transition-colors duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45", range === value ? "bg-white text-[#34363B] shadow-[0_1px_2px_rgba(0,0,0,.035)] dark:bg-white/[0.11] dark:text-white" : "text-[#8A8C91] hover:text-[#55575C] dark:hover:text-white")}>{label}</button>)}
      </div>
    </div>
    <AnimatePresence mode="wait" initial={false}>
      {loading ? <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}><Skeleton /></motion.div> : tab === "overview" ? <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.19 }}>
        {data ? <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{metrics.map(([label, value]) => <div key={label} className="cc-usage-metric flex min-w-0 min-h-[82px] flex-col justify-between rounded-[10px] bg-[#E9E9E7] px-3 py-2.5 dark:bg-white/[0.055]"><p className="truncate text-[12px] font-medium text-[#858780] dark:text-[#B9BBC0]">{label}</p><p title={value} className="truncate text-[20px] font-semibold leading-none tracking-[-0.035em] text-[#25272A] transition-all duration-[200ms] dark:text-[#F5F5F4]">{value}</p></div>)}</div>
          <div className="mt-4 overflow-x-auto pb-1 [scrollbar-width:thin]" aria-label="Usage activity by day"><div className="cc-usage-calendar" role="grid" aria-label={`Daily Vibe Coder activity from ${data.calendarStart} to ${data.calendarEnd}`}>
            {calendar.map((cell, index) => cell ? <span key={cell.date} role="gridcell" tabIndex={0} title={dayTooltip(cell)} aria-label={dayTooltip(cell).replaceAll("\n", ", ")} className={cn("cc-usage-cell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/55", cell.level === 0 ? "bg-[#E9E9E6] dark:bg-white/[0.10]" : cell.level === 1 ? "bg-[#D7E6FD] dark:bg-[#254471]" : cell.level === 2 ? "bg-[#A9C9F8] dark:bg-[#3163A5]" : cell.level === 3 ? "bg-[#74A7F1] dark:bg-[#3977C9]" : "bg-[#3977F6]")} /> : <span key={`placeholder-${index}`} aria-hidden="true" className="cc-usage-cell bg-transparent" />)}
          </div></div>
          {empty ? <div className="mt-3 flex items-center gap-2 text-[13px] text-[#8C8E93] dark:text-[#B6B8BD]"><BarChart3 className="h-3.5 w-3.5" strokeWidth={1.7} />Your Vibe Coder activity will appear here as you work.</div> : <p className="mt-4 text-[13px] text-[#85878C] dark:text-[#B4B6BA]">{data.insight}</p>}
        </> : <div className="mt-4 flex h-[220px] flex-col items-center justify-center gap-2 rounded-[10px] bg-white/[0.8] text-center text-[13px] text-[#8C8E93] dark:bg-white/[0.055] dark:text-[#B6B8BD]"><BarChart3 className="h-4 w-4" strokeWidth={1.5} />Unable to load Vibe Coder activity.</div>}
      </motion.div> : <motion.div key="models" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.19 }} className="mt-4">
        {data?.models.length ? <><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Models used", number(data.models.length)], ["Most used", data.models[0]?.model ?? "—"], ["Fastest", fastest?.model ?? "—"], ["Highest tokens", highestTokens?.model ?? "—"]].map(([label, value]) => <div key={label} className="min-w-0 rounded-[10px] bg-white/[0.8] px-3 py-2.5 dark:bg-white/[0.055]"><p className="truncate text-[12px] font-medium text-[#8D8F94] dark:text-[#B9BBC0]">{label}</p><p title={value} className="mt-1 truncate text-[14px] font-medium text-[#383A3F] dark:text-[#F5F5F4]">{value}</p></div>)}</div><div className="mt-3 divide-y divide-black/[0.045] rounded-[10px] bg-white/[0.8] px-3 dark:divide-white/[0.07] dark:bg-white/[0.055]">{data.models.map((model) => <div key={`${model.provider}:${model.model}`} className="py-2.5"><div className="flex items-baseline justify-between gap-3"><p className="min-w-0 truncate text-[13px] font-medium text-[#45474C] dark:text-[#F4F4F3]" title={`${model.provider}/${model.model}`}>{model.model}</p><p className="shrink-0 text-[12px] font-medium text-[#74767B]">{percentage(model.requests, totalRequests)}</p></div><p className="mt-0.5 truncate text-[11.5px] text-[#96989D]">{number(model.requests)} {model.requests === 1 ? "request" : "requests"} · {compactTokens(model.totalTokens)} tokens · {duration(model.avgLatencyMs)} · {number(model.sessions)} {model.sessions === 1 ? "session" : "sessions"}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[0.045] dark:bg-white/[0.08]"><div className="h-full rounded-full bg-[#3977F6] transition-[width] duration-200" style={{ width: percentage(model.requests, totalRequests) }} /></div></div>)}</div></> : <div className="flex h-[220px] flex-col items-center justify-center gap-2 rounded-[10px] bg-white/[0.8] text-center text-[13px] text-[#8C8E93] dark:bg-white/[0.055] dark:text-[#B6B8BD]"><BarChart3 className="h-4 w-4" strokeWidth={1.5} />Model usage will appear after Vibe Coder completes work.</div>}
      </motion.div>}
    </AnimatePresence>
  </section>;
}
