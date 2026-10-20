import {
  Activity,
  Bot,
  ChevronRight,
  Code2,
  Cpu,
  Folder,
  Globe2,
  Map,
  Menu,
  MessageSquare,
  Mic,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import "./core-console.css";

export type ClyraSpatialOrbState =
  | "checking"
  | "ready"
  | "working"
  | "attention"
  | "offline";

export type CoreConsoleWorkspaceId =
  | "chat"
  | "vibe"
  | "clip"
  | "browser"
  | "study"
  | "cowork"
  | "maps"
  | "eye"
  | "notes"
  | "spotify"
  | "care"
  | "companion";

export type CoreConsoleRecentChat = {
  id: string;
  title: string;
  preview?: string;
  updatedAt: number | string;
  kind?: string;
};

export type CoreConsoleBackdropProps = {
  recentChats?: readonly CoreConsoleRecentChat[];
  openChat: (id: string) => void;
  newChat: () => void;
  openSettings: () => void;
  openSidebar: () => void;
  openWorkspace: (workspace: CoreConsoleWorkspaceId) => void;
  className?: string;
};

export type ClyraSpatialOrbProps = {
  state: ClyraSpatialOrbState;
  label?: string;
  className?: string;
};

type EndpointPhase = "checking" | "ready" | "unavailable";

type EndpointSnapshot =
  | { phase: "checking" }
  | { phase: "ready"; value: unknown }
  | { phase: "unavailable"; error: string };

type EndpointKey =
  | "health"
  | "runtime"
  | "code"
  | "speech"
  | "projects"
  | "tasks"
  | "usage";

type EndpointMap = Record<EndpointKey, EndpointSnapshot>;

type CapabilityTone = "available" | "working" | "attention" | "unavailable";

type CapabilityRow = {
  id: "service" | "hermes" | "code" | "speech";
  label: string;
  detail: string;
  tone: CapabilityTone;
  Icon: typeof Server;
};

type ProjectSummary = {
  id: string;
  name: string;
  status: string;
  updatedAt: string | number | null;
};

type TaskSummary = {
  id: string;
  title: string;
  state: string;
  currentStep: string;
  updatedAt: string | number | null;
};

type UsageSummary = {
  requests: number | null;
  tokens: number | null;
};

const READ_ENDPOINTS: Record<EndpointKey, string> = {
  health: "/api/health",
  runtime: "/api/agent/runtime-status",
  code: "/api/opencode/status",
  speech: "/api/speech/status",
  projects: "/api/vibe/projects",
  tasks: "/api/cowork/tasks",
  usage: "/api/usage",
};

const INITIAL_ENDPOINTS: EndpointMap = {
  health: { phase: "checking" },
  runtime: { phase: "checking" },
  code: { phase: "checking" },
  speech: { phase: "checking" },
  projects: { phase: "checking" },
  tasks: { phase: "checking" },
  usage: { phase: "checking" },
};

const ORB_DEFAULT_LABELS: Record<ClyraSpatialOrbState, string> = {
  checking: "Checking local services",
  ready: "Ready",
  working: "Working",
  attention: "Needs attention",
  offline: "Local service unavailable",
};

const ACTIVE_TASK_STATES = new Set([
  "running",
  "retrying",
  "awaiting_approval",
  "blocked",
  "paused",
]);

const WORKING_TASK_STATES = new Set(["running", "retrying"]);
const ATTENTION_TASK_STATES = new Set(["awaiting_approval", "blocked", "paused"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function safeDetail(value: unknown, fallback: string): string {
  const detail = stringValue(value).replace(/\s+/g, " ");
  return detail ? detail.slice(0, 140) : fallback;
}

function endpointError(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    const detail = stringValue(payload.error) || stringValue(payload.message);
    if (detail) return safeDetail(detail, `HTTP ${status}`);
  }
  return `The local endpoint returned HTTP ${status}.`;
}

function requestError(error: unknown): string {
  if (error instanceof Error && error.name !== "TypeError") {
    return safeDetail(error.message, "The local endpoint is unavailable.");
  }
  return "The local service could not be reached.";
}

async function readEndpoint(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(endpointError(payload, response.status));
  return payload;
}

function snapshotDetail(snapshot: EndpointSnapshot): string {
  if (snapshot.phase === "checking") return "Checking";
  if (snapshot.phase === "unavailable") return snapshot.error;
  return "Status received";
}

function capabilityRows(endpoints: EndpointMap): CapabilityRow[] {
  const serviceSnapshot = endpoints.health;
  let service: CapabilityRow;
  if (serviceSnapshot.phase !== "ready") {
    service = {
      id: "service",
      label: "Clyra service",
      detail: snapshotDetail(serviceSnapshot),
      tone: serviceSnapshot.phase === "checking" ? "working" : "unavailable",
      Icon: Server,
    };
  } else {
    const payload = isRecord(serviceSnapshot.value) ? serviceSnapshot.value : {};
    const status = stringValue(payload.status).toLowerCase();
    service = {
      id: "service",
      label: "Clyra service",
      detail: status === "ok" ? "Responding" : safeDetail(payload.status, "Unverified response"),
      tone: status === "ok" ? "available" : "attention",
      Icon: Server,
    };
  }

  const runtimeSnapshot = endpoints.runtime;
  let hermes: CapabilityRow;
  if (runtimeSnapshot.phase !== "ready") {
    hermes = {
      id: "hermes",
      label: "Hermes",
      detail: snapshotDetail(runtimeSnapshot),
      tone: runtimeSnapshot.phase === "checking" ? "working" : "unavailable",
      Icon: Bot,
    };
  } else {
    const payload = isRecord(runtimeSnapshot.value) ? runtimeSnapshot.value : {};
    const runtime = isRecord(payload.hermes) ? payload.hermes : null;
    const connected = runtime ? booleanValue(runtime.connected) : null;
    const configured = runtime ? booleanValue(runtime.configured) : null;
    const starting = runtime ? booleanValue(runtime.starting) : null;
    const detail = runtime
      ? connected
        ? "Connected"
        : starting
          ? "Starting"
          : configured === false
            ? safeDetail(runtime.reason, "Not configured")
            : safeDetail(runtime.reason, "Not connected")
      : "Status was not included in the response";
    hermes = {
      id: "hermes",
      label: "Hermes",
      detail,
      tone: connected ? "available" : starting ? "working" : runtime ? "attention" : "unavailable",
      Icon: Bot,
    };
  }

  const codeSnapshot = endpoints.code;
  let code: CapabilityRow;
  if (codeSnapshot.phase !== "ready") {
    code = {
      id: "code",
      label: "Clyra Code",
      detail: snapshotDetail(codeSnapshot),
      tone: codeSnapshot.phase === "checking" ? "working" : "unavailable",
      Icon: Code2,
    };
  } else {
    const payload = isRecord(codeSnapshot.value) ? codeSnapshot.value : {};
    const status = stringValue(payload.status).toLowerCase();
    const configured = booleanValue(payload.providerConfigured);
    const model = stringValue(payload.model);
    const backend = stringValue(payload.backend);
    const error = stringValue(payload.providerError) || stringValue(payload.error);
    const healthy = status === "healthy" && configured !== false;
    code = {
      id: "code",
      label: "Clyra Code",
      detail: healthy
        ? model || backend || "Available"
        : error || (status ? `Runtime ${status}` : "Status could not be verified"),
      tone: healthy ? "available" : status === "starting" ? "working" : "attention",
      Icon: Cpu,
    };
  }

  const speechSnapshot = endpoints.speech;
  let speech: CapabilityRow;
  if (speechSnapshot.phase !== "ready") {
    speech = {
      id: "speech",
      label: "Local speech",
      detail: snapshotDetail(speechSnapshot),
      tone: speechSnapshot.phase === "checking" ? "working" : "unavailable",
      Icon: Mic,
    };
  } else {
    const payload = isRecord(speechSnapshot.value) ? speechSnapshot.value : {};
    const available = booleanValue(payload.available);
    const runtime = isRecord(payload.runtime) ? payload.runtime : {};
    const runtimeParts = [stringValue(runtime.profile), stringValue(runtime.gpu)].filter(Boolean);
    speech = {
      id: "speech",
      label: "Local speech",
      detail: available
        ? runtimeParts.join(" · ") || "Available"
        : safeDetail(payload.error, "Unavailable"),
      tone: available ? "available" : "attention",
      Icon: Mic,
    };
  }

  return [service, hermes, code, speech];
}

function projectSummaries(snapshot: EndpointSnapshot): ProjectSummary[] {
  if (snapshot.phase !== "ready" || !isRecord(snapshot.value)) return [];
  const projects = Array.isArray(snapshot.value.projects) ? snapshot.value.projects : [];
  return projects.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const name = stringValue(entry.displayName) || stringValue(entry.name);
    if (!id || !name) return [];
    return [{
      id,
      name,
      status: stringValue(entry.status),
      updatedAt: typeof entry.updatedAt === "number" || typeof entry.updatedAt === "string"
        ? entry.updatedAt
        : null,
    }];
  });
}

