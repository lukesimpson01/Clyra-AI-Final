/**
 * The persistent 3D editor viewport (spec §44–§47, §6).
 *
 * ONE PlayCanvas application for the lifetime of the editor. React never
 * holds an engine object: it calls into this service and receives plain data
 * back, and this service pushes changes out through callbacks. Nothing here
 * triggers a React render per frame.
 */
import * as pc from "playcanvas";
import type { ContextFrame, EntityContext, GameProjectIR, SceneIR, Vec3 } from "../ir/types";
import type { MeshSpec } from "../procedural/mesh";
import { MaterialLibrary, buildMeshInstances } from "../runtime/geometry";
import { hexToRgb } from "../procedural/materials";
import { makeHeightSampler, terrainHeightAt, TERRAIN_RESOLUTION, type TerrainParams } from "../procedural/terrain";
import { resolveScatter, type VegetationParams } from "../procedural/vegetation";
import { decodeChunk, meshChunk, BLOCKS } from "../procedural/voxel";
import { getSpatialIndex, normalize, rayGroundPlane } from "../scene/spatial";
import { buildSceneSummary } from "../scene/summary";
import { createId } from "../ir/project";

export type EditorTool = "select" | "move" | "rotate" | "scale";
export type CameraPreset = "perspective" | "top" | "front" | "side";

export interface EngineEvents {
  onSelectionChange?: (entityIds: string[]) => void;
  onTransformCommit?: (changes: { entityId: string; position: Vec3; rotation: [number, number, number, number]; scale: Vec3 }[]) => void;
  onHover?: (entityId: string | null) => void;
  onStats?: (stats: { fps: number; drawCalls: number; triangles: number; entities: number }) => void;
}

interface EditorNode {
  entity: pc.Entity;
  id: string;
}

const SELECTION_COLOR = new pc.Color(0.22, 0.55, 1);
const HOVER_COLOR = new pc.Color(1, 0.78, 0.25);
const MARKER_COLOR = new pc.Color(0.35, 0.85, 0.6);

export class Editor3DEngine {
  private app: pc.Application | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private materials = new MaterialLibrary();
  private nodes = new Map<string, EditorNode>();
  private camera: pc.Entity | null = null;
  private gizmoLayer: pc.Layer | null = null;
  private gizmoCamera: pc.Entity | null = null;
  private translateGizmo: pc.TranslateGizmo | null = null;
  private rotateGizmo: pc.RotateGizmo | null = null;
  private scaleGizmo: pc.ScaleGizmo | null = null;
  private scene: SceneIR | null = null;
  private project: GameProjectIR | null = null;
  private sampleHeight: ((x: number, z: number) => number | undefined) | undefined;
  private rafHandle = 0;
  private lastTimestamp = 0;
  /**
   * Frame timing is measured here rather than read from `app.stats.frame`:
   * PlayCanvas only maintains those counters inside its own `tick()` loop,
   * which this engine deliberately does not use (see the manual loop below).
   */
  private framesSinceStats = 0;
  private resizeObserver: ResizeObserver | null = null;
  private statsTimer = 0;
  private disposed = false;

  selection: string[] = [];
  hovered: string | null = null;
  tool: EditorTool = "select";
  coordSpace: "world" | "local" = "world";
  snap = { translate: 0, rotate: 0, scale: 0 };
  showGrid = true;
  /** Transient AI markers rendered as wire boxes (spec §210). */
  markers: { id: string; label: string; center: Vec3; size: Vec3 }[] = [];
  /** Ghost preview volumes for a pending AI change (spec §82). */
  ghosts: { center: Vec3; size: Vec3 }[] = [];

  private orbit = { target: new pc.Vec3(0, 2, 0), distance: 34, yaw: 0.7, pitch: -0.45 };
  private flying = false;
  private flyKeys = new Set<string>();
  private pointer = { x: 0, y: 0, inside: false };

  constructor(private readonly events: EngineEvents = {}) {}

  get ready() {
    return this.app !== null;
  }

  /* ---------------- lifecycle ---------------- */

