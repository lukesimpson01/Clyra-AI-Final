import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cleanDictation, looksLikeInstruction } from "./dictation-cleanup.mjs";
import { hasEdits, wordDiff } from "./word-diff.mjs";
import { FlowSession, joinPhrases } from "./flow-session.mjs";
import { createTapMachine, startHotkeyListener, pasteWithKeyTap, HOTKEY_PRESETS, DEFAULT_HOTKEY } from "./dictation-hotkey.mjs";
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen, shell, systemPreferences } from "electron";

const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PILL_WIDTH = 270;
const PILL_HEIGHT = 62;
const PILL_MARGIN = 16;
// While the transcript is shown the transparent canvas grows; the capsule stays anchored to the bottom.
const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 212;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The one-time process-type switch that macOS needs to let a window sit over full-screen apps. It flickers the
// Dock, so it happens once while the app boots (the first pill window is built at launch), never during a dictation.
let fullScreenTransformDone = false;
const PREVIEW_PHASES = new Set(["refining", "revealing"]);

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

/**
 * Put the user's clipboard back AFTER the target app has had time to read our paste. Restoring right
 * after Cmd+V races slow apps (they read the pasteboard late and paste the old contents instead).
 * Only restores if the clipboard still holds what we put there, so a copy made meanwhile is never lost.
 */
