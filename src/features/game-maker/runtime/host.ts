/**
 * Editor-side half of the runtime bridge (spec §52–§55).
 *
 * Owns the sandboxed iframe, the MessageChannel handshake and every
 * request/response correlation. Nothing here ever evals game code: the
 * runtime document is a separate build entry loaded by URL, and the only
 * thing crossing the boundary is validated JSON.
 */
import {
  EditorRuntimeCommandSchema,
  RuntimeMessageSchema,
  RUNTIME_PROTOCOL_VERSION,
  type EditorRuntimeCommand,
  type GameEvent,
  type RenderReport,
  type RuntimeMessage,
  type RuntimeMetrics,
  type RuntimeQuery,
  type RuntimeSnapshot,
} from "./protocol";
import type { GameProjectIR } from "../ir/types";

/**
 * One runtime document per engine. A sandboxed opaque-origin frame can only
 * load its own parse-time module graph, so the engine cannot be chosen at
 * runtime — it is chosen by which document the editor mounts.
 */
export const RUNTIME_DOCUMENTS = {
  "3d": "/game-runtime.html",
  voxel: "/game-runtime.html",
  "2d": "/game-runtime-2d.html",
} as const;

export function runtimeDocumentFor(mode: "3d" | "2d" | "voxel") {
  return RUNTIME_DOCUMENTS[mode] ?? RUNTIME_DOCUMENTS["3d"];
}

export type RuntimeState = "idle" | "loading" | "playing" | "paused" | "stopped" | "error";

export interface RuntimeLogEntry {
  level: "log" | "info" | "warn" | "error";
  message: string;
  time: number;
}

export interface RuntimeHostEvents {
  onState?: (state: RuntimeState) => void;
  onLog?: (entry: RuntimeLogEntry) => void;
  onError?: (message: string, fatal: boolean) => void;
  onEvent?: (event: GameEvent) => void;
  onMetrics?: (metrics: RuntimeMetrics) => void;
  onLoaded?: (info: { sceneId: string; entityCount: number; warnings: string[] }) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let requestSequence = 0;

export class RuntimeHost {
  private iframe: HTMLIFrameElement | null = null;
  private port: MessagePort | null = null;
  private readonly pending = new Map<string, Pending>();
  private readyResolve: (() => void) | null = null;
  private bootListener: ((event: MessageEvent) => void) | null = null;
  private readyPromise: Promise<void> | null = null;
  private disposed = false;

  state: RuntimeState = "idle";
  mode: "3d" | "2d" | "voxel" = "3d";
  /** Set when the runtime document evaluated its kernel (see boot.ts). */
  booted = false;
  capabilities: { webgpu: boolean; webgl2: boolean; maxTextureSize: number; hardwareConcurrency: number } | null = null;
  readonly logs: RuntimeLogEntry[] = [];
  readonly events: GameEvent[] = [];
  lastMetrics: RuntimeMetrics | null = null;
  errorCount = 0;

  constructor(private readonly handlers: RuntimeHostEvents = {}) {}

