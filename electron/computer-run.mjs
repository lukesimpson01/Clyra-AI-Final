/**
 * Computer use run controller: observe -> decide (DeepSeek) -> act (real input, visible AI cursor) -> verify, in a loop.
 * One run at a time. Chat, the Notch and the control bar all drive this same object and read the same typed events.
 *
 * Perception: macOS accessibility tree (electron/computer-perception.swift), with Vision OCR as a fallback.
 * Input: DesktopControlService (CoreGraphics on macOS, SendInput on Windows). Windows has no accessibility reader yet,
 * so it runs from OCR-less coordinates only and reports that limitation instead of pretending.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, clipboard, desktopCapturer, screen } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const execFileAsync = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_STEPS = 60;
const PROTOCOL_VERSION = 1;
const TRACE = process.env.CLYRA_CU_TRACE === "1";
const trace = (...parts) => { if (TRACE) console.log("[computer]", ...parts); };
const timed = async (name, work) => { const t0 = Date.now(); try { return await work(); } finally { trace(name, `${Date.now() - t0}ms`); } };

const KEY_CODES = { enter: 36, return: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121 };
const MODIFIERS = { cmd: "command down", command: "command down", ctrl: "control down", control: "control down", alt: "option down", option: "option down", shift: "shift down" };

/** `cmd+l`, `enter`, `cmd+shift+4` -> osascript line. Letters and digits go through keystroke, named keys through key code. */
export function keyScript(spec) {
  const parts = String(spec || "").toLowerCase().split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new Error("Empty key.");
  const mods = parts.map((part) => MODIFIERS[part]).filter(Boolean);
  const using = mods.length ? ` using {${mods.join(", ")}}` : "";
  if (KEY_CODES[key] !== undefined) return `tell application "System Events" to key code ${KEY_CODES[key]}${using}`;
  if (key.length === 1) return `tell application "System Events" to keystroke "${key.replace(/["\\]/g, "\\$&")}"${using}`;
  throw new Error(`Unsupported key: ${spec}`);
}

const SENSITIVE_LABEL = /pass(word|code)|one[- ]time|verification code|2fa|otp|card number|cvv|cvc|security code|routing number|account number|ssn|social security/i;

export class ComputerRun {
  constructor({ desktop, overlay, getServiceUrl, getServiceToken, emit }) {
    this.getServiceToken = getServiceToken;
    this.desktop = desktop;
    this.overlay = overlay;
    this.getServiceUrl = getServiceUrl;
    this.emitOut = emit;
    this.perceptionPromise = null;
    this.reset();
  }

  reset() {
    this.run = null;
    this.abort = null;
    this.pending = [];
    this.resumeWaiters = [];
  }

  get active() { return Boolean(this.run && !["done", "failed", "cancelled"].includes(this.run.status)); }

  getState() {
    if (!this.run) return { v: PROTOCOL_VERSION, status: "idle" };
    const { id, goal, status, plan, steps, message, app: appName, summary, error, startedAt, big, approach } = this.run;
    return { v: PROTOCOL_VERSION, id, goal, status, plan, big: Boolean(big), approach, steps: steps.slice(-40), message, app: appName, summary, error, startedAt };
  }

  emit(type, extra = {}) {
    const event = { v: PROTOCOL_VERSION, type, runId: this.run?.id, ts: Date.now(), state: this.getState(), ...extra };
    try { this.emitOut(event); } catch { /* a closed window must never stop the run */ }
    try { this.overlay.pushState(); } catch { /* bar closed */ }
    void this.persist();
  }

