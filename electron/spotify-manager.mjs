import crypto from "node:crypto";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { safeStorage, shell } from "electron";

const AUTH_TIMEOUT_MS = 10 * 60_000;
const SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-library-modify",
  "user-follow-modify",
].join(" ");

const base64url = (value) => Buffer.from(value).toString("base64url");
const successPage = `<!doctype html><title>Spotify connected to Clyra</title><style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f8fafc;color:#162033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{width:min(340px,calc(100% - 48px));padding:32px;border:1px solid #e2e8f0;border-radius:24px;background:#fff;box-shadow:0 20px 50px #0f172a18;text-align:center}.logo{width:42px;height:42px;border-radius:50%}h1{margin:14px 0 7px;font-size:21px}p{margin:0;color:#64748b;line-height:1.55;font-size:14px}</style><main class="card"><svg class="logo" viewBox="0 0 24 24" fill="#1DB954"><circle cx="12" cy="12" r="12"/><path d="M17.2 16.6c-.2.3-.6.4-.9.2-2.5-1.5-5.6-1.9-9.3-1-.4.1-.7-.1-.8-.5-.1-.4.1-.7.5-.8 4-.9 7.5-.5 10.3 1.2.3.2.4.6.2.9zm1.2-2.7c-.3.4-.8.5-1.1.3-2.9-1.8-7.3-2.3-10.7-1.3-.4.1-.9-.1-1-.5-.1-.4.1-.9.5-1 3.9-1.2 8.7-.6 12 1.4.4.2.5.8.3 1.1zm.1-2.8C15.3 8.9 9.6 8.7 6.3 9.7c-.5.1-1-.2-1.1-.6-.1-.5.2-1 .6-1.1 3.8-1.2 10.1-.9 14 1.4.4.3.6.9.3 1.3-.3.4-.9.5-1.3.3z"/></svg><h1>Spotify is connected</h1><p>Return to Clyra — your music controls are ready.</p></main>`;

