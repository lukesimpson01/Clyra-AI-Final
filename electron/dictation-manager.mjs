import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cleanDictation } from "./dictation-cleanup.mjs";
import { createGestureMachine, startHotkeyListener, pasteWithKeyTap, HOTKEY_LABEL } from "./dictation-hotkey.mjs";
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell, systemPreferences } from "electron";

const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PILL_WIDTH = 270;
const PILL_HEIGHT = 62;
const PILL_MARGIN = 16;

function snapshotClipboard() {
  const formats = clipboard.availableFormats();
  return formats.flatMap((format) => {
    try {
      return [{ format, value: clipboard.readBuffer(format).toString("base64") }];
    } catch {
      return [];
    }
  });
}

function restoreClipboard(snapshot) {
  clipboard.clear();
  for (const item of snapshot || []) {
    try {
      clipboard.writeBuffer(item.format, Buffer.from(item.value, "base64"));
    } catch {
      // Individual proprietary formats can be rejected by the OS; restoring
      // the remaining formats is still safer than leaving dictation text there.
    }
  }
}

async function runAppleScript(script) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
    timeout: 4_000,
    maxBuffer: 64 * 1024,
  });
  return String(stdout || "").trim();
}

async function frontmostApplication() {
  if (process.platform !== "darwin") return "";
  return runAppleScript('tell application "System Events" to get name of first process whose frontmost is true');
}

async function focusApplication(name) {
  if (process.platform !== "darwin" || !name) return;
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
  await runAppleScript(`tell application "${escaped}" to activate`);
  await wait(70);
}

async function readSelectedText() {
  if (process.platform !== "darwin") return "";
  const direct = 'tell application "System Events" to tell (first process whose frontmost is true) to tell (focused UI element of front window) to get value of attribute "AXSelectedText"';
  try {
    const selected = await runAppleScript(direct);
    if (selected) return selected;
  } catch {
    // Some native controls expose no AXSelectedText. This fallback only runs
    // after an explicit global shortcut and restores every clipboard format.
  }
  const saved = snapshotClipboard();
  // A no-selection Cmd+C leaves the clipboard untouched. Seed it with a
  // per-activation marker so stale clipboard text cannot impersonate a
  // selected range and open Replace/Enhance by mistake.
  const marker = `__clyra_selection_probe_${crypto.randomUUID()}__`;
  try {
    clipboard.writeText(marker);
    await runAppleScript('tell application "System Events" to keystroke "c" using command down');
    await wait(70);
    const copied = clipboard.readText();
    return copied === marker ? "" : copied;
  } finally {
    restoreClipboard(saved);
  }
}

function isClyraProcessName(name) {
  return /^clyra$/i.test(String(name || "").trim());
}

export class DictationManager {
  constructor({ uiContents, preloadPath, pillPath, native = null, engine = null, settingsPath = "", cleanupViaService = null }) {
    this.uiContents = uiContents;
    // Standalone ("Clyra closed") pipeline: hidden mic window + main-process
    // speech engine. Used whenever the Clyra UI is not up to do the work itself.
    this.native = native;
    this.engine = engine;
    this.settingsPath = settingsPath;
    this.cleanupViaService = cleanupViaService;
    this.rendererReady = false;
    this.nativeActive = false;
    this.nativeStartPromise = null;
    if (this.native) this.native.onLevel = (level) => { if (this.nativeActive && this.phase === "listening") this.setState({ level: Math.max(0, Math.min(1, level)) }); };
    this.preloadPath = preloadPath;
    this.pillPath = pillPath;
    this.window = null;
    this.phase = "idle";
    this.payload = { phase: "idle" };
    this.target = null;
    this.escapeRegistered = false;
    this.shortcutRegistered = false;
    this.activationId = 0;
    // Primary hotkey: hold/tap Right Option (see dictation-hotkey.mjs). The
    // global shortcut below is the fallback toggle used when the OS key hook
    // is unavailable, and the first free candidate is picked at startup so it
    // never steals a combo another app already owns. Cmd+L is deliberately not
    // used: it is "focus address bar" in every browser.
    this.shortcutCandidates = ["Control+Alt+Space", "Control+Alt+D", "Control+Shift+Space"];
    this.shortcut = this.shortcutCandidates[0];
    this.handsFree = false;
    this.pendingStop = false;
    this.captureRequested = false;
    this.refocus = null;
    this.hotkeyMode = "none";
    this.stopHotkey = null;
    this.machine = createGestureMachine({
      onStart: () => void this.toggle({ manual: true }),
      onStop: () => this.stopFromHotkey(),
      onCancel: () => { if (this.phase !== "idle") this.cancel(); },
      onHandsFree: () => { this.handsFree = true; if (this.phase === "listening") this.setState({ detail: "Hands-free — tap again to finish", handsFree: true }); },
    });
  }

