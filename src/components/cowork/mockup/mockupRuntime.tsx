import type { CSSProperties } from "react";
import { AgentAvatar, AGENT_SWATCHES, encodeAgentAvatar, type AgentShape } from "../AgentAvatar";

export function css(value: string | CSSProperties | null | undefined): CSSProperties {
  if (!value) return {};
  if (typeof value !== "string") return value;
  const out: Record<string, string> = {};
  for (const part of value.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const prop = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!prop || !val) continue;
    if (prop.startsWith("--")) {
      out[prop] = val;
      continue;
    }
    out[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = val;
  }
  return out as CSSProperties;
}

const HEX_BY_NAME = new Map(AGENT_SWATCHES.map(([name, hex]) => [name, hex] as const));

export function MockBloub({ shape, color, size, busy }: { shape: string; color: string; size: string | number; busy: string | boolean }) {
  const hex = HEX_BY_NAME.get(color) ?? HEX_BY_NAME.get("gris") ?? "A3A3A3";
  const px = Number(size) || 32;
  const avatar = encodeAgentAvatar(hex, shape as AgentShape);
  return <AgentAvatar avatar={avatar} seed={color} size={px} busy={busy === true || busy === "true"} />;
}

export function MockViewport({ mode, style }: { mode?: string; cursors?: string; style?: string }) {
  return (
    <div className="mk-viewport" style={css(style)} data-mode={mode}>
      <div className="mk-viewport__label">{mode === "completed" ? "Finished" : mode === "idle" || !mode ? "No browser session" : "Browser session"}</div>
    </div>
  );
}
