import { useCallback, useEffect, useReducer, useRef } from "react";
import { getElectronDesktop } from "../lib/electron-runtime";
import { VoicePcmCapturer } from "../lib/voicePcmCapture";
import { VoiceSpeechPlayer } from "../lib/voiceSpeechPlayer";
import { TranscriptStabilizer } from "../speech/transcriptStabilizer";
import { personalDictionary, applyDictionary } from "../speech/personalDictionary";
import { VoiceActivityGate } from "../lib/voiceActivityGate";
import {
  createVoiceSessionState,
  voiceSessionReducer,
  type AgentPlanStep,
  type AgentSurface,
  type ApprovalRequest,
  type VoiceCallState,
  type VoiceTurn,
} from "../voice/state/voiceSession";

export type VoiceCallStatus = VoiceCallState;
export type { VoiceTurn };

export type UseVoiceCallOptions = {
  conversationId: string | null;
  enabled: boolean;
  chatHistory: VoiceTurn[];
  systemPrompt: string;
  temperature?: number;
  /** Test Mode: local whisper.cpp -> Fish TTS echo, DeepSeek never called. */
  testMode: boolean;
  onTurn?: (turn: { userText: string; assistantText: string }) => void;
};

type MissionStep = { id?: string; description?: string; status?: string; toolId?: string };
type MissionRecord = {
  id: string;
  state: string;
  plan?: { objective?: string; steps?: MissionStep[] };
  outputs?: Record<string, unknown>;
  approval?: { stepId?: string; toolId?: string };
  error?: { message?: string };
};

type GoogleService = "gmail" | "calendar" | "docs" | "sheets" | "slides" | "drive";
type ActiveRun =
  | { kind: "mission"; id: string }
  | { kind: "google"; id: string; service: GoogleService; prompt: string };
type PendingApproval =
  | { kind: "mission"; id: string; stepId: string }
  | { kind: "google"; id: string; service: GoogleService; prompt: string };

