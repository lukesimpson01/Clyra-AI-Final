/**
 * Procedural PBR materials (spec §93).
 *
 * The model has no image generation, so materials are parameters, not
 * textures: a base colour plus roughness/metalness plus a small procedural
 * pattern the shader can evaluate. That is enough for a coherent stylised
 * look, works offline, costs nothing to store, and is deterministic.
 */
import type { AssetRecord } from "../ir/types";
import { Rng, hashString } from "./random";

export type MaterialPattern = "flat" | "noise" | "bricks" | "planks" | "tiles" | "scatter" | "stripes";

export interface MaterialDefinition {
  baseColor: string;
  /** Secondary colour used by the pattern (mortar, grain, moss). */
  detailColor: string;
  roughness: number;
  metalness: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  pattern: MaterialPattern;
  patternScale: number;
  patternStrength: number;
  /** Per-vertex colour jitter — cheap variation without textures. */
  jitter: number;
}

export type MaterialFamily =
  | "stone"
  | "weathered_stone"
  | "wood"
  | "dark_wood"
  | "metal"
  | "iron"
  | "gold"
  | "brick"
  | "plaster"
  | "mud"
  | "grass"
  | "snow"
  | "sand"
  | "rock"
  | "fabric"
  | "thatch"
  | "clay_tiles"
  | "glass"
  | "water"
  | "foliage"
  | "skin"
  | "leather";

interface FamilyBase {
  base: string;
  detail: string;
  roughness: number;
  metalness: number;
  pattern: MaterialPattern;
  scale: number;
  strength: number;
  jitter: number;
  opacity?: number;
  emissive?: string;
}

const FAMILIES: Record<MaterialFamily, FamilyBase> = {
  stone: { base: "#8d8b85", detail: "#6f6d68", roughness: 0.86, metalness: 0, pattern: "bricks", scale: 1.6, strength: 0.35, jitter: 0.05 },
  weathered_stone: { base: "#7d7f78", detail: "#5c6455", roughness: 0.92, metalness: 0, pattern: "noise", scale: 2.6, strength: 0.5, jitter: 0.08 },
  wood: { base: "#9c7448", detail: "#7a5733", roughness: 0.78, metalness: 0, pattern: "planks", scale: 2.2, strength: 0.3, jitter: 0.06 },
  dark_wood: { base: "#4e3826", detail: "#372618", roughness: 0.74, metalness: 0, pattern: "planks", scale: 2.4, strength: 0.32, jitter: 0.05 },
  metal: { base: "#9aa2ab", detail: "#6d757e", roughness: 0.38, metalness: 0.9, pattern: "noise", scale: 3.2, strength: 0.15, jitter: 0.02 },
  iron: { base: "#4c5158", detail: "#33373c", roughness: 0.52, metalness: 0.85, pattern: "noise", scale: 2.8, strength: 0.2, jitter: 0.03 },
  gold: { base: "#d8ac48", detail: "#a67f28", roughness: 0.28, metalness: 1, pattern: "flat", scale: 1, strength: 0.1, jitter: 0.02 },
  brick: { base: "#a5624b", detail: "#d8cbb5", roughness: 0.83, metalness: 0, pattern: "bricks", scale: 3.4, strength: 0.45, jitter: 0.07 },
  plaster: { base: "#ddd3c0", detail: "#c0b39c", roughness: 0.9, metalness: 0, pattern: "noise", scale: 4, strength: 0.18, jitter: 0.04 },
  mud: { base: "#6b5a44", detail: "#4e4132", roughness: 0.95, metalness: 0, pattern: "noise", scale: 2, strength: 0.4, jitter: 0.08 },
  grass: { base: "#5f8447", detail: "#3f5d2f", roughness: 0.94, metalness: 0, pattern: "scatter", scale: 5, strength: 0.4, jitter: 0.11 },
  snow: { base: "#eef2f6", detail: "#cdd8e4", roughness: 0.6, metalness: 0, pattern: "noise", scale: 3, strength: 0.15, jitter: 0.03 },
  sand: { base: "#d7c295", detail: "#bda57a", roughness: 0.92, metalness: 0, pattern: "noise", scale: 6, strength: 0.25, jitter: 0.05 },
  rock: { base: "#77726c", detail: "#565350", roughness: 0.88, metalness: 0, pattern: "noise", scale: 1.8, strength: 0.5, jitter: 0.09 },
  fabric: { base: "#8b4f52", detail: "#6b3a3d", roughness: 0.96, metalness: 0, pattern: "stripes", scale: 6, strength: 0.25, jitter: 0.04 },
  thatch: { base: "#b39150", detail: "#8a6d38", roughness: 0.97, metalness: 0, pattern: "planks", scale: 5, strength: 0.4, jitter: 0.09 },
  clay_tiles: { base: "#a8503c", detail: "#7f3a2b", roughness: 0.8, metalness: 0, pattern: "tiles", scale: 4, strength: 0.4, jitter: 0.06 },
  glass: { base: "#a8c8dc", detail: "#c8e0ee", roughness: 0.12, metalness: 0.1, pattern: "flat", scale: 1, strength: 0, jitter: 0, opacity: 0.35 },
  water: { base: "#3f6f8f", detail: "#5b93b3", roughness: 0.14, metalness: 0.05, pattern: "noise", scale: 1.2, strength: 0.3, jitter: 0.02, opacity: 0.78 },
  foliage: { base: "#456b39", detail: "#2f4d28", roughness: 0.9, metalness: 0, pattern: "scatter", scale: 3, strength: 0.45, jitter: 0.12 },
  skin: { base: "#c99b78", detail: "#a87c5c", roughness: 0.7, metalness: 0, pattern: "flat", scale: 1, strength: 0.05, jitter: 0.02 },
  leather: { base: "#6b4a30", detail: "#4d3421", roughness: 0.82, metalness: 0, pattern: "noise", scale: 3.6, strength: 0.25, jitter: 0.05 },
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export function shiftColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex([rgb[0] + amount, rgb[1] + amount, rgb[2] + amount]);
}

