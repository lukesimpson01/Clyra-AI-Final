import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import type { VibeEffort, VibeTaskMode } from "./preflight";

export type ModelUsageEvent = {
  id: string;
  sessionId: string;
  projectId?: string;
  runId?: string;
  model: string;
  provider: string;
  timestamp: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  status: "success" | "error" | "cancelled";
  toolCallCount: number;
  messageCount: number;
  taskType?: VibeTaskMode;
  effort?: VibeEffort;
  estimated?: boolean;
};

type UsageLedger = { version: 1; events: ModelUsageEvent[] };
export type UsageRange = "all" | "30d" | "7d";

const empty = (): UsageLedger => ({ version: 1, events: [] });
// The override is only used by deterministic unit tests; production continues
// to use the application's normal local persistence location.
const filePath = () => process.env.CLYRA_VIBE_USAGE_FILE || clyraDataPath("vibe-agent-v3-usage.json");
let writes = Promise.resolve();

async function read(): Promise<UsageLedger> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath(), "utf8")) as UsageLedger;
    return parsed?.version === 1 && Array.isArray(parsed.events) ? parsed : empty();
  } catch { return empty(); }
}

async function write(ledger: UsageLedger) {
  const destination = filePath();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(ledger), "utf8");
  await fs.rename(temporary, destination);
}

export function recordVibeUsage(event: ModelUsageEvent) {
  writes = writes.then(async () => {
    const ledger = await read();
    if (ledger.events.some((item) => item.id === event.id)) return;
    ledger.events.push(event);
    // Analytics are deliberately bounded and contain no prompts, paths or source.
    if (ledger.events.length > 10_000) ledger.events.splice(0, ledger.events.length - 10_000);
    await write(ledger);
  }).catch(() => undefined);
  return writes;
}

// Dates in the ledger are instants; analytics are presented in the user's local
// calendar. Keep all calendar arithmetic at local noon so DST never shifts an
// activity record into a neighbouring date.
const localDay = (timestamp: number) => new Date(timestamp).toLocaleDateString("en-CA");
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const dateAtNoon = (day: string) => new Date(`${day}T12:00:00`);
const shiftDay = (day: string, amount: number) => {
  const value = dateAtNoon(day);
  value.setDate(value.getDate() + amount);
  return localDay(value.getTime());
};
const startFor = (range: UsageRange, today: string) => range === "all" ? null : shiftDay(today, -(range === "7d" ? 6 : 29));
const betweenDays = (start: string, end: string) => {
  const result: string[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) result.push(day);
  return result;
};

function streaks(days: string[], today: number) {
  const active = new Set(days);
  const ordered = [...active].sort();
  let longest = 0; let running = 0; let previous = "";
  for (const day of ordered) {
    const next = new Date(`${day}T12:00:00`).getTime();
    const prior = previous ? new Date(`${previous}T12:00:00`).getTime() : 0;
    running = previous && next - prior === 86_400_000 ? running + 1 : 1;
    longest = Math.max(longest, running); previous = day;
  }
  const todayKey = localDay(today);
  const yesterdayKey = localDay(today - 86_400_000);
  if (!active.has(todayKey) && !active.has(yesterdayKey)) return { current: 0, longest };
  let cursor = active.has(todayKey) ? todayKey : yesterdayKey;
  let current = 0;
  while (active.has(cursor)) {
    current += 1;
    cursor = localDay(new Date(`${cursor}T12:00:00`).getTime() - 86_400_000);
  }
  return { current, longest };
}