function taskSummaries(snapshot: EndpointSnapshot): TaskSummary[] {
  if (snapshot.phase !== "ready" || !isRecord(snapshot.value)) return [];
  const tasks = Array.isArray(snapshot.value.tasks) ? snapshot.value.tasks : [];
  return tasks.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const title = stringValue(entry.title);
    const state = stringValue(entry.state).toLowerCase();
    if (!id || !title || !state || !ACTIVE_TASK_STATES.has(state)) return [];
    return [{
      id,
      title,
      state,
      currentStep: stringValue(entry.currentStep),
      updatedAt: typeof entry.updatedAt === "number" || typeof entry.updatedAt === "string"
        ? entry.updatedAt
        : null,
    }];
  });
}

function usageSummary(snapshot: EndpointSnapshot): UsageSummary | null {
  if (snapshot.phase !== "ready" || !isRecord(snapshot.value)) return null;
  const today = isRecord(snapshot.value.today) ? snapshot.value.today : null;
  if (!today) return null;
  return {
    requests: numberValue(today.requests),
    tokens: numberValue(today.tokens),
  };
}

function formatRelativeTime(value: string | number | null | undefined): string {
  if (value == null) return "";
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 0) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
  }
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function formatCheckTime(value: number | null): string {
  if (value == null) return "Not checked yet";
  return `Checked ${new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(value)}`;
}