  stopFromHotkey() {
    this.handsFree = false;
    if (this.phase === "arming" && !this.captureRequested) { this.pendingStop = true; return; }
    if (["arming", "listening"].includes(this.phase)) this.requestStop();
  }

  setRendererReady(ready) {
    this.rendererReady = Boolean(ready);
  }

  /** The Clyra UI can do the work only while its renderer is alive and has said so. */
  useRenderer() {
    const contents = this.uiContents();
    return Boolean(this.rendererReady && contents && !contents.isDestroyed());
  }

  requestStop() {
    if (this.nativeActive) { void this.nativeFinish(); return; }
    this.emitUi("dictation:trigger", { type: "stop" });
  }

  readFlowSettings() {
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, "utf8"));
      return {
        level: saved.level === "raw" || saved.level === "polished" ? saved.level : "light",
        dictionary: Array.isArray(saved.dictionary) ? saved.dictionary.map(String).filter(Boolean).slice(0, 80) : [],
      };
    } catch {
      return { level: "light", dictionary: [] };
    }
  }

  writeFlowSettings(settings) {
    if (!this.settingsPath) return;
    try {
      mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      writeFileSync(this.settingsPath, JSON.stringify({ level: settings?.level, dictionary: settings?.dictionary }), "utf8");
    } catch { /* settings are best-effort */ }
  }

  async nativeStart(activationId) {
    this.nativeActive = true;
    const startedAt = Date.now();
    this.nativeStartPromise = this.native.start();
    // Warm the speech model while the user is already talking.
    this.engine?.warm().catch(() => undefined);
    try {
      await this.nativeStartPromise;
    } catch (error) {
      this.nativeActive = false;
      if (activationId === this.activationId) this.setState({ phase: "error", detail: error instanceof Error ? error.message : "Could not start the microphone." });
      return;
    }
    if (activationId !== this.activationId || !this.nativeActive) { this.native.cancel(); this.nativeActive = false; return; }
    console.log(`[flow] microphone live in ${Date.now() - startedAt}ms`);
    this.setState({ phase: "listening", detail: "Listening", level: 0 });
    if (this.pendingStop) { this.pendingStop = false; void this.nativeFinish(); }
  }

  async nativeFinish() {
    if (!this.nativeActive) return;
    this.nativeActive = false;
    this.handsFree = false;
    const activationId = this.activationId;
    this.setState({ phase: "processing", detail: "Transcribing", level: 0 });
    try {
      await this.nativeStartPromise?.catch(() => undefined);
      const pcm = await this.native.stop();
      if (pcm.length < 16_000 * 2 * 0.25) throw new Error("No speech was detected.");
      const raw = await this.engine.transcribe(pcm);
      if (activationId !== this.activationId) return;
      if (!raw) throw new Error("No speech was detected.");
      this.setState({ phase: "processing", detail: "Cleaning up" });
      const { level, dictionary } = this.readFlowSettings();
      const application = this.target?.application || "";
      const local = cleanDictation(raw, { level, dictionary, application });
      let text = local.text || raw;
      // Language-model polish only for messy self-corrections / "polished" mode, and only when
      // the Clyra service happens to be up; otherwise the local pass above is the result.
      if (local.needsModel && local.kind !== "code" && this.cleanupViaService) {
        text = (await this.cleanupViaService({ transcript: raw, level, dictionary, application }).catch(() => "")) || text;
      }
      if (activationId !== this.activationId) return;
      const result = await this.insert({ text, target: this.target || {} });
      const copiedOnly = result?.method === "clipboard-only";
      this.setState({ phase: "done", detail: copiedOnly ? String(result.note || "Copied — press ⌘V to paste") : "Inserted" });
      setTimeout(() => { if (activationId === this.activationId && this.phase === "done") this.setState({ phase: "idle", detail: "" }); }, copiedOnly ? 3200 : 850);
    } catch (error) {
      if (activationId !== this.activationId) return;
      const message = (error instanceof Error ? error.message : String(error || "")).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      this.setState({ phase: "error", detail: message || "Clyra dictation failed." });
    }
  }

  hotkeyInfo() {
    return { mode: this.hotkeyMode, hotkey: this.hotkeyMode === "hold" ? HOTKEY_LABEL : this.shortcut, fallback: this.shortcutRegistered ? this.shortcut : "" };
  }

  isSender(contents) {
    return Boolean(contents && (contents.id === this.uiContents()?.id || contents.id === this.window?.webContents.id));
  }

  async initialize() {
    // The pill's buttons must work with no Clyra window, so this IPC lives here.
    ipcMain.removeAllListeners("dictation:pill-action");
    ipcMain.on("dictation:pill-action", (event, action) => {
      if (!this.window || event.sender.id !== this.window.webContents.id) return;
      void this.action(String(action || "cancel"));
    });
    this.shortcut = this.shortcutCandidates.find((candidate) => {
      globalShortcut.unregister(candidate);
      if (globalShortcut.isRegistered(candidate)) return false;
      this.shortcutRegistered = globalShortcut.register(candidate, () => void this.toggle());
      return this.shortcutRegistered;
    }) || this.shortcutCandidates[0];
    if (!this.shortcutRegistered) console.warn("[flow] every fallback dictation shortcut is owned by another app.");
    this.stopHotkey = process.env.CLYRA_DISABLE_KEY_HOOK === "1" ? null : startHotkeyListener(this.machine);
    this.hotkeyMode = this.stopHotkey ? "hold" : this.shortcutRegistered ? "toggle" : "none";
    if (!this.stopHotkey && process.platform === "darwin" && process.env.CLYRA_DISABLE_KEY_HOOK !== "1") this.awaitHotkeyPermission();
    console.log(`[flow] hotkey ready: ${this.hotkeyMode === "hold" ? HOTKEY_LABEL + " (hold = push-to-talk, tap = hands-free)" : this.shortcut}`);
  }

  /**
   * Right-Option needs macOS Accessibility. Ask once, then keep checking so the
   * better hotkey switches on the moment the user ticks Clyra in Settings
   * (no relaunch), while the fallback shortcut works in the meantime.
   */
  awaitHotkeyPermission() {
    let trusted = false;
    try { trusted = systemPreferences.isTrustedAccessibilityClient(true); } catch { /* ignore */ }
    let attempts = 0;
    this.permissionTimer = setInterval(() => {
      attempts += 1;
      let ok = false;
      try { ok = systemPreferences.isTrustedAccessibilityClient(false); } catch { /* ignore */ }
      if (ok || trusted) {
        this.stopHotkey = startHotkeyListener(this.machine);
        if (this.stopHotkey) {
          this.hotkeyMode = "hold";
          console.log(`[flow] hotkey upgraded: ${HOTKEY_LABEL} (hold = push-to-talk, tap = hands-free)`);
        }
        if (this.stopHotkey || attempts > 5) { clearInterval(this.permissionTimer); this.permissionTimer = null; }
      }
      if (attempts > 200) { clearInterval(this.permissionTimer); this.permissionTimer = null; }
    }, 3000);
  }

  destroy() {
    if (this.permissionTimer) clearInterval(this.permissionTimer);
    this.stopHotkey?.();
    this.stopHotkey = null;
    globalShortcut.unregister(this.shortcut);
    this.shortcutRegistered = false;
    this.unregisterEscape();
    this.window?.destroy();
    this.window = null;
  }

  /** macOS mic / camera / accessibility status for actionable UI copy. */
  async permissionStatus() {
    if (process.platform !== "darwin") {
      return { microphone: "unknown", camera: "unknown", accessibility: true, trusted: true };
    }
    let microphone = "unknown";
    let camera = "unknown";
    try {
      microphone = systemPreferences.getMediaAccessStatus("microphone");
    } catch {
      microphone = "unknown";
    }
    try {
      camera = systemPreferences.getMediaAccessStatus("camera");
    } catch {
      camera = "unknown";
    }
    let accessibility = true;
    try {
      accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      accessibility = true;
    }
    return { microphone, camera, accessibility, trusted: accessibility };
  }

  micAppLabel() {
    // After tools/patch-electron-macos-privacy.mjs, desktop:dev lists as "Clyra".
    // Fall back to Electron only when the patched name is unavailable.
    try {
      const name = String(app.getName?.() || "").trim();
      if (name && !/^electron$/i.test(name)) return name;
    } catch {
      // ignore
    }
    return process.env.CLYRA_ELECTRON_DEV === "1" ? "Clyra" : "Clyra";
  }

  mediaBlockedMessage(kind = "microphone", status = "denied") {
    const appLabel = this.micAppLabel();
    const label = kind === "camera" ? "Camera" : "Microphone";
    if (process.platform === "win32") {
      return `${label} access is blocked. Opening Windows Settings → Privacy → ${label} so you can enable ${appLabel}.`;
    }
    if (status === "restricted") {
      return `${label} access is restricted by the system. Opening System Settings → Privacy & Security → ${label} so you can enable ${appLabel}.`;
    }
    return `${label} access is blocked. Opening System Settings → Privacy & Security → ${label} and turn on “${appLabel}”.`;
  }

  micBlockedMessage(status = "denied") {
    return this.mediaBlockedMessage("microphone", status);
  }

  async ensureMediaAccess(mediaType = "microphone") {
    if (process.platform === "linux") return { ok: true, status: "unknown", mediaType };
    if (process.platform === "win32") {
      // Windows has no askForMediaAccess equivalent; Chromium still prompts /
      // respects Privacy settings. If getUserMedia later fails we open Settings.
      return { ok: true, status: "unknown", mediaType };
    }
    const kind = mediaType === "camera" ? "camera" : "microphone";
    let status = "unknown";
    try {
      status = systemPreferences.getMediaAccessStatus(kind);
    } catch {
      // Prefer attempting capture over hard-failing when the TCC query fails.
      return { ok: true, status: "unknown", mediaType: kind };
    }
    if (status === "granted") return { ok: true, status, mediaType: kind };

    // Always attempt the native prompt once. After we re-identity Electron.app
    // for TCC, a stale "denied" from the shared com.github.Electron bundle can
    // clear into a real prompt for ai.clyra.desktop.dev / "Clyra".
    if (status === "not-determined" || status === "unknown" || status === "denied") {
      try {
        const granted = await systemPreferences.askForMediaAccess(kind);
        if (granted) return { ok: true, status: "granted", mediaType: kind };
      } catch (error) {
        await this.openPrivacySettings(kind);
        return {
          ok: false,
          status: "denied",
          mediaType: kind,
          error: this.mediaBlockedMessage(kind, "denied"),
          cause: error instanceof Error ? error.message : String(error || ""),
        };
      }
    }

    if (status === "restricted") {
      await this.openPrivacySettings(kind);
      return {
        ok: false,
        status,
        mediaType: kind,
        error: this.mediaBlockedMessage(kind, status),
      };
    }

    await this.openPrivacySettings(kind);
    return {
      ok: false,
      status: "denied",
      mediaType: kind,
      error: this.mediaBlockedMessage(kind, "denied"),
    };
  }

  async ensureMicrophoneAccess() {
    return this.ensureMediaAccess("microphone");
  }

  async ensureCameraAccess() {
    return this.ensureMediaAccess("camera");
  }

  /**
   * Place the pill near the bottom of the display under the cursor,
   * horizontally centred — stable and easy to find outside the app.
   */
  positionPill() {
    if (!this.window || this.window.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    const px = Math.round(x + (width - PILL_WIDTH) / 2);
    const py = Math.round(y + height - PILL_HEIGHT - Math.max(PILL_MARGIN, 28));
    this.window.setBounds({ x: px, y: py, width: PILL_WIDTH, height: PILL_HEIGHT });
  }

  async openPrivacySettings(kind = "microphone") {
    // Prefer the OS `open` / `start` CLIs — shell.openExternal often no-ops on
    // preference-pane URLs (especially on newer macOS System Settings).
    const pane = kind === "camera" ? "Privacy_Camera" : "Privacy_Microphone";
    if (process.platform === "darwin") {
      const candidates = [
        `x-apple.systempreferences:com.apple.preference.security?${pane}`,
        `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${pane}`,
        "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension",
      ];
      for (const url of candidates) {
        try {
          await execFileAsync("open", [url], { timeout: 4_000 });
          return { ok: true };
        } catch {
          // Try the next deep-link style used across macOS versions.
        }
      }
      try {
        await execFileAsync("open", ["/System/Library/PreferencePanes/Security.prefPane"], { timeout: 4_000 });
        return { ok: true };
      } catch {
        await shell.openExternal(candidates[0]).catch(() => undefined);
        return { ok: true };
      }
    }
    if (process.platform === "win32") {
      const uri = kind === "camera" ? "ms-settings:privacy-webcam" : "ms-settings:privacy-microphone";
      try {
        // Empty title arg keeps `start` from treating the URI as a window title.
        await execFileAsync("cmd", ["/c", "start", "", uri], { timeout: 4_000, windowsHide: true });
        return { ok: true };
      } catch {
        await shell.openExternal(uri).catch(() => undefined);
        return { ok: true };
      }
    }
    return { ok: false };
  }

  async openMicrophoneSettings() {
    return this.openPrivacySettings("microphone");
  }

  async openCameraSettings() {
    return this.openPrivacySettings("camera");
  }

  ensurePill() {
    if (this.window && !this.window.isDestroyed()) {
      this.positionPill();
      return this.window;
    }
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    this.window = new BrowserWindow({
      // The content grows from a circle within this transparent canvas, which
      // keeps the expansion optically centred on any display.
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      x: Math.round(x + (width - PILL_WIDTH) / 2),
      y: Math.round(y + height - PILL_HEIGHT - Math.max(PILL_MARGIN, 28)),
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: true,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      fullscreenable: false,
      title: "Clyra Dictation",
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: "no-user-gesture-required",
        backgroundThrottling: false,
      },
    });
    this.window.setAlwaysOnTop(true, "floating");
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (process.platform === "darwin") {
      try {
        this.window.setWindowButtonVisibility(false);
      } catch {
        // Older Electron builds may not expose this helper.
      }
    }
    this.positionPill();
    this.window.loadFile(this.pillPath).catch(() => undefined);
    this.window.webContents.once("did-finish-load", () => this.emitPill());
    this.window.on("closed", () => { this.window = null; });
    return this.window;
  }

  emitPill() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("dictation:pill-state", this.payload);
  }

  emitUi(channel, payload) {
    const contents = this.uiContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  }

  setState(payload) {
    this.payload = { ...this.payload, ...payload };
    if (payload.phase === "idle" || payload.phase === "arming") this.payload.handsFree = false;
    this.phase = this.payload.phase || "idle";
    if (this.phase === "idle") {
      this.handsFree = false;
      this.pendingStop = false;
      this.captureRequested = false;
      this.machine.reset();
      this.unregisterEscape();
      const current = this.window;
      if (current && !current.isDestroyed()) setTimeout(() => current.hide(), 650);
    } else {
      const pill = this.ensurePill();
      this.positionPill();
      // showInactive keeps the user's target app focused while the overlay appears.
      pill.showInactive();
      this.registerEscape();
    }
    this.emitPill();
  }

  registerEscape() {
    if (this.escapeRegistered) return;
    this.escapeRegistered = globalShortcut.register("Escape", () => this.cancel());
  }

  unregisterEscape() {
    if (!this.escapeRegistered) return;
    globalShortcut.unregister("Escape");
    this.escapeRegistered = false;
  }

  async toggle({ manual = false } = {}) {
    if (["listening", "processing", "optimising"].includes(this.phase) || (this.phase === "arming" && this.captureRequested)) {
      this.handsFree = false;
      this.requestStop();
      return;
    }
    if (this.phase === "selection" || this.phase === "preview") {
      this.cancel();
      return;
    }
    if (this.phase === "error" || this.phase === "done") {
      // Same shortcut clears a prior failure and starts a fresh capture so the
      // user is not stuck on an error pill until Escape.
      // The renderer is already idle in these phases, and sending it "cancel"
      // makes it publish phase "idle" AFTER the new session below has begun,
      // which used to hide the fresh pill (found by driving the real app).
      this.activationId += 1;
      this.target = null;
    }
    // Do not wait on macOS accessibility APIs before showing the shortcut UI.
    // They can be slow when another app is busy, which used to make Cmd+L
    // feel broken even though the global shortcut had fired.
    const activationId = ++this.activationId;
    this.target = { application: "", selectedText: "" };
    this.setState({ phase: "arming", detail: "" });

    const mic = await this.ensureMicrophoneAccess();
    if (activationId !== this.activationId || this.phase === "idle") return;
    if (!mic.ok) {
      this.setState({ phase: "error", detail: mic.error });
      return;
    }

    // Open the mic FIRST. The frontmost-app / selection lookups go through
    // AppleScript and can take hundreds of ms; they now run alongside mic
    // start-up and are delivered as a "target" update before anything is inserted.
    this.captureRequested = true;
    this.target = { application: "", selectedText: "" };
    this.setState({ phase: "arming", application: "", selectedText: "", detail: "" });
    if (!this.useRenderer() && this.native && this.engine) {
      // Clyra's UI isn't up (closed, hidden at login, or still booting): run the
      // standalone pipeline so the hotkey works instantly regardless.
      void this.nativeStart(activationId);
    } else {
      this.emitUi("dictation:trigger", { type: "start", target: { ...this.target }, manual: true });
      if (this.pendingStop) {
        // Released before the mic was requested: the renderer defers the stop
        // until capture is live, so nothing said is lost and nothing hangs.
        this.pendingStop = false;
        this.emitUi("dictation:trigger", { type: "stop" });
      }
    }

    const [application, selectedText] = await Promise.all([
      frontmostApplication().catch(() => ""),
      readSelectedText().catch(() => ""),
    ]);
    if (activationId !== this.activationId || this.phase === "idle") return;
    // Selection is context, not a separate mode. This lets someone select a
    // paragraph and simply say “make this friendlier” without learning UI.
    this.target = { application, selectedText };
    this.setState({ application, selectedText: selectedText.slice(0, 260) });
    if (!this.nativeActive) this.emitUi("dictation:trigger", { type: "target", target: this.target });
  }

  async action(action) {
    if (action === "cancel") return this.cancel();
    if (action === "stop") {
      // The pill's stop button: end capture and transcribe right now. Clicking
      // the pill can activate Clyra, so put the app being dictated into back in
      // front while transcription runs; insert() waits for this before pasting.
      this.handsFree = false;
      const intended = this.target?.application;
      if (intended && process.platform === "darwin" && !isClyraProcessName(intended)) {
        this.refocus = frontmostApplication()
          .then((current) => (current === intended ? undefined : focusApplication(intended)))
          .catch(() => undefined);
      }
      if (["arming", "listening"].includes(this.phase)) this.requestStop();
      return;
    }
    // A click on the visible pill focuses Clyra temporarily. Restore the app
    // selected at activation before asking the renderer to open the mic so
    // the later paste cannot land in Clyra's own window.
    await focusApplication(this.target?.application).catch(() => undefined);
    // Keep the exact same full pill visible while the renderer opens the
    // microphone. Previously the compact Replace/Enhance chooser could linger
    // when Clyra was hidden, which made the next state look like a separate
    // menu rather than the normal dictation flow.
    this.setState({
      phase: "processing",
      detail: action === "enhance" || action === "optimise" ? "Preparing rewrite" : "Opening microphone",
    });
    this.emitUi("dictation:action", { action, target: this.target });
  }

  cancel() {
    this.activationId += 1;
    if (this.nativeActive) { this.native?.cancel(); this.nativeActive = false; }
    this.emitUi("dictation:trigger", { type: "cancel" });
    this.target = null;
    this.setState({ phase: "idle", detail: "" });
  }

  /**
   * macOS only allows synthetic Cmd+V with Accessibility permission. Without
   * it, keep the transcript on the clipboard (never lose the user's words),
   * ask macOS to show its permission prompt, and tell the pill to say so.
   */
  clipboardOnly(text) {
    clipboard.writeText(text);
    try { systemPreferences.isTrustedAccessibilityClient(true); } catch { /* prompt is best-effort */ }
    return { ok: true, method: "clipboard-only", note: "Copied — press ⌘V to paste" };
  }

  async insert({ text, target }) {
    if (!text?.trim()) throw new Error("Clyra received no text to insert.");
    // Test hook: report instead of pasting into whatever app is in front.
    if (process.env.CLYRA_FLOW_DRY_RUN === "1") {
      console.log(`[flow] dry-run insert (${target?.application || "unknown app"}): ${JSON.stringify(text)}`);
      return { ok: true, method: "dry-run" };
    }
    if (process.platform === "win32") {
      // The Flow window is shown inactive, so the user's original field still
      // owns focus. Clipboard is only a guarded fallback and is restored even
      // if SendKeys fails, avoiding the old “text copied but not inserted” lie.
      const saved = snapshotClipboard();
      try {
        clipboard.writeText(text);
        await wait(30);
        if (pasteWithKeyTap()) { await wait(120); return { ok: true, method: "keytap" }; }
        await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"], { timeout: 4_000, windowsHide: true });
        await wait(120);
        return { ok: true, method: "clipboard-fallback" };
      } catch (error) {
        throw error instanceof Error ? error : new Error("Clyra could not paste into the active Windows field.");
      } finally { restoreClipboard(saved); }
    }
    if (process.platform !== "darwin") throw new Error("Native insertion is currently supported on macOS and Windows only.");
    // A click on the pill may have activated Clyra: wait for the refocus started
    // in action("stop") so the paste lands in the app the user was typing in.
    if (this.refocus) { await this.refocus; this.refocus = null; }
    let trustedNow = true;
    try { trustedNow = systemPreferences.isTrustedAccessibilityClient(false); } catch { trustedNow = true; }
    if (!trustedNow) return this.clipboardOnly(text);
    // Fast path (~150ms): the pill is a non-activating panel, so the app being
    // dictated into is still frontmost; post Cmd+V directly with no AppleScript.
    {
      const savedFast = snapshotClipboard();
      try {
        clipboard.writeText(text);
        await wait(30);
        if (pasteWithKeyTap()) { await wait(140); return { ok: true, method: "keytap" }; }
      } finally {
        restoreClipboard(savedFast);
      }
    }
    const intended = String(target?.application || this.target?.application || "").trim();
    let current = await frontmostApplication().catch(() => "");

    if (intended && current !== intended) {
      await focusApplication(intended).catch(() => undefined);
      current = await frontmostApplication().catch(() => "");
      if (current !== intended) {
        throw new Error(`Focus moved away from ${intended}. Click back into that app, then use the dictation hotkey again.`);
      }
    } else if (!intended && isClyraProcessName(current)) {
      // We never learned the target app (usually missing Accessibility) and
      // Clyra is frontmost — refuse to paste into ourselves with a vague error.
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      if (!trusted) {
        throw new Error("Clyra needs Accessibility permission in System Settings → Privacy & Security → Accessibility to paste into other apps.");
      }
      throw new Error("Click into the app where you want the text, then use the dictation hotkey again.");
    }

    const saved = snapshotClipboard();
    try {
      clipboard.writeText(text);
      await wait(55);
      await runAppleScript('tell application "System Events" to keystroke "v" using command down');
      await wait(150);
      return { ok: true };
    } catch (error) {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      if (!trusted) return this.clipboardOnly(text);
      throw error instanceof Error ? error : new Error("Clyra could not paste the transcribed text.");
    } finally {
      restoreClipboard(saved);
    }
  }
}
