import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, freemem, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { analyzeSpeech, estimateSpeechRate, pickTempo, timeStretch } from "../../lib/speech/speechSegments.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd());
// Packaged builds ship the runtime under resources/speech-runtime. In dev,
// Electron also defines resourcesPath (its own bundle), so only trust it when
// the folder really exists; otherwise use the vendored checkout.
const packagedRuntime = process.resourcesPath ? path.join(process.resourcesPath, "speech-runtime") : "";
const runtimeRoot = packagedRuntime && existsSync(packagedRuntime) ? packagedRuntime : path.join(root, "vendor", "whisper.cpp");
const modelRoot = process.env.CLYRA_WHISPER_MODEL_DIR || path.join(runtimeRoot, "models");

/**
 * Default engine: NVIDIA Parakeet-TDT 0.6B v3 (CC-BY-4.0) via whisper.cpp's
 * `parakeet-cli`, 4-bit k-quant (~416MB). It is markedly more accurate than
 * Whisper small/base and ~13x realtime on a 4-core CPU. Whisper stays as the
 * fallback when the Parakeet model has not been installed.
 */
export type SpeechEngine = "parakeet" | "whisper";
const PARAKEET_MODELS = ["ggml-parakeet-tdt-0.6b-v3-q4_k.bin", "ggml-parakeet-tdt-0.6b-v3-q4_0.bin", "ggml-parakeet-tdt-0.6b-v3-q8_0.bin"];

async function resolveParakeet() {
  const extension = process.platform === "win32" ? ".exe" : "";
  const executables = [
    process.env.CLYRA_PARAKEET_BIN,
    path.join(runtimeRoot, "build", "bin", `parakeet-cli${extension}`),
    path.join(root, "vendor", "whisper.cpp", "build", "bin", `parakeet-cli${extension}`),
  ].filter(Boolean) as string[];
  const models = [process.env.CLYRA_PARAKEET_MODEL, ...PARAKEET_MODELS.map((name) => path.join(modelRoot, name))].filter(Boolean) as string[];
  let executable = "";
  let model = "";
  for (const candidate of executables) if (await exists(candidate)) { executable = candidate; break; }
  for (const candidate of models) if (await exists(candidate)) { model = candidate; break; }
  return executable && model ? { executable, model } : null;
}

// CPU is the verified-fast, verified-correct path on every Mac (Metal returned
// empty transcripts on Intel, and a 0.6B model decodes ~13x realtime on CPU
// anyway). Apple Silicon users can opt in with CLYRA_PARAKEET_GPU=1; an empty
// GPU result already retries on CPU.
const parakeetUsesGpu = () => process.platform === "darwin" && process.arch === "arm64" && process.env.CLYRA_PARAKEET_GPU === "1";


/**
 * Warm Parakeet worker. Loading the model costs ~1s, so a long-lived process
 * (examples/parakeet-cli/parakeet-daemon.cpp) keeps it in memory: a short
 * utterance then decodes in ~0.4s instead of ~2-3s. It is started when
 * dictation begins (so loading overlaps with speaking) and unloaded after
 * IDLE_UNLOAD_MS without use to give the ~640MB back.
 */
const IDLE_UNLOAD_MS = 4 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

class ParakeetDaemon {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = "";
  private nextId = 0;
  private idleTimer: NodeJS.Timeout | null = null;

