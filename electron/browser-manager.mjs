import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { dialog, Menu, session, WebContentsView } from "electron";
import { agentChromeScript } from "./agent-chrome-script.mjs";
import { planCursorMotion, isPointerAction } from "./ai-cursor-motion.mjs";

const HOME_URL = "https://www.google.com/";

/* A page that fails to load leaves a WebContentsView completely blank: unlike
   Chrome, Electron draws no error page of its own. This one says what went
   wrong, offers a retry, and reloads by itself when the connection returns. */
const ERROR_PAGE_PREFIX = "data:text/html;charset=utf-8,";
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
function loadErrorPage(url, code, description) {
  const offline = [-106, -21].includes(code);
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } })();
  const title = offline ? "You're offline" : code === -105 ? `Can't find ${host}` : code === -7 || code === -118 ? `${host} took too long to answer` : `Can't reach ${host}`;
  const detail = offline
    ? "This page needs an internet connection. It will load by itself as soon as you're back online."
    : code === -105 ? "Check the address for a typo, or your connection." : "The site may be down, or your connection may have dropped.";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#2c2c2b;--muted:#73726c;--line:rgba(55,53,47,.12);--btn:#2c2c2b;--btn-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#191a1c;--fg:#ececea;--muted:#9b9a96;--line:rgba(255,255,255,.1);--btn:#ececea;--btn-fg:#191a1c}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:420px;padding:32px;text-align:center}.icon{width:48px;height:48px;margin:0 auto 18px;border-radius:14px;display:grid;place-items:center;border:1px solid var(--line);color:var(--muted)}
h1{font-size:20px;font-weight:650;letter-spacing:-.01em;margin:0 0 8px}p{margin:0 0 20px;color:var(--muted)}code{display:block;margin:0 0 22px;font:12px ui-monospace,Menlo,monospace;color:var(--muted);word-break:break-all}
a{display:inline-block;padding:8px 18px;border-radius:999px;background:var(--btn);color:var(--btn-fg);font-weight:600;text-decoration:none}a:hover{opacity:.88}
</style></head><body><main><div class="icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 15.9a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".9" fill="currentColor"/>${offline ? '<path d="M3 3l18 18"/>' : ""}</svg></div>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><code>${escapeHtml(description || "")} · ${escapeHtml(url)}</code><a href="${escapeHtml(url)}">Try again</a></main>
<script>addEventListener("online",()=>{location.href=${JSON.stringify(url).replace(/</g, "\\u003c")}})</script></body></html>`;
  return ERROR_PAGE_PREFIX + encodeURIComponent(html);
}
/* While a tab shows that page, everything else should still see the address that failed. */
const tabUrl = (tab) => {
  const url = tab?.view?.webContents?.getURL() || "";
  return url.startsWith(ERROR_PAGE_PREFIX) && tab.failedUrl ? tab.failedUrl : url;
};
const MAX_TABS = 16;
const HIDDEN_SURFACE_BOUNDS = { x: -20_000, y: -20_000, width: 2, height: 2 };

// Runs *inside* the target page (injected via executeJavaScript, never given
// node/ipc access) to drive Snip Mode entirely with real DOM events, so the
// selection tracks scrolling/zoom/layout exactly like the page itself does.
// Written as a real function and shipped via `.toString()` rather than a
// template-literal string so none of this needs escaping.
function clyraSnipOverlayInjector() {
  if (window.__clyraSnipActive) return Promise.resolve({ cancelled: true });
  window.__clyraSnipActive = true;
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(17,17,20,0.22);cursor:crosshair;user-select:none;";
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;display:none;z-index:2147483647;pointer-events:none;" +
      "border:1.5px solid #2563eb;background:rgba(37,99,235,0.10);border-radius:2px;" +
      "box-shadow:0 0 0 2000px rgba(17,17,20,0.22);";
    // The box itself draws the dim layer via its own giant shadow so the
    // selected region reads as fully undimmed the instant a drag starts,
    // rather than dim overlay + separately-dimmed box fighting each other.
    overlay.style.background = "transparent";
    overlay.setAttribute("data-clyra-snip-overlay", "1");
    box.setAttribute("data-clyra-snip-overlay", "1");
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(box);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    const cleanup = () => {
      window.__clyraSnipActive = false;
      overlay.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey, true);
      overlay.remove();
      box.remove();
    };

    const extractText = (rect) => {
      try {
        const pieces = [];
        const seen = new Set();
        const nodes = document.body ? document.body.querySelectorAll("*") : [];
        for (const el of nodes) {
          if (pieces.length >= 40) break;
          if (el.children && el.children.length > 0) continue; // leaf-ish only
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const overlaps = !(
            r.right < rect.x ||
            r.left > rect.x + rect.width ||
            r.bottom < rect.y ||
            r.top > rect.y + rect.height
          );
          if (!overlaps) continue;
          const text = (el.innerText || el.textContent || "").trim();
          if (text && text.length < 600 && !seen.has(text)) {
            seen.add(text);
            pieces.push(text);
          }
        }
        return pieces.join("\n").slice(0, 4000);
      } catch {
        return "";
      }
    };

    const finish = (cancelled, rect) => {
      cleanup();
      if (cancelled || !rect) {
        resolve({ cancelled: true });
        return;
      }
      resolve({ cancelled: false, rect, text: extractText(rect) });
    };

    function onDown(event) {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0px";
      box.style.height = "0px";
      box.style.display = "block";
      event.preventDefault();
    }
    function onMove(event) {
      if (!dragging) return;
      const x = Math.min(event.clientX, startX);
      const y = Math.min(event.clientY, startY);
      const w = Math.abs(event.clientX - startX);
      const h = Math.abs(event.clientY - startY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    }
    function onUp(event) {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(event.clientX, startX);
      const y = Math.min(event.clientY, startY);
      const w = Math.abs(event.clientX - startX);
      const h = Math.abs(event.clientY - startY);
      if (w < 6 || h < 6) {
        finish(true);
        return;
      }
      finish(false, { x, y, width: w, height: h });
    }
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(true);
      }
    }

    overlay.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

// Removes the overlay from a page without waiting for a selection — used
// when the user switches tabs or closes a tab while Snip Mode is still
// active, so nothing is left listening in the background.
function clyraSnipCancelInjector() {
  window.__clyraSnipActive = false;
  const nodes = document.querySelectorAll("[data-clyra-snip-overlay]");
  nodes.forEach((node) => node.remove());
  return true;
}

function injectionSignals(lines) {
  const patterns = [
    /ignore\s+(?:all\s+)?previous\s+instructions/i,
    /reveal\s+(?:the\s+)?system\s+prompt/i,
    /disregard\s+(?:the\s+)?(?:prior|previous)\s+instructions/i,
  ];
  return [...new Set(lines
    .flatMap((line) => String(line || "").split(/(?:\n+|(?<=[.!?])\s+)/))
    .map((line) => line.trim())
    .filter((line) => line && patterns.some((pattern) => pattern.test(line)))
  )].slice(0, 12);
}

const DEFAULT_SETTINGS = {
  /* Retained so existing stored profiles still parse; the value is no longer
     consulted, because normalizeInput() always searches Google. */
  defaultSearchEngine: "google",
  restoreTabs: true,
  saveHistory: true,
  showBookmarksBar: false,
  showAiCursor: true,
  showAiActionLabels: true,
  aiCursorSpeed: "natural",
  reducedMotion: false,
  performanceMode: "quality",
  privateMode: false,
};

/** Google is the browser's search engine. There is no other. */
function searchUrl(query) {
  return `https://www.google.com/search?q=${encodeURIComponent(String(query).trim())}`;
}

/**
 * The single rule for turning what someone typed into somewhere to go, shared
 * by the address bar, the Go button, agent actions and deep links.
 *
 * The ordering matters. Anything containing whitespace is a search before any
 * domain matching is attempted, so "best laptop 2026" cannot be mistaken for a
 * host just because it has a dot in it somewhere; and a bare TLD-shaped token
 * is only treated as a domain when it ends in a real alphabetic TLD.
 */
function normalizeInput(input) {
  const value = String(input ?? "").trim();
  if (!value || value === "about:blank" || /^(chrome|edge|devtools|chrome-error):/i.test(value)) return HOME_URL;

  // Already absolute — leave it exactly as typed.
  if (/^https?:\/\//i.test(value)) return value;

  // A query is anything with a space in it. This is checked before domain
  // matching so a sentence can never be mistaken for a host.
  if (/\s/.test(value)) return searchUrl(value);

  const loopback = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(value);
  const bareIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(value);
  if (loopback || bareIpv4) return `http://${value}`;

  // "mailto:x", "ftp://y" and friends are not this browser's business, but
  // "localhost:5173" only looks like a scheme — it was handled above.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return searchUrl(value);

  // A domain is labels joined by dots ending in an alphabetic TLD.
  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `https://${value}`;

  return searchUrl(value);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : HOME_URL;
  } catch {
    return HOME_URL;
  }
}

