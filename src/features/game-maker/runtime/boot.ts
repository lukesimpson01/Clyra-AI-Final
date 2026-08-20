/**
 * The runtime kernel that runs INSIDE the sandboxed iframe.
 *
 * This module is the whole trusted surface of the game runtime: it accepts
 * the MessageChannel port, validates every command against the protocol
 * schema, and drives one world. It never evaluates strings and never reaches
 * for the parent document — it cannot, the frame's origin is opaque.
 *
 * Why the engine is injected rather than imported here: PlayCanvas and
 * Phaser are ~2 MB and ~1.7 MB respectively, and no project needs both. Each
 * engine gets its own entry document — boot3d.ts and boot2d.ts — which
 * statically imports exactly one of them and calls `startRuntime`. A 3D
 * project therefore never downloads Phaser, and a 2D project never downloads
 * PlayCanvas, which is the difference between a runtime that starts on an
 * 8 GB laptop and one that does not.
 *
 * Note on the sandbox: the frame has an opaque origin, so every module it
 * loads is fetched with `Origin: null` and needs a permissive CORS header
 * from the app server — including Vite's injected dev client. One blocked
 * module aborts the entire graph and the runtime silently never boots, which
 * is why `startRuntime` announces `gm.boot` before anything else: it lets the
 * editor say "the document never loaded" instead of a bare timeout.
 */
import {
  EditorRuntimeCommandSchema,
  RUNTIME_PROTOCOL_VERSION,
  type EditorRuntimeCommand,
  type GameEvent,
  type RuntimeMessage,
} from "./protocol";
import type { GameProjectIR } from "../ir/types";
import type { GameEvent as WorldEvent } from "./protocol";

/** The surface a world must expose for the kernel to drive it. */
export interface RuntimeWorld {
  readonly held: Set<string>;
  readonly events: WorldEvent[];
  time: number;
  timeScale: number;
  load(project: GameProjectIR, sceneId?: string): { sceneId: string; entityCount: number; warnings: string[] };
  step(deltaSeconds: number): void;
  stepFixed(): void;
  render(): void;
  interact(): { ok: boolean; target?: string; reason?: string };
  attack(): { ok: boolean; hit: string[] };
  restart(): { ok: boolean };
  requestMoveTo(position: [number, number, number]): { accepted: boolean; path: number; reason?: string };
  arrived(position: [number, number, number], tolerance?: number): boolean;
  setLook(yawDelta: number, pitchDelta: number): void;
  snapshot(): import("./protocol").RuntimeSnapshot;
  entityState(entityId: string): unknown;
  listEntities(filter: { type?: string; tag?: string; limit: number }): unknown;
  navigationQuery(from?: unknown, to?: unknown): unknown;
  metrics(): import("./protocol").RuntimeMetrics;
  renderReport(): import("./protocol").RenderReport;
  screenshot(): string;
  destroy(): void;
}

export type WorldFactory = (canvas: HTMLCanvasElement, emit: (event: WorldEvent) => void) => RuntimeWorld | Promise<RuntimeWorld>;

type World = RuntimeWorld;

let port: MessagePort | null = null;
let world: World | null = null;
let canvas: HTMLCanvasElement | null = null;
let running = false;
let rafHandle = 0;
let lastTimestamp = 0;
let metricsTimer = 0;

function post(message: RuntimeMessage) {
  port?.postMessage(message);
}

function log(level: "log" | "info" | "warn" | "error", message: string) {
  post({ type: "runtime.log", level, message: message.slice(0, 2000), time: Date.now() });
}

function reportError(error: unknown, fatal = false) {
  const asError = error instanceof Error ? error : new Error(String(error));
  post({ type: "runtime.error", error: { message: asError.message, stack: asError.stack?.slice(0, 4000), fatal } });
}

function emitEvent(event: GameEvent) {
  post({ type: "runtime.event", event });
}

function ensureCanvas(): HTMLCanvasElement {
  if (canvas) return canvas;
  const element = document.getElementById("game-canvas");
  if (!(element instanceof HTMLCanvasElement)) throw new Error("The runtime document is missing its canvas.");
  canvas = element;
  return element;
}

function detectCapabilities() {
  let webgl2 = false;
  let maxTextureSize = 0;
  try {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2");
    webgl2 = Boolean(context);
    maxTextureSize = context ? (context.getParameter(context.MAX_TEXTURE_SIZE) as number) : 0;
  } catch {
    webgl2 = false;
  }
  return {
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    webgl2,
    maxTextureSize,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 4,
  };
}

/* ---------------- main loop ---------------- */

