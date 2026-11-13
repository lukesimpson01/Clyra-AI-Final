/**
 * Typed client for the existing Clyra OpenCode harness + vibe project/preview
 * APIs. No new backend: every call maps to a route that already exists in
 * lib/opencode/opencode-routes.ts and server.ts.
 */

import type { DesignSystemSummary, DesignTemplateSummary } from "../../../lib/clyra-design/directive";
import type {
  TemplateImportMode,
  TemplateManifest,
  TemplateStatus,
} from "../../../lib/clyra-code/library/registry";
import type { TemplateCheckoutInspection, TemplateImportPlan, TemplateRemoteVerification } from "../../../lib/clyra-code/library/service";


export type ComponentCatalogItem = {
  id: string;
  source: "shadcn" | "21st";
  name: string;
  title: string;
  description: string;
  category: string;
  previewUrl: string;
  frame: { width: number; height: number };
  examples: Array<{ name: string; title: string; previewUrl: string }>;
  docsUrl?: string;
  registryId: string;
  origin?: string;
  offline?: boolean;
};

export type ComponentDetails = {
  item: ComponentCatalogItem;
  files: Array<{ path: string; content: string }>;
  dependencies: string[];
  registryDependencies: string[];
  requirements: string[];
  license: string;
};

export type ComponentInstallResult = {
  ok: boolean;
  installed: string[];
  files: string[];
  dependenciesToInstall: string[];
  note: string;
};

export type VibeProject = {
  id: string;
  name: string;
  prompt: string;
  mode: "plan" | "fast";
  status: string;
  createdAt: string;
  updatedAt: string;
  /** The name the sidebar shows. Derived from the project itself when the stored name is only a prompt. */
  displayName?: string;
  /** "user" once the user has renamed the project. Their name is never replaced. */
  nameSource?: "user";
  /** Durable sidebar state. Stored with the project, not in the browser. */
  pinned?: boolean;
  archivedAt?: string;
  previewUrl?: string;
  platform?: "web";
  /** "design" projects are visual screens and live under the Design tab. */
  kind?: "code" | "design";
  designSystemId?: string;
  designTemplateId?: string;
};

export type ProjectGitStatus = {
  initialized: boolean;
  branch: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  changes: Array<{ path: string; status: "A" | "M" | "D" | "R" | "?"; staged: boolean }>;
};

export type FileDiff = {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
};

export type OpenCodePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status: "pending" | "running" | "completed" | "error";
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
    error?: string;
    metadata?: Record<string, unknown>;
    time?: { start?: number; end?: number };
  };
  tokens?: { input?: number; output?: number; reasoning?: number };
  [key: string]: unknown;
};

export type OpenCodeMessage = {
  info: { id: string; role: "user" | "assistant"; time?: { created?: number } };
  parts: OpenCodePart[];
};

export type PreviewSession = {
  projectId: string;
  status: string;
  url?: string;
  port?: number;
  devCommand?: string;
  lastError?: { message?: string } | null;
};

export type PreviewLogLine = {
  id?: string;
  stream?: string;
  line?: string;
  text?: string;
  timestamp?: number;
};

export type VibeUsageAnalytics = {
  range: "all" | "30d" | "7d";
  calendarStart: string;
  calendarEnd: string;
  sessions: number;
  messages: number;
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  peakHour: string | null;
  favoriteModel: string | null;
  insight: string;
  heatmap: Array<{ date: string; sessions: number; messages: number; tokens: number; activeMinutes: number; runs: number; level: number }>;
  models: Array<{ model: string; provider: string; requests: number; inputTokens: number; outputTokens: number; totalTokens: number; avgLatencyMs: number; errorRate: number; toolCalls: number; sessions: number }>;
};

