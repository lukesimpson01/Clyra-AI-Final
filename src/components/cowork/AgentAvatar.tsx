import type { CSSProperties } from "react";

export const AGENT_SWATCHES: ReadonlyArray<readonly [string, string]> = [
  ["encre", "0A0A0C"], ["brun", "8B5E3C"], ["rouge", "E8483F"], ["orange", "F08A24"], ["ambre", "F0B429"], ["vert", "3ECF8E"],
  ["turquoise", "2FBFA0"], ["bleu", "3B93F0"], ["violet", "8B5CF6"], ["rose", "E152B0"], ["gris", "A3A3A3"], ["creme", "F1EFE9"],
];

export type AgentShape = "cercle" | "galet" | "squircle" | "capsule" | "triangle" | "hexagone" | "nuage" | "goutte";

export const AGENT_SHAPES: ReadonlyArray<readonly [AgentShape, string, string]> = [
  ["cercle", "c", "Circle"], ["galet", "p", "Pebble"], ["squircle", "s", "Squircle"], ["capsule", "a", "Capsule"],
  ["triangle", "t", "Triangle"], ["hexagone", "h", "Hexagon"], ["nuage", "u", "Cloud"], ["goutte", "d", "Drop"],
];

const SHAPE_CODE = Object.fromEntries(AGENT_SHAPES.map(([s, c]) => [s, c])) as Record<AgentShape, string>;
const SHAPE_FROM_CODE = Object.fromEntries(AGENT_SHAPES.map(([s, c]) => [c, s])) as Record<string, AgentShape>;

/** Packs a 6-digit hex color and shape into the 16-char `Bot.avatar` field, e.g. "3B93F0c". */
export function encodeAgentAvatar(hex: string, shape: AgentShape): string {
  return `${hex.replace("#", "").toUpperCase()}${SHAPE_CODE[shape]}`;
}

function hashSwatch(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AGENT_SWATCHES[hash % AGENT_SWATCHES.length][1];
}

export function decodeAgentAvatar(avatar: string, seed: string): { hex: string; shape: AgentShape; glyph: string | null } {
  const match = /^([0-9a-fA-F]{6})([cpsathud])$/.exec(avatar || "");
  if (match) return { hex: match[1].toUpperCase(), shape: SHAPE_FROM_CODE[match[2]], glyph: null };
  return { hex: hashSwatch(seed), shape: "cercle", glyph: avatar || null };
}

function shapeStyle(shape: AgentShape): CSSProperties {
  switch (shape) {
    case "galet": return { borderRadius: "46% 54% 48% 52% / 52% 46% 54% 48%" };
    case "squircle": return { borderRadius: "30%" };
    case "capsule": return { borderRadius: 999, transform: "scaleY(0.7)" };
    case "triangle": return { clipPath: "polygon(50% 6%, 96% 92%, 4% 92%)" };
    case "hexagone": return { clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)" };
    case "nuage": return { borderRadius: "50% 50% 46% 46% / 60% 60% 40% 40%" };
    case "goutte": return { borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%" };
    default: return { borderRadius: "50%" };
  }
}

export function AgentAvatar({ avatar, seed, size = 32, busy = false }: { avatar: string; seed: string; size?: number; busy?: boolean }) {
  const { hex, shape, glyph } = decodeAgentAvatar(avatar, seed);
  const eyeW = Math.max(2, Math.round(size * 0.12));
  const eyeH = Math.max(4, Math.round(size * 0.26));
  return (
    <div className={`cw-avatar${busy ? " is-busy" : ""}`} style={{ width: size, height: size, flex: `0 0 ${size}px` }}>
      <div className="cw-avatar__body" style={{ background: `#${hex}`, ...shapeStyle(shape) }}>
        {glyph ? (
          <span style={{ fontSize: size * 0.5, lineHeight: 1, color: "#fff" }}>{glyph}</span>
        ) : (
          <div className="cw-avatar__eyes" style={{ gap: Math.round(size * 0.18) }}>
            <span style={{ width: eyeW, height: eyeH }} />
            <span style={{ width: eyeW, height: eyeH }} />
          </div>
        )}
      </div>
    </div>
  );
}