const TERMINAL_MISSION_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const PAUSED_MISSION_STATES = new Set(["PAUSED", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER"]);
const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function detectGoogleService(prompt: string): GoogleService | null {
  const value = prompt.toLowerCase();
  if (/\b(?:summari[sz]e|digest|brief|review)\b[\s\S]{0,120}\b(?:emails?|gmail|inbox)\b[\s\S]{0,120}\b(?:doc|document|report)\b/.test(value)) return "docs";
  if (/\b(?:gmail|inbox|emails?|check (?:my )?(?:email|mail))\b/.test(value)) return "gmail";
  if (/\b(?:google calendar|calendar|upcoming events)\b/.test(value)) return "calendar";
  if (/\b(?:google docs?|create (?:a )?(?:doc|document))\b/.test(value)) return "docs";
  if (/\b(?:google sheets?|create (?:a )?(?:sheet|spreadsheet))\b/.test(value)) return "sheets";
  if (/\b(?:google slides?|create (?:a )?(?:slide|presentation))\b/.test(value)) return "slides";
  if (/\b(?:google drive|drive file|my drive)\b/.test(value)) return "drive";
  return null;
}

function googleLabel(service: GoogleService, prompt: string) {
  if (service === "gmail") return /\b(?:send|draft|reply|compose)\b/i.test(prompt) ? "Preparing the email" : "Checking Gmail";
  if (service === "calendar") return /\b(?:create|schedule|add)\b/i.test(prompt) ? "Preparing the event" : "Checking your calendar";
  if (service === "docs") return "Working in Google Docs";
  if (service === "sheets") return "Working in Google Sheets";
  if (service === "slides") return "Working in Google Slides";
  return "Checking Google Drive";
}

function googleSurface(service: GoogleService, runId: string, prompt: string): AgentSurface {
  const kind: AgentSurface["kind"] = service === "gmail" ? "email" : service === "drive" ? "file" : "document";
  const title = service === "gmail" ? "Gmail" : service === "calendar" ? "Google Calendar" : service === "docs" ? "Google Docs" : service === "sheets" ? "Google Sheets" : service === "slides" ? "Google Slides" : "Google Drive";
  return { id: runId, kind, title, subtitle: prompt };
}

function missionSteps(mission: MissionRecord): AgentPlanStep[] {
  return (mission.plan?.steps || []).map((step, index) => ({
    id: step.id || `step-${index + 1}`,
    label: step.description || `Step ${index + 1}`,
    status: step.status === "completed" ? "complete" : step.status === "running" ? "active" : step.status === "failed" ? "blocked" : "pending",
  }));
}

function missionLabel(mission: MissionRecord) {
  const current = (mission.plan?.steps || []).find((step) => step.status === "running")
    || (mission.plan?.steps || []).find((step) => step.status === "pending");
  if (mission.state === "COMPLETED") return "Task complete";
  if (mission.state === "WAITING_FOR_APPROVAL") return "Needs your approval";
  if (mission.state === "WAITING_FOR_USER") return "Waiting for your input";
  if (mission.state === "PAUSED") return "Paused";
  if (mission.state === "FAILED") return mission.error?.message || "The task needs attention";
  return current?.description || "Clyra is working";
}

function missionResult(mission: MissionRecord) {
  if (mission.state === "COMPLETED") {
    const evidence = Object.values(mission.outputs || {}).flatMap((output) => {
      const value = output as { data?: { urls?: unknown[] }; evidence?: unknown[] };
      return [...(Array.isArray(value?.data?.urls) ? value.data.urls : []), ...(Array.isArray(value?.evidence) ? value.evidence : [])];
    });
    return { text: "Done — I completed and verified the task.", outputs: mission.outputs, evidence };
  }
  return { text: mission.error?.message || "The task stopped before it could be verified.", outputs: mission.outputs };
}


/** Compact sentence-first spoken replies so speech can begin while tokens stream. */
const VOICE_REPLY_STYLE = "You are Clyra in a real-time spoken conversation. Respond naturally and directly in one to three short sentences. Your words are spoken aloud as they stream. Do not use markdown, lists, code blocks or emoji. Remember and incorporate the full conversation; acknowledge corrections without restarting work. If asked for something complex, briefly explain what you are doing.";
const TURN_SILENCE_MS = 590;
const MIN_SPEECH_MS = 260;
const PARTIAL_EVERY_MS = 620;
const PRE_ROLL_CHUNKS = 12;
export function useVoiceCall(options: UseVoiceCallOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [session, dispatch] = useReducer(voiceSessionReducer, undefined, createVoiceSessionState);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const sessionIdRef = useRef<string | null>(null);
  const pendingUserTextRef = useRef("");
  const pendingAssistantTextRef = useRef("");
  const turnsRef = useRef<VoiceTurn[]>([]);
  const bargeInsRef = useRef(0);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const pendingApprovalRef = useRef<PendingApproval | null>(null);
  const transcriptRef = useRef(new TranscriptStabilizer());
  const taskAbortRef = useRef<AbortController | null>(null);
  const lastSideEffectRef = useRef({ text: "", at: 0 });
  const endSequenceRef = useRef(0);
  const startSequenceRef = useRef(0);
  const voiceGateRef = useRef(new VoiceActivityGate());
  const restTimerRef = useRef<number | null>(null);
  // Local engine: Parakeet STT over the dictation socket + a streamed LLM reply.
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<VoicePcmCapturer | null>(null);
  const replyAbortRef = useRef<AbortController | null>(null);
  const speechRef = useRef<VoiceSpeechPlayer | null>(null);
  const engine = useRef({
    speaking: false,
    loudFrames: 0,
    speechStartedAt: 0,
    lastSpeechAt: 0,
    partialTimer: 0 as number,
    ready: false,
    finalPending: false,
    turnBusy: false,
    preRoll: [] as { data: string; seq: number }[],
    lastLevelDispatch: 0,
    partialInFlight: false,
  });

  const RESTING_AFTER_MS = 5_000;
  const clearRestTimer = useCallback(() => {
    if (restTimerRef.current !== null) {
      window.clearTimeout(restTimerRef.current);
      restTimerRef.current = null;
    }
  }, []);
  /** Any real activity (speech, typing, a button press) resets the 5s
   * countdown to the dimmer "resting" look. */
  const touchActivity = useCallback(() => {
    clearRestTimer();
    if (sessionRef.current.resting) dispatch({ type: "SET_RESTING", resting: false });
    restTimerRef.current = window.setTimeout(() => {
      restTimerRef.current = null;
      dispatch({ type: "SET_RESTING", resting: true });
    }, RESTING_AFTER_MS);
  }, [clearRestTimer]);

  const commitTurn = useCallback(() => {
    const userText = pendingUserTextRef.current.trim();
    const assistantText = pendingAssistantTextRef.current.trim();
    if (userText || assistantText) {
      const next: VoiceTurn[] = [...turnsRef.current];
      if (userText) next.push({ role: "user", content: userText });
      if (assistantText) next.push({ role: "assistant", content: assistantText });
      turnsRef.current = next;
      dispatch({ type: "SET_TURNS", turns: next });
      if (userText && assistantText) optionsRef.current.onTurn?.({ userText, assistantText });
    }
    pendingUserTextRef.current = "";
    pendingAssistantTextRef.current = "";
  }, []);

  const teardownEngine = useCallback(async () => {
    const e = engine.current;
    window.clearInterval(e.partialTimer);
    e.partialTimer = 0;
    e.speaking = false;
    e.ready = false;
    e.turnBusy = false;
    e.finalPending = false;
    e.preRoll = [];
    voiceGateRef.current.reset();
    replyAbortRef.current?.abort();
    replyAbortRef.current = null;
    speechRef.current?.interrupt();
    captureRef.current?.stop();
    captureRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    try { socket?.close(); } catch { /* already closed */ }
  }, []);

  const updateMission = useCallback((mission: MissionRecord) => {
    dispatch({ type: "TOOL_PROGRESS", event: { label: missionLabel(mission), detail: mission.plan?.objective, steps: missionSteps(mission) } });
  }, []);

  const pollMission = useCallback(async (missionId: string, signal: AbortSignal) => {
    for (let attempt = 0; attempt < 900 && !signal.aborted; attempt += 1) {
      await delay(650);
      if (signal.aborted) return;
      const response = await fetch(`/api/agent/missions/${encodeURIComponent(missionId)}`, { signal });
      const payload = await response.json().catch(() => null) as { mission?: MissionRecord } | null;
      const mission = payload?.mission;
      if (!response.ok || !mission) return;
      updateMission(mission);
      if (mission.state === "WAITING_FOR_APPROVAL" && mission.approval?.stepId) {
        pendingApprovalRef.current = { kind: "mission", id: missionId, stepId: mission.approval.stepId };
        dispatch({ type: "APPROVAL_REQUIRED", approval: {
          id: mission.approval.stepId,
          title: "Clyra needs your approval",
          detail: `Review ${mission.approval.toolId || "this action"} before it runs.`,
          confirmLabel: "Confirm",
          payload: mission.approval,
        } });
        return;
      }
      if (TERMINAL_MISSION_STATES.has(mission.state)) {
        activeRunRef.current = null;
        const result = missionResult(mission);
        if (mission.state === "COMPLETED") {
          dispatch({ type: "TOOL_FINISHED", result, responseText: result.text });
          const next = [...turnsRef.current, { role: "assistant" as const, content: result.text }];
          turnsRef.current = next;
          dispatch({ type: "SET_TURNS", turns: next });
          // Don't talk over a new utterance or a different conversational answer.
          if (!engine.current.speaking && !engine.current.finalPending && !replyAbortRef.current) {
            const player = speechRef.current || (speechRef.current = new VoiceSpeechPlayer(() => {
              dispatch({ type: "RESPONSE_FINISHED" });
              touchActivity();
            }));
            player.interrupt();
            player.append(result.text);
            player.complete();
          }
        } else dispatch({ type: "ERROR", error: { code: "VOICE_TASK_FAILED", message: result.text, retryable: mission.state === "FAILED" } });
        return;
      }
      if (PAUSED_MISSION_STATES.has(mission.state)) return;
    }
  }, [touchActivity, updateMission]);

  const startMission = useCallback(async (text: string) => {
    // The mission endpoint already plans and categorizes the request. Avoid
    // a sequential /route round-trip before every spoken action.
    const taskId = `voice-${crypto.randomUUID?.() || Date.now()}`;
    const response = await fetch("/api/agent/missions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId: taskId, projectId: optionsRef.current.conversationId || undefined, prompt: text, background: true }),
    });
    const payload = await response.json().catch(() => null) as { mission?: MissionRecord } | null;
    if (response.status === 422) return false; // Conversational question, no supported action
    if (!response.ok) throw new Error("Clyra couldn't start this action.");
    if (!payload?.mission?.id) throw new Error("The agent returned no active task.");
    const mission = payload.mission;
    const isBrowser = Boolean(mission.plan?.steps?.some((step) => step.toolId?.startsWith("browser.")));
    activeRunRef.current = { kind: "mission", id: mission.id };
    taskAbortRef.current?.abort();
    const controller = new AbortController();
    taskAbortRef.current = controller;
    dispatch({
      type: "TOOL_STARTED",
      tool: isBrowser ? "browser.research" : "clyra.mission",
      taskId: mission.id,
      label: missionLabel(mission),
      canPause: true,
      canStop: true,
      surface: { id: mission.id, kind: isBrowser ? "browser" : "app", title: isBrowser ? "Web research" : "Clyra task", subtitle: text },
    });
    updateMission(mission);
    void pollMission(mission.id, controller.signal).catch((error) => {
      if (!controller.signal.aborted) dispatch({ type: "ERROR", error: { code: "VOICE_TASK_LOST", message: error instanceof Error ? error.message : "I lost the task connection.", retryable: true } });
    });
    return true;
  }, [pollMission, updateMission]);

  const executeGoogle = useCallback(async (service: GoogleService, prompt: string, confirmed = false) => {
    const desktop = getElectronDesktop();
    if (!desktop?.google) return false;
    const runId = activeRunRef.current?.kind === "google" ? activeRunRef.current.id : `voice-google-${Date.now()}`;
    dispatch({ type: "TOOL_STARTED", tool: `google.${service}`, taskId: runId, label: googleLabel(service, prompt), surface: googleSurface(service, runId, prompt), canPause: false, canStop: false });
    const status = await desktop.google.status().catch(() => ({ connected: false }));
    if (!status.connected) {
      dispatch({ type: "TOOL_FINISHED", result: { text: "Connect Google Workspace in Clyra Settings first." }, responseText: "Connect Google Workspace in Clyra Settings first." });
      return true;
    }
    activeRunRef.current = { kind: "google", id: runId, service, prompt };
    const result = await desktop.google.execute({ tool: service, prompt, runId, confirmed }).catch((error) => ({ ok: false, text: error instanceof Error ? error.message : "Google Workspace stopped unexpectedly." })) as {
      ok: boolean;
      text: string;
      detail?: string;
      requiresConfirmation?: boolean;
      [key: string]: unknown;
    };
    if (result.requiresConfirmation) {
      pendingApprovalRef.current = { kind: "google", id: runId, service, prompt };
      const approval: ApprovalRequest = { id: runId, title: "Clyra needs your approval", detail: result.detail || result.text || "Review this Google Workspace action before it runs.", confirmLabel: "Confirm", payload: result };
      dispatch({ type: "APPROVAL_REQUIRED", approval });
      return true;
    }
    activeRunRef.current = null;
    const text = result.text || (result.ok ? "Done — the Google Workspace action is complete." : "I couldn’t complete that Google Workspace action.");
    if (result.ok) dispatch({ type: "TOOL_FINISHED", result, responseText: text });
    else dispatch({ type: "ERROR", error: { code: "GOOGLE_ACTION_FAILED", message: text, retryable: true } });
    return true;
  }, []);

  const cancelActiveRun = useCallback(async () => {
    const active = activeRunRef.current;
    if (!active) return;
    taskAbortRef.current?.abort();
    if (active.kind === "mission") await fetch(`/api/agent/missions/${encodeURIComponent(active.id)}/stop`, { method: "POST" }).catch(() => undefined);
    activeRunRef.current = null;
  }, []);

  const pauseTask = useCallback(async () => {
    const active = activeRunRef.current;
    if (!active || active.kind !== "mission") return;
    dispatch({ type: "PAUSE" });
    taskAbortRef.current?.abort();
    await fetch(`/api/agent/missions/${encodeURIComponent(active.id)}/pause`, { method: "POST" }).catch(() => undefined);
  }, []);

  const resumeTask = useCallback(async () => {
    const active = activeRunRef.current;
    if (!active || active.kind !== "mission") return;
    const response = await fetch(`/api/agent/missions/${encodeURIComponent(active.id)}/resume`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ background: true }) });
    const payload = await response.json().catch(() => null) as { mission?: MissionRecord; error?: string } | null;
    if (!response.ok || !payload?.mission) {
      dispatch({ type: "ERROR", error: { code: "VOICE_RESUME_FAILED", message: payload?.error || "Clyra couldn't resume that task.", retryable: true } });
      return;
    }
    dispatch({ type: "RESUME_AGENT" });
    updateMission(payload.mission);
    taskAbortRef.current?.abort();
    const controller = new AbortController();
    taskAbortRef.current = controller;
    void pollMission(active.id, controller.signal).catch(() => undefined);
  }, [pollMission, updateMission]);

  const takeControl = useCallback(async () => {
    const active = activeRunRef.current;
    if (!active) return;
    if (active.kind === "mission") await pauseTask();
    dispatch({ type: "TAKE_CONTROL" });
  }, [pauseTask]);

  const stopTask = useCallback(async () => {
    await cancelActiveRun();
    dispatch({ type: "TOOL_FINISHED", result: { stopped: true }, responseText: "Stopped. I kept the work that had already completed." });
  }, [cancelActiveRun]);

  /** Speak short task receipts immediately, without an extra model round-trip. */
  const acknowledge = useCallback((text: string) => {
    const player = speechRef.current || (speechRef.current = new VoiceSpeechPlayer(() => {
      dispatch({ type: "RESPONSE_FINISHED" });
      touchActivity();
    }));
    player.interrupt();
    pendingAssistantTextRef.current = text;
    dispatch({ type: "TOKEN", text });
    commitTurn();
    player.append(text);
    player.complete();
  }, [commitTurn, touchActivity]);

  /** Routes a spoken/typed request to Clyra's agent tools. Returns true when
   * an agent task owns the turn, so the plain conversational reply is skipped. */
  const runSideEffect = useCallback(async (text: string): Promise<boolean> => {
    const clean = text.trim();
    if (!clean) return false;
    const active = activeRunRef.current;
    const duplicate = lastSideEffectRef.current.text === clean && Date.now() - lastSideEffectRef.current.at < 4_000;
    if (duplicate) return Boolean(active);
    lastSideEffectRef.current = { text: clean, at: Date.now() };
    if (/^(?:stop|cancel|stop now)[.!]?$/i.test(clean) && active) {
      await stopTask();
      acknowledge("Stopped that task.");
      return true;
    }
    if (/^(?:pause|hold on|wait)[.!]?$/i.test(clean) && active?.kind === "mission") {
      await pauseTask();
      acknowledge("Paused. I'm listening.");
      return true;
    }
    if (/\b(?:let me do|i(?:’|'| a)m taking over|give me control)\b/i.test(clean) && active) {
      await takeControl();
      acknowledge("You have control.");
      return true;
    }
    if (/^(?:continue|resume|go ahead)[.!]?$/i.test(clean) && active?.kind === "mission") {
      await resumeTask();
      acknowledge("Continuing from where I left off.");
      return true;
    }
    if (active?.kind === "mission") {
      // A direct question can be answered conversationally without altering
      // the running work; a correction updates that SAME mission and checkpoint.
      const clearlyChangesTask = /\b(?:also|instead|change|add|remove|exclude|include|focus|make sure|switch|replace|prioriti[sz]e|don't|do not|budget|rather|actually|adjust|update)\b/i.test(clean);
      const conversationalAside = /^(?:hi|hello|hey|thanks|thank you|nice|cool|okay|ok)[.!]?$/i.test(clean)
        || (/\?$/.test(clean) && !clearlyChangesTask);
      if (conversationalAside) return false;
      taskAbortRef.current?.abort();
      const response = await fetch(`/api/agent/missions/${encodeURIComponent(active.id)}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: clean }),
      });
      const payload = await response.json().catch(() => null) as { mission?: MissionRecord; error?: string } | null;
      if (!response.ok || !payload?.mission) {
        dispatch({ type: "ERROR", error: { code: "VOICE_REVISION_FAILED", message: payload?.error || "I couldn't update that task safely.", retryable: true } });
        acknowledge("I couldn't update the running task safely. Please try that instruction again.");
        return true;
      }
      updateMission(payload.mission);
      dispatch({ type: "RESUME_AGENT" });
      const controller = new AbortController();
      taskAbortRef.current = controller;
      void pollMission(active.id, controller.signal).catch(() => undefined);
      acknowledge("Got it. I've added that to the same task.");
      return true;
    }
    const google = detectGoogleService(clean);
    if (google && await executeGoogle(google, clean)) {
      acknowledge("I've handled that Google Workspace request.");
      return true;
    }
    const launched = await startMission(clean);
    if (launched) acknowledge("I'm on it.");
    return launched;
  }, [acknowledge, executeGoogle, pauseTask, pollMission, resumeTask, startMission, stopTask, takeControl, updateMission]);

  /** Token streaming and interruptible speech share the same turn lifecycle. */
  const streamReply = useCallback(async (userText: string) => {
    const controller = new AbortController();
    replyAbortRef.current?.abort();
    replyAbortRef.current = controller;
    const o = optionsRef.current;
    // Preserve the user's opening goal plus their recent corrections. We
    // bound the text to avoid excessive context-cost on long open calls.
    const conversation = [...o.chatHistory.slice(-8), ...turnsRef.current];
    const opening = conversation.findIndex((turn) => turn.role === "user");
    const indices = new Set<number>();
    if (opening >= 0) indices.add(opening);
    for (let index = Math.max(0, conversation.length - 44); index < conversation.length; index += 1) indices.add(index);
    let budget = 12_000;
    const history = [...indices].sort((a, b) => b - a)
      .map((index) => ({ index, turn: conversation[index]! }))
      .filter(({ turn }) => {
        if (!budget) return false;
        budget -= Math.min(budget, turn.content.length);
        return true;
      })
      .sort((a, b) => a.index - b.index)
      .map(({ turn }) => ({ role: turn.role, content: turn.content.slice(0, 2_000) }));
    const messages = [
      { role: "system", content: `${o.systemPrompt}\n\n${VOICE_REPLY_STYLE}` },
      ...history,
      { role: "user", content: userText },
    ];
    pendingAssistantTextRef.current = "";
    const speaker = speechRef.current || (speechRef.current = new VoiceSpeechPlayer(() => {
      dispatch({ type: "RESPONSE_FINISHED" });
      touchActivity();
    }));
    speaker.interrupt();
    let gotToken = false;
    try {
      const response = await fetch("/api/deepseek/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", messages, temperature: o.temperature ?? 0.7, stream: true, max_tokens: 380, thinking: { type: "disabled" } }),
      });
      if (!response.ok || !response.body) {
        const detail = await response.json().then((b: { error?: string }) => b?.error).catch(() => undefined);
        throw new Error(detail || "Clyra couldn’t reach its language model.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data: ")) continue;
          if (line === "data: [DONE]") continue;
          try {
            const delta = JSON.parse(line.slice(6))?.choices?.[0]?.delta?.content as string | undefined;
            if (delta && !controller.signal.aborted) {
              gotToken = true;
              pendingAssistantTextRef.current += delta;
              dispatch({ type: "TOKEN", text: delta });
              speaker.append(delta);
            }
          } catch { /* partial SSE frame */ }
        }
      }
      if (controller.signal.aborted) return;
      if (!gotToken) throw new Error("Clyra didn’t get a reply. Try again.");
      commitTurn();
      speaker.complete();
    } catch (error) {
      if (controller.signal.aborted) return;
      speaker.interrupt();
      dispatch({ type: "ERROR", error: { code: "VOICE_REPLY_FAILED", message: error instanceof Error ? error.message : "Clyra couldn’t answer that.", retryable: true } });
    } finally {
      if (replyAbortRef.current === controller) replyAbortRef.current = null;
      if (replyAbortRef.current === null) engine.current.turnBusy = false;
    }
  }, [commitTurn, touchActivity]);

  /** One full turn once the words are known: agent tools first, else a reply. */
  const handleUserText = useCallback(async (text: string) => {
    const clean = text.trim();
    const e = engine.current;
    if (!clean) { e.turnBusy = false; dispatch({ type: "MIC_READY" }); touchActivity(); return; }
    commitTurn();
    pendingUserTextRef.current = clean;
    pendingAssistantTextRef.current = "";
    dispatch({ type: "STT_FINAL", text: clean });
    e.turnBusy = true;
    try {
      if (await runSideEffect(clean)) { e.turnBusy = false; return; }
    } catch (error) {
      // A failed tool request is not a reason to hallucinate success through
      // the conversational model. Keep the user text for a safe retry.
      if (activeRunRef.current) {
        dispatch({ type: "ERROR", error: { code: "VOICE_ACTION_FAILED", message: error instanceof Error ? error.message : "The active task needs attention.", retryable: true } });
        e.turnBusy = false;
        return;
      }
    }
    await streamReply(clean);
  }, [commitTurn, runSideEffect, streamReply, touchActivity]);

  const endUtterance = useCallback(() => {
    const e = engine.current;
    if (!e.speaking) return;
    e.speaking = false;
    voiceGateRef.current.setSpeaking(false);
    window.clearInterval(e.partialTimer);
    e.partialTimer = 0;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    e.finalPending = true;
    e.turnBusy = true;
    // "Thinking" starts the instant you stop talking; the transcript lands
    // ~0.5s later and fills the subtitle.
    dispatch({ type: "THINK_STARTED" });
    socket.send(JSON.stringify({
      type: "flush",
      sessionId: sessionIdRef.current,
      dictionary: personalDictionary().slice(0, 40),
      profile: sessionRef.current.lowPowerMode ? "tiny" : "base",
    }));
  }, []);

  const onMicLevel = useCallback((level: number) => {
    const e = engine.current;
    const now = performance.now();
    // Throttle the live mic meter so the face gets real audio energy without
    // driving a React render for every audio callback.
    if (now - e.lastLevelDispatch >= (sessionRef.current.lowPowerMode ? 150 : 90)) {
      e.lastLevelDispatch = now;
      dispatch({ type: "SET_LEVEL", source: "mic", level: sessionRef.current.muted ? 0 : Math.min(1, Math.max(0, level)) });
    }
    if (!e.ready || sessionRef.current.muted || sessionRef.current.state === "ending") return;
    // Soft spoken words must wake VAD too; the native speaker's echo is
    // suppressed more conservatively while output audio is playing.
    const loud = voiceGateRef.current.test(level, e.speaking, Boolean(speechRef.current?.speaking));
    if (loud) {
      e.loudFrames += 1;
      e.lastSpeechAt = now;
      if (!e.speaking && e.loudFrames >= (speechRef.current?.speaking ? 3 : 2) && !e.finalPending) {
        // Barge-in: speaking over a reply interrupts it immediately.
        const state = sessionRef.current.state;
        if (state === "responding" || state === "thinking") {
          bargeInsRef.current += 1;
          replyAbortRef.current?.abort();
          speechRef.current?.interrupt();
          commitTurn();
          e.turnBusy = false;
        }
        // Keep the mic live while tools run, an approval is open, or the
        // user has taken over. The next utterance can refine that same task.
        e.speaking = true;
        voiceGateRef.current.setSpeaking(true);
        transcriptRef.current.reset();
        e.speechStartedAt = now;
        touchActivity();
        dispatch({ type: "VOICE_STARTED" });
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "reset", sessionId: sessionIdRef.current }));
          for (const chunk of e.preRoll.splice(0)) socket.send(JSON.stringify({ type: "audio", sessionId: sessionIdRef.current, codec: "pcm16", data: chunk.data, seq: chunk.seq }));
        }
        window.clearInterval(e.partialTimer);
        e.partialInFlight = false;
        e.partialTimer = window.setInterval(() => {
          const sock = socketRef.current;
          if (e.speaking && !e.partialInFlight && sock?.readyState === WebSocket.OPEN) {
            e.partialInFlight = true;
            sock.send(JSON.stringify({ type: "partial", sessionId: sessionIdRef.current }));
          }
        }, PARTIAL_EVERY_MS);
      }
    } else {
      e.loudFrames = 0;
    }
    const partial = sessionRef.current.partialTranscript.trim();
    const unfinished = /(?:,|\b(?:and|but|because|if|so|to|with|about|for))$/i.test(partial);
    const silence = unfinished ? 980 : partial.length > 0 && partial.split(/\s+/).length <= 3 ? 460 : TURN_SILENCE_MS;
    if (e.speaking && !loud && now - e.lastSpeechAt >= silence && now - e.speechStartedAt >= MIN_SPEECH_MS) endUtterance();
  }, [commitTurn, endUtterance, touchActivity]);

  const onMicChunk = useCallback((data: string, seq: number) => {
    const e = engine.current;
    const socket = socketRef.current;
    if (e.speaking && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "audio", sessionId: sessionIdRef.current, codec: "pcm16", data, seq }));
      return;
    }
    // Pre-roll preserves the opening phonemes even with a soft-spoken start.
    e.preRoll.push({ data, seq });
    if (e.preRoll.length > PRE_ROLL_CHUNKS) e.preRoll.shift();
  }, []);

  const startCall = useCallback(async () => {
    if (!optionsRef.current.enabled || socketRef.current || sessionRef.current.active) return;
    dispatch({ type: "ENTER" });
    pendingUserTextRef.current = "";
    pendingAssistantTextRef.current = "";
    turnsRef.current = [];
    bargeInsRef.current = 0;
    const e = engine.current;
    e.speaking = false; e.ready = false; e.finalPending = false; e.turnBusy = false; e.preRoll = []; e.loudFrames = 0;
    transcriptRef.current.reset();
    voiceGateRef.current.reset();
    const startSequence = ++startSequenceRef.current;
    try {
      const desktop = getElectronDesktop();
      const permissions = await desktop?.dictation?.ensurePermissions?.().catch(() => null);
      if (permissions && permissions.ok === false) throw new Error(String(permissions.error || "Microphone access is blocked. Enable it in System Settings."));
      const sessionResponse = await fetch("/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dictation", conversationId: optionsRef.current.conversationId, history: [] }),
      });
      const created = await sessionResponse.json();
      if (!created?.ok) throw new Error(created?.error || "Could not start voice session.");
      sessionIdRef.current = created.sessionId;
      dispatch({ type: "SET_SESSION_ID", sessionId: created.sessionId });

      const socket = new WebSocket(created.websocketUrl);
      socketRef.current = socket;
      const opened = new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Clyra’s speech engine isn’t reachable."));
      });
      socket.onmessage = (event) => {
        let message: { type?: string; text?: string; message?: string };
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (socketRef.current !== socket) return;
        if (message.type === "pipeline_mode") {
          engine.current.ready = true;
          // Do not advertise a working microphone until capture actually starts.
          if (captureRef.current?.mediaStream) {
            dispatch({ type: "MIC_READY" });
            touchActivity();
          }
        } else if (message.type === "partial_done") {
          engine.current.partialInFlight = false;
        } else if (message.type === "transcript_partial") {
          if (engine.current.speaking) {
            const stable = transcriptRef.current.update(String(message.text || ""));
            dispatch({ type: "STT_PARTIAL", text: stable });
          }
        } else if (message.type === "dictation_final") {
          engine.current.finalPending = false;
          const finalText = applyDictionary(transcriptRef.current.finalize(String(message.text || "")));
          void handleUserText(finalText);
        } else if (message.type === "error") {
          engine.current.finalPending = false;
          engine.current.turnBusy = false;
          dispatch({ type: "ERROR", error: { code: "VOICE_STT_FAILED", message: String(message.message || "Transcription failed."), retryable: true } });
        }
      };
      socket.onclose = () => {
        if (socketRef.current === socket) {
          socketRef.current = null;
          if (sessionRef.current.active && sessionRef.current.state !== "ending") dispatch({ type: "ERROR", error: { code: "VOICE_DISCONNECTED", message: "I lost the speech connection. End the call and try again.", retryable: true } });
        }
      };
      const capture = new VoicePcmCapturer(onMicChunk, 16_000, onMicLevel);
      captureRef.current = capture;
      // Microphone permission/capture and websocket opening overlap. A call
      // cannot be ready until both sides are connected.
      await Promise.all([opened, capture.start()]);
      if (startSequence !== startSequenceRef.current) {
        await teardownEngine();
        return;
      }
      capture.setMuted(sessionRef.current.muted);
      if (engine.current.ready) {
        dispatch({ type: "MIC_READY" });
        touchActivity();
      }
    } catch (error) {
      if (startSequence !== startSequenceRef.current) return;
      await teardownEngine();
      dispatch({ type: "ERROR", error: { code: "VOICE_START_FAILED", message: error instanceof Error ? error.message : "Voice call failed to start.", retryable: true } });
    }
  }, [handleUserText, onMicChunk, onMicLevel, teardownEngine, touchActivity]);

  const endCall = useCallback(async () => {
    if (!sessionRef.current.active || sessionRef.current.state === "ending") return;
    const sequence = ++endSequenceRef.current;
    ++startSequenceRef.current;
    clearRestTimer();
    dispatch({ type: "END" });
    commitTurn();
    void cancelActiveRun();
    void teardownEngine();
    const voiceSessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    // Let the screen's ending animation (root fade: 240ms + 420ms delay)
    // finish before the overlay unmounts and returns to chat.
    await delay(720);
    if (endSequenceRef.current !== sequence) return;
    dispatch({ type: "CLOSED" });
    if (voiceSessionId) void fetch("/voice/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: voiceSessionId, history: turnsRef.current, bargeIns: bargeInsRef.current, reconnects: 0 }),
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }, [cancelActiveRun, commitTurn, teardownEngine, clearRestTimer]);

  const toggleMute = useCallback(() => {
    touchActivity();
    const muted = !sessionRef.current.muted;
    captureRef.current?.setMuted(muted);
    if (muted && engine.current.speaking) {
      // Muting mid-sentence discards the partial utterance rather than sending it.
      engine.current.speaking = false;
      voiceGateRef.current.setSpeaking(false);
      window.clearInterval(engine.current.partialTimer);
      engine.current.partialTimer = 0;
      dispatch({ type: "MIC_READY" });
    }
    dispatch({ type: "SET_MUTED", muted });
  }, [touchActivity]);

  const sendText = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    if (!engine.current.ready) {
      dispatch({ type: "ERROR", error: { code: "VOICE_NOT_CONNECTED", message: "The call isn’t connected. End it and start a new call to keep talking.", retryable: false } });
      return;
    }
    touchActivity();
    replyAbortRef.current?.abort();
    speechRef.current?.interrupt();
    await handleUserText(clean);
  }, [handleUserText, touchActivity]);

  const confirmApproval = useCallback(async () => {
    const approval = pendingApprovalRef.current;
    if (!approval) return;
    pendingApprovalRef.current = null;
    dispatch({ type: "CLEAR_APPROVAL" });
    if (approval.kind === "google") { await executeGoogle(approval.service, approval.prompt, true); return; }
    dispatch({ type: "RESUME_AGENT" });
    const response = await fetch(`/api/agent/missions/${encodeURIComponent(approval.id)}/resume`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedStepIds: [approval.stepId], background: true }),
    });
    const payload = await response.json().catch(() => null) as { mission?: MissionRecord; error?: string } | null;
    if (!response.ok || !payload?.mission) {
      dispatch({ type: "ERROR", error: { code: "VOICE_APPROVAL_FAILED", message: payload?.error || "I couldn't resume that approved task.", retryable: true } });
      return;
    }
    updateMission(payload.mission);
    const controller = new AbortController();
    taskAbortRef.current = controller;
    void pollMission(approval.id, controller.signal).catch(() => undefined);
  }, [executeGoogle, pollMission, updateMission]);

  const rejectApproval = useCallback(async () => {
    pendingApprovalRef.current = null;
    await cancelActiveRun();
    dispatch({ type: "CLEAR_APPROVAL" });
    dispatch({ type: "TOOL_FINISHED", result: { cancelled: true }, responseText: "Cancelled — I didn’t run that action." });
  }, [cancelActiveRun]);

  useEffect(() => {
    if (!session.active) return;
    const startedAt = Date.now() - session.elapsedSeconds * 1000;
    const timer = window.setInterval(() => dispatch({ type: "SET_ELAPSED", seconds: Math.floor((Date.now() - startedAt) / 1000) }), 1000);
    return () => window.clearInterval(timer);
    // Only the call lifecycle starts/stops the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.active]);

  useEffect(() => {
    const desktop = getElectronDesktop();
    if (!desktop?.google?.onAgentProgress) return;
    return desktop.google.onAgentProgress((progress) => {
      const active = activeRunRef.current;
      if (active?.kind !== "google" || progress.runId !== active.id) return;
      dispatch({ type: "TOOL_PROGRESS", event: { label: progress.label, detail: progress.detail } });
    });
  }, []);

  useEffect(() => {
    if (session.activeTask?.status !== "complete") return;
    const timer = window.setTimeout(() => dispatch({ type: "CLEAR_TASK" }), 900);
    return () => window.clearTimeout(timer);
  }, [session.activeTask?.status]);

  useEffect(() => () => {
    taskAbortRef.current?.abort();
    void teardownEngine();
    clearRestTimer();
  }, [teardownEngine, clearRestTimer]);

  return {
    ...session,
    status: session.state,
    captionLines: session.responseText ? [session.responseText] : [],
    error: session.error?.message || null,
    startCall,
    endCall,
    toggleMute,
    sendText,
    openComposer: () => { touchActivity(); dispatch({ type: "OPEN_COMPOSER" }); },
    closeComposer: () => dispatch({ type: "CLOSE_COMPOSER" }),
    pauseTask: () => void pauseTask(),
    resumeTask: () => void resumeTask(),
    takeControl: () => void takeControl(),
    stopTask: () => void stopTask(),
    confirmApproval: () => void confirmApproval(),
    rejectApproval: () => void rejectApproval(),
    toggleSurfaceExpanded: () => dispatch({ type: "SET_SURFACE_EXPANDED", expanded: !sessionRef.current.activeSurface?.expanded }),
  };
}