export async function getVibeUsageAnalytics(range: UsageRange = "all", now = Date.now()) {
  const ledger = await read();
  const today = localDay(now);
  const rangeStart = startFor(range, today);
  const events = ledger.events.filter((event) => event.timestamp <= now && (!rangeStart || localDay(event.timestamp) >= rangeStart));
  const meaningfulDays = (items: ModelUsageEvent[]) => [...new Set(items
    .filter((event) => event.messageCount > 0 || event.toolCallCount > 0)
    .map((event) => localDay(event.timestamp)))].sort();
  const allDays = meaningfulDays(ledger.events.filter((event) => event.timestamp <= now));
  const totals = events.reduce((summary, event) => ({
    tokens: summary.tokens + number(event.totalTokens),
    messages: summary.messages + number(event.messageCount),
    tools: summary.tools + number(event.toolCallCount),
  }), { tokens: 0, messages: 0, tools: 0 });
  const sessions = new Set(events.map((event) => event.sessionId));
  const days = meaningfulDays(events);
  const hours = new Map<number, number>();
  const byModel = new Map<string, { model: string; provider: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number; latencyTotal: number; errors: number; toolCalls: number; sessions: Set<string> }>();
  const heatmap = new Map<string, { date: string; sessions: Set<string>; messages: number; tokens: number; activeMinutes: number; runs: number }>();
  for (const event of events) {
    const hour = new Date(event.timestamp).getHours(); hours.set(hour, (hours.get(hour) ?? 0) + Math.max(1, event.messageCount));
    const key = `${event.provider}:${event.model}`;
    const model = byModel.get(key) ?? { model: event.model, provider: event.provider, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyTotal: 0, errors: 0, toolCalls: 0, sessions: new Set<string>() };
    model.requests += 1; model.inputTokens += number(event.inputTokens); model.outputTokens += number(event.outputTokens); model.totalTokens += number(event.totalTokens); model.latencyTotal += number(event.latencyMs); model.errors += event.status === "error" ? 1 : 0; model.toolCalls += number(event.toolCallCount); model.sessions.add(event.sessionId); byModel.set(key, model);
    const date = localDay(event.timestamp); const day = heatmap.get(date) ?? { date, sessions: new Set(), messages: 0, tokens: 0, activeMinutes: 0, runs: 0 };
    day.sessions.add(event.sessionId); day.messages += number(event.messageCount); day.tokens += number(event.totalTokens); day.activeMinutes += Math.max(0, Math.round(number(event.latencyMs) / 60_000)); day.runs += 1; heatmap.set(date, day);
  }
  const peak = [...hours.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const models = [...byModel.values()].sort((a, b) => b.requests - a.requests || b.totalTokens - a.totalTokens).map((model) => ({
    model: model.model, provider: model.provider, requests: model.requests, inputTokens: model.inputTokens, outputTokens: model.outputTokens, totalTokens: model.totalTokens, toolCalls: model.toolCalls, sessions: model.sessions.size,
    avgLatencyMs: model.requests ? Math.round(model.latencyTotal / model.requests) : 0, errorRate: model.requests ? model.errors / model.requests : 0,
  }));
  // A relative rank is more useful than raw token totals: one very large run
  // should not flatten every ordinary workday to the lightest colour.
  const score = (day: { sessions: Set<string>; messages: number; tokens: number; runs: number }) => Math.log1p(day.sessions.size * 2 + day.messages + day.runs + Math.min(12, day.tokens / 75_000));
  const rankedScores = [...heatmap.values()].map(score).sort((a, b) => a - b);
  const levelFor = (day: { sessions: Set<string>; messages: number; tokens: number; runs: number }) => {
    const value = score(day);
    const rank = rankedScores.findLastIndex((item) => item <= value) + 1;
    return rankedScores.length ? Math.max(1, Math.min(4, Math.ceil((rank / rankedScores.length) * 4))) : 0;
  };
  // The heatmap is intentionally a complete calendar rather than an array of
  // event dates. This is the data-layer guard against isolated activity strips.
  const earliest = allDays[0] ?? shiftDay(today, -27);
  const recentStart = shiftDay(today, -27);
  // All starts at the earliest activity once there is enough history, but a
  // newly created ledger still gets a readable four-week contribution grid.
  const calendarStart = rangeStart ?? (earliest < shiftDay(today, -181)
    ? shiftDay(today, -181)
    : earliest < recentStart ? earliest : recentStart);
  const cells = betweenDays(calendarStart, today).map((date) => {
    const day = heatmap.get(date);
    return day ? {
      date, sessions: day.sessions.size, messages: day.messages, tokens: day.tokens, activeMinutes: day.activeMinutes, runs: day.runs,
      level: levelFor(day),
    } : { date, sessions: 0, messages: 0, tokens: 0, activeMinutes: 0, runs: 0, level: 0 };
  });
  const series = streaks(allDays, now);
  const favorite = models[0]?.model ?? null;
  const insight = series.current > 1
    ? `You've coded on ${series.current} consecutive days.`
    : days.length > 0
      ? `You were active on ${days.length} ${days.length === 1 ? "day" : "days"} in this period.`
      : peak !== undefined
        ? `Your most active hour is ${formatHour(peak)}.`
        : "Your Vibe Coder activity will appear here as you work.";
  return { range, calendarStart, calendarEnd: today, sessions: sessions.size, messages: totals.messages, totalTokens: totals.tokens, activeDays: days.length, currentStreak: series.current, longestStreak: series.longest, peakHour: peak === undefined ? null : formatHour(peak), favoriteModel: favorite, models, heatmap: cells, insight };
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM"; const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}
