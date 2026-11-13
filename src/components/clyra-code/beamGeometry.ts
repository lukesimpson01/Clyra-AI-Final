/** Geometry is in real CSS pixels, so the border highlight never slows at corners. */
export const BEAM_SPEED_PX_PER_SECOND = 245;

export function roundedRectPerimeter(width: number, height: number, cornerRadius = 22): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const radius = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
  return 2 * (width + height - 4 * radius) + 2 * Math.PI * radius;
}

export function beamDurationSeconds(perimeter: number, pixelsPerSecond = BEAM_SPEED_PX_PER_SECOND): number {
  if (!(perimeter > 0) || !(pixelsPerSecond > 0)) return 0;
  return perimeter / pixelsPerSecond;
}
