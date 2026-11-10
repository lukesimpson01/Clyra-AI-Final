/**
 * Clyra Flow end-of-speech tests. Everything runs on synthetic audio in audio time, so the results are exact
 * and repeatable: a "voice" is a 140 Hz harmonic tone with syllable-rate loudness, a "room" is white noise.
 */
import assert from "node:assert/strict";
import { EndpointDetector, requiredSilenceMs, utteranceHint } from "../electron/flow-endpoint.mjs";
import { FlowSession, joinPhrases } from "../electron/flow-session.mjs";

const RATE = 16_000;
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
/** @returns {Float32Array} */
const room = (ms, db = -55) => { const out = new Float32Array(Math.round((RATE * ms) / 1000)); const a = 10 ** (db / 20) * Math.sqrt(3); for (let i = 0; i < out.length; i += 1) out[i] = rnd() * a; return out; };
function voice(ms, db = -22) {
  const out = room(ms);
  const peak = 10 ** (db / 20);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.5 * t);
    out[i] += peak * syllable * (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.25 * Math.sin(2 * Math.PI * 420 * t)) / 1.75;
  }
  return out;
}
function click(ms = 30) { const out = room(ms); for (let i = 0; i < out.length; i += 1) out[i] += 0.6 * Math.exp(-i / 40) * (i % 2 ? 1 : -1); return out; }
function pcm(...parts) {
  const length = parts.reduce((n, part) => n + part.length, 0);
  const out = new Int16Array(length);
  let o = 0;
  for (const part of parts) for (let i = 0; i < part.length; i += 1) out[o++] = Math.max(-32768, Math.min(32767, Math.round(part[i] * 32767)));
  return Buffer.from(out.buffer);
}

/** Stream a recording through a session in 60 ms chunks, like the capture window does. */
async function run(audio, { transcribe = async () => "", autoStop = true, pace = "balanced" } = {}) {
  let store = Buffer.alloc(0);
  let ended = null;
  const live = [];
  const meters = [];
  const session = new FlowSession({
    audio: (start, end = store.length) => Buffer.from(store.subarray(start - (start % 2), Math.min(store.length, end))),
    transcribe, autoStop, pace,
    onLive: (text) => live.push(text),
    onMeter: (meter) => meters.push(meter),
    onEnd: (reason) => { ended = reason; },
  });
  const step = 960 * 2;
  for (let o = 0; o < audio.length && !ended; o += step) {
    const chunk = audio.subarray(o, Math.min(audio.length, o + step));
    store = Buffer.concat([store, chunk]);
    session.feed(chunk);
    await new Promise((resolve) => setImmediate(resolve));   // let decodes resolve between chunks, as in real time
  }
  return { session, ended, live, meters, text: ended === "no-speech" ? "" : await session.finish(store.length), seconds: session.timeMs / 1000 };
}

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (a, b, message) => { assert.equal(a, b, message); checks += 1; };

