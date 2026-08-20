/**
 * The playtest bot (spec §126–§132).
 *
 * Drives the real running game through the runtime bridge — navmesh
 * pathing, semantic actions, runtime queries — and asserts on what the
 * runtime actually reports. It has no vision and needs none: "did the door
 * open" is answered by `door.open == true` read out of the live world, not
 * by looking at pixels.
 */
import type { RuntimeHost } from "../runtime/host";
import type { GameEvent } from "../runtime/protocol";
import type { SceneIR, Vec3 } from "../ir/types";
import { getSpatialIndex } from "../scene/spatial";
import { parseTest, type Comparison, type Instruction } from "./dsl";

export interface StepResult {
  line: number;
  instruction: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export interface PlaytestResult {
  passed: boolean;
  steps: StepResult[];
  events: GameEvent[];
  runtimeErrors: number;
  /** The failing step, so the repair pass has one concrete thing to fix. */
  failure?: { line: number; instruction: string; detail: string };
  durationMs: number;
}

export interface ResolvedTarget {
  position: Vec3;
  entityId?: string;
  /** World size, used to work out where to stand rather than what to stand in. */
  size?: Vec3;
  /**
   * The direction that faces away from whatever this is attached to. A door
   * belongs to a house, and the only side you can stand on is the outside —
   * approaching from wherever the player happens to be would send the bot
   * through a wall.
   */
  outward?: Vec3;
}

/**
 * Resolve a name from the test script to a world position.
 *
 * When several things match — "door" in a village of houses — the one
 * nearest the player wins. "Walk to a door" means the door in front of you,
 * not an arbitrary one on the far side of the map, and picking the nearest
 * is both what a person would do and far more likely to be reachable.
 */
export function resolveTarget(scene: SceneIR, name: string, from?: Vec3): ResolvedTarget | null {
  const index = getSpatialIndex(scene);

  const withOutward = (entityId: string, position: Vec3, size: Vec3): ResolvedTarget => {
    const parentId = scene.entities[entityId]?.parentId;
    const parent = parentId ? index.get(parentId) : undefined;
    if (!parent) return { position, entityId, size };
    const dx = position[0] - parent.center[0];
    const dz = position[2] - parent.center[2];
    const planar = Math.hypot(dx, dz);
    if (planar < 0.2) return { position, entityId, size };
    return { position, entityId, size, outward: [dx / planar, 0, dz / planar] };
  };

  const nearest = (candidates: IndexedEntityLike[]): ResolvedTarget | null => {
    if (!candidates.length) return null;
    const pick = from
      ? candidates.reduce((best, candidate) =>
          Math.hypot(candidate.center[0] - from[0], candidate.center[2] - from[2]) <
          Math.hypot(best.center[0] - from[0], best.center[2] - from[2])
            ? candidate
            : best)
      : candidates[0]!;
    return withOutward(pick.id, pick.center, pick.size);
  };

  const direct = index.get(name);
  if (direct) return withOutward(direct.id, direct.center, direct.size);

  const region = scene.regions[name] ?? Object.values(scene.regions).find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (region) return { position: region.center, size: region.size };

  return nearest(matchingEntities(scene, name));
}

function normaliseName(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ");
}

function matchingEntities(scene: SceneIR, name: string): IndexedEntityLike[] {
  const all = getSpatialIndex(scene).all();
  const lower = normaliseName(name);
  const exactTag = all.filter((entry) => entry.tags.some((tag) => normaliseName(tag) === lower));
  if (exactTag.length) return exactTag;
  const exactName = all.filter((entry) => normaliseName(entry.name) === lower);
  if (exactName.length) return exactName;
  return all.filter((entry) => normaliseName(entry.name).includes(lower) || entry.tags.some((tag) => normaliseName(tag).includes(lower)));
}

/**
 * Every entity a name could mean, nearest first.
 *
 * A village has twenty doors and some of them genuinely cannot be reached —
 * a house backing onto a neighbour's wall, a door facing a cliff. "Walk to a
 * door" means walk to one you can actually get to, so the bot is given
 * candidates to try rather than one and a failure.
 */
export function resolveTargets(scene: SceneIR, name: string, from?: Vec3, limit = 3): ResolvedTarget[] {
  const single = getSpatialIndex(scene).get(name);
  if (single || scene.regions[name]) {
    const resolved = resolveTarget(scene, name, from);
    return resolved ? [resolved] : [];
  }

  const index = getSpatialIndex(scene);
  const candidates = [...matchingEntities(scene, name)];
  if (from) {
    candidates.sort(
      (a, b) =>
        Math.hypot(a.center[0] - from[0], a.center[2] - from[2]) - Math.hypot(b.center[0] - from[0], b.center[2] - from[2]),
    );
  }

  const resolved: ResolvedTarget[] = candidates.map((entry) => {
    const parentId = scene.entities[entry.id]?.parentId;
    const parent = parentId ? index.get(parentId) : undefined;
    if (!parent) return { position: entry.center, entityId: entry.id, size: entry.size };
    const dx = entry.center[0] - parent.center[0];
    const dz = entry.center[2] - parent.center[2];
    const planar = Math.hypot(dx, dz);
    return planar < 0.2
      ? { position: entry.center, entityId: entry.id, size: entry.size }
      : { position: entry.center, entityId: entry.id, size: entry.size, outward: [dx / planar, 0, dz / planar] as Vec3 };
  });

  /*
   * Prefer candidates you could actually stand in front of. In a dense
   * village some doors face a neighbour's wall a metre away; walking to one
   * of those burns the whole test budget before failing. Checking the
   * approach point against the spatial index is cheap and rules them out
   * before the bot ever starts walking.
   */
  const clearance = (target: ResolvedTarget): boolean => {
    const approach = approachPosition(target, [target.position[0] + 1, target.position[1], target.position[2]]);
    const blockers = index.withinRadius(approach.position, 1.2).filter((entry) => {
      if (entry.id === target.entityId) return false;
      if (scene.entities[target.entityId ?? ""]?.parentId === entry.id) return false;
      const entity = scene.entities[entry.id];
      return Boolean(entity?.components.some((component) => component.type === "Collider"));
    });
    return blockers.length === 0;
  };

  const clear = resolved.filter(clearance);
  return (clear.length ? clear : resolved).slice(0, limit);
}

/** The shape resolveTarget needs from the spatial index. */
interface IndexedEntityLike {
  id: string;
  name: string;
  tags: string[];
  center: Vec3;
  size: Vec3;
}

function compare(actual: unknown, comparison: Comparison, expected: string | number | boolean): boolean {
  if (comparison === "==") return String(actual) === String(expected);
  if (comparison === "!=") return String(actual) !== String(expected);
  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (comparison === ">") return left > right;
  if (comparison === ">=") return left >= right;
  if (comparison === "<") return left < right;
  return left <= right;
}

function readPath(source: unknown, path: string[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Where to stand to reach a target.
 *
 * Walking to an object's centre means walking *into* it: the mover is
 * blocked by its collider, the bot stalls a couple of metres out, and the
 * test fails with "something is blocking the route" even though nothing is
 * wrong with the level. The bot instead approaches from its current side to
 * just outside the object's footprint, which is what a player does.
 */
export function approachPosition(target: ResolvedTarget, from: Vec3, agentRadius = 0.5): { position: Vec3; standoff: number } {
  const size = target.size ?? [1, 1, 1];
  const footprint = Math.max(size[0], size[2]) / 2;
  const standoff = footprint + agentRadius + 0.6;

  // Prefer the object's own outward face; fall back to the player's side.
  let dirX: number;
  let dirZ: number;
  if (target.outward) {
    dirX = target.outward[0];
    dirZ = target.outward[2];
  } else {
    const dx = from[0] - target.position[0];
    const dz = from[2] - target.position[2];
    const planar = Math.hypot(dx, dz);
    if (planar < 1e-3 || standoff <= 0.1) return { position: target.position, standoff: 0 };
    dirX = dx / planar;
    dirZ = dz / planar;
  }

  return {
    position: [target.position[0] + dirX * standoff, target.position[1], target.position[2] + dirZ * standoff],
    standoff,
  };
}

export class PlaytestRunner {
  constructor(private readonly host: RuntimeHost, private readonly scene: SceneIR) {}

  async run(source: string, options: { timeoutMs?: number } = {}): Promise<PlaytestResult> {
    const started = Date.now();
    const parsed = parseTest(source);
    const steps: StepResult[] = [];

    if (parsed.errors.length) {
      return {
        passed: false,
        steps: parsed.errors.map((error) => ({ line: error.line, instruction: error.text, ok: false, detail: error.message, durationMs: 0 })),
        events: [],
        runtimeErrors: 0,
        failure: { line: parsed.errors[0]!.line, instruction: parsed.errors[0]!.text, detail: parsed.errors[0]!.message },
        durationMs: Date.now() - started,
      };
    }

    const deadline = started + (options.timeoutMs ?? 120_000);
    let failure: PlaytestResult["failure"];

    for (const instruction of parsed.instructions) {
      if (Date.now() > deadline) {
        failure = { line: instruction.line, instruction: describe(instruction), detail: "The playtest ran out of time before this step." };
        steps.push({ line: instruction.line, instruction: describe(instruction), ok: false, detail: failure.detail, durationMs: 0 });
        break;
      }
      const stepStarted = Date.now();
      let result: { ok: boolean; detail: string };
      try {
        result = await this.execute(instruction);
      } catch (error) {
        result = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      steps.push({ line: instruction.line, instruction: describe(instruction), ...result, durationMs: Date.now() - stepStarted });
      if (!result.ok) {
        failure = { line: instruction.line, instruction: describe(instruction), detail: result.detail };
        break;
      }
    }

    const events = await this.host.eventsSince(0).catch(() => [] as GameEvent[]);
    const snapshot = await this.host.snapshot().catch(() => null);

    return {
      passed: !failure,
      steps,
      events,
      runtimeErrors: snapshot?.runtimeErrors ?? this.host.errorCount,
      failure,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Walk to a target, standing just outside it. Retries once from a second
   * approach angle before giving up, because a single blocked side (a house
   * backing onto a wall) is not the same as an unreachable object.
   */
  /** Walk to the first of several candidates that can actually be reached. */
  private async walkToAny(name: string, timeoutMs = 12_000): Promise<{ ok: boolean; target?: ResolvedTarget; distance: number; detail: string }> {
    const from = await this.playerPosition();
    const candidates = resolveTargets(this.scene, name, from);
    if (!candidates.length) return { ok: false, distance: 0, detail: `Nothing in the scene is named or tagged "${name}".` };

    const attempts: string[] = [];
    for (const candidate of candidates) {
      const move = await this.walkTo(candidate, timeoutMs);
      if (move.ok) return { ok: true, target: candidate, distance: move.distance, detail: "" };
      attempts.push(`${candidate.entityId ?? name}: ${move.detail}`);
    }
    return {
      ok: false,
      distance: 0,
      detail: `tried ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} and could not reach any — ${attempts[0]}`,
    };
  }

  private async playerPosition(): Promise<Vec3 | undefined> {
    const snapshot = await this.host.snapshot().catch(() => null);
    return snapshot?.player?.position;
  }

  /** The interaction range of a target, when it has one. */
  private interactRange(target: ResolvedTarget): number | undefined {
    const entity = target.entityId ? this.scene.entities[target.entityId] : undefined;
    const interactable = entity?.components.find((component) => component.type === "Interactable");
    const range = interactable?.data.range;
    return typeof range === "number" ? range : undefined;
  }

  private async walkTo(target: ResolvedTarget, timeoutMs = 25_000): Promise<{ ok: boolean; distance: number; detail: string }> {
    const snapshot = await this.host.snapshot();
    const from = snapshot.player?.position ?? [0, 0, 0];
    const approach = approachPosition(target, from);

    const distanceToTarget = async () => {
      const after = await this.host.snapshot();
      const position = after.player?.position ?? [0, 0, 0];
      return Math.hypot(position[0] - target.position[0], position[2] - target.position[2]);
    };

    /*
     * Two phases, because "walk to the door" and "walk into the door" are
     * different problems.
     *
     * Phase 1 crosses the world to a point standing clear of the object,
     * with a forgiving arrival tolerance so the character controller is not
     * asked to hit a precise spot after sliding along walls.
     *
     * Phase 2 then walks straight AT the object with a tolerance the size of
     * the standoff. Collision does the stopping — the player ends up against
     * it, which is exactly where a person stands to open a door.
     */
    let arrived = (await this.host.moveTo(approach.position, timeoutMs, 1.6)).arrived;

    if (!arrived) {
      // One blocked approach side (a house backing onto a wall) is not the
      // same as an unreachable object; try the perpendicular side.
      const dx = approach.position[0] - target.position[0];
      const dz = approach.position[2] - target.position[2];
      const alternate: Vec3 = [target.position[0] - dz, target.position[1], target.position[2] + dx];
      arrived = (await this.host.moveTo(alternate, timeoutMs, 1.6)).arrived;
    }

    // Close in to within the target's own interaction range where it has
    // one: "walked to the door" has to mean "can open the door", not
    // "stopped a hand's width outside its reach".
    const range = this.interactRange(target);
    const closeTolerance = range ? Math.max(0.8, range - 0.5) : Math.max(1.2, Math.min(approach.standoff + 0.3, 2.2));
    const closing = await this.host.moveTo(target.position, Math.min(timeoutMs, 8_000), closeTolerance);
    let distance = await distanceToTarget();

    // One more nudge if we are still just outside reach.
    if (range && distance > range - 0.2) {
      await this.host.moveTo(target.position, 4_000, Math.max(0.6, range - 0.8));
      distance = await distanceToTarget();
    }

    const acceptable = range ? range - 0.15 : approach.standoff + 1;
    if (distance <= acceptable || (closing.arrived && !range)) {
      return { ok: true, distance: Number(distance.toFixed(2)), detail: "" };
    }
    return {
      ok: false,
      distance: Number(distance.toFixed(2)),
      detail: `stopped ${distance.toFixed(2)}m away${range ? `, outside its ${range}m interaction range` : ""}. ${closing.reason ?? ""}`.trim(),
    };
  }

  private async execute(instruction: Instruction): Promise<{ ok: boolean; detail: string }> {
    switch (instruction.op) {
      case "spawn": {
        const target = resolveTarget(this.scene, instruction.target, await this.playerPosition());
        if (!target) return { ok: false, detail: `Nothing in the scene is named or tagged "${instruction.target}".` };
        // The runtime spawns the player itself; this asserts the spawn exists
        // and moves the bot there, which is the honest interpretation.
        const move = await this.walkTo(target, 15_000);
        return move.ok
          ? { ok: true, detail: `Player is at ${instruction.target}.` }
          : { ok: false, detail: `Could not reach the spawn "${instruction.target}": ${move.detail}` };
      }

      case "move":
      case "moveTo": {
        if (instruction.op === "moveTo") {
          const move = await this.host.moveTo(instruction.position, 25_000);
          return move.arrived
            ? { ok: true, detail: `Walked ${move.path} waypoints and arrived (${move.distance}m off target).` }
            : { ok: false, detail: `Stopped ${move.distance}m short. ${move.reason ?? ""}`.trim() };
        }
        const move = await this.walkToAny(instruction.target);
        return move.ok
          ? { ok: true, detail: `Walked to ${move.target?.entityId ?? instruction.target} and stopped ${move.distance}m from it.` }
          : { ok: false, detail: move.detail };
      }

      case "press":
        await this.host.input(instruction.action, { phase: "press" });
        return { ok: true, detail: `Pressed ${instruction.action}.` };

      case "hold": {
        await this.host.input(instruction.action, { phase: "down" });
        await this.host.step(Math.max(1, Math.round(instruction.seconds * 60)));
        await this.host.input(instruction.action, { phase: "up" });
        return { ok: true, detail: `Held ${instruction.action} for ${instruction.seconds}s.` };
      }

      case "interact": {
        if (instruction.target) {
          const move = await this.walkToAny(instruction.target);
          if (!move.ok) return { ok: false, detail: `Could not get close enough to ${instruction.target} to interact — ${move.detail}` };
        }
        const outcome = await this.host.input("interact", { phase: "press" }) as { ok?: boolean; target?: string; reason?: string };
        await this.host.step(10);
        return outcome.reason && outcome.ok === false
          ? { ok: false, detail: outcome.reason }
          : { ok: true, detail: `Interacted with ${outcome.target ?? "the nearest interactable"}.` };
      }

      case "attack": {
        if (instruction.target) {
          const target = resolveTarget(this.scene, instruction.target, await this.playerPosition());
          if (!target) return { ok: false, detail: `Nothing in the scene is named or tagged "${instruction.target}".` };
          const move = await this.walkTo(target);
          if (!move.ok) return { ok: false, detail: `Could not reach ${instruction.target} to attack it — ${move.detail}` };

          if (instruction.untilDead) {
            for (let swing = 0; swing < 80; swing += 1) {
              await this.host.input("attack", { phase: "press" });
              await this.host.step(24);
              const state = await this.host.query<{ alive: boolean; components: Record<string, Record<string, unknown>> } | null>({ kind: "entity", entityId: target.entityId ?? instruction.target });
              const health = state?.components?.Health;
              if (!state?.alive || (health && Number(health.current ?? 1) <= 0)) {
                return { ok: true, detail: `${instruction.target} was defeated after ${swing + 1} swings.` };
              }
              const player = await this.host.snapshot();
              if (player.player && player.player.health.current <= 0) {
                return { ok: false, detail: `The player died before killing ${instruction.target}. The fight is not winnable as configured.` };
              }
            }
            return { ok: false, detail: `${instruction.target} survived 80 swings — it may have too much health or be immune to the player's damage.` };
          }
        }
        await this.host.input("attack", { phase: "press" });
        await this.host.step(12);
        return { ok: true, detail: "Attacked." };
      }

      case "wait":
        await this.host.step(Math.max(1, Math.round(instruction.seconds * 60)));
        return { ok: true, detail: `Advanced ${instruction.seconds}s of game time.` };

      case "look": {
        const toRadians = Math.PI / 180;
        await this.host.input("look", { phase: "press", value: 0, look: [-instruction.yawDegrees * toRadians, instruction.pitchDegrees * toRadians] });
        await this.host.step(2);
        return {
          ok: true,
          detail: instruction.pitchDegrees
            ? `Looked ${instruction.pitchDegrees < 0 ? "down" : "up"} ${Math.abs(instruction.pitchDegrees)}°.`
            : `Looked ${instruction.yawDegrees < 0 ? "left" : "right"} ${Math.abs(instruction.yawDegrees)}°.`,
        };
      }

      case "assertReached": {
        const target = resolveTarget(this.scene, instruction.target, await this.playerPosition());
        if (!target) return { ok: false, detail: `Nothing in the scene is named or tagged "${instruction.target}".` };
        const snapshot = await this.host.snapshot();
        const position = snapshot.player?.position;
        if (!position) return { ok: false, detail: "There is no player in the running game." };
        const distance = Math.hypot(position[0] - target.position[0], position[2] - target.position[2]);
        // "Reached the castle" cannot mean "standing at its exact centre" —
        // a big object is reached when you are up against it.
        const footprint = target.size ? Math.max(target.size[0], target.size[2]) / 2 : 0;
        const tolerance = Math.max(4, footprint + 3);
        return distance <= tolerance
          ? { ok: true, detail: `Player is ${distance.toFixed(1)}m from ${instruction.target}.` }
          : { ok: false, detail: `Player is ${distance.toFixed(1)}m from ${instruction.target} (tolerance ${tolerance}m).` };
      }

      case "assertProperty": {
        const segments = instruction.path.split(".");
        const head = segments[0]!;
        let actual: unknown;

        if (head === "runtime_errors") {
          actual = (await this.host.snapshot()).runtimeErrors;
        } else if (head === "player") {
          actual = readPath(await this.host.snapshot(), ["player", ...segments.slice(1)]);
        } else {
          const target = resolveTarget(this.scene, head, await this.playerPosition());
          const entityId = target?.entityId ?? head;
          const state = await this.host.query<{ components: Record<string, Record<string, unknown>>; alive: boolean; position: Vec3 } | null>({ kind: "entity", entityId }).catch(() => null);
          if (!state) return { ok: false, detail: `No entity "${head}" exists in the running game.` };
          const rest = segments.slice(1);
          // Accept both "door.open" and "door.Door.open".
          actual = readPath(state, rest);
          if (actual === undefined) {
            for (const component of Object.values(state.components ?? {})) {
              const candidate = readPath(component, rest);
              if (candidate !== undefined) {
                actual = candidate;
                break;
              }
            }
          }
        }

        const ok = compare(actual, instruction.comparison, instruction.value);
        return ok
          ? { ok: true, detail: `${instruction.path} is ${String(actual)}.` }
          : { ok: false, detail: `${instruction.path} is ${actual === undefined ? "not present" : String(actual)}, expected ${instruction.comparison} ${String(instruction.value)}.` };
      }

      case "assertEvent": {
        const events = await this.host.eventsSince(0);
        const count = events.filter((event) => event.name === instruction.event).length;
        return count >= instruction.atLeast
          ? { ok: true, detail: `"${instruction.event}" fired ${count} time(s).` }
          : { ok: false, detail: `"${instruction.event}" fired ${count} time(s), expected at least ${instruction.atLeast}.` };
      }

      case "assertNoEvent": {
        const events = await this.host.eventsSince(0);
        const count = events.filter((event) => event.name === instruction.event).length;
        return count === 0
          ? { ok: true, detail: `"${instruction.event}" never fired.` }
          : { ok: false, detail: `"${instruction.event}" fired ${count} time(s) but should not have.` };
      }
    }
  }
}

function describe(instruction: Instruction): string {
  return JSON.stringify(instruction).slice(0, 200);
}

/**
 * Failure classification (spec §135) — turns a failed step into the category
 * the repair pass routes on, instead of a free-text guess.
 */
export type FailureCategory =
  | "schema"
  | "navigation"
  | "gameplay"
  | "physics"
  | "asset"
  | "runtime"
  | "performance"
  | "tool";

export function classifyFailure(detail: string): FailureCategory {
  const text = detail.toLowerCase();
  if (/named or tagged|no entity|not present/.test(text)) return "schema";
  if (/reach|route|navmesh|walkable|stopped .* short|blocking/.test(text)) return "navigation";
  if (/died|survived|health|damage|winnable/.test(text)) return "gameplay";
  if (/fell|grounded|collision|physics/.test(text)) return "physics";
  if (/material|mesh|texture|asset/.test(text)) return "asset";
  if (/fps|budget|draw call|triangles/.test(text)) return "performance";
  if (/timed out|did not answer/.test(text)) return "tool";
  return "runtime";
}
