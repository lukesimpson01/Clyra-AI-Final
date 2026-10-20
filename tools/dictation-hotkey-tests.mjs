import assert from "node:assert/strict";
import { createTapMachine, TAP_MAX_MS } from "../electron/dictation-hotkey.mjs";

let t = 0;
let taps = 0;
const m = createTapMachine({ now: () => t, onTap: () => { taps += 1; } });
const tap = (down = 90) => { m.press(); t += down; m.release(); t += 500; };

// A clean press-and-release is one tap = one toggle (start, then stop on the next tap).
tap(); assert.equal(taps, 1);
tap(); assert.equal(taps, 2);
// Holding the key is NOT a hotkey press (no hold-to-talk).
m.press(); t += TAP_MAX_MS + 300; m.release(); assert.equal(taps, 2);
// Using the key with another key (Option+letter typing) is never the hotkey.
m.press(); t += 80; m.otherKey(); m.release(); assert.equal(taps, 2);
t += 500;
// Key auto-repeat doesn't produce extra taps.
m.press(); m.press(); m.press(); t += 90; m.release(); assert.equal(taps, 3);
t += 500;
// A lost key-up must never lock the hotkey: a key-down older than 30s is treated as stale.
m.press(); t += 40_000; m.press(); t += 90; m.release(); assert.equal(taps, 4);
// reset() clears any half-finished press.
m.press(); m.reset(); m.release(); assert.equal(taps, 4);
console.log("dictation-hotkey-tests: tap-to-toggle assertions passed");