function frame(timestamp: number) {
  rafHandle = requestAnimationFrame(frame);
  if (!world || !running) return;
  const delta = lastTimestamp ? Math.min(0.1, (timestamp - lastTimestamp) / 1000) : 1 / 60;
  lastTimestamp = timestamp;
  try {
    world.step(delta);
    world.render();
    updateRuntimeUi();
  } catch (error) {
    reportError(error, false);
  }
  metricsTimer += delta;
  if (metricsTimer > 1) {
    metricsTimer = 0;
    try {
      post({ type: "runtime.metrics", metrics: world.metrics() });
    } catch {
      // Metrics are best-effort; never let them stop the game.
    }
  }
}

function startLoop() {
  if (rafHandle) return;
  lastTimestamp = 0;
  rafHandle = requestAnimationFrame(frame);
}

/* ---------------- input ---------------- */

const KEY_TO_ACTION = new Map<string, string>();

function bindInputMap(project: GameProjectIR) {
  KEY_TO_ACTION.clear();
  for (const [action, keys] of Object.entries(project.input ?? {})) {
    for (const key of keys) KEY_TO_ACTION.set(key, action);
  }
}

function applyInput(action: string, phase: "down" | "up" | "press", look?: [number, number]) {
  if (!world) return { accepted: false };
  if (look) world.setLook(look[0], look[1]);

  if (phase === "down") world.held.add(action);
  if (phase === "up") world.held.delete(action);

  if (phase === "press" || phase === "down") {
    if (action === "pause") {
      running = !running;
      post({ type: "runtime.state", state: running ? "playing" : "paused" });
      updateRuntimeUi();
      return { accepted: true, paused: !running };
    }
    if (action === "restart") return { accepted: true, ...world.restart() };
    if (action === "interact") return { accepted: true, ...world.interact() };
    if (action === "attack") return { accepted: true, ...world.attack() };
  }
  if (phase === "press") {
    // A press is a single-frame hold: apply, step once, release.
    world.held.add(action);
    world.stepFixed();
    world.held.delete(action);
  }
  return { accepted: true };
}

let uiRoot: HTMLDivElement | null = null;
let uiLast = "";

function updateRuntimeUi() {
  if (!world) return;
  const snapshot = world.snapshot();
  const health = snapshot.player?.health;
  const collected = snapshot.player?.inventory.reduce((total, item) => total + item.count, 0) ?? 0;
  const html = `<div style="position:absolute;left:20px;top:18px;padding:10px 13px;border-radius:10px;background:rgba(10,13,18,.68);backdrop-filter:blur(12px)">Health ${health?.current ?? 0}/${health?.max ?? 0}<br><span style="opacity:.72">Collected ${collected}</span></div>${running ? "" : '<div data-runtime-pause style="position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,10,14,.48);font-size:28px;font-weight:650">Paused</div>'}`;
  if (html === uiLast) return;
  if (!uiRoot) {
    uiRoot = document.createElement("div");
    uiRoot.id = "game-ui";
    uiRoot.setAttribute("aria-live", "polite");
    Object.assign(uiRoot.style, { position: "fixed", inset: "0", pointerEvents: "none", color: "white", fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif", fontSize: "14px", textShadow: "0 1px 3px rgba(0,0,0,.8)", zIndex: "10" });
    document.body.appendChild(uiRoot);
  }
  uiRoot.innerHTML = html;
  uiLast = html;
}

function attachKeyboard() {
  const handle = (event: KeyboardEvent, phase: "down" | "up") => {
    const action = KEY_TO_ACTION.get(event.code);
    if (!action) return;
    event.preventDefault();
    applyInput(action, phase);
  };
  window.addEventListener("keydown", (event) => handle(event, "down"));
  window.addEventListener("keyup", (event) => handle(event, "up"));

  const target = ensureCanvas();
  target.addEventListener("click", () => target.requestPointerLock?.());
  window.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== target || !world) return;
    world.setLook(-event.movementX * 0.0028, -event.movementY * 0.0022);
  });
  target.addEventListener("mousedown", (event) => {
    if (!world) return;
    if (event.button === 0) applyInput("attack", "press");
  });
}

/* ---------------- command handling ---------------- */

async function loadProject(project: GameProjectIR, sceneId?: string) {
  const element = ensureCanvas();
  const mode = project.runtime?.mode ?? "3d";
  // Voxel worlds run on the 3D engine, so the 3D document accepts both.
  const compatible = expectedMode === "3d" ? mode === "3d" || mode === "voxel" : mode === expectedMode;
  if (!compatible) {
    throw new Error(
      `This runtime document only runs ${expectedMode} projects, but the project is ${mode}. ` +
        "The editor should have opened the matching runtime document.",
    );
  }

  if (world) {
    world.destroy();
    world = null;
  }
  running = false;
  world = await worldFactory(element, emitEvent);

  bindInputMap(project);
  const info = world.load(project, sceneId);
  uiLast = "";
  post({ type: "runtime.loaded", sceneId: info.sceneId, entityCount: info.entityCount, warnings: info.warnings });
  post({ type: "runtime.state", state: "idle" });
  world.render();
}

