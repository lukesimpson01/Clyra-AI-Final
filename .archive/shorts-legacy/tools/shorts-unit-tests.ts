// Unit tests for the Shorts system: schema migration, timing rules, project
// operations, undo history, FFmpeg argument builders, AI output validation,
// YouTube URL handling, atomic project storage, job progress and caption
// presets. Run with: npm run test:shorts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, realpathSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = mkdtempSync(path.join(os.tmpdir(), "shorts-tests-"));
process.env.CLYRA_DATA_ROOT = dataRoot;

const schema = await import("../lib/shorts/schema");
const templates = await import("../lib/shorts/templates");
const ops = await import("../lib/shorts/ops");
const history = await import("../src/shorts/history");
const render = await import("../lib/shorts/render");
const cut = await import("../lib/shorts/cut");
const ai = await import("../lib/shorts/ai");
const media = await import("../lib/shorts/media");
const store = await import("../lib/shorts/store");
const jobs = await import("../lib/shorts/jobs");
const presets = await import("../lib/shorts/caption-presets");
const library = await import("../lib/shorts/library");
const faketextTimeline = await import("../lib/shorts/faketext-timeline");
const faketextTts = await import("../lib/shorts/faketext-tts");
const { parseYoutubeUrl, translateYtDlpError } = media;

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

let counter = 0;
const nextId = () => `t${++counter}`;
type Project = import("../lib/shorts/schema").ShortsProject;
const project = (overrides: Partial<Project> = {}): Project => ({
  ...schema.emptyProject({ id: "p-test", kind: "fake-text", title: "Test", now: "2026-01-01T00:00:00.000Z" }),
  ...overrides,
});

// ---- Schema ------------------------------------------------------------

{
  assert.deepEqual(schema.outputSize("9:16", 1080), { width: 1080, height: 1920 });
  assert.deepEqual(schema.outputSize("16:9", 1080), { width: 1920, height: 1080 });
  assert.deepEqual(schema.outputSize("1:1", 720), { width: 720, height: 720 });
  assert.deepEqual(schema.outputSize("4:5", 1080), { width: 1080, height: 1350 });
  check(true, "output sizes follow the requested short side");
}

{
  assert.throws(() => schema.migrateProject({ schemaVersion: 99, id: "x", kind: "fake-text" }), /newer Shorts version/);
  check(true, "projects from a newer schema are refused, not guessed at");
}

{
  const migrated = schema.migrateProject({
    schemaVersion: 1,
    id: "p1",
    kind: "fake-text",
    items: [
      { id: "a", type: "message", startMs: 100, durationMs: 800, side: "left", sender: "A", text: "hi", typingMs: 900 },
      { id: "b", type: "script-injection", startMs: 0, durationMs: 10 },
    ],
    background: { type: "video", file: "../../etc/passwd", trimStartMs: 0, speed: 1 },
    captions: { enabled: true, style: { color: "not-a-colour", size: 9999 }, words: [{ text: "ok", startMs: 0, endMs: 300 }, { text: "bad", startMs: 500, endMs: 100 }] },
  });
  check(migrated.items.length === 1, "unknown timeline item types are dropped");
  check(migrated.background.type === "gradient", "a video background pointing outside the project is not trusted");
  check(migrated.captions.style.size <= 120 && migrated.captions.style.color === "#ffffff", "caption style values are clamped and invalid colours fall back");
  check(migrated.captions.words.length === 1, "words whose end precedes their start are removed");
}

{
  const normalised = schema.normaliseCaptionStyle({ color: "#00ff00", size: 500, animation: "explode", box: { enabled: true, opacity: 9 } });
  check(normalised.color === "#00ff00", "valid colours are kept");
  check(normalised.size === 120, "out-of-range sizes are clamped");
  check(normalised.animation === "none", "unknown animations fall back to none");
  check(normalised.box.opacity === 1, "box opacity is clamped to 1");
}