  private async spawnWorker(parakeet: { executable: string; model: string }) {
    const daemonName = `parakeet-daemon${process.platform === "win32" ? ".exe" : ""}`;
    const daemon = path.join(path.dirname(parakeet.executable), daemonName);
    if (!(await exists(daemon))) throw new Error("parakeet-daemon is not built");
    const args = ["-m", parakeet.model, "-t", String(parakeetThreads())];
    if (parakeetUsesGpu()) args.push("--gpu");
    const child = spawn(daemon, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.buffer = "";
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("parakeet-daemon did not become ready")), 30_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error("parakeet-daemon exited during startup")); });
      child.stdout.on("data", (chunk: string) => {
        this.buffer += chunk;
        let newline: number;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          if (line === "READY") { clearTimeout(timer); resolve(); continue; }
          const tab = line.indexOf("\t");
          if (tab < 0) continue;
          const entry = this.pending.get(line.slice(0, tab));
          if (!entry) continue;
          clearTimeout(entry.timer);
          this.pending.delete(line.slice(0, tab));
          entry.resolve(line.slice(tab + 1).replace(/\s+/g, " ").trim());
        }
      });
    });
    child.on("exit", () => {
      if (this.child === child) { this.child = null; this.ready = null; }
      for (const [id, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(new Error("parakeet-daemon exited")); this.pending.delete(id); }
    });
    child.on("error", () => { /* surfaces through exit/ready rejection */ });
    await ready;
  }

  /** Start (or reuse) the worker. Safe to call often; resolves when it is warm. */
  warm(parakeet: { executable: string; model: string }) {
    if (!this.ready) {
      this.ready = this.spawnWorker(parakeet).catch((error) => { this.stop(); throw error; });
    }
    this.touch();
    return this.ready;
  }

  async transcribe(parakeet: { executable: string; model: string }, wavPath: string) {
    await this.warm(parakeet);
    const child = this.child;
    if (!child) throw new Error("parakeet-daemon unavailable");
    const id = String(++this.nextId);
    const result = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("parakeet-daemon timed out")); this.stop(); }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
    });
    child.stdin.write(`${id}\t${wavPath}\n`);
    try { return await result; } finally { this.touch(); }
  }

  private touch() {
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

const parakeetDaemon = new ParakeetDaemon();

/** Begin loading the speech model now so the first transcription is instant. */
export async function warmSpeechEngine() {
  if (process.env.CLYRA_STT_ENGINE === "whisper" || process.env.CLYRA_PARAKEET_DAEMON === "0") return false;
  const parakeet = await resolveParakeet();
  if (!parakeet) return false;
  try { await parakeetDaemon.warm(parakeet); return true; } catch { return false; }
}

export function stopSpeechEngine() { parakeetDaemon.stop(); }

export type WhisperProfile = "tiny" | "base" | "small";
export type WhisperRuntime = { profile: WhisperProfile; language: string; model: string; executable: string; threads: number; gpu: "metal" | "cuda" | "vulkan" | "cpu" };

const exists = async (candidate: string) => access(candidate).then(() => true).catch(() => false);

export function selectWhisperProfile(language = "en", requested?: string): WhisperProfile {
  if (["tiny", "base", "small"].includes(String(requested))) return requested as WhisperProfile;
  const memoryGb = freemem() / 1024 ** 3;
  const cores = cpus().length;
  // Free memory is deliberately conservative: do not evict a user's work just to run STT.
  if (memoryGb >= 7 && cores >= 8) return "small";
  if (memoryGb >= 3 && cores >= 4) return "base";
  return "tiny";
}

function suffix(language: string) { return language.toLowerCase().startsWith("en") ? ".en" : ""; }
function executableCandidates() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return [
    process.env.CLYRA_WHISPER_BIN,
    path.join(runtimeRoot, "build", "bin", `whisper-cli${extension}`),
    path.join(runtimeRoot, "build", "bin", `main${extension}`),
    path.join(root, "vendor", "whisper.cpp", "build", "bin", `whisper-cli${extension}`),
  ].filter(Boolean) as string[];
}

async function resolveExecutable() {
  for (const candidate of executableCandidates()) if (await exists(candidate)) return candidate;
  throw new Error("Local transcription is not installed yet. Run npm run setup:speech once, then try again.");
}

async function resolveModel(profile: WhisperProfile, language: string) {
  const named = process.env.CLYRA_WHISPER_MODEL;
  const profiles = [profile, "tiny", "base", "small"].filter((value, index, all) => all.indexOf(value) === index) as WhisperProfile[];
  const candidates = [named, ...profiles.flatMap((candidateProfile) => [
    path.join(modelRoot, `ggml-${candidateProfile}${suffix(language)}-q5_1.bin`),
    path.join(modelRoot, `ggml-${candidateProfile}${suffix(language)}.bin`),
    path.join(modelRoot, `ggml-${candidateProfile}.bin`),
  ])].filter(Boolean) as string[];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error(`Local ${profile} Whisper model is not installed. Run npm run setup:speech once, then try again.`);
}

export async function resolveWhisperRuntime(options: { language?: string; profile?: string } = {}): Promise<WhisperRuntime> {
  const language = (options.language || "en").slice(0, 12);
  let profile = selectWhisperProfile(language, options.profile || process.env.CLYRA_WHISPER_PROFILE);
  const executable = await resolveExecutable();
  const model = await resolveModel(profile, language);
  const modelProfile = model.match(/ggml-(tiny|base|small)/)?.[1] as WhisperProfile | undefined;
  if (modelProfile) profile = modelProfile;
  // Intel Macs often expose Metal but run whisper.cpp slower/reliably worse
  // than Accelerate. Apple Silicon takes the Metal path; every other target
  // retains the conservative CPU fallback unless explicitly configured.
  const gpu = process.platform === "darwin" && process.arch === "arm64" ? "metal" : process.env.CLYRA_WHISPER_GPU === "cuda" ? "cuda" : process.env.CLYRA_WHISPER_GPU === "vulkan" ? "vulkan" : "cpu";
  return { profile, language, executable, model, gpu, threads: Math.max(2, Math.min(8, cpus().length - 1)) };
}

