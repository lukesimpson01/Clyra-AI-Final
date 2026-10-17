const TIMESTAMP = /^\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\](.*)$/;

export function parseLrc(source) {
  return String(source || "")
    .split(/\r?\n/)
    .flatMap((raw) => {
      const match = raw.match(TIMESTAMP);
      if (!match) return [];
      const timeMs = Math.round((Number(match[1]) * 60 + Number(match[2])) * 1000);
      const text = match[3].trim();
      return Number.isFinite(timeMs) && text ? [{ timeMs, text }] : [];
    })
    .sort((left, right) => left.timeMs - right.timeMs);
}

export function normalizeLyricsPayload(payload) {
  const synced = parseLrc(payload?.syncedLyrics);
  if (synced.length) return { synced: true, instrumental: false, lines: synced, source: "LRCLIB" };

  const plain = String(payload?.plainLyrics || "")
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ timeMs: null, text }));

  return {
    synced: false,
    instrumental: Boolean(payload?.instrumental),
    lines: plain,
    source: "LRCLIB",
  };
}
