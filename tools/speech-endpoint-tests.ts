import assert from "node:assert/strict";
import { SpeechEndpointer } from "../src/lib/dictationEndpoint";
import { analyzeSpeech, estimateSpeechRate, pickTempo, timeStretch } from "../lib/speech/speechSegments.mjs";
import { summarizeFix } from "../src/lib/dictationSteps";

// ---- endpointing: knows when you have finished -----------------------------------------------------------
function run(segments: Array<[number, number]>, noise = 0.02) {
  const e = new SpeechEndpointer();
  e.reset(0);
  for (let ms = 0; ms < 30_000; ms += 100) {
    const level = segments.some(([a, b]) => ms >= a && ms < b) ? 0.18 + 0.05 * Math.sin(ms) : noise * (1 + 0.2 * Math.sin(ms * 3));
    const ev = e.push(level, ms);
    if (ev.kind === "end" || ev.kind === "no-speech") return { kind: ev.kind, at: ms };
  }
  return { kind: "never", at: 30_000 };
}
const short = run([[600, 2100]]);
assert.equal(short.kind, "end");
assert.ok(short.at - 2100 >= 700 && short.at - 2100 <= 1400, `short command should end about a second after speech, ended ${short.at - 2100}ms after`);
const long = run([[600, 2500], [3200, 5600], [6300, 8800]]);
assert.equal(long.kind, "end");
assert.ok(long.at > 8800, "must not cut a long thought off during its 700 ms breaths");
assert.equal(run([[600, 3000]], 0.06).kind, "end"); // a noisy room still ends
assert.equal(run([]).kind, "no-speech"); // nothing said: gives up, never listens forever

// ---- speech finding: only speech reaches the model ---------------------------------------------------------
function tone(ms: number, amp: number) { const n = (16000 * ms) / 1000; const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(amp * 32767 * Math.sin(i * 0.31) * (0.6 + 0.4 * Math.sin(i * 0.002))), i * 2); return b; }
function hiss(ms: number, amp: number) { const n = (16000 * ms) / 1000; const b = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round((Math.random() - 0.5) * 2 * amp * 32767), i * 2); return b; }
const clip = Buffer.concat([hiss(2000, 0.004), tone(1500, 0.3), hiss(1500, 0.004), tone(1200, 0.3), hiss(2500, 0.004)]);
const found = analyzeSpeech(clip);
assert.equal(found.noSpeech, false);
assert.equal(found.segments.length, 2, "two stretches of speech");
assert.ok(found.trimmed.length / 32 < 5200, "silence trimmed: " + found.trimmed.length / 32);
assert.equal(analyzeSpeech(hiss(4000, 0.02)).noSpeech, true, "room noise alone is not speech");
assert.equal(analyzeSpeech(Buffer.alloc(64000)).noSpeech, true, "digital silence");

// ---- fast talkers are slowed a little, normal speech is left alone ---------------------------------------------
const slowed = timeStretch(tone(2000, 0.3), 0.8);
assert.ok(Math.abs(slowed.length / 32 - 2500) < 80, "tempo 0.8 makes 2 s into about 2.5 s: " + slowed.length / 32);
assert.equal(timeStretch(tone(500, 0.3), 1).length, tone(500, 0.3).length, "tempo 1 changes nothing");
assert.equal(pickTempo(4.8), 1);
assert.ok(pickTempo(10) < 0.8 + 1e-9 && pickTempo(10) >= 0.78);
assert.ok(estimateSpeechRate(Buffer.alloc(8000)) === 0, "no rate from silence");

// ---- the visible 'fixing' summary --------------------------------------------------------------------------
assert.match(summarizeFix("um hey wallace", "Hey Wallace."), /removed 1 filler/);
assert.equal(summarizeFix("Hello there.", "Hello there."), "no changes needed");
console.log("speech-endpoint-tests: all assertions passed");
