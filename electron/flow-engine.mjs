import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir, constants as osConstants, setPriority } from "node:os";
import path from "node:path";

/**
 * Clyra Flow's own speech engine, living in the Electron main process so the
 * dictation hotkey never depends on the heavy Clyra service or window.
 * Keeps NVIDIA Parakeet-TDT loaded in a tiny native worker (parakeet-daemon),
 * decodes a short utterance in ~0.4s, and unloads itself when idle.
 */
// The ~480MB model unloads after a few idle minutes (it reloads while you start speaking), so Flow is light on RAM.
const IDLE_UNLOAD_MS = 4 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MODELS = ["ggml-parakeet-tdt-0.6b-v3-q4_k.bin", "ggml-parakeet-tdt-0.6b-v3-q4_0.bin", "ggml-parakeet-tdt-0.6b-v3-q8_0.bin"];

export function resolveSpeechRuntime(projectRoot) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const roots = [
    process.env.CLYRA_SPEECH_RUNTIME,
    process.resourcesPath ? path.join(process.resourcesPath, "speech-runtime") : "",
    path.join(projectRoot, "vendor", "whisper.cpp"),
  ].filter(Boolean);
  for (const root of roots) {
    const daemon = path.join(root, "build", "bin", `parakeet-daemon${exe}`);
    if (!existsSync(daemon)) continue;
    const model = [process.env.CLYRA_PARAKEET_MODEL, ...MODELS.map((name) => path.join(root, "models", name))].filter(Boolean).find((candidate) => existsSync(candidate));
    if (model) return { daemon, model };
  }
  return null;
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class FlowEngine {
  constructor({ projectRoot, log = console }) {
    this.projectRoot = projectRoot;
    this.log = log;
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.buffer = "";
    this.nextId = 0;
    this.idleTimer = null;
  }

  get available() {
    return Boolean(resolveSpeechRuntime(this.projectRoot));
  }

  /** Start (or reuse) the worker. Resolves once the model is loaded and primed. */
  warm() {
    if (!this.ready) this.ready = this.#spawn().catch((error) => { this.stop(); throw error; });
    this.#touch();
    return this.ready;
  }

  async #spawn() {
    const runtime = resolveSpeechRuntime(this.projectRoot);
    if (!runtime) throw new Error("Clyra's speech engine isn't installed. Run npm run setup:speech once.");
    // Few threads + low priority: decoding must never starve the pill's animation or the microphone while you talk.
    const threads = Math.max(2, Math.min(4, Math.floor((cpus().length * 3) / 8)));
    const child = spawn(runtime.daemon, ["-m", runtime.model, "-t", String(threads)], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    try { if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    this.buffer = "";
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The speech engine did not start in time.")), 30_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error("The speech engine exited while starting.")); });
      child.stdout.on("data", (chunk) => {
        this.buffer += chunk;
        let newline;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          if (line === "READY") { clearTimeout(timer); resolve(); continue; }
          const tab = line.indexOf("\t");
          if (tab < 0) continue;
          const id = line.slice(0, tab);
          const entry = this.pending.get(id);
          if (!entry) continue;
          clearTimeout(entry.timer);
          this.pending.delete(id);
          entry.resolve(line.slice(tab + 1).replace(/\s+/g, " ").trim());
        }
      });
    });
    child.on("exit", () => {
      if (this.child === child) { this.child = null; this.ready = null; }
      for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error("The speech engine stopped.")); this.pending.delete(id); }
    });
    child.on("error", () => { /* surfaced through exit / ready */ });
    await ready;
  }

  /** @param {Buffer} pcm 16-bit mono PCM @ sampleRate */
  async transcribe(pcm, sampleRate = 16_000) {
    await this.warm();
    const child = this.child;
    if (!child) throw new Error("The speech engine is unavailable.");
    const directory = await mkdtemp(path.join(tmpdir(), "clyra-flow-"));
    const wav = path.join(directory, "utterance.wav");
    try {
      // Speech models clip or mishear a word that starts at sample 0 ("Hi" -> "Aye"): give every clip a little silence
      // on both sides, which is exactly what a phrase cut out of a longer recording lacks.
      const pad = (seconds) => Buffer.alloc(Math.round(sampleRate * seconds) * 2);
      await writeFile(wav, pcmToWav(Buffer.concat([pad(0.4), pcm, pad(0.3)]), sampleRate));
      const id = String(++this.nextId);
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Transcription timed out.")); this.stop(); }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer });
      });
      child.stdin.write(`${id}\t${wav}\n`);
      return await result;
    } finally {
      this.#touch();
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  #touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), IDLE_UNLOAD_MS);
    this.idleTimer.unref?.();
  }

  stop() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const child = this.child;
    this.child = null;
    this.ready = null;
    try { child?.stdin.end(); child?.kill(); } catch { /* already gone */ }
  }
}
