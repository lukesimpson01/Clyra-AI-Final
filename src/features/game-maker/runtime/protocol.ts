/**
 * The runtime bridge protocol (spec §55).
 *
 * The game runs in an iframe with `sandbox="allow-scripts"` and no
 * `allow-same-origin`, so its origin is opaque: it cannot read the editor's
 * cookies, localStorage or DOM. Everything crosses this boundary as a
 * schema-validated message over a MessageChannel port.
 */
import { z } from "zod";

export const RUNTIME_PROTOCOL_VERSION = 2;

/* ---------------- editor → runtime ---------------- */

export const RuntimeInputEventSchema = z.object({
  /** Semantic action name from the project input map, never a raw key. */
  action: z.string().min(1).max(48),
  phase: z.enum(["down", "up", "press"]).default("press"),
  value: z.number().min(-1).max(1).default(1),
  /** Look/aim delta in radians, for bots that need to face a target. */
  look: z.tuple([z.number(), z.number()]).optional(),
});

export const RuntimeQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("player") }),
  z.object({ kind: z.literal("entity"), entityId: z.string() }),
  z.object({ kind: z.literal("entities"), type: z.string().optional(), tag: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }),
  z.object({ kind: z.literal("region") }),
  z.object({ kind: z.literal("quests") }),
  z.object({ kind: z.literal("metrics") }),
  z.object({ kind: z.literal("events"), since: z.number().int().min(0).default(0) }),
  z.object({ kind: z.literal("navigation"), from: z.tuple([z.number(), z.number(), z.number()]), to: z.tuple([z.number(), z.number(), z.number()]) }),
  z.object({ kind: z.literal("render") }),
]);

export type RuntimeQuery = z.infer<typeof RuntimeQuerySchema>;

export const EditorRuntimeCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("runtime.load"), project: z.unknown(), sceneId: z.string().optional() }),
  z.object({ type: z.literal("runtime.play") }),
  z.object({ type: z.literal("runtime.pause") }),
  z.object({ type: z.literal("runtime.stop") }),
  z.object({ type: z.literal("runtime.input"), requestId: z.string(), input: RuntimeInputEventSchema }),
  z.object({
    type: z.literal("runtime.moveTo"),
    requestId: z.string(),
    position: z.tuple([z.number(), z.number(), z.number()]),
    timeoutMs: z.number().int().min(100).max(120000).default(20000),
    /** How close counts as arrived. Tight when the bot must then interact. */
    tolerance: z.number().min(0.1).max(20).default(1.6),
  }),
  z.object({ type: z.literal("runtime.query"), requestId: z.string(), query: RuntimeQuerySchema }),
  z.object({ type: z.literal("runtime.setTimeScale"), scale: z.number().min(0).max(20) }),
  /** Advance a fixed number of frames — deterministic headless stepping. */
  z.object({ type: z.literal("runtime.step"), requestId: z.string(), frames: z.number().int().min(1).max(20000), deltaMs: z.number().min(1).max(100).default(16.67) }),
  z.object({ type: z.literal("runtime.screenshot"), requestId: z.string() }),
]);

export type EditorRuntimeCommand = z.infer<typeof EditorRuntimeCommandSchema>;

/* ---------------- runtime → editor ---------------- */

export const RuntimeErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  source: z.string().optional(),
  fatal: z.boolean().default(false),
});

export const RuntimeMetricsSchema = z.object({
  fps: z.number(),
  frameTimeMs: z.number(),
  drawCalls: z.number(),
  triangles: z.number(),
  entityCount: z.number(),
  activeLights: z.number(),
  textureMegabytes: z.number(),
  scriptTimeMs: z.number(),
});

export type RuntimeMetrics = z.infer<typeof RuntimeMetricsSchema>;

export const GameEventSchema = z.object({
  /** Monotonic; queries page through with `since`. */
  sequence: z.number().int(),
  time: z.number(),
  name: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type GameEvent = z.infer<typeof GameEventSchema>;

export const RuntimeMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("runtime.ready"), protocol: z.number(), capabilities: z.object({ webgpu: z.boolean(), webgl2: z.boolean(), maxTextureSize: z.number(), hardwareConcurrency: z.number() }) }),
  z.object({ type: z.literal("runtime.loaded"), sceneId: z.string(), entityCount: z.number(), warnings: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("runtime.state"), state: z.enum(["idle", "playing", "paused", "stopped", "error"]) }),
  z.object({ type: z.literal("runtime.log"), level: z.enum(["log", "info", "warn", "error"]), message: z.string(), time: z.number() }),
  z.object({ type: z.literal("runtime.error"), error: RuntimeErrorSchema }),
  z.object({ type: z.literal("runtime.event"), event: GameEventSchema }),
  z.object({ type: z.literal("runtime.metrics"), metrics: RuntimeMetricsSchema }),
  z.object({ type: z.literal("runtime.result"), requestId: z.string(), ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() }),
]);

export type RuntimeMessage = z.infer<typeof RuntimeMessageSchema>;

/* ---------------- shared shapes ---------------- */

export interface RuntimeSnapshot {
  player?: {
    entityId: string;
    position: [number, number, number];
    velocity: [number, number, number];
    grounded: boolean;
    health: { current: number; max: number };
    inventory: { item: string; count: number }[];
    facing: [number, number, number];
  };
  time: number;
  frame: number;
  sceneId: string;
  runtimeErrors: number;
}

/** Numeric render QA — a black screen is detectable without a vision model. */
export interface RenderReport {
  visibleMeshInstances: number;
  cameraPresent: boolean;
  averageLuminance: number;
  distinctColorBuckets: number;
  nonFiniteTransforms: number;
  clearColor: string;
}