{
  check(schema.isLibraryAudioFile("My Song (2024).mp3"), "a plain library filename with spaces and punctuation is accepted");
  check(!schema.isLibraryAudioFile("../../etc/passwd.mp3"), "a path-traversal attempt is rejected");
  check(!schema.isLibraryAudioFile("track/with/slash.mp3"), "a filename with a path separator is rejected");
  check(!schema.isLibraryAudioFile("not-audio.txt"), "a non-audio extension is rejected");
  const migrated = schema.migrateProject({
    schemaVersion: 1,
    id: "p-audio",
    kind: "fake-text",
    audio: {
      music: { file: "../escape.mp3", volume: 99, startOffsetMs: -5, duckUnderSpeech: "yes", duckAmount: 5 },
      sfx: [{ id: "a", file: "pop.wav", atMs: -10, volume: 2 }, { id: "b", file: "bad path.mp4", atMs: 0, volume: 1 }],
    },
  });
  check(migrated.audio.music === null, "a music reference that escapes the library folder is dropped, not sanitised into something else");
  check(migrated.audio.sfx.length === 1 && migrated.audio.sfx[0].file === "pop.wav", "only the valid SFX cue survives; a non-audio file is dropped");
  check(migrated.audio.sfx[0].volume <= 1.5 && migrated.audio.sfx[0].atMs === 0, "SFX cue fields are clamped to sane ranges");
}

// ---- Timing rules ------------------------------------------------------

{
  const items = templates.buildFakeTextItems(
    [
      { sender: "A", side: "left", text: "Hey, are you coming tonight?" },
      { sender: "B", side: "right", text: "Yes" },
      { sender: "A", side: "left", text: "Great, see you at eight then." },
    ],
    "natural",
    nextId,
  );
  for (let index = 1; index < items.length; index += 1) {
    check(items[index].startMs > items[index - 1].startMs, "chat messages start in order");
    check(items[index].startMs - items[index - 1].startMs >= items[index].typingMs, "each bubble waits for its typing indicator");
  }
  check(items[1].typingMs < items[0].typingMs + 1000, "longer messages take longer to type");
}

{
  const slow = templates.paceMultiplier("slow");
  const fast = templates.paceMultiplier("fast");
  check(slow > 1 && fast < 1, "slow pace is longer than natural and fast is shorter");
  check(templates.paceMultiplier("custom", 9) === 2.5, "custom pace is clamped");
}

{
  const words = templates.estimateWordTimings("one two three four", 1000, 3000);
  check(words.length === 4 && words[0].startMs === 1000 && words.at(-1)!.endMs === 3000, "estimated word timings span the whole line");
  check(words.every((word, index) => index === 0 || word.startMs >= words[index - 1].endMs), "estimated word timings never overlap");
  const pages = templates.captionPages(
    [
      { text: "a", startMs: 0, endMs: 200 },
      { text: "b", startMs: 250, endMs: 400 },
      { text: "c", startMs: 2000, endMs: 2200 },
    ],
    4,
  );
  check(pages.length === 2, "captions break on a pause longer than the threshold");
}

{
  const rounds = templates.buildWouldRatherItems(
    [
      { question: "Q1", left: "A", right: "B", leftPercent: 55 },
      { question: "Q2", left: "C", right: "D", leftPercent: 40 },
    ],
    5,
    nextId,
  );
  check(rounds[1].startMs === rounds[0].startMs + rounds[0].durationMs, "would-you-rather rounds are back to back");
  check(rounds.every((round) => round.simulatedPercent === true), "generated splits are always marked simulated");
}

// ---- Operations --------------------------------------------------------

{
  let p = project();
  ({ project: p } = ops.addItem(p, "message") as unknown as { project: typeof p });
  const added = ops.addItem(p, "message");
  p = added.project;
  check(p.items.length === 2 && p.items[1].startMs >= p.items[0].startMs + p.items[0].durationMs, "new items append after the last item on their track");
}

{
  let p = project();
  const first = ops.addItem(p, "title");
  p = ops.updateItem(first.project, first.item.id, { durationMs: 2000 });
  const second = ops.addItem(p, "title");
  const removed = ops.deleteItems(second.project, [first.item.id], true);
  check(removed.items.length === 1 && removed.items[0].startMs === 0, "ripple delete closes the gap left by a removed item");
  const kept = ops.deleteItems(second.project, [first.item.id], false);
  check(kept.items[0].startMs === second.item.startMs, "delete without ripple leaves later items where they were");
}