async function handleCommand(command: EditorRuntimeCommand) {
  switch (command.type) {
    case "runtime.load":
      await loadProject(command.project as GameProjectIR, command.sceneId);
      return;

    case "runtime.play":
      if (!world) throw new Error("Load a project before pressing play.");
      running = true;
      startLoop();
      updateRuntimeUi();
      post({ type: "runtime.state", state: "playing" });
      return;

    case "runtime.pause":
      running = false;
      updateRuntimeUi();
      post({ type: "runtime.state", state: "paused" });
      return;

    case "runtime.stop":
      running = false;
      post({ type: "runtime.state", state: "stopped" });
      return;

    case "runtime.setTimeScale":
      if (world) world.timeScale = command.scale;
      return;

    case "runtime.input": {
      const result = applyInput(command.input.action, command.input.phase, command.input.look as [number, number] | undefined);
      post({ type: "runtime.result", requestId: command.requestId, ok: true, data: result });
      return;
    }

    case "runtime.moveTo": {
      if (!world) throw new Error("Load a project before moving the player.");
      const target = command.position as [number, number, number];
      const request = world.requestMoveTo(target);
      if (!request.accepted) {
        post({ type: "runtime.result", requestId: command.requestId, ok: false, error: request.reason ?? "The player could not be moved." });
        return;
      }
      // Advance deterministically until arrival or the frame budget runs out.
      const maxFrames = Math.ceil((command.timeoutMs / 1000) * 60);
      let frames = 0;
      let stalled = 0;
      let lastDistance = Infinity;
      while (frames < maxFrames && !world.arrived(target, command.tolerance)) {
        world.stepFixed();
        frames += 1;
        if (frames % 30 === 0) {
          const snapshot = world.snapshot();
          const position = snapshot.player?.position;
          const distance = position ? Math.hypot(position[0] - target[0], position[2] - target[2]) : Infinity;
          if (distance > lastDistance - 0.25) stalled += 1;
          else stalled = 0;
          lastDistance = distance;
          // Genuinely stuck: report it rather than burning the whole budget.
          // Sliding along a wall makes little forward progress for a while
          // before the route opens up, so give it more than a moment.
          if (stalled >= 14) break;
          if (snapshot.player && snapshot.player.health.current <= 0) break;
        }
      }
      world.render();
      const snapshot = world.snapshot();
      const position = snapshot.player?.position ?? [0, 0, 0];
      const distance = Math.hypot(position[0] - target[0], position[2] - target[2]);
      const arrivedNow = world.arrived(target, command.tolerance);
      const rawProgress = (world as { moveTarget?: unknown }).moveTarget;
      const progress = rawProgress && !Array.isArray(rawProgress) && typeof rawProgress === "object" && Array.isArray((rawProgress as { waypoints?: unknown }).waypoints)
        ? rawProgress as { index: number; waypoints: unknown[] }
        : null;

      // A stalled walk is reported with the numbers that explain it: whether
      // navigation produced a real route, how much of it was consumed, and
      // how far short the player stopped. "Something is blocking the route"
      // on its own tells nobody anything.
      let reason: string | undefined;
      if (!arrivedNow) {
        const consumed = progress ? `${progress.index}/${progress.waypoints.length} waypoints` : "route finished";
        if (stalled >= 14) {
          reason = `The player stopped making progress ${distance.toFixed(1)}m short after ${consumed}.${request.path <= 1 ? ` No navmesh route was found, so it walked straight at the target: ${request.reason ?? "reason unknown"}` : ""}`;
        } else if (frames >= maxFrames) {
          reason = `Ran out of time ${distance.toFixed(1)}m short after ${consumed}.`;
        } else if (snapshot.player && snapshot.player.health.current <= 0) {
          reason = "The player died on the way.";
        } else {
          reason = request.reason ?? `Stopped ${distance.toFixed(1)}m short after ${consumed}.`;
        }
      }

      post({
        type: "runtime.result",
        requestId: command.requestId,
        ok: true,
        data: { arrived: arrivedNow, distance: Number(distance.toFixed(2)), path: request.path, reason },
      });
      return;
    }

    case "runtime.step": {
      if (!world) throw new Error("Load a project before stepping it.");
      for (let index = 0; index < command.frames; index += 1) world.stepFixed();
      world.render();
      post({ type: "runtime.result", requestId: command.requestId, ok: true, data: { frames: command.frames, time: world.time } });
      return;
    }

    case "runtime.screenshot": {
      if (!world) throw new Error("Load a project before taking a screenshot.");
      post({ type: "runtime.result", requestId: command.requestId, ok: true, data: { dataUrl: world.screenshot() } });
      return;
    }

    case "runtime.query": {
      if (!world) throw new Error("Load a project before querying it.");
      const query = command.query;
      let data: unknown;
      switch (query.kind) {
        case "player":
          data = world.snapshot();
          break;
        case "entity":
          data = world.entityState(query.entityId);
          if (!data) throw new Error(`No entity "${query.entityId}" is present in the running game.`);
          break;
        case "entities":
          data = world.listEntities({ type: query.type, tag: query.tag, limit: query.limit });
          break;
        case "metrics":
          data = world.metrics();
          break;
        case "render":
          data = world.renderReport();
          break;
        case "events":
          data = world.events.filter((event) => event.sequence > query.since);
          break;
        case "navigation": {
          // Duck-typed rather than instanceof: the world classes are loaded
          // dynamically, so the constructor may not be in scope here.
          const navigable = world as { navigationQuery: (from?: unknown, to?: unknown) => unknown };
          data = navigable.navigationQuery(query.from, query.to);
          break;
        }
        case "region": {
          const player = world.snapshot().player;
          const entities = (world as { entities?: Map<string, { state: Record<string, unknown> }> }).entities;
          data = { region: player && entities ? entities.get(player.entityId)?.state.region ?? null : null };
          break;
        }
        case "quests":
          data = world.events.filter((event) => event.name.startsWith("quest_"));
          break;
        default:
          throw new Error("Unsupported query.");
      }
      post({ type: "runtime.result", requestId: command.requestId, ok: true, data });
      return;
    }
  }
}

