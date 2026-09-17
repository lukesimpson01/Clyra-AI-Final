/**
 * Google Workspace OAuth for the web/browser surface — Authorization Code +
 * PKCE, the same public-client pattern as the Electron desktop app's flow in
 * electron/google-workspace-manager.mjs (mirrors its scopes/endpoints).
 * PKCE means no client secret is required — only a Client ID from Google
 * Cloud Console (Desktop app / installed-app OAuth client type). If a
 * secret is later configured too, it's included, but it's optional.
 * The user clicks "Sign in" in Clyra, a new browser tab opens to Google's
 * real consent screen, and Clyra polls `/api/google/status` until the
 * callback below has stored tokens.
 */
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import crypto from "node:crypto";
import { clyraDataPath } from "../runtime-paths";

const SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents", "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/contacts.readonly",
].join(" ");

const ATTEMPT_TTL_MS = 10 * 60_000;
const tokenPath = () => clyraDataPath("data", "google-web-tokens.json");

type StoredTokens = {
  access_token?: string;
  refresh_token?: string;
  email?: string;
  expires_at?: number;
};

type PendingAttempt = { state: string; codeVerifier: string; redirectUri: string; createdAt: number };

// Single-process in-memory pending-attempt store — this is a local dev
// server, not a multi-instance deployment, so this is sufficient (mirrors
// the Electron manager's single in-flight `authAttempt`).
let pendingAttempt: PendingAttempt | null = null;

function clientId() {
  return process.env.CLYRA_GOOGLE_CLIENT_ID || "";
}
function clientSecret() {
  return process.env.CLYRA_GOOGLE_CLIENT_SECRET || "";
}
const base64url = (buf: Buffer) => buf.toString("base64url");

/** Only a Client ID is required (public-client PKCE); a secret is optional. */
export function isGoogleWebOAuthConfigured() {
  return Boolean(clientId());
}

async function readTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await fs.readFile(tokenPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeTokens(tokens: StoredTokens) {
  const target = tokenPath();
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(tokens), "utf8");
}

export async function clearGoogleWebTokens() {
  await fs.unlink(tokenPath()).catch(() => undefined);
}

export async function getGoogleWebStatus(): Promise<{ connected: boolean; email?: string }> {
  const tokens = await readTokens();
  return { connected: Boolean(tokens?.refresh_token || tokens?.access_token), email: tokens?.email };
}

/** Builds the redirect_uri from the incoming request so this works whether
 *  Clyra is reached at localhost:3000, a LAN address, or a real domain. */
function redirectUriFor(req: { protocol: string; get: (name: string) => string | undefined }) {
  const host = req.get("host") || "localhost:3000";
  return `${req.protocol}://${host}/api/google/oauth/callback`;
}

/** Shared token-request body: includes client_secret only when configured,
 *  since PKCE (code_verifier/code_challenge) makes it optional. */
function tokenForm(values: Record<string, string>) {
  const secret = clientSecret();
  return new URLSearchParams({ client_id: clientId(), ...(secret ? { client_secret: secret } : {}), ...values });
}

export function buildGoogleAuthUrl(req: { protocol: string; get: (name: string) => string | undefined }) {
  const state = base64url(crypto.randomBytes(24));
  const codeVerifier = base64url(crypto.randomBytes(64));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  const redirectUri = redirectUriFor(req);
  pendingAttempt = { state, codeVerifier, redirectUri, createdAt: Date.now() };
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return auth.toString();
}

const successPage = `<!doctype html><title>Google connected to Clyra</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f8fafc;color:#162033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(340px,calc(100% - 48px));padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;box-shadow:0 20px 50px #0f172a18;text-align:center}h1{margin:14px 0 7px;font-size:21px}p{margin:0;color:#64748b;line-height:1.55;font-size:14px}.logo{width:42px;height:42px;object-fit:contain}</style><main class="card"><img class="logo" src="https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png" alt="Google"><h1>Google is connected</h1><p>You can close this tab and return to Clyra.</p></main><script>setTimeout(()=>{try{window.close();}catch(e){}}, 1200);</script>`;
const errorPage = (message: string) => `<!doctype html><title>Google connection failed</title><body style="font-family:-apple-system,sans-serif;padding:42px;color:#172033"><h2>Google could not be connected</h2><p>${message}</p><p>Close this tab and try again in Clyra.</p></body>`;

export async function handleGoogleOAuthCallback(params: {
  code?: string;
  state?: string;
  error?: string;
}): Promise<{ status: number; html: string }> {
  const attempt = pendingAttempt;
  if (!attempt || Date.now() - attempt.createdAt > ATTEMPT_TTL_MS) {
    return { status: 410, html: errorPage("This sign-in attempt has expired. Return to Clyra and try again.") };
  }
  if (params.error) {
    pendingAttempt = null;
    return { status: 400, html: errorPage(`Google sign-in failed (${params.error}).`) };
  }
  const stateBuf = Buffer.from(String(params.state || ""));
  const expectedBuf = Buffer.from(attempt.state);
  const stateOk = stateBuf.length === expectedBuf.length && crypto.timingSafeEqual(stateBuf, expectedBuf);
  if (!stateOk) {
    pendingAttempt = null;
    return { status: 400, html: errorPage("Google sign-in could not be verified. Return to Clyra and try again.") };
  }
  if (!params.code) {
    pendingAttempt = null;
    return { status: 400, html: errorPage("Google sign-in did not return an authorization code.") };
  }
  try {
    const exchange = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenForm({
        code: params.code,
        code_verifier: attempt.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: attempt.redirectUri,
      }),
    });
    const tokens = await exchange.json();
    if (!exchange.ok || !tokens?.access_token) {
      throw new Error(tokens?.error_description || tokens?.error || "Token exchange failed.");
    }
    const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((res) => (res.ok ? res.json() : {})).catch(() => ({}));
    await writeTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      email: profile.email || "",
      expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    });
    pendingAttempt = null;
    return { status: 200, html: successPage };
  } catch (error) {
    pendingAttempt = null;
    return { status: 500, html: errorPage(error instanceof Error ? error.message : "Token exchange failed.") };
  }
}

/** Returns a valid access token, refreshing if needed — for future Gmail/
 *  Drive/Docs API calls from the web surface (not wired to a feature yet;
 *  Workspace actions on the web still route through the Electron desktop
 *  bridge per server.ts's existing comments). */
export async function getGoogleWebAccessToken(): Promise<string> {
  const tokens = await readTokens();
  if (!tokens) throw new Error("Connect Google to continue.");
  if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now() + 45_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Reconnect Google to continue.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error(refreshed?.error_description || "Token refresh failed.");
  const next = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 };
  await writeTokens(next);
  return next.access_token as string;
}
