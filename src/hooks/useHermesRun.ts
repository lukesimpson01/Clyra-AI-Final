import { useCallback, useEffect, useRef, useState } from "react";
import type { MissionStatus, MissionStatusStep } from "../components/MissionStatusCard";

/**
 * A single Cowork task's live Hermes run. This talks to the exact same
 * server endpoints Chat's own agentic replies already use
 * (`/api/agent/hermes/runs*`, `lib/clyra-agent/hermes-runtime.ts`) and
 * normalizes events the same way Chat's `updateHermesMissionEvent` does, so
 * Cowork and Chat present identical, real (never simulated) agent activity
 * from the same backend rather than each inventing their own protocol.
 */

type HermesEvent = { type?: string; app?: string; label?: string; agentId?: string; timestamp?: number };

export type HermesRunState = {
  runId: string;
  sessionId: string;
  mission: MissionStatus;
  content: string;
};

function eventTimestamp(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return value < 100_000_000_000 ? value * 1_000 : value;
}

function applyEvent(prior: MissionStatus, event: HermesEvent): { mission: MissionStatus; content: string } {
  const description = String(event.label || event.app || "Clyra is working").slice(0, 280);
  const trace = { at: eventTimestamp(event.timestamp), state: prior.state, event: description, toolId: event.app };
  const steps = [...prior.plan.steps];
  const agents = [...(prior.agents || [])];
  const running = [...steps].reverse().find((step) => step.status === "running");

  if (event.type === "tool_start" || event.type === "agent_start") {
    if (running?.description !== description) {
      if (running) running.status = "completed";
      steps.push({ id: `live-${event.type}-${event.timestamp || Date.now()}`, description, status: "running" });
    }
  } else if (event.type === "tool_complete" || event.type === "agent_complete") {
    if (running) running.status = "completed";
  } else if (event.type === "error") {
    if (running) running.status = "failed";
  } else if (event.type === "complete") {
    if (running) running.status = "completed";
  } else if (running) {
    running.description = description;
  }

  if ((event.type === "agent_start" || event.type === "agent_complete") && event.agentId) {
    const existing = agents.find((agent) => agent.id === event.agentId);
    const status: "working" | "completed" = event.type === "agent_complete" ? "completed" : "working";
    if (existing) {
      existing.status = status;
      existing.label = description || existing.label;
      existing.app = event.app || existing.app;
    } else {
      agents.push({ id: event.agentId, label: description || `Agent ${agents.length + 1}`, status, app: event.app, startedAt: trace.at });
    }
  }

  const terminal = event.type === "complete" || event.type === "error";
  const cancelled = /cancel(?:led|ed)|stopp?ed/i.test(description);
  const failed = event.type === "error" || /\b(?:failed|error|interrupted)\b/i.test(description);
  const state: MissionStatus["state"] = terminal
    ? (cancelled ? "CANCELLED" : failed ? "FAILED" : "COMPLETED")
    : event.type === "approval" ? "WAITING_FOR_APPROVAL"
      : prior.state === "PLANNING" ? "EXECUTING" : prior.state;

  return {
    mission: {
      ...prior,
      state,
      plan: { ...prior.plan, steps: steps.slice(-12) as MissionStatusStep[] },
      agents: agents.slice(-8),
      traces: [...(prior.traces || []), trace].slice(-20),
      ...(state === "FAILED" ? { error: { message: description } } : {}),
      updatedAt: Date.now(),
    },
    content: state === "COMPLETED"
      ? "Done — Clyra completed the task. Open the activity trail for the verified work."
      : state === "CANCELLED"
        ? "Stopped. Clyra kept the work that completed before the stop."
        : state === "FAILED"
          ? `Clyra needs attention: ${description}`
          : state === "WAITING_FOR_APPROVAL"
            ? "Clyra needs your approval for the exact action it paused before."
            : "Clyra is working through the task.",
  };
}