// --- a short phrase then silence: the session ends by itself about a second after the last word
{
  const r = await run(pcm(room(800), voice(1_000), room(4_000)), { transcribe: async () => "Hi, how are you?" });
  eq(r.ended, "silence");
  ok(r.seconds > 2.6 && r.seconds < 3.2, `short phrase should end ~1.1 s after speech, ended at ${r.seconds.toFixed(2)} s`);
  eq(r.text, "Hi, how are you?");
  eq(r.session.stats.speculativeHits, 1, "the final text was already decoded during the pause");
  eq(r.session.stats.decodes <= 3, true, "a short phrase must not be decoded over and over");
  ok(r.meters.some((m) => m.ending > 0.5) && r.meters.some((m) => m.level > 0.3), "countdown and level are reported");
}
// --- silence only, or a key tap: never "speech", and the microphone is released
for (const audio of [pcm(room(9_000, -48)), pcm(room(300), click(), room(9_000))]) {
  const r = await run(audio, { transcribe: async () => "should never be called" });
  eq(r.ended, "no-speech");
  eq(r.session.stats.decodes, 0);
}
// --- mumbling: a voice only ~8 dB above the room is still speech (it is periodic), and still ends the session
{
  const r = await run(pcm(room(600, -50), voice(1_400, -39), room(4_000, -50)), { transcribe: async () => "okay" });
  eq(r.ended, "silence", "quiet voiced speech must be detected");
  eq(r.text, "okay");
}
// --- a loud room does not hold the session open
{
  const r = await run(pcm(room(700, -36), voice(1_200, -14), room(4_000, -36)), { transcribe: async () => "Done." });
  eq(r.ended, "silence");
  ok(r.seconds < 3.6, `noisy room ended at ${r.seconds.toFixed(2)} s`);
}
// --- fast talker: 150 ms gaps are never an ending, and the final silence needed stays short
{
  const parts = [room(400)];
  for (let i = 0; i < 6; i += 1) parts.push(voice(700), room(150));
  parts.push(room(4_000));
  const r = await run(pcm(...parts), { transcribe: async () => "one two three four five six." });
  eq(r.ended, "silence");
  ok(r.seconds > 5.4 && r.seconds < 7, `fast talker ended at ${r.seconds.toFixed(2)} s`);
  ok(r.session.stats.requiredMs <= 1_300, `fast talker needed ${r.session.stats.requiredMs} ms`);
}
// --- someone who pauses to think is not cut off at their usual pause
{
  const r = await run(pcm(room(400), voice(1_500), room(1_000), voice(1_500), room(1_050), voice(1_500), room(1_100), voice(1_500), room(6_000)), { transcribe: async () => "First thought, second thought, third thought, and a fourth." });
  eq(r.ended, "silence");
  ok(r.seconds > 10.6, `a 1.1 s thinking pause must not end the session (ended at ${r.seconds.toFixed(2)} s)`);
  ok(r.session.detector.pauses.length === 3, "pauses the speaker resumed from are remembered");
}
// --- mid-thought ("...and then the") waits longer than a finished sentence
{
  const audio = pcm(room(400), voice(2_500), room(6_000));
  const open = await run(audio, { transcribe: async () => "I was going to the shop and then the" });
  const done = await run(audio, { transcribe: async () => "I was going to the shop." });
  ok(open.seconds - done.seconds > 0.5, `open ${open.seconds.toFixed(2)} s vs complete ${done.seconds.toFixed(2)} s`);
}
// --- manual sessions never end on their own
{
  const r = await run(pcm(room(400), voice(1_000), room(5_000)), { transcribe: async () => "hello", autoStop: false });
  eq(r.ended, null);
  eq(r.text, "hello");
}
// --- long dictation is cut into blocks only at pauses, in order, and nothing is decoded twice at the end
{
  const parts = [room(300)];
  for (let i = 0; i < 9; i += 1) parts.push(voice(3_200), room(420));
  parts.push(room(5_000));
  let n = 0;
  const r = await run(pcm(...parts), { transcribe: async (audio) => `[${Math.round(audio.length / 32_000)}s#${++n}]` });
  eq(r.ended, "silence");
  ok(r.session.blocks.length >= 2, "a 30 s dictation is split into blocks");
  ok(r.text.split(" ").length === r.session.blocks.length + (r.session.blockHasSpeech ? 1 : 0), `one piece per block: ${r.text}`);
  ok(r.live.every((text, i) => i === 0 || !r.live[i - 1].startsWith(text) || r.live[i - 1] === text), "live text never shrinks back to a prefix");
}
// --- policy units
eq(utteranceHint("How are you?"), "complete");
eq(utteranceHint("so then I went to the"), "open");
eq(utteranceHint("and then,"), "open");
eq(utteranceHint("we went with."), "open", "a full stop after a connecting word is the model closing a cut-off clip");
eq(utteranceHint(""), "unknown");
ok(requiredSilenceMs({ speechMs: 900, hint: "complete" }) <= 1_100);
ok(requiredSilenceMs({ speechMs: 5_000, pauses: [200, 180, 220, 210] }) < requiredSilenceMs({ speechMs: 5_000, pauses: [900, 1_000, 950] }));
ok(requiredSilenceMs({ speechMs: 5_000, pace: "patient" }) > requiredSilenceMs({ speechMs: 5_000 }));
ok(requiredSilenceMs({ speechMs: 5_000, pace: "fast" }) < requiredSilenceMs({ speechMs: 5_000 }));
eq(joinPhrases(["lunch with.", "Priya tomorrow."]), "lunch with Priya tomorrow.");
// --- the detector is cheap: a minute of audio analyses in well under a second
{
  const minute = pcm(voice(60_000));
  const detector = new EndpointDetector();
  const started = process.hrtime.bigint();
  detector.feed(new Int16Array(minute.buffer, minute.byteOffset, minute.length / 2));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  ok(ms < 1_500, `60 s of audio analysed in ${ms.toFixed(0)} ms`);
  console.log(`flow-endpoint-tests: voice detection costs ${(ms / 600).toFixed(2)}% of one core`);
}
console.log(`flow-endpoint-tests: ${checks} checks passed`);
