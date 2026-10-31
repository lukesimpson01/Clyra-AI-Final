// Shared display formatting for the Shorts editor.

/** m:ss.t from milliseconds. Tenths keep the playhead readable while scrubbing. */
export function formatClock(ms: number) {
  const total = Math.max(0, Math.round(ms / 100));
  const minutes = Math.floor(total / 600);
  const seconds = Math.floor((total % 600) / 10);
  const tenths = total % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
