/**
 * Provider-independent task control plane for Clyra Code.
 *
 * A model harness may decide *which* tool to use, but it must not own the
 * task's lifecycle. This small controller keeps the canonical objective,
 * phase, evidence and recovery history outside the model conversation so a
 * restart, compaction or malformed model response cannot erase it.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type CodingTaskPhase =
  | "INITIALISING" | "EXPLORING" | "PLANNING" | "EXECUTING"
  | "WAITING_TOOL" | "VALIDATING" | "DEBUGGING" | "REVIEWING"
  | "WAITING_APPROVAL" | "PAUSED" | "BLOCKED" | "COMPLETED" | "CANCELLED";

export type TaskPlanStep = {
  id: string;
  objective: string;
  files: string[];
  validation: string[];
  status: "pending" | "active" | "blocked" | "complete" | "failed";
};

export type ToolAttempt = {
  fingerprint: string;
  tool: string;
  target: string;
  status: "started" | "completed" | "failed";
  error?: string;
  at: string;
};

export type CodingTaskLedger = {
  version: 1;
  sessionId: string;
  objective: string;
  phase: CodingTaskPhase;
  currentHypothesis?: string;
  plan: TaskPlanStep[];
  completed: string[];
  remaining: string[];
  blocked: string[];
  discoveries: string[];
  changedFiles: string[];
  tests: Array<{ name: string; status: "passed" | "failed" | "skipped"; output?: string }>;
  attempts: ToolAttempt[];
  recoveryCount: number;
  pauseRequested: boolean;
  cancellationRequested: boolean;
  createdAt: string;
  updatedAt: string;
};

const MAX_ATTEMPTS = 160;
const MAX_RECOVERIES = 3;

function now() { return new Date().toISOString(); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, ""); }

export class CodingTaskController {
  private writeChain = Promise.resolve();
  public constructor(private readonly projectRoot: string, private readonly sessionId: string) {}

  private file() {
    return path.join(this.projectRoot, ".clyra-runtime", "tasks", `${safeSegment(this.sessionId)}.json`);
  }

  private async write(ledger: CodingTaskLedger) {
    ledger.updatedAt = now();
    const file = this.file();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await fs.rename(`${file}.tmp`, file);
    return ledger;
  }

  private async read() {
    return JSON.parse(await fs.readFile(this.file(), "utf8")) as CodingTaskLedger;
  }

  private serial<T>(operation: () => Promise<T>) {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.then(() => undefined, () => undefined);
    return next;
  }

  async get() {
    await this.writeChain;
    return this.read();
  }

  async begin(objective: string, plan: TaskPlanStep[] = []) {
    return this.serial(async () => {
      try { return await this.read(); } catch { /* create below */ }
      const ledger: CodingTaskLedger = {
        version: 1, sessionId: this.sessionId, objective, phase: "INITIALISING", plan,
        completed: [], remaining: plan.map((step) => step.objective), blocked: [], discoveries: [], changedFiles: [], tests: [], attempts: [],
        recoveryCount: 0, pauseRequested: false, cancellationRequested: false, createdAt: now(), updatedAt: now(),
      };
      return this.write(ledger);
    });
  }

  async update(mutator: (ledger: CodingTaskLedger) => void) {
    return this.serial(async () => {
      const ledger = await this.read();
      mutator(ledger);
      ledger.completed = unique(ledger.completed);
      ledger.remaining = unique(ledger.remaining);
      ledger.blocked = unique(ledger.blocked);
      ledger.discoveries = unique(ledger.discoveries).slice(-80);
      ledger.changedFiles = unique(ledger.changedFiles).slice(-250);
      ledger.attempts = ledger.attempts.slice(-MAX_ATTEMPTS);
      return this.write(ledger);
    });
  }

  async phase(phase: CodingTaskPhase, detail?: string) {
    return this.update((ledger) => {
      ledger.phase = phase;
      if (detail) ledger.currentHypothesis = detail;
    });
  }

  async recordTool(tool: string, target: string, status: ToolAttempt["status"], error?: string) {
    const fingerprint = `${tool}:${target.replace(/\s+/g, " ").trim()}`.slice(0, 900);
    return this.update((ledger) => {
      ledger.attempts.push({ fingerprint, tool, target, status, error, at: now() });
      if (status === "failed" && error) ledger.discoveries.push(`${tool} failed: ${error.slice(0, 500)}`);
    });
  }

  async shouldChangeStrategy() {
    const ledger = await this.get();
    const recent = ledger.attempts.slice(-6);
    const last = recent.at(-1);
    if (!last) return { stuck: false, reason: "" };
    const same = recent.filter((item) => item.fingerprint === last.fingerprint);
    const failures = same.filter((item) => item.status === "failed");
    if (failures.length >= 2) return { stuck: true, reason: `Repeated failed action: ${last.tool} ${last.target}` };
    if (same.length >= 3) return { stuck: true, reason: `Repeated action without progress: ${last.tool} ${last.target}` };
    return { stuck: false, reason: "" };
  }

  async requestPause() { return this.update((ledger) => { ledger.pauseRequested = true; ledger.phase = "PAUSED"; }); }
  async requestCancel() { return this.update((ledger) => { ledger.cancellationRequested = true; ledger.phase = "CANCELLED"; }); }
  async canRecover() { const ledger = await this.get(); return !ledger.pauseRequested && !ledger.cancellationRequested && ledger.recoveryCount < MAX_RECOVERIES; }
  async recordRecovery(reason: string) { return this.update((ledger) => { ledger.recoveryCount += 1; ledger.phase = "DEBUGGING"; ledger.discoveries.push(`Recovery ${ledger.recoveryCount}: ${reason}`); }); }
}
