/**
 * MeshSpec → PlayCanvas geometry.
 *
 * Shared by the editor viewport and the sandboxed runtime so a generated
 * building looks identical in both. Materials are compiled from the
 * procedural MaterialDefinition — there are no texture files to load.
 */
import * as pc from "playcanvas";
import type { MeshPart, MeshSpec } from "../procedural/mesh";
import { buildExtrudedGeometry, buildPrismGeometry } from "../procedural/mesh";
import type { MaterialDefinition } from "../procedural/materials";
import { hexToRgb } from "../procedural/materials";
import type { AssetRecord } from "../ir/types";

const DEFAULT_MATERIAL: MaterialDefinition = {
  baseColor: "#b8bcc2",
  detailColor: "#8f949b",
  roughness: 0.8,
  metalness: 0,
  pattern: "flat",
  patternScale: 1,
  patternStrength: 0,
  jitter: 0,
};

export class MaterialLibrary {
  private readonly cache = new Map<string, pc.StandardMaterial>();
  private readonly definitions = new Map<string, MaterialDefinition>();

  constructor(assets: AssetRecord[] = []) {
    this.register(assets);
  }

  register(assets: AssetRecord[]) {
    for (const asset of assets) {
      if (asset.type !== "material" || !asset.definition) continue;
      this.definitions.set(asset.id, asset.definition as unknown as MaterialDefinition);
    }
  }

  get(id: string | undefined): pc.StandardMaterial {
    const key = id ?? "__default";
    const existing = this.cache.get(key);
    if (existing) return existing;

    const definition = (id ? this.definitions.get(id) : undefined) ?? DEFAULT_MATERIAL;
    const material = new pc.StandardMaterial();
    const [r, g, b] = hexToRgb(definition.baseColor);
    material.diffuse = new pc.Color(r, g, b);
    material.gloss = Math.max(0, Math.min(1, 1 - definition.roughness));
    material.useMetalness = true;
    material.metalness = definition.metalness;
    if (definition.emissive) {
      const [er, eg, eb] = hexToRgb(definition.emissive);
      material.emissive = new pc.Color(er, eg, eb);
      material.emissiveIntensity = definition.emissiveIntensity ?? 1;
    }
    if (definition.opacity !== undefined && definition.opacity < 1) {
      material.opacity = definition.opacity;
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
    }
    // Vertex colours carry the per-part pattern tint the generator baked in.
    material.diffuseVertexColor = true;
    material.update();
    this.cache.set(key, material);
    return material;
  }

  definition(id: string | undefined): MaterialDefinition {
    return (id ? this.definitions.get(id) : undefined) ?? DEFAULT_MATERIAL;
  }

  destroy() {
    for (const material of this.cache.values()) material.destroy();
    this.cache.clear();
  }
}

function primitiveGeometry(item: MeshPart): pc.Geometry | null {
  const [sx, sy, sz] = item.size;
  switch (item.kind) {
    case "box":
      return new pc.BoxGeometry({ halfExtents: new pc.Vec3(sx / 2, sy / 2, sz / 2) });
    case "cylinder":
      return new pc.CylinderGeometry({ radius: Math.max(sx, sz) / 2, height: sy, capSegments: 1, heightSegments: 1 });
    case "cone":
      return new pc.ConeGeometry({ baseRadius: Math.max(sx, sz) / 2, peakRadius: 0, height: sy });
    case "sphere":
      return new pc.SphereGeometry({ radius: Math.max(sx, sy, sz) / 2, latitudeBands: 12, longitudeBands: 16 });
    case "capsule":
      return new pc.CapsuleGeometry({ radius: Math.max(sx, sz) / 2, height: Math.max(sy, Math.max(sx, sz)), sides: 12 });
    case "plane":
      return new pc.PlaneGeometry({ halfExtents: new pc.Vec2(sx / 2, sz / 2) });
    case "torus":
      return new pc.TorusGeometry({ tubeRadius: sy / 2, ringRadius: sx / 2 });
    default:
      return null;
  }
}

