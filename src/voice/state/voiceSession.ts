export type VoiceCallState =
  | "entering"
  | "idle"
  | "ready"
  | "listening"
  | "transcribing"
  | "thinking"
  | "responding"
  | "acting_browser"
  | "acting_computer"
  | "acting_clyra"
  | "awaiting_approval"
  | "user_takeover"
  | "paused"
  | "error"
  | "ending";

export type VoiceTurn = { role: "user" | "assistant"; content: string };

export type VoiceError = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ApprovalRequest = {
  id: string;
  title: string;
  detail: string;
  confirmLabel?: string;
  payload?: unknown;
};

export type AgentPlanStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "complete" | "blocked";
};

export type AgentTask = {
  id: string;
  label: string;
  detail?: string;
  kind: "browser" | "computer" | "integration" | "clyra";
  status: "running" | "paused" | "waiting" | "complete" | "failed";
  progress?: number;
  steps?: AgentPlanStep[];
  canTakeControl?: boolean;
  canPause?: boolean;
  canStop?: boolean;
};

export type AgentSurface = {
  id: string;
  kind: "browser" | "email" | "document" | "file" | "map" | "app";
  title: string;
  subtitle?: string;
  url?: string;
  preview?: string;
  content?: unknown;
  expanded?: boolean;
};

export type ToolProgressEvent = {
  label: string;
  detail?: string;
  progress?: number;
  steps?: AgentPlanStep[];
  surface?: AgentSurface;
};

export interface VoiceSessionState {
  active: boolean;
  state: VoiceCallState;
  sessionId: string;
  muted: boolean;
  composerOpen: boolean;
  partialTranscript: string;
  committedTranscript: string;
  responseText: string;
  turns: VoiceTurn[];
  elapsedSeconds: number;
  micLevel: number;
  botLevel: number;
  /** True after 5s of no speech/typing/button activity while `state === "ready"`. */
  resting: boolean;
  actionLabel?: string;
  activeTask?: AgentTask;
  activeSurface?: AgentSurface;
  userHasControl: boolean;
  requiresApproval?: ApprovalRequest;
  error?: VoiceError;
  lowPowerMode: boolean;
}

export type VoiceEvent =
  | { type: "ENTER"; sessionId?: string; lowPowerMode?: boolean }
  | { type: "SET_SESSION_ID"; sessionId: string }
  | { type: "MIC_READY" }
  | { type: "VOICE_STARTED" }
  | { type: "VOICE_STOPPED" }
  | { type: "STT_PARTIAL"; text: string }
  | { type: "STT_FINAL"; text: string }
  | { type: "THINK_STARTED" }
  | { type: "TOKEN"; text: string }
  | { type: "TOOL_STARTED"; tool: string; taskId: string; label?: string; surface?: AgentSurface; canTakeControl?: boolean; canPause?: boolean; canStop?: boolean }
  | { type: "TOOL_PROGRESS"; event: ToolProgressEvent }
  | { type: "TOOL_FINISHED"; result: unknown; responseText?: string }
  | { type: "APPROVAL_REQUIRED"; approval: ApprovalRequest }
  | { type: "TAKE_CONTROL" }
  | { type: "RESUME_AGENT" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "ERROR"; error: VoiceError }
  | { type: "END" }
  | { type: "CLOSED" }
  | { type: "SET_MUTED"; muted: boolean }
  | { type: "SET_RESTING"; resting: boolean }
  | { type: "OPEN_COMPOSER" }
  | { type: "CLOSE_COMPOSER" }
  | { type: "CLEAR_RESPONSE" }
  | { type: "RESPONSE_FINISHED" }
  | { type: "SET_ACTION_LABEL"; label?: string }
  | { type: "SET_LEVEL"; source: "mic" | "bot"; level: number }
  | { type: "SET_ELAPSED"; seconds: number }
  | { type: "SET_SURFACE_EXPANDED"; expanded: boolean }
  | { type: "SET_TURNS"; turns: VoiceTurn[] }
  | { type: "CLEAR_APPROVAL" }
  | { type: "CLEAR_TASK" };

