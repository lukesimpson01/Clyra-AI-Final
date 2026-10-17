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
console.log("flow-native-contract-tests: 6 assertions passed");