/* ---------------- entry point ---------------- */

let worldFactory: WorldFactory = () => {
  throw new Error("No engine was supplied to the runtime kernel.");
};
let expectedMode: "3d" | "2d" | "voxel" = "3d";

/**
 * Called by the per-engine entry document. Wires the handshake, the console
 * mirror and the global error handlers, then announces readiness.
 */
export function startRuntime(options: { mode: "3d" | "2d" | "voxel"; createWorld: WorldFactory }) {
  worldFactory = options.createWorld;
  expectedMode = options.mode;

  // Announced before the handshake so the editor can tell "the runtime
  // document never booted" (a build or CSP problem) apart from "the
  // handshake was lost" (a messaging problem) instead of reporting one
  // generic timeout for both.
  try {
    window.parent?.postMessage({ type: "gm.boot", mode: options.mode, protocol: RUNTIME_PROTOCOL_VERSION }, "*");
  } catch {
    // A parent that refuses messages is not a reason to fail startup.
  }

  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; protocol?: number } | undefined;
    if (data?.type !== "gm.handshake" || port) return;
    const [incoming] = event.ports;
    if (!incoming) return;
    port = incoming;

    /**
     * Commands are handled strictly in order. `runtime.load` is asynchronous,
     * and the editor legitimately sends `runtime.play` immediately after it —
     * without this queue the play command would arrive while the world is
     * still null and be rejected.
     */
    let queue: Promise<void> = Promise.resolve();

    port.onmessage = (message) => {
      const parsed = EditorRuntimeCommandSchema.safeParse(message.data);
      if (!parsed.success) {
        const requestId = (message.data as { requestId?: string } | undefined)?.requestId;
        const detail = parsed.error.issues[0];
        const text = `Rejected an invalid runtime command: ${detail?.path.join(".") || "(root)"} ${detail?.message ?? ""}`.trim();
        if (requestId) post({ type: "runtime.result", requestId, ok: false, error: text });
        else log("warn", text);
        return;
      }
      const command = parsed.data;
      queue = queue.then(async () => {
        try {
          await handleCommand(command);
        } catch (error) {
          const requestId = (command as { requestId?: string }).requestId;
          const text = error instanceof Error ? error.message : String(error);
          if (requestId) post({ type: "runtime.result", requestId, ok: false, error: text });
          else reportError(error, command.type === "runtime.load");
        }
      });
    };
    port.start();

    attachKeyboard();
    post({ type: "runtime.ready", protocol: RUNTIME_PROTOCOL_VERSION, capabilities: detectCapabilities() });
  });

  window.addEventListener("error", (event) => reportError(event.error ?? event.message, false));
  window.addEventListener("unhandledrejection", (event) => reportError(event.reason, false));

  // Mirror the game's own console into the editor console panel.
  for (const level of ["log", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      log(level, args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
    };
  }
}