  async persist() {
    if (!this.run) return;
    try {
      const dir = path.join(app.getPath("userData"), "computer-runs");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${this.run.id}.json`), JSON.stringify(this.getState(), null, 1), { mode: 0o600 });
    } catch { /* best effort */ }
  }

  setStatus(status, extra = {}) {
    if (!this.run) return;
    Object.assign(this.run, extra, { status });
    this.emit("status");
  }

  async start(goal) {
    const text = String(goal || "").trim();
    if (!text) return { ok: false, error: "Tell Clyra what to do on your computer." };
    if (this.active) return { ok: false, error: "A computer-use task is already running." };
    if (process.platform !== "darwin" && process.platform !== "win32") return { ok: false, error: "Computer use runs on macOS and Windows." };
    if (process.platform === "darwin") {
      const trust = await this.perceive("trusted").catch((error) => ({ ok: false, error: error?.message }));
      // Without Accessibility the screen cannot be read or clicked, but the machine actions (commands, files, links, Bluetooth,
      // clipboard) still work: carry on and say so, instead of refusing the whole task.
      this.noAccessibility = !trust?.accessibility;
    }
    this.reset();
    this.run = { id: crypto.randomUUID(), goal: text, status: "planning", plan: [], steps: [], history: [], startedAt: Date.now(), message: "", app: "" };
    this.abort = new AbortController();
    this.emit("run.started");
    await this.overlay.showBar(this);
    await this.desktop.setGuideOnly(false);
    this.desktop.setProfile("calm");
    this.desktop.virtualPos = null;
    this.desktop.setCursorEnabled(true);
    await this.desktop.setManualControl(false);
    await this.desktop.setPaused(false);
    void this.loop().catch((error) => this.finish("failed", { error: error?.message || String(error) }));
    return { ok: true, id: this.run.id };
  }

  async pause() {
    trace("pause requested", new Error().stack?.split("\n").slice(2, 5).join(" <- "));
    if (!this.active || this.run.status === "paused") return { ok: true };
    this.run.resumeTo = this.run.status === "needs_user" ? "needs_user" : "running";
    await this.desktop.setPaused(true);
    this.desktop.setCursorEnabled(false);
    this.setStatus("paused");
    await this.overlay.setGlow(false);
    return { ok: true };
  }

  async resume({ fromHuman = false } = {}) {
    if (!this.active) return { ok: false, error: "No computer-use task is running." };
    if (!["paused", "needs_user"].includes(this.run.status)) return { ok: true };
    // A person may have moved windows while they had control: the next loop turn always observes before acting.
    await this.desktop.setPaused(false);
    this.desktop.setCursorEnabled(true);
    this.run.message = "";
    if (fromHuman) this.run.history.push({ label: "The person finished the step that needed them", result: "ok" });
    this.setStatus("running");
    await this.overlay.setGlow(true);
    for (const wake of this.resumeWaiters.splice(0)) wake();
    return { ok: true };
  }

  async sendMessage(text) {
    const value = String(text || "").trim().slice(0, 1200);
    if (!value || !this.active) return { ok: false };
    this.pending.push(value);
    this.run.steps.push({ id: crypto.randomUUID(), kind: "message", label: value, at: Date.now(), status: "done" });
    this.emit("message.received", { text: value });
    // Sending a message while paused resumes: the person expects the task to carry on with their note folded in.
    if (this.run.status === "paused") await this.resume();
    return { ok: true };
  }

  async stop() {
    trace("stop requested", new Error().stack?.split("\n").slice(2, 6).join(" <- "));
    if (!this.run) return { ok: true };
    this.abort?.abort();
    for (const wake of this.resumeWaiters.splice(0)) wake();
    await this.finish("cancelled", {});
    return { ok: true };
  }

  async finish(status, extra) {
    if (!this.run || ["done", "failed", "cancelled"].includes(this.run.status)) return;
    this.run.plan = this.run.plan.map((item) => (status === "done" ? { ...item, status: "done" } : item));
    Object.assign(this.run, extra, { status, endedAt: Date.now() });
    await this.desktop.setPaused(false).catch(() => {});
    if (status !== "done") this.desktop.setCursorEnabled(false);
    if (status === "done") {
      // A brief "Done" beside the cursor, then it fades out with the glow.
      await this.desktop.setCursor({ ...this.desktop.cursorPoint(), label: "Done", kind: "done", durationMs: 0 }).catch(() => {});
      setTimeout(() => { if (!this.active) { this.desktop.setCursorEnabled(false); this.desktop.virtualPos = null; } }, 1100);
    } else {
      await this.desktop.setCursor(null).catch(() => {});
    }
    this.desktop.setProfile("default");
    this.emit("run.ended");
    await this.overlay.hide(this);
  }

  async gate() {
    while (this.active && ["paused", "needs_user"].includes(this.run.status)) {
      await new Promise((resolve) => this.resumeWaiters.push(resolve));
    }
    if (!this.active || this.abort?.signal.aborted) throw new Error("__stopped__");
  }

  /** The AI cursor idles where the pointer is, saying what Clyra is doing instead of freezing between moves. */
  async think(label, kind = "think") {
    if (!this.active || this.run.status !== "running") return;
    const point = this.desktop.cursorPoint();
    await this.desktop.setCursor({ ...point, label, kind, durationMs: 0 }).catch(() => {});
  }

  /** What the cursor says while the next move is being worked out: the step in hand, never "analysing". */
  workingLabel() {
    const active = this.run.plan.find((item) => item.status === "active");
    return active?.title || "Working on it";
  }

  async planPhase() {
    try {
      // Planning needs the app and windows, not a full read of a large app's interface.
      const quick = process.platform === "darwin" ? await this.perceive("app").catch(() => null) : null;
      const observation = quick?.ok
        ? { app: quick.app, elements: [], text: `Frontmost app: ${quick.app}\nWindows: ${(quick.windows || []).map((w) => `"${w}"`).join(", ") || "none"}`, signature: "plan" }
        : await this.observe();
      this.run.app = observation.app || "";
      const plan = await this.decide("plan", observation, [], {});
      const items = (Array.isArray(plan.plan) ? plan.plan : []).slice(0, 7)
        .map((item) => ({ title: String(item?.title || "").slice(0, 70), status: "pending" })).filter((item) => item.title);
      if (items.length) items[0].status = "active";
      this.run.plan = items;
      this.run.big = Boolean(plan.big);
      this.run.doneWhen = String(plan.done_when || "").slice(0, 200);
      this.run.approach = String(plan.summary || "").slice(0, 160);
      this.emit("plan");
      return null;
    } catch (error) {
      if (error?.message === "__stopped__") throw error;
      return null; // a missing plan must never stop the task; the act phase builds one as it goes
    }
  }

  /** The agent may change course: finished steps stay, the rest is replaced by its new plan. */
  replan(next) {
    const kept = this.run.plan.filter((item) => item.status === "done");
    const fresh = next.slice(0, 7).map((item) => ({ title: String(item?.title || "").slice(0, 70), status: "pending" })).filter((item) => item.title && !kept.some((k) => k.title === item.title));
    if (fresh.length) fresh[0].status = "active";
    this.run.plan = [...kept, ...fresh];
    this.run.history.push({ label: "Changed the plan", result: this.run.plan.map((item) => item.title).join(" > ").slice(0, 160) });
    this.emit("plan");
  }

  mergePlan(next) {
    if (!Array.isArray(next) || !next.length) return;
    const current = this.run.plan;
    if (!current.length) {
      this.run.plan = next.slice(0, 7).map((item) => ({ title: String(item?.title || "").slice(0, 70), status: ["pending", "active", "done"].includes(item?.status) ? item.status : "pending" }));
    } else {
      // Titles stay as planned. Progress only moves forward and exactly one step is active.
      this.run.plan = current.map((item, index) => {
        const proposed = next[index]?.status;
        return { title: item.title, status: item.status === "done" || proposed === "done" ? "done" : proposed === "active" ? "active" : "pending" };
      });
    }
    if (!this.run.plan.some((item) => item.status === "active")) {
      const first = this.run.plan.find((item) => item.status === "pending");
      if (first) first.status = "active";
    }
    this.emit("plan");
  }

  async loop() {
    let stagnant = 0;
    let lastSignature = "";
    let lastKey = "";
    // Plan first, with nothing on screen yet: the glow, cursor and control bar only appear once there is a plan to carry out.
    let observation = await this.planPhase();
    await this.gate();
    await this.overlay.show(this);
    if (this.run.status === "planning") this.setStatus("running");
    this.run.verifyTries = 0;
    this.run.struggle = 0;
    try {
      for (let turn = 0; turn < MAX_STEPS; turn += 1) {
        await this.gate();
        if (!observation) { await this.think(this.workingLabel()); observation = await this.observe(); }
        this.run.app = observation.app || this.run.app;
        stagnant = observation.signature === lastSignature ? stagnant + 1 : 0;
        lastSignature = observation.signature;
        if (stagnant >= 5) {
          await this.needUser("I'm not making progress here. Take a look, then press Resume and I'll try again.");
          stagnant = 0; observation = null;
          await this.gate();
          continue;
        }
        await this.think(this.lastWasWait && turn > 0 ? "Waiting for page" : this.workingLabel());
        const messages = this.pending.splice(0);
        const decision = await this.decide("act", observation, messages, { struggling: this.run.struggle });
        await this.gate();
        if (decision.replan === true && Array.isArray(decision.plan)) this.replan(decision.plan); else this.mergePlan(decision.plan);
        const actions = normalizeActions(decision);
        const label = String(decision.label || actionLabel(actions[0])).slice(0, 60);
        const terminal = actions.find((item) => ["done", "fail", "need_user"].includes(item.type));
        const doable = actions.filter((item) => !["done", "fail", "need_user"].includes(item.type));
        let nextObservation = observation;
        let step = null;
        if (doable.length) {
          step = { id: crypto.randomUUID(), kind: doable[0].type || "action", label, app: observation.app, at: Date.now(), status: "running", thought: String(decision.thought || "").slice(0, 160), count: doable.length };
          this.run.steps.push(step);
          this.emit("step.started", { step });
          const outcome = await this.runBatch(doable, observation, label);
          step.status = outcome.ok ? "done" : "failed";
          step.detail = outcome.detail;
          this.lastWasWait = doable[doable.length - 1].type === "wait" || doable[doable.length - 1].type === "open_app";
          if (outcome.needUser) {
            this.run.history.push({ label, result: "needs the person" });
            this.emit("step.ended", { step });
            await this.needUser(outcome.needUser);
            await this.gate();
            observation = null;
            continue;
          }
          let after = outcome.last || await this.observeIn(observation.app).catch(() => null);
          if (after && after.signature === observation.signature && !this.lastWasWait) {
            await wait(260); // pages and animations that were still settling
            after = await this.observeIn(observation.app).catch(() => after);
          }
          const changed = Boolean(after) && after.signature !== observation.signature;
          const key = JSON.stringify(doable.map((item) => [item.type, item.element ?? item.x, item.y, item.text, item.keys]));
          const repeated = key === lastKey && !changed;
          lastKey = key;
          this.run.struggle = outcome.ok && changed ? 0 : this.run.struggle + 1;
          const did = outcome.performed?.length ? `did: ${outcome.performed.join(", ")}; ` : "";
          const said = outcome.outputs?.length ? ` OUTPUT: ${outcome.outputs.join(" | ").slice(0, 900)}` : "";
          this.run.history.push({ label, result: did + said + (outcome.ok ? (changed ? "screen changed" : "no visible change") + (repeated ? " (you repeated the same action: choose a different one)" : "") : `failed after that: ${outcome.detail}`) });
          this.emit("step.ended", { step });
          nextObservation = after || null;
        }
        if (terminal) {
          if (terminal.type === "fail") { await this.finish("failed", { error: String(terminal.message || "I couldn't finish that.").slice(0, 400) }); return; }
          if (terminal.type === "need_user") {
            await this.needUser(String(terminal.message || "I need you for this step.").slice(0, 300));
            await this.gate();
            observation = null;
            continue;
          }
          // done: check the screen against the goal before believing it.
          const proof = nextObservation || await this.observe().catch(() => observation);
          if (this.run.verifyTries < 2) {
            this.run.verifyTries += 1;
            await this.think("Verifying result", "verify");
            const verdict = await this.decide("verify", proof, [], { claim: String(terminal.summary || "") }).catch(() => ({ achieved: true }));
            if (verdict.achieved === false) {
              this.run.history.push({ label: "Checked the result", result: `not finished yet: ${String(verdict.missing || "").slice(0, 110)}` });
              observation = proof;
              continue;
            }
          }
          await this.finish("done", { summary: String(terminal.summary || "Done.").slice(0, 400) });
          return;
        }
        observation = nextObservation;
      }
      await this.finish("failed", { error: "I reached the step limit before finishing." });
    } catch (error) {
      if (error?.message === "__stopped__") return;
      throw error;
    }
  }

  /** The control an action means, by name when it gave one, else by number, from the screen the model saw. */
  originalTarget(observation, action) {
    const want = typeof action.label === "string" ? action.label.trim() : "";
    const byNumber = Number.isInteger(action.element) ? observation.elements.find((item) => item.i === action.element) : undefined;
    if (want && (!byNumber || byNumber.label.trim() !== want)) {
      const named = observation.elements.filter((item) => item.label.trim() === want && item.enabled !== false);
      return named.find((item) => !/StaticText|Image|Cell|Row/.test(item.role)) || named[0] || byNumber;
    }
    return byNumber;
  }

  /** Reads the screen; if Clyra itself ended up in front (a stray click), puts the app being driven back first. */
  async observeIn(expectedApp) {
    let seen = await this.observe();
    if (process.platform === "darwin" && expectedApp && this.isOwnApp(seen.app) && !this.isOwnApp(expectedApp)) {
      await execFileAsync("osascript", ["-e", `tell application "${String(expectedApp).replace(/"/g, "")}" to activate`], { timeout: 4000 }).catch(() => {});
      await wait(140);
      seen = await this.observe();
    }
    return seen;
  }

  isOwnApp(name) { return /^(clyra|electron|notch)/i.test(String(name || "")); }

  /** Runs a short fixed sequence. Between actions it re-reads the screen and stops if a target is no longer where it was. */
  async runBatch(actions, observation, label) {
    let current = observation;
    const performed = [];
    const outputs = [];
    for (let index = 0; index < actions.length; index += 1) {
      await this.gate();
      let action = actions[index];
      let glided = false;
      if (index > 0) {
        // The glide toward the next control and the fresh look at the screen run together, so looking costs no extra time.
        const original = (Number.isInteger(action.element) || action.label) ? this.originalTarget(observation, action) : null;
        const isPointer = ["click", "double_click", "right_click"].includes(action.type);
        const approx = original && isPointer && observation.pid ? { x: original.frame.x + original.frame.w / 2, y: original.frame.y + original.frame.h / 2 } : null;
        const glideP = approx ? this.desktop.glide(approx.x, approx.y, label) : Promise.resolve();
        let fresh = await this.observe().catch(() => null);
        if (fresh && this.isOwnApp(fresh.app) && !this.isOwnApp(observation.app) && process.platform === "darwin") {
          await this.activate(observation.app);
          fresh = await this.observe().catch(() => null);
        }
        if (!fresh || fresh.app !== observation.app) { await glideP; return { ok: true, detail: "The screen changed mid-sequence; re-reading it.", last: fresh, performed }; }
        current = fresh;
        if (original) {
          const match = relocate(fresh.elements, original);
          if (!match) { await glideP; return { ok: true, detail: "A target moved mid-sequence; re-reading the screen.", last: fresh, performed }; }
          action = { ...action, element: match.i, label: match.label };
          await glideP;
          const exact = { x: match.frame.x + match.frame.w / 2, y: match.frame.y + match.frame.h / 2 };
          if (approx && Math.hypot(exact.x - approx.x, exact.y - approx.y) > 5) await this.desktop.glide(exact.x, exact.y, label, { quick: true });
          glided = Boolean(approx);
        } else await glideP;
      }
      let result;
      try { result = await this.act(action, current, label, { glided }); } catch (error) {
        if (error?.message === "__stopped__") throw error;
        result = { ok: false, detail: error?.message || String(error) };
      }
      if (result.needUser) return { ok: false, needUser: result.needUser, detail: result.needUser, performed };
      if (!result.ok) return { ok: false, detail: result.detail || "That didn't work.", last: null, performed };
      performed.push(describeAction(action, current));
      if (result.output) outputs.push(result.output);
      if (result.settleMs && index === actions.length - 1) await this.settle(action, result.settleMs);
    }
    return { ok: true, detail: actions.length > 1 ? `${actions.length} actions` : undefined, last: null, performed, outputs };
  }

  async activate(appName) {
    await execFileAsync("osascript", ["-e", `tell application "${String(appName).replace(/"/g, "")}" to activate`], { timeout: 4000 }).catch(() => {});
    await wait(120);
  }

  /** Waits only as long as the app needs: a launched app is polled until it is frontmost instead of sleeping a fixed time. */
  async settle(action, settleMs) {
    return timed(`settle:${action.type}`, () => this.settleNow(action, settleMs));
  }

  async settleNow(action, settleMs) {
    if (action.type === "open_app" && process.platform === "darwin") {
      const want = String(action.app || "").toLowerCase();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const tree = await this.perceive("ax").catch(() => null);
        if (tree?.ok && String(tree.app).toLowerCase().includes(want.replace(/\.app$/, "")) && tree.windows.length) { await wait(160); return; }
        await wait(180);
      }
      return;
    }
    await wait(settleMs);
  }

  async needUser(message) {
    this.run.history.push({ label: "Needed the person", result: message.slice(0, 100) });
    await this.desktop.setPaused(true);
    this.desktop.setCursorEnabled(false);
    this.setStatus("needs_user", { message });
    this.emit("needs_user", { message });
    await this.overlay.setGlow(false);
  }

  /* ---------- perception ---------- */

  async perceptionBinary() {
    if (process.platform !== "darwin") throw new Error("Screen reading is only available on macOS so far.");
    if (!this.perceptionPromise) {
      this.perceptionPromise = (async () => {
        if (app.isPackaged) {
          const shipped = path.join(process.resourcesPath, "app.asar.unpacked", "electron", "computer-perception-darwin");
          await fs.access(shipped);
          return shipped;
        }
        const source = await fs.readFile(new URL("./computer-perception.swift", import.meta.url), "utf8");
        const folder = path.join(app.getPath("userData"), "native-input");
        const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 14);
        const binary = path.join(folder, `clyra-perception-${hash}`);
        try { await fs.access(binary); return binary; } catch { /* compile once */ }
        await fs.mkdir(folder, { recursive: true });
        const sourcePath = `${binary}.swift`;
        await fs.writeFile(sourcePath, source, { mode: 0o600 });
        await execFileAsync("xcrun", ["swiftc", sourcePath, "-O", "-o", binary], { timeout: 120_000 });
        return binary;
      })().catch((error) => { this.perceptionPromise = null; throw error; });
    }
    return this.perceptionPromise;
  }

  async perceive(verb, ...args) {
    const binary = await this.perceptionBinary();
    const { stdout } = await execFileAsync(binary, [verb, ...args], { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
    return JSON.parse(String(stdout || "{}"));
  }

  async ocrScreen() {
    const file = path.join(app.getPath("temp"), `clyra-cu-${crypto.randomUUID()}.png`);
    try {
      await execFileAsync("screencapture", ["-x", "-t", "png", file], { timeout: 8_000 });
      const result = await this.perceive("ocr", file);
      const bar = this.overlay.barBounds?.();
      const lines = result.ok ? result.lines : [];
      if (!bar) return lines;
      const display = screen.getPrimaryDisplay().bounds;
      // The AI never reads Clyra's own control bar.
      return lines.filter((line) => {
        const x = display.x + (line.x + line.w / 2) * display.width, y = display.y + (line.y + line.h / 2) * display.height;
        return !(x >= bar.x && x <= bar.x + bar.width && y >= bar.y && y <= bar.y + bar.height);
      });
    } catch { return []; } finally { fs.rm(file, { force: true }).catch(() => {}); }
  }

  async observe() {
    return timed("observe", () => this.observeNow());
  }

  async observeNow() {
    if (process.platform !== "darwin") {
      const point = screen.getCursorScreenPoint();
      const bounds = screen.getPrimaryDisplay().bounds;
      return { app: "", elements: [], text: `Screen ${bounds.width}x${bounds.height}. Pointer at ${point.x},${point.y}. Screen reading is not available on this OS yet; act with coordinates only.`, signature: `win:${point.x},${point.y}` };
    }
    const tree = await this.perceive("ax").catch((error) => ({ ok: false, error: error?.message }));
    if (!tree.ok) {
      if (this.noAccessibility || /Accessibility/i.test(String(tree.error))) {
        return { app: "", pid: 0, centre: null, elements: [], secureFocus: false, signature: "no-ax", text: "The screen cannot be read: macOS Accessibility is off for Clyra. Clicking and typing are unavailable; use the machine actions (shell, open, read_file, list_dir, bluetooth, clipboard), or answer need_user asking the person to turn on Accessibility in System Settings → Privacy & Security → Accessibility." };
      }
      throw new Error(tree.error || "Could not read the screen.");
    }
    let ocr = [];
    const frameless = tree.elements.length < 6;
    if (frameless) {
      const bounds = screen.getPrimaryDisplay().bounds;
      ocr = (await this.ocrScreen()).map((line) => ({ text: line.text, x: Math.round(bounds.x + line.x * bounds.width), y: Math.round(bounds.y + line.y * bounds.height), w: Math.round(line.w * bounds.width), h: Math.round(line.h * bounds.height) }));
    }
    const lines = [`Frontmost app: ${tree.app}`, tree.windows.length ? `Windows: ${tree.windows.map((w) => `"${w.title}"`).join(", ")}` : "No windows.", tree.menus.length ? `Menu bar: ${tree.menus.join(" | ")}` : ""];
    if (tree.focus?.role) lines.push(`Focused: ${tree.focus.role}${tree.focus.secure ? " (SECURE FIELD)" : ""}`);
    if (tree.windows.some((w) => w.modal && !w.main && w.title !== undefined) || tree.elements.some((el) => el.role === "Sheet" && el.label)) lines.push("A DIALOG OR SHEET IS OPEN on top of the page: deal with it (read it, then press its button or Escape) before anything behind it.");
    lines.push("Elements [index role \"label\" value x,y,w,h]:");
    for (const el of tree.elements) {
      const f = el.frame;
      lines.push(`[${el.i}] ${el.role} "${el.label}"${el.value ? ` value="${el.value}"` : ""}${el.secure ? " SECURE" : ""}${el.enabled ? "" : " disabled"}${el.focused ? " focused" : ""} ${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.w)},${Math.round(f.h)}`);
    }
    if (ocr.length) {
      lines.push("Text read from pixels (no accessibility tree) [text x,y]:");
      for (const line of ocr.slice(0, 70)) lines.push(`"${line.text}" ${line.x + Math.round(line.w / 2)},${line.y + Math.round(line.h / 2)}`);
    }
    if (tree.truncated) lines.push("(element list truncated)");
    const signature = crypto.createHash("sha1").update(`${tree.app}|${tree.windows.map((w) => w.title).join(",")}|${tree.elements.map((e) => `${e.label}${e.value || ""}${e.focused}`).join(";")}|${ocr.map((l) => l.text).join(";")}`).digest("hex");
    const win = tree.windows.find((w) => w.main) || tree.windows[0];
    const centre = win?.frame?.w ? { x: Math.round(win.frame.x + win.frame.w / 2), y: Math.round(win.frame.y + win.frame.h / 2) } : null;
    return { app: tree.app, pid: tree.pid, centre, elements: tree.elements, secureFocus: Boolean(tree.focus?.secure), text: lines.filter(Boolean).join("\n"), signature };
  }

  /* ---------- decision ---------- */

  async decide(phase, observation, messages, extra = {}) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.decideOnce(phase, observation, messages, extra); } catch (error) {
        if (error?.message === "__stopped__") throw error;
        lastError = error;
        await wait(350 * (attempt + 1));
        await this.gate();
      }
    }
    throw lastError;
  }

  async decideOnce(phase, observation, messages, extra) {
    return timed(`decide:${phase}`, () => this.decideRequest(phase, observation, messages, extra));
  }

  async decideRequest(phase, observation, messages, extra) {
    const response = await fetch(`${this.getServiceUrl()}/api/computer/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `clyra_token=${this.getServiceToken()}` },
      body: JSON.stringify({ phase, goal: this.run.goal, plan: this.run.plan, doneWhen: this.run.doneWhen, history: this.run.history, screen: observation.text, messages, ...extra }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(45_000)]),
    }).catch((error) => { if (this.abort.signal.aborted) throw new Error("__stopped__"); throw error; });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.decision) throw new Error(payload?.error || `Decision failed (${response.status})`);
    if (phase === "act") trace("actions", JSON.stringify(payload.decision.actions || payload.decision.action).slice(0, 420));
    return payload.decision;
  }

  /* ---------- action ---------- */

  elementPoint(observation, action) {
    if (Number.isInteger(action.element) || (typeof action.label === "string" && action.label && action.x === undefined)) {
      let el = Number.isInteger(action.element) ? observation.elements.find((item) => item.i === action.element) : undefined;
      // The model names the control it means as well as its number: when they disagree, the name wins (numbers get misread).
      const want = typeof action.label === "string" ? action.label.trim() : "";
      if (want && (!el || el.label.trim() !== want)) {
        const named = observation.elements.filter((item) => item.label.trim() === want && item.enabled !== false);
        const interactive = named.filter((item) => !/StaticText|Image|Cell|Row/.test(item.role));
        el = (interactive[0] || named[0]) ?? el;
      }
      if (!el) throw new Error(`Element ${action.element} is not on screen any more.`);
      return { x: Math.round(el.frame.x + el.frame.w / 2), y: Math.round(el.frame.y + el.frame.h / 2), el };
    }
    const x = Number(action.x), y = Number(action.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("The action had no target.");
    // A point close to a control means that control: snap to the nearest clickable element within a few pixels.
    let best = null, bestDistance = 34;
    for (const el of observation.elements) {
      if (el.enabled === false || /StaticText|Image|Group/.test(el.role)) continue;
      const dx = Math.max(el.frame.x - x, 0, x - (el.frame.x + el.frame.w)), dy = Math.max(el.frame.y - y, 0, y - (el.frame.y + el.frame.h));
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) { best = el; bestDistance = distance; }
    }
    if (best) return { x: Math.round(best.frame.x + best.frame.w / 2), y: Math.round(best.frame.y + best.frame.h / 2), el: best };
    return { x: Math.round(x), y: Math.round(y) };
  }

  /**
   * Things on the machine that are not a click: run a command, open a file or link, read a file or folder, Bluetooth, the
   * clipboard. Anything destructive or outward asks the person first; security settings and secrets are never touched.
   */
  async machineAction(type, action) {
    const home = os.homedir();
    const SECRET = /(\.ssh|id_rsa|id_ed25519|\.gnupg|keychain|\.aws|\.env\b|\.netrc|credentials|password|secrets?\.|\.npmrc|Library\/Cookies|Login Data|\.kube)/i;
    const SECURITY = /\b(tccutil|csrutil|spctl|sudo|security (?:add|delete|find|import|unlock)|defaults write com\.apple\.(?:security|TCC)|launchctl (?:load|unload|bootout|disable)|dscl|passwd|visudo)\b/i;
    const RISKY = /(\brm\s+-[a-z]*[rf]|\brm\b[^|;&]*\*|\bmkfs|\bdd\s+if=|>\s*\/dev\/|\bchmod\s+-R|\bchown\s+-R|\bkillall\b|\bpkill\b|\bshutdown\b|\breboot\b|\bcurl\b[^|]*\|\s*(?:sh|bash|zsh)|\bgit\s+(?:push|reset --hard|clean -f)|\bnpm\s+(?:publish|unpublish)|\bbrew\s+(?:uninstall|remove)|\bmv\b[^|;&]*\s\/(?:\s|$)|\bsendmail\b|\bmail\b)/i;
    const cap = (value, n = 1800) => String(value ?? "").slice(0, n);
    const under = (p) => path.resolve(String(p || "").replace(/^~(?=$|\/)/, home));
    switch (type) {
      case "shell": {
        const command = cap(action.command, 1200).trim();
        if (!command) return { ok: false, detail: "No command." };
        if (SECURITY.test(command) || SECRET.test(command)) return { ok: false, detail: "I won't run commands that change security settings or read secrets." };
        if (RISKY.test(command)) return { ok: false, needUser: `Run this? ${command.slice(0, 90)}` };
        try {
          const { stdout, stderr } = await execFileAsync("/bin/zsh", ["-lc", command], { cwd: home, timeout: 30_000, maxBuffer: 256 * 1024, env: { ...process.env, TERM: "dumb" } });
          return { ok: true, output: cap(`${stdout}${stderr ? `\n${stderr}` : ""}`.trim() || "(no output)", 900), detail: command.slice(0, 80) };
        } catch (error) {
          return { ok: false, detail: cap(error?.stderr || error?.message || "The command failed.", 300), output: cap(error?.stdout, 400) };
        }
      }
      case "open": {
        const target = cap(action.target || action.url || action.path, 600).trim();
        if (!target) return { ok: false, detail: "Nothing to open." };
        if (!/^https?:\/\//i.test(target) && SECRET.test(target)) return { ok: false, detail: "I won't open that." };
        const args = /^https?:\/\//i.test(target) ? [target] : /^[\w .&+\-]+$/.test(target) && !target.includes("/") ? ["-a", target] : [under(target)];
        try { await execFileAsync("open", args, { timeout: 10_000 }); return { ok: true, settleMs: 900, detail: `opened ${target.slice(0, 60)}` }; } catch (error) { return { ok: false, detail: cap(error?.message, 200) }; }
      }
      case "read_file": {
        const file = under(action.path);
        if (SECRET.test(file)) return { ok: false, detail: "I won't read that file." };
        try {
          const stat = await fs.stat(file);
          if (!stat.isFile() || stat.size > 400_000) return { ok: false, detail: "That is not a readable text file (or it is too large)." };
          return { ok: true, output: cap(await fs.readFile(file, "utf8"), 3000), detail: path.basename(file) };
        } catch (error) { return { ok: false, detail: cap(error?.message, 200) }; }
      }
      case "list_dir": {
        const dir = under(action.path || ".");
        if (SECRET.test(dir)) return { ok: false, detail: "I won't list that folder." };
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          return { ok: true, output: cap(entries.slice(0, 80).map((e) => `${e.isDirectory() ? "[dir] " : ""}${e.name}`).join("\n"), 2000), detail: path.basename(dir) || dir };
        } catch (error) { return { ok: false, detail: cap(error?.message, 200) }; }
      }
      case "clipboard": {
        if (action.text !== undefined) { clipboard.writeText(cap(action.text, 4000)); return { ok: true, detail: "copied" }; }
        return { ok: true, output: cap(clipboard.readText(), 1500), detail: "read the clipboard" };
      }
      case "bluetooth": {
        try {
          const { stdout } = await execFileAsync("/usr/sbin/system_profiler", ["SPBluetoothDataType", "-json"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
          const root = JSON.parse(stdout)?.SPBluetoothDataType?.[0] || {};
          const devices = [];
          for (const [group, list] of [["connected", root.device_connected], ["not connected", root.device_not_connected]]) {
            for (const item of list || []) for (const [name, info] of Object.entries(item)) devices.push({ name, address: info.device_address, state: group });
          }
          const wanted = String(action.device || "").toLowerCase();
          const verb = String(action.action || "list").toLowerCase();
          if (verb === "list" || !wanted) return { ok: true, output: cap(devices.map((d) => `${d.name} (${d.state})`).join("\n") || "No Bluetooth devices found.", 1500), detail: "listed Bluetooth devices" };
          const match = devices.find((d) => d.name.toLowerCase().includes(wanted));
          if (!match) return { ok: false, detail: `No Bluetooth device like “${action.device}”.`, output: cap(devices.map((d) => d.name).join(", "), 400) };
          const blueutil = await execFileAsync("/usr/bin/which", ["blueutil"]).then((r) => r.stdout.trim(), () => "");
          if (!blueutil) return { ok: false, detail: `${match.name} is ${match.state}. Connecting needs the Bluetooth menu: use System Settings → Bluetooth.`, output: `${match.name} (${match.state})` };
          await execFileAsync(blueutil, [verb === "disconnect" ? "--disconnect" : "--connect", match.address], { timeout: 20_000 });
          return { ok: true, detail: `${verb === "disconnect" ? "disconnected" : "connected to"} ${match.name}`, settleMs: 600 };
        } catch (error) { return { ok: false, detail: cap(error?.message, 200) }; }
      }
      default: return { ok: false, detail: "Unknown action." };
    }
  }

  async act(action, observation, label, { glided = false } = {}) {
    const type = String(action.type || "");
    // Input windows are the only moments the overlay lets events through; see ComputerOverlay.inject.
    // On macOS every AI input goes straight to the app (no shield hole, no real pointer movement). Windows still needs the hole.
    const inject = (work) => process.platform === "darwin" ? work() : this.overlay.inject(work);
    switch (type) {
      case "open_app": {
        const name = String(action.app || "").replace(/[^\w .&+\-]/g, "").slice(0, 60);
        if (!name) return { ok: false, detail: "No app name." };
        await this.desktop.setCursor({ ...this.desktop.cursorPoint(), label, kind: "move", durationMs: 0 });
        if (process.platform === "darwin") await execFileAsync("open", ["-a", name], { timeout: 10_000 });
        else await execFileAsync("powershell.exe", ["-NoProfile", "-Command", `Start-Process '${name.replace(/'/g, "''")}'`], { timeout: 10_000 });
        return { ok: true, settleMs: 1200 };
      }
      case "click": case "double_click": case "right_click": {
        const target = this.elementPoint(observation, action);
        if (target.el && (target.el.secure || (/TextField|TextArea|SearchField/.test(target.el.role) && SENSITIVE_LABEL.test(target.el.label)))) {
          return { ok: false, needUser: "This is a password or secret field. Enter it yourself, then press Resume." };
        }
        const button = type === "right_click" ? "right" : "left";
        const count = type === "double_click" ? 2 : 1;
        if (process.platform === "darwin" && observation.pid) {
          if (!glided) await this.desktop.glide(target.x, target.y, label);
          const clicked = await this.desktop.softClick(target.x, target.y, { button, count, label, press: async (mode) => (await this.perceive("press", observation.pid, target.x, target.y, mode)).ok === true, around: (work) => this.overlay.inject(work) });
          trace("click via", clicked?.via, target.x, target.y, target.el ? `${target.el.role} "${target.el.label}"` : "");
          if (!clicked?.ok) throw new Error("Click was not delivered (paused).");
        } else {
          await inject(async () => {
            const clicked = await this.desktop.click(target.x, target.y, button, label);
            if (!clicked?.ok) throw new Error(`Click was not delivered (${clicked?.skipped || clicked?.error || "unknown"}).`);
            if (type === "double_click") { await wait(70); await this.desktop.click(target.x, target.y, button, label); }
          });
        }
        return { ok: true, settleMs: 60, detail: `at ${target.x},${target.y}${target.el ? ` on ${target.el.role} "${target.el.label}"` : ""}` };
      }
      case "type": {
        if (observation.secureFocus) return { ok: false, needUser: "A password field is selected. Type it yourself, then press Resume." };
        const text = String(action.text ?? "");
        if (!text) return { ok: false, detail: "Nothing to type." };
        if (SENSITIVE_LABEL.test(text.slice(0, 40))) return { ok: false, needUser: "That looks like a secret. Please type it yourself, then press Resume." };
        await inject(async () => { await this.desktop.typeText(text, label); });
        return { ok: true, settleMs: 120 };
      }
      case "key": {
        const spec = String(action.keys || action.key || "");
        await inject(async () => {
          await this.desktop.setCursor({ ...this.desktop.cursorPoint(), label, kind: "key", durationMs: 0 });
          if (process.platform === "darwin") await execFileAsync("osascript", ["-e", keyScript(spec)], { timeout: 5_000 });
          else await this.desktop.key(spec, label);
        });
        return { ok: true, settleMs: 160 };
      }
      case "scroll": {
        const dy = Math.max(-10, Math.min(10, Number(action.dy) || 3));
        if (process.platform === "darwin" && observation.pid && observation.centre) {
          await this.desktop.glide(observation.centre.x, observation.centre.y, label);
          await this.desktop.pidScroll(observation.pid, observation.centre.x, observation.centre.y, -dy, label);
        } else await inject(async () => { await this.desktop.runAction({ type: "scroll", deltaY: dy }); });
        return { ok: true, settleMs: 200 };
      }
      case "shell": case "open": case "read_file": case "list_dir": case "bluetooth": case "clipboard":
        return this.machineAction(type, action);
      case "wait":
        await wait(Math.max(200, Math.min(4000, Number(action.ms) || 800)));
        return { ok: true };
      default:
        return { ok: false, detail: `Unknown action "${type}".` };
    }
  }
}