{
  let p = project();
  const added = ops.addItem(p, "narration");
  p = ops.updateItem(added.project, added.item.id, { text: "one two three four five six", durationMs: 4000 });
  const split = ops.splitItem(p, added.item.id, added.item.startMs + 2000);
  check(split.splitId !== null, "narration can be split at the playhead");
  const pieces = split.project.items.filter((item) => item.type === "narration").map((item) => (item as { text: string }).text);
  check(pieces.join(" ") === "one two three four five six", "splitting narration keeps every word exactly once");
  const refused = ops.splitItem(p, added.item.id, added.item.startMs + 10);
  check(refused.splitId === null, "splits too close to an edge are refused");
  const message = ops.addItem(project(), "message");
  check(ops.splitItem(message.project, message.item.id, message.item.startMs + 300).splitId === null, "chat messages are not split");
}

{
  let p = project();
  const added = ops.addItem(p, "message");
  p = ops.applyPace(added.project, "slow");
  const item = p.items[0];
  check(item.durationMs > added.item.durationMs, "slow pace lengthens timed items");
  const back = ops.applyPace(p, "natural");
  check(Math.abs(back.items[0].durationMs - added.item.durationMs) <= 2, "switching pace back restores the original timing");
}

{
  check(ops.moveItem(project(), "missing", 0).items.length === 0, "moving an unknown item changes nothing");
  const added = ops.addItem(project(), "title");
  check(ops.moveItem(added.project, added.item.id, 1234).items[0].startMs === 1200, "moves snap to 100 ms");
}

{
  let p = project();
  p = ops.setMusic(p, { file: "song.mp3", volume: 0.7, startOffsetMs: 0, duckUnderSpeech: true, duckAmount: 0.6 });
  check(p.audio.music?.file === "song.mp3", "setMusic attaches a track by filename only, never a path");
  const added = ops.addSfxCue(p, "pop.wav", 1234);
  check(added.project.audio.sfx.length === 1 && added.project.audio.sfx[0].atMs === 1234, "a new SFX cue lands at the requested time");
  const second = ops.addSfxCue(added.project, "ding.wav", 500);
  check(second.project.audio.sfx[0].file === "ding.wav", "SFX cues stay ordered by time");
  const updated = ops.updateSfxCue(second.project, added.id, { volume: 0.4 });
  check(updated.audio.sfx.find((cue) => cue.id === added.id)?.volume === 0.4, "an SFX cue's volume can be adjusted in place");
  const removed = ops.removeSfxCue(updated, added.id);
  check(removed.audio.sfx.length === 1, "removing one SFX cue leaves the others");
  const cleared = ops.setMusic(p, null);
  check(cleared.audio.music === null, "music can be removed");
}

// ---- History -----------------------------------------------------------

{
  const a = project({ title: "A" });
  const b = { ...a, title: "B" };
  const c = { ...a, title: "C" };
  let h = history.commit(history.emptyHistory(), a, b, "rename");
  h = history.commit(h, b, c, "rename again");
  const back = history.undo(h);
  check(back.project?.title === "B", "undo restores the previous state");
  const forward = history.redo(back.history);
  check(forward.project?.title === "C", "redo restores the undone state");
  check(history.undo(history.undo(h).history).project?.title === "A", "undo can step back twice");
}

{
  const a = project({ title: "A" });
  let h = history.emptyHistory();
  let current = a;
  for (const value of ["A1", "A12", "A123"]) {
    const next = { ...current, title: value };
    h = history.commit(h, current, next, "typing", "title-key", 1000);
    current = next;
  }
  check(h.past.length === 1, "rapid edits to one control merge into one undo step");
  check(history.undo(h).project?.title === "A", "the merged step undoes back to the original");
}

// ---- Render and cut argument builders ---------------------------------

{
  const p = project({ items: [] });
  const plan = { ...render.planRender(p, 1080, 30), baseFile: null, narration: [], hasSourceAudio: false, loop: false, music: null, sfx: [] };
  const args = render.buildFfmpegArgs(plan, "/tmp/out.mp4", "balanced");
  check(args.includes("image2pipe") && args.includes("pipe:0"), "DOM frames are piped to FFmpeg");
  check(!args.includes("-stream_loop"), "DOM projects do not loop anything");
  check(args.at(-1) === "/tmp/out.mp4", "the output path is the final argument");
  check(args.includes("-t") && args.includes(String((plan.durationMs / 1000).toFixed(3))), "the output length matches the timeline");
  check(plan.frames === Math.round((plan.durationMs * 30) / 1000), "frame count follows the timeline at the chosen rate");
}

