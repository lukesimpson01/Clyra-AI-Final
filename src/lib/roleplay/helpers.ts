import type { RoleplayCharacter } from "./types";

/**
 * Small set of muted, neutral monogram tones for characters without an
 * avatar yet - deliberately desaturated (no candy gradients/neon) so a
 * library full of placeholders still reads as calm and premium rather than
 * like a generic avatar-generator grid.
 */
const MONOGRAM_TONES = [
  { bg: "#eeeeec", fg: "#57534e", ambient: "176, 124, 78" },
  { bg: "#e7e9ec", fg: "#3f4a5a", ambient: "78, 106, 152" },
  { bg: "#ece7e2", fg: "#6b5f52", ambient: "150, 118, 88" },
  { bg: "#e5e7eb", fg: "#374151", ambient: "88, 100, 124" },
  { bg: "#eae7f0", fg: "#5b5570", ambient: "118, 100, 152" },
  { bg: "#e2e8e6", fg: "#3f5750", ambient: "62, 112, 82" },
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

export function characterInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function monogramTone(seed: string): { bg: string; fg: string; ambient: string } {
  return MONOGRAM_TONES[hashString(seed) % MONOGRAM_TONES.length];
}

/**
 * The barely-there colour a character brings to the surfaces around them.
 *
 * Deliberately in the 4-6% range: the point is that a Western feels warmer
 * than a sci-fi station without anyone consciously seeing a colour filter.
 * Anything stronger and every screen becomes a tinted theme, which is exactly
 * the generic look this is meant to avoid.
 */
export function characterAmbient(seed: string, alpha = 0.05): string {
  return `rgba(${monogramTone(seed).ambient}, ${alpha})`;
}

/** Best-effort "world"/fandom label for a character, derived from their tags. */
export function characterWorld(character: Pick<RoleplayCharacter, "tags">): string {
  const tag = character.tags.find((t) => t.trim());
  if (!tag) return "Original character";
  return tag.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minute = 60_000, hour = 3_600_000, day = 86_400_000, week = day * 7;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < week) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