function sameSecret(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function safeFailure(stage, status, errorCode) {
  const suffix = errorCode ? `, ${errorCode}` : "";
  const error = new Error(`${stage} failed (HTTP ${status}${suffix}).`);
  error.stage = stage;
  error.httpStatus = status;
  error.errorCode = errorCode || "unknown_error";
  return error;
}

/**
 * Spotify Authorization Code + PKCE flow for Clyra's Electron desktop app.
 *
 * Only a Client ID is ever configured (by the Clyra developer, via the local
 * ignored .env file) — normal users never see or enter any Spotify
 * credential. There is no Client Secret anywhere in this file or in the
 * renderer: PKCE (RFC 7636) is designed for exactly this — a public,
 * secret-less client proves it owns the authorization request with a
 * random `code_verifier` / `S256 code_challenge` pair instead.
 *
 * Access/refresh tokens are encrypted at rest with Electron's `safeStorage`
 * (backed by the OS keychain — Keychain on macOS, DPAPI on Windows, libsecret
 * on Linux) and never leave the main process.
 */
export class SpotifyManager {
  constructor({ tokenPath, uiContents, development = false, clientId, redirectPort }) {
    this.tokenPath = tokenPath;
    this.uiContents = uiContents;
    // Provided solely by Electron main from its ignored .env / .env.local.
    // Never returned to the renderer, included in IPC, or logged.
    this.clientId = clientId || "";
    this.redirectPort = Number(redirectPort) || 8892;
    this.development = development;
    this.authServer = null;
    this.authAttempt = null;
    this.authTimeout = null;
  }

  log(stage, detail = {}) {
    if (this.development) console.info("[spotify-oauth]", stage, detail);
  }

  emit(payload) {
    const contents = this.uiContents?.();
    if (contents && !contents.isDestroyed()) contents.send("spotify:auth-state", payload);
  }

  async readTokens() {
    try {
      const raw = await fs.readFile(this.tokenPath);
      if (!safeStorage.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(raw));
    } catch {
      return null;
    }
  }

  async writeTokens(tokens) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable on this device.");
    await fs.mkdir(dirname(this.tokenPath), { recursive: true });
    await fs.writeFile(this.tokenPath, safeStorage.encryptString(JSON.stringify(tokens)));
  }

  async status() {
    const tokens = await this.readTokens();
    return { connected: Boolean(tokens?.refresh_token || tokens?.access_token), profile: tokens?.profile || null };
  }

  async disconnect() {
    await fs.unlink(this.tokenPath).catch(() => undefined);
    this.emit({ connected: false });
    return { ok: true };
  }

  tokenForm(values) {
    // PKCE token requests authenticate with `client_id` + `code_verifier` /
    // `refresh_token` only — deliberately no `client_secret` field exists.
    return new URLSearchParams({ client_id: this.clientId, ...values });
  }

  async parseTokenResponse(response, stage) {
    const raw = await response.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* The response is intentionally never logged. */
    }
    const errorCode = String(body?.error || "unknown_error");
    this.log(stage, { httpStatus: response.status, ok: response.ok, ...(response.ok ? {} : { errorCode }) });
    if (!response.ok) throw safeFailure(stage, response.status, errorCode);
    return body;
  }

  async accessToken(forceRefresh = false) {
    const tokens = await this.readTokens();
    if (!tokens) throw Object.assign(new Error("Connect Spotify to continue."), { code: "SPOTIFY_SIGN_IN_REQUIRED" });
    if (!forceRefresh && tokens.access_token && Number(tokens.expires_at || 0) > Date.now() + 45_000) return tokens.access_token;
    if (!tokens.refresh_token) throw Object.assign(new Error("Reconnect Spotify to continue."), { code: "SPOTIFY_SIGN_IN_REQUIRED" });
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: this.tokenForm({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    });
    let refreshed;
    try {
      refreshed = await this.parseTokenResponse(response, "token-refresh");
    } catch (error) {
      await this.disconnect();
      throw Object.assign(error, { code: "SPOTIFY_SIGN_IN_REQUIRED" });
    }
    const next = {
      ...tokens,
      ...refreshed,
      // Spotify only returns a new refresh_token sometimes; keep the old one otherwise.
      refresh_token: refreshed.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    };
    await this.writeTokens(next);
    return next.access_token;
  }

  async signIn() {
    if (this.authAttempt) return { ok: true, pending: true };
    if (!this.clientId) return { ok: false, error: "Spotify is not configured (CLYRA_SPOTIFY_CLIENT_ID is missing)." };
    const state = base64url(crypto.randomBytes(32));
    const codeVerifier = base64url(crypto.randomBytes(64));
    const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
    this.log("attempt-created", { pkceReady: true });
    const redirectUri = `http://127.0.0.1:${this.redirectPort}/callback`;
    this.authServer = createServer((request, response) => {
      void this.handleCallback(request, response);
    });
    try {
      await new Promise((resolve, reject) => {
        this.authServer.once("error", reject);
        this.authServer.listen(this.redirectPort, "127.0.0.1", resolve);
      });
      // Store exactly one immutable attempt. The callback never generates
      // state, verifier, challenge, or redirect URI.
      this.authAttempt = { state, codeVerifier, redirectUri, handled: false, exchanging: false };
      this.log("callback-listening", { redirectUri });
      const auth = new URL("https://accounts.spotify.com/authorize");
      auth.search = new URLSearchParams({
        client_id: this.clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: SCOPES,
        state,
        code_challenge_method: "S256",
        code_challenge: codeChallenge,
      }).toString();
      await this.openExternalAuth(auth.toString());
      this.authTimeout = setTimeout(() => {
        this.log("attempt-timeout");
        this.emit({ connected: false, error: "Spotify sign-in timed out. Please try again." });
        this.cleanupAuth();
      }, AUTH_TIMEOUT_MS);
      this.emit({ connected: false, pending: true });
      return { ok: true, pending: true };
    } catch {
      this.log("attempt-start-failed");
      this.cleanupAuth();
      return { ok: false, error: "Spotify sign-in could not start." };
    }
  }

  async openExternalAuth(url) {
    // Opened in the user's normal browser, preserving any existing Spotify
    // session, passkeys, and password-manager integrations.
    await shell.openExternal(url);
    this.log("system-browser-opened");
  }

  async handleCallback(request, response) {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const attempt = this.authAttempt;
    this.log("callback-received", {
      callbackPath: url.pathname === "/callback",
      hasCode: Boolean(url.searchParams.get("code")),
      hasState: Boolean(url.searchParams.get("state")),
      hasError: Boolean(url.searchParams.get("error")),
    });
    if (url.pathname !== "/callback") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    if (!attempt) {
      response.writeHead(410);
      response.end("This sign-in attempt has expired. Return to Clyra and try again.");
      return;
    }
    if (attempt.handled || attempt.exchanging) {
      this.log("callback-ignored-duplicate");
      response.writeHead(409);
      response.end("This Spotify sign-in callback has already been handled. Return to Clyra.");
      return;
    }
    const returnedState = url.searchParams.get("state");
    if (!sameSecret(returnedState, attempt.state)) {
      this.log("callback-state-mismatch", { returnedStatePresent: Boolean(returnedState) });
      response.writeHead(400);
      response.end("Spotify sign-in could not be verified. Return to Clyra and try again.");
      this.emit({ connected: false, error: "Spotify sign-in could not be verified." });
      this.cleanupAuth();
      return;
    }
    this.log("callback-state-verified");
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      this.log("callback-oauth-error", { errorCode: oauthError });
      response.writeHead(400);
      response.end(`Spotify sign-in failed (${oauthError}). Return to Clyra and try again.`);
      this.emit({ connected: false, error: `Spotify sign-in failed (${oauthError}).` });
      this.cleanupAuth();
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      this.log("callback-missing-code");
      response.writeHead(400);
      response.end("Spotify sign-in did not return an authorization code. Return to Clyra and try again.");
      this.emit({ connected: false, error: "Spotify sign-in did not return an authorization code." });
      this.cleanupAuth();
      return;
    }
    attempt.handled = true;
    attempt.exchanging = true;
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
      this.authTimeout = null;
    }
    try {
      this.log("token-exchange-started");
      const exchange = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: this.tokenForm({
          grant_type: "authorization_code",
          code,
          redirect_uri: attempt.redirectUri,
          code_verifier: attempt.codeVerifier,
        }),
      });
      const tokens = await this.parseTokenResponse(exchange, "token-exchange");
      if (!tokens?.refresh_token) throw new Error("Spotify did not return a refresh token. Reconnect and approve access again.");
      const profileResponse = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profileBody = profileResponse.ok ? await profileResponse.json().catch(() => ({})) : {};
      const profile = {
        id: profileBody.id || "",
        displayName: profileBody.display_name || "",
        email: profileBody.email || "",
        image: profileBody.images?.[0]?.url || "",
        product: profileBody.product || "",
      };
      await this.writeTokens({ ...tokens, profile, expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000 });
      this.log("tokens-stored", { refreshTokenStored: true, accessTokenStored: Boolean(tokens.access_token) });
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(successPage);
      this.emit({ connected: true, profile });
      setTimeout(() => this.cleanupAuth(), 1_200);
    } catch (error) {
      const safeError = error?.stage ? error.message : "Secure token storage failed.";
      this.log("callback-failed", error?.stage ? { stage: error.stage, httpStatus: error.httpStatus, errorCode: error.errorCode } : { stage: "secure-storage" });
      response.writeHead(500, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><title>Spotify connection failed</title><body style="font-family:-apple-system;padding:42px;color:#172033"><h2>Spotify could not be connected</h2><p>${safeError}</p><p>Return to Clyra and try again.</p></body>`);
      this.emit({ connected: false, error: safeError });
      this.cleanupAuth();
    }
  }

  cleanupAuth() {
    if (this.authTimeout) clearTimeout(this.authTimeout);
    this.authTimeout = null;
    const server = this.authServer;
    this.authServer = null;
    this.authAttempt = null;
    try {
      server?.close();
    } catch {
      /* already stopped */
    }
    this.log("attempt-cleaned-up");
  }

  finishAuth() {
    this.cleanupAuth();
  }

  /** Authenticated Spotify Web API request. `expectEmpty` accepts the 204
   *  No Content responses most playback-control endpoints return. */
  async api(path, options = {}, stage = "spotify-api", { expectEmpty = false } = {}) {
    const url = /^https:\/\//.test(path) ? path : `https://api.spotify.com/v1${path}`;
    const request = async (forceRefresh = false) => fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${await this.accessToken(forceRefresh)}`, "content-type": "application/json", ...(options.headers || {}) },
    });
    let response = await request();
    // An access token can be revoked remotely before its local expiry. Refresh
    // once and replay this idempotent/authenticated request before surfacing a
    // sign-in failure; never loop indefinitely on a bad credential.
    if (response.status === 401) response = await request(true);
    // Respect Spotify's explicit rate-limit window. One bounded retry is much
    // kinder than a tight renderer retry loop and preserves useful errors when
    // an account remains rate limited.
    if (response.status === 429) {
      const retrySeconds = Math.max(0, Math.min(30, Number(response.headers.get("retry-after")) || 1));
      await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
      response = await request();
    }
    if (response.status === 204 || response.status === 202) {
      this.log(stage, { httpStatus: response.status, ok: true });
      return null;
    }
    if (response.status === 404 && expectEmpty) {
      this.log(stage, { httpStatus: response.status, ok: true });
      return null;
    }
    const raw = await response.text();
    let body = {};
    let parseFailed = false;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      // Some Spotify error responses (e.g. account-eligibility rejections)
      // are plain text, not JSON — surface that text instead of discarding it.
      parseFailed = true;
    }
    // Spotify's Web API error shape is `{ error: { status, message, reason? } }`
    // (reason only appears on player 403s) — prefer the human message.
    const errorCode = String(
      body?.error?.reason || body?.error?.message || (parseFailed ? raw.slice(0, 200) : "") || body?.error?.status || "unknown_error",
    );
    this.log(stage, { httpStatus: response.status, ok: response.ok, ...(response.ok ? {} : { errorCode }) });
    if (!response.ok) throw safeFailure(stage, response.status, errorCode);
    return body;
  }

  async getProfile() {
    return this.api("/me", {}, "spotify-profile");
  }

  async getPlaylists() {
    const body = await this.api("/me/playlists?limit=50", {}, "spotify-playlists");
    return Array.isArray(body?.items) ? body.items : [];
  }

  /**
   * Full item list for a single playlist (the playlist detail page).
   *
   * Spotify's `/tracks` route is legacy and returns 403 for this app/account
   * combination even though the same token can list the user's playlists.
   * `/items` is its current replacement and preserves the `track` shape the
   * renderer already consumes.
   */
  async getPlaylistTracks(playlistId) {
    const id = String(playlistId || "").trim();
    if (!id) throw Object.assign(new Error("A playlist id is required."), { code: "SPOTIFY_INVALID_QUERY" });
    const items = [];
    let offset = 0;
    // Spotify caps the current endpoint at 50. Follow its `next` cursor so a
    // playlist detail view is complete rather than silently stopping at its
    // first page.
    while (true) {
      const body = await this.api(
        `/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`,
        {},
        "spotify-playlist-items",
      );
      const page = Array.isArray(body?.items) ? body.items : [];
      items.push(...page);
      if (!body?.next || page.length === 0) break;
      offset += page.length;
    }
    // The modern `/items` response calls the playable entry `item`; older
    // Spotify responses called it `track`. Keep the fallback for saved or
    // cached responses while normalizing both shapes for the renderer.
    return items
      .map((entry) => ({ addedAt: entry?.added_at || "", track: entry?.item ?? entry?.track }))
      .filter(({ track }) => track?.type === "track" && track.id && track.uri);
  }

  async getDevices() {
    const body = await this.api("/me/player/devices", {}, "spotify-devices");
    return Array.isArray(body?.devices) ? body.devices : [];
  }

  /** Spotify Web API search — used to resolve a natural-language chat
   *  request ("play X", "play something trending") into a real track or
   *  playlist URI before handing it to control(). */
  async search(query, types = "track", limit = 5) {
    const q = String(query || "").trim().slice(0, 200);
    if (!q) throw Object.assign(new Error("A search query is required."), { code: "SPOTIFY_INVALID_QUERY" });
    const type = String(types || "track").slice(0, 40);
    // Spotify's documented range is 1-50, but this account/app combination
    // 400s ("Invalid limit") above 10 — clamp to what's actually allowed
    // rather than the documented ceiling.
    const body = await this.api(
      `/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${Math.max(1, Math.min(10, Number(limit) || 5))}`,
      {},
      "spotify-search",
    );
    return {
      tracks: Array.isArray(body?.tracks?.items) ? body.tracks.items : [],
      playlists: Array.isArray(body?.playlists?.items) ? body.playlists.items.filter(Boolean) : [],
    };
  }

  /** Full playback state — track, progress, device, volume, shuffle, repeat. */
  async getPlaybackState() {
    return this.api("/me/player", {}, "spotify-playback-state", { expectEmpty: true });
  }

  /** Currently playing track plus the real up-next queue. */
  async getQueue() {
    return this.api("/me/player/queue", {}, "spotify-queue", { expectEmpty: true });
  }

  async getRecentlyPlayed() {
    const body = await this.api("/me/player/recently-played?limit=20", {}, "spotify-recently-played");
    return (Array.isArray(body?.items) ? body.items : []).map((entry) => entry?.track ?? entry?.item).filter((item) => item?.type === "track" && item.id && item.uri);
  }

  async getSavedTracks() {
    const body = await this.api("/me/tracks?limit=50", {}, "spotify-saved-tracks");
    return (Array.isArray(body?.items) ? body.items : []).map((entry) => entry?.item ?? entry?.track).filter((item) => item?.type === "track" && item.id && item.uri);
  }

  normalizeUris(uris) {
    const clean = [...new Set((Array.isArray(uris) ? uris : []).map((uri) => String(uri || "").trim()).filter((uri) => /^spotify:(track|album|episode|show|audiobook|user|playlist):/.test(uri)))];
    if (!clean.length) throw Object.assign(new Error("At least one valid Spotify URI is required."), { code: "SPOTIFY_INVALID_QUERY" });
    return clean.slice(0, 40);
  }

  async libraryContains(uris) {
    const clean = this.normalizeUris(uris);
    const body = await this.api(`/me/library/contains?uris=${encodeURIComponent(clean.join(","))}`, {}, "spotify-library-contains");
    return Array.isArray(body) ? body.map(Boolean) : Array.isArray(body?.contains) ? body.contains.map(Boolean) : [];
  }

  async saveLibrary(uris) {
    const clean = this.normalizeUris(uris);
    return this.api(`/me/library?uris=${encodeURIComponent(clean.join(","))}`, { method: "PUT" }, "spotify-library-save", { expectEmpty: true });
  }

  async removeLibrary(uris) {
    const clean = this.normalizeUris(uris);
    return this.api(`/me/library?uris=${encodeURIComponent(clean.join(","))}`, { method: "DELETE" }, "spotify-library-remove", { expectEmpty: true });
  }

  async control(action, payload = {}) {
    const deviceQuery = payload.deviceId ? `?device_id=${encodeURIComponent(payload.deviceId)}` : "";
    switch (action) {
      case "play":
        return this.api(
          `/me/player/play${deviceQuery}`,
          { method: "PUT", body: JSON.stringify({ ...(payload.contextUri ? { context_uri: payload.contextUri } : {}), ...(payload.uris ? { uris: payload.uris } : {}) }) },
          "spotify-play",
        );
      case "pause":
        return this.api(`/me/player/pause${deviceQuery}`, { method: "PUT" }, "spotify-pause");
      case "next":
        return this.api(`/me/player/next${deviceQuery}`, { method: "POST" }, "spotify-next");
      case "previous":
        return this.api(`/me/player/previous${deviceQuery}`, { method: "POST" }, "spotify-previous");
      case "seek": {
        const ms = Math.max(0, Math.round(Number(payload.positionMs) || 0));
        return this.api(`/me/player/seek?position_ms=${ms}${deviceQuery ? `&device_id=${encodeURIComponent(payload.deviceId)}` : ""}`, { method: "PUT" }, "spotify-seek");
      }
      case "volume": {
        const pct = Math.max(0, Math.min(100, Math.round(Number(payload.volumePercent) || 0)));
        return this.api(`/me/player/volume?volume_percent=${pct}${deviceQuery ? `&device_id=${encodeURIComponent(payload.deviceId)}` : ""}`, { method: "PUT" }, "spotify-volume");
      }
      case "transfer":
        return this.api("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [payload.deviceId], play: Boolean(payload.play) }) }, "spotify-transfer");
      case "shuffle":
        return this.api(`/me/player/shuffle?state=${payload.state ? "true" : "false"}${deviceQuery ? `&device_id=${encodeURIComponent(payload.deviceId)}` : ""}`, { method: "PUT" }, "spotify-shuffle");
      case "repeat": {
        const state = ["off", "track", "context"].includes(payload.state) ? payload.state : "off";
        return this.api(`/me/player/repeat?state=${state}${deviceQuery ? `&device_id=${encodeURIComponent(payload.deviceId)}` : ""}`, { method: "PUT" }, "spotify-repeat");
      }
      case "queue": {
        const uri = String(payload.uri || "").trim();
        if (!/^spotify:(track|episode):/.test(uri)) throw Object.assign(new Error("A track or episode URI is required to add to the queue."), { code: "SPOTIFY_INVALID_QUERY" });
        return this.api(`/me/player/queue?uri=${encodeURIComponent(uri)}${deviceQuery ? `&device_id=${encodeURIComponent(payload.deviceId)}` : ""}`, { method: "POST" }, "spotify-queue-add");
      }
      default:
        throw Object.assign(new Error(`Unsupported Spotify control action: ${action}`), { code: "SPOTIFY_UNSUPPORTED_ACTION" });
    }
  }
}