function formatState(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCount(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}

function endpointPhase(snapshot: EndpointSnapshot): EndpointPhase {
  return snapshot.phase;
}

function orbStateFor(
  endpoints: EndpointMap,
  capabilities: CapabilityRow[],
  tasks: TaskSummary[],
): ClyraSpatialOrbState {
  if (endpointPhase(endpoints.health) === "checking") return "checking";
  const service = capabilities.find((item) => item.id === "service");
  if (!service || service.tone === "unavailable" || service.tone === "attention") return "offline";
  if (tasks.some((task) => WORKING_TASK_STATES.has(task.state))) return "working";
  if (tasks.some((task) => ATTENTION_TASK_STATES.has(task.state))) return "attention";
  if (capabilities.some((item) => item.tone === "attention" || item.tone === "unavailable")) {
    return "attention";
  }
  if (capabilities.some((item) => item.tone === "working")) return "checking";
  return "ready";
}

export function ClyraSpatialOrb({ state, label, className = "" }: ClyraSpatialOrbProps) {
  const gradientId = `clyra-orb-${useId().replace(/:/g, "")}`;
  const resolvedLabel = label || ORB_DEFAULT_LABELS[state];

  return (
    <div
      className={`clyra-core-console__orb ${className}`.trim()}
      data-state={state}
      role="img"
      aria-label={`Clyra status: ${resolvedLabel}`}
    >
      <svg
        className="clyra-core-console__orb-svg"
        viewBox="0 0 320 320"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id={gradientId} cx="38%" cy="30%" r="72%">
            <stop className="clyra-core-console__orb-stop clyra-core-console__orb-stop--light" offset="0%" />
            <stop className="clyra-core-console__orb-stop clyra-core-console__orb-stop--mid" offset="54%" />
            <stop className="clyra-core-console__orb-stop clyra-core-console__orb-stop--edge" offset="100%" />
          </radialGradient>
        </defs>

        <circle className="clyra-core-console__orb-field" cx="160" cy="160" r="139" />
        <g className="clyra-core-console__orb-orbits">
          <ellipse cx="160" cy="160" rx="142" ry="58" />
          <ellipse cx="160" cy="160" rx="58" ry="142" transform="rotate(32 160 160)" />
          <path d="M51 98c42-57 139-83 211-31 37 27 54 70 50 111" />
        </g>
        <g className="clyra-core-console__orb-ticks">
          <path d="M160 10v12M160 298v12M10 160h12M298 160h12" />
          <path d="m54 54 9 9m194 194 9 9M54 266l9-9m194-194 9-9" />
        </g>
        <circle className="clyra-core-console__orb-rim" cx="160" cy="160" r="92" />
        <circle
          className="clyra-core-console__orb-body"
          cx="160"
          cy="160"
          r="78"
          fill={`url(#${gradientId})`}
        />
        <path
          className="clyra-core-console__orb-contour"
          d="M109 116c25-27 70-38 104-14 22 15 32 43 27 69-6 34-34 58-67 63-28 4-61-8-76-34-16-28-9-61 12-84Z"
        />
        <circle className="clyra-core-console__orb-core" cx="160" cy="160" r="31" />
        <path className="clyra-core-console__orb-signal" d="M137 164c11-20 32-31 53-25" />
        <circle className="clyra-core-console__orb-node" cx="190" cy="139" r="4.5" />
      </svg>

      <span className="clyra-core-console__orb-letter" aria-hidden="true">C</span>
      <span className="clyra-core-console__orb-status" aria-hidden="true">
        <i />
        {resolvedLabel}
      </span>
    </div>
  );
}

export function CoreConsoleBackdrop({
  recentChats = [],
  openChat,
  newChat,
  openSettings,
  openSidebar,
  openWorkspace,
  className = "",
}: CoreConsoleBackdropProps) {
  const [endpoints, setEndpoints] = useState<EndpointMap>(INITIAL_ENDPOINTS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    setIsRefreshing(true);

    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 8_000);

    const load = async () => {
      const entries = await Promise.all(
        (Object.entries(READ_ENDPOINTS) as Array<[EndpointKey, string]>).map(
          async ([key, path]) => {
            try {
              const value = await readEndpoint(path, controller.signal);
              return [key, { phase: "ready", value } satisfies EndpointSnapshot] as const;
            } catch (error) {
              if (controller.signal.aborted && !timedOut) throw error;
              return [
                key,
                {
                  phase: "unavailable",
                  error: timedOut ? "The local status check timed out." : requestError(error),
                } satisfies EndpointSnapshot,
              ] as const;
            }
          },
        ),
      );

      if (!active) return;
      setEndpoints(Object.fromEntries(entries) as EndpointMap);
      setCheckedAt(Date.now());
      setIsRefreshing(false);
    };

    void load().catch(() => {
      if (!active) return;
      setEndpoints((current) => {
        const next = { ...current };
        (Object.keys(next) as EndpointKey[]).forEach((key) => {
          if (next[key].phase === "checking") {
            next[key] = { phase: "unavailable", error: "The local status check was cancelled." };
          }
        });
        return next;
      });
      setIsRefreshing(false);
    }).finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [refreshKey]);

  const capabilities = useMemo(() => capabilityRows(endpoints), [endpoints]);
  const projects = useMemo(() => projectSummaries(endpoints.projects), [endpoints.projects]);
  const activeTasks = useMemo(() => taskSummaries(endpoints.tasks), [endpoints.tasks]);
  const usage = useMemo(() => usageSummary(endpoints.usage), [endpoints.usage]);
  const orbState = useMemo(
    () => orbStateFor(endpoints, capabilities, activeTasks),
    [activeTasks, capabilities, endpoints],
  );

  const primaryTask = activeTasks[0] ?? null;
  const attentionCapabilities = capabilities.filter(
    (item) => item.tone === "attention" || item.tone === "unavailable",
  );
  const readyCapabilityCount = capabilities.filter((item) => item.tone === "available").length;
  const orbLabel = primaryTask && WORKING_TASK_STATES.has(primaryTask.state)
    ? safeDetail(primaryTask.currentStep, "Working")
    : ORB_DEFAULT_LABELS[orbState];

  const centreCopy = (() => {
    if (orbState === "working" && primaryTask) {
      return {
        eyebrow: "Now in motion",
        title: primaryTask.title,
        description: primaryTask.currentStep || `Cowork reports this task as ${formatState(primaryTask.state)}.`,
      };
    }
    if (orbState === "offline") {
      const service = capabilities.find((item) => item.id === "service");
      return {
        eyebrow: "Local service",
        title: "Clyra is not reachable",
        description: service?.detail || "The application service did not return a verified status.",
      };
    }
    if (orbState === "attention") {
      const taskNeedingAttention = activeTasks.find((task) => ATTENTION_TASK_STATES.has(task.state));
      return {
        eyebrow: taskNeedingAttention ? formatState(taskNeedingAttention.state) : "Capability check",
        title: taskNeedingAttention?.title || "A capability needs attention",
        description: taskNeedingAttention?.currentStep
          || (attentionCapabilities.length
            ? `${attentionCapabilities.map((item) => item.label).slice(0, 2).join(" and ")} ${attentionCapabilities.length === 1 ? "is" : "are"} not fully available.`
            : "Open the status panel for the latest verified state."),
      };
    }
    if (orbState === "checking") {
      return {
        eyebrow: "Command centre",
        title: "Checking local capabilities",
        description: "Clyra is reading the current service state. No work has been started.",
      };
    }
    return {
      eyebrow: "Command centre",
      title: "Ready for your next direction",
      description: "The local service and connected capabilities are responding.",
    };
  })();

  const refresh = () => setRefreshKey((key) => key + 1);
  const visibleChats = recentChats.slice(0, 3);
  const visibleProjects = projects.slice(0, 3);
  const visibleTasks = activeTasks.slice(0, 2);

  return (
    <main className={`clyra-core-console ${className}`.trim()} aria-label="Clyra command centre">
      <header className="clyra-core-console__topline">
        <button
          className="clyra-core-console__brand"
          type="button"
          onClick={() => openWorkspace("chat")}
          aria-label="Open Clyra chat"
        >
          <span className="clyra-core-console__brand-mark" aria-hidden="true">C</span>
          <span>
            <strong>Clyra</strong>
            <small>Command centre</small>
          </span>
        </button>

        <div className="clyra-core-console__system-state" role="status" aria-live="polite">
          <i data-state={orbState} aria-hidden="true" />
          <span>{ORB_DEFAULT_LABELS[orbState]}</span>
          <small>{readyCapabilityCount}/{capabilities.length} capabilities ready</small>
        </div>

        <div className="clyra-core-console__topline-meta">
          {usage?.requests != null ? (
            <span>
              {formatCount(usage.requests)} request{usage.requests === 1 ? "" : "s"} today
              {usage.tokens != null ? ` · ${formatCount(usage.tokens)} tokens` : ""}
            </span>
          ) : (
            <span>Usage unavailable</span>
          )}
          <time dateTime={checkedAt ? new Date(checkedAt).toISOString() : undefined}>
            {formatCheckTime(checkedAt)}
          </time>
          <button
            className="clyra-core-console__refresh"
            type="button"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label={isRefreshing ? "Refreshing live status" : "Refresh live status"}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="clyra-core-console__rail" aria-label="Clyra workspaces">
        <button type="button" onClick={openSidebar} aria-label="Open sidebar" data-tooltip="Sidebar">
          <Menu aria-hidden="true" />
        </button>
        <span className="clyra-core-console__rail-rule" aria-hidden="true" />
        <button type="button" onClick={() => openWorkspace("chat")} aria-label="Open chat" data-tooltip="Chat">
          <MessageSquare aria-hidden="true" />
        </button>
        <button type="button" onClick={() => openWorkspace("vibe")} aria-label="Open Clyra Code" data-tooltip="Code">
          <Code2 aria-hidden="true" />
        </button>
        <button type="button" onClick={() => openWorkspace("browser")} aria-label="Open browser" data-tooltip="Browser">
          <Globe2 aria-hidden="true" />
        </button>
        <button type="button" onClick={() => openWorkspace("cowork")} aria-label="Open Agents" data-tooltip="Agents">
          <Users aria-hidden="true" />
        </button>
        <button type="button" onClick={() => openWorkspace("maps")} aria-label="Open maps" data-tooltip="Maps">
          <Map aria-hidden="true" />
        </button>
        <span className="clyra-core-console__rail-spacer" />
        <button type="button" onClick={newChat} aria-label="Start a new chat" data-tooltip="New chat">
          <Plus aria-hidden="true" />
        </button>
        <button type="button" onClick={openSettings} aria-label="Open settings" data-tooltip="Settings">
          <Settings aria-hidden="true" />
        </button>
      </nav>

      <div className="clyra-core-console__stage">
        <aside
          className="clyra-core-console__panel clyra-core-console__panel--continue"
          aria-labelledby="clyra-core-continue-title"
        >
          <div className="clyra-core-console__panel-heading">
            <span className="clyra-core-console__eyebrow">Pick up where you left off</span>
            <div>
              <h2 id="clyra-core-continue-title">Continue</h2>
              <button type="button" onClick={openSidebar}>View all</button>
            </div>
          </div>

          <div className="clyra-core-console__list" aria-label="Recent conversations">
            {visibleChats.length ? visibleChats.map((chat) => (
              <button
                className="clyra-core-console__continue-row"
                type="button"
                key={chat.id}
                onClick={() => openChat(chat.id)}
              >
                <span className="clyra-core-console__row-icon" aria-hidden="true">
                  {chat.kind === "vibe" ? <Code2 /> : <MessageSquare />}
                </span>
                <span className="clyra-core-console__row-copy">
                  <strong>{chat.title}</strong>
                  <small>{chat.preview || formatRelativeTime(chat.updatedAt)}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            )) : (
              <div className="clyra-core-console__empty-state">
                <MessageSquare aria-hidden="true" />
                <span>
                  <strong>No recent conversations</strong>
                  <small>Start a chat and it will appear here.</small>
                </span>
              </div>
            )}
          </div>

          <div className="clyra-core-console__section-heading">
            <span>Spaces</span>
            <button type="button" onClick={() => openWorkspace("vibe")}>Open code</button>
          </div>

          <div className="clyra-core-console__list" aria-label="Recent Clyra Code spaces">
            {endpoints.projects.phase === "checking" ? (
              <p className="clyra-core-console__inline-state"><Activity aria-hidden="true" /> Checking spaces…</p>
            ) : endpoints.projects.phase === "unavailable" ? (
              <p className="clyra-core-console__inline-state is-unavailable">
                <Folder aria-hidden="true" /> Spaces unavailable
              </p>
            ) : visibleProjects.length ? visibleProjects.map((project) => (
              <button
                className="clyra-core-console__space-row"
                type="button"
                key={project.id}
                onClick={() => openWorkspace("vibe")}
                aria-label={`Open Clyra Code for ${project.name}`}
              >
                <Folder aria-hidden="true" />
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {[project.status ? formatState(project.status) : "", formatRelativeTime(project.updatedAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            )) : (
              <p className="clyra-core-console__inline-state"><Folder aria-hidden="true" /> No code spaces yet</p>
            )}
          </div>
        </aside>

        <section className="clyra-core-console__centre" aria-labelledby="clyra-core-centre-title">
          <div className="clyra-core-console__orb-plane" aria-hidden="true" />
          <ClyraSpatialOrb state={orbState} label={orbLabel} />
          <div className="clyra-core-console__centre-copy">
            <span className="clyra-core-console__eyebrow">{centreCopy.eyebrow}</span>
            <h1 id="clyra-core-centre-title">{centreCopy.title}</h1>
            <p>{centreCopy.description}</p>
          </div>
          <div className="clyra-core-console__centre-actions">
            <button className="is-primary" type="button" onClick={newChat}>
              <Plus aria-hidden="true" />
              New conversation
            </button>
            <button
              type="button"
              onClick={() => openWorkspace(primaryTask ? "cowork" : "vibe")}
            >
              {primaryTask ? "Open active work" : "Open workspace"}
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
        </section>

        <aside
          className="clyra-core-console__panel clyra-core-console__panel--status"
          aria-labelledby="clyra-core-working-title"
        >
          <div className="clyra-core-console__panel-heading">
            <span className="clyra-core-console__eyebrow">Verified local state</span>
            <div>
              <h2 id="clyra-core-working-title">Now working</h2>
              <button type="button" onClick={() => openWorkspace("cowork")}>Cowork</button>
            </div>
          </div>

          <div className="clyra-core-console__work-list">
            {endpoints.tasks.phase === "checking" ? (
              <p className="clyra-core-console__inline-state"><Activity aria-hidden="true" /> Checking active work…</p>
            ) : endpoints.tasks.phase === "unavailable" ? (
              <div className="clyra-core-console__truth-state" role="status">
                <Activity aria-hidden="true" />
                <span>
                  <strong>Task status unavailable</strong>
                  <small>{endpoints.tasks.error}</small>
                </span>
              </div>
            ) : visibleTasks.length ? visibleTasks.map((task) => (
              <button
                className="clyra-core-console__task-row"
                type="button"
                key={task.id}
                onClick={() => openWorkspace("cowork")}
                aria-label={`Open Cowork task: ${task.title}`}
              >
                <i data-state={task.state} aria-hidden="true" />
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.currentStep || formatState(task.state)}</small>
                </span>
                <span className="clyra-core-console__task-state">{formatState(task.state)}</span>
              </button>
            )) : (
              <div className="clyra-core-console__truth-state">
                <Activity aria-hidden="true" />
                <span>
                  <strong>Nothing is running</strong>
                  <small>Cowork reports no active tasks.</small>
                </span>
              </div>
            )}
          </div>

          <div className="clyra-core-console__section-heading">
            <span>Capability health</span>
            <button type="button" onClick={refresh} disabled={isRefreshing}>
              {isRefreshing ? "Checking" : "Refresh"}
            </button>
          </div>

          <div className="clyra-core-console__capability-list" aria-label="Capability health">
            {capabilities.map(({ id, label, detail, tone, Icon }) => (
              <div className="clyra-core-console__capability-row" key={id} data-tone={tone}>
                <span className="clyra-core-console__capability-icon" aria-hidden="true"><Icon /></span>
                <span>
                  <strong>{label}</strong>
                  <small title={detail}>{detail}</small>
                </span>
                <i aria-label={formatState(tone)} />
              </div>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

export default CoreConsoleBackdrop;