  /**
   * Attach to a container. `sandbox="allow-scripts"` without
   * `allow-same-origin` gives the game an opaque origin — it cannot reach
   * the editor's storage, cookies or DOM (spec §53, §170).
   */
  mount(container: HTMLElement, mode: "3d" | "2d" | "voxel" = "3d"): Promise<void> {
    if (this.iframe) return this.readyPromise ?? Promise.resolve();
    this.mode = mode;

    const iframe = document.createElement("iframe");
    iframe.className = "gm-runtime-frame";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("title", "Game runtime");
    // xr-spatial-tracking is granted only to silence the engine's
    // availability probe; nothing in the runtime starts an XR session.
    iframe.setAttribute("allow", "autoplay; gamepad; xr-spatial-tracking");
    iframe.style.cssText = "width:100%;height:100%;border:0;display:block;background:#0b0d10";
    iframe.src = runtimeDocumentFor(mode);
    container.appendChild(iframe);
    this.iframe = iframe;

    const onBoot = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { type?: string } | undefined;
      if (data?.type === "gm.boot") this.booted = true;
    };
    window.addEventListener("message", onBoot);
    this.bootListener = onBoot;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            this.booted
              ? "The game runtime loaded but never completed its handshake with the editor. Reload the editor and press Play again."
              : `The game runtime document (${runtimeDocumentFor(mode)}) did not start within 20 seconds. Check the browser console for a failed module or a blocked script.`,
          ),
        );
      }, 20_000);
      this.readyResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // Hand the runtime one end of a private channel on load.
    iframe.addEventListener("load", () => {
      if (this.disposed) return;
      const channel = new MessageChannel();
      this.port = channel.port1;
      channel.port1.onmessage = (message) => this.receive(message.data);
      channel.port1.start();
      // targetOrigin "*" is required: a sandboxed frame has an opaque origin.
      iframe.contentWindow?.postMessage({ type: "gm.handshake", protocol: RUNTIME_PROTOCOL_VERSION }, "*", [channel.port2]);
    });

    return this.readyPromise;
  }

  private setState(state: RuntimeState) {
    this.state = state;
    this.handlers.onState?.(state);
  }

  private receive(raw: unknown) {
    const parsed = RuntimeMessageSchema.safeParse(raw);
    if (!parsed.success) {
      // A malformed frame is a runtime bug, not a reason to tear down.
      this.handlers.onLog?.({ level: "warn", message: "Discarded a malformed runtime message.", time: Date.now() });
      return;
    }
    const message: RuntimeMessage = parsed.data;

    switch (message.type) {
      case "runtime.ready":
        this.capabilities = message.capabilities;
        this.setState("idle");
        this.readyResolve?.();
        break;
      case "runtime.loaded":
        this.handlers.onLoaded?.(message);
        break;
      case "runtime.state":
        this.setState(message.state === "idle" ? "idle" : message.state);
        break;
      case "runtime.log": {
        const entry = { level: message.level, message: message.message, time: message.time };
        this.logs.push(entry);
        if (this.logs.length > 500) this.logs.shift();
        this.handlers.onLog?.(entry);
        break;
      }
      case "runtime.error":
        this.errorCount += 1;
        this.logs.push({ level: "error", message: message.error.message, time: Date.now() });
        this.handlers.onError?.(message.error.message, message.error.fatal);
        if (message.error.fatal) this.setState("error");
        break;
      case "runtime.event":
        this.events.push(message.event);
        if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
        this.handlers.onEvent?.(message.event);
        break;
      case "runtime.metrics":
        this.lastMetrics = message.metrics;
        this.handlers.onMetrics?.(message.metrics);
        break;
      case "runtime.result": {
        const pending = this.pending.get(message.requestId);
        if (!pending) break;
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        if (message.ok) pending.resolve(message.data);
        else pending.reject(new Error(message.error || "The runtime rejected the request."));
        break;
      }
    }
  }

  private send(command: EditorRuntimeCommand) {
    const parsed = EditorRuntimeCommandSchema.safeParse(command);
    if (!parsed.success) throw new Error(`Refusing to send an invalid runtime command: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    if (!this.port) throw new Error("The game runtime is not connected yet.");
    this.port.postMessage(parsed.data);
  }

  private request<T>(command: EditorRuntimeCommand & { requestId: string }, timeoutMs = 30_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.requestId);
        reject(new Error(`The runtime did not answer "${command.type}" within ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      this.pending.set(command.requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.send(command);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(command.requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private nextRequestId() {
    requestSequence += 1;
    return `req-${requestSequence.toString(36)}-${Date.now().toString(36)}`;
  }

  /* ---------------- public API ---------------- */

  async load(project: GameProjectIR, sceneId?: string) {
    await this.readyPromise;
    this.events.length = 0;
    this.errorCount = 0;
    this.setState("loading");
    this.send({ type: "runtime.load", project: JSON.parse(JSON.stringify(project)), sceneId });
  }

  play() {
    this.send({ type: "runtime.play" });
  }

  pause() {
    this.send({ type: "runtime.pause" });
  }

  stop() {
    this.send({ type: "runtime.stop" });
  }

  setTimeScale(scale: number) {
    this.send({ type: "runtime.setTimeScale", scale });
  }

  input(action: string, options: { phase?: "down" | "up" | "press"; value?: number; look?: [number, number] } = {}) {
    return this.request<{ accepted: boolean }>({
      type: "runtime.input",
      requestId: this.nextRequestId(),
      input: { action, phase: options.phase ?? "press", value: options.value ?? 1, look: options.look },
    }, 10_000);
  }

  /** Drive the player to a world position using the runtime's own navigation. */
  moveTo(position: [number, number, number], timeoutMs = 20_000, tolerance = 1.6) {
    return this.request<{ arrived: boolean; distance: number; path: number; reason?: string }>(
      { type: "runtime.moveTo", requestId: this.nextRequestId(), position, timeoutMs, tolerance },
      timeoutMs + 5_000,
    );
  }

  query<T = unknown>(query: RuntimeQuery, timeoutMs = 15_000) {
    return this.request<T>({ type: "runtime.query", requestId: this.nextRequestId(), query }, timeoutMs);
  }

  snapshot() {
    return this.query<RuntimeSnapshot>({ kind: "player" });
  }

  metrics() {
    return this.query<RuntimeMetrics>({ kind: "metrics" });
  }

  renderReport() {
    return this.query<RenderReport>({ kind: "render" });
  }

  /** Deterministic stepping — the playtest bot never sleeps on wall time. */
  step(frames: number, deltaMs = 16.67) {
    return this.request<{ frames: number; time: number }>(
      { type: "runtime.step", requestId: this.nextRequestId(), frames, deltaMs },
      Math.max(30_000, frames * 4),
    );
  }

  screenshot() {
    return this.request<{ dataUrl: string }>({ type: "runtime.screenshot", requestId: this.nextRequestId() }, 20_000);
  }

  eventsSince(sequence: number) {
    return this.query<GameEvent[]>({ kind: "events", since: sequence });
  }

  dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("The runtime was closed."));
    }
    this.pending.clear();
    if (this.bootListener) window.removeEventListener("message", this.bootListener);
    this.bootListener = null;
    this.port?.close();
    this.port = null;
    this.iframe?.remove();
    this.iframe = null;
    this.readyPromise = null;
    this.setState("idle");
  }
}