export class ChromiumBrowserManager {
  constructor({ window, uiView, userDataPath, downloadsPath }) {
    this.window = window;
    this.uiView = uiView;
    this.userDataPath = userDataPath;
    this.downloadsPath = downloadsPath;
    this.profilePath = path.join(userDataPath, "chromium-browser.json");
    this.browserSession = session.fromPartition("persist:browser", { cache: true });
    this.tabs = new Map();
    this.pendingSnipCancels = new Map();
    this.activeTabId = null;
    this.closedTabs = [];
    this.history = [];
    this.bookmarks = [];
    this.downloads = [];
    this.settings = { ...DEFAULT_SETTINGS };
    // Keep a useful viewport even before the Browser workspace is visible.
    // Native views can be hidden without being resized to 2px, so CDP/DOM
    // inspection remains meaningful and tab state does not thrash on reopen.
    this.surface = { visible: false, bounds: { x: 0, y: 0, width: 1280, height: 720 } };
    // Preview consumers (Cowork and task views) may ask for a frame while Chromium
    // is intentionally hidden behind another Clyra workspace. Keep the last
    // genuine frame so one slow hidden capture can never make us surface the
    // BrowserView over the active workspace.
    this.lastFrame = null;
    this.frameCapture = null;
    this.frameVersion = 0;
    this.lastFrameVersion = -1;
    this.saveTimer = null;
    this.agent = { status: "idle", paused: false, manualControl: false };
    this.cursor = null;
    this.cursorsByTab = new Map();
    this.cursorSequence = 0;
    this.agentCursorPoint = null;
    // The in-page status pill reports clicks through a console token. A fresh
    // random token per app session keeps it from colliding with page logs.
    this.agentChromeToken = `__clyra_agent_control_${crypto.randomBytes(9).toString("hex")}`;
    this.agentChromeStartedAt = 0;
    this.destroyed = false;
  }

  async initialize() {
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.mkdir(this.downloadsPath, { recursive: true });
    await this.loadProfile();
    this.configureSession();
    const restored = this.settings.restoreTabs && this.lastTabs?.length
      ? this.lastTabs.slice(0, MAX_TABS)
      : [{ url: HOME_URL }];
    for (const saved of restored) await this.createTab(saved.url, { activate: false, persist: false });
    const first = this.tabs.keys().next().value;
    if (first) this.activateTab(first, { persist: false });
    this.emitState();
  }