function restoreClipboardLater(snapshot, pasted, delay = 1_400) {
  const timer = setTimeout(() => {
    try { if (clipboard.readText() === pasted) restoreClipboard(snapshot); } catch { /* best effort */ }
  }, delay);
  timer.unref?.();
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

/**
 * Frontmost app, its front window rectangle (to put the pill on the right display) and any selected text,
 * in ONE osascript run. It happens while you are already speaking, so it must be cheap: no second process,
 * and no synthetic Cmd+C (which could fire in the wrong app and copied on every single dictation).
 */
async function frontmostContext() {
  if (process.platform !== "darwin") return { application: "", rect: null, selectedText: "" };
  const script = `tell application "System Events"
  set p to first process whose frontmost is true
  set n to name of p
  set rs to (ASCII character 30)
  -- Chromium/Electron apps only build their accessibility tree when asked; do it now so
  -- "is a text field focused?" can be answered reliably when the paste happens seconds later.
  try
    set value of attribute "AXManualAccessibility" of p to true
  end try
  set r to ""
  try
    set {px, py} to position of front window of p
    set {sw, sh} to size of front window of p
    set r to (px as text) & "," & (py as text) & "," & (sw as text) & "," & (sh as text)
  end try
  set s to ""
  try
    set s to value of attribute "AXSelectedText" of (value of attribute "AXFocusedUIElement" of p)
    if s is missing value then set s to ""
  end try
  return n & rs & r & rs & s
end tell`;
  const out = await runAppleScript(script);
  const [application = "", rectText = "", ...selection] = out.split("\x1e");
  const nums = rectText.split(",").map((value) => Number(value.trim()));
  const rect = nums.length === 4 && nums.every((value) => Number.isFinite(value)) ? { x: nums[0], y: nums[1], width: nums[2], height: nums[3] } : null;
  return { application: application.trim(), rect, selectedText: selection.join("\x1e") };
}

/**
 * What has keyboard focus in the frontmost app? Decides between pasting and "saved to clipboard".
 *  editable  -> a real text field/area: paste
 *  ambiguous -> a web area / group (could be a rich editor): paste, and keep a copy on the clipboard
 *  none / blocked -> nothing editable is focused: do NOT paste, save to the clipboard
 */
async function focusedElementKind() {
  if (process.platform !== "darwin") return { kind: "unknown", role: "" };
  const script = `tell application "System Events"
  set p to first process whose frontmost is true
  try
    set value of attribute "AXManualAccessibility" of p to true
  end try
  try
    set fe to value of attribute "AXFocusedUIElement" of p
    return value of attribute "AXRole" of fe
  on error errMsg
    return "ERR:" & errMsg
  end try
end tell`;
  let out = "";
  try { out = await runAppleScript(script); } catch { return { kind: "unknown", role: "" }; }
  if (out.startsWith("ERR:")) return /missing value/i.test(out) ? { kind: "none", role: "" } : { kind: "unknown", role: "" };
  const role = out.trim();
  if (["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField"].includes(role)) return { kind: "editable", role };
  // Only controls that can never take typed text are "blocked". Everything else (web areas, rich editors,
  // custom canvases, table cells...) may well be a text field, so we paste and keep a copy on the clipboard.
  if (["AXButton", "AXImage", "AXRadioButton", "AXCheckBox", "AXMenuItem", "AXMenuBarItem", "AXMenu", "AXMenuButton", "AXToolbar", "AXSlider", "AXProgressIndicator", "AXScrollBar", "AXPopUpButton", "AXTabGroup", "AXDisclosureTriangle", "AXStaticText"].includes(role)) return { kind: "blocked", role };
  return { kind: "ambiguous", role };
}

async function focusApplication(name) {
  if (process.platform !== "darwin" || !name) return;
  const escaped = String(name).replace(/\\/g, "\\\\").replace(/\"/g, '\\\"');
  await runAppleScript(`tell application "${escaped}" to activate`);
  await wait(70);
}

function isClyraProcessName(name) {
  return /^clyra$/i.test(String(name || "").trim());
}

export { joinPhrases };

export class DictationManager {
  constructor({ uiContents, preloadPath, pillPath, native = null, engine = null, settingsPath = "", cleanupViaService = null, optimiseViaService = null }) {
    this.uiContents = uiContents;
    // Standalone ("Clyra closed") pipeline: hidden mic window + main-process
    // speech engine. Used whenever the Clyra UI is not up to do the work itself.
    this.native = native;
    this.engine = engine;
    this.settingsPath = settingsPath;
    this.cleanupViaService = cleanupViaService;
    this.optimiseViaService = optimiseViaService;
    this.userPosition = null; // set when the user drags the pill; null = default centred near the bottom
    this.rendererReady = false;
    this.nativeActive = false;
    this.nativeStartPromise = null;
    this.session = null;
    if (this.native) {
      // Every captured chunk goes straight to the session, which does its own voice detection on the audio.
      this.native.onPcm = (chunk) => { if (this.nativeActive && this.phase === "listening") this.session?.feed(chunk); };
      this.native.onFull = () => { if (this.nativeActive) void this.nativeFinish(); };
    }
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
    this.shortcutCandidates = ["Control+Space", "Control+Alt+Space", "Control+Alt+D", "Control+Shift+Space"];
    this.shortcut = this.shortcutCandidates[0];
    this.handsFree = false;
    this.pendingStop = false;
    this.captureRequested = false;
    this.refocus = null;
    this.autoStop = false;
    this.fellBack = false;
    this.watchdog = null;
    this.spare = null;
    this.previewActive = false;
    this.targetDisplayId = null;
    this.hotkeyMode = "none";
    this.stopHotkey = null;
    // Every press of the hotkey toggles: press to start, press again to stop. (Hands-free and
    // silence auto-stop apply to every session; there is no hold-to-talk.)
    this.machine = createTapMachine({
      onTap: () => this.hotkeyPressed(),
      onPress: () => this.prewarm(),
      onAbort: () => this.cooldown(),
    });
  }

  /** Key-down: open the mic and wake the speech model now, so nothing said right after the tap is lost. */
  prewarm() {
    if (this.nativeActive || !this.native || !this.engine?.available || !["idle", "done", "error"].includes(this.phase)) return;
    this.native.warm();
    this.engine.warm().catch(() => undefined);
  }

  /** The key press was not a dictation tap (held, or used with another key): release the mic again. */
  cooldown() {
    if (this.nativeActive || this.captureRequested) return;
    this.native?.cool();
  }

  hotkeyPressed() {
    this.handsFree = false;
    // A second press before the recorder has even been requested: remember it and stop as soon as it is live.
    if (this.phase === "arming" && !this.captureRequested) { this.pendingStop = true; return; }
    void this.toggle({ manual: false });
  }

  /** Hands-free / toggle sessions end on their own once you stop talking. */
  enableAutoStop() {
    this.autoStop = true;
    this.heardSpeech = false;
    this.lastSpeechAt = Date.now();
    this.emitUi("dictation:trigger", { type: "autostop" });
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
    console.log(`[flow] stop requested (phase=${this.phase}, ${this.nativeActive ? "native" : "renderer"})`);
    if (this.nativeActive) { void this.nativeFinish(); return; }
    this.emitUi("dictation:trigger", { type: "stop" });
    // If the UI recorder never acknowledges (reloading, crashed), don't leave the pill stuck.
    const activation = this.activationId;
    setTimeout(() => {
      if (activation === this.activationId && (this.phase === "listening" || this.phase === "arming")) this.forceReset("Dictation stopped responding. Press the hotkey to try again.");
    }, 5_000);
  }

  readFlowSettings() {
    try {
      const saved = JSON.parse(readFileSync(this.settingsPath, "utf8"));
      return {
        level: saved.level === "raw" || saved.level === "polished" ? saved.level : "light",
        dictionary: Array.isArray(saved.dictionary) ? saved.dictionary.map(String).filter(Boolean).slice(0, 80) : [],
        hotkey: typeof saved.hotkey === "string" ? saved.hotkey : DEFAULT_HOTKEY,
        // Sessions end on their own when you stop talking; "pace" is how patient that is.
        autoStop: saved.autoStop !== false,
        pace: saved.pace === "fast" || saved.pace === "patient" ? saved.pace : "balanced",
      };
    } catch {
      return { level: "light", dictionary: [], hotkey: DEFAULT_HOTKEY, autoStop: true, pace: "balanced" };
    }
  }

  writeFlowSettings(settings) {
    if (!this.settingsPath) return;
    try {
      mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      let existing = {};
      try { existing = JSON.parse(readFileSync(this.settingsPath, "utf8")); } catch { /* first write */ }
      const merged = { ...existing };
      for (const key of ["level", "dictionary", "hotkey", "autoStop", "pace"]) if (settings?.[key] !== undefined) merged[key] = settings[key];
      writeFileSync(this.settingsPath, JSON.stringify(merged), "utf8");
    } catch { /* settings are best-effort */ }
  }

  async nativeStart(activationId) {
    this.nativeActive = true;
    const startedAt = Date.now();
    this.nativeStartedAt = startedAt;
    this.session?.close();
    this.session = null;
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
    const { autoStop, pace } = this.readFlowSettings();
    const session = new FlowSession({
      audio: (start, end) => this.native.slice(start, end),
      transcribe: (pcm) => this.engine.transcribe(pcm),
      autoStop: this.autoStop && autoStop,
      pace,
      onLive: (text) => { if (this.session === session && this.nativeActive && this.phase === "listening" && text !== this.payload.partial) this.setState({ partial: text }); },
      onMeter: (meter) => { if (this.session === session) this.pushMeter(meter); },
      onEnd: (reason) => {
        if (this.session !== session || !this.nativeActive) return;
        console.log(`[flow] auto-stop: ${reason} after ${Math.round(session.timeMs)}ms of audio (needed ${session.stats.requiredMs}ms of silence)`);
        if (reason === "no-speech") this.forceReset("Didn't hear anything. Tap the hotkey and speak.");
        else void this.nativeFinish();
      },
    });
    this.session = session;
    this.setState({ phase: "listening", detail: "Listening", level: 0, ending: 0, partial: "" });
    // The audio recorded between key-down and now (the pre-roll) is analysed first, so byte offsets line up.
    const preRoll = this.native.slice(0);
    if (preRoll.length) session.feed(preRoll);
    if (this.pendingStop) { this.pendingStop = false; void this.nativeFinish(); }
  }

  /**
   * Loudness and the auto-stop countdown, a few times a second. The floating pill gets them on their own light
   * channel (it animates between updates itself), so nothing re-renders the transcript just to move a waveform.
   */
  pushMeter({ level, ending }) {
    if (!this.nativeActive || this.phase !== "listening") return;
    const now = Date.now();
    const urgent = (ending > 0) !== ((this.lastMeter?.ending || 0) > 0);
    if (!urgent && now - (this.lastMeterAt || 0) < 66) return;
    this.lastMeterAt = now;
    this.lastMeter = { level: Math.round(level * 1000) / 1000, ending: Math.round(ending * 1000) / 1000 };
    this.payload.level = this.lastMeter.level;
    this.payload.ending = this.lastMeter.ending;
    if (this.inline) { this.emitUi("dictation:state", this.payload); return; }
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send("dictation:pill-meter", this.lastMeter);
  }

  async nativeFinish() {
    if (!this.nativeActive) return;
    this.nativeActive = false;
    this.handsFree = false;
    const activationId = this.activationId;
    const session = this.session;
    const stopAt = Date.now();
    this.setState({ phase: "processing", detail: "Transcribing", level: 0, ending: 0 });
    try {
      await this.nativeStartPromise?.catch(() => undefined);
      const pcm = await this.native.stop();
      if (pcm.length < 16_000 * 2 * 0.25) throw new Error("Didn't hear anything. Tap the hotkey and speak.");
      let raw = "";
      if (session) {
        // The capture store is recycled by the next recording: from here the session reads the finished take.
        session.audio = (start, end = pcm.length) => pcm.subarray(Math.max(0, start - (start % 2)), Math.min(pcm.length, end));
        raw = await session.finish(pcm.length);
        console.log(`[flow] transcript ready ${Date.now() - stopAt}ms after stop (${session.stats.decodes} decodes${session.stats.speculativeHits ? ", final text was already decoded during the pause" : ""})`);
      } else {
        raw = await this.engine.transcribe(pcm);
      }
      if (activationId !== this.activationId) return;
      if (!raw) throw new Error("Didn't catch that. Tap the hotkey and try again.");
      this.setState({ phase: "processing", detail: "Transcribing", partial: raw });
      const { level, dictionary } = this.readFlowSettings();
      const application = this.target?.application || "";
      // Text is selected: speech that sounds like an instruction ("make it sound smarter") is applied to
      // the selection by the AI; anything else simply replaces the selection when pasted.
      const selected = String(this.target?.selectedText || "").trim();
      if (selected && looksLikeInstruction(raw) && this.optimiseViaService) {
        this.setState({ phase: "optimising", detail: "Rewriting", partial: raw, edit: "rewrite" });
        const rewritten = await this.optimiseViaService({ selectedText: selected, instruction: raw }).catch(() => "");
        if (activationId !== this.activationId) return;
        if (!rewritten) throw new Error("Couldn't reach Clyra's AI to rewrite the selection. Your selection is unchanged.");
        const rewrittenResult = await this.presentAndInsert({ raw: selected, text: rewritten, target: this.target || {} });
        const clipOnly = rewrittenResult?.method === "clipboard-only";
        this.setState({ phase: "done", detail: String(rewrittenResult?.note || "Rewritten"), clipboard: clipOnly, resultText: rewritten });
        setTimeout(() => { if (activationId === this.activationId && this.phase === "done") this.setState({ phase: "idle", detail: "", clipboard: false }); }, this.inline ? 700 : clipOnly ? 4_200 : 1_500);
        return;
      }
      if (selected) this.setState({ edit: "replace" });
      const local = cleanDictation(raw, { level, dictionary, application });
      let text = local.text || raw;
      // Language-model polish only for messy self-corrections / "polished" mode, and only when
      // the Clyra service happens to be up; otherwise the local pass above is the result.
      if (local.needsModel && local.kind !== "code" && this.cleanupViaService) {
        text = (await this.cleanupViaService({ transcript: raw, level, dictionary, application }).catch(() => "")) || text;
      }
      if (activationId !== this.activationId) return;
      const result = await this.presentAndInsert({ raw, text, target: this.target || {} });
      const copiedOnly = result?.method === "clipboard-only";
      this.setState({ phase: "done", detail: String(result?.note || "Inserted"), clipboard: copiedOnly, resultText: text });
      setTimeout(() => { if (activationId === this.activationId && this.phase === "done") this.setState({ phase: "idle", detail: "", clipboard: false }); }, this.inline ? 700 : copiedOnly ? 4_200 : 1_500);
    } catch (error) {
      if (activationId !== this.activationId) return;
      const message = (error instanceof Error ? error.message : String(error || "")).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
      this.setState({ phase: "error", detail: message || "Clyra dictation failed." });
    } finally {
      if (this.session === session) this.session = null;
    }
  }

  pillInfo() {
    const w = this.window;
    if (!w || w.isDestroyed()) return { exists: false };
    return { exists: true, visible: w.isVisible(), bounds: w.getBounds(), alwaysOnTop: w.isAlwaysOnTop(), onAllWorkspaces: w.isVisibleOnAllWorkspaces(), display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea };
  }

  hotkeyInfo() {
    return { mode: this.hotkeyMode, hotkey: this.hotkeyLabel(), fallback: this.shortcutRegistered ? this.shortcut : "" };
  }

  isSender(contents) {
    return Boolean(contents && (contents.id === this.uiContents()?.id || contents.id === this.window?.webContents.id));
  }

  async initialize() {
    this.prepareSpare();
    // The pill's buttons must work with no Clyra window, so this IPC lives here.
    ipcMain.removeAllListeners("dictation:pill-interactive");
    ipcMain.on("dictation:pill-interactive", (event, interactive) => {
      if (!this.window || this.window.isDestroyed() || event.sender.id !== this.window.webContents.id) return;
      if (process.platform !== "linux") this.window.setIgnoreMouseEvents(!interactive, { forward: true });
    });
    ipcMain.removeAllListeners("dictation:pill-move");
    ipcMain.on("dictation:pill-move", (event, delta) => {
      if (!this.window || this.window.isDestroyed() || event.sender.id !== this.window.webContents.id) return;
      const dx = Math.round(Number(delta?.dx) || 0);
      const dy = Math.round(Number(delta?.dy) || 0);
      if (!dx && !dy) return;
      const b = this.window.getBounds();
      const next = { x: b.x + dx, y: b.y + dy };
      // Keep the capsule reachable: its anchor (bottom centre of the canvas) must stay on a screen.
      const anchor = { x: next.x + Math.round(b.width / 2), y: next.y + b.height - 30 };
      if (!screen.getAllDisplays().some((d) => anchor.x >= d.bounds.x && anchor.x < d.bounds.x + d.bounds.width && anchor.y >= d.bounds.y && anchor.y < d.bounds.y + d.bounds.height)) return;
      this.window.setBounds({ ...next, width: b.width, height: b.height });
      this.userPosition = next;
    });
    ipcMain.removeAllListeners("dictation:pill-action");
    ipcMain.on("dictation:pill-action", (event, action) => {
      if (!this.window || event.sender.id !== this.window.webContents.id) return;
      void this.action(String(action || "cancel"));
    });
    this.applyHotkey(this.readFlowSettings().hotkey, { persist: false });
  }

  /** Switch the dictation hotkey (tray -> Dictation hotkey). Persists the choice. */
  applyHotkey(id, { persist = true } = {}) {
    const preset = HOTKEY_PRESETS.find((candidate) => candidate.id === id) || HOTKEY_PRESETS.find((candidate) => candidate.id === DEFAULT_HOTKEY);
    this.hotkeyPreset = preset;
    if (this.shortcutRegistered) { try { globalShortcut.unregister(this.shortcut); } catch { /* already gone */ } }
    this.shortcutRegistered = false;
    this.stopHotkey?.();
    this.stopHotkey = null;
    clearInterval(this.permissionTimer);
    this.permissionTimer = null;
    this.machine.reset();
    // Always-available backup combo: the first one no other app owns.
    this.shortcut = preset.combos.find((candidate) => {
      globalShortcut.unregister(candidate);
      if (globalShortcut.isRegistered(candidate)) return false;
      this.shortcutRegistered = globalShortcut.register(candidate, () => this.hotkeyPressed());
      return this.shortcutRegistered;
    }) || preset.combos[0];
    if (!this.shortcutRegistered) console.warn("[flow] every fallback dictation shortcut is owned by another app.");
    // A single-key tap needs the OS key hook, which can be unavailable (permissions, secure input).
    if (preset.tap && process.env.CLYRA_DISABLE_KEY_HOOK !== "1") {
      this.stopHotkey = startHotkeyListener(this.machine, console, preset.tap);
      if (!this.stopHotkey && process.platform === "darwin") this.awaitHotkeyPermission();
    }
    this.hotkeyMode = this.stopHotkey ? "tap" : this.shortcutRegistered ? "combo" : "none";
    if (persist) this.writeFlowSettings({ hotkey: preset.id });
    console.log(`[flow] hotkey ready: ${this.hotkeyLabel()} starts/stops dictation`);
  }

  /** "⌃⌥Space" on macOS; extras (tap Right Option) appended when the key hook is running. */
  hotkeyLabel() {
    const mac = process.platform === "darwin";
    const combo = this.shortcutRegistered
      ? (mac ? this.shortcut.replace(/Control|Ctrl/g, "⌃").replace(/Alt|Option/g, "⌥").replace(/Shift/g, "⇧").replace(/Command|Cmd|Super/g, "⌘").replace(/\+/g, "") : this.shortcut)
      : "";
    const extra = this.stopHotkey && this.hotkeyPreset?.tapLabel ? `tap ${this.hotkeyPreset.tapLabel}` : "";
    return [extra, combo].filter(Boolean).join(" or ") || "no hotkey available";
  }

  /**
   * The Right-Option tap needs macOS Accessibility. Ask once, then keep checking so the
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
        this.stopHotkey = startHotkeyListener(this.machine, console, this.hotkeyPreset?.tap || "AltRight");
        if (this.stopHotkey) console.log(`[flow] key hook ready: tap ${this.hotkeyPreset?.tapLabel || "the hotkey"} also toggles dictation`);
        if (this.stopHotkey || attempts > 5) { clearInterval(this.permissionTimer); this.permissionTimer = null; }
      }
      if (attempts > 200) { clearInterval(this.permissionTimer); this.permissionTimer = null; }
    }, 3000);
  }

  destroy() {
    clearTimeout(this.watchdog);
    try { this.spare?.destroy(); } catch { /* gone */ }
    this.spare = null;
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
    const known = this.targetDisplayId != null ? screen.getAllDisplays().find((d) => d.id === this.targetDisplayId) : null;
    const display = known || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    // One fixed, transparent canvas for the whole life of the pill: the capsule morphs inside it, so
    // the window itself is never resized mid-animation (that is what made the old one lurch).
    const w = Math.min(PREVIEW_WIDTH, width - 16);
    const h = Math.min(PREVIEW_HEIGHT, height - 16);
    if (this.userPosition) {
      const anchor = { x: this.userPosition.x + Math.round(w / 2), y: this.userPosition.y + h - 30 };
      if (screen.getAllDisplays().some((d) => anchor.x >= d.bounds.x && anchor.x < d.bounds.x + d.bounds.width && anchor.y >= d.bounds.y && anchor.y < d.bounds.y + d.bounds.height)) {
        this.window.setBounds({ x: this.userPosition.x, y: this.userPosition.y, width: w, height: h });
        return;
      }
      this.userPosition = null;
    }
    this.window.setBounds({
      x: Math.round(x + (width - w) / 2),
      y: Math.round(y + height - h + 12),
      width: w,
      height: h,
    });
  }

  /** Put the pill on the display of the window being dictated into (not just where the cursor is). */
  followFocusedWindow(rect) {
    if (!rect || this.userPosition) return;
    try {
      const display = screen.getDisplayMatching({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
      if (display && display.id !== this.targetDisplayId) {
        this.targetDisplayId = display.id;
        this.positionPill();
      }
    } catch { /* keep the current display */ }
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

  /**
   * The pill is a FRESH window for every dictation. A window that has lived through a Space
   * change (full-screen app, desktop switch) can stay stranded on the old Space and never
   * reappear; a never-shown window always opens on the Space you are in right now. A spare is
   * pre-loaded so a new window costs nothing at hotkey time.
   */
  createPillWindow() {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const { x, y, width, height } = display.workArea;
    const win = new BrowserWindow({
      // The content grows from a circle within this transparent canvas, which
      // keeps the expansion optically centred on any display.
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      x: Math.round(x + (width - PREVIEW_WIDTH) / 2),
      y: Math.round(y + height - PREVIEW_HEIGHT + 12),
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
      // A non-activating NSPanel: floats over every app, Space and full-screen window without ever
      // making Clyra the active app (no Dock bounce, no other window jumping forward).
      ...(process.platform === "darwin" ? { type: "panel", acceptFirstMouse: true } : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: "no-user-gesture-required",
        backgroundThrottling: false,
      },
    });
    win.setFullScreenable(false);
    if (process.platform === "darwin" && !fullScreenTransformDone) {
      fullScreenTransformDone = true;
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older Electron */ }
    }
    // Click-through everywhere except over the capsule itself (the page reports hover via IPC),
    // so the big transparent canvas never blocks the app underneath.
    if (process.platform !== "linux") win.setIgnoreMouseEvents(true, { forward: true });
    if (process.platform === "darwin") {
      try { win.setWindowButtonVisibility(false); } catch { /* older Electron */ }
    }
    win.loadFile(this.pillPath).catch(() => undefined);
    return win;
  }

  prepareSpare() {
    if (this.spare && !this.spare.isDestroyed()) return;
    this.spare = this.createPillWindow();
  }

  ensurePill() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const win = this.spare && !this.spare.isDestroyed() ? this.spare : this.createPillWindow();
    this.spare = null;
    this.window = win;
    this.pinPill(win, { first: true });
    this.positionPill();
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => this.emitPill());
    win.on("closed", () => { if (this.window === win) this.window = null; });
    // Next dictation's window, ready and never shown.
    setTimeout(() => this.prepareSpare(), 400);
    return win;
  }

  /** Done with this dictation: throw the window away so the next one opens on the current Space. */
  retirePill() {
    const win = this.window;
    this.window = null;
    if (win && !win.isDestroyed()) win.destroy();
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
    const previousPhase = this.phase;
    this.payload = { ...this.payload, ...payload };
    if (payload.phase === "idle" || payload.phase === "arming") this.payload.handsFree = false;
    this.phase = this.payload.phase || "idle";
    if (this.phase === "idle") {
      this.handsFree = false;
      this.autoStop = false;
      this.pendingStop = false;
      this.captureRequested = false;
      this.previewActive = false;
      this.machine.reset();
      this.unregisterEscape();
      clearTimeout(this.watchdog);
      const current = this.window;
      // Retire only if nothing new started in the meantime.
      if (current && !current.isDestroyed()) setTimeout(() => { if (this.phase === "idle" && this.window === current) this.retirePill(); }, 1_500);
    } else if (!this.inline) {
      const pill = this.ensurePill();
      if (this.phase !== previousPhase) {
        this.positionPill();
        this.pinPill(pill);
      }

      // showInactive keeps the user's target app focused while the overlay appears.
      if (this.phase !== previousPhase || !pill.isVisible()) pill.showInactive();
      // Keep it above everything for the whole session, even if you switch apps, tabs or Spaces mid-dictation.
      if (!this.topTimer) this.topTimer = setInterval(() => {
        const win = this.window;
        if (!win || win.isDestroyed() || this.phase === "idle") return;
        try { win.moveTop(); if (!win.isVisible()) win.showInactive(); } catch { /* window closing */ }
      }, 700);
      this.registerEscape();
    } else {
      this.registerEscape();
    }
    if (this.phase !== previousPhase) this.armWatchdog();
    if (this.phase === "idle") { clearInterval(this.topTimer); this.topTimer = null; }
    if (this.inline) {
      this.emitUi("dictation:state", this.payload);
      if (this.phase === "idle") this.inline = false;
      return;
    }
    this.emitPill();
  }

  /**
   * No phase may last forever: a stuck pill that can't be closed is the worst failure
   * a system-wide tool can have. Every phase has a ceiling after which it recovers on its own.
   */
  armWatchdog() {
    clearTimeout(this.watchdog);
    // The UI recorder normally starts in ~300ms; after 2.5s switch to the standalone recorder.
    const limits = { arming: this.fellBack ? 8_000 : (this.native && this.engine ? 2_500 : 6_000), processing: 45_000, optimising: 45_000, error: 5_000, done: 4_000, preview: 60_000, selection: 30_000, listening: 330_000 };
    const ms = limits[this.phase];
    if (!ms) return;
    const phase = this.phase;
    const activation = this.activationId;
    this.watchdog = setTimeout(() => {
      if (this.phase !== phase || activation !== this.activationId) return;
      if (phase === "arming" && this.captureRequested && !this.nativeActive && this.native && this.engine && !this.fellBack) {
        // The Clyra window never started recording (stalled or reloading): record natively instead.
        console.warn("[flow] UI recorder did not start in time; switching to the standalone recorder");
        this.fellBack = true;
        this.emitUi("dictation:trigger", { type: "cancel" });
        void this.nativeStart(activation);
        this.armWatchdog();
        return;
      }
      if (phase === "listening") { this.requestStop(); return; }
      if (phase === "error" || phase === "done") { this.setState({ phase: "idle", detail: "" }); return; }
      if (phase === "preview" || phase === "selection") { this.cancel(); return; }
      this.forceReset(phase === "arming" ? "Dictation could not start. Press the hotkey to try again." : "Dictation took too long and was stopped.");
    }, ms);
  }

  /**
   * Keep the pill above everything and on every Space / full-screen app. ORDER MATTERS on
   * macOS: setAlwaysOnTop() rewrites the window's collection behaviour, so "all workspaces"
   * must be (re)applied AFTER it. Re-levelling without re-applying it silently strands the
   * pill on one Space — the "spawns randomly behind things / doesn't appear" bug.
   */
  pinPill(pill, { first = false } = {}) {
    if (!pill || pill.isDestroyed()) return;
    pill.setAlwaysOnTop(true, "screen-saver", 1);
    // Never transform the process type: doing so hides/re-shows the Dock icon, which looked like
    // another app flashing open on every dictation. The panel window type is what lets it sit over
    // full-screen apps.
    pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    pill.moveTop();
  }

  /** Hard reset from any state: stop recorders, clear the gesture, tell the UI, close the pill. */
  forceReset(message = "") {
    this.activationId += 1;
    if (this.nativeActive) { this.native?.cancel(); this.nativeActive = false; }
    this.session?.close();
    this.session = null;
    this.emitUi("dictation:trigger", { type: "cancel" });
    this.machine.reset();
    this.fellBack = false;
    this.target = null;
    this.setState(message ? { phase: "error", detail: message } : { phase: "idle", detail: "" });
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

  async toggle({ manual = false, inline = false, selection = "" } = {}) {
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
    // Started from Clyra's chat composer: the composer shows its own inline bar (same animations), so no floating
    // pill is created and the text goes straight into the draft instead of being pasted.
    this.inline = Boolean(inline);
    this.inlineSelection = this.inline ? String(selection || "").trim().slice(0, 20_000) : "";
    this.targetDisplayId = null;
    this.fellBack = false;
    this.autoStop = !manual;
    this.heardSpeech = false;
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
    this.setState({ phase: "arming", application: "", selectedText: this.inlineSelection.slice(0, 600), edit: null, detail: "", partial: "", diff: null, finalText: "", clipboard: false, resultText: "" });
    if (this.native && this.engine?.available) {
      // Clyra's UI isn't up (closed, hidden at login, or still booting): run the
      // standalone pipeline so the hotkey works instantly regardless.
      void this.nativeStart(activationId);
    } else {
      this.emitUi("dictation:trigger", { type: "start", target: { ...this.target }, manual: true });
      if (this.autoStop) this.emitUi("dictation:trigger", { type: "autostop" });
      if (this.pendingStop) {
        // Released before the mic was requested: the renderer defers the stop
        // until capture is live, so nothing said is lost and nothing hangs.
        this.pendingStop = false;
        this.emitUi("dictation:trigger", { type: "stop" });
      }
    }

    if (this.inline) { this.target = { application: "Clyra", selectedText: this.inlineSelection }; return; }
    const context = await frontmostContext().catch(() => ({ application: "", rect: null, selectedText: "" }));
    const application = context.application;
    const selectedText = context.selectedText || "";
    if (activationId !== this.activationId || this.phase === "idle") return;
    this.followFocusedWindow(context.rect);
    // Selection is context, not a separate mode. This lets someone select a
    // paragraph and simply say “make this friendlier” without learning UI.
    this.target = { application, selectedText };
    this.setState({ application, selectedText: selectedText.slice(0, 260) });
    if (!this.nativeActive) this.emitUi("dictation:trigger", { type: "target", target: this.target });
  }

  async action(action) {
    console.log(`[flow] pill action: ${action} (phase=${this.phase})`);
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
      } else if (isClyraProcessName(intended)) {
        // Dictating into Clyra's own composer: the pill click took focus, hand it back to the chat window.
        const contents = this.uiContents();
        if (contents && !contents.isDestroyed()) {
          const owner = BrowserWindow.fromWebContents(contents) || BrowserWindow.getAllWindows().find((w) => w.webContents.id === contents.id);
          this.refocus = Promise.resolve().then(() => { owner?.focus(); contents.focus(); }).then(() => wait(80)).catch(() => undefined);
        }
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
    this.session?.close();
    this.session = null;
    this.emitUi("dictation:trigger", { type: "cancel" });
    this.target = null;
    this.fellBack = false;
    this.machine.reset();
    this.setState({ phase: "idle", detail: "" });
  }

  /**
   * macOS only allows synthetic Cmd+V with Accessibility permission. Without
   * it, keep the transcript on the clipboard (never lose the user's words),
   * ask macOS to show its permission prompt, and tell the pill to say so.
   */
  clipboardOnly(text, { reason = "no-field" } = {}) {
    clipboard.writeText(text);
    if (reason === "no-permission") { try { systemPreferences.isTrustedAccessibilityClient(true); } catch { /* prompt is best-effort */ } }
    return {
      ok: true,
      method: "clipboard-only",
      note: reason === "no-permission" ? "Saved to clipboard — press ⌘V to paste" : "Saved to clipboard — click a text field, then ⌘V",
    };
  }

  /**
   * Show what is about to happen, then do it: the heard words appear, removed words are struck
   * through and generated/corrected words glow blue, then the final text sweeps in with a gradient
   * as it is pasted into the app you are in. Returns insert()'s result.
   */
  async presentAndInsert({ raw = "", text = "", target }) {
    if (!text?.trim()) throw new Error("Clyra received no text to insert.");
    const activation = this.activationId;
    const live = () => activation === this.activationId && this.phase !== "idle";
    const diff = raw && raw.trim() !== text.trim() ? wordDiff(raw, text) : null;
    const display = text.length > 420 ? `${text.slice(0, 420).trimEnd()}…` : text;
    const probe = focusedElementKind();
    let result = null;
    let failure = null;
    let startPaste = () => undefined;
    const pasteGate = new Promise((resolve) => { startPaste = resolve; });
    const insertion = (async () => { await pasteGate; await sleep(60); if (!live()) throw new Error("Cancelled."); return this.insert({ text, target, probe }); })()
      .then((value) => { result = value; }, (error) => { failure = error; });
    // Wait up to `ms`, surfacing a failed paste immediately instead of after the animation.
    const settle = async (ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (failure) throw failure; if (!live()) throw new Error("Cancelled."); await sleep(40); }
    };
    // The text goes into the app FIRST; the pill then shows what was heard and changed. (The paste used to wait
    // for the whole edit animation, which made a corrected sentence arrive seconds late.)
    startPaste();
    const overflowMs = Math.min(1_600, Math.max(0, Math.ceil(display.length / 60) - 2) * 450);
    if (hasEdits(diff) && process.env.CLYRA_FLOW_NO_PREVIEW !== "1") {
      const count = (type) => diff.filter((segment) => segment.type === type).reduce((n, segment) => n + String(segment.text).split(/\s+/).filter(Boolean).length, 0);
      this.setState({ phase: "refining", detail: "", diff, finalText: display });
      await settle(Math.min(2_600, 420 + count("del") * 60 + count("add") * 80 + 700));
    }
    this.setState({ phase: "revealing", detail: "", diff: null, finalText: display });
    await settle(700 + overflowMs);
    await insertion;
    if (failure) throw failure;
    console.log(`[flow] insert result: ${result?.method || "ok"}${result?.note ? ` (${result.note})` : ""}`);
    return result;
  }

  async insert({ text, target, probe }) {
    if (!text?.trim()) throw new Error("Clyra received no text to insert.");
    if (this.inline) { this.emitUi("dictation:inline-result", { text, edit: this.payload.edit || null }); return { ok: true, method: "composer" }; }
    // A click on the pill may have activated Clyra: wait for the refocus started in
    // action("stop") (and discard any focus probe taken while the pill had focus).
    if (this.refocus) { await this.refocus; this.refocus = null; probe = null; }
    const field = process.platform === "darwin" ? await (probe || focusedElementKind()) : { kind: "unknown", role: "" };
    // "No focused element" is common for apps whose accessibility tree is still waking up (browsers, Electron),
    // so only treat it as "nowhere" for the desktop itself; everywhere else we try the paste.
    const desktopApp = /^(Finder|loginwindow|Dock|Window Server)$/i.test(String(target?.application || this.target?.application || ""));
    const nowhere = field.kind === "blocked" || (field.kind === "none" && (desktopApp || !(target?.application || this.target?.application)));
    console.log(`[flow] insert into ${target?.application || "unknown app"}: focus=${field.kind}${field.role ? `:${field.role}` : ""}, ${text.length} chars${target?.selectedText ? ", replacing selection" : ""}`);
    const keepCopy = field.kind === "ambiguous" || field.kind === "unknown" || field.kind === "none";
    // Test hook: report instead of pasting into whatever app is in front.
    if (process.env.CLYRA_FLOW_DRY_RUN === "1") {
      console.log(`[flow] dry-run insert (${target?.application || "unknown app"}, focus=${field.kind}${field.role ? `:${field.role}` : ""}${nowhere ? ", would save to clipboard" : ""}): ${JSON.stringify(text)}`);
      return nowhere ? { ok: true, method: "clipboard-only", note: "Saved to clipboard — click a text field, then ⌘V" } : { ok: true, method: "dry-run" };
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
      } finally { restoreClipboardLater(saved, text); }
    }
    if (process.platform !== "darwin") throw new Error("Native insertion is currently supported on macOS and Windows only.");
    let trustedNow = true;
    try { trustedNow = systemPreferences.isTrustedAccessibilityClient(false); } catch { trustedNow = true; }
    if (!trustedNow) return this.clipboardOnly(text, { reason: "no-permission" });
    // Nothing editable is focused (desktop, Finder, a page that isn't a field...): never fire a
    // blind Cmd+V. Save the text where it can't be lost and tell the user.
    if (nowhere) return this.clipboardOnly(text);
    // Fast path (~150ms): the pill is a non-activating panel, so the app being
    // dictated into is still frontmost; post Cmd+V directly with no AppleScript.
    {
      const savedFast = snapshotClipboard();
      let pasted = false;
      try {
        clipboard.writeText(text);
        // If one of Clyra's own windows still holds keyboard focus, the key tap would go to it instead of the
        // target app (even while the OS reports the target frontmost). Hand focus back first.
        const intendedApp = String(target?.application || this.target?.application || "").trim();
        if (intendedApp && !isClyraProcessName(intendedApp) && BrowserWindow.getFocusedWindow()) await focusApplication(intendedApp).catch(() => undefined);
        await wait(30);
        console.log(`[flow] pasting via key tap; frontmost=${await frontmostApplication().catch(() => "?")} focusedWindow=${BrowserWindow.getFocusedWindow()?.getTitle() || "none"}`);
        if (pasteWithKeyTap()) { pasted = true; await wait(140); return { ok: true, method: "keytap", ...(keepCopy ? { note: "Inserted · copy kept on clipboard" } : {}) }; }
      } finally {
        // A clear text field: put the user's previous clipboard back. Unsure (web editors): keep the dictated text there.
        if (!(pasted && keepCopy)) restoreClipboardLater(savedFast, text);
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
      if (!trusted) return this.clipboardOnly(text, { reason: "no-permission" });
      throw error instanceof Error ? error : new Error("Clyra could not paste the transcribed text.");
    } finally {
      restoreClipboardLater(saved, text);
    }
  }
}