export type UploadedCodeAttachment = {
  name: string;
  relativePath?: string;
  type: string;
  data: string;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (body as { error?: string })?.error === "string"
      ? (body as { error: string }).error
      : `${url} failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  componentLibraryStatus: () =>
    json<{ sources: Array<{ id: "shadcn" | "21st"; available: boolean; detail: string }> }>("/api/clyra-code/components/status"),
  componentCatalog: (filters: { q?: string; category?: string } = {}) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.category) query.set("category", filters.category);
    return json<{ items: ComponentCatalogItem[]; errors: Array<{ source: string; message: string }>; categories: Array<{ name: string; count: number }> }>("/api/clyra-code/components?" + query.toString());
  },
  componentDetails: (source: "shadcn" | "21st", name: string) =>
    json<ComponentDetails>("/api/clyra-code/components/" + enc(source) + "/" + enc(name)),
  installComponent: (projectId: string, source: "shadcn" | "21st", name: string) =>
    json<ComponentInstallResult>("/api/clyra-code/components/install", {
      method: "POST", body: JSON.stringify({ projectId, source, name }),
    }),
  listProjects: () =>
    json<{ projects: VibeProject[] }>("/api/vibe/projects").then((r) => r.projects ?? []),

  createProject: (name: string, prompt = "", options?: { kind?: "code" | "design"; designSystemId?: string | null; designTemplateId?: string | null }) =>
    json<{ project: VibeProject }>("/api/vibe/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        prompt,
        kind: options?.kind ?? "code",
        ...(options?.designSystemId ? { designSystemId: options.designSystemId } : {}),
        ...(options?.designTemplateId ? { designTemplateId: options.designTemplateId } : {}),
      }),
    }).then((r) => r.project),

  /** Sets the design system and starting layout of an existing design project. */
  setProjectDesign: (id: string, choice: { designSystemId: string | null; designTemplateId: string | null }) =>
    json<{ project: VibeProject }>(`/api/vibe/projects/${enc(id)}/design`, {
      method: "POST",
      body: JSON.stringify(choice),
    }).then((r) => r.project),

  /** The bundled design systems and templates that a Design project can start from. */
  designCatalog: () =>
    json<{ systems: DesignSystemSummary[]; templates: DesignTemplateSummary[] }>("/api/design/catalog"),

  importProject: (path: string) =>
    json<{ project: VibeProject }>("/api/vibe/projects/import", {
      method: "POST",
      body: JSON.stringify({ path }),
    }).then((r) => r.project),

  /** "Open in Clyra Code" handoff from the embedded OpenDesign UI. */
  importOpenDesignProject: (openDesignProjectId: string, name?: string) =>
    json<{ project: VibeProject; path: string }>(`/api/open-design/import/${encodeURIComponent(openDesignProjectId)}`, {
      method: "POST",
      body: JSON.stringify({ name: name ?? "" }),
    }).then((r) => r.project),

  /** Deploy an OpenDesign project to GitHub Pages via the host's `gh` CLI. */
  deployOpenDesignProject: (openDesignProjectId: string) =>
    json<{ ok: boolean; url?: string; repo?: string }>(`/api/open-design/deploy/${encodeURIComponent(openDesignProjectId)}`, {
      method: "POST",
    }),

  importGitHubProject: (url: string) =>
    json<{ project: VibeProject }>("/api/vibe/projects/import-github", {
      method: "POST",
      body: JSON.stringify({ url }),
    }).then((r) => r.project),

  renameProject: (id: string, name: string) =>
    json<{ project: VibeProject }>(`/api/vibe/projects/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }).then((r) => r.project),

  /** Pins, unpins, removes from or restores to the sidebar. Never deletes project files. */
  updateProjectState: (id: string, patch: { pinned?: boolean; archived?: boolean }) =>
    json<{ project: VibeProject }>(`/api/vibe/projects/${enc(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then((r) => r.project),

  openProjectFolder: (id: string) =>
    json<{ ok: boolean; path: string }>(`/api/vibe/projects/${enc(id)}/open-folder`, { method: "POST" }),

  githubStatus: () => json<{ connected: boolean; account: { login: string; avatarUrl?: string } | null; authAvailable: boolean; message: string }>("/api/vibe/github/status"),

  projectGitStatus: (id: string) => json<ProjectGitStatus>(`/api/vibe/projects/${enc(id)}/git/status`),

  initProjectGit: (id: string) => json<ProjectGitStatus>(`/api/vibe/projects/${enc(id)}/git/init`, { method: "POST" }),

  stageProjectGitPath: (id: string, path: string, staged: boolean) => json<ProjectGitStatus>(`/api/vibe/projects/${enc(id)}/git/stage`, {
    method: "POST", body: JSON.stringify({ path, staged }),
  }),

  commitProjectGit: (id: string, message: string) => json<{ oid: string; status: ProjectGitStatus }>(`/api/vibe/projects/${enc(id)}/git/commit`, {
    method: "POST", body: JSON.stringify({ message }),
  }),

  projectGitBranches: (id: string) => json<{ current: string | null; branches: string[] }>(`/api/vibe/projects/${enc(id)}/git/branches`),

  createProjectGitBranch: (id: string, name: string) => json<{ current: string | null; branches: string[] }>(`/api/vibe/projects/${enc(id)}/git/branches`, {
    method: "POST", body: JSON.stringify({ name }),
  }),

  checkoutProjectGitBranch: (id: string, branch: string) => json<{ current: string | null; branches: string[] }>(`/api/vibe/projects/${enc(id)}/git/checkout`, {
    method: "POST", body: JSON.stringify({ branch }),
  }),

  sourceEdit: (projectId: string, payload: { file: string; selector: string; property: string; value: string }) =>
    json<{
      applied: boolean;
      error?: string;
      file?: string;
      before?: string;
      after?: string;
      additions?: number;
      deletions?: number;
    }>(`/api/vibe/projects/${enc(projectId)}/source-edit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getProject: (id: string) =>
    json<{ project: VibeProject; files: Array<{ path: string; content: string }>; plan: string }>(
      `/api/vibe/projects/${enc(id)}`,
    ),

  writeProjectFile: (id: string, path: string, content: string) =>
    json<{ ok: boolean; files: Array<{ path: string; content: string }> }>(`/api/vibe/projects/${enc(id)}/files`, {
      method: "PUT",
      body: JSON.stringify({ path, content }),
    }),

  createProjectFolder: (id: string, path: string) =>
    json<{ ok: boolean }>(`/api/vibe/projects/${enc(id)}/folders`, {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  deleteProjectFile: (id: string, path: string, recursive = false) =>
    json<{ ok: boolean }>(`/api/vibe/projects/${enc(id)}/files`, {
      method: "DELETE",
      body: JSON.stringify({ path, recursive }),
    }),

  moveProjectPath: (id: string, from: string, to: string) =>
    json<{ ok: boolean; files: Array<{ path: string; content: string }> }>(`/api/vibe/projects/${enc(id)}/paths`, {
      method: "PATCH",
      body: JSON.stringify({ from, to }),
    }),

  openCodeStatus: () =>
    json<{ status: string; model?: string; serverUrl?: string; error?: string }>(
      "/api/opencode/status",
    ),

  vibeUsage: (range: "all" | "30d" | "7d") => json<VibeUsageAnalytics>(`/api/vibe/v3/usage?range=${range}`),

  startRuntime: (projectId: string) =>
    json<{ projectId: string; serverUrl: string; status: string }>(
      "/api/opencode/runtime/start",
      { method: "POST", body: JSON.stringify({ projectId }) },
    ),

  undoLastCheckpoint: (projectId: string) =>
    json<{ ok: boolean; checkpointId: string; message: string }>(
      `/api/opencode/projects/${enc(projectId)}/checkpoints/undo`,
      { method: "POST" },
    ),

  createSession: (projectId: string, title: string) =>
    json<{ id: string; title: string }>("/api/opencode/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId, title }),
    }),

  listSessions: (projectId: string) =>
    json<Array<{ id: string; title: string; time?: { created?: number; updated?: number } }>>(
      `/api/opencode/sessions/${enc(projectId)}`,
    ),

  renameSession: (projectId: string, sessionId: string, title: string) =>
    json<{ id: string; title: string }>(`/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteSession: (projectId: string, sessionId: string) =>
    json<{ ok: boolean }>(`/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}`, {
      method: "DELETE",
    }),

  sendPrompt: (projectId: string, sessionId: string, text: string, agent?: string, effort: "low" | "medium" | "high" = "medium") =>
    json<{ ok: boolean }>(
      `/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/prompt`,
      { method: "POST", body: JSON.stringify({ text, agent, effort }) },
    ),

  pauseSession: (projectId: string, sessionId: string) =>
    json<{ ok: boolean }>(`/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/pause`, { method: "POST" }),

  resumeSession: (projectId: string, sessionId: string) =>
    json<{ ok: boolean }>(`/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/resume`, { method: "POST" }),

  uploadAttachments: (projectId: string, files: UploadedCodeAttachment[]) =>
    json<{ attachments: Array<{ name: string; path: string; type: string }> }>(
      `/api/opencode/projects/${enc(projectId)}/attachments`,
      { method: "POST", body: JSON.stringify({ files }) },
    ),

  abortSession: (projectId: string, sessionId: string) =>
    json<{ ok: boolean }>(
      `/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/abort`,
      { method: "POST" },
    ),

  /* Tool caches and build output are not the agent's work; the changes list shows only real files. */
  sessionDiff: (projectId: string, sessionId: string) =>
    json<FileDiff[]>(`/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/diff`)
      .then((diffs) => diffs.filter((diff) => !/(^|\/)(\.vite|node_modules|\.next|\.turbo|\.cache|dist|build|\.parcel-cache|DerivedData)\//.test(String(diff.file || "")))),

  sessionMessages: (projectId: string, sessionId: string) =>
    json<OpenCodeMessage[]>(
      `/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/messages`,
    ),

  replyPermission: (
    projectId: string,
    sessionId: string,
    permissionId: string,
    response: "allow" | "always" | "deny",
  ) =>
    json<{ ok: boolean }>(
      `/api/opencode/sessions/${enc(projectId)}/${enc(sessionId)}/permissions/${enc(permissionId)}`,
      { method: "POST", body: JSON.stringify({ response }) },
    ),

  previewStart: (projectId: string) =>
    json<{ session: PreviewSession }>("/api/vibe/preview/start", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }).then((r) => r.session),

  previewRestart: (projectId: string) =>
    json<{ session: PreviewSession }>("/api/vibe/preview/restart", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    }).then((r) => r.session),

  previewStatus: (projectId: string) =>
    json<{ session: PreviewSession | null }>(`/api/vibe/preview/status/${enc(projectId)}`).then(
      (r) => r.session,
    ),

  previewLogs: (projectId: string) =>
    json<{ logs: PreviewLogLine[] }>(`/api/vibe/preview/logs/${enc(projectId)}`).then(
      (r) => r.logs ?? [],
    ),

  eventsUrl: (projectId: string) => `/api/opencode/events/${enc(projectId)}`,

  diagnostic: (projectId: string) =>
    json<{ phase?: string; remaining?: string[]; completed?: string[]; changedFiles?: string[] } & Record<string, unknown>>(
      `/api/opencode/diagnostic/${enc(projectId)}`,
    ),

  platform: (refresh = false) =>
    json<PlatformSnapshot>(`/api/clyra-code/platform${refresh ? "?refresh=1" : ""}`),

  projectTargets: (projectId: string) =>
    json<{ targets: DetectedTarget[]; primary: DetectedTarget | null }>(
      `/api/clyra-code/projects/${enc(projectId)}/targets`,
    ),

  swiftCommand: (projectId: string, command: SwiftPackageCommand, options: { configuration?: "debug" | "release" } = {}) =>
    json<SwiftCommandResult>(`/api/clyra-code/projects/${enc(projectId)}/swift/${command}`, {
      method: "POST",
      body: JSON.stringify(options),
    }),

  templateLibrary: (filters: { q?: string; category?: string; status?: TemplateStatus; offset?: number; limit?: number } = {}) => {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
    const suffix = query.toString();
    return json<{ entries: TemplateManifest[]; total: number; categories: string[]; nextOffset: number | null }>(`/api/clyra-code/library${suffix ? `?${suffix}` : ""}`);
  },

  templateManifest: (templateId: string) =>
    json<{ manifest: TemplateManifest }>(`/api/clyra-code/library/${enc(templateId)}`).then((result) => result.manifest),

  templateImportPlan: (templateId: string) =>
    json<{ plan: TemplateImportPlan }>(`/api/clyra-code/library/${enc(templateId)}/import-plan`, { method: "POST" }).then((result) => result.plan),

  importTemplateSource: (templateId: string, payload: { mode: TemplateImportMode; projectId?: string | null; confirmed: true }) =>
    json<{
      project: VibeProject;
      importedIntoExisting: boolean;
      sourcePath: string;
      verification: TemplateRemoteVerification;
      inspection: TemplateCheckoutInspection;
      message: string;
    }>(`/api/clyra-code/library/${enc(templateId)}/import`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// Server contracts. Type-only imports are erased at build time, so the Node-only
// platform modules never reach the browser bundle.
import type { PlatformCapabilityMatrix } from "../../../lib/clyra-code/platform/capabilities";
import type { DetectedTarget } from "../../../lib/clyra-code/targets/detect";
import type { SwiftCommandResult, SwiftPackageCommand } from "../../../lib/clyra-code/swift/swift-package";
import type { SimulatorListing } from "../../../lib/clyra-code/ios/simulators";

export type {
  PlatformCapabilityMatrix,
  DetectedTarget,
  SwiftCommandResult,
  SwiftPackageCommand,
  SimulatorListing,
  TemplateImportMode,
  TemplateManifest,
  TemplateStatus,
  TemplateCheckoutInspection,
  TemplateImportPlan,
  TemplateRemoteVerification,
};

export type PlatformSnapshot = {
  matrix: PlatformCapabilityMatrix;
  simulators: SimulatorListing;
  checkedAt: string;
};
