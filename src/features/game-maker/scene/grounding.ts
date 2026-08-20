/**
 * Language grounding (spec §59).
 *
 * The engine — not the language model — decides what "here", "this" and
 * "to the left" mean. The model asks for a *named* anchor; this module turns
 * that into an exact world position using the frozen ContextFrame. That is
 * what makes a text-only model able to place a tower on the mountain the
 * user is looking at, and it is why the model is never asked to invent
 * coordinates.
 */
import { z } from "zod";
import type { ContextFrame, SceneIR, Vec3 } from "../ir/types";
import { getSpatialIndex, normalize, rayGroundPlane, distance } from "./spatial";

export const AnchorSchema = z.union([
  z.object({ kind: z.literal("world"), position: z.tuple([z.number(), z.number(), z.number()]) }),
  /** The frozen cursor hit — "here" / "there" / "on that". */
  z.object({ kind: z.literal("cursor") }),
  /** The centre of the current selection — "this". */
  z.object({ kind: z.literal("selection") }),
  /** Where the camera is looking — "where I'm looking". */
  z.object({ kind: z.literal("gaze"), distance: z.number().positive().max(10000).optional() }),
  z.object({ kind: z.literal("camera") }),
  z.object({ kind: z.literal("entity"), entityId: z.string() }),
  z.object({ kind: z.literal("region"), regionId: z.string() }),
]);

export type Anchor = z.infer<typeof AnchorSchema>;

export const DirectionSchema = z.enum([
  "cameraLeft",
  "cameraRight",
  "cameraForward",
  "cameraBack",
  "up",
  "down",
  "worldNorth",
  "worldSouth",
  "worldEast",
  "worldWest",
  "entityForward",
  "entityBack",
  "entityLeft",
  "entityRight",
]);

export type DirectionName = z.infer<typeof DirectionSchema>;

export const PlacementSchema = z.object({
  anchor: AnchorSchema,
  /** Applied along `direction` from the anchor, in metres. */
  offset: z.number().finite().optional(),
  direction: DirectionSchema.optional(),
  /** Reference entity for the entity* directions. */
  relativeTo: z.string().optional(),
  /** Snap the result down onto the ground/terrain surface. */
  snapToGround: z.boolean().optional(),
});

export type Placement = z.infer<typeof PlacementSchema>;

export class GroundingError extends Error {
  code: string;
  hint?: string;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "GroundingError";
  }
}

/* ---------------- quaternion helpers ---------------- */

