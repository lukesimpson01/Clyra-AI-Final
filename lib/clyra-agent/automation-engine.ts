import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { MissionPlan, MissionRecord } from "./core";

export type AutomationState = "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED";
export type AutomationSchedule =
  | { kind: "once"; at: number }
  | { kind: "interval"; everyMs: number; startsAt?: number };

export type ClyraAutomation = {
  id: string;
  name: string;
  objective: string;
  plan: MissionPlan;
  schedule: AutomationSchedule;
  trigger: string;
  connectedCapabilities: string[];
  state: AutomationState;
  nextRunAt: number | null;
  lastRunAt?: number;
  lastResult?: { state: MissionRecord["state"]; message: string; missionId: string; at: number };
  createdAt: number;
  updatedAt: number;
};

type AutomationRunner = (input: { missionId: string; projectId: string; plan: MissionPlan }) => Promise<MissionRecord>;

function nextRun(schedule: AutomationSchedule, from: number) {
  if (schedule.kind === "once") return schedule.at > from ? schedule.at : null;
  if (Number.isFinite(schedule.startsAt) && Number(schedule.startsAt) > from) return Number(schedule.startsAt);
  return from + schedule.everyMs;
}

function scheduleIsValid(schedule: AutomationSchedule) {
  return schedule.kind === "once"
    ? Number.isFinite(schedule.at) && schedule.at > 0
    : Number.isFinite(schedule.everyMs)
      && schedule.everyMs >= 60_000
      && schedule.everyMs <= 366 * 24 * 60 * 60_000
      && (schedule.startsAt == null || (Number.isFinite(schedule.startsAt) && schedule.startsAt > 0));
}

const durationMs = (amount: number, unit: string) => {
  const normalized = unit.toLowerCase();
  const base = normalized.startsWith("minute") ? 60_000
    : normalized.startsWith("hour") ? 60 * 60_000
      : 24 * 60 * 60_000;
  return amount * base;
};

function nextLocalTime(now: number, weekday?: number) {
  const date = new Date(now);
  date.setHours(9, 0, 0, 0);
  if (weekday == null) {
    if (date.getTime() <= now) date.setDate(date.getDate() + 1);
    return date.getTime();
  }
  const days = (weekday - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + (days || (date.getTime() <= now ? 7 : 0)));
  return date.getTime();
}

/** Parse the deliberately small, explicit schedule grammar that Chat exposes.
 * We avoid fuzzy date claims: every numeric duration, morning, and weekday has
 * one concrete next run time stored with the automation. */
export function parseAutomationPrompt(input: string, now = Date.now()) {
  const text = input.trim().replace(/^\/automate\s+/i, "");
  const every = text.match(/^every\s+(\d{1,4})\s*(minutes?|hours?|days?)\s*(?:[,;:\-]\s*)?(.+)$/i);
  if (every) {
    const amount = Number(every[1]);
    const everyMs = durationMs(amount, every[2]);
    const objective = every[3].trim();
    if (!objective || !scheduleIsValid({ kind: "interval", everyMs })) return null;
    return {
      objective,
      name: objective.slice(0, 120),
      trigger: `Every ${amount} ${every[2].toLowerCase()}`,
      schedule: { kind: "interval", everyMs } as AutomationSchedule,
    };
  }
  const once = text.match(/^in\s+(\d{1,4})\s*(minutes?|hours?|days?)\s*(?:[,;:\-]\s*)?(.+)$/i);
  if (once) {
    const amount = Number(once[1]);
    const objective = once[3].trim();
    const at = now + durationMs(amount, once[2]);
    if (!objective || !scheduleIsValid({ kind: "once", at })) return null;
    return {
      objective,
      name: objective.slice(0, 120),
      trigger: `In ${amount} ${once[2].toLowerCase()}`,
      schedule: { kind: "once", at } as AutomationSchedule,
    };
  }
  const morning = text.match(/^every\s+morning\s*(?:[,;:\-]\s*)?(.+)$/i);
  if (morning?.[1]?.trim()) {
    return {
      objective: morning[1].trim(),
      name: morning[1].trim().slice(0, 120),
      trigger: "Every morning at 9:00 AM",
      schedule: { kind: "interval", everyMs: 24 * 60 * 60_000, startsAt: nextLocalTime(now) } as AutomationSchedule,
    };
  }
  const weekdays: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const weekday = text.match(/^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*(?:[,;:\-]\s*)?(.+)$/i);
  if (weekday?.[1] && weekday[2]?.trim()) {
    const day = weekday[1].toLowerCase();
    return {
      objective: weekday[2].trim(),
      name: weekday[2].trim().slice(0, 120),
      trigger: `Every ${weekday[1][0].toUpperCase()}${day.slice(1)} at 9:00 AM`,
      schedule: { kind: "interval", everyMs: 7 * 24 * 60 * 60_000, startsAt: nextLocalTime(now, weekdays[day]) } as AutomationSchedule,
    };
  }
  return null;
}

/** Lightweight SQLite scheduler for verified, server-owned mission plans.
 * It deliberately stores plans rather than prompts, keeps a single task per
 * automation in flight, and never replays missed one-time runs after restart. */
export class AutomationEngine {
  private db: Database.Database;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();