/**
 * Build one merged mesh per material from a MeshSpec. Merging is what keeps
 * a 40-part building at a handful of draw calls instead of 40.
 */
export function buildMeshInstances(
  device: pc.GraphicsDevice,
  spec: MeshSpec,
  library: MaterialLibrary,
): pc.MeshInstance[] {
  const groups = new Map<string, { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[] }>();

  for (const item of spec.parts) {
    const group =
      groups.get(item.material) ??
      groups.set(item.material, { positions: [], normals: [], uvs: [], colors: [], indices: [] }).get(item.material)!;

    let source: { positions: number[]; normals: number[]; uvs: number[]; indices: number[] };
    if (item.kind === "prism") {
      source = buildPrismGeometry(item.size[0], item.size[1], item.size[2]);
    } else if (item.kind === "extrude" && item.polygon?.length) {
      source = buildExtrudedGeometry(item.polygon, item.size[1]);
    } else {
      const geometry = primitiveGeometry(item);
      if (!geometry) continue;
      source = {
        positions: Array.from(geometry.positions ?? []),
        normals: Array.from(geometry.normals ?? []),
        uvs: Array.from(geometry.uvs ?? []),
        indices: Array.from(geometry.indices ?? []),
      };
    }

    // Bake the part transform into the merged vertex data.
    const [rx, ry, rz] = item.rotation ?? [0, 0, 0];
    const quat = new pc.Quat().setFromEulerAngles(rx, ry, rz);
    const matrix = new pc.Mat4().setTRS(new pc.Vec3(...item.offset), quat, pc.Vec3.ONE);
    const normalMatrix = new pc.Mat4().setTRS(pc.Vec3.ZERO, quat, pc.Vec3.ONE);
    const base = group.positions.length / 3;
    const point = new pc.Vec3();

    const definition = library.definition(item.material);
    const [dr, dg, db] = hexToRgb(definition.baseColor);
    const [tr, tg, tb] = hexToRgb(definition.detailColor);

    for (let index = 0; index < source.positions.length; index += 3) {
      point.set(source.positions[index]!, source.positions[index + 1]!, source.positions[index + 2]!);
      matrix.transformPoint(point, point);
      group.positions.push(point.x, point.y, point.z);

      point.set(source.normals[index] ?? 0, source.normals[index + 1] ?? 1, source.normals[index + 2] ?? 0);
      normalMatrix.transformVector(point, point);
      group.normals.push(point.x, point.y, point.z);

      // Deterministic per-vertex tint so flat colours read as material, not paint.
      const seedValue = Math.abs(Math.sin((index + 1) * 12.9898 + base * 78.233)) % 1;
      const blend = definition.patternStrength * (seedValue > 0.5 ? 1 : 0) * 0.6 + definition.jitter * (seedValue - 0.5);
      group.colors.push(
        Math.max(0, Math.min(1, dr + (tr - dr) * blend)),
        Math.max(0, Math.min(1, dg + (tg - dg) * blend)),
        Math.max(0, Math.min(1, db + (tb - db) * blend)),
        1,
      );
    }
    for (let index = 0; index < source.uvs.length; index += 1) group.uvs.push(source.uvs[index]!);
    for (const value of source.indices) group.indices.push(base + value);
  }

  const instances: pc.MeshInstance[] = [];
  for (const [materialId, group] of groups) {
    if (!group.positions.length || !group.indices.length) continue;
    const mesh = new pc.Mesh(device);
    mesh.setPositions(group.positions);
    mesh.setNormals(group.normals);
    if (group.uvs.length) mesh.setUvs(0, group.uvs);
    mesh.setColors(group.colors);
    mesh.setIndices(group.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    instances.push(new pc.MeshInstance(mesh, library.get(materialId)));
  }
  return instances;
}

/** Collision boxes for a MeshSpec, skipping decorative parts. */
export function collisionBoxes(spec: MeshSpec): { offset: [number, number, number]; size: [number, number, number] }[] {
  return spec.parts
    .filter((item) => !item.noCollision)
    .map((item) => ({ offset: item.offset, size: item.size }));
}