export function useHermesRun() {
  const [run, setRun] = useState<HermesRunState | null>(null);
  const runRef = useRef<HermesRunState | null>(null);
  runRef.current = run;
  const ignoredRunsRef = useRef(new Set<string>());
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingEventRef = useRef<HermesEvent | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const patchMission = useCallback((event: HermesEvent) => {
    setRun((current) => {
      if (!current) return current;
      const { mission, content } = applyEvent(current.mission, event);
      return { ...current, mission, content };
    });
  }, []);

  const flushPendingEvent = useCallback(() => {
    flushTimerRef.current = null;
    const event = pendingEventRef.current;
    pendingEventRef.current = null;
    if (event) patchMission(event);
  }, [patchMission]);

  const queueEvent = useCallback((event: HermesEvent) => {
    pendingEventRef.current = event;
    if (event.type === "complete" || event.type === "approval") {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      flushPendingEvent();
      return;
    }
    if (flushTimerRef.current === null) flushTimerRef.current = window.setTimeout(flushPendingEvent, 90);
  }, [flushPendingEvent]);

  const syncRunStatus = useCallback(async (runId: string) => {
    try {
      const response = await fetch(`/api/agent/hermes/runs/${encodeURIComponent(runId)}`);
      const payload = await response.json().catch(() => null) as {
        run?: { status?: unknown; output?: unknown; error?: unknown; interrupted?: unknown; updated_at?: unknown };
      } | null;
      if (!response.ok || !payload?.run) return false;
      const status = String(payload.run.status || "").toLowerCase();
      const output = typeof payload.run.output === "string" ? payload.run.output.trim().slice(0, 12_000) : "";
      const error = typeof payload.run.error === "string" ? payload.run.error.trim().slice(0, 800) : "";
      const cancelled = /cancel|stopp?ed/.test(status) || Boolean(payload.run.interrupted);
      const failed = /fail|error|interrupt/.test(status) || Boolean(error);
      const completed = /complete|finish|success/.test(status);
      if (!cancelled && !failed && !completed) return false;
      patchMission({
        type: failed ? "error" : "complete",
        label: cancelled ? "Run stopped" : failed ? (error || "The run ended before it could complete.") : "Run completed",
        timestamp: eventTimestamp(payload.run.updated_at),
      });
      if (completed && output) setRun((current) => current ? { ...current, content: output } : current);
      return true;
    } catch {
      return false;
    }
  }, [patchMission]);

  const openEventStream = useCallback((runId: string) => {
    eventSourceRef.current?.close();
    const source = new EventSource(`/api/agent/hermes/runs/${encodeURIComponent(runId)}/events`);
    eventSourceRef.current = source;
    const close = () => { source.close(); if (eventSourceRef.current === source) eventSourceRef.current = null; };
    source.onmessage = (message) => {
      if (ignoredRunsRef.current.has(runId)) { close(); return; }
      try {
        const event = JSON.parse(message.data) as HermesEvent;
        queueEvent(event);
        if (event.type === "complete" || event.type === "error") void syncRunStatus(runId).finally(close);
      } catch {
        // Malformed progress frames do not alter durable mission state.
      }
    };
    source.onerror = () => {
      if (ignoredRunsRef.current.has(runId)) { close(); return; }
      void syncRunStatus(runId).then((terminal) => { if (terminal) close(); });
    };
    return close;
  }, [queueEvent, syncRunStatus]);

  const start = useCallback(async (objective: string) => {
    const sessionId = crypto.randomUUID();
    const initialMission: MissionStatus = {
      id: "pending",
      state: "PLANNING",
      plan: { objective, steps: [{ id: "plan", description: "Planning the task", status: "running" }] },
    };
    setRun({ runId: "pending", sessionId, mission: initialMission, content: "" });
    const response = await fetch("/api/agent/hermes/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: objective, sessionId, idempotencyKey: `cowork-${sessionId}` }),
    });
    const payload = await response.json().catch(() => null) as { run?: Record<string, unknown>; error?: string } | null;
    const runId = String(payload?.run?.run_id || payload?.run?.id || "");
    if (!response.ok || !runId) {
      const message = payload?.error || "Clyra's local agent runtime is unavailable.";
      setRun((current) => current ? { ...current, mission: { ...current.mission, state: "FAILED", error: { message } }, content: message } : current);
      throw new Error(message);
    }
    setRun((current) => current ? { ...current, runId, mission: { ...current.mission, id: runId } } : current);
    openEventStream(runId);
    return runId;
  }, [openEventStream]);

  const stop = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    const response = await fetch(`/api/agent/hermes/runs/${encodeURIComponent(current.runId)}/stop`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "Clyra could not stop this run.");
    patchMission({ type: "complete", label: "Run stopped", timestamp: Date.now() });
  }, [patchMission]);

  const pause = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    ignoredRunsRef.current.add(current.runId);
    const response = await fetch(`/api/agent/hermes/runs/${encodeURIComponent(current.runId)}/stop`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) { ignoredRunsRef.current.delete(current.runId); throw new Error(payload?.error || "Clyra could not pause this run."); }
    setRun((prev) => prev ? {
      ...prev,
      mission: { ...prev.mission, state: "PAUSED", traces: [...(prev.mission.traces || []), { at: Date.now(), state: "PAUSED", event: "Paused at a safe checkpoint" }].slice(-20) },
      content: "Paused at a safe checkpoint. Clyra will re-observe the current state before it resumes.",
    } : prev);
  }, []);

  const resume = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    const response = await fetch("/api/agent/hermes/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: `Resume this Clyra task. Re-observe the live state before acting, then continue and validate the result: ${current.mission.plan.objective}`,
        sessionId: current.sessionId,
        idempotencyKey: `cowork-resume-${current.sessionId}-${Date.now()}`,
      }),
    });
    const payload = await response.json().catch(() => null) as { run?: Record<string, unknown>; error?: string } | null;
    const runId = String(payload?.run?.run_id || payload?.run?.id || "");
    if (!response.ok || !runId) throw new Error(payload?.error || "Clyra could not resume this run.");
    setRun((prev) => prev ? {
      ...prev,
      runId,
      mission: {
        ...prev.mission,
        id: runId,
        state: "PLANNING",
        plan: {
          ...prev.mission.plan,
          steps: [...prev.mission.plan.steps.map((step) => step.status === "running" ? { ...step, status: "pending" as const } : step),
            { id: `resume-${Date.now()}`, description: "Re-observing the task before resuming", status: "running" as const }].slice(-12),
        },
        traces: [...(prev.mission.traces || []), { at: Date.now(), state: "PLANNING", event: "Resuming from the safe checkpoint" }].slice(-20),
      },
      content: "Clyra is re-observing the task and continuing from the safe checkpoint.",
    } : prev);
    openEventStream(runId);
  }, [openEventStream]);

  const approve = useCallback(async () => {
    const current = runRef.current;
    if (!current) return;
    const response = await fetch(`/api/agent/hermes/runs/${encodeURIComponent(current.runId)}/approval`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "once" }),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "Clyra could not approve this exact action.");
    patchMission({ type: "planning", label: "Approval granted — continuing safely", timestamp: Date.now() });
  }, [patchMission]);

  const reset = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setRun(null);
  }, []);

  useEffect(() => () => { eventSourceRef.current?.close(); if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current); }, []);

  return { run, start, stop, pause, resume, approve, reset };
}