function isLowPowerDevice() {
  if (typeof navigator === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return navigator.hardwareConcurrency <= 4 || (typeof memory === "number" && memory <= 4);
}

export function createVoiceSessionState(): VoiceSessionState {
  return {
    active: false,
    state: "idle",
    sessionId: "",
    muted: false,
    composerOpen: false,
    partialTranscript: "",
    committedTranscript: "",
    responseText: "",
    turns: [],
    elapsedSeconds: 0,
    micLevel: 0,
    botLevel: 0,
    resting: false,
    userHasControl: false,
    lowPowerMode: isLowPowerDevice(),
  };
}

function actionState(tool: string): VoiceCallState {
  const value = tool.toLowerCase();
  if (value.includes("browser") || value.includes("search") || value.includes("research")) return "acting_browser";
  if (value.includes("computer") || value.includes("desktop")) return "acting_computer";
  return "acting_clyra";
}

export function voiceSessionReducer(state: VoiceSessionState, event: VoiceEvent): VoiceSessionState {
  switch (event.type) {
    case "ENTER":
      return {
        ...createVoiceSessionState(),
        active: true,
        state: "entering",
        sessionId: event.sessionId || "",
        lowPowerMode: event.lowPowerMode ?? state.lowPowerMode,
        actionLabel: "Connecting",
      };
    case "SET_SESSION_ID":
      return { ...state, sessionId: event.sessionId };
    case "MIC_READY":
      // Connected but quiet -- "listening" is reserved for real detected
      // speech (VOICE_STARTED, fired from the actual VAD onUserStartedSpeaking
      // event), so the label/animation don't claim to be listening when
      // nobody's talking yet.
      return { ...state, state: "ready", actionLabel: undefined, error: undefined };
    case "VOICE_STARTED":
      return { ...state, state: "listening", resting: false, partialTranscript: "", committedTranscript: "", responseText: "", error: undefined };
    case "STT_PARTIAL":
      return { ...state, state: event.text.trim() ? "transcribing" : "listening", partialTranscript: event.text };
    case "VOICE_STOPPED":
      return { ...state, state: "transcribing", actionLabel: "Finishing your words", micLevel: 0 };
    case "STT_FINAL":
      return { ...state, state: "thinking", partialTranscript: "", committedTranscript: event.text, responseText: "", actionLabel: undefined };
    case "THINK_STARTED":
      return { ...state, state: "thinking", responseText: "", actionLabel: undefined };
    case "TOKEN":
      return { ...state, state: state.activeTask ? state.state : "responding", responseText: `${state.responseText}${event.text}` };
    case "RESPONSE_FINISHED":
      return { ...state, state: state.activeTask ? state.state : "ready", actionLabel: undefined };
    case "TOOL_STARTED": {
      const kind: AgentTask["kind"] = event.tool.includes("browser") || event.tool.includes("research")
        ? "browser"
        : event.tool.includes("computer")
          ? "computer"
          : event.tool.includes("google") || event.tool.includes("gmail") || event.tool.includes("drive") || event.tool.includes("docs")
            ? "integration"
            : "clyra";
      return {
        ...state,
        state: actionState(event.tool),
        actionLabel: event.label || "Clyra is working",
        activeTask: {
          id: event.taskId,
          kind,
          label: event.label || "Clyra is working",
          status: "running",
          canTakeControl: event.canTakeControl,
          canPause: event.canPause,
          canStop: event.canStop,
        },
        activeSurface: event.surface || state.activeSurface,
        userHasControl: false,
        requiresApproval: undefined,
      };
    }
    case "TOOL_PROGRESS":
      return {
        ...state,
        actionLabel: event.event.label,
        activeTask: state.activeTask ? {
          ...state.activeTask,
          label: event.event.label,
          detail: event.event.detail,
          progress: event.event.progress,
          steps: event.event.steps || state.activeTask.steps,
        } : state.activeTask,
        activeSurface: event.event.surface || state.activeSurface,
      };
    case "TOOL_FINISHED":
      return {
        ...state,
        state: event.responseText || state.responseText ? "responding" : "ready",
        responseText: event.responseText || state.responseText,
        actionLabel: undefined,
        activeTask: state.activeTask ? { ...state.activeTask, status: "complete", progress: 1 } : undefined,
        activeSurface: state.activeSurface ? { ...state.activeSurface, content: event.result } : undefined,
      };
    case "APPROVAL_REQUIRED":
      return { ...state, state: "awaiting_approval", requiresApproval: event.approval, actionLabel: "Needs your approval", activeTask: state.activeTask ? { ...state.activeTask, status: "waiting" } : state.activeTask };
    case "TAKE_CONTROL":
      return { ...state, state: "user_takeover", userHasControl: true, actionLabel: "You’re controlling", activeTask: state.activeTask ? { ...state.activeTask, status: "paused" } : state.activeTask };
    case "RESUME_AGENT":
      return { ...state, state: state.activeTask?.kind === "browser" ? "acting_browser" : state.activeTask?.kind === "computer" ? "acting_computer" : "acting_clyra", userHasControl: false, actionLabel: "Rechecking the current state", activeTask: state.activeTask ? { ...state.activeTask, status: "running" } : state.activeTask };
    case "PAUSE":
      return { ...state, state: "paused", actionLabel: "Paused", activeTask: state.activeTask ? { ...state.activeTask, status: "paused" } : state.activeTask };
    case "RESUME":
      return voiceSessionReducer(state, { type: "RESUME_AGENT" });
    case "ERROR":
      return { ...state, state: "error", error: event.error, actionLabel: undefined, activeTask: state.activeTask ? { ...state.activeTask, status: "failed" } : state.activeTask };
    case "END":
      return { ...state, state: "ending", composerOpen: false, responseText: "", actionLabel: undefined };
    case "CLOSED":
      return createVoiceSessionState();
    case "SET_MUTED":
      return { ...state, muted: event.muted };
    case "SET_RESTING":
      return { ...state, resting: event.resting };
    case "OPEN_COMPOSER":
      // Typing steers the conversation fresh -- the last spoken response is
      // no longer the on-screen focus.
      return { ...state, composerOpen: true, responseText: "", resting: false };
    case "CLOSE_COMPOSER":
      return { ...state, composerOpen: false };
    case "CLEAR_RESPONSE":
      return { ...state, responseText: "" };
    case "SET_ACTION_LABEL":
      return { ...state, actionLabel: event.label };
    case "SET_LEVEL":
      return event.source === "mic" ? { ...state, micLevel: event.level } : { ...state, botLevel: event.level };
    case "SET_ELAPSED":
      return { ...state, elapsedSeconds: event.seconds };
    case "SET_SURFACE_EXPANDED":
      return { ...state, activeSurface: state.activeSurface ? { ...state.activeSurface, expanded: event.expanded } : undefined };
    case "SET_TURNS":
      return { ...state, turns: event.turns };
    case "CLEAR_APPROVAL":
      return { ...state, requiresApproval: undefined };
    case "CLEAR_TASK":
      return { ...state, activeTask: undefined, activeSurface: undefined, userHasControl: false, requiresApproval: undefined, state: state.responseText ? "responding" : "ready" };
    default:
      return state;
  }
}

export function voiceStatusLabel(session: VoiceSessionState) {
  if (session.muted && ["ready", "listening", "transcribing"].includes(session.state)) return "Microphone off";
  if (session.actionLabel) return session.actionLabel;
  switch (session.state) {
    case "entering": return "Connecting";
    case "idle": return "Ready";
    case "ready": return session.resting ? "Resting — speak or type to wake" : "Speak when ready, or press type.";
    case "listening": return "Listening";
    case "transcribing": return session.partialTranscript || "Listening";
    case "thinking": return "Thinking";
    case "responding": return "";
    case "acting_browser": return "Working in the browser";
    case "acting_computer": return "Working on your computer";
    case "acting_clyra": return "Working in Clyra";
    case "awaiting_approval": return "Needs your approval";
    case "user_takeover": return "You’re controlling";
    case "paused": return "Paused";
    case "error": return "Call needs attention";
    case "ending": return "Ending call";
  }
}
