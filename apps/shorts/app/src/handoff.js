/* One thing handed from a tool to another: the brainstormer opens Fake Text with a script in it, or the AI clipper with a
   link and a moment typed. It lives in sessionStorage for a few minutes and is cleared by the screen that uses it. */
const KEY = 'shorts-handoff', TTL = 10 * 60 * 1000;

export function putHandoff(kind, payload) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ kind, payload, at: Date.now() })); } catch { /* storage is off: the tool just opens empty */ }
}
/** What was handed to `kind`, or null. Reading does not clear it (a screen may mount twice); `clearHandoff` does. */
export function peekHandoff(kind) {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value && value.kind === kind && Date.now() - value.at < TTL ? value.payload : null;
  } catch { return null; }
}
export function clearHandoff() { try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ } }
