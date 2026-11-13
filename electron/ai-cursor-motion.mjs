/**
 * Coordinates for AI-controlled browser and desktop input. Every intermediate
 * position is a REAL input destination, not a decorative pointer animation.
 * Fractions are monotonic, never overshoot, and always finish at the target.
 */
export const MOTION_INTERVAL_MS = 16;

export function planCursorMotion(from, to, options = {}) {
  const start = { x: Number(from?.x), y: Number(from?.y) };
  const end = { x: Number(to?.x), y: Number(to?.y) };
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw new TypeError("Cursor coordinates must be finite numbers.");
  }
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const speed = options.speed === "instant" || options.speed === "fast" ? options.speed : "natural";
  const reducedMotion = Boolean(options.reducedMotion);
  const durationMs = reducedMotion || speed === "instant" || distance < 4
    ? 0
    : Math.round(Math.min(speed === "fast" ? 235 : 350, Math.max(speed === "fast" ? 65 : 92, (speed === "fast" ? 54 : 78) + distance * (speed === "fast" ? 0.18 : 0.30))));
  const count = durationMs === 0 ? 1 : Math.min(26, Math.max(2, Math.ceil(durationMs / MOTION_INTERVAL_MS)));
  const frames = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    // Fast acceleration, smooth deceleration. No invented overshoot.
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    frames.push({
      x: Math.round(start.x + (end.x - start.x) * eased),
      y: Math.round(start.y + (end.y - start.y) * eased),
      atMs: Math.round(durationMs * t),
    });
  }
  frames[frames.length - 1] = { x: Math.round(end.x), y: Math.round(end.y), atMs: durationMs };
  return { distance, durationMs, frames };
}

export const isPointerAction = (type) =>
  ["click", "click_at", "double_click", "right_click", "hover", "focus", "check", "uncheck", "select_option", "scroll", "drag"].includes(String(type || ""));