/** Accepts `actions` (preferred) or a single `action`, capped at 8, with a terminal action always last. */
function normalizeActions(decision) {
  const list = Array.isArray(decision?.actions) ? decision.actions : decision?.action ? [decision.action] : [];
  const clean = list.filter((item) => item && typeof item === "object" && item.type).slice(0, 8);
  const stop = clean.findIndex((item) => ["done", "fail", "need_user"].includes(item.type));
  const trimmed = stop === -1 ? clean : clean.slice(0, stop + 1);
  return trimmed.length ? trimmed : [{ type: "wait", ms: 600 }];
}

/** Finds the same control in a fresh reading of the screen: same role and label, nearest to where it was. */
function describeAction(action, observation) {
  const el = Number.isInteger(action.element) || action.label ? observation.elements.find((item) => item.i === action.element) : null;
  switch (action.type) {
    case "click": case "double_click": case "right_click": return `${action.type.replace("_", " ")} ${el ? `"${el.label || el.role}"` : `${action.x},${action.y}`}`;
    case "type": return `typed "${String(action.text || "").slice(0, 30)}"`;
    case "key": return `pressed ${action.keys || action.key}`;
    case "open_app": return `opened ${action.app}`;
    case "shell": return `ran ${String(action.command || "").slice(0, 40)}`;
    case "open": return `opened ${String(action.target || action.url || action.path || "").slice(0, 40)}`;
    case "read_file": return `read ${action.path}`;
    case "list_dir": return `listed ${action.path || "."}`;
    case "bluetooth": return `bluetooth ${action.action || "list"} ${action.device || ""}`.trim();
    case "clipboard": return action.text !== undefined ? "copied text" : "read clipboard";
    default: return action.type;
  }
}

function relocate(elements, original) {
  const same = elements.filter((item) => item.role === original.role && item.label === original.label);
  if (!same.length) return null;
  const centre = (item) => ({ x: item.frame.x + item.frame.w / 2, y: item.frame.y + item.frame.h / 2 });
  const from = centre(original);
  return same.sort((a, b) => Math.hypot(centre(a).x - from.x, centre(a).y - from.y) - Math.hypot(centre(b).x - from.x, centre(b).y - from.y))[0];
}

function actionLabel(action) {
  switch (action?.type) {
    case "open_app": return `Opening ${action.app || "app"}`;
    case "click": return "Clicking";
    case "double_click": return "Double-clicking";
    case "right_click": return "Right-clicking";
    case "type": return "Typing";
    case "key": return `Pressing ${action.keys || "a key"}`;
    case "scroll": return "Scrolling";
    default: return "Working";
  }
}
