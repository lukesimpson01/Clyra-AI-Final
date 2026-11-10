import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [manager, renderer, stream, controller] = await Promise.all([
  readFile(new URL("../electron/dictation-manager.mjs", import.meta.url), "utf8"),
  readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
  readFile(new URL("../backend/voice/websocket/dictation-stream.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/components/DictationController.tsx", import.meta.url), "utf8"),
]);
assert.match(manager, /Control\+Alt\+Space/);
assert.match(manager, /startHotkeyListener/);
assert.match(manager, /showInactive\(\)/);
assert.match(manager, /powershell\.exe/);
assert.match(renderer, /<DictationController \/>/);
// One subscriber only: a second hook on dictation:trigger started two sessions per press.
assert.doesNotMatch(renderer, /dictation\.onTrigger/);
assert.match(controller, /dictation\.onTrigger/);
assert.match(stream, /transcribePcm/);
// Flow runs on its own: hotkey + hidden mic window + speech engine start before (or without) the UI.
const [main, native] = await Promise.all([
  readFile(new URL("../electron/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../electron/flow-native.mjs", import.meta.url), "utf8"),
]);
assert.match(main, /initFlowEarly\(\);\s*\n\s*syncAnywhereTray/);
assert.match(main, /backgroundLaunch && keepRunningInBackground\(\)/);
assert.match(main, /function ensureFullBoot/);
assert.match(manager, /nativeStart\(activationId\)/);
assert.match(native, /session\.fromPartition\("flow-capture"\)/);
// Recovery guarantees: nothing can leave the pill stuck, and it must sit above everything.
assert.match(manager, /armWatchdog\(\)/);
assert.match(manager, /forceReset\(/);
assert.match(manager, /setAlwaysOnTop\(true, "screen-saver"(, 1)?\)/);
assert.match(manager, /enableAutoStop\(\)/);
assert.match(manager, /createTapMachine/);
assert.doesNotMatch(manager, /createGestureMachine/);
// The pill must stay on the Space you are in: a fresh window per dictation, never a re-shown one.
assert.match(manager, /retirePill\(\)/);
assert.match(manager, /prepareSpare\(\)/);
assert.match(manager, /presentAndInsert\(/);
assert.doesNotMatch(manager, /current\.hide\(\)/);
// Voice detection and end-of-speech run on the audio itself in the main process (see flow-endpoint-tests).
const [session, capture] = await Promise.all([
  readFile(new URL("../electron/flow-session.mjs", import.meta.url), "utf8"),
  readFile(new URL("../electron/flow-capture.html", import.meta.url), "utf8"),
]);
assert.match(manager, /new FlowSession\(/);
assert.match(manager, /native\.onPcm = /);
assert.match(session, /requiredSilenceMs\(/);
assert.match(capture, /AudioWorkletNode/);
assert.doesNotMatch(native, /Buffer\.concat/);   // reading the live audio must not re-join the whole recording
// The paste is issued before the edit animation, never after it.
assert.ok(manager.indexOf("startPaste();") < manager.indexOf('phase: "refining"'));
console.log("flow-native-contract-tests: 25 assertions passed");