{
  const p = project({ background: { type: "video", file: "assets/source.mp4", trimStartMs: 1500, speed: 2, dim: 0.3, zoom: 1.2, offsetX: 10, offsetY: 0, blurPx: 4, muted: false } as never, durationMs: 8000 });
  const base = render.planRender(p, 720, 30);
  const plan = { ...base, baseFile: "/x/source.mp4", narration: [{ file: "/x/n1.wav", startMs: 500, speed: 1 }], hasSourceAudio: true, loop: true, music: null, sfx: [] };
  const args = render.buildFfmpegArgs(plan, "/tmp/v.mp4", "high");
  check(args.includes("-stream_loop") && args.includes("-1"), "short footage loops to fill the timeline");
  const filter = args[args.indexOf("-filter_complex") + 1];
  check(filter.includes("overlay=format=auto") && filter.includes("boxblur"), "video backgrounds are composited under transparent frames with blur");
  check(filter.includes("atempo=2.0000"), "double speed uses an atempo chain for audio");
  check(filter.includes("adelay=500|500"), "narration is placed at its timeline position");
  check(args.includes("-map") && args.includes("[aout]"), "narration and source audio are mixed into the output");
}

{
  // Music + SFX mixing: music ducks against the real voice signal via
  // sidechaincompress, never a flat volume toggle; SFX cues sit at their own timestamps.
  const p = project({ durationMs: 10_000 });
  const base = render.planRender(p, 1080, 30);
  const plan = {
    ...base,
    baseFile: null,
    hasSourceAudio: false,
    loop: false,
    narration: [{ file: "/x/n1.wav", startMs: 0, speed: 1 }],
    music: { file: "/x/song.mp3", startOffsetMs: 4000, volume: 0.7, duckUnderSpeech: true, duckAmount: 0.65 },
    sfx: [{ file: "/x/pop.wav", atMs: 2500, volume: 0.9 }],
  };
  const args = render.buildFfmpegArgs(plan, "/tmp/mix.mp4", "balanced");
  check(args.includes("/x/song.mp3") && args.includes("4.000"), "music is read starting from its chosen offset into the track, not always 0:00");
  const filter = args[args.indexOf("-filter_complex") + 1];
  check(filter.includes("sidechaincompress"), "music under narration uses real sidechain compression, not a flat volume cut");
  check(filter.includes("[musicraw][voice]sidechaincompress") || filter.includes("[musicraw][n"), "the voice signal (narration/source), not the music itself, controls the ducking");
  check(filter.includes("adelay=2500|2500"), "the SFX cue is placed at its own timestamp");
  check(filter.includes("amix=inputs=3"), "voice, ducked music and the SFX cue are all mixed into one output");

  const noDuck = render.buildFfmpegArgs({ ...plan, music: { ...plan.music!, duckUnderSpeech: false } }, "/tmp/mix2.mp4", "balanced");
  const noDuckFilter = noDuck[noDuck.indexOf("-filter_complex") + 1];
  check(!noDuckFilter.includes("sidechaincompress"), "turning ducking off plays music at a flat volume instead");

  const musicOnly = render.buildFfmpegArgs({ ...plan, narration: [], music: { ...plan.music!, duckUnderSpeech: true }, sfx: [] }, "/tmp/mix3.mp4", "balanced");
  const musicOnlyFilter = musicOnly[musicOnly.indexOf("-filter_complex") + 1];
  check(!musicOnlyFilter.includes("sidechaincompress"), "with no voice signal present, there is nothing to duck against, so music plays at a flat volume");
}

{
  const copy = cut.buildCutArgs({ source: "/a.mp4", inMs: 1000, outMs: 5000, crop: null, copyStreams: true, width: 1080, height: 1920, fps: 30, quality: "balanced" }, "/o.mp4");
  check(copy.includes("copy") && !copy.includes("-vf"), "stream copy skips re-encoding");
  const encoded = cut.buildCutArgs({ source: "/a.mp4", inMs: 0, outMs: 3000, crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, copyStreams: false, width: 1080, height: 1920, fps: 30, quality: "high" }, "/o.mp4");
  const filter = encoded[encoded.indexOf("-vf") + 1];
  check(filter.startsWith("crop=iw*0.5000:ih*1.0000:iw*0.2500:ih*0.0000") && filter.includes("scale=1080:1920"), "crops are applied before scaling to the output size");
}

