/**
 * End-to-end smoke test for Clyra Flow (the Right Option dictation), with a recording played in as the microphone.
 *
 *   npx electron tools/flow-electron-smoke.mjs path/to/recording.wav [--shots out-dir]
 *
 * It runs the real DictationManager + FlowNative (capture window) + FlowEngine (speech model), presses the hotkey
 * once, and then only watches: the session has to notice the end of speech and stop by itself. Nothing is pasted
 * anywhere (CLYRA_FLOW_DRY_RUN); the text that would have been inserted is printed.
 * Exit code 0 = it stopped on its own and produced text.
 */
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const electronDir = path.join(here, "..", "electron");
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--no-sandbox"));
const wav = args.find((arg) => /\.wav$/i.test(arg));
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : "";
if (!wav) { console.error("usage: electron tools/flow-electron-smoke.mjs recording.wav [--shots dir]"); process.exit(2); }

process.env.CLYRA_FLOW_DRY_RUN = "1";
process.env.CLYRA_DISABLE_KEY_HOOK = "1";
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", `${path.resolve(wav)}%noloop`);
app.setPath("userData", path.join(os.tmpdir(), `clyra-flow-smoke-${process.pid}`));

const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(2)}s`;
let inserted = null;
const log = console.log.bind(console);
console.log = (...parts) => {
  const line = parts.join(" ");
  const match = line.match(/dry-run insert .*?: (".*")$/);
  if (match) { try { inserted = JSON.parse(match[1]); } catch { inserted = match[1]; } }
  if (line.startsWith("[flow]")) log(`  ${at()} ${line}`);
};

app.whenReady().then(async () => {
  const [{ DictationManager }, { FlowEngine }, { FlowNative }] = await Promise.all([
    import(path.join(electronDir, "dictation-manager.mjs")),
    import(path.join(electronDir, "flow-engine.mjs")),
    import(path.join(electronDir, "flow-native.mjs")),
  ]);
  const engine = new FlowEngine({ projectRoot: path.join(here, "..") });
  if (!engine.available) { console.error("The speech engine is not installed (npm run setup:speech, or set CLYRA_SPEECH_RUNTIME)."); app.exit(2); return; }
  const native = new FlowNative({ preloadPath: path.join(electronDir, "flow-capture-preload.cjs"), capturePath: path.join(electronDir, "flow-capture.html") });
  const manager = new DictationManager({
    uiContents: () => null,
    preloadPath: path.join(electronDir, "dictation-preload.cjs"),
    pillPath: path.join(electronDir, "dictation-pill.html"),
    native, engine,
    settingsPath: path.join(app.getPath("userData"), "flow-settings.json"),
  });
  await manager.initialize();
  await native.ensureWindow();
  await engine.warm();
  log(`engine + capture window ready at ${at()}`);

  const phases = [];
  let lastPartial = "";
  let shot = 0;
  const capture = async (label) => {
    if (!shotsDir || !manager.window || manager.window.isDestroyed()) return;
    mkdirSync(shotsDir, { recursive: true });
    const image = await manager.window.webContents.capturePage().catch(() => null);
    if (image) writeFileSync(path.join(shotsDir, `${String(++shot).padStart(2, "0")}-${label}.png`), image.toPNG());
  };
  const tapAt = Date.now();
  log(`${at()} hotkey tapped`);
  manager.hotkeyPressed();
  let previous = "idle";
  let stoppedAt = 0;
  // Observe every state change at the source (a poll would miss phases that last a few milliseconds).
  const setState = manager.setState.bind(manager);
  manager.setState = (payload) => {
    setState(payload);
    const phase = manager.phase;
    if (phase !== previous) {
      phases.push({ phase, ms: Date.now() - tapAt });
      log(`${at()} phase: ${previous} -> ${phase}${manager.payload.detail ? ` (${manager.payload.detail})` : ""}`);
      if (phase === "processing") stoppedAt = Date.now();
      previous = phase;
      setTimeout(() => void capture(phase), phase === "listening" ? 900 : 350);
    }
    const partial = manager.payload.partial || "";
    if (phase === "listening" && partial !== lastPartial) { lastPartial = partial; log(`${at()} live: "${partial}"`); setTimeout(() => void capture("live"), 300); }
  };
  const poll = setInterval(() => {
    if ((manager.lastMeter?.ending || 0) > 0.5 && manager.phase === "listening" && !poll.sawCountdown) { poll.sawCountdown = true; void capture("countdown"); }
  }, 25);

  const deadline = setTimeout(() => finish("timed out"), 45_000);
  const finish = (problem = "") => {
    clearInterval(poll); clearTimeout(deadline);
    const listening = phases.find((entry) => entry.phase === "listening");
    const processing = phases.find((entry) => entry.phase === "processing");
    const done = phases.find((entry) => entry.phase === "done");
    log("");
    log(`microphone live:        ${listening ? `${listening.ms} ms after the tap` : "never"}`);
    log(`stopped on its own:     ${processing ? `yes, ${((processing.ms - (listening?.ms || 0)) / 1000).toFixed(2)} s into the recording` : "NO"}`);
    log(`text inserted:          ${inserted === null ? "nothing" : JSON.stringify(inserted)}`);
    log(`stop -> text delivered: ${done && stoppedAt ? `${done.ms - processing.ms} ms until the pill shows done (the paste is issued first, ~60 ms after stop)` : "n/a"}`);
    const ok = !problem && Boolean(processing) && Boolean(inserted);
    log(ok ? "RESULT: pass" : `RESULT: fail${problem ? ` (${problem})` : ""}`);
    try { manager.destroy(); native.destroy(); engine.stop(); } catch { /* shutting down */ }
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
    app.exit(ok ? 0 : 1);
  };
  const watch = setInterval(() => {
    if (manager.phase === "error") { clearInterval(watch); setTimeout(() => finish(manager.payload.detail || "error"), 400); }
    if (phases.some((entry) => entry.phase === "done") && manager.phase === "idle") { clearInterval(watch); finish(); }
  }, 50);
});
