/**
 * The 3D game runtime (PlayCanvas adapter).
 *
 * Runs inside the sandboxed iframe. Compiles GameIR into a live PlayCanvas
 * scene, then simulates gameplay with a deterministic fixed-step loop —
 * PlayCanvas's own RAF loop is deliberately not used, because deterministic
 * stepping is what lets the playtest bot advance 600 frames and assert on
 * the result instead of sleeping on wall time.
 *
 * Physics is a kinematic capsule-vs-AABB sweep rather than a full rigid-body
 * engine: generated worlds are boxes, characters are capsules, and this is
 * exactly reproducible across runs, which matters more here than barrels
 * rolling downhill.
 */
import * as pc from "playcanvas";
import type { EntityIR, GameProjectIR, SceneIR, Vec3 } from "../ir/types";
import type { MeshSpec } from "../procedural/mesh";
import { MaterialLibrary, buildMeshInstances, collisionBoxes } from "./geometry";
import { hexToRgb } from "../procedural/materials";
import { makeHeightSampler, terrainHeightAt, TERRAIN_RESOLUTION, type TerrainParams } from "../procedural/terrain";
import { resolveScatter, type VegetationParams } from "../procedural/vegetation";
import { BLOCKS, decodeChunk, encodeChunk, meshChunk } from "../procedural/voxel";
import { buildNavGrid, cellSizeForBounds, findPath, navGeometryFromScene, DEFAULT_NAV_CONFIG, type NavGrid } from "../nav/navmesh";
import type { GameEvent, RenderReport, RuntimeMetrics, RuntimeSnapshot } from "./protocol";

export interface RuntimeEntity {
  ir: EntityIR;
  node: pc.Entity;
  /** World-space AABBs used for collision; empty for non-solid entities. */
  colliders: { min: Vec3; max: Vec3 }[];
  components: Map<string, Record<string, unknown>>;
  velocity: Vec3;
  grounded: boolean;
  alive: boolean;
  cooldown: number;
  state: Record<string, unknown>;
}

const FIXED_STEP = 1 / 60;

function componentMap(ir: EntityIR) {
  const map = new Map<string, Record<string, unknown>>();
  for (const component of ir.components) {
    if (component.enabled === false) continue;
    map.set(component.type, component.data);
  }
  return map;
}

function worldMatrixBoxes(node: pc.Entity, spec: MeshSpec): { min: Vec3; max: Vec3 }[] {
  const boxes = collisionBoxes(spec);
  const out: { min: Vec3; max: Vec3 }[] = [];
  const matrix = node.getWorldTransform();
  const point = new pc.Vec3();
  for (const box of boxes) {
    // Transform the 8 corners and take the AABB — correct for rotated parts.
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          point.set(box.offset[0] + box.size[0] * sx, box.offset[1] + box.size[1] * sy, box.offset[2] + box.size[2] * sz);
          matrix.transformPoint(point, point);
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          minZ = Math.min(minZ, point.z);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
          maxZ = Math.max(maxZ, point.z);
        }
      }
    }
    out.push({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
  }
  return out;
}

export class World3D {
  readonly app: pc.Application;
  private readonly materials = new MaterialLibrary();
  readonly entities = new Map<string, RuntimeEntity>();
  private cameraEntity: pc.Entity | null = null;
  private sunEntity: pc.Entity | null = null;
  private playerId: string | null = null;
  private scene: SceneIR | null = null;
  private project: GameProjectIR | null = null;
  private sampleHeight: ((x: number, z: number) => number | undefined) | undefined;
  private navGrid: NavGrid | null = null;
  private accumulator = 0;
  private eventSequence = 0;
  private staticColliders: { min: Vec3; max: Vec3 }[] = [];

  readonly events: GameEvent[] = [];
  readonly held = new Set<string>();
  time = 0;
  frame = 0;
  timeScale = 1;
  running = false;
  warnings: string[] = [];
  runtimeErrors = 0;
  /** Bot navigation target, consumed by the player controller each step. */
  moveTarget: { position: Vec3; waypoints: Vec3[]; index: number; stuckFrames: number; lastX: number; lastZ: number } | null = null;
  private cameraYaw = 0;
  private cameraPitch = -0.28;