// ---- AI output validation ---------------------------------------------

{
  const quiz = ai.validateScript({ kind: "quiz", prompt: "p", tone: "engaging", count: 2 }, {
    title: "Q",
    questions: [{ question: "Capital?", answers: ["Paris", "Rome"], correctIndex: 0, explanation: "France." }],
  });
  check(quiz.kind === "quiz" && quiz.questions[0].correctIndex === 0, "a well-formed quiz validates");
  assert.throws(
    () => ai.validateScript({ kind: "quiz", prompt: "p", tone: "engaging", count: 2 }, { title: "Q", questions: [{ question: "x", answers: ["a", "b"], correctIndex: 5, explanation: "" }] }),
    /correctIndex|explanation|out of range/,
  );
  check(true, "a quiz with an out-of-range correct answer is rejected");
  const wyr = ai.validateScript({ kind: "would-rather", prompt: "p", tone: "funny", count: 1 }, { title: "W", rounds: [{ question: "Q", left: "A", right: "B", leftPercent: 99 }] });
  check(wyr.kind === "would-rather" && wyr.rounds[0].leftPercent === 80, "simulated splits are clamped to a plausible range");
  const fake = ai.validateScript({ kind: "fake-text", prompt: "p", tone: "funny", count: 3 }, { title: "T", messages: [{ side: "weird", sender: "Ann", text: "hi" }, { side: "right", sender: "Ben", text: "yo" }] });
  check(fake.kind === "fake-text" && fake.messages[0].side === "left", "unknown message sides fall back to left");
}

// ---- Media: URLs and provider errors ----------------------------------

{
  check(parseYoutubeUrl("https://www.youtube.com/watch?v=Qtl8lJwbd4g").videoId === "Qtl8lJwbd4g", "watch links are recognised");
  check(parseYoutubeUrl("https://youtu.be/Qtl8lJwbd4g?t=10").videoId === "Qtl8lJwbd4g", "short links are recognised");
  check(parseYoutubeUrl("https://www.youtube.com/shorts/abcdef123456").videoId === "abcdef123456", "shorts links are recognised");
  assert.throws(() => parseYoutubeUrl("https://example.com/video"), /not a YouTube link/);
  assert.throws(() => parseYoutubeUrl("javascript:alert(1)"), /http/);
  check(true, "non-YouTube and non-http links are refused");
  check(/private/i.test(translateYtDlpError("ERROR: [youtube] x: Private video")), "private videos get a plain-language reason");
  check(/age-restricted/.test(translateYtDlpError("Sign in to confirm your age")), "age restriction is explained without raw output");
}

// ---- Store: atomic writes and path safety ------------------------------

{
  const p = project({ id: "p-store", title: "Store test" });
  store.writeProjectFile(p);
  const read = store.readProjectFile("p-store");
  check(read?.title === "Store test", "a saved project reads back");
  const leftovers = readdirSync(store.projectDir("p-store")).filter((name) => name.endsWith(".tmp"));
  check(leftovers.length === 0, "atomic saves leave no temporary files behind");
  check(store.resolveAssetFile("p-store", "../project.json") === null, "asset lookups cannot escape the project folder");
  check(store.resolveAssetFile("p-store", "assets/missing.mp4") === null, "missing assets resolve to nothing");
  const asset = path.join(store.projectDir("p-store"), "assets", "clip.mp4");
  writeFileSync(asset, "x");
  check(store.resolveAssetFile("p-store", "assets/clip.mp4") === realpathSync(asset), "a project asset resolves inside its folder");
  const stale = path.join(store.projectDir("p-store"), "temp");
  mkdirSync(stale, { recursive: true });
  const old = path.join(stale, "old.bin");
  writeFileSync(old, "x");
  const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  utimesSync(old, longAgo, longAgo);
  check(store.cleanStaleTemp() >= 1 && !existsSync(old), "stale temporary files are cleaned up");
  check(existsSync(asset), "cleanup never touches assets");
  check(store.listProjects().some((summary) => summary.id === "p-store"), "saved projects appear in the library");
  check(store.deleteProjectDir("p-store") === true, "deleting a project removes its folder");
}

// ---- Jobs: monotonic progress, never 100 early ------------------------