  initialize(canvas: HTMLCanvasElement) {
    if (this.app) return;
    this.canvas = canvas;
    const app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      keyboard: new pc.Keyboard(window),
      graphicsDeviceOptions: { antialias: true, alpha: false },
    });
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.autoRender = false;
    this.app = app;

    app.scene.ambientLight = new pc.Color(0.32, 0.35, 0.42);

    const sun = new pc.Entity("EditorSun");
    sun.addComponent("light", { type: "directional", intensity: 1.15, color: new pc.Color(1, 0.97, 0.9), castShadows: true, shadowDistance: 200, shadowResolution: 1024, shadowBias: 0.2, normalOffsetBias: 0.05 });
    sun.setEulerAngles(-52, 38, 0);
    app.root.addChild(sun);

    const camera = new pc.Entity("EditorCamera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.086, 0.094, 0.106), fov: 55, nearClip: 0.1, farClip: 6000 });
    app.root.addChild(camera);
    this.camera = camera;
    this.applyOrbit();

    this.setupGizmos();
    this.attachInput(canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();

    this.lastTimestamp = 0;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private setupGizmos() {
    const app = this.app!;
    const layer = new pc.Layer({ name: "GameMakerGizmo", clearDepthBuffer: true, opaqueSortMode: pc.SORTMODE_NONE, transparentSortMode: pc.SORTMODE_NONE });
    app.scene.layers.push(layer);
    this.gizmoLayer = layer;

    const gizmoCamera = new pc.Entity("GizmoCamera");
    gizmoCamera.addComponent("camera", { clearColor: new pc.Color(0, 0, 0, 0), clearColorBuffer: false, clearDepthBuffer: false, layers: [layer.id], priority: 1 });
    this.camera!.addChild(gizmoCamera);
    this.gizmoCamera = gizmoCamera;

    const commit = () => {
      const changes = this.selection
        .map((entityId) => this.nodes.get(entityId))
        .filter((node): node is EditorNode => Boolean(node))
        .map((node) => {
          const position = node.entity.getLocalPosition();
          const rotation = node.entity.getLocalRotation();
          const scale = node.entity.getLocalScale();
          return {
            entityId: node.id,
            position: [position.x, position.y, position.z] as Vec3,
            rotation: [rotation.x, rotation.y, rotation.z, rotation.w] as [number, number, number, number],
            scale: [scale.x, scale.y, scale.z] as Vec3,
          };
        });
      if (changes.length) this.events.onTransformCommit?.(changes);
    };

    for (const [key, Constructor] of [
      ["translate", pc.TranslateGizmo],
      ["rotate", pc.RotateGizmo],
      ["scale", pc.ScaleGizmo],
    ] as const) {
      const gizmo = new Constructor(this.camera!.camera!, layer);
      gizmo.on("transform:end", commit);
      if (key === "translate") this.translateGizmo = gizmo as pc.TranslateGizmo;
      if (key === "rotate") this.rotateGizmo = gizmo as pc.RotateGizmo;
      if (key === "scale") this.scaleGizmo = gizmo as pc.ScaleGizmo;
    }
  }

  private activeGizmo(): pc.TransformGizmo | null {
    if (this.tool === "move") return this.translateGizmo;
    if (this.tool === "rotate") return this.rotateGizmo;
    if (this.tool === "scale") return this.scaleGizmo;
    return null;
  }

  private refreshGizmo() {
    for (const gizmo of [this.translateGizmo, this.rotateGizmo, this.scaleGizmo]) gizmo?.detach();
    const gizmo = this.activeGizmo();
    if (!gizmo || !this.selection.length) return;
    const nodes = this.selection.map((entityId) => this.nodes.get(entityId)?.entity).filter((entity): entity is pc.Entity => Boolean(entity));
    if (!nodes.length) return;
    gizmo.coordSpace = this.coordSpace === "local" ? pc.GIZMOSPACE_LOCAL : pc.GIZMOSPACE_WORLD;
    const increment = this.tool === "move" ? this.snap.translate : this.tool === "rotate" ? this.snap.rotate : this.snap.scale;
    gizmo.snap = increment > 0;
    gizmo.snapIncrement = increment || 1;
    gizmo.attach(nodes);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const gizmo of [this.translateGizmo, this.rotateGizmo, this.scaleGizmo]) gizmo?.destroy();
    this.translateGizmo = null;
    this.rotateGizmo = null;
    this.scaleGizmo = null;
    this.nodes.clear();
    this.materials.destroy();
    this.materials = new MaterialLibrary();
    this.app?.destroy();
    this.app = null;
    this.canvas = null;
    this.camera = null;
  }

  resize() {
    if (!this.app || !this.canvas) return;
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    this.app.resizeCanvas(width, height);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /* ---------------- scene loading ---------------- */

  loadScene(project: GameProjectIR, scene: SceneIR) {
    if (!this.app) return;
    this.project = project;
    this.scene = scene;
    this.materials.register(project.assets);
    this.sampleHeight = makeHeightSampler(scene.terrain);

    for (const node of this.nodes.values()) node.entity.destroy();
    this.nodes.clear();

    const [r, g, b] = hexToRgb(scene.environment.skyColor);
    if (this.camera?.camera) this.camera.camera.clearColor = new pc.Color(r * 0.5 + 0.04, g * 0.5 + 0.04, b * 0.5 + 0.05);

    if (scene.terrain) this.buildTerrain(scene);
    if (scene.voxel) this.buildVoxels(scene);
    for (const rootId of scene.rootEntities) this.buildEntity(scene, rootId, this.app.root);

    this.refreshGizmo();
  }

  /** Rebuild only what a patch touched — the editor never reloads the world. */
  applyChanges(project: GameProjectIR, scene: SceneIR, changedIds: string[]) {
    if (!this.app) return;
    this.project = project;
    this.materials.register(project.assets);
    const structural = this.scene?.rootEntities.join(",") !== scene.rootEntities.join(",") || Boolean(scene.terrain) !== Boolean(this.scene?.terrain) || Boolean(scene.voxel) !== Boolean(this.scene?.voxel);
    this.scene = scene;
    this.sampleHeight = makeHeightSampler(scene.terrain);

    if (structural || changedIds.length > 300) {
      this.loadScene(project, scene);
      return;
    }

    for (const entityId of changedIds) {
      const existing = this.nodes.get(entityId);
      const ir = scene.entities[entityId];
      if (!ir) {
        existing?.entity.destroy();
        this.nodes.delete(entityId);
        continue;
      }
      if (existing) {
        existing.entity.destroy();
        this.nodes.delete(entityId);
      }
      const parentNode = ir.parentId ? this.nodes.get(ir.parentId)?.entity : this.app.root;
      this.buildEntity(scene, entityId, parentNode ?? this.app.root);
    }
    this.refreshGizmo();
  }

  private buildEntity(scene: SceneIR, entityId: string, parent: pc.GraphNode) {
    const ir = scene.entities[entityId];
    if (!ir || !this.app) return;

    const entity = new pc.Entity(ir.name);
    entity.setLocalPosition(...ir.transform.position);
    entity.setLocalRotation(new pc.Quat(...ir.transform.rotation));
    entity.setLocalScale(...ir.transform.scale);
    entity.enabled = ir.visible;
    parent.addChild(entity);
    this.nodes.set(ir.id, { entity, id: ir.id });

    for (const component of ir.components) {
      if (component.enabled === false) continue;
      if (component.type === "ProceduralMesh") {
        const spec = component.data.spec as MeshSpec | undefined;
        if (spec?.parts?.length) {
          try {
            const instances = buildMeshInstances(this.app.graphicsDevice, spec, this.materials);
            if (instances.length) entity.addComponent("render", { meshInstances: instances, castShadows: true, receiveShadows: true });
          } catch {
            // A malformed spec must not stop the rest of the scene loading.
          }
        }
      } else if (component.type === "Light") {
        const light = new pc.Entity("light");
        light.setLocalPosition(...((component.data.offset as Vec3) ?? [0, 0, 0]));
        light.addComponent("light", {
          type: component.data.type === "directional" ? "directional" : component.data.type === "spot" ? "spot" : "omni",
          color: new pc.Color(...hexToRgb(String(component.data.color ?? "#ffffff"))),
          intensity: Number(component.data.intensity ?? 1),
          range: Number(component.data.range ?? 10),
          castShadows: false,
        });
        entity.addChild(light);
      } else if (component.type === "VegetationRegion") {
        this.buildVegetationPreview(entity, component.data);
      } else if (component.type === "RoadSpline") {
        this.buildRoadPreview(entity, component.data);
      } else if (component.type === "WaterPlane") {
        const mesh = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.PlaneGeometry({ halfExtents: new pc.Vec2(Number(component.data.size ?? 200) / 2, Number(component.data.size ?? 200) / 2) }));
        const holder = new pc.Entity("water");
        holder.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, this.materials.get(String(component.data.material ?? "")))], castShadows: false });
        entity.addChild(holder);
      }
    }

    for (const childId of ir.children) this.buildEntity(scene, childId, entity);
  }

  private buildVegetationPreview(parent: pc.Entity, data: Record<string, unknown>) {
    if (!this.app) return;
    const params = data.params as VegetationParams;
    // Editor preview is capped hard: the viewport must stay responsive while
    // the user is editing, and the runtime renders the full scatter.
    const instances = resolveScatter(params, Number(data.seed ?? 1), this.sampleHeight, 1200);
    if (!instances.length) return;
    const materials = (data.materials ?? {}) as Record<string, string>;
    const trunk = pc.Mesh.fromGeometry(this.app.graphicsDevice, new pc.ConeGeometry({ baseRadius: 1.5, peakRadius: 0.05, height: 5.5 }));
    const matrices: number[] = [];
    const matrix = new pc.Mat4();
    const quat = new pc.Quat();
    for (const instance of instances) {
      quat.setFromEulerAngles(0, (instance.yaw * 180) / Math.PI, 0);
      matrix.setTRS(new pc.Vec3(instance.position[0], instance.position[1] + 2.6 * instance.scale, instance.position[2]), quat, new pc.Vec3(instance.scale, instance.scale, instance.scale));
      matrices.push(...matrix.data);
    }
    const meshInstance = new pc.MeshInstance(trunk, this.materials.get(materials.leaf));
    meshInstance.setInstancing(new pc.VertexBuffer(this.app.graphicsDevice, pc.VertexFormat.getDefaultInstancingFormat(this.app.graphicsDevice), matrices.length / 16, { data: new Float32Array(matrices) }));
    meshInstance.castShadow = false;
    const holder = new pc.Entity("vegetation-preview");
    holder.addComponent("render", { meshInstances: [meshInstance] });
    parent.addChild(holder);
  }

  private buildRoadPreview(parent: pc.Entity, data: Record<string, unknown>) {
    if (!this.app) return;
    const points = (data.points as Vec3[]) ?? [];
    if (points.length < 2) return;
    const width = Number(data.width ?? 4);
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const [cr, cg, cb] = hexToRgb(this.materials.definition(String(data.material ?? "")).baseColor);

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
      colors.push(cr, cg, cb, 1, cr, cg, cb, 1);
      if (index < points.length - 1) {
        const base = index * 2;
        indices.push(base, base + 2, base + 3, base, base + 3, base + 1);
      }
    }
    const mesh = new pc.Mesh(this.app.graphicsDevice);
    mesh.setPositions(positions);
    mesh.setNormals(normals);
    mesh.setColors(colors);
    mesh.setIndices(indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const holder = new pc.Entity("road-preview");
    holder.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, this.materials.get(String(data.material ?? "")))], castShadows: false });
    parent.addChild(holder);
  }

  private buildTerrain(scene: SceneIR) {
    if (!this.app) return;
    const terrain = scene.terrain!;
    const params = { ...(terrain.parameters as unknown as TerrainParams), size: terrain.size, tileSize: terrain.tileSize, maxHeight: terrain.maxHeight };
    const material = this.materials.get(String((terrain.parameters as Record<string, unknown>).groundMaterial ?? ""));
    const [gr, gg, gb] = hexToRgb(this.materials.definition(String((terrain.parameters as Record<string, unknown>).groundMaterial ?? "")).baseColor);
    const [rr, rg, rb] = hexToRgb(this.materials.definition(String((terrain.parameters as Record<string, unknown>).rockMaterial ?? "")).baseColor);

    const holder = new pc.Entity("Terrain");
    this.app.root.addChild(holder);
    this.nodes.set("__terrain", { entity: holder, id: "__terrain" });

    const tilesPerSide = Math.min(13, Math.ceil(terrain.size / terrain.tileSize));
    const half = Math.floor(tilesPerSide / 2);
    const resolution = Math.min(TERRAIN_RESOLUTION, 25);
    const step = terrain.tileSize / (resolution - 1);

    for (let tz = -half; tz <= half; tz += 1) {
      for (let tx = -half; tx <= half; tx += 1) {
        const positions: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];
        const indices: number[] = [];
        for (let row = 0; row < resolution; row += 1) {
          for (let column = 0; column < resolution; column += 1) {
            const x = tx * terrain.tileSize + column * step;
            const z = tz * terrain.tileSize + row * step;
            positions.push(x, terrainHeightAt(x, z, terrain.seed, params), z);
            const hx = terrainHeightAt(x + step, z, terrain.seed, params) - terrainHeightAt(x - step, z, terrain.seed, params);
            const hz = terrainHeightAt(x, z + step, terrain.seed, params) - terrainHeightAt(x, z - step, terrain.seed, params);
            const normal = new pc.Vec3(-hx, 2 * step, -hz).normalize();
            normals.push(normal.x, normal.y, normal.z);
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
        mesh.setColors(colors);
        mesh.setIndices(indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        const tile = new pc.Entity(`terrain-${tx}-${tz}`);
        tile.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
        holder.addChild(tile);
      }
    }
  }

  private buildVoxels(scene: SceneIR) {
    if (!this.app) return;
    const voxel = scene.voxel!;
    const size = voxel.chunkSize;
    const decoded = new Map<string, Uint8Array>();
    for (const [key, data] of Object.entries(voxel.chunks)) decoded.set(key, decodeChunk(data));

    const material = new pc.StandardMaterial();
    material.diffuseVertexColor = true;
    material.gloss = 0.04;
    material.update();

    const holder = new pc.Entity("Voxels");
    this.app.root.addChild(holder);
    this.nodes.set("__voxels", { entity: holder, id: "__voxels" });

    for (const [key, blocks] of decoded) {
      const [cx, cy, cz] = key.split(",").map(Number) as [number, number, number];
      const built = meshChunk(blocks, size, (x, y, z) => {
        const wx = cx * size + x;
        const wy = cy * size + y;
        const wz = cz * size + z;
        const chunk = decoded.get(`${Math.floor(wx / size)},${Math.floor(wy / size)},${Math.floor(wz / size)}`);
        if (!chunk) return 0;
        return chunk[((((wy % size) + size) % size) * size + (((wz % size) + size) % size)) * size + (((wx % size) + size) % size)] ?? 0;
      });
      if (!built.indices.length) continue;
      const mesh = new pc.Mesh(this.app.graphicsDevice);
      mesh.setPositions(built.positions);
      mesh.setNormals(built.normals);
      mesh.setColors(built.colors);
      mesh.setIndices(built.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const chunkEntity = new pc.Entity(`chunk-${key}`);
      chunkEntity.setLocalPosition(cx * size, cy * size, cz * size);
      chunkEntity.addComponent("render", { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: false, receiveShadows: true });
      holder.addChild(chunkEntity);
    }
    void BLOCKS;
  }

  /* ---------------- input ---------------- */

  private attachInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerenter", () => {
      this.pointer.inside = true;
    });
    canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      if (this.hovered) {
        this.hovered = null;
        this.events.onHover?.(null);
      }
    });

    let dragging: "orbit" | "pan" | null = null;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      lastX = event.clientX;
      lastY = event.clientY;
      downX = event.clientX;
      downY = event.clientY;
      if (event.button === 2 || (event.button === 0 && event.altKey)) dragging = "orbit";
      else if (event.button === 1 || (event.button === 0 && event.shiftKey && event.altKey)) dragging = "pan";
      if (event.button === 2) this.flying = true;
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.x = event.clientX - rect.left;
      this.pointer.y = event.clientY - rect.top;

      if (dragging) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        if (dragging === "orbit") {
          this.orbit.yaw -= dx * 0.006;
          this.orbit.pitch = Math.max(-1.5, Math.min(1.4, this.orbit.pitch - dy * 0.005));
        } else {
          const right = this.camera!.right.clone().mulScalar(-dx * this.orbit.distance * 0.0016);
          const up = this.camera!.up.clone().mulScalar(dy * this.orbit.distance * 0.0016);
          this.orbit.target.add(right).add(up);
        }
        this.applyOrbit();
        return;
      }

      const hit = this.pick(this.pointer.x, this.pointer.y);
      const next = hit?.entityId ?? null;
      if (next !== this.hovered) {
        this.hovered = next;
        this.events.onHover?.(next);
      }
    });

    canvas.addEventListener("pointerup", (event) => {
      canvas.releasePointerCapture(event.pointerId);
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (dragging === null && event.button === 0 && moved < 4) {
        const hit = this.pick(this.pointer.x, this.pointer.y);
        if (hit?.entityId) {
          this.select(event.shiftKey ? [...new Set([...this.selection, hit.entityId])] : [hit.entityId]);
        } else if (!event.shiftKey) {
          this.select([]);
        }
      }
      dragging = null;
      this.flying = false;
    });

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.orbit.distance = Math.max(1.2, Math.min(4000, this.orbit.distance * (1 + Math.sign(event.deltaY) * 0.12)));
        this.applyOrbit();
      },
      { passive: false },
    );

    // WASD fly, but only while the right button is held and never while a
    // text field has focus (spec §45).
    window.addEventListener("keydown", (event) => {
      if (isTextTarget(event.target)) return;
      this.flyKeys.add(event.code);
    });
    window.addEventListener("keyup", (event) => this.flyKeys.delete(event.code));
  }

  private applyOrbit() {
    if (!this.camera) return;
    const { target, distance, yaw, pitch } = this.orbit;
    this.camera.setPosition(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y - Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(target);
  }

  /* ---------------- picking ---------------- */

  /** Ray from the viewport pixel through the world, in world space. */
  screenRay(x: number, y: number): { origin: Vec3; direction: Vec3 } | null {
    if (!this.camera?.camera || !this.canvas) return null;
    const near = new pc.Vec3();
    const far = new pc.Vec3();
    this.camera.camera.screenToWorld(x, y, this.camera.camera.nearClip + 0.01, near);
    this.camera.camera.screenToWorld(x, y, this.camera.camera.nearClip + 1, far);
    const direction = normalize([far.x - near.x, far.y - near.y, far.z - near.z]);
    return { origin: [near.x, near.y, near.z], direction };
  }

  /**
   * Ray-cast against the IR spatial index rather than GPU picking: it is
   * exact, works headlessly, and returns the same answer the AI's grounding
   * layer will compute from the frozen ContextFrame.
   */
  pick(x: number, y: number): { entityId?: string; position: Vec3; normal: Vec3; distance: number } | null {
    const ray = this.screenRay(x, y);
    if (!ray || !this.scene) return null;
    const index = getSpatialIndex(this.scene);
    const hit = index.raycast(ray.origin, ray.direction);
    if (hit) return hit;

    if (this.scene.terrain) {
      // March the ray against the terrain surface.
      const sampler = this.sampleHeight;
      if (sampler) {
        let t = 0;
        let previousDelta = ray.origin[1] - (sampler(ray.origin[0], ray.origin[2]) ?? 0);
        for (let step = 0; step < 400; step += 1) {
          t += Math.max(0.5, t * 0.03);
          const px = ray.origin[0] + ray.direction[0] * t;
          const py = ray.origin[1] + ray.direction[1] * t;
          const pz = ray.origin[2] + ray.direction[2] * t;
          const delta = py - (sampler(px, pz) ?? 0);
          if (delta <= 0 && previousDelta > 0) {
            return { position: [px, py, pz], normal: [0, 1, 0], distance: t };
          }
          previousDelta = delta;
          if (t > 5000) break;
        }
      }
    }

    const ground = rayGroundPlane(ray.origin, ray.direction, 0);
    return ground ? { position: ground, normal: [0, 1, 0], distance: Math.hypot(ground[0] - ray.origin[0], ground[1] - ray.origin[1], ground[2] - ray.origin[2]) } : null;
  }

  /* ---------------- selection + camera ---------------- */

  select(entityIds: string[]) {
    this.selection = entityIds.filter((entityId) => this.nodes.has(entityId));
    this.refreshGizmo();
    this.events.onSelectionChange?.(this.selection);
  }

  setTool(tool: EditorTool) {
    this.tool = tool;
    this.refreshGizmo();
  }

  setCoordSpace(space: "world" | "local") {
    this.coordSpace = space;
    this.refreshGizmo();
  }

  setSnap(snap: Partial<Editor3DEngine["snap"]>) {
    this.snap = { ...this.snap, ...snap };
    this.refreshGizmo();
  }

  frameSelection() {
    if (!this.scene || !this.selection.length) return this.frameAll();
    const index = getSpatialIndex(this.scene);
    const entries = this.selection.map((entityId) => index.get(entityId)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (!entries.length) return;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const entry of entries) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, entry.aabb.min[axis]!);
        max[axis] = Math.max(max[axis]!, entry.aabb.max[axis]!);
      }
    }
    this.orbit.target.set((min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2);
    this.orbit.distance = Math.max(3, Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) * 1.4);
    this.applyOrbit();
  }

  frameAll() {
    if (!this.scene) return;
    const index = getSpatialIndex(this.scene);
    if (!index.size) {
      this.orbit.target.set(0, 2, 0);
      this.orbit.distance = 34;
      this.applyOrbit();
      return;
    }
    const { min, max } = index.bounds;
    this.orbit.target.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.orbit.distance = Math.max(8, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 0.85);
    this.applyOrbit();
  }

  setCameraPreset(preset: CameraPreset) {
    switch (preset) {
      case "top":
        this.orbit.yaw = 0;
        this.orbit.pitch = -1.5;
        break;
      case "front":
        this.orbit.yaw = 0;
        this.orbit.pitch = 0;
        break;
      case "side":
        this.orbit.yaw = Math.PI / 2;
        this.orbit.pitch = 0;
        break;
      default:
        this.orbit.yaw = 0.7;
        this.orbit.pitch = -0.45;
    }
    this.applyOrbit();
  }

  cameraBookmark(): { target: Vec3; distance: number; yaw: number; pitch: number } {
    return { target: [this.orbit.target.x, this.orbit.target.y, this.orbit.target.z], distance: this.orbit.distance, yaw: this.orbit.yaw, pitch: this.orbit.pitch };
  }

  restoreBookmark(bookmark: { target: Vec3; distance: number; yaw: number; pitch: number }) {
    this.orbit.target.set(...bookmark.target);
    this.orbit.distance = bookmark.distance;
    this.orbit.yaw = bookmark.yaw;
    this.orbit.pitch = bookmark.pitch;
    this.applyOrbit();
  }

  /* ---------------- context frame ---------------- */

  /**
   * Freeze exactly what the user was looking at and pointing at (spec §57).
   * Everything the language model later resolves as "here" or "this" comes
   * from this snapshot, not from live state that may have moved on.
   */
  getContextFrame(): ContextFrame | null {
    if (!this.scene || !this.project || !this.camera?.camera) return null;
    const scene = this.scene;
    const index = getSpatialIndex(scene);
    const cameraPosition = this.camera.getPosition();
    const rotation = this.camera.getRotation();
    const forward = this.camera.forward;
    const right = this.camera.right;
    const up = this.camera.up;

    const ray = this.screenRay(this.pointer.x, this.pointer.y);
    const hit = this.pointer.inside ? this.pick(this.pointer.x, this.pointer.y) : null;

    const toContext = (entityId: string): EntityContext | null => {
      const entry = index.get(entityId);
      if (!entry) return null;
      const screen = this.projectToScreen(entry.center, entry.size);
      return {
        entityId: entry.id,
        name: entry.name,
        type: entry.type,
        tags: entry.tags,
        position: entry.center,
        size: entry.size,
        regionId: entry.regionId,
        distance: Number(cameraPosition.distance(new pc.Vec3(...entry.center)).toFixed(2)),
        screenBounds: screen?.bounds,
        screenCoverage: screen?.coverage,
      };
    };

    const selected = this.selection.map(toContext).filter((entry): entry is EntityContext => Boolean(entry));
    const hovered = this.hovered ? toContext(this.hovered) ?? undefined : undefined;

    // Visible entities, ranked by how much of the viewport they occupy —
    // this is what lets a text-only model say "the tower on the right".
    const visible = index
      .all()
      .map((entry) => toContext(entry.id))
      .filter((entry): entry is EntityContext => Boolean(entry) && Boolean(entry!.screenBounds))
      .sort((a, b) => (b.screenCoverage ?? 0) - (a.screenCoverage ?? 0))
      .slice(0, 40);

    const focus = hit?.position ?? [cameraPosition.x, cameraPosition.y, cameraPosition.z];
    const nearby = index
      .withinRadius(focus as Vec3, 40)
      .slice(0, 30)
      .map((entry) => toContext(entry.id))
      .filter((entry): entry is EntityContext => Boolean(entry));

    return {
      id: createId("frame"),
      projectId: this.project.projectId,
      sceneId: scene.id,
      sceneRevision: scene.revision,
      editorMode: this.project.runtime.mode,
      timestamp: Date.now(),
      camera: {
        position: [cameraPosition.x, cameraPosition.y, cameraPosition.z],
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        forward: [forward.x, forward.y, forward.z],
        right: [right.x, right.y, right.z],
        up: [up.x, up.y, up.z],
        fov: this.camera.camera.fov,
      },
      cursor: {
        x: this.pointer.x,
        y: this.pointer.y,
        ray: ray ?? undefined,
        hit: hit ? { position: hit.position, normal: hit.normal, entityId: hit.entityId, distance: hit.distance } : undefined,
      },
      selected,
      hovered,
      visible,
      nearby,
      sceneSummary: buildSceneSummary(scene),
    };
  }

  /** Normalised screen bounds + viewport coverage for an entity (spec §58). */
  private projectToScreen(center: Vec3, size: Vec3): { bounds: [number, number, number, number]; coverage: number } | null {
    if (!this.camera?.camera || !this.canvas) return null;
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let anyInFront = false;
    const point = new pc.Vec3();
    const screen = new pc.Vec3();

    for (const sx of [-0.5, 0.5]) {
      for (const sy of [-0.5, 0.5]) {
        for (const sz of [-0.5, 0.5]) {
          point.set(center[0] + size[0] * sx, center[1] + size[1] * sy, center[2] + size[2] * sz);
          this.camera.camera.worldToScreen(point, screen);
          if (screen.z <= 0) continue;
          anyInFront = true;
          minX = Math.min(minX, screen.x);
          minY = Math.min(minY, screen.y);
          maxX = Math.max(maxX, screen.x);
          maxY = Math.max(maxY, screen.y);
        }
      }
    }
    if (!anyInFront) return null;
    if (maxX < 0 || maxY < 0 || minX > width || minY > height) return null;

    const clampedMinX = Math.max(0, minX) / width;
    const clampedMinY = Math.max(0, minY) / height;
    const clampedMaxX = Math.min(width, maxX) / width;
    const clampedMaxY = Math.min(height, maxY) / height;
    return {
      bounds: [Number(clampedMinX.toFixed(3)), Number(clampedMinY.toFixed(3)), Number(clampedMaxX.toFixed(3)), Number(clampedMaxY.toFixed(3))],
      coverage: Number(Math.max(0, (clampedMaxX - clampedMinX) * (clampedMaxY - clampedMinY)).toFixed(4)),
    };
  }

  screenshot(): string | null {
    if (!this.app || !this.canvas) return null;
    this.app.render();
    return this.canvas.toDataURL("image/webp", 0.7);
  }

  /* ---------------- frame loop ---------------- */

  private tick = (timestamp: number) => {
    if (this.disposed || !this.app) return;
    this.rafHandle = requestAnimationFrame(this.tick);
    const delta = this.lastTimestamp ? Math.min(0.1, (timestamp - this.lastTimestamp) / 1000) : 1 / 60;
    this.lastTimestamp = timestamp;

    if (this.flying) this.updateFly(delta);
    this.drawOverlays();
    this.app.update(delta);
    this.app.render();

    this.statsTimer += delta;
    this.framesSinceStats += 1;
    if (this.statsTimer > 0.75) {
      const fps = Math.round(this.framesSinceStats / this.statsTimer);
      this.statsTimer = 0;
      this.framesSinceStats = 0;
      this.events.onStats?.({ fps, ...readRenderStats(this.app), entities: this.nodes.size });
    }
  };

  private updateFly(delta: number) {
    if (!this.camera) return;
    const speed = (this.flyKeys.has("ShiftLeft") ? 46 : 16) * delta;
    const move = new pc.Vec3();
    if (this.flyKeys.has("KeyW")) move.add(this.camera.forward.clone().mulScalar(speed));
    if (this.flyKeys.has("KeyS")) move.add(this.camera.forward.clone().mulScalar(-speed));
    if (this.flyKeys.has("KeyA")) move.add(this.camera.right.clone().mulScalar(-speed));
    if (this.flyKeys.has("KeyD")) move.add(this.camera.right.clone().mulScalar(speed));
    if (this.flyKeys.has("KeyQ")) move.y -= speed;
    if (this.flyKeys.has("KeyE")) move.y += speed;
    if (move.length() > 0) {
      this.orbit.target.add(move);
      this.applyOrbit();
    }
  }

  private drawOverlays() {
    if (!this.app || !this.scene) return;
    const index = getSpatialIndex(this.scene);

    if (this.showGrid) {
      const extent = Math.max(40, Math.min(400, this.orbit.distance * 3));
      const step = extent / 20;
      const color = new pc.Color(1, 1, 1, 0.07);
      const lines: pc.Vec3[] = [];
      const centreX = Math.round(this.orbit.target.x / step) * step;
      const centreZ = Math.round(this.orbit.target.z / step) * step;
      for (let index2 = -10; index2 <= 10; index2 += 1) {
        lines.push(new pc.Vec3(centreX + index2 * step, 0, centreZ - extent / 2), new pc.Vec3(centreX + index2 * step, 0, centreZ + extent / 2));
        lines.push(new pc.Vec3(centreX - extent / 2, 0, centreZ + index2 * step), new pc.Vec3(centreX + extent / 2, 0, centreZ + index2 * step));
      }
      this.app.drawLines(lines, color);
    }

    for (const entityId of this.selection) {
      const entry = index.get(entityId);
      if (!entry) continue;
      this.app.drawWireAlignedBox(new pc.Vec3(...entry.aabb.min), new pc.Vec3(...entry.aabb.max), SELECTION_COLOR);
    }
    if (this.hovered && !this.selection.includes(this.hovered)) {
      const entry = index.get(this.hovered);
      if (entry) this.app.drawWireAlignedBox(new pc.Vec3(...entry.aabb.min), new pc.Vec3(...entry.aabb.max), HOVER_COLOR);
    }
    for (const marker of this.markers) {
      this.app.drawWireAlignedBox(
        new pc.Vec3(marker.center[0] - marker.size[0] / 2, marker.center[1] - marker.size[1] / 2, marker.center[2] - marker.size[2] / 2),
        new pc.Vec3(marker.center[0] + marker.size[0] / 2, marker.center[1] + marker.size[1] / 2, marker.center[2] + marker.size[2] / 2),
        MARKER_COLOR,
      );
    }
    for (const ghost of this.ghosts) {
      this.app.drawWireAlignedBox(
        new pc.Vec3(ghost.center[0] - ghost.size[0] / 2, ghost.center[1] - ghost.size[1] / 2, ghost.center[2] - ghost.size[2] / 2),
        new pc.Vec3(ghost.center[0] + ghost.size[0] / 2, ghost.center[1] + ghost.size[1] / 2, ghost.center[2] + ghost.size[2] / 2),
        new pc.Color(0.4, 0.8, 1, 0.55),
      );
    }
  }
}

/**
 * Draw-call and triangle counters, read defensively: the production
 * PlayCanvas build does not populate every profiler field, and a missing
 * counter must show as 0 rather than throw inside the frame loop.
 */
export function readRenderStats(app: pc.AppBase): { drawCalls: number; triangles: number } {
  try {
    const stats = app.stats as unknown as { drawCalls?: { total?: number }; frame?: { triangles?: number } };
    return { drawCalls: Number(stats?.drawCalls?.total ?? 0), triangles: Number(stats?.frame?.triangles ?? 0) };
  } catch {
    return { drawCalls: 0, triangles: 0 };
  }
}

function isTextTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable === true || element.classList?.contains("monaco-editor") === true;
}
