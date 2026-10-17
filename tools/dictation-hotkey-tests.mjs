import assert from "node:assert/strict";
import { createGestureMachine } from "../electron/dictation-hotkey.mjs";

let t = 0;
const log = [];
const m = createGestureMachine({
  now: () => t,
  onStart: () => log.push("start"), onStop: () => log.push("stop"),
  onCancel: () => log.push("cancel"), onHandsFree: () => log.push("handsfree"),
});
// hold = push-to-talk
m.press(); t = 900; m.release(); assert.deepEqual(log.splice(0), ["start", "stop"]);
// tap = hands-free, next tap stops, its release is swallowed
t = 2000; m.press(); t = 2100; m.release(); assert.deepEqual(log.splice(0), ["start", "handsfree"]);
t = 5000; m.press(); assert.deepEqual(log.splice(0), ["stop"]); t = 5080; m.release(); assert.deepEqual(log, []);
// auto-repeat keydowns are ignored
t = 6000; m.press(); m.press(); m.press(); t = 6600; m.release(); assert.deepEqual(log.splice(0), ["start", "stop"]);
// Option+letter typing cancels instead of dictating
t = 7000; m.press(); t = 7100; m.otherKey(); m.release(); assert.deepEqual(log.splice(0), ["start", "cancel"]);
console.log("dictation-hotkey-tests: 8 assertions passed");