{
  const job = jobs.createJob({ kind: "render", projectId: null, stages: [{ id: "a", label: "A", weight: 40 }, { id: "b", label: "B", weight: 60 }] });
  jobs.enterStage(job, "a", "start");
  jobs.reportProgress(job, 5, 10);
  const mid = job.overall;
  jobs.reportProgress(job, 2, 10);
  check(job.overall >= mid, "progress never decreases");
  jobs.enterStage(job, "b", "next");
  jobs.reportProgress(job, 10, 10);
  check(job.overall < 100 && job.status === "running", "reaching the end of a stage does not report 100");
  jobs.complete(job, { ok: true });
  check(job.overall === 100 && job.status === "completed", "100 is reported only on completion");
}

// ---- Caption presets ---------------------------------------------------

{
  const ids = presets.CAPTION_PRESET_BUILTINS.map((preset) => preset.id);
  check(new Set(ids).size === ids.length && ids.length >= 16, "every built-in caption preset has a unique id, and there are at least sixteen");
  check(presets.CAPTION_PRESET_BUILTINS.every((preset) => preset.style.animation && preset.builtin), "built-in presets are complete and read-only");
  const merged = presets.mergePresets([{ id: "mine", name: "Mine", builtin: false, style: schema.defaultCaptionStyle("mine") }]);
  check(merged.some((preset) => preset.id === "mine") && merged.length === ids.length + 1, "user presets are added after the built-ins");
}

// ---- Music/SFX library folders -----------------------------------------

