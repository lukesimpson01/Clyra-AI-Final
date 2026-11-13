/** STT bench: `npx tsx tools/stt-bench.mts <audio file> [reference text]`
 *  Decodes any audio ffmpeg can read to 16 kHz mono, runs Clyra's local engine and prints the text, the time taken
 *  and a word error rate when a reference is given. */
import { execFileSync } from "node:child_process";
import { stopSpeechEngine, transcribePcm } from "../backend/speech/whisper-engine";

const [file, ...ref] = process.argv.slice(2);
if (!file) { console.error("usage: stt-bench <audio> [reference text]"); process.exit(1); }
const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], { maxBuffer: 512 * 1024 * 1024 });
const seconds = pcm.length / 2 / 16000;
// the first decode includes loading the model; the second is what a user feels once dictation is warm
await transcribePcm(pcm, 16000, {});
const t0 = performance.now();
const out = await transcribePcm(pcm, 16000, {});
const ms = Math.round(performance.now() - t0);
console.log(JSON.stringify({ audioSeconds: +seconds.toFixed(2), engine: out.engine, ms, realtime: +(seconds / (ms / 1000)).toFixed(1), text: out.text }, null, 1));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
if (ref.length) {
  const a = words(ref.join(" ")), b = words(out.text);
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  console.log("WER", ((d[a.length][b.length] / a.length) * 100).toFixed(1) + "%");
}

stopSpeechEngine();
process.exit(0);