  constructor(filename: string, private runMission: AutomationRunner, private now: () => number = Date.now) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS clyra_automations (
      id TEXT PRIMARY KEY, state TEXT NOT NULL, next_run_at INTEGER,
      updated_at INTEGER NOT NULL, payload TEXT NOT NULL
    );`);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 15_000);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  close() {
    this.stop();
    this.db.close();
  }

  list() {
    return (this.db.prepare("SELECT payload FROM clyra_automations ORDER BY updated_at DESC").all() as Array<{ payload: string }>)
      .flatMap((row) => this.decode(row.payload));
  }

  get(id: string) {
    const row = this.db.prepare("SELECT payload FROM clyra_automations WHERE id=?").get(id) as { payload?: string } | undefined;
    return row?.payload ? this.decode(row.payload)[0] || null : null;
  }

  create(input: Omit<ClyraAutomation, "id" | "state" | "nextRunAt" | "createdAt" | "updatedAt"> & { id?: string }) {
    if (!input.name.trim() || !input.objective.trim() || !input.plan?.steps?.length || !scheduleIsValid(input.schedule)) {
      throw new Error("Automation requires a name, a verified mission plan, and a valid schedule.");
    }
    const now = this.now();
    const record: ClyraAutomation = {
      id: input.id || `automation-${crypto.randomUUID()}`,
      name: input.name.trim().slice(0, 160),
      objective: input.objective.trim().slice(0, 8_000),
      plan: structuredClone(input.plan),
      schedule: input.schedule,
      trigger: input.trigger.trim().slice(0, 160) || "Scheduled",
      connectedCapabilities: [...new Set(input.connectedCapabilities)].slice(0, 16),
      state: "ACTIVE",
      nextRunAt: nextRun(input.schedule, now),
      createdAt: now,
      updatedAt: now,
    };
    this.save(record);
    return record;
  }

  pause(id: string) {
    const record = this.get(id);
    if (!record || record.state === "COMPLETED") return record;
    record.state = "PAUSED";
    record.nextRunAt = null;
    record.updatedAt = this.now();
    this.save(record);
    return record;
  }

  resume(id: string) {
    const record = this.get(id);
    if (!record || record.state === "COMPLETED") return record;
    record.state = "ACTIVE";
    record.nextRunAt = nextRun(record.schedule, this.now());
    record.updatedAt = this.now();
    this.save(record);
    return record;
  }

  async runNow(id: string) {
    const record = this.get(id);
    if (!record || record.state !== "ACTIVE" || this.running.has(id)) return record;
    await this.run(record);
    return this.get(id);
  }

  private async tick() {
    const now = this.now();
    for (const record of this.list()) {
      if (record.state !== "ACTIVE" || record.nextRunAt == null || record.nextRunAt > now || this.running.has(record.id)) continue;
      void this.run(record);
    }
  }

  private async run(record: ClyraAutomation) {
    this.running.add(record.id);
    const startedAt = this.now();
    try {
      const mission = await this.runMission({
        missionId: `${record.id}-${startedAt}`,
        projectId: `automation:${record.id}`,
        plan: structuredClone(record.plan),
      });
      const current = this.get(record.id);
      if (!current) return;
      current.lastRunAt = startedAt;
      current.lastResult = {
        state: mission.state,
        message: mission.state === "COMPLETED" ? "Verified task completed." : mission.error?.message || `Task ended ${mission.state.toLowerCase()}.`,
        missionId: mission.id,
        at: this.now(),
      };
      // Pausing an automation stops future scheduling but deliberately does
      // not pretend an already-started mission was cancelled. Keep the
      // returned evidence while preserving the requested schedule state.
      if (current.state !== "PAUSED") {
        current.nextRunAt = current.schedule.kind === "once" ? null : nextRun(current.schedule, this.now());
        current.state = current.schedule.kind === "once" ? (mission.state === "COMPLETED" ? "COMPLETED" : "FAILED") : "ACTIVE";
      }
      current.updatedAt = this.now();
      this.save(current);
    } catch (error) {
      const current = this.get(record.id);
      if (current) {
        current.lastRunAt = startedAt;
        current.lastResult = { state: "FAILED", message: error instanceof Error ? error.message : "Automation task failed.", missionId: `${record.id}-${startedAt}`, at: this.now() };
        if (current.state !== "PAUSED") {
          current.nextRunAt = current.schedule.kind === "once" ? null : nextRun(current.schedule, this.now());
          current.state = current.schedule.kind === "once" ? "FAILED" : "ACTIVE";
        }
        current.updatedAt = this.now();
        this.save(current);
      }
    } finally {
      this.running.delete(record.id);
    }
  }

  private save(record: ClyraAutomation) {
    this.db.prepare(`INSERT INTO clyra_automations(id,state,next_run_at,updated_at,payload) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at,payload=excluded.payload`)
      .run(record.id, record.state, record.nextRunAt, record.updatedAt, JSON.stringify(record));
  }

  private decode(raw: string) {
    try {
      const parsed = JSON.parse(raw) as ClyraAutomation;
      return parsed?.id && parsed.plan?.objective && scheduleIsValid(parsed.schedule) ? [parsed] : [];
    } catch {
      return [];
    }
  }
}