export function tintTowards(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const t = clamp01(amount);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export interface MaterialRequest {
  family: MaterialFamily;
  seed?: number;
  /** 0 = pristine, 1 = ruined. Drives roughness, moss and colour drift. */
  weathering?: number;
  tint?: string;
  tintStrength?: number;
  scale?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export function generateMaterial(request: MaterialRequest): MaterialDefinition {
  const family = FAMILIES[request.family] ?? FAMILIES.stone;
  const seed = request.seed ?? hashString(request.family);
  const rng = new Rng(seed);
  const weathering = clamp01(request.weathering ?? 0);

  let baseColor = shiftColor(family.base, rng.range(-0.04, 0.04));
  let detailColor = shiftColor(family.detail, rng.range(-0.04, 0.04));
  if (weathering > 0) {
    baseColor = tintTowards(baseColor, "#5d6350", weathering * 0.35);
    detailColor = tintTowards(detailColor, "#4a5140", weathering * 0.4);
  }
  if (request.tint) {
    baseColor = tintTowards(baseColor, request.tint, clamp01(request.tintStrength ?? 0.45));
    detailColor = tintTowards(detailColor, request.tint, clamp01((request.tintStrength ?? 0.45) * 0.6));
  }

  return {
    baseColor,
    detailColor,
    roughness: clamp01(family.roughness + weathering * 0.08 + rng.range(-0.03, 0.03)),
    metalness: clamp01(family.metalness - weathering * 0.25),
    emissive: request.emissive,
    emissiveIntensity: request.emissiveIntensity,
    opacity: family.opacity,
    pattern: family.pattern,
    patternScale: (request.scale ?? 1) * family.scale,
    patternStrength: clamp01(family.strength + weathering * 0.2),
    jitter: family.jitter,
  };
}

/** Stable content hash so identical materials are reused, not duplicated (§96). */
export function materialHash(definition: MaterialDefinition): string {
  return `mat_${hashString(JSON.stringify(definition)).toString(36)}`;
}

export function materialAsset(name: string, request: MaterialRequest): AssetRecord {
  const definition = generateMaterial(request);
  const hash = materialHash(definition);
  return {
    id: `material-${hash}`,
    name,
    type: "material",
    source: "procedural",
    hash,
    definition: definition as unknown as Record<string, unknown>,
    metadata: { family: request.family, weathering: request.weathering ?? 0 },
    provenance: {
      origin: "procedural",
      license: "Generated by Clyra Game Maker — no third-party rights",
      generator: "material/v1",
      seed: request.seed ?? hashString(request.family),
      generatedAt: Date.now(),
      commercialUseAllowed: true,
    },
  };
}

/** A coherent project palette derived from an art-style name (spec §198). */
export function paletteForStyle(style: string, seed: number): Record<string, MaterialFamily> {
  const lower = style.toLowerCase();
  if (/sci|neon|cyber|space|futur/.test(lower)) {
    return { wall: "metal", floor: "metal", roof: "iron", trim: "iron", ground: "rock", accent: "glass" };
  }
  if (/desert|sand|dune|egypt/.test(lower)) {
    return { wall: "plaster", floor: "sand", roof: "clay_tiles", trim: "wood", ground: "sand", accent: "fabric" };
  }
  if (/snow|ice|arctic|winter/.test(lower)) {
    return { wall: "stone", floor: "snow", roof: "snow", trim: "dark_wood", ground: "snow", accent: "glass" };
  }
  if (/horror|ruin|abandon|dark|gothic/.test(lower)) {
    return { wall: "weathered_stone", floor: "mud", roof: "dark_wood", trim: "iron", ground: "mud", accent: "fabric" };
  }
  // Medieval/fantasy default; the seed only varies the accent so a project
  // keeps one identity across regenerations.
  const accents: MaterialFamily[] = ["fabric", "gold", "iron"];
  return {
    wall: "plaster",
    floor: "stone",
    roof: "clay_tiles",
    trim: "dark_wood",
    ground: "grass",
    accent: new Rng(seed).pick(accents),
  };
}