function pcmToWav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const parakeetThreads = () => Math.max(2, Math.min(6, Math.floor(cpus().length / 2)));

async function runParakeet(parakeet: { executable: string; model: string }, input: string, gpu: boolean) {
  // Threads ~= physical cores. cpus().length counts hyper-threads, and
  // oversubscribing made the same clip 2-3x slower on a busy 4-core laptop.
  const args = ["-t", String(parakeetThreads()), "-m", parakeet.model, "-f", input];
  if (!gpu) args.unshift("-ng");
  const { stdout } = await execFileAsync(parakeet.executable, args, { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.replace(/\s+/g, " ").trim();
}

/** Runs the local STT engine only for an active utterance; there is no idle AI process. */
export async function transcribePcm(pcm: Buffer, sampleRate = 16000, options: { language?: string; profile?: string; prompt?: string[]; engine?: SpeechEngine } = {}) {
  if (!pcm.length) return { text: "", runtime: null, elapsedMs: 0, engine: "none" as const };
  // Only speech goes to the model: leading/trailing silence and long pauses are cut (faster, and no invented words
  // from room noise), and a clip with no speech in it returns nothing rather than a guess.
  const speech = analyzeSpeech(pcm, sampleRate);
  if (speech.noSpeech) return { text: "", runtime: null, elapsedMs: 0, engine: "none" as const, noSpeech: true, speechMs: speech.speechMs, audioMs: speech.durationMs, trimmedMs: 0 };
  const audioMs = speech.durationMs;
  const trimmedMs = Math.round((speech.trimmed.length / 2 / sampleRate) * 1000);
  pcm = speech.trimmed;
  const tempo = pickTempo(estimateSpeechRate(pcm, sampleRate));
  if (tempo < 1) pcm = timeStretch(pcm, tempo);
  const directory = await mkdtemp(path.join(tmpdir(), "clyra-stt-"));
  const input = path.join(directory, "utterance.wav");
  const started = performance.now();
  try {
    await writeFile(input, pcmToWav(pcm, sampleRate));
    const preferred = options.engine || process.env.CLYRA_STT_ENGINE;
    const parakeet = preferred === "whisper" ? null : await resolveParakeet();
    if (parakeet) {
      let text = "";
      let viaDaemon = false;
      if (process.env.CLYRA_PARAKEET_DAEMON !== "0") {
        try { text = await parakeetDaemon.transcribe(parakeet, input); viaDaemon = true; } catch { /* fall back to the one-shot CLI below */ }
      }
      if (!viaDaemon) text = await runParakeet(parakeet, input, parakeetUsesGpu());
      if (!text && !viaDaemon && parakeetUsesGpu()) text = await runParakeet(parakeet, input, false);
      return { text, runtime: null, elapsedMs: Math.round(performance.now() - started), engine: "parakeet" as const, warm: viaDaemon, speechMs: speech.speechMs, audioMs, trimmedMs };
    }
    const runtime = await resolveWhisperRuntime(options);
    const output = path.join(directory, "transcript");
    const args = ["-m", runtime.model, "-f", input, "-otxt", "-of", output, "-nt", "-t", String(runtime.threads), "-l", runtime.language];
    if (runtime.gpu === "cpu") args.unshift("-ng");
    if (options.prompt?.length) args.push("-p", options.prompt.slice(0, 80).join(", "));
    await execFileAsync(runtime.executable, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
    const text = (await readFile(`${output}.txt`, "utf8")).replace(/\s+/g, " ").trim();
    return { text, runtime, elapsedMs: Math.round(performance.now() - started), engine: "whisper" as const, speechMs: speech.speechMs, audioMs, trimmedMs };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function localSpeechStatus() {
  const parakeet = await resolveParakeet();
  if (parakeet && process.env.CLYRA_STT_ENGINE !== "whisper") return { available: true, runtime: { engine: "parakeet", model: path.basename(parakeet.model), gpu: parakeetUsesGpu() ? "metal" : "cpu" } };
  try { const runtime = await resolveWhisperRuntime(); return { available: true, runtime: { profile: runtime.profile, gpu: runtime.gpu, model: path.basename(runtime.model) } }; }
  catch (error) { return { available: false, error: error instanceof Error ? error.message : "Local transcription unavailable" }; }
}
