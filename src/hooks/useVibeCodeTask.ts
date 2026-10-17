import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FileDiff, type OpenCodeMessage, type PreviewSession } from "../components/clyra-code/api";

/**
 * Drives a real Clyra Code (Vibe Coder) project from Cowork — the exact same
 * `/api/vibe/*` + `/api/opencode/*` HTTP contract, the exact same
 * `src/components/clyra-code/api.ts` client, and therefore the exact same
 * live execution engine (the DeepSeek Harness runtime behind
 * `lib/coding-backend.ts`) that the standalone Vibe Coder app uses. Cowork
 * never re-implements coding-agent execution; it only starts and observes a
 * real project through the same front door.
 */

export type VibeCodeTaskStatus = "starting" | "running" | "idle" | "failed" | "cancelled";

export type VibeCodeTaskState = {
  projectId: string;
  sessionId: string;
  objective: string;
  status: VibeCodeTaskStatus;
  messages: OpenCodeMessage[];
  diff: FileDiff[];
  preview: PreviewSession | null;
  error?: string;
};

function titleFrom(objective: string) {
  return objective.replace(/\s+/g, " ").trim().slice(0, 72) || "Cowork project";
}

function isBusy(messages: OpenCodeMessage[]) {
  return messages.some((message) =>
    message.parts.some((part) => part.state?.status === "pending" || part.state?.status === "running"));
}

export function useVibeCodeTask() {
  const [task, setTask] = useState<VibeCodeTaskState | null>(null);
  const taskRef = useRef<VibeCodeTaskState | null>(null);
  taskRef.current = task;
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const poll = useCallback((projectId: string, sessionId: string) => {
    stopPolling();
    // The harness appears to clear its in-memory transcript once a turn
    // settles (observed live: a real, file-verified completed run later
    // polled back an empty message array). Once real messages have been
    // seen, a later empty response means "the harness recycled its session
    // after finishing," not "the project reset to idle" — keep the last
    // known transcript rather than discarding real, already-verified work.
    let sawMessages = false;
    // The first `previewStart` (fired from `start()`) usually races the
    // harness before it has written an entry file yet, so it commonly comes
    // back `build_failed`/"index.html entry point" — observed live. Retry it
    // periodically while the preview isn't actually ready, so the panel
    // picks up a real live preview as soon as the agent creates one instead
    // of being stuck showing that first, now-stale failure forever.
    let lastPreviewAttempt = 0;
    // The message-part-based busy check alone is not reliable: a brief gap
    // between the harness's own tool calls (it "thinking" before its next
    // action) looks identical to genuine completion and was observed live
    // to end polling while the harness kept working in the background and
    // went on to create real files afterward. `/api/opencode/diagnostic`
    // reports the runtime manager's own `running`/`activeRuns` state, which
    // stays true for the whole turn regardless of message gaps — prefer it
    // whenever it's reachable, and only fall back to the message heuristic
    // if the diagnostic call itself fails.
    pollRef.current = window.setInterval(async () => {
      try {
        const [messages, diff, preview, diagnostic] = await Promise.all([
          api.sessionMessages(projectId, sessionId),
          api.sessionDiff(projectId, sessionId).catch(() => [] as FileDiff[]),
          api.previewStatus(projectId).catch(() => null),
          api.diagnostic(projectId).catch(() => null),
        ]);
        if (messages.length > 0) sawMessages = true;
        const previewReady = preview?.status === "ready" || preview?.status === "running";
        if (!previewReady && Date.now() - lastPreviewAttempt > 5_000) {
          lastPreviewAttempt = Date.now();
          void api.previewStart(projectId).catch(() => undefined);
        }
        setTask((current) => {
          if (!current || current.projectId !== projectId || current.status === "cancelled") return current;
          const effectiveMessages = messages.length > 0 || !sawMessages ? messages : current.messages;
          const activeRuns = diagnostic && Array.isArray((diagnostic as { activeRuns?: unknown }).activeRuns)
            ? (diagnostic as { activeRuns: string[] }).activeRuns
            : null;
          // Prefer the specific per-session signal (`activeRuns`) over the
          // project-level `running` flag, which can stay true just because
          // the harness subprocess is kept warm between turns.
          const busy = activeRuns
            ? activeRuns.includes(sessionId)
            : diagnostic && typeof (diagnostic as { running?: unknown }).running === "boolean"
              ? Boolean((diagnostic as { running: boolean }).running)
              : effectiveMessages.length === 0 || isBusy(effectiveMessages);
          const status: VibeCodeTaskStatus = busy ? "running" : "idle";
          if (status !== "running") stopPolling();
          return { ...current, messages: effectiveMessages, diff: diff.length ? diff : current.diff, preview, status };
        });
      } catch {
        // A transient poll failure must not blow away the last known state.
      }
    }, 1500);
  }, [stopPolling]);

  const start = useCallback(async (objective: string) => {
    stopPolling();
    setTask({ projectId: "", sessionId: "", objective, status: "starting", messages: [], diff: [], preview: null });
    try {
      const project = await api.createProject(titleFrom(objective), objective);
      await api.startRuntime(project.id);
      const session = await api.createSession(project.id, titleFrom(objective));
      await api.sendPrompt(project.id, session.id, objective);
      void api.previewStart(project.id).catch(() => undefined);
      setTask({ projectId: project.id, sessionId: session.id, objective, status: "running", messages: [], diff: [], preview: null });
      poll(project.id, session.id);
      return { projectId: project.id, sessionId: session.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clyra's coding runtime could not start.";
      setTask((current) => current ? { ...current, status: "failed", error: message } : current);
      throw error;
    }
  }, [poll, stopPolling]);

  const stop = useCallback(async () => {
    const current = taskRef.current;
    if (!current || !current.projectId) return;
    stopPolling();
    try {
      await api.abortSession(current.projectId, current.sessionId);
    } finally {
      setTask((prev) => prev ? { ...prev, status: "cancelled" } : prev);
    }
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setTask(null);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return { task, start, stop, reset };
}
