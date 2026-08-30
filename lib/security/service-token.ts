/**
 * Capability-token boundary for the local Clyra service.
 *
 * The Express/WebSocket service binds to loopback only, but any other local
 * process can still reach a loopback port. When Electron launches the
 * service it mints a random per-launch token (CLYRA_SERVICE_TOKEN) and sets
 * it as an httpOnly cookie on the UI origin before loading it, so every
 * same-origin fetch/XHR/WebSocket from the real Clyra window carries it
 * automatically — no per-call-site changes needed across the frontend.
 *
 * Plain `npm run dev:source` (no Electron parent, no token minted) is an
 * explicit, logged exception: it behaves like any other unauthenticated
 * local dev server, matching the trust model of the Vite/Express dev
 * workflow itself.
 */

const COOKIE_NAME = "clyra_token";

export function getExpectedServiceToken(): string | null {
  const token = process.env.CLYRA_SERVICE_TOKEN;
  return token && token.length > 0 ? token : null;
}

export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function requestHasValidServiceToken(cookieHeader: string | undefined | null): boolean {
  const expected = getExpectedServiceToken();
  if (!expected) return true; // no token minted (plain web-dev mode) — see file header
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[COOKIE_NAME] === expected;
}

export { COOKIE_NAME as SERVICE_TOKEN_COOKIE_NAME };