  constructor(canvas: HTMLCanvasElement, private readonly emit: (event: GameEvent) => void) {
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: "high-performance" },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    // Manual loop: never start PlayCanvas's own RAF ticker.
    this.app.autoRender = false;
  }

  /* ---------------- loading ---------------- */

  load(project: GameProjectIR, sceneId?: string) {
    this.clear();
    this.project = project;
    const scene = project.scenes.find((candidate) => candidate.id === (sceneId ?? project.activeSceneId)) ?? project.scenes[0];
    if (!scene) throw new Error("This project has no scenes to run.");
    this.scene = scene;
    this.materials.register(project.assets);
    this.sampleHeight = makeHeightSampler(scene.terrain);

    this.buildEnvironment(scene);
    if (scene.terrain) this.buildTerrain(scene);
    if (scene.voxel) this.buildVoxelWorld(scene);

    for (const rootId of scene.rootEntities) this.buildEntity(scene, rootId, this.app.root);

    this.collectStaticColliders();
    this.buildCamera(scene);
    this.buildNavigation(scene);

    this.app.render();
    return { sceneId: scene.id, entityCount: this.entities.size, warnings: this.warnings };
  }

  private clear() {
    for (const entity of this.entities.values()) entity.node.destroy();
    this.entities.clear();
    this.cameraEntity?.destroy();
    this.cameraEntity = null;
    this.sunEntity?.destroy();
    this.sunEntity = null;
    for (const child of [...this.app.root.children]) {
      if (child instanceof pc.Entity) child.destroy();
    }
    this.playerId = null;
    this.voxelWorld = null;
    this.voxelSampler = null;
    this.staticColliders = [];
    this.navGrid = null;
    this.events.length = 0;
    this.eventSequence = 0;
    this.time = 0;
    this.frame = 0;
    this.warnings = [];
    this.runtimeErrors = 0;
    this.moveTarget = null;
  }

  private buildEnvironment(scene: SceneIR) {
    const [r, g, b] = hexToRgb(scene.environment.skyColor);
    this.app.scene.ambientLight = new pc.Color(...hexToRgb(scene.environment.ambientColor));
    // Sky colour is the clear colour; a real skybox needs a cubemap asset.
    this.app.scene.skyboxIntensity = 1;
    this.clearColor = new pc.Color(r, g, b);

    const sun = new pc.Entity("Sun");
    const sunConfig = scene.environment.sun;
    sun.addComponent("light", {
      type: "directional",
      color: new pc.Color(...hexToRgb(sunConfig?.color ?? "#ffffff")),
      intensity: sunConfig?.intensity ?? 1,
      castShadows: true,
      shadowDistance: 160,
      shadowResolution: 1024,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
    });
    const direction = sunConfig?.direction ?? [-0.5, -0.8, -0.4];
    sun.setEulerAngles(
      pc.math.RAD_TO_DEG * Math.asin(Math.max(-1, Math.min(1, -direction[1]))) * -1 - 30,
      pc.math.RAD_TO_DEG * Math.atan2(-direction[0], -direction[2]),
      0,
    );
    this.app.root.addChild(sun);
    this.sunEntity = sun;

    if (scene.environment.fog) {
      this.app.scene.fog.type = pc.FOG_LINEAR;
      this.app.scene.fog.color = new pc.Color(...hexToRgb(scene.environment.fog.color));
      this.app.scene.fog.start = scene.environment.fog.start;
      this.app.scene.fog.end = scene.environment.fog.end;
    }
  }

  clearColor = new pc.Color(0.55, 0.72, 0.87);

  private buildEntity(scene: SceneIR, entityId: string, parent: pc.GraphNode) {
    const ir = scene.entities[entityId];
    if (!ir) return;

    const node = new pc.Entity(ir.name);
    node.setLocalPosition(...ir.transform.position);
    node.setLocalRotation(new pc.Quat(...ir.transform.rotation));
    node.setLocalScale(...ir.transform.scale);
    node.enabled = ir.visible;
    parent.addChild(node);

    const components = componentMap(ir);
    const runtime: RuntimeEntity = {
      ir,
      node,
      colliders: [],
      components,
      velocity: [0, 0, 0],
      grounded: false,
      alive: true,
      cooldown: 0,
      state: {},
    };

    const meshComponent = components.get("ProceduralMesh");
    if (meshComponent) {
      const spec = meshComponent.spec as MeshSpec | undefined;
      if (spec?.parts?.length) {
        try {
          const instances = buildMeshInstances(this.app.graphicsDevice, spec, this.materials);
          if (instances.length) {
            node.addComponent("render", { meshInstances: instances, castShadows: true, receiveShadows: true });
          }
          if (components.has("Collider")) runtime.colliders = worldMatrixBoxes(node, spec);
        } catch (error) {
          this.warnings.push(`Mesh for "${ir.name}" could not be built: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const lightComponent = components.get("Light");
    if (lightComponent) {
      const offset = (lightComponent.offset as Vec3 | undefined) ?? [0, 0, 0];
      const lightNode = new pc.Entity(`${ir.name} light`);
      lightNode.setLocalPosition(...offset);
      lightNode.addComponent("light", {
        type: lightComponent.type === "directional" ? "directional" : lightComponent.type === "spot" ? "spot" : "omni",
        color: new pc.Color(...hexToRgb(String(lightComponent.color ?? "#ffffff"))),
        intensity: Number(lightComponent.intensity ?? 1),
        range: Number(lightComponent.range ?? 10),
        castShadows: Boolean(lightComponent.castShadows),
      });
      node.addChild(lightNode);
    }

    const vegetation = components.get("VegetationRegion");
    if (vegetation) this.buildVegetation(node, vegetation);

    const road = components.get("RoadSpline");
    if (road) this.buildRoad(node, road);

    const water = components.get("WaterPlane");
    if (water) this.buildWater(node, water);

    if (ir.tags.includes("player") || ir.type === "player") this.playerId = ir.id;

    this.entities.set(ir.id, runtime);
    for (const childId of ir.children) this.buildEntity(scene, childId, node);
  }

  private buildVegetation(parent: pc.Entity, component: Record<string, unknown>) {
    const params = component.params as VegetationParams;
    const seed = Number(component.seed ?? 1);
    const materials = (component.materials ?? {}) as Record<string, string>;
    // Cap instances for the runtime; the editor viewport caps lower still.
    const instances = resolveScatter(params, seed, this.sampleHeight, 6000);
    if (!instances.length) return;

    const bark = this.materials.get(materials.bark);
    const leaf = this.materials.get(materials.leaf);
    const rock = this.materials.get(materials.rock);
    const trunkMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.CylinderGeometry({ radius: 0.18, height: 4 }));
    const canopyMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.ConeGeometry({ baseRadius: 1.6, peakRadius: 0, height: 4.4 }));
    const rockMesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.SphereGeometry({ radius: 0.6, latitudeBands: 5, longitudeBands: 6 }));

    const groups: { mesh: pc.Mesh; material: pc.StandardMaterial; matrices: number[]; yOffset: number; scale: number }[] = [
      { mesh: trunkMesh, material: bark, matrices: [], yOffset: 2, scale: 1 },
      { mesh: canopyMesh, material: leaf, matrices: [], yOffset: 4.6, scale: 1 },
      { mesh: rockMesh, material: rock, matrices: [], yOffset: 0.4, scale: 1 },
    ];

    const matrix = new pc.Mat4();
    const quat = new pc.Quat();
    for (const instance of instances) {
      const isRock = instance.species === "rock";
      const isSmall = instance.species === "bush" || instance.species === "grass" || instance.species === "fern";
      const targets = isRock ? [groups[2]!] : isSmall ? [groups[1]!] : [groups[0]!, groups[1]!];
      for (const group of targets) {
        const scale = instance.scale * (isSmall ? 0.45 : 1);
        quat.setFromEulerAngles(0, (instance.yaw * 180) / Math.PI, 0);
        matrix.setTRS(
          new pc.Vec3(instance.position[0], instance.position[1] + group.yOffset * scale * (isSmall ? 0.4 : 1), instance.position[2]),
          quat,
          new pc.Vec3(scale, scale, scale),
        );
        group.matrices.push(...matrix.data);
      }
    }

    for (const group of groups) {
      if (!group.matrices.length) continue;
      const meshInstance = new pc.MeshInstance(group.mesh, group.material);
      const buffer = new pc.VertexBuffer(
        this.app.graphicsDevice,
        pc.VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice),
        group.matrices.length / 16,
        { data: new Float32Array(group.matrices) },
      );
      meshInstance.setInstancing(buffer);
      meshInstance.castShadow = false;
      const holder = new pc.Entity("vegetation-batch");
      holder.addComponent("render", { meshInstances: [meshInstance] });
      parent.addChild(holder);
    }
  }

  private buildRoad(parent: pc.Entity, component: Record<string, unknown>) {
    const points = (component.points as Vec3[]) ?? [];
    if (points.length < 2) return;
    const width = Number(component.width ?? 4);
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const definition = this.materials.definition(String(component.material ?? ""));
    const [cr, cg, cb] = hexToRgb(definition.baseColor);

    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]!;
      const next = points[Math.min(points.length - 1, index + 1)]!;
      const previous = points[Math.max(0, index - 1)]!;
      const dx = next[0] - previous[0];
      const dz = next[2] - previous[2];
      const length = Math.hypot(dx, dz) || 1;
      const nx = (dz / length) * (width / 2);
      const nz = (-dx / length) * (width / 2);
      positions.push(current[0] - nx, current[1], current[2] - nz, current[0] + nx, current[1], current[2] + nz);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, index, 1, index);
      colors.push(cr, cg, cb, 1, cr, cg, cb, 1);
      if (index < points.length - 1) {
        const base = index * 2;
        indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
      }
    }

    const mesh = new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setUvs(0, uvs);
    mesh.setColors(colors);
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const holder = new pc.Entity("road-surface");
    holder.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, this.materials.get(String(component.material ?? "")))], castShadows: false });
    parent.addChild(holder);
  }

  private buildWater(parent: pc.Entity, component: Record<string, unknown>) {
    const size = Number(component.size ?? 500);
    const mesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.PlaneGeometry({ halfExtents: new pc.Vec2(size / 2, size / 2) }));
    const holder = new pc.Entity("water-surface");
    holder.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, this.materials.get(String(component.material ?? "")))], castShadows: false });
    parent.addChild(holder);
  }

  private buildTerrain(scene: SceneIR) {
    const terrain = scene.terrain!;
    const params = { ...(terrain.parameters as unknown as TerrainParams), size: terrain.size, tileSize: terrain.tileSize, maxHeight: terrain.maxHeight };
    const tilesPerSide = Math.ceil(terrain.size / terrain.tileSize);
    const half = Math.floor(tilesPerSide / 2);
    const material = this.materials.get(String((terrain.parameters as Record<string, unknown>).groundMaterial ?? ""));
    const definition = this.materials.definition(String((terrain.parameters as Record<string, unknown>).groundMaterial ?? ""));
    const rockDefinition = this.materials.definition(String((terrain.parameters as Record<string, unknown>).rockMaterial ?? ""));
    const [gr, gg, gb] = hexToRgb(definition.baseColor);
    const [rr, rg, rb] = hexToRgb(rockDefinition.baseColor);

    const holder = new pc.Entity("Terrain");
    this.app.root.addChild(holder);
    const resolution = TERRAIN_RESOLUTION;
    const step = terrain.tileSize / (resolution - 1);
    let built = 0;

    for (let tz = -half; tz <= half; tz += 1) {
      for (let tx = -half; tx <= half; tx += 1) {
        const originX = tx * terrain.tileSize;
        const originZ = tz * terrain.tileSize;
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];

        for (let row = 0; row < resolution; row += 1) {
          for (let column = 0; column < resolution; column += 1) {
            const x = originX + column * step;
            const z = originZ + row * step;
            const height = terrainHeightAt(x, z, terrain.seed, params);
            positions.push(x, height, z);
            const hx = terrainHeightAt(x + step, z, terrain.seed, params) - terrainHeightAt(x - step, z, terrain.seed, params);
            const hz = terrainHeightAt(x, z + step, terrain.seed, params) - terrainHeightAt(x, z - step, terrain.seed, params);
            const normal = new pc.Vec3(-hx, 2 * step, -hz).normalize();
            normals.push(normal.x, normal.y, normal.z);
            uvs.push(column / (resolution - 1), row / (resolution - 1));
            // Steep ground reads as rock; flat ground as the biome colour.
            const slope = Math.min(1, Math.hypot(hx, hz) / (step * 2.2));
            colors.push(gr + (rr - gr) * slope, gg + (rg - gg) * slope, gb + (rb - gb) * slope, 1);
          }
        }
        for (let row = 0; row < resolution - 1; row += 1) {
          for (let column = 0; column < resolution - 1; column += 1) {
            const a = row * resolution + column;
            indices.push(a, a + resolution, a + resolution + 1, a, a + resolution + 1, a + 1);
          }
        }

        const mesh = new pc.Mesh(this.app.graphicsDevice);
        mesh.setPositions(positions);
        mesh.setNormals(normals);
        mesh.setUvs(0, uvs);
        mesh.setColors(colors);
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        const tile = new pc.Entity(`terrain-${tx}-${tz}`);
        tile.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
        holder.addChild(tile);
        built += 1;
        if (built > 400) {
          this.warnings.push("Terrain was truncated at 400 tiles to stay inside the memory budget.");
          return;
        }
      }
    }
  }

  private buildVoxelWorld(scene: SceneIR) {
    const voxel = scene.voxel!;
    const size = voxel.chunkSize;
    const decoded = new Map<string, Uint8Array>();
    for (const [key, data] of Object.entries(voxel.chunks)) decoded.set(key, decodeChunk(data));

    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(1, 1, 1);
    material.diffuseVertexColor = true;
    material.gloss = 0.05;
    material.useMetalness = false;
    material.update();

    const holder = new pc.Entity("Voxels");
    this.app.root.addChild(holder);

    const chunkEntities = new Map<string, pc.Entity>();

    const blockAt = (wx: number, wy: number, wz: number): number => {
      const chunk = decoded.get(`${Math.floor(wx / size)},${Math.floor(wy / size)},${Math.floor(wz / size)}`);
      if (!chunk) return 0;
      const lx = ((wx % size) + size) % size;
      const ly = ((wy % size) + size) % size;
      const lz = ((wz % size) + size) % size;
      return chunk[(ly * size + lz) * size + lx] ?? 0;
    };

    const remesh = (key: string) => {
      const blocks = decoded.get(key);
      if (!blocks) return;
      const [cx, cy, cz] = key.split(",").map(Number) as [number, number, number];
      const built = meshChunk(blocks, size, (x, y, z) => blockAt(cx * size + x, cy * size + y, cz * size + z));
      const existing = chunkEntities.get(key);
      if (!built.indices.length) {
        existing?.destroy();
        chunkEntities.delete(key);
        return;
      }
      const mesh = new pc.Mesh(this.app.graphicsDevice);
      mesh.setPositions(built.positions);
      mesh.setNormals(built.normals);
      mesh.setColors(built.colors);
      mesh.setIndices(built.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const instance = new pc.MeshInstance(mesh, material);
      if (existing?.render) {
        existing.render.meshInstances = [instance];
        return;
      }
      const entity = existing ?? new pc.Entity(`chunk-${key}`);
      if (!existing) {
        entity.setLocalPosition(cx * size, cy * size, cz * size);
        holder.addChild(entity);
        chunkEntities.set(key, entity);
      }
      entity.addComponent("render", { meshInstances: [instance], castShadows: false, receiveShadows: true });
    };

    for (const key of decoded.keys()) remesh(key);

    // Voxel collision is answered by sampling the chunk data directly, so it
    // stays correct the instant a block is broken — no collider rebuild.
    this.voxelSampler = (x: number, y: number, z: number) =>
      BLOCKS[blockAt(Math.floor(x), Math.floor(y), Math.floor(z))]?.solid ?? false;

    this.voxelWorld = {
      size,
      decoded,
      blockAt,
      /** Only the touched chunk (and any neighbour sharing the face) remeshes. */
      setBlock: (wx: number, wy: number, wz: number, block: number) => {
        const key = `${Math.floor(wx / size)},${Math.floor(wy / size)},${Math.floor(wz / size)}`;
        const chunk = decoded.get(key);
        if (!chunk) return false;
        const lx = ((wx % size) + size) % size;
        const ly = ((wy % size) + size) % size;
        const lz = ((wz % size) + size) % size;
        chunk[(ly * size + lz) * size + lx] = block;

        const dirty = new Set([key]);
        for (const [axis, local] of [[0, lx], [1, ly], [2, lz]] as const) {
          if (local === 0 || local === size - 1) {
            const offset = [0, 0, 0];
            offset[axis] = local === 0 ? -1 : 1;
            dirty.add(`${Math.floor((wx + offset[0]!) / size)},${Math.floor((wy + offset[1]!) / size)},${Math.floor((wz + offset[2]!) / size)}`);
          }
        }
        for (const dirtyKey of dirty) remesh(dirtyKey);

        // Keep the scene document in step so the edit survives a save.
        if (this.scene?.voxel && decoded.has(key)) this.scene.voxel.chunks[key] = encodeChunk(decoded.get(key)!);
        return true;
      },
    };
  }

  private voxelWorld: {
    size: number;
    decoded: Map<string, Uint8Array>;
    blockAt: (x: number, y: number, z: number) => number;
    setBlock: (x: number, y: number, z: number, block: number) => boolean;
  } | null = null;

  /**
   * Step a ray through the voxel grid one cell at a time (amanatides-woo).
   * Returns the first solid block and the empty cell in front of it, which
   * is what breaking and placing both need.
   */
  private voxelRaycast(origin: Vec3, direction: Vec3, reach: number) {
    if (!this.voxelWorld) return null;
    let x = Math.floor(origin[0]);
    let y = Math.floor(origin[1]);
    let z = Math.floor(origin[2]);
    const step = [Math.sign(direction[0]), Math.sign(direction[1]), Math.sign(direction[2])];
    const delta = direction.map((value) => (value === 0 ? Infinity : Math.abs(1 / value)));
    const next = [
      direction[0] === 0 ? Infinity : ((step[0]! > 0 ? x + 1 - origin[0] : origin[0] - x) || 1) * delta[0]!,
      direction[1] === 0 ? Infinity : ((step[1]! > 0 ? y + 1 - origin[1] : origin[1] - y) || 1) * delta[1]!,
      direction[2] === 0 ? Infinity : ((step[2]! > 0 ? z + 1 - origin[2] : origin[2] - z) || 1) * delta[2]!,
    ];

    let previous: [number, number, number] = [x, y, z];
    for (let travelled = 0; travelled < reach * 3; travelled += 1) {
      if (BLOCKS[this.voxelWorld.blockAt(x, y, z)]?.solid) {
        return { block: [x, y, z] as [number, number, number], adjacent: previous };
      }
      previous = [x, y, z];
      if (next[0]! < next[1]! && next[0]! < next[2]!) {
        if (next[0]! > reach) break;
        x += step[0]!;
        next[0]! += delta[0]!;
      } else if (next[1]! < next[2]!) {
        if (next[1]! > reach) break;
        y += step[1]!;
        next[1]! += delta[1]!;
      } else {
        if (next[2]! > reach) break;
        z += step[2]!;
        next[2]! += delta[2]!;
      }
    }
    return null;
  }

  /** Break the block the player is looking at. */
  breakBlock(): { ok: boolean; block?: [number, number, number]; type?: string; reason?: string } {
    const aim = this.playerAim();
    if (!aim) return { ok: false, reason: "There is no player, or this scene has no voxel world." };
    const hit = this.voxelRaycast(aim.origin, aim.direction, aim.reach);
    if (!hit) return { ok: false, reason: `No block within ${aim.reach}m of where the player is looking.` };

    const type = BLOCKS[this.voxelWorld!.blockAt(...hit.block)]?.name ?? "unknown";
    this.voxelWorld!.setBlock(hit.block[0], hit.block[1], hit.block[2], 0);
    this.fire("block_broken", { position: hit.block, block: type });
    return { ok: true, block: hit.block, type };
  }

  /** Place the selected hotbar block against the face being looked at. */
  placeBlock(blockId?: number): { ok: boolean; block?: [number, number, number]; reason?: string } {
    const aim = this.playerAim();
    if (!aim) return { ok: false, reason: "There is no player, or this scene has no voxel world." };
    const hit = this.voxelRaycast(aim.origin, aim.direction, aim.reach);
    if (!hit) return { ok: false, reason: `No surface within ${aim.reach}m to place against.` };

    const player = this.entities.get(this.playerId!)!;
    const hotbar = player.components.get("Hotbar");
    const items = (hotbar?.items as number[] | undefined) ?? [1];
    const selected = blockId ?? Number(items[Number(hotbar?.selected ?? 0)] ?? items[0] ?? 1);

    // Never entomb the player in the block they just placed.
    const position = player.node.getPosition();
    const [px, py, pz] = [Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)];
    if (hit.adjacent[0] === px && hit.adjacent[2] === pz && (hit.adjacent[1] === py || hit.adjacent[1] === py + 1)) {
      return { ok: false, reason: "That block would be placed inside the player." };
    }

    if (!this.voxelWorld!.setBlock(hit.adjacent[0], hit.adjacent[1], hit.adjacent[2], selected)) {
      return { ok: false, reason: "That position is outside the generated world." };
    }
    this.fire("block_placed", { position: hit.adjacent, block: BLOCKS[selected]?.name ?? String(selected) });
    return { ok: true, block: hit.adjacent };
  }

  private playerAim(): { origin: Vec3; direction: Vec3; reach: number } | null {
    if (!this.playerId || !this.voxelWorld || !this.cameraEntity) return null;
    const player = this.entities.get(this.playerId);
    if (!player) return null;
    const interaction = player.components.get("VoxelInteraction");
    if (!interaction) return null;
    const camera = this.cameraEntity.getPosition();
    const forward = this.cameraEntity.forward;
    return {
      origin: [camera.x, camera.y, camera.z],
      direction: [forward.x, forward.y, forward.z],
      reach: Number(interaction.reach ?? 5),
    };
  }

  private voxelSampler: ((x: number, y: number, z: number) => boolean) | null = null;

  private collectStaticColliders() {
    this.staticColliders = [];
    for (const entity of this.entities.values()) {
      if (!entity.ir.visible) continue;
      const collider = entity.components.get("Collider");
      if (!collider || collider.body === "dynamic") continue;
      this.staticColliders.push(...entity.colliders);
    }
  }

  private buildCamera(scene: SceneIR) {
    const camera = new pc.Entity("RuntimeCamera");
    const cameraIR = [...this.entities.values()].find((entity) => entity.components.has("Camera"));
    const config = cameraIR?.components.get("Camera") ?? {};
    camera.addComponent("camera", {
      clearColor: this.clearColor,
      fov: Number(config.fov ?? 62),
      nearClip: Number(config.near ?? 0.1),
      farClip: Number(config.far ?? 2000),
      projection: config.projection === "orthographic" ? pc.PROJECTION_ORTHOGRAPHIC : pc.PROJECTION_PERSPECTIVE,
    });
    this.app.root.addChild(camera);
    this.cameraEntity = camera;
    this.positionCamera(0);
    if (!this.playerId) this.warnings.push("No player entity was found; the camera is fixed and no controller is active.");
    void scene;
  }

  private buildNavigation(scene: SceneIR) {
    try {
      const geometry = navGeometryFromScene(scene, this.sampleHeight);
      if (!geometry.boxes.length && !geometry.sampleHeight) return;
      const bounds = scene.navigation?.bounds ?? this.sceneBounds();
      const cellSize = scene.navigation?.cellSize ?? cellSizeForBounds(bounds);
      this.navGrid = buildNavGrid({ ...DEFAULT_NAV_CONFIG, cellSize, bounds }, geometry);
    } catch (error) {
      this.warnings.push(`Navigation could not be built: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sceneBounds() {
    let min: Vec3 = [-64, -64, -64];
    let max: Vec3 = [64, 64, 64];
    const positions = [...this.entities.values()].map((entity) => entity.node.getPosition());
    if (positions.length) {
      min = [Math.min(...positions.map((p) => p.x)) - 32, Math.min(...positions.map((p) => p.y)) - 32, Math.min(...positions.map((p) => p.z)) - 32];
      max = [Math.max(...positions.map((p) => p.x)) + 32, Math.max(...positions.map((p) => p.y)) + 32, Math.max(...positions.map((p) => p.z)) + 32];
    }
    return { min, max };
  }

  /* ---------------- events ---------------- */

  fire(name: string, data: Record<string, unknown> = {}) {
    this.eventSequence += 1;
    const event: GameEvent = { sequence: this.eventSequence, time: this.time, name, data };
    this.events.push(event);
    if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
    this.emit(event);
  }

  /* ---------------- simulation ---------------- */

  step(deltaSeconds: number) {
    this.accumulator += Math.min(0.25, deltaSeconds * this.timeScale);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 8) {
      this.simulate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps === 0 && deltaSeconds > 0) {
      // Very small frames still advance PlayCanvas so animations progress.
      this.app.update(deltaSeconds);
    }
    this.positionCamera(deltaSeconds);
  }

  /** Deterministic stepping used by playtests: exactly one fixed step. */
  stepFixed() {
    this.simulate(FIXED_STEP);
    this.positionCamera(FIXED_STEP);
  }

  private simulate(dt: number) {
    this.time += dt;
    this.frame += 1;
    this.metricsWindowFrames += 1;
    try {
      this.updatePlayer(dt);
      this.updateBehaviors(dt);
      this.updateInteractions(dt);
      this.updateDayNight(dt);
      this.app.update(dt);
    } catch (error) {
      this.runtimeErrors += 1;
      this.fire("runtime_exception", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  render() {
    this.app.render();
  }

  /* ---------------- collision ---------------- */

  private solidAt(x: number, y: number, z: number, radius: number, height: number): boolean {
    if (this.voxelSampler) {
      for (const oy of [0.1, height * 0.5, height - 0.1]) {
        for (const [ox, oz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
          if (this.voxelSampler(x + ox, y + oy, z + oz)) return true;
        }
      }
      return false;
    }
    const min: Vec3 = [x - radius, y, z - radius];
    const max: Vec3 = [x + radius, y + height, z + radius];
    for (const box of this.staticColliders) {
      if (min[0] < box.max[0] && max[0] > box.min[0] && min[1] < box.max[1] && max[1] > box.min[1] && min[2] < box.max[2] && max[2] > box.min[2]) return true;
    }
    return false;
  }

  private groundHeight(x: number, z: number, from: number, radius: number): number {
    let best = this.sampleHeight?.(x, z) ?? -Infinity;
    if (this.voxelSampler) {
      for (let y = Math.floor(from + 1); y > from - 32; y -= 1) {
        if (this.voxelSampler(x, y - 0.05, z)) return y;
      }
      return best === -Infinity ? 0 : best;
    }
    for (const box of this.staticColliders) {
      if (x < box.min[0] - radius || x > box.max[0] + radius) continue;
      if (z < box.min[2] - radius || z > box.max[2] + radius) continue;
      if (box.max[1] > from + 0.6) continue;
      if (box.max[1] > best) best = box.max[1];
    }
    return best === -Infinity ? 0 : best;
  }

  /** Kinematic capsule move with per-axis resolution, so walls slide. */
  private moveCharacter(entity: RuntimeEntity, desired: Vec3, dt: number) {
    const body = entity.components.get("CharacterBody") ?? {};
    const radius = Number(body.radius ?? 0.35);
    const height = Number(body.height ?? 1.8);
    const stepHeight = Number(body.stepHeight ?? 0.45);
    const position = entity.node.getPosition();
    let x = position.x;
    let y = position.y;
    let z = position.z;

    for (const axis of [0, 2] as const) {
      const delta = desired[axis] * dt;
      if (Math.abs(delta) < 1e-6) continue;
      const nextX = axis === 0 ? x + delta : x;
      const nextZ = axis === 2 ? z + delta : z;
      if (!this.solidAt(nextX, y + stepHeight, nextZ, radius, height - stepHeight)) {
        x = nextX;
        z = nextZ;
      }
    }

    // Vertical: gravity, then ground snap.
    entity.velocity[1] += desired[1] * dt;
    y += entity.velocity[1] * dt;

    const ground = this.groundHeight(x, z, y + stepHeight, radius);
    if (y <= ground + 0.02) {
      y = ground;
      if (entity.velocity[1] < 0) entity.velocity[1] = 0;
      entity.grounded = true;
    } else {
      entity.grounded = false;
    }
    if (this.solidAt(x, y + height - 0.05, z, radius * 0.8, 0.1) && entity.velocity[1] > 0) entity.velocity[1] = 0;

    entity.node.setPosition(x, y, z);
  }

  /* ---------------- player ---------------- */

  private updatePlayer(dt: number) {
    if (!this.playerId) return;
    const player = this.entities.get(this.playerId);
    if (!player || !player.alive) return;
    const controller = player.components.get("PlayerController");
    if (!controller) return;

    const speed = this.held.has("sprint") ? Number(controller.sprintSpeed ?? Number(controller.moveSpeed ?? 4.5) * 1.6) : Number(controller.moveSpeed ?? 4.5);
    const gravity = -Number(controller.gravity ?? 18);

    let forward = 0;
    let strafe = 0;
    if (this.held.has("moveForward")) forward += 1;
    if (this.held.has("moveBackward")) forward -= 1;
    if (this.held.has("moveRight")) strafe += 1;
    if (this.held.has("moveLeft")) strafe -= 1;

    // Bot navigation overrides manual input while a moveTo is active.
    if (this.moveTarget) {
      const waypoint = this.moveTarget.waypoints[this.moveTarget.index];
      if (!waypoint) {
        this.moveTarget = null;
      } else {
        const position = player.node.getPosition();
        const dx = waypoint[0] - position.x;
        const dz = waypoint[2] - position.z;
        const planar = Math.hypot(dx, dz);

        if (planar < 0.7) {
          this.moveTarget.index += 1;
          this.moveTarget.stuckFrames = 0;
          if (this.moveTarget.index >= this.moveTarget.waypoints.length) this.moveTarget = null;
        } else {
          // A path is a sequence of straight lines through cell centres, and
          // a character sliding round a corner can grind against it forever
          // trying to reach a waypoint tucked behind geometry. If no ground
          // is being covered, give up on this waypoint and aim at the next
          // one — which is what unsticks the walk in practice.
          const moved = Math.hypot(position.x - this.moveTarget.lastX, position.z - this.moveTarget.lastZ);
          this.moveTarget.lastX = position.x;
          this.moveTarget.lastZ = position.z;
          this.moveTarget.stuckFrames = moved < 0.012 ? this.moveTarget.stuckFrames + 1 : 0;

          if (this.moveTarget.stuckFrames > 30) {
            this.moveTarget.stuckFrames = 0;
            this.moveTarget.index += 1;
            if (this.moveTarget.index >= this.moveTarget.waypoints.length) {
              this.moveTarget = null;
            } else if (player.grounded) {
              // A small hop clears kerbs, steps and doorway sills that the
              // step-height sweep alone will not.
              player.velocity[1] = Number(controller.jumpSpeed ?? 6.2) * 0.75;
            }
          }

          if (this.moveTarget) {
            this.cameraYaw = Math.atan2(dx, dz);
            forward = 1;
            strafe = 0;
            // Nudge sideways while stuck so the character slides off corners.
            if (this.moveTarget.stuckFrames > 12) strafe = this.moveTarget.stuckFrames % 24 < 12 ? 0.8 : -0.8;
            if (player.grounded && waypoint[1] > position.y + 0.35) player.velocity[1] = Number(controller.jumpSpeed ?? 6.2);
          }
        }
      }
    }

    const length = Math.hypot(forward, strafe) || 1;
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    const desired: Vec3 = [
      ((forward / length) * sin + (strafe / length) * cos) * speed,
      gravity,
      ((forward / length) * cos - (strafe / length) * sin) * speed,
    ];
    if (forward === 0 && strafe === 0) {
      desired[0] = 0;
      desired[2] = 0;
    }

    if (this.held.has("jump") && player.grounded) {
      player.velocity[1] = Number(controller.jumpSpeed ?? 6.2);
      player.grounded = false;
      this.fire("player_jumped", {});
    }

    this.moveCharacter(player, desired, dt);
    if (forward !== 0 || strafe !== 0) player.node.setEulerAngles(0, (this.cameraYaw * 180) / Math.PI, 0);

    const health = player.components.get("Health");
    if (health && Number(health.current ?? 0) <= 0 && player.alive) {
      player.alive = false;
      this.fire("player_died", { entityId: player.ir.id });
    }

    // Region tracking, so tests can assert "the player reached the courtyard".
    const scene = this.scene;
    if (scene) {
      const position = player.node.getPosition();
      let region: string | undefined;
      for (const candidate of Object.values(scene.regions)) {
        if (
          Math.abs(position.x - candidate.center[0]) <= candidate.size[0] / 2 &&
          Math.abs(position.z - candidate.center[2]) <= candidate.size[2] / 2
        ) {
          region = candidate.id;
          break;
        }
      }
      if (region !== (player.state.region as string | undefined)) {
        player.state.region = region;
        if (region) this.fire("region_entered", { region, name: scene.regions[region]?.name });
      }
    }
  }

  /* ---------------- NPCs ---------------- */

  private updateBehaviors(dt: number) {
    const player = this.playerId ? this.entities.get(this.playerId) : undefined;
    const playerPosition = player?.node.getPosition();

    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.ir.id === this.playerId) continue;
      const behavior = entity.components.get("Behavior");
      if (!behavior) continue;
      const parameters = (behavior.parameters ?? {}) as Record<string, number>;
      const speed = Number(parameters.movementSpeed ?? 2.2);
      const position = entity.node.getPosition();
      entity.cooldown = Math.max(0, entity.cooldown - dt);

      const health = entity.components.get("Health");
      if (health && Number(health.current ?? 1) <= 0) {
        entity.alive = false;
        entity.node.enabled = false;
        this.fire("enemy_killed", { entityId: entity.ir.id, name: entity.ir.name, type: entity.ir.type });
        continue;
      }

      const home = (entity.state.home as Vec3 | undefined) ?? (entity.state.home = [position.x, position.y, position.z] as Vec3);
      const distanceToPlayer = playerPosition ? Math.hypot(playerPosition.x - position.x, playerPosition.z - position.z) : Infinity;
      const detection = Number(parameters.detectionRadius ?? 0);
      const attackRange = Number(parameters.attackRange ?? 2.2);
      const hostile = entity.components.has("Enemy");

      let target: Vec3 | null = null;
      const mode = String(behavior.behavior ?? "wander");

      if (hostile && playerPosition && distanceToPlayer < detection && player?.alive) {
        if (distanceToPlayer <= attackRange) {
          if (entity.cooldown <= 0) {
            const melee = entity.components.get("Melee");
            const damage = Number(melee?.damage ?? 8);
            this.damage(player, damage, entity.ir.id);
            entity.cooldown = Number(melee?.cooldown ?? 1.2);
          }
        } else {
          target = [playerPosition.x, playerPosition.y, playerPosition.z];
        }
      } else if (mode === "wander" || mode === "patrol" || mode === "guard") {
        const radius = Number(parameters.patrolRadius ?? (mode === "guard" ? 12 : 8));
        if (radius > 0.5) {
          const phase = this.time * 0.25 + (entity.ir.id.length % 7);
          target = [home[0] + Math.cos(phase) * radius, home[1], home[2] + Math.sin(phase * 0.8) * radius];
        }
      }

      if (target) {
        const dx = target[0] - position.x;
        const dz = target[2] - position.z;
        const planar = Math.hypot(dx, dz);
        if (planar > 0.4) {
          const desired: Vec3 = [(dx / planar) * speed, -18, (dz / planar) * speed];
          this.moveCharacter(entity, desired, dt);
          entity.node.setEulerAngles(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0);
        }
      } else if (mode !== "stationary") {
        this.moveCharacter(entity, [0, -18, 0], dt);
      }
    }
  }

  damage(entity: RuntimeEntity, amount: number, sourceId?: string) {
    const health = entity.components.get("Health");
    if (!health || health.invulnerable) return;
    const current = Math.max(0, Number(health.current ?? health.max ?? 0) - amount);
    health.current = current;
    this.fire("entity_damaged", { entityId: entity.ir.id, amount, remaining: current, source: sourceId });
    if (current <= 0 && entity.alive) {
      if (entity.ir.id === this.playerId) {
        entity.alive = false;
        this.fire("player_died", { entityId: entity.ir.id });
      }
    }
  }

  /* ---------------- interaction ---------------- */

  private updateInteractions(dt: number) {
    void dt;
    if (!this.playerId) return;
    const player = this.entities.get(this.playerId);
    if (!player) return;
    const position = player.node.getPosition();

    for (const entity of this.entities.values()) {
      if (entity.ir.id === this.playerId || !entity.alive) continue;
      const entityPosition = entity.node.getPosition();
      const distance = entityPosition.distance(position);

      const collectible = entity.components.get("Collectible");
      if (collectible && distance < 1.6 && !entity.state.collected) {
        entity.state.collected = true;
        entity.node.enabled = false;
        const inventory = player.components.get("Inventory");
        if (inventory) {
          const items = (inventory.items as { item: string; count: number }[] | undefined) ?? [];
          const existing = items.find((slot) => slot.item === collectible.item);
          if (existing) existing.count += Number(collectible.value ?? 1);
          else items.push({ item: String(collectible.item), count: Number(collectible.value ?? 1) });
          inventory.items = items;
        }
        this.fire("item_collected", { entityId: entity.ir.id, item: collectible.item, value: collectible.value });
        continue;
      }

      const trigger = entity.components.get("Trigger");
      if (trigger && distance < 2.2 && !entity.state.triggered) {
        if (trigger.once) entity.state.triggered = true;
        this.fire(String(trigger.event ?? "trigger_entered"), { entityId: entity.ir.id });
      }

      const enemy = entity.components.get("Enemy");
      if (enemy && Number(enemy.contactDamage ?? 0) > 0 && distance < 1.4 && entity.cooldown <= 0) {
        this.damage(player, Number(enemy.contactDamage), entity.ir.id);
        entity.cooldown = 1;
      }
    }
  }

  /** Fired when the editor/bot presses the `interact` action. */
  interact(): { ok: boolean; target?: string; reason?: string } {
    if (!this.playerId) return { ok: false, reason: "There is no player in this scene." };

    // In a voxel world, "use" places a block from the hotbar.
    if (this.voxelWorld && this.entities.get(this.playerId)?.components.has("VoxelInteraction")) {
      const placed = this.placeBlock();
      return { ok: placed.ok, target: placed.block?.join(","), reason: placed.reason };
    }
    const player = this.entities.get(this.playerId)!;
    const position = player.node.getPosition();

    let best: { entity: RuntimeEntity; distance: number } | null = null;
    let nearestMissed: { entity: RuntimeEntity; distance: number; range: number } | null = null;

    for (const entity of this.entities.values()) {
      const interactable = entity.components.get("Interactable");
      if (!interactable || !entity.alive) continue;
      const range = Number(interactable.range ?? 2.5);
      // Interaction reach is horizontal: standing at the foot of a door is
      // being at the door, even though its centre is chest height.
      const target = entity.node.getPosition();
      const distance = Math.hypot(target.x - position.x, target.z - position.z);
      const verticalGap = Math.abs(target.y - position.y);
      if (distance > range || verticalGap > range + 1.5) {
        if (!nearestMissed || distance < nearestMissed.distance) nearestMissed = { entity, distance, range };
        continue;
      }
      if (!best || distance < best.distance) best = { entity, distance };
    }

    if (!best) {
      const detail = nearestMissed
        ? `The nearest one is "${nearestMissed.entity.ir.name}" at ${nearestMissed.distance.toFixed(2)}m, outside its ${nearestMissed.range}m range.`
        : "This scene has no entities with an Interactable component.";
      return { ok: false, reason: `Nothing interactable is within range of the player. ${detail}` };
    }

    const entity = best.entity;
    const door = entity.components.get("Door");
    if (door) {
      if (door.locked) {
        this.fire("door_locked", { entityId: entity.ir.id, keyItem: door.keyItem });
        return { ok: false, target: entity.ir.id, reason: "That door is locked." };
      }
      door.open = !door.open;
      const swing = Number(door.swingDegrees ?? 95) * (door.open ? 1 : 0);
      entity.node.setLocalEulerAngles(0, swing, 0);
      this.fire(door.open ? "door_opened" : "door_closed", { entityId: entity.ir.id, name: entity.ir.name });
      return { ok: true, target: entity.ir.id };
    }

    const container = entity.components.get("Container");
    if (container) {
      if (container.opened) return { ok: true, target: entity.ir.id };
      container.opened = true;
      const inventory = player.components.get("Inventory");
      const loot = (container.loot as { item: string; count: number }[] | undefined) ?? [];
      if (inventory) {
        const items = (inventory.items as { item: string; count: number }[] | undefined) ?? [];
        for (const entry of loot) {
          const existing = items.find((slot) => slot.item === entry.item);
          if (existing) existing.count += entry.count;
          else items.push({ ...entry });
        }
        inventory.items = items;
      }
      this.fire("container_opened", { entityId: entity.ir.id, loot });
      return { ok: true, target: entity.ir.id };
    }

    const npc = entity.components.get("NPC");
    if (npc) {
      this.fire("dialogue_started", { entityId: entity.ir.id, dialogueId: npc.dialogueId, questId: npc.questId });
      if (npc.questId) this.fire("quest_started", { questId: npc.questId, giver: entity.ir.id });
      return { ok: true, target: entity.ir.id };
    }

    const toggle = entity.components.get("Switch");
    if (toggle) {
      toggle.on = !toggle.on;
      this.fire(String(toggle.event ?? "switch_toggled"), { entityId: entity.ir.id, on: toggle.on });
      return { ok: true, target: entity.ir.id };
    }

    this.fire("interacted", { entityId: entity.ir.id });
    return { ok: true, target: entity.ir.id };
  }

  attack(): { ok: boolean; hit: string[] } {
    if (!this.playerId) return { ok: false, hit: [] };

    // In a voxel world, "attack" breaks the block being looked at.
    if (this.voxelWorld && this.entities.get(this.playerId)?.components.has("VoxelInteraction")) {
      const broken = this.breakBlock();
      return { ok: broken.ok, hit: broken.block ? [broken.block.join(",")] : [] };
    }
    const player = this.entities.get(this.playerId)!;
    const melee = player.components.get("Melee");
    if (!melee) return { ok: false, hit: [] };
    const position = player.node.getPosition();
    const range = Number(melee.range ?? 2.2);
    const hit: string[] = [];
    for (const entity of this.entities.values()) {
      if (!entity.alive || entity.ir.id === this.playerId) continue;
      if (!entity.components.has("Health")) continue;
      if (entity.node.getPosition().distance(position) > range) continue;
      this.damage(entity, Number(melee.damage ?? 15), this.playerId);
      hit.push(entity.ir.id);
    }
    this.fire("player_attacked", { hit });
    return { ok: true, hit };
  }

  private updateDayNight(dt: number) {
    const cycle = this.scene?.environment.dayNightCycle;
    if (!cycle?.enabled || !this.sunEntity) return;
    const hours = ((this.scene!.environment.timeOfDay ?? 12) + (dt / cycle.secondsPerDay) * 24) % 24;
    this.scene!.environment.timeOfDay = hours;
    const angle = ((hours - 6) / 24) * Math.PI * 2;
    this.sunEntity.setEulerAngles((Math.sin(angle) * -60) - 20, (hours / 24) * 360, 0);
    const light = this.sunEntity.light;
    if (light) light.intensity = Math.max(0.08, Math.sin(angle) * 1.1);
  }

  /* ---------------- camera ---------------- */

  setLook(yawDelta: number, pitchDelta: number) {
    this.cameraYaw += yawDelta;
    this.cameraPitch = Math.max(-1.3, Math.min(1.2, this.cameraPitch + pitchDelta));
  }

  private positionCamera(dt: number) {
    void dt;
    if (!this.cameraEntity) return;
    const player = this.playerId ? this.entities.get(this.playerId) : undefined;
    if (!player) {
      this.cameraEntity.setPosition(24, 20, 34);
      this.cameraEntity.lookAt(0, 2, 0);
      return;
    }
    const controller = player.components.get("PlayerController") ?? {};
    const position = player.node.getPosition();
    if (controller.mode === "firstPerson") {
      const eye = Number(controller.eyeHeight ?? 1.62);
      this.cameraEntity.setPosition(position.x, position.y + eye, position.z);
      this.cameraEntity.setEulerAngles((this.cameraPitch * 180) / Math.PI, (this.cameraYaw * 180) / Math.PI, 0);
      return;
    }
    const distance = 6.5;
    const height = 2.6;
    this.cameraEntity.setPosition(
      position.x - Math.sin(this.cameraYaw) * distance * Math.cos(this.cameraPitch),
      position.y + height - Math.sin(this.cameraPitch) * distance,
      position.z - Math.cos(this.cameraYaw) * distance * Math.cos(this.cameraPitch),
    );
    this.cameraEntity.lookAt(position.x, position.y + 1.5, position.z);
  }

  /* ---------------- queries ---------------- */

  requestMoveTo(position: Vec3): { accepted: boolean; path: number; reason?: string } {
    if (!this.playerId) return { accepted: false, path: 0, reason: "There is no player to move." };
    const player = this.entities.get(this.playerId)!;
    const from = player.node.getPosition();
    if (this.navGrid) {
      const result = findPath(this.navGrid, [from.x, from.y, from.z], position);
      if (result.found) {
        this.moveTarget = this.newMoveTarget(position, result.waypoints);
        return { accepted: true, path: result.waypoints.length };
      }
      // Fall back to a straight line: a missing navmesh should not block a
      // test on flat ground, but the reason is reported honestly.
      this.moveTarget = this.newMoveTarget(position, [position]);
      return { accepted: true, path: 1, reason: result.reason };
    }
    this.moveTarget = this.newMoveTarget(position, [position]);
    return { accepted: true, path: 1, reason: "No navmesh; walking in a straight line." };
  }

  private newMoveTarget(position: Vec3, waypoints: Vec3[]) {
    const current = this.playerId ? this.entities.get(this.playerId)?.node.getPosition() : undefined;
    return { position, waypoints, index: 0, stuckFrames: 0, lastX: current?.x ?? 0, lastZ: current?.z ?? 0 };
  }

  arrived(position: Vec3, tolerance = 1.6): boolean {
    if (!this.playerId) return false;
    const current = this.entities.get(this.playerId)!.node.getPosition();
    return Math.hypot(current.x - position[0], current.z - position[2]) <= tolerance;
  }

  snapshot(): RuntimeSnapshot {
    const player = this.playerId ? this.entities.get(this.playerId) : undefined;
    const position = player?.node.getPosition();
    const forward = player?.node.forward;
    const health = player?.components.get("Health");
    const inventory = player?.components.get("Inventory");
    return {
      player: player && position
        ? {
            entityId: player.ir.id,
            position: [position.x, position.y, position.z],
            velocity: [...player.velocity] as Vec3,
            grounded: player.grounded,
            health: { current: Number(health?.current ?? 0), max: Number(health?.max ?? 0) },
            inventory: ((inventory?.items as { item: string; count: number }[] | undefined) ?? []).map((slot) => ({ ...slot })),
            facing: forward ? [forward.x, forward.y, forward.z] : [0, 0, 1],
          }
        : undefined,
      time: this.time,
      frame: this.frame,
      sceneId: this.scene?.id ?? "",
      runtimeErrors: this.runtimeErrors,
    };
  }

  entityState(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity) return null;
    const position = entity.node.getPosition();
    return {
      entityId,
      name: entity.ir.name,
      type: entity.ir.type,
      tags: entity.ir.tags,
      alive: entity.alive,
      enabled: entity.node.enabled,
      position: [position.x, position.y, position.z] as Vec3,
      components: Object.fromEntries([...entity.components.entries()].map(([type, data]) => [type, data])),
    };
  }

  listEntities(filter: { type?: string; tag?: string; limit: number }) {
    const out: ReturnType<World3D["entityState"]>[] = [];
    for (const entity of this.entities.values()) {
      if (filter.type && entity.ir.type !== filter.type) continue;
      if (filter.tag && !entity.ir.tags.includes(filter.tag)) continue;
      out.push(this.entityState(entity.ir.id));
      if (out.length >= filter.limit) break;
    }
    return out;
  }

  navigationQuery(from: Vec3, to: Vec3) {
    if (!this.navGrid) return { found: false, reason: "No navmesh has been built for this scene.", length: 0, waypoints: [] };
    const result = findPath(this.navGrid, from, to);
    return { found: result.found, reason: result.reason, length: result.length, waypoints: result.waypoints };
  }

  /**
   * Frame timing is measured here, not read from PlayCanvas's profiler: the
   * runtime drives its own fixed-step loop, so `app.stats.frame.fps` is never
   * populated. Every other counter is read defensively because the production
   * engine build does not maintain all of them.
   */
  metrics(): RuntimeMetrics {
    const stats = this.app.stats as unknown as {
      drawCalls?: { total?: number };
      frame?: { triangles?: number; updateTime?: number };
      vram?: { tex?: number };
    };
    const elapsed = Math.max(0.001, this.time - this.metricsWindowStart);
    const fps = this.metricsWindowFrames > 0 ? this.metricsWindowFrames / elapsed : 0;
    this.metricsWindowStart = this.time;
    this.metricsWindowFrames = 0;
    return {
      fps: Number(fps.toFixed(1)),
      frameTimeMs: Number((fps > 0 ? 1000 / fps : 0).toFixed(2)),
      drawCalls: Number(stats?.drawCalls?.total ?? 0),
      triangles: Number(stats?.frame?.triangles ?? 0),
      entityCount: this.entities.size,
      activeLights: this.countLights(),
      textureMegabytes: Number(((stats?.vram?.tex ?? 0) / (1024 * 1024)).toFixed(1)),
      scriptTimeMs: Number((stats?.frame?.updateTime ?? 0).toFixed(2)),
    };
  }

  private metricsWindowStart = 0;
  private metricsWindowFrames = 0;

  private countLights() {
    let count = 0;
    const walk = (node: pc.GraphNode) => {
      if (node instanceof pc.Entity && node.light) count += 1;
      for (const child of node.children) walk(child);
    };
    walk(this.app.root);
    return count;
  }

  /** Numeric render QA (spec §187) — detects a black screen without vision. */
  renderReport(): RenderReport {
    const canvas = this.app.graphicsDevice.canvas as HTMLCanvasElement;
    let visible = 0;
    let nonFinite = 0;
    const walk = (node: pc.GraphNode) => {
      if (node instanceof pc.Entity) {
        const render = node.render;
        if (render && node.enabled) visible += render.meshInstances?.length ?? 0;
        const position = node.getPosition();
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) nonFinite += 1;
      }
      for (const child of node.children) walk(child);
    };
    walk(this.app.root);

    let averageLuminance = 0;
    let buckets = 0;
    try {
      const sample = document.createElement("canvas");
      sample.width = 48;
      sample.height = 32;
      const context = sample.getContext("2d");
      if (context) {
        context.drawImage(canvas, 0, 0, sample.width, sample.height);
        const data = context.getImageData(0, 0, sample.width, sample.height).data;
        const seen = new Set<number>();
        let total = 0;
        for (let index = 0; index < data.length; index += 4) {
          const luminance = (data[index]! * 0.2126 + data[index + 1]! * 0.7152 + data[index + 2]! * 0.0722) / 255;
          total += luminance;
          seen.add(((data[index]! >> 5) << 6) | ((data[index + 1]! >> 5) << 3) | (data[index + 2]! >> 5));
        }
        averageLuminance = Number((total / (data.length / 4)).toFixed(4));
        buckets = seen.size;
      }
    } catch {
      // A tainted or zero-size canvas is not a runtime failure; report zeroes.
    }

    return {
      visibleMeshInstances: visible,
      cameraPresent: Boolean(this.cameraEntity?.camera),
      averageLuminance,
      distinctColorBuckets: buckets,
      nonFiniteTransforms: nonFinite,
      clearColor: `#${[this.clearColor.r, this.clearColor.g, this.clearColor.b].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`,
    };
  }

  screenshot(): string {
    this.app.render();
    return (this.app.graphicsDevice.canvas as HTMLCanvasElement).toDataURL("image/webp", 0.7);
  }

  destroy() {
    this.clear();
    this.materials.destroy();
    this.app.destroy();
  }
}