{
  const dir = library.ensureLibraryDir("music");
  check(existsSync(dir) && existsSync(path.join(dir, "README.txt")), "the music folder and its README are created on first use");
  const wav = path.join(dir, "Test Tone (unit test).wav");
  execFileSync(media.resolveTool("ffmpeg"), ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.3", wav], { stdio: "ignore" });
  const tracks = await library.scanLibrary("music");
  const found = tracks.find((track) => track.file === "Test Tone (unit test).wav");
  check(Boolean(found) && found!.durationMs > 0, "a file dropped into the folder is found and probed on the next scan, with no import step");
  check(library.resolveLibraryFile("music", "Test Tone (unit test).wav") === path.join(dir, "Test Tone (unit test).wav"), "a valid library filename resolves inside the folder");
  check(library.resolveLibraryFile("music", "../../../etc/passwd") === null, "a path-traversal filename never resolves");
  check(library.resolveLibraryFile("music", "does-not-exist.mp3") === null, "a filename not present in the folder resolves to nothing");
}

// ---- Caption overlap regression (Python engine) ------------------------

{
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("clipper_pipeline", "clipper-pipeline.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
words = [
  {"word": "one", "start": 10.0, "end": 10.8},
  {"word": "two", "start": 10.5, "end": 11.2},
  {"word": "two", "start": 10.5, "end": 11.0},
  {"word": "three", "start": 11.1, "end": 14.0},
  {"word": "after", "start": 40.0, "end": 41.0},
]
out = module.caption_words_relative(words, 10.0, 20.0)
print(json.dumps(out))
`;
  const output = execFileSync("python3", ["-c", script], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const relative = JSON.parse(output.trim().split("\n").at(-1)!) as Array<{ word: string; start: number; end: number }>;
  check(relative.length === 3, "words outside the clip are dropped and duplicate timings are merged");
  check(relative.every((word, index) => index === 0 || word.start >= relative[index - 1].end - 1e-9), "rolling caption overlaps are trimmed so words never overlap");
  check(relative.every((word) => word.end <= 10.0001 && word.end > word.start), "every word ends inside the clip with a positive duration");
}

// ---- Fake Text Story timeline engine ------------------------------------

{
  check(faketextTimeline.typingDurationMs("hi", "auto", 1000, 1) >= 500, "auto typing duration has a sane floor even for a tiny message");
  check(faketextTimeline.typingDurationMs("x".repeat(500), "auto", 1000, 1) <= 2200, "auto typing duration is capped so long messages do not stall the video");
  check(faketextTimeline.typingDurationMs("hi", "1", 1000, 1) === 1000, "the 1s fixed preset ignores message length");
  check(faketextTimeline.typingDurationMs("hi", "custom", 1700, 1) === 1700, "the custom preset uses the exact configured value");
  check(faketextTimeline.typingDurationMs("hi", "1", 1000, 2) === 2000, "pace scales typing duration the same as every other timing in the app");
}

const geometry: import("../lib/shorts/faketext-timeline").BubbleGeometry = { maxWidthFraction: 0.76, chatWidthPx: 1000, fontSizePx: 34, lineHeightPx: 44, paddingYPx: 20, gapPx: 14 };

{
  const short = faketextTimeline.estimateBubbleHeightPx("hi", geometry);
  const long = faketextTimeline.estimateBubbleHeightPx("a ".repeat(120), geometry);
  check(long > short, "a longer message wraps to more lines and so estimates a taller bubble");
  check(faketextTimeline.estimateBubbleLines("", geometry.chatWidthPx, geometry.fontSizePx) === 1, "an empty message still reserves one line");
}

{
  // Enough short messages to force more than MAX_SCREENS_PER_SEGMENT worth of
  // stacked height must split into multiple segments — this is the "message
  // list gets too long, clear and continue from the top" behaviour.
  const messages: import("../lib/shorts/faketext-timeline").FakeTextScriptMessage[] = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, side: i % 2 === 0 ? "left" : "right", sender: i % 2 === 0 ? "Contact" : "You", text: "A short message." }));
  const viewportHeightPx = 600;
  const segments = faketextTimeline.planFakeTextSegments(messages, geometry, viewportHeightPx);
  check(segments.length > 1, "a long enough conversation splits into more than one on-screen segment");
  check(segments[0].startIndex === 0 && segments.at(-1)!.endIndex === messages.length, "segments partition the whole message list with no gaps or overlaps");
  check(segments.every((segment) => segment.endIndex > segment.startIndex), "every segment contains at least one message");
}

{
  // A single short conversation that fits on one screen must not reset at all.
  const messages: import("../lib/shorts/faketext-timeline").FakeTextScriptMessage[] = [
    { id: "a", side: "left", sender: "Contact", text: "hello" },
    { id: "b", side: "right", sender: "You", text: "hey bro" },
    { id: "c", side: "right", sender: "You", text: "what is going on?" },
    { id: "d", side: "left", sender: "Contact", text: "nothing much" },
  ];
  const speech = new Map(messages.map((m) => [m.id, { ms: 1200, placeholder: false }]));
  const items = faketextTimeline.buildFakeTextTimeline(messages, speech, {
    typingEnabled: true,
    typingDuration: "auto",
    typingDurationCustomMs: 1000,
    paceMultiplier: 1,
    geometry,
    viewportHeightPx: 1200,
    bottomPaddingPx: 24,
  });
  check(items.length === 4, "every scripted message produces exactly one timeline item");
  check(items.every((item, i) => i === 0 || item.startMs >= items[i - 1].startMs + items[i - 1].durationMs), "messages never start before the previous one's full slot (bubble + speech + pause) has elapsed — no TTS overlap");
  check(items.every((item) => item.speechMs === 1200), "the real measured speech duration is carried onto each item untouched");
  check(items[0].startMs >= faketextTimeline.OPEN_DELAY_MS, "the first bubble waits for at least the chat's opening delay, not time zero");

  const frameBeforeFirst = faketextTimeline.resolveFakeTextFrame(items, 0, geometry, 1200, 24);
  check(frameBeforeFirst.visible.length === 0, "before the first bubble's start time, nothing is on screen yet");

  const firstStart = items[0].startMs;
  const frameAtFirst = faketextTimeline.resolveFakeTextFrame(items, firstStart + 10, geometry, 1200, 24);
  check(frameAtFirst.visible.length === 1 && frameAtFirst.visible[0].message.id === "a", "the first bubble becomes visible exactly at its own start time");

  if (items[0].typingMs > 0) {
    const typingFrame = faketextTimeline.resolveFakeTextFrame(items, firstStart - 10, geometry, 1200, 24);
    check(typingFrame.typing?.side === "left", "the typing indicator shows for the correct side just before its bubble appears");
  }

  const lastStart = items.at(-1)!.startMs;
  const frameNearEnd = faketextTimeline.resolveFakeTextFrame(items, lastStart + 10, geometry, 1200, 24);
  check(frameNearEnd.visible.length === 4, "once the final message has started, every message in this one-screen segment stays visible together");
}

{
  // Long messages in a small viewport must force a reset partway through, and
  // the reset must be a hard cut (old segment's messages are gone), not an
  // ever-growing scroll.
  const messages: import("../lib/shorts/faketext-timeline").FakeTextScriptMessage[] = Array.from({ length: 10 }, (_, i) => ({
    id: `m${i}`,
    side: i % 2 === 0 ? "left" : "right",
    sender: i % 2 === 0 ? "Contact" : "You",
    text: "This is a longer message that takes up real vertical space in the chat stack.",
  }));
  const speech = new Map(messages.map((m) => [m.id, { ms: 500, placeholder: false }]));
  const smallGeometry = { ...geometry, chatWidthPx: 500 };
  const items = faketextTimeline.buildFakeTextTimeline(messages, speech, {
    typingEnabled: false,
    typingDuration: "auto",
    typingDurationCustomMs: 1000,
    paceMultiplier: 1,
    geometry: smallGeometry,
    viewportHeightPx: 300,
    bottomPaddingPx: 10,
  });
  const segments = faketextTimeline.planFakeTextSegments(messages, smallGeometry, 300);
  check(segments.length > 1, "a small viewport with long messages forces at least one reset");
  const secondSegmentFirstItem = items[segments[1].startIndex];
  const firstSegmentLastItem = items[segments[0].endIndex - 1];
  check(secondSegmentFirstItem.startMs > firstSegmentLastItem.startMs + firstSegmentLastItem.durationMs, "the new screen's first message starts only after the previous screen's last message fully finishes, with a reset gap in between");

  const frameInSecondSegment = faketextTimeline.resolveFakeTextFrame(items, secondSegmentFirstItem.startMs + 5, smallGeometry, 300, 10);
  check(frameInSecondSegment.visible.length === 1 && frameInSecondSegment.visible[0].message.id === secondSegmentFirstItem.id, "after a reset, only the new screen's own messages are visible — the previous screen's messages are fully cleared, not just scrolled further");
}

{
  // The on-disk speech cache must key on (voice, text) only, so a speed-only
  // edit never forces a wasted re-synthesis of unchanged dialogue.
  const projectId = "faketext-cache-test";
  let calls = 0;
  const fakeFetch = async (text: string, voice: string) => {
    calls += 1;
    return { bytes: Buffer.from("RIFF0000WAVEfmt "), durationMs: 1234, engine: "fish:test" };
  };
  const first = await faketextTts.synthesizeMessageSpeech(projectId, "Max", "hello there", fakeFetch);
  const second = await faketextTts.synthesizeMessageSpeech(projectId, "Max", "hello there", fakeFetch);
  check(calls === 1, "a second request for the exact same (voice, text) reuses the on-disk cache instead of re-fetching");
  check(first.durationMs === 1234 && second.durationMs === 1234, "the cached duration survives a cache hit unchanged");
  const cached = faketextTts.readCachedMessageSpeech(projectId, "Max", "hello there");
  check(cached !== null && cached.engine === "fish:test", "a cached recording can be looked up directly without calling synthesize");
}

{
  // atempo is applied per narration clip so Fake Text Story's per-voice speed
  // slider actually changes export audio, not just the on-screen timeline.
  const p = project({ durationMs: 6000 });
  const base = render.planRender(p, 1080, 30);
  const plan = { ...base, baseFile: null, hasSourceAudio: false, loop: false, music: null, sfx: [], narration: [{ file: "/x/fast.wav", startMs: 220, speed: 1.3 }] };
  const args = render.buildFfmpegArgs(plan, "/tmp/speed.mp4", "balanced");
  const filter = args[args.indexOf("-filter_complex") + 1];
  check(filter.includes("atempo=1.3000"), "a sped-up message voice gets its own atempo stage in the mix");
  const normalPlan = { ...plan, narration: [{ file: "/x/normal.wav", startMs: 220, speed: 1 }] };
  const normalArgs = render.buildFfmpegArgs(normalPlan, "/tmp/speed2.mp4", "balanced");
  const normalFilter = normalArgs[normalArgs.indexOf("-filter_complex") + 1];
  check(!normalFilter.includes("atempo"), "normal-speed voice clips skip the atempo stage entirely rather than a meaningless atempo=1.0000");
}

console.log(`shorts unit tests passed (${assertions} assertions)`);
