// Background job registry for Shorts. Work runs here on the server, not in the
// React tree, so navigating away never cancels it. Progress is weighted by real
// stage completion and clamped so it never decreases and never reports 100
// until the job has produced its output (`complete()` is the only path to 100).

import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobStage = {
  id: string;
  label: string;
  /** Share of the overall 0-100 bar this stage owns. Stages are summed in order. */
  weight: number;
};

export type ShortsJob = {
  id: string;
  kind: "render" | "cut" | "transcribe" | "clip-import" | "faketext-timeline";
  projectId: string | null;
  status: JobStatus;
  stageId: string;
  stageLabel: string;
  message: string;
  overall: number;
  completed: number;
  total: number;
  startedAt: number;
  updatedAt: number;
  finishedAt: number | null;
  result: unknown;
  error: string | null;
  /** Severity-tagged warnings that did not stop the job, e.g. an optional track skipped. */
  warnings: string[];
  controller: AbortController;
  stages: JobStage[];
  stageBase: number;
  subscribers: Set<ServerResponse>;
  lastBroadcast: number;
};

const jobs = new Map<string, ShortsJob>();
const JOB_RETENTION_MS = 6 * 60 * 60 * 1000;

export function createJob(input: { kind: ShortsJob["kind"]; projectId: string | null; stages: JobStage[] }): ShortsJob {
  const id = `job-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  const now = Date.now();
  const job: ShortsJob = {
    id,
    kind: input.kind,
    projectId: input.projectId,
    status: "queued",
    stageId: input.stages[0]?.id ?? "",
    stageLabel: input.stages[0]?.label ?? "Queued",
    message: "Queued",
    overall: 0,
    completed: 0,
    total: 0,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    result: null,
    error: null,
    warnings: [],
    controller: new AbortController(),
    stages: input.stages,
    stageBase: 0,
    subscribers: new Set(),
    lastBroadcast: 0,
  };
  jobs.set(id, job);
  pruneJobs();
  return job;
}

export function getJob(id: string) {
  return jobs.get(id) ?? null;
}

/** Enter a stage. Earlier stages are treated as finished so the bar keeps moving forward. */
export function enterStage(job: ShortsJob, stageId: string, message: string) {
  const index = job.stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) throw new Error(`Unknown job stage ${stageId}`);
  job.stageBase = job.stages.slice(0, index).reduce((sum, stage) => sum + stage.weight, 0);
  job.stageId = stageId;
  job.stageLabel = job.stages[index].label;
  job.message = message;
  job.status = "running";
  job.completed = 0;
  job.total = 0;
  setOverall(job, job.stageBase);
  broadcast(job, "job.stage");
}

/** Report progress inside the current stage. The overall value is clamped monotonic and below 100. */
export function reportProgress(job: ShortsJob, completed: number, total: number, message?: string) {
  job.completed = completed;
  job.total = total;
  if (message) job.message = message;
  const stage = job.stages.find((item) => item.id === job.stageId);
  const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  const value = job.stageBase + (stage?.weight ?? 0) * fraction;
  setOverall(job, Math.min(99.5, value));
  broadcast(job, "job.progress");
}

export function complete(job: ShortsJob, result: unknown) {
  job.result = result;
  job.status = "completed";
  job.stageLabel = "Done";
  job.message = "Complete";
  job.overall = 100;
  job.finishedAt = Date.now();
  job.updatedAt = Date.now();
  broadcast(job, "job.completed", true);
}

export function fail(job: ShortsJob, error: string) {
  job.status = "failed";
  job.error = error;
  job.message = error;
  job.finishedAt = Date.now();
  job.updatedAt = Date.now();
  broadcast(job, "job.failed", true);
}

export function cancel(job: ShortsJob) {
  if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") return;
  job.controller.abort();
  job.status = "cancelled";
  job.message = "Cancelled";
  job.finishedAt = Date.now();
  job.updatedAt = Date.now();
  broadcast(job, "job.cancelled", true);
}

export function warn(job: ShortsJob, message: string) {
  if (!job.warnings.includes(message)) job.warnings.push(message);
  broadcast(job, "job.log");
}

function setOverall(job: ShortsJob, value: number) {
  // Monotonic: a later stage can never make the bar go backwards.
  job.overall = Math.max(job.overall, Math.round(value * 10) / 10);
  job.updatedAt = Date.now();
}

export function jobSnapshot(job: ShortsJob) {
  return {
    id: job.id,
    kind: job.kind,
    projectId: job.projectId,
    status: job.status,
    stage: job.stageId,
    stageLabel: job.stageLabel,
    message: job.message,
    overall: job.overall,
    completed: job.completed,
    total: job.total,
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    warnings: [...job.warnings],
    error: job.error,
    result: job.result,
    timestamp: Date.now(),
  };
}

/**
 * Server-sent events. Progress is coalesced to at most ~4 messages per second so
 * a fast frame loop cannot flood the connection. Terminal events always send.
 */
export function attachSubscriber(job: ShortsJob, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  job.subscribers.add(res);
  res.write(`event: job.snapshot\ndata: ${JSON.stringify(jobSnapshot(job))}\n\n`);
  res.on("close", () => job.subscribers.delete(res));
}

function broadcast(job: ShortsJob, event: string, force = false) {
  const now = Date.now();
  if (!force && event === "job.progress" && now - job.lastBroadcast < 250) return;
  job.lastBroadcast = now;
  const payload = `event: ${event}\ndata: ${JSON.stringify(jobSnapshot(job))}\n\n`;
  for (const res of job.subscribers) {
    if (!res.writableEnded) res.write(payload);
  }
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_RETENTION_MS;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}
