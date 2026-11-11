import assert from "node:assert/strict";
import { getVoiceVisualMode, RollingVoiceFrames, routeVoiceVisualIntent, setVoiceVisualMode, type VoiceVisionFrame } from "../src/voice/multimodal";

assert.equal(routeVoiceVisualIntent("What am I holding?")?.action, "enable-camera");
assert.equal(routeVoiceVisualIntent("Open the camera")?.source, "camera");
assert.equal(routeVoiceVisualIntent("Share my screen")?.action, "enable-screen");
assert.equal(routeVoiceVisualIntent("Point to that button", "screen")?.action, "point");
assert.equal(routeVoiceVisualIntent("Do it for me", "screen")?.action, "control");
assert.equal(routeVoiceVisualIntent("What happened a moment ago?", "camera")?.action, "inspect");
assert.equal(routeVoiceVisualIntent("Stop looking", "screen")?.action, "voice-only");
assert.equal(routeVoiceVisualIntent("What's the weather?"), null);
setVoiceVisualMode("screen");
assert.equal(getVoiceVisualMode(), "screen");
assert.equal(routeVoiceVisualIntent("Where do I click?", "screen"), null); // ordinary conversation still reaches adaptive agent
setVoiceVisualMode("voice");

const sample = (time: number, source: "camera" | "screen" = "camera"): VoiceVisionFrame =>
  ({ time, source, width: 640, height: 360, image: "data:image/jpeg;base64,AA==" });

const buffer = new RollingVoiceFrames({ lifetimeMs: 45_000, maxFrames: 15, maxBytes: 1_000 });
for (let i = 0; i < 12; i++) buffer.add(sample(i * 1_000));
assert.equal(buffer.size, 12);
const picks = buffer.select(11_000, 4);
assert.equal(picks.length, 4);
assert.equal(picks[0].time, 0);
assert.equal(picks[3].time, 11_000);
assert.ok(picks.every((frame, index) => index === 0 || frame.time > picks[index - 1].time));
assert.equal(buffer.select(11_000, 1)[0].time, 11_000);
assert.equal(buffer.select(60_000).length, 0);
assert.equal(buffer.size, 0);

const capacity = new RollingVoiceFrames({ maxFrames: 3, maxBytes: 1_000 });
for (let i = 0; i < 8; i++) capacity.add(sample(i * 1_000));
assert.equal(capacity.size, 3);
assert.deepEqual(capacity.select(8_000).map(f => f.time), [5_000, 6_000, 7_000]);
capacity.add({ ...sample(8_000), image: "data:image/png;base64,AA==" });
assert.equal(capacity.size, 3);
capacity.clear();
assert.equal(capacity.size, 0);
console.log("voice-multimodal-tests: visual-intent and frame-history checks passed");