  configureSession() {
    this.browserSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      const allowedWithoutPrompt = new Set(["clipboard-sanitized-write", "fullscreen"]);
      const blockedWithoutPrompt = new Set([
        "geolocation",
        "notifications",
        "midi",
        "midiSysex",
        "idle-detection",
        "pointerLock",
        "openExternal",
      ]);
      if (allowedWithoutPrompt.has(permission)) {
        callback(true);
        return;
      }
      // Search engines and news sites commonly request these on page load.
      // Blocking them quietly avoids a modal before the user has asked for the
      // capability; camera, microphone, clipboard reads, and screen capture
      // still cross the explicit native confirmation boundary below.
      if (blockedWithoutPrompt.has(permission)) {
        callback(false);
        return;
      }
      const host = (() => {
        try { return new URL(details.requestingUrl || webContents.getURL()).hostname; } catch { return "this site"; }
      })();
      const result = await dialog.showMessageBox(this.window, {
        type: "question",
        buttons: ["Allow", "Block"],
        defaultId: 1,
        cancelId: 1,
        title: "Site permission",
        message: `Allow ${host} to use ${permission.replaceAll("-", " ")}?`,
        detail: "This permission applies only to the Clyra browser session.",
      });
      callback(result.response === 0);
    });

    this.browserSession.on("will-download", (_event, item, webContents) => {
      const id = crypto.randomUUID();
      const filename = item.getFilename();
      const destination = path.join(this.downloadsPath, filename);
      item.setSavePath(destination);
      const download = {
        id,
        filename,
        url: webContents.getURL(),
        status: "running",
        path: destination,
        startedAt: new Date().toISOString(),
      };
      this.downloads.unshift(download);
      this.downloads = this.downloads.slice(0, 100);
      item.on("updated", () => this.emitState());
      item.once("done", (_doneEvent, state) => {
        download.status = state === "completed" ? "complete" : state === "cancelled" ? "cancelled" : "failed";
        this.scheduleSave();
        this.emitState();
      });
      this.emitState();
    });
  }

  async loadProfile() {
    try {
      const profile = JSON.parse(await fs.readFile(this.profilePath, "utf8"));
      this.history = Array.isArray(profile.history) ? profile.history.slice(0, 2000) : [];
      this.bookmarks = Array.isArray(profile.bookmarks) ? profile.bookmarks.slice(0, 500) : [];
      this.closedTabs = Array.isArray(profile.closedTabs) ? profile.closedTabs.slice(0, 20) : [];
      this.downloads = Array.isArray(profile.downloads) ? profile.downloads.slice(0, 100) : [];
      /* Google is the only search engine now, so a profile saved while the
         setting was configurable is migrated rather than trusted. */
      this.settings = { ...DEFAULT_SETTINGS, ...(profile.settings || {}), defaultSearchEngine: "google" };
      this.lastTabs = Array.isArray(profile.lastTabs) ? profile.lastTabs.map((tab) => ({ url: safeUrl(tab.url) })) : [];
    } catch {
      this.lastTabs = [];
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveProfile(), 180);
  }

  async saveProfile() {
    // A window-close event can arrive after Electron has torn down a child
    // WebContentsView. Persist the tabs that remain readable and quietly skip
    // views already released by Chromium.
    const lastTabs = [...this.tabs.values()].flatMap((tab) => {
      try {
        const contents = tab?.view?.webContents;
        if (!contents || contents.isDestroyed()) return [];
        return [{ url: tabUrl(tab) || HOME_URL }];
      } catch {
        return [];
      }
    });
    const payload = {
      version: 1,
      history: this.history,
      bookmarks: this.bookmarks,
      closedTabs: this.closedTabs,
      downloads: this.downloads,
      settings: this.settings,
      lastTabs,
    };
    await fs.writeFile(this.profilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8").catch(() => undefined);
  }

  async createTab(url = HOME_URL, { activate = true, persist = true } = {}) {
    if (this.tabs.size >= MAX_TABS) throw new Error(`Clyra Browser supports up to ${MAX_TABS} open tabs.`);
    const view = new WebContentsView({
      webPreferences: {
        partition: "persist:browser",
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        autoplayPolicy: "no-user-gesture-required",
        spellcheck: true,
        backgroundThrottling: true,
        // Keeps an actual compositor frame subscription alive for Cowork's live
        // preview even while this WebContentsView is not the visible native
        // layer. The same view still becomes the interactive full-screen
        // Browser surface when Cowork opens it.
        offscreen: true,
      },
    });
    const id = view.webContents.getOrCreateDevToolsTargetId();
    const tab = {
      id,
      view,
      title: "New tab",
      favicon: undefined,
      loading: true,
      zoom: 1,
      lastActiveAt: Date.now(),
      crashed: false,
    };
    this.tabs.set(id, tab);
    this.window.contentView.addChildView(view);
    // Keep a hidden native view physically outside the window too. Chromium
    // can otherwise retain a stale compositor frame above the renderer.
    view.setBounds(HIDDEN_SURFACE_BOUNDS);
    view.setVisible(false);
    this.wireTab(tab);
    // `nativeTheme.themeSource = "light"` is inherited by Chromium renderers.
    // Do not attach the Electron debugger before the first navigation: an
    // emulation command issued against an uninitialised renderer can block the
    // desktop boot sequence and competes with the agent's CDP session.
    void view.webContents.loadURL(normalizeInput(url)).catch(() => undefined);
    if (activate) this.activateTab(id, { persist: false });
    if (persist) this.scheduleSave();
    this.emitState();
    // Native WebContentsView activation steals focus from the React chrome.
    // A new tab is an explicit request to type, so return focus to Clyra's
    // omnibox after Chromium has completed that activation turn.
    if (activate) this.focusAddressSoon();
    return tab;
  }

  focusAddressSoon() {
    setTimeout(() => {
      if (!this.destroyed && this.uiView?.webContents && !this.uiView.webContents.isDestroyed()) {
        this.uiView.webContents.send("browser:focus-address");
      }
    }, 32);
  }

  wireTab(tab) {
    const contents = tab.view.webContents;
    // Frame subscriptions are delivered by Chromium's renderer, unlike a
    // native view snapshot. Keep a real latest frame when available so Cowork can
    // observe a browser that is hidden behind the Clyra workspace without
    // changing native view visibility.
    try {
      contents.beginFrameSubscription(false, (image) => {
        if (!image || image.isEmpty() || this.destroyed || tab.id !== this.activeTabId) return;
        this.lastFrame = image.toJPEG(82);
        this.lastFrameVersion = this.frameVersion;
      });
    } catch {
      // Older Electron runtimes may not expose frame subscriptions for a
      // WebContentsView; captureFrame retains a bounded fallback below.
    }
    contents.setWindowOpenHandler(({ url }) => {
      void this.createTab(url);
      return { action: "deny" };
    });
    contents.on("did-start-loading", () => {
      tab.loading = true;
      this.emitState();
    });
    contents.on("did-stop-loading", () => {
      tab.loading = false;
      this.recordHistory(tab);
      if (tab.id === this.activeTabId) void this.syncAgentChrome();
      this.emitState();
    });
    contents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
      /* -3 is an aborted load (a new navigation replaced it), not a failure. */
      if (!isMainFrame || code === -3 || !validatedURL || validatedURL.startsWith("data:")) return;
      tab.failedUrl = validatedURL;
      tab.loading = false;
      void contents.loadURL(loadErrorPage(validatedURL, code, description)).catch(() => undefined);
      this.emitState();
    });
    contents.on("did-navigate", (_event, url) => {
      if (!String(url || "").startsWith(ERROR_PAGE_PREFIX)) tab.failedUrl = null;
      tab.crashed = false;
      this.recordHistory(tab);
      this.scheduleSave();
      this.emitState();
    });
    contents.on("did-navigate-in-page", () => {
      this.scheduleSave();
      this.emitState();
    });
    contents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      tab.title = title || tab.title;
      this.emitState();
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      tab.favicon = favicons[0];
      this.emitState();
    });
    contents.on("render-process-gone", (_event, details) => {
      tab.crashed = true;
      tab.loading = false;
      this.emitState();
      if (details.reason !== "clean-exit") setTimeout(() => contents.reload(), 350);
    });
    contents.on("unresponsive", () => this.emitState());
    // Navigation replaces the document, and with it the injected agent
    // chrome. Re-apply it as soon as the new DOM exists, not only when the
    // whole page has finished loading.
    contents.on("dom-ready", () => {
      if (tab.id === this.activeTabId) void this.syncAgentChrome();
    });
    contents.on("console-message", (...args) => {
      const first = args[0];
      const message = typeof first?.message === "string" ? first.message : String(args[2] ?? "");
      if (!message.startsWith(`${this.agentChromeToken}:`)) return;
      const command = message.slice(this.agentChromeToken.length + 1);
      if (!["take_control", "return_control", "resume", "stop"].includes(command)) return;
      if (this.uiView?.webContents && !this.uiView.webContents.isDestroyed()) {
        this.uiView.webContents.send("browser:agent-control", { command, tabId: tab.id });
      }
    });
    contents.on("enter-html-full-screen", () => this.window.setFullScreen(true));
    contents.on("leave-html-full-screen", () => this.window.setFullScreen(false));
    contents.on("before-input-event", (event, input) => this.handleShortcut(event, input));
    contents.on("context-menu", (_event, params) => this.showContextMenu(tab, params));
  }

  /** Native right-click menu — Chromium's own edit items plus a single
   *  Clyra entry that hands the highlighted text straight to the "Ask
   *  Clyra" panel already built into the browser workspace. */
  showContextMenu(tab, params) {
    const contents = tab.view.webContents;
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
    const template = [];
    if (hasSelection) {
      template.push({
        label: "Ask Clyra about selection",
        click: () => {
          if (this.uiView?.webContents && !this.uiView.webContents.isDestroyed()) {
            this.uiView.webContents.send("browser:ask-selection", {
              text: params.selectionText,
              tabId: tab.id,
              pageUrl: contents.getURL(),
              pageTitle: contents.getTitle(),
            });
          }
        },
      });
      template.push({ type: "separator" });
      template.push({ label: "Copy", role: "copy" });
    }
    if (params.isEditable) {
      if (template.length) template.push({ type: "separator" });
      template.push({ label: "Cut", role: "cut", enabled: params.editFlags.canCut });
      template.push({ label: "Paste", role: "paste", enabled: params.editFlags.canPaste });
    }
    template.push({ type: "separator" });
    template.push({ label: "Back", enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
    template.push({ label: "Forward", enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
    template.push({ label: "Reload", click: () => contents.reload() });
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  handleShortcut(event, input) {
    if (input.type !== "keyDown") return;
    const modifier = process.platform === "darwin" ? input.meta : input.control;
    const key = String(input.key || "").toLowerCase();
    if (!modifier && key !== "f12") return;
    if (modifier && key === "j") this.uiView.webContents.send("taskview:toggle");
    else if (modifier && key === "l") this.uiView.webContents.send("browser:focus-address");
    else if (modifier && key === "t") void this.createTab();
    else if (modifier && input.shift && key === "t") void this.restoreClosedTab();
    else if (modifier && key === "w") void this.closeTab(this.activeTabId);
    else if (modifier && key === "r") this.activeContents()?.reload();
    else if (modifier && key === "f") this.uiView.webContents.send("browser:focus-find");
    else if (key === "f12" || (modifier && input.alt && key === "i")) this.activeContents()?.openDevTools({ mode: "detach" });
    else return;
    event.preventDefault();
  }

  activeContents() {
    return this.activeTabId ? this.tabs.get(this.activeTabId)?.view.webContents : null;
  }

  contentsFor(tabId = this.activeTabId) {
    return tabId ? this.tabs.get(tabId)?.view.webContents : null;
  }

  activateTab(id, { persist = true } = {}) {
    const next = this.tabs.get(id);
    if (!next) throw new Error("That browser tab no longer exists.");
    if (this.activeTabId && this.activeTabId !== id) {
      this.cancelSnip(this.activeTabId);
      const previous = this.tabs.get(this.activeTabId)?.view?.webContents;
      if (previous && !previous.isDestroyed()) {
        void previous.executeJavaScript("document.getElementById('__clyra_native_agent_cursor__')?.remove(); true", true).catch(() => {});
      }
      this.agentCursorPoint = null;
    }
    for (const [tabId, tab] of this.tabs) {
      const show = tabId === id && this.surface.visible;
      tab.view.setVisible(show);
      tab.view.webContents.setBackgroundThrottling(!show);
    }
    this.activeTabId = id;
    this.cursor = this.cursorsByTab.get(id) || null;
    next.lastActiveAt = Date.now();
    if (this.surface.visible) {
      next.view.setBounds(this.surface.bounds);
      next.view.webContents.focus();
    }
    void this.syncAgentChrome();
    if (persist) this.scheduleSave();
    this.emitState();
    return this.getState();
  }

  async closeTab(id = this.activeTabId) {
    const tab = id ? this.tabs.get(id) : null;
    if (!tab) return this.getState();
    this.cancelSnip(id);
    if (this.tabs.size === 1) {
      await tab.view.webContents.loadURL(HOME_URL);
      return this.getState();
    }
    this.closedTabs.unshift({ id: crypto.randomUUID(), url: tab.view.webContents.getURL(), title: tab.title, closedAt: new Date().toISOString() });
    this.closedTabs = this.closedTabs.slice(0, 20);
    const ids = [...this.tabs.keys()];
    const index = ids.indexOf(id);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close({ waitForBeforeUnload: false });
    this.tabs.delete(id);
    this.cursorsByTab.delete(id);
    if (this.activeTabId === id) this.activateTab(ids[index - 1] || ids[index + 1], { persist: false });
    this.scheduleSave();
    this.emitState();
    return this.getState();
  }

  async duplicateTab(id = this.activeTabId) {
    const source = id ? this.tabs.get(id) : null;
    return this.createTab(source?.view.webContents.getURL() || HOME_URL);
  }

  async restoreClosedTab() {
    const closed = this.closedTabs.shift();
    if (!closed) return this.getState();
    await this.createTab(closed.url);
    this.scheduleSave();
    return this.getState();
  }

  async setSurface({ bounds, visible }) {
    // A stale/corrupt persisted profile must never leave the native browser
    // with an empty tab strip. Restore one durable Google tab before display.
    if (this.tabs.size === 0) await this.createTab(HOME_URL, { activate: true, persist: true });
    const wasVisible = this.surface.visible;
    if (bounds) {
      this.surface.bounds = {
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(2, Math.round(bounds.width)),
        height: Math.max(2, Math.round(bounds.height)),
      };
    }
    this.surface.visible = Boolean(visible);
    // A genuine interactive Browser surface belongs above Clyra only while it
    // is open. Background frame capture performs the inverse ordering so Cowork
    // remains the visible native layer.
    if (this.surface.visible) {
      const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
      if (active) {
        try {
          this.window.contentView.removeChildView(active.view);
          this.window.contentView.addChildView(active.view);
        } catch {
          // The owning BrowserWindow may be tearing down; the normal tab loop
          // below will no-op safely in that case.
        }
      }
    }
    for (const [id, tab] of this.tabs) {
      const show = this.surface.visible && id === this.activeTabId;
      if (show) {
        tab.view.setBounds(this.surface.bounds);
        tab.view.setVisible(true);
      } else {
        tab.view.setVisible(false);
        tab.view.setBounds(HIDDEN_SURFACE_BOUNDS);
      }
      tab.view.webContents.setBackgroundThrottling(!show);
      if (show) {
        tab.view.setBounds(this.surface.bounds);
        if (!wasVisible) tab.view.webContents.focus();
      }
    }
    this.emitState();
  }

  async navigate(target, tabId = this.activeTabId) {
    /* Tabs are created lazily when the browser surface is first shown, so a
       navigation that arrives before that — a search typed the moment the
       app opens, a deep link, or anything after the last tab was closed —
       used to throw "No active browser tab" and silently do nothing. A
       navigation with nowhere to go should open somewhere to go. */
    let contents = this.contentsFor(tabId);
    if (!contents) {
      await this.createTab(HOME_URL, { activate: true, persist: true });
      contents = this.contentsFor(this.activeTabId);
    }
    if (!contents) throw new Error("No active browser tab.");
    const destination = normalizeInput(target);
    // contents.loadURL()'s promise only resolves once the whole page has
    // finished loading (did-finish-load) or rejects on failure — awaiting it
    // here kept every caller (the IPC handler, and therefore the renderer's
    // "busy"/dimmed-preview state) blocked for the entire page load instead
    // of just the moment navigation begins. did-start-loading/did-navigate
    // are already wired to emitState() above, so the address bar, loading
    // spinner and URL update live the instant the navigation actually starts
    // — this only needs to kick the load off and report real failures async.
    const load = contents.loadURL(destination).catch((error) => {
      // Chromium can reject a redundant Google new-tab recovery while the
      // existing native tab is already usable; that recovery case is benign.
      if (destination === HOME_URL && /^https:\/\/(?:www\.)?google\.com\/?$/i.test(contents.getURL())) return;
      console.error("[browser] navigate failed:", error instanceof Error ? error.message : error);
    });
    void load;
    return this.getState();
  }

  /**
   * Same navigation as navigate(), but for callers that must observe the
   * *landed* page next (the autonomous browser agent) rather than just
   * trigger the address change — so this one genuinely waits for the load
   * to finish. Listeners are attached before loadURL() starts so there is no
   * race with a load that resolves before the caller gets to wait for it.
   */
  async navigateAndWaitForLoad(target, tabId = this.activeTabId, timeoutMs = 15_000) {
    const contents = this.contentsFor(tabId);
    if (!contents) throw new Error("No active browser tab.");
    const settled = new Promise((resolve) => {
      const done = () => {
        contents.removeListener("did-stop-loading", done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      contents.once("did-stop-loading", done);
    });
    await this.navigate(target, tabId);
    await settled;
    return this.getState();
  }

  async action(action) {
    /* Opening a tab is the one action that must work with no tabs open, so
       it runs before the active-tab guard — but it still answers with the
       state every other action returns, or the caller waits forever. */
    if (action?.type === "open_tab") {
      await this.createTab(action.url || HOME_URL);
      this.emitState();
      return { state: this.getState() };
    }
    const contents = this.activeContents();
    if (!contents) throw new Error("No active browser tab.");
    contents.focus();
    switch (action?.type) {
      case "back": case "go_back": if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break;
      case "forward": case "go_forward": if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break;
      case "reload": contents.reload(); break;
      case "stop_loading": contents.stop(); break;
      case "open_tab": await this.createTab(action.url || HOME_URL); break;
      case "switch_tab": this.activateTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "close_tab": await this.closeTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "duplicate_tab": await this.duplicateTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "restore_closed_tab": await this.restoreClosedTab(); break;
      case "navigate": await this.navigate(action.url); break;
      case "search": await this.navigate(action.query); break;
      case "press": case "press_key": contents.sendInputEvent({ type: "keyDown", keyCode: action.key }); contents.sendInputEvent({ type: "keyUp", keyCode: action.key }); break;
      case "type": contents.insertText(String(action.text || "")); if (action.submit) { contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" }); contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" }); } break;
      case "click_at": contents.sendInputEvent({ type: "mouseDown", x: Math.round(action.x), y: Math.round(action.y), button: "left", clickCount: 1 }); contents.sendInputEvent({ type: "mouseUp", x: Math.round(action.x), y: Math.round(action.y), button: "left", clickCount: 1 }); break;
      case "scroll": contents.sendInputEvent({ type: "mouseWheel", x: 0, y: 0, deltaY: action.direction === "up" ? Math.abs(action.amount || 500) : -Math.abs(action.amount || 500), canScroll: true }); break;
      default: break;
    }
    this.emitState();
    return { state: this.getState() };
  }

  async observe(tabId = this.activeTabId) {
    const contents = this.contentsFor(tabId);
    if (!contents || contents.isDestroyed()) throw new Error("The requested browser tab is no longer available.");
    const tab = tabId ? this.tabs.get(tabId) : null;
    const maxChars = 30_000;
    const page = await contents.executeJavaScript(`(() => {
      const clean = (value, max = 220) => String(value || "").replace(/\\s+/g, " ").trim().slice(0, max);
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width >= 2 && rect.height >= 2 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > .01;
      };
      const elements = [];
      let index = 1;
      for (const element of document.querySelectorAll("a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='radio'],[role='menuitem'],[contenteditable='true'],[tabindex]")) {
        if (!visible(element)) continue;
        const rect = element.getBoundingClientRect();
        let id = element.getAttribute("data-clyra-browser-id");
        if (!id) {
          id = "native-" + (++window.__clyraNativeElementSequence || (window.__clyraNativeElementSequence = 1));
          element.setAttribute("data-clyra-browser-id", id);
        }
        const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? element : null;
        const anchor = element instanceof HTMLAnchorElement ? element : null;
        const labels = "labels" in element ? Array.from(element.labels || []).map((label) => label.innerText).join(" ") : "";
        const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean).map((part) => document.getElementById(part)?.textContent || "").join(" ");
        const role = element.getAttribute("role") || (element.tagName === "A" ? "link" : element.tagName === "BUTTON" ? "button" : element.tagName === "SELECT" ? "combobox" : element.tagName === "INPUT" || element.tagName === "TEXTAREA" ? "textbox" : "");
        const name = clean(element.getAttribute("aria-label") || labelledBy || labels || element.getAttribute("title") || element.innerText || input?.getAttribute("placeholder") || input?.value || "", 180);
        if (role === "link" && /^(?:skip|jump)\\s+(?:to\\s+)?(?:main\\s+)?(?:content|navigation|search)$/i.test(name)) continue;
        elements.push({ index, id, tag: element.tagName.toLowerCase(), role, name, text: clean(element.innerText || "", 220), label: clean(labels || labelledBy || element.getAttribute("aria-label") || "", 180), placeholder: clean(element.getAttribute("placeholder") || "", 160), type: clean(element.getAttribute("type") || "", 40), value: clean(input?.value || element.getAttribute("aria-valuetext") || "", 220), href: clean(anchor?.href || "", 400), testId: clean(element.getAttribute("data-testid") || "", 100), visible: true, enabled: !element.disabled && element.getAttribute("aria-disabled") !== "true", checked: element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? element.checked : element.getAttribute("aria-checked") == null ? undefined : element.getAttribute("aria-checked") === "true", selected: element.getAttribute("aria-selected") == null ? undefined : element.getAttribute("aria-selected") === "true", box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } });
        index += 1;
        if (elements.length >= 220) break;
      }
      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).filter(visible).slice(0, 40).map((heading) => ({ level: Number(heading.getAttribute("aria-level") || heading.tagName.slice(1) || 2), text: clean(heading.innerText, 240) })).filter((heading) => heading.text);
      const lines = Array.from(document.querySelectorAll("main p,main li,main td,main th,article p,article li,[role='main'] p,[role='main'] li,h1,h2,h3,label")).filter(visible).map((node) => clean(node.innerText, 500)).filter(Boolean);
      const root = document.querySelector("main,article,[role='main']") || document.body || document.documentElement;
      const pageHeight = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0, innerHeight);
      return { url: location.href, title: document.title, loading: document.readyState === "loading", viewport: { width: innerWidth, height: innerHeight, scrollX: scrollX, scrollY: scrollY, pageHeight, zoom: 1 }, headings, elements, visibleText: [...new Set(lines)].slice(0, 160), mainText: clean(root?.innerText || "", ${maxChars}), structuredData: [] };
    })()`, true);
    const signals = injectionSignals([...page.visibleText, page.mainText]);
    // The native desktop observer needs the same verification fidelity as the
    // Playwright fallback. A bounded main-text snapshot catches status-only
    // UI updates (cart counters, save notices, inline confirmations) that do
    // not alter a form value or a listed interactive element.
    const fingerprint = crypto.createHash("sha1").update(`${page.url}|${page.title}|${page.visibleText.slice(0, 80).join("|")}|${page.mainText.slice(0, 4_000)}|${page.elements.map((item) => `${item.id}:${item.value}:${item.checked}:${item.enabled}`).join("|")}`).digest("hex").slice(0, 16);
    return {
      page: { url: page.url, title: page.title, loading: page.loading, fingerprint },
      viewport: page.viewport,
      headings: page.headings,
      elements: page.elements,
      visibleText: page.visibleText.filter((line) => !signals.includes(line)),
      mainText: signals.reduce((text, signal) => text.replaceAll(signal, "[untrusted instruction-like page text removed]"), page.mainText),
      structuredData: page.structuredData,
      promptInjectionSignals: signals,
      tabs: this.getState().tabs,
      diff: { urlChanged: false, titleChanged: false, addedText: [], removedText: [] },
      activeTabId: tab?.id,
    };
  }

  async agentAction(action, observation, source = "agent", tabId = this.activeTabId) {
    const contents = this.contentsFor(tabId);
    if (!contents || contents.isDestroyed()) throw new Error("The requested browser tab is no longer available.");
    // An agent run may continue in a tab the user has left. Keep that renderer
    // responsive without stealing focus or changing the visible tab.
    contents.setBackgroundThrottling(false);
    const tabIsVisible = this.surface.visible && tabId === this.activeTabId;
    const elements = observation?.elements || [];
    const target = action?.target;
    const resolved = typeof target === "number"
      ? elements.find((element) => element.index === target)
      : target?.elementId
        ? elements.find((element) => element.id === target.elementId)
        : target && elements.find((element) => (!target.role || element.role === target.role) && (!target.name || element.name.toLowerCase().includes(String(target.name).toLowerCase())) && (!target.label || element.label.toLowerCase().includes(String(target.label).toLowerCase())) && (!target.placeholder || element.placeholder.toLowerCase().includes(String(target.placeholder).toLowerCase())) && (!target.text || element.text.toLowerCase().includes(String(target.text).toLowerCase())) && (!target.testId || element.testId === target.testId));
    let point = resolved?.center || (typeof target === "object" ? target.coordinates : null);
    const withDebugger = async (operation) => {
      const attachedHere = !contents.debugger.isAttached();
      if (attachedHere) contents.debugger.attach("1.3");
      try {
        return await operation((method, params) => contents.debugger.sendCommand(method, params));
      } finally {
        if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
      }
    };
    // Re-resolve immediately before clicking; an observation may be stale.
    if (isPointerAction(action?.type) && resolved?.id) {
      const selector = JSON.stringify('[data-clyra-browser-id="' + resolved.id + '"]');
      const live = await contents.executeJavaScript(`(() => {
        const node = document.querySelector(${selector});
        if (!node || !node.isConnected) return null;
        const r = node.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        if (r.width < 2 || r.height < 2 || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
        const hit = document.elementFromPoint(x, y);
        if (hit !== node && !node.contains(hit) && !hit?.contains(node)) return null;
        return { x, y };
      })()`, true);
      if (!live) throw new Error("The target moved or is covered. Observe the page again.");
      point = live;
    }
    if (action?.type === "click_at") {
      const x = Number(action.x), y = Number(action.y);
      const viewport = await contents.executeJavaScript("({ width: innerWidth, height: innerHeight })", true);
      if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
        throw new Error("Click coordinates are outside the live browser viewport.");
      }
      point = { x: Math.round(x), y: Math.round(y) };
    }
    if (action?.type === "scroll" && !point && tabIsVisible) {
      point = await contents.executeJavaScript("({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) })", true);
    }
    // Every animation frame dispatches an actual Chromium mouseMoved event
    // BEFORE the visual marker is advanced to its confirmed coordinates.
    const movePointer = async (destination) => {
      if (!tabIsVisible || !destination) return;
      const motion = planCursorMotion(this.agentCursorPoint || destination, destination, {
        speed: this.settings.aiCursorSpeed, reducedMotion: this.settings.reducedMotion,
      });
      await withDebugger(async (send) => {
        const started = Date.now();
        for (const [index, frame] of motion.frames.entries()) {
          if (this.agent.manualControl || this.agent.paused || this.destroyed) throw new Error("Browser control was interrupted.");
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: frame.x, y: frame.y });
          this.agentCursorPoint = { x: frame.x, y: frame.y };
          if (this.settings.showAiCursor) {
            await this.setCursor({ x: frame.x, y: frame.y, kind: "move", label: action.label || "Clyra", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
          }
          const next = motion.frames[index + 1];
          if (next) await new Promise((resolve) => setTimeout(resolve, Math.max(0, next.atMs - (Date.now() - started))));
        }
      });
    };
    if ((isPointerAction(action?.type) || action?.type === "type") && point) await movePointer(point);

    const click = async (clickCount = 1, button = "left") => {
      if (this.agent.paused || this.agent.manualControl) throw new Error("Control was taken over before the click.");
      if (!point) throw new Error("The requested target is no longer visible.");
      if (resolved?.id && tabIsVisible) {
        // Hover may open a menu or shift layout while our mouse is traveling.
        // Never press the old coordinate if the hit target moved or changed.
        const selector = JSON.stringify('[data-clyra-browser-id="' + resolved.id + '"]');
        const live = await contents.executeJavaScript(`(() => {
          const node = document.querySelector(${selector});
          if (!node || !node.isConnected) return null;
          const r = node.getBoundingClientRect();
          const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
          if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
          const hit = document.elementFromPoint(x, y);
          if (hit !== node && !node.contains(hit) && !hit?.contains(node)) return null;
          return { x, y };
        })()`, true);
        if (!live) throw new Error("The target is no longer under the cursor. Observe again before clicking.");
        if (Math.hypot(live.x - point.x, live.y - point.y) > 3) {
          await movePointer(live);
          point = live;
        }
      }
      // A hidden native view has no compositor target for dispatchMouseEvent.
      // Use the actual page node in that same WebContents until the user opens
      // Browser again; visible browser actions always retain CDP coordinates.
      if (!tabIsVisible && resolved) {
        if (button !== "left") throw new Error("Right-click requires a visible browser compositor.");
        const clicked = await contents.executeJavaScript(`(() => {
          const node = document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)});
          if (!node || !node.isConnected) return false;
          node.click();
          return true;
        })()`, true);
        if (!clicked) throw new Error("The target disappeared before clicking.");
        if (this.settings.showAiCursor) await this.setCursor({ ...point, kind: clickCount === 2 ? "double_click" : "click", label: action.label || "Clyra", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
        return;
      }
      await withDebugger(async (send) => {
        const params = { x: Math.round(point.x), y: Math.round(point.y), button, clickCount };
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...params });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...params });
      });
      if (tabIsVisible && this.settings.showAiCursor) await this.setCursor({ ...point, kind: button === "right" ? "right_click" : clickCount === 2 ? "double_click" : "click", label: action.label || "Clyra", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
    };
    const focus = async () => {
      if (!resolved) return;
      await contents.executeJavaScript(`document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)})?.focus()`, true);
    };
    const key = async (keyCode, modifiers = 0) => {
      await withDebugger(async (send) => {
        const code = String(keyCode).length === 1 ? `Key${String(keyCode).toUpperCase()}` : String(keyCode);
        const key = keyCode === "Backspace" ? "Backspace" : keyCode === "Enter" ? "Enter" : String(keyCode);
        await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode === "Enter" ? 13 : keyCode === "Backspace" ? 8 : String(keyCode).toUpperCase().charCodeAt(0), nativeVirtualKeyCode: keyCode === "Enter" ? 13 : keyCode === "Backspace" ? 8 : String(keyCode).toUpperCase().charCodeAt(0), modifiers });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode === "Enter" ? 13 : keyCode === "Backspace" ? 8 : String(keyCode).toUpperCase().charCodeAt(0), nativeVirtualKeyCode: keyCode === "Enter" ? 13 : keyCode === "Backspace" ? 8 : String(keyCode).toUpperCase().charCodeAt(0), modifiers });
      });
    };
    if (tabIsVisible) contents.focus();
    switch (action?.type) {
      case "navigate": await this.navigateAndWaitForLoad(action.url, tabId); break;
      case "search": await this.navigateAndWaitForLoad(action.query, tabId); break;
      case "back": case "go_back": if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack(); break;
      case "forward": case "go_forward": if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward(); break;
      case "reload": contents.reload(); break;
      case "stop_loading": contents.stop(); break;
      case "open_tab": await this.createTab(action.url || HOME_URL); break;
      case "switch_tab": this.activateTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "close_tab": await this.closeTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "duplicate_tab": await this.duplicateTab(action.tabId || [...this.tabs.keys()][action.tabIndex || 0]); break;
      case "restore_closed_tab": await this.restoreClosedTab(); break;
      case "click": case "focus": await focus(); if (action.type === "click") await click(); break;
      case "double_click": await click(2); break;
      case "right_click": await click(1, "right"); break;
      case "hover": break;
      case "click_at": await click(); break;
      case "type": {
        await focus();
        if (!tabIsVisible && resolved) {
          await contents.executeJavaScript(`(() => {
            const node = document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)});
            if (!node) return;
            const value = ${JSON.stringify(String(action.text || ""))};
            if ("value" in node) node.value = ${action.clearFirst !== false ? "\"\"" : "node.value"} + value;
            else if (node.isContentEditable) node.textContent = ${action.clearFirst !== false ? "value" : "node.textContent + value"};
            node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          })()`, true);
          if (action.submit) await contents.executeJavaScript(`document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)})?.form?.requestSubmit?.()`, true);
          if (point && this.settings.showAiCursor) await this.setCursor({ ...point, kind: "type", label: "Typing", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
          break;
        }
        if (action.clearFirst !== false) {
          await contents.executeJavaScript(`(() => { const node = document.activeElement; if (node && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) node.select(); else document.execCommand("selectAll"); })()`, true);
        }
        const delay = source === "agent" ? (String(action.text).length > 180 ? 28 : 38) : 0;
        for (const character of String(action.text || "")) {
          await withDebugger((send) => send("Input.insertText", { text: character }));
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (action.submit) await key("Enter");
        if (point && this.settings.showAiCursor) await this.setCursor({ ...point, kind: "type", label: "Typing", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
        break;
      }
      case "check":
      case "uncheck": {
        if (!resolved) throw new Error("The requested control is no longer visible.");
        const desired = action.type === "check";
        const changed = await contents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)}); if (!node) return false; if (node.checked !== ${desired}) node.click(); return true; })()`, true);
        if (!changed) throw new Error("Checkbox disappeared before clicking.");
        if (point && this.settings.showAiCursor) await this.setCursor({ ...point, kind: "click", label: action.label || "Clyra", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
        break;
      }
      case "select_option": {
        if (!resolved) throw new Error("The requested control is no longer visible.");
        const selected = await contents.executeJavaScript(`(() => {
          const node = document.querySelector(${JSON.stringify(`[data-clyra-browser-id="${resolved.id}"]`)});
          if (!(node instanceof HTMLSelectElement)) return false;
          const comparable = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9.]+/g, "");
          const needle = comparable(${JSON.stringify(String(action.value ?? action.label ?? ""))});
          const option = [...node.options].find((candidate) => comparable(candidate.value) === needle || comparable(candidate.label) === needle || comparable(candidate.textContent) === needle);
          if (!option) return false;
          node.value = option.value;
          node.dispatchEvent(new Event("input", { bubbles: true }));
          node.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`, true);
        if (!selected) throw new Error("The requested select option was not found.");
        break;
      }
      case "press": case "press_key": await key(action.key); break;
      case "key_combination": {
        const keys = action.keys || [];
        const modifiers = keys.slice(0, -1).reduce((value, item) => value | (/^(?:control|ctrl|controlormeta)$/i.test(String(item)) ? 2 : /^(?:meta|command|cmd)$/i.test(String(item)) ? 4 : /^(?:alt|option)$/i.test(String(item)) ? 1 : /^(?:shift)$/i.test(String(item)) ? 8 : 0), 0);
        await key(keys[keys.length - 1], modifiers);
        break;
      }
      case "scroll": {
        const amount = Math.abs(Number(action.amount || 600));
        if (!tabIsVisible) {
          const x = action.direction === "left" ? -amount : action.direction === "right" ? amount : 0;
          const y = action.direction === "up" ? -amount : amount;
          await contents.executeJavaScript(`window.scrollBy({ left: ${x}, top: ${y}, behavior: "instant" })`, true);
        } else {
          contents.sendInputEvent({ type: "mouseWheel", x: Math.round(point?.x || 8), y: Math.round(point?.y || 8), deltaX: action.direction === "left" ? Math.abs(amount) : action.direction === "right" ? -Math.abs(amount) : 0, deltaY: action.direction === "up" ? Math.abs(amount) : -Math.abs(amount), canScroll: true });
        }
        break;
      }
      case "scroll_to_top": await contents.executeJavaScript("window.scrollTo({top:0,behavior:'smooth'})", true); break;
      case "scroll_to_bottom": await contents.executeJavaScript("window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'})", true); break;
      case "scroll_to": await contents.executeJavaScript(`document.querySelector(${JSON.stringify(resolved ? `[data-clyra-browser-id="${resolved.id}"]` : "")})?.scrollIntoView({block:'center',behavior:'smooth'})`, true); break;
      case "drag": {
        if (!point || !tabIsVisible) throw new Error("Dragging requires a visible target in the foreground browser.");
        const endpoint = action.to || action.end || (Number.isFinite(Number(action.endX)) && Number.isFinite(Number(action.endY))
          ? { x: Number(action.endX), y: Number(action.endY) } : null);
        if (!endpoint || !Number.isFinite(Number(endpoint.x)) || !Number.isFinite(Number(endpoint.y))) throw new Error("Drag destination coordinates are missing.");
        const dest = { x: Math.round(Number(endpoint.x)), y: Math.round(Number(endpoint.y)) };
        const viewport = await contents.executeJavaScript("({ width: innerWidth, height: innerHeight })", true);
        if (dest.x < 0 || dest.y < 0 || dest.x >= viewport.width || dest.y >= viewport.height) throw new Error("Drag destination is outside the page.");
        await withDebugger(async (send) => {
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
          const motion = planCursorMotion(point, dest, { speed: this.settings.aiCursorSpeed, reducedMotion: this.settings.reducedMotion });
          try {
            const started = Date.now();
            for (const [index, frame] of motion.frames.entries()) {
              if (this.agent.paused || this.agent.manualControl) throw new Error("Drag interrupted by user takeover.");
              await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: frame.x, y: frame.y, button: "left", buttons: 1 });
              this.agentCursorPoint = { x: frame.x, y: frame.y };
              if (this.settings.showAiCursor) await this.setCursor({ ...frame, kind: "move", label: "Dragging", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
              const next = motion.frames[index + 1];
              if (next) await new Promise((resolve) => setTimeout(resolve, Math.max(0, next.atMs - (Date.now() - started))));
            }
          } finally {
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dest.x, y: dest.y, button: "left", clickCount: 1 });
          }
        });
        if (this.settings.showAiCursor) await this.setCursor({ ...dest, kind: "click", label: "Dropped", reducedMotion: true, showLabel: this.settings.showAiActionLabels }, tabId);
        break;
      }
      case "wait": case "read_page": case "extract": case "inspect_element": case "find_text": case "ask_user": case "done": break;
      default: break;
    }
    await new Promise((resolve) => setTimeout(resolve, action?.type === "navigate" || action?.type === "search" ? 350 : 90));
    // Tab lifecycle actions can destroy the WebContents referenced by tabId
    // (most notably Close). Observe the tab that survived / became active,
    // rather than attempting to inspect a just-destroyed renderer.
    const lifecycleAction = ["open_tab", "switch_tab", "close_tab", "duplicate_tab", "restore_closed_tab"].includes(action?.type);
    const observationTabId = lifecycleAction ? this.activeTabId : tabId;
    const after = await this.observe(observationTabId);
    // close_tab intentionally destroys `contents`; never touch it after the
    // lifecycle operation has completed.
    if (tabId && tabId !== this.activeTabId && !contents.isDestroyed()) contents.setBackgroundThrottling(true);
    return { ok: true, state: this.getState(), observation: after };
  }

  async setCursor(cursor, tabId = this.activeTabId) {
    if (!cursor) {
      if (tabId) this.cursorsByTab.delete(tabId);
      if (!tabId || tabId === this.activeTabId) {
        this.cursor = null;
        this.agentCursorPoint = null;
      }
    } else if ([cursor.x, cursor.y].every(Number.isFinite)) {
      const event = { id: ++this.cursorSequence, at: Date.now(), x: Math.round(cursor.x), y: Math.round(cursor.y), kind: String(cursor.kind || "move"), label: String(cursor.label || "Clyra") };
      if (tabId) this.cursorsByTab.set(tabId, event);
      if (!tabId || tabId === this.activeTabId) {
        this.cursor = event;
        // The Playwright fallback also supplies this method, but only after
        // real mouse dispatch. Keep the next native CDP path continuous.
        this.agentCursorPoint = { x: event.x, y: event.y };
      }
    }
    // Keep the human's visible tab undisturbed while an agent continues in a
    // different tab. The cursor becomes visible automatically when that tab
    // is brought back to the foreground on the next agent event.
    if (tabId && tabId !== this.activeTabId) return;
    const contents = this.contentsFor(tabId);
    if (!contents || contents.isDestroyed()) return;
    const payload = cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y)
      ? {
          x: Math.round(cursor.x),
          y: Math.round(cursor.y),
          label: String(cursor.label || "Clyra").slice(0, 80),
          kind: String(cursor.kind || "move"),
          showLabel: cursor.showLabel !== false,
          reducedMotion: Boolean(cursor.reducedMotion),
        }
      : null;
    await contents.executeJavaScript(`(() => {
      const id = "__clyra_native_agent_cursor__";
      const existing = document.getElementById(id);
      const data = ${JSON.stringify(payload)};
      if (!data) { existing?.remove(); return; }
      const root = existing || Object.assign(document.createElement("div"), { id });
      if (!existing) {
        root.setAttribute("aria-hidden", "true");
        root.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;z-index:2147483647;pointer-events:none;will-change:transform;contain:layout style paint;transition:opacity 90ms ease;";
        const glow = document.createElement("div");
        glow.dataset.part = "glow";
        glow.style.cssText = "position:absolute;left:-14px;top:-14px;width:40px;height:40px;border-radius:50%;background:radial-gradient(circle,rgba(30,111,255,.14),transparent 68%);filter:blur(4px);";
        // A tailless Clyra control point is less visually intrusive than a
        // traditional arrow and makes movement, click and type states clear
        // without obscuring the page the agent is operating.
        const core = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        core.dataset.part = "core";
        core.setAttribute("viewBox", "0 0 34 38");
        core.setAttribute("width", "34");
        core.setAttribute("height", "38");
        core.style.cssText = "position:absolute;left:-4px;top:-3px;width:34px;height:38px;overflow:visible;pointer-events:none;transform-origin:4px 3px;filter:drop-shadow(0 0 2.5px rgba(30,111,255,.32)) drop-shadow(0 3px 3px rgba(22,34,55,.18));";
        const shape = "M4 3 L4 29.2 Q4 30.5 5.4 30.5 L11.4 24.6 L16.9 34.3 Q17.5 35.4 18.6 34.9 L22 33.1 Q23 32.6 22.4 31.5 L16.9 21.8 L29.1 21.8 Q30.8 21.8 30 20.4 L5.9 2.2 Q4 0.9 4 3 Z";
        for (const [fill, stroke, thickness] of [["#1E6FFF", "#1E6FFF", "5.4"], ["#FFFFFF", "#252A35", "2.45"]]) {
          const segment = document.createElementNS("http://www.w3.org/2000/svg", "path");
          segment.setAttribute("d", shape);
          segment.setAttribute("fill", fill);
          segment.setAttribute("stroke", stroke);
          segment.setAttribute("stroke-width", thickness);
          segment.setAttribute("stroke-linejoin", "round");
          core.append(segment);
        }
        const caret = document.createElement("div");
        caret.dataset.part = "caret";
        caret.style.cssText = "display:none;position:absolute;left:2px;top:0;width:2px;height:24px;border-radius:999px;background:#1e6fff;box-shadow:0 0 0 1px white,0 0 8px rgba(30,111,255,.34);";
        const click = document.createElement("div");
        click.dataset.part = "click";
        click.style.cssText = "display:none;position:absolute;left:-16px;top:-16px;width:32px;height:32px;border:1.8px solid rgba(30,111,255,.64);border-radius:999px;box-shadow:0 0 0 3px rgba(30,111,255,.08);";
        const label = document.createElement("span");
        label.dataset.part = "label";
        label.style.cssText = "position:absolute;left:24px;top:23px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid rgba(36,42,52,.09);border-radius:9px;background:rgba(255,255,255,.96);padding:6px 10px 6px 18px;color:#252a33;font:500 11px/1.25 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:-.01em;box-shadow:0 4px 14px rgba(20,32,52,.13);";
        const labelDot = document.createElement("i");
        labelDot.style.cssText = "position:absolute;left:8px;top:50%;width:4px;height:4px;margin-top:-2px;border-radius:999px;background:#4f7cff;box-shadow:0 0 0 2px rgba(79,124,255,.12);";
        label.append(labelDot);
        root.append(glow, core, caret, click, label);
        document.documentElement.appendChild(root);
      }
      const label = root.querySelector('[data-part="label"]');
      if (label) {
        const text = label.lastChild && label.lastChild.nodeType === Node.TEXT_NODE ? label.lastChild : document.createTextNode("");
        text.textContent = data.label;
        if (!text.parentNode) label.append(text);
        label.style.display = data.showLabel ? "block" : "none";
      }
      root.style.transition = "none"; // Input and artwork update in lockstep.
      root.style.transform = "translate3d(" + data.x + "px," + data.y + "px,0)";
      root.style.opacity = "1";
      const core = root.querySelector('[data-part="core"]');
      const caret = root.querySelector('[data-part="caret"]');
      const click = root.querySelector('[data-part="click"]');
      if (caret) {
        caret.style.display = data.kind === "type" ? "block" : "none";
        caret.animate?.([{ opacity: 1 }, { opacity: .2 }, { opacity: 1 }], { duration: 880, iterations: data.kind === "type" ? Infinity : 1, easing: "steps(2,end)" });
      }
      if (core) core.style.opacity = data.kind === "type" ? ".55" : "1";
      if (click) {
        click.style.display = data.kind.includes("click") ? "block" : "none";
        if (data.kind.includes("click")) click.animate?.([{ transform: "scale(.42)", opacity: .88 }, { transform: "scale(1.52)", opacity: 0 }], { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" });
      }
      if (core) {
        core.animate?.(
          data.kind.includes("click") ? [{ transform: "scale(1)" }, { transform: "scale(.88) translate(1px,1px)" }, { transform: "scale(1)" }] : [{ opacity: 1 }, { opacity: 1 }],
          { duration: data.kind.includes("click") ? 190 : 1, easing: "ease-out" },
        );
      }
    })()`, true).catch(() => undefined);
  }

  async find(text) {
    const contents = this.activeContents();
    const query = String(text || "").trim();
    if (!contents || !query) {
      contents?.stopFindInPage?.("clearSelection");
      return { result: { total: 0, current: 0 }, state: this.getState() };
    }

    const result = await new Promise((resolve) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        contents.removeListener("found-in-page", onFound);
        resolve(payload);
      };
      const onFound = (_event, detail) => {
        if (detail.finalUpdate) finish({ total: detail.matches || 0, current: detail.activeMatchOrdinal || 0 });
      };
      const timeout = setTimeout(() => finish({ total: 0, current: 0 }), 2_000);
      contents.on("found-in-page", onFound);
      contents.findInPage(query, { findNext: true, forward: true, findMatchCase: false });
    });
    return { result, state: this.getState() };
  }

  zoom(delta) {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!tab) return this.getState();
    tab.zoom = delta === "reset" ? 1 : Math.max(0.5, Math.min(3, tab.zoom + Number(delta || 0)));
    tab.view.webContents.setZoomFactor(tab.zoom);
    this.emitState();
    return this.getState();
  }

  updateSettings(patch) {
    this.settings = { ...this.settings, ...(patch || {}) };
    this.scheduleSave();
    this.emitState();
    return this.getState();
  }

  addBookmark(input = {}) {
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!tab) return this.getState();
    const url = input.url || tab.view.webContents.getURL();
    const existing = this.bookmarks.find((bookmark) => bookmark.url === url);
    if (existing) {
      existing.title = input.title || existing.title;
      existing.folder = input.folder || existing.folder;
    } else {
      this.bookmarks.unshift({ id: crypto.randomUUID(), url, title: input.title || tab.title || url, folder: input.folder || "Bookmarks", createdAt: new Date().toISOString() });
      this.scheduleSave();
    }
    this.emitState();
    return this.getState();
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    this.scheduleSave();
    this.emitState();
    return this.getState();
  }

  clearHistory(ids) {
    const selected = Array.isArray(ids) ? new Set(ids) : null;
    this.history = selected ? this.history.filter((entry) => !selected.has(entry.id)) : [];
    this.scheduleSave();
    this.emitState();
    return this.getState();
  }

  recordHistory(tab) {
    if (!this.settings.saveHistory || this.settings.privateMode) return;
    const url = tab.view.webContents.getURL();
    if (!/^https?:\/\//i.test(url)) return;
    const now = new Date().toISOString();
    const existing = this.history.find((entry) => entry.url === url);
    this.history = this.history.filter((entry) => entry.url !== url);
    this.history.unshift({
      id: existing?.id || crypto.randomUUID(),
      url,
      title: tab.title || url,
      visitedAt: now,
      visitCount: (existing?.visitCount || 0) + 1,
      favicon: tab.favicon,
    });
    this.history = this.history.slice(0, 2000);
    this.scheduleSave();
  }

  async inspect() {
    const contents = this.activeContents();
    if (!contents) throw new Error("No active browser tab.");
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    await contents.debugger.sendCommand("DOM.enable");
    await contents.debugger.sendCommand("Accessibility.enable");
    const [document, accessibility, layout] = await Promise.all([
      contents.debugger.sendCommand("DOM.getDocument", { depth: 2, pierce: true }),
      contents.debugger.sendCommand("Accessibility.getFullAXTree", { depth: 4 }),
      contents.debugger.sendCommand("Page.getLayoutMetrics"),
    ]);
    return {
      targetId: contents.getOrCreateDevToolsTargetId(),
      url: contents.getURL(),
      title: contents.getTitle(),
      activeElement: await contents.executeJavaScript("document.activeElement ? {tag: document.activeElement.tagName, role: document.activeElement.getAttribute('role'), name: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent?.trim().slice(0,120)} : null", true),
      document,
      accessibility,
      layout,
    };
  }

  setAgentState(agent) {
    this.agent = { ...this.agent, ...(agent || {}) };
    if (this.agent.manualControl || this.agent.paused || ["idle", "completed", "failed", "cancelled", "paused", "waiting_for_user"].includes(this.agent.status)) {
      void this.setCursor(null).catch(() => {});
    }
    void this.syncAgentChrome();
    this.emitState();
    return this.agent;
  }

  async syncAgentChrome() {
    const status = String(this.agent.status || "idle");
    const running = ["planning", "observing", "executing", "verifying", "recovering"].includes(status);
    const manualControl = Boolean(this.agent.manualControl);
    const paused = !manualControl && (status === "paused" || status === "waiting_for_user" || Boolean(this.agent.paused));
    const aura = running && !manualControl && !this.agent.paused;
    const pill = aura || manualControl || paused;
    if (aura && !this.agentChromeStartedAt) this.agentChromeStartedAt = Date.now();
    if (!pill) this.agentChromeStartedAt = 0;
    const label = manualControl
      ? "You have control"
      : paused
        ? (status === "waiting_for_user" ? String(this.agent.message || "Waiting for you") : "Paused")
        : String(this.agent.message || this.agent.task || "Working on your request");
    const payload = pill
      ? {
          aura,
          pill,
          paused,
          manualControl,
          label: label.slice(0, 120),
          startedAt: this.agentChromeStartedAt || Date.now(),
          reducedMotion: Boolean(this.settings.reducedMotion),
          token: this.agentChromeToken,
        }
      : null;
    // Only the visible tab carries the agent layer; any other tab that still
    // has one from an earlier activation is cleaned up.
    for (const [id, tab] of this.tabs) {
      const contents = tab?.view?.webContents;
      if (!contents || contents.isDestroyed()) continue;
      const data = id === this.activeTabId ? payload : null;
      if (!data && !tab.agentChrome) continue;
      tab.agentChrome = Boolean(data);
      await contents.executeJavaScript(agentChromeScript(data), true).catch(() => undefined);
    }
  }

  getState() {
    const active = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    const contents = active?.view?.webContents;
    const readableContents = contents && !contents.isDestroyed() ? contents : null;
    const url = (readableContents && tabUrl(active)) || HOME_URL;
    const bounds = this.surface.bounds;
    return {
      url,
      title: active?.title || "New tab",
      frameVersion: this.frameVersion,
      viewport: { width: bounds.width, height: bounds.height, scrollX: 0, scrollY: 0, pageHeight: bounds.height },
      loading: Boolean(active?.loading),
      elements: [],
      tabs: [...this.tabs.values()].flatMap((tab) => {
        try {
          const tabContents = tab?.view?.webContents;
          if (!tabContents || tabContents.isDestroyed()) return [];
          return [{
            id: tab.id,
            title: tab.title,
            url: tabUrl(tab),
            active: tab.id === this.activeTabId,
            loading: tab.loading,
            favicon: tab.favicon,
            zoom: tab.zoom,
          }];
        } catch {
          return [];
        }
      }),
      activeTabId: this.activeTabId,
      cursor: this.cursor,
      surfaceVisible: this.surface.visible,
      canGoBack: Boolean(readableContents?.navigationHistory.canGoBack()),
      canGoForward: Boolean(readableContents?.navigationHistory.canGoForward()),
      secure: url.startsWith("https://"),
      zoom: active?.zoom || 1,
      history: this.history,
      bookmarks: this.bookmarks,
      recentlyClosed: this.closedTabs,
      downloads: this.downloads,
      settings: this.settings,
      agent: this.agent,
    };
  }

  /**
   * Capture the actual native Chromium surface for API consumers such as Cowork.
   * A hidden Chromium view does not always retain an addressable compositor
   * frame. When a new frame is needed, place Clyra's own opaque UI view above
   * the browser before letting Chromium paint at the normal bounds. The page
   * is genuinely captured but can never flash over Cowork; a cached frame covers
   * repeated reads while the browser has not changed.
   */
  async captureFrame() {
    const contents = this.activeContents();
    if (!contents || contents.isDestroyed()) {
      throw new Error("The active browser tab is unavailable for capture.");
    }
    if (this.lastFrame && this.lastFrameVersion === this.frameVersion) return this.lastFrame;
    if (this.frameCapture) return this.frameCapture;
    this.frameCapture = (async () => {
      const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
      const needsCoveredPaint = Boolean(tab && !this.surface.visible);
      try {
        if (needsCoveredPaint && tab) {
          // Keep the Clyra renderer above the native BrowserView before the
          // latter becomes visible. Re-adding a WebContentsView preserves its
          // contents and bounds, it only adjusts the native stacking order.
          try {
            this.window.contentView.removeChildView(this.uiView);
            this.window.contentView.addChildView(this.uiView);
          } catch {
            // If the host is closing, the capture below returns its normal
            // unavailable error rather than showing a transient browser view.
          }
          tab.view.setBounds(this.surface.bounds);
          tab.view.setVisible(true);
          contents.setBackgroundThrottling(false);
          await new Promise((resolve) => setTimeout(resolve, 34));
        }
        const image = await Promise.race([
          contents.capturePage(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Browser frame capture timed out.")), 4_000)),
        ]);
        if (!image || image.isEmpty()) throw new Error("The active browser tab returned an empty frame.");
        this.lastFrame = image.toJPEG(82);
        this.lastFrameVersion = this.frameVersion;
        return this.lastFrame;
      } catch (error) {
        if (this.lastFrame) return this.lastFrame;
        throw error;
      } finally {
        if (needsCoveredPaint && tab && !tab.view.webContents.isDestroyed()) {
          tab.view.setVisible(false);
          tab.view.setBounds(HIDDEN_SURFACE_BOUNDS);
          tab.view.webContents.setBackgroundThrottling(true);
        }
        this.frameCapture = null;
      }
    })();
    return this.frameCapture;
  }

  /**
   * "Snip & Ask": lets the user drag a rectangle over the live page and
   * returns a pixel-perfect capture of just that region plus any leaf-node
   * text overlapping it. The actual crosshair/drag UI is real DOM injected
   * into the page itself (see `clyraSnipOverlayInjector`) rather than a
   * Clyra-side overlay, so it tracks the page's own scroll/zoom/layout
   * automatically and `capturePage(rect)` — which Electron already scales
   * correctly for devicePixelRatio — can use the exact same coordinates.
   */
  async enterSnipMode(tabId) {
    const tab = this.tabs.get(tabId || this.activeTabId);
    if (!tab) throw new Error("That browser tab is no longer available.");
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) throw new Error("That browser tab is no longer available.");

    const selectionPromise = contents
      .executeJavaScript(`(${clyraSnipOverlayInjector.toString()})()`, true)
      .catch(() => ({ cancelled: true }));

    // Lets `activateTab`/`closeTab` interrupt a snip that's still waiting on
    // a *different, now-hidden* tab, so the toolbar button never spins
    // forever just because the user switched away mid-selection.
    const cancelPromise = new Promise((resolve) => {
      this.pendingSnipCancels.set(tab.id, () => resolve({ cancelled: true }));
    });

    const result = await Promise.race([selectionPromise, cancelPromise]);
    this.pendingSnipCancels.delete(tab.id);

    if (result.cancelled || !result.rect) {
      if (!contents.isDestroyed()) {
        void contents.executeJavaScript(`(${clyraSnipCancelInjector.toString()})()`, true).catch(() => undefined);
      }
      return { cancelled: true };
    }

    const image = await contents.capturePage(result.rect);
    if (!image || image.isEmpty()) throw new Error("The selected region captured empty — try again.");
    return {
      cancelled: false,
      image: image.toDataURL(),
      text: result.text || "",
      rect: result.rect,
      pageUrl: contents.getURL(),
      pageTitle: contents.getTitle(),
    };
  }

  /** Best-effort cleanup when Snip Mode is still active on a tab that's
   *  being switched away from or closed. */
  cancelSnip(tabId) {
    const resolve = this.pendingSnipCancels.get(tabId);
    if (resolve) {
      resolve();
      this.pendingSnipCancels.delete(tabId);
    }
    const tab = this.tabs.get(tabId);
    if (tab && !tab.view.webContents.isDestroyed()) {
      void tab.view.webContents.executeJavaScript(`(${clyraSnipCancelInjector.toString()})()`, true).catch(() => undefined);
    }
  }

  emitState() {
    if (this.destroyed) return;
    // This is consumed by Cowork's live preview. It changes only when the native
    // browser emits real state, so the renderer never polls frames just to
    // manufacture activity.
    this.frameVersion += 1;
    try {
      if (this.uiView?.webContents && !this.uiView.webContents.isDestroyed()) {
        this.uiView.webContents.send("browser:state", this.getState());
      }
    } catch {
      // The shell may already be closing. Native browser state no longer has a
      // renderer to update in that case.
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    void this.saveProfile();
    for (const tab of this.tabs.values()) {
      try {
        if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
      } catch {
        // The BrowserWindow owns this view and can release it first on macOS.
      }
      try {
        if (tab.view?.webContents && !tab.view.webContents.isDestroyed()) {
          tab.view.webContents.endFrameSubscription?.();
          tab.view.webContents.close({ waitForBeforeUnload: false });
        }
      } catch {
        // Closing a renderer that Chromium has already destroyed is harmless.
      }
    }
    this.tabs.clear();
    this.cursorsByTab.clear();
    this.activeTabId = null;
    this.cursor = null;
    this.agentCursorPoint = null;
  }
}

export { HOME_URL, normalizeInput };
