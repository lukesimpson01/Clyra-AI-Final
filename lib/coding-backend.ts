/**
 * Backend selection for the Clyra Code runtime.
 *
 * Clyra Code speaks one HTTP/SSE contract to the renderer (see
 * `lib/opencode/opencode-routes.ts`); two runtimes implement it. The DeepSeek
 * Harness runtime is the default; set `CLYRA_CODE_BACKEND=opencode` to run the
 * previous OpenCode runtime instead. Nothing else in the app needs to know
 * which one is live.
 */

import { codingModelStatus, openCodeRuntimeManager, type ClyraAgentEvent } from "./opencode/OpenCodeRuntimeManager";
import { deepSeekHarnessRuntimeManager, harnessModelStatus } from "./deepseek-harness/DeepSeekHarnessRuntimeManager";
import type { VibeEffort } from "./vibe-agent-v3/preflight";

/** The subset of a runtime the Clyra Code routes actually call. */
export interface CodingRuntimeManager {
  start(projectId: string, projectPath: string): Promise<unknown>;
  stop(): Promise<unknown>;
  health(projectId?: string): Promise<Record<string, unknown>>;
  inspect(projectId: string): unknown;
  createSession(projectId: string, title?: string): Promise<{ id: string; title?: string }>;
  listSessions(projectId: string, projectPath?: string): Promise<unknown>;
  renameSession(projectId: string, sessionId: string, title: string): Promise<unknown>;
  deleteSession(projectId: string, sessionId: string): Promise<unknown>;
  messages(projectId: string, sessionId: string): Promise<unknown>;
  diff(projectId: string, sessionId: string): Promise<unknown>;
  undoLastCheckpoint(projectId: string): Promise<unknown>;
  prompt(
    projectId: string,
    sessionId: string,
    text: string,
    agent?: string,
    model?: { providerID: string; modelID: string },
    effort?: VibeEffort,
  ): Promise<unknown>;
  abort(projectId: string, sessionId: string): Promise<unknown>;
  pause?(projectId: string, sessionId: string): Promise<unknown>;
  resume?(projectId: string, sessionId: string): Promise<unknown>;
  respondPermission(projectId: string, sessionId: string, permissionId: string, response: string): Promise<unknown>;
  subscribe(projectId: string, listener: (event: ClyraAgentEvent) => void): () => void;
}

export type CodingBackend = "deepseek-harness" | "opencode";

export function codingBackend(): CodingBackend {
  return String(process.env.CLYRA_CODE_BACKEND || "").trim().toLowerCase() === "opencode"
    ? "opencode"
    : "deepseek-harness";
}

export function codingRuntimeManager(): CodingRuntimeManager {
  return codingBackend() === "opencode"
    ? (openCodeRuntimeManager as unknown as CodingRuntimeManager)
    : (deepSeekHarnessRuntimeManager as unknown as CodingRuntimeManager);
}

/** Model identity for the live backend. Credentials never appear here. */
export function codingBackendModelStatus() {
  return codingBackend() === "opencode" ? codingModelStatus() : harnessModelStatus();
}

/** Runtime identity reported by the status route, for support and diagnostics. */
export function codingBackendVersion() {
  if (codingBackend() === "opencode") {
    return { sdk: "@opencode-ai/sdk", version: "1.18.12" };
  }
  return { sdk: "@deepseek-ai/dsh-sdk-client", version: "0.1.2-alpha.3" };
}