export function rotateVector(q: [number, number, number, number], v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function quaternionFromYaw(yawRadians: number): [number, number, number, number] {
  return [0, Math.sin(yawRadians / 2), 0, Math.cos(yawRadians / 2)];
}

/** Yaw that points +Z (an entity's forward) at `target` from `from`. */
export function lookAtYaw(from: Vec3, target: Vec3): number {
  return Math.atan2(target[0] - from[0], target[2] - from[2]);
}

/* ---------------- anchors ---------------- */

export function resolveAnchor(scene: SceneIR, frame: ContextFrame | undefined, anchor: Anchor): Vec3 {
  switch (anchor.kind) {
    case "world":
      return anchor.position as Vec3;

    case "cursor": {
      const hit = frame?.cursor.hit;
      if (hit) return hit.position;
      const ray = frame?.cursor.ray;
      const ground = ray ? rayGroundPlane(ray.origin, normalize(ray.direction), 0) : undefined;
      if (ground) return ground;
      throw new GroundingError(
        "NO_CURSOR_TARGET",
        "The user's cursor was not over anything when they sent this message.",
        'Ask which spot they mean, or use an explicit anchor such as {"kind":"entity"} or {"kind":"world"}.',
      );
    }

    case "selection": {
      if (!frame?.selected.length) {
        throw new GroundingError(
          "NOTHING_SELECTED",
          "Nothing is selected, so \"this\" has no referent.",
          "Ask the user to select an object, or name the entity explicitly.",
        );
      }
      const positions = frame.selected.map((entity) => entity.position);
      return [
        positions.reduce((total, position) => total + position[0], 0) / positions.length,
        positions.reduce((total, position) => total + position[1], 0) / positions.length,
        positions.reduce((total, position) => total + position[2], 0) / positions.length,
      ];
    }

    case "gaze": {
      if (!frame?.camera) throw new GroundingError("NO_CAMERA", "No camera state was captured with this request.");
      const index = getSpatialIndex(scene);
      const hit = index.raycast(frame.camera.position, frame.camera.forward);
      if (hit) return hit.position;
      const ground = rayGroundPlane(frame.camera.position, normalize(frame.camera.forward), 0);
      if (ground) return ground;
      const reach = anchor.distance ?? 30;
      return [
        frame.camera.position[0] + frame.camera.forward[0] * reach,
        frame.camera.position[1] + frame.camera.forward[1] * reach,
        frame.camera.position[2] + frame.camera.forward[2] * reach,
      ];
    }

    case "camera": {
      if (!frame?.camera) throw new GroundingError("NO_CAMERA", "No camera state was captured with this request.");
      return frame.camera.position;
    }

    case "entity": {
      const entry = getSpatialIndex(scene).get(anchor.entityId);
      if (!entry) throw new GroundingError("ENTITY_NOT_FOUND", `No entity "${anchor.entityId}" in this scene.`, "Use scene.query to find real ids.");
      return entry.center;
    }

    case "region": {
      const region = scene.regions[anchor.regionId];
      if (!region) throw new GroundingError("REGION_NOT_FOUND", `No region "${anchor.regionId}".`);
      return region.center;
    }

    default: {
      const exhaustive: never = anchor;
      throw new GroundingError("UNKNOWN_ANCHOR", `Unsupported anchor: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function resolveDirection(
  scene: SceneIR,
  frame: ContextFrame | undefined,
  direction: DirectionName,
  relativeTo?: string,
): Vec3 {
  const camera = frame?.camera;
  const flatten = (v: Vec3): Vec3 => normalize([v[0], 0, v[2]]);

  switch (direction) {
    case "up":
      return [0, 1, 0];
    case "down":
      return [0, -1, 0];
    case "worldNorth":
      return [0, 0, -1];
    case "worldSouth":
      return [0, 0, 1];
    case "worldEast":
      return [1, 0, 0];
    case "worldWest":
      return [-1, 0, 0];
    case "cameraLeft":
      if (!camera) throw new GroundingError("NO_CAMERA", "Camera-relative directions need a captured camera.");
      return flatten([-camera.right[0], -camera.right[1], -camera.right[2]]);
    case "cameraRight":
      if (!camera) throw new GroundingError("NO_CAMERA", "Camera-relative directions need a captured camera.");
      return flatten(camera.right);
    case "cameraForward":
      if (!camera) throw new GroundingError("NO_CAMERA", "Camera-relative directions need a captured camera.");
      return flatten(camera.forward);
    case "cameraBack":
      if (!camera) throw new GroundingError("NO_CAMERA", "Camera-relative directions need a captured camera.");
      return flatten([-camera.forward[0], -camera.forward[1], -camera.forward[2]]);
    default: {
      const targetId = relativeTo ?? frame?.selected[0]?.entityId;
      const entity = targetId ? scene.entities[targetId] : undefined;
      if (!entity) {
        throw new GroundingError(
          "NO_REFERENCE_ENTITY",
          `Direction "${direction}" needs a reference entity.`,
          "Pass relativeTo with an entity id, or select the object first.",
        );
      }
      const q = entity.transform.rotation;
      const forward = flatten(rotateVector(q, [0, 0, 1]));
      const right = flatten(rotateVector(q, [1, 0, 0]));
      if (direction === "entityForward") return forward;
      if (direction === "entityBack") return [-forward[0], 0, -forward[2]];
      if (direction === "entityRight") return right;
      return [-right[0], 0, -right[2]];
    }
  }
}

/** Ground height at (x, z): terrain sample if present, else the highest surface. */
export function groundHeightAt(scene: SceneIR, x: number, z: number, sampleTerrain?: (x: number, z: number) => number | undefined): number {
  const terrainHeight = sampleTerrain?.(x, z);
  if (terrainHeight !== undefined && Number.isFinite(terrainHeight)) return terrainHeight;
  const index = getSpatialIndex(scene);
  const hit = index.raycast([x, 10000, z], [0, -1, 0]);
  if (hit) return hit.position[1];
  return 0;
}

export function resolvePlacement(
  scene: SceneIR,
  frame: ContextFrame | undefined,
  placement: Placement,
  sampleTerrain?: (x: number, z: number) => number | undefined,
): Vec3 {
  const base = resolveAnchor(scene, frame, placement.anchor);
  let position: Vec3 = [...base] as Vec3;

  if (placement.offset && placement.direction) {
    const dir = resolveDirection(scene, frame, placement.direction, placement.relativeTo);
    position = [
      position[0] + dir[0] * placement.offset,
      position[1] + dir[1] * placement.offset,
      position[2] + dir[2] * placement.offset,
    ];
  }

  if (placement.snapToGround) {
    position[1] = groundHeightAt(scene, position[0], position[2], sampleTerrain);
  }
  return position;
}

/**
 * Free space search used by "put three barrels around this" (spec §226).
 * Deterministic: the same anchor and count always produce the same ring.
 */
export function findFreePositions(
  scene: SceneIR,
  center: Vec3,
  options: { count: number; radius: number; clearance: number; snapToGround?: boolean; startAngle?: number },
  sampleTerrain?: (x: number, z: number) => number | undefined,
): Vec3[] {
  const index = getSpatialIndex(scene);
  const results: Vec3[] = [];
  const attemptsPerSlot = 12;

  for (let slot = 0; slot < options.count; slot += 1) {
    let placed = false;
    for (let attempt = 0; attempt < attemptsPerSlot && !placed; attempt += 1) {
      const angle = (options.startAngle ?? 0) + (slot / options.count) * Math.PI * 2 + attempt * 0.19;
      const radius = options.radius + attempt * options.clearance * 0.5;
      const x = center[0] + Math.cos(angle) * radius;
      const z = center[2] + Math.sin(angle) * radius;
      const y = options.snapToGround ? groundHeightAt(scene, x, z, sampleTerrain) : center[1];
      const candidate: Vec3 = [x, y, z];

      const blocked =
        index.withinRadius(candidate, options.clearance).some((entry) => entry.size[0] > 0.01 || entry.size[2] > 0.01) ||
        results.some((existing) => distance(existing, candidate) < options.clearance);
      if (!blocked) {
        results.push(candidate);
        placed = true;
      }
    }
    if (!placed) {
      // Fall back to the ideal ring position rather than silently returning
      // fewer objects than the user asked for.
      const angle = (options.startAngle ?? 0) + (slot / options.count) * Math.PI * 2;
      const x = center[0] + Math.cos(angle) * options.radius;
      const z = center[2] + Math.sin(angle) * options.radius;
      results.push([x, options.snapToGround ? groundHeightAt(scene, x, z, sampleTerrain) : center[1], z]);
    }
  }
  return results;
}
