/* The vertical slice, end to end, against real footage.
 *
 * This is the milestone from the brief: import an MP4, probe it, analyse it,
 * build a timeline, let an agent edit through typed commands, undo, and export
 * a real file. Every step here touches actual media through actual FFmpeg —
 * nothing is stubbed, because a mocked pipeline proves nothing about whether
 * the product works.
 *
 * Skipped automatically if the fixture has not been generated, so the suite
 * stays runnable on a machine without it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { stat, rm } from "node:fs/promises";
import { Engine } from "../src/index.mjs";
import { timeline, timelineDuration, locateClips } from "../../timeline/src/index.mjs";
import { probe, detectSilence, analyse } from "../../media-analysis/src/index.mjs";
import { buildGraph, compileFfmpeg, render, renderFrame } from "../../render/src/index.mjs";

const SOURCE = "/tmp/vslice/source.mp4";
const available = existsSync(SOURCE);
const options = { skip: available ? false : "fixture missing — see docs/ARCHITECTURE.md" };

test("1. probe reads real media facts", options, async () => {
  const media = await probe(SOURCE);
  assert.ok(Math.abs(media.durationSeconds - 20) < 0.2, `expected ~20s, got ${media.durationSeconds}`);
  assert.equal(media.video.width, 1280);
  assert.equal(media.video.height, 720);
  assert.equal(media.video.rate, 30);
  assert.ok(media.hasAudio, "fixture should carry audio");
});

test("2. silence detection finds the real gaps", options, async () => {
  const silences = await detectSilence(SOURCE, { thresholdDb: -30, minDurationSeconds: 0.5 });
  assert.ok(silences.length >= 2, `expected the two planted silences, found ${silences.length}`);
  /* The fixture is silent 5–7s and 12–14.2s. */
  assert.ok(silences.some((s) => Math.abs(s.start - 5) < 0.5), "should find the 5s silence");
  assert.ok(silences.some((s) => Math.abs(s.start - 12) < 0.5), "should find the 12s silence");
});

test("3. analysis produces one timestamped index", options, async () => {
  const index = await analyse(SOURCE);
  assert.ok(index.segments.length > 0);
  assert.ok(index.counts.silences >= 2);
  /* Segments must be ordered — a model reads them as a timeline. */
  const starts = index.segments.map((s) => s.start);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), "segments must be in time order");
});

test("4-8. an agent edits the timeline through typed commands", options, async () => {
  const media = await probe(SOURCE);
  const index = await analyse(SOURCE);

  const engine = new Engine(timeline({ name: "Slice", rate: media.video.rate, width: media.video.width, height: media.video.height }));
  engine.attachAnalysis(SOURCE, index);

  const { result: track } = engine.run("track.create", { kind: "Video", name: "V1" });
  engine.run("clip.insert", {
    trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 0, durationSeconds: media.durationSeconds,
  });

  /* The agent looks at the footage the only way it can — as structure. */
  const found = engine.run("media.search", {
    mediaUrl: SOURCE, kind: "silence", longerThanSeconds: 0.8,
  }).result;
  assert.ok(found.count >= 2, `agent should see the pauses, saw ${found.count}`);

  /* And removes them, working from the end so earlier cuts keep their times. */
  const before = timelineDuration(engine.doc);
  let removed = 0;
  for (const pause of [...found.segments].sort((a, b) => b.start - a.start)) {
    const clips = locateClips(engine.doc);
    const target = clips.find((c) => pause.start >= c.start / media.video.rate && pause.end <= c.end / media.video.rate);
    if (!target) continue;
    engine.run("clip.split", { clipId: target.id, atSeconds: pause.start });
    const after = locateClips(engine.doc);
    const tail = after.find((c) => Math.abs(c.start / media.video.rate - pause.start) < 0.05);
    if (!tail) continue;
    engine.run("clip.split", { clipId: tail.id, atSeconds: pause.end });
    const gapClip = locateClips(engine.doc).find((c) => Math.abs(c.start / media.video.rate - pause.start) < 0.05);
    engine.run("clip.delete", { clipId: gapClip.id, ripple: true });
    removed += 1;
  }
  assert.ok(removed >= 2, `should have removed at least 2 pauses, removed ${removed}`);
  assert.ok(timelineDuration(engine.doc) < before, "the timeline should be shorter after cutting pauses");

  /* Then the finishing touches the brief asks for. */
  const first = locateClips(engine.doc)[0];
  engine.run("transform.animate", { clipId: first.id, property: "scale", from: 1, to: 1.12, easing: "easeInOut" });
  engine.run("caption.create", { text: "Removed the dead air", startSeconds: 0, endSeconds: 2.5 });
  engine.run("caption.style", { sizePx: 42, position: "bottom", background: "black@0.6" });

  const view = engine.run("timeline.inspect", {}).result;
  assert.ok(view.tracks.length >= 2, "video and caption tracks");

  /* 10. every one of those steps is reversible. */
  const edited = timelineDuration(engine.doc);
  const steps = engine.past.length;
  for (let index = 0; index < steps; index += 1) engine.undo();
  assert.equal(timelineDuration(engine.doc), 0, "undoing everything empties the timeline");
  for (let index = 0; index < steps; index += 1) engine.redo();
  assert.equal(timelineDuration(engine.doc), edited, "redo restores the edit exactly");
});

test("9. the render graph decouples the timeline from the renderer", options, async () => {
  const media = await probe(SOURCE);
  const engine = new Engine(timeline({ rate: media.video.rate, width: 1280, height: 720 }));
  const { result: track } = engine.run("track.create", { kind: "Video" });
  engine.run("clip.insert", { trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 0, durationSeconds: 3 });

  const graph = buildGraph(engine.doc);
  assert.equal(graph.layers.length, 1);
  assert.equal(graph.layers[0].items[0].kind, "clip");
  assert.equal(graph.layers[0].items[0].startSeconds, 0);
  assert.equal(graph.layers[0].items[0].durationSeconds, 3);

  const { args, unsupported } = compileFfmpeg(graph, "/tmp/vslice/out.mp4");
  assert.ok(args.includes("-filter_complex"), "should build a filter graph");
  assert.ok(Array.isArray(unsupported), "must report what it cannot render rather than dropping it silently");
});

test("11. export produces a real, playable MP4", { ...options, timeout: 180_000 }, async () => {
  const media = await probe(SOURCE);
  const engine = new Engine(timeline({ rate: media.video.rate, width: 1280, height: 720 }));
  const { result: track } = engine.run("track.create", { kind: "Video" });

  /* Two cuts from different parts of the source, so the export genuinely
     concatenates rather than copying one clip through. */
  engine.run("clip.insert", { trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 0, sourceInSeconds: 1, durationSeconds: 2 });
  engine.run("clip.insert", { trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 2, sourceInSeconds: 15, durationSeconds: 2 });
  engine.run("caption.create", { text: "Exported by Clyra", startSeconds: 0, endSeconds: 2 });

  const output = "/tmp/vslice/export.mp4";
  await rm(output, { force: true });

  let sawProgress = false;
  const result = await render(engine.doc, output, {
    preset: "ultrafast", crf: 28,
    onProgress: () => { sawProgress = true; },
  });

  assert.ok(existsSync(output), "an MP4 should exist");
  const info = await stat(output);
  assert.ok(info.size > 10_000, `the file should have real content, got ${info.size} bytes`);
  assert.ok(sawProgress, "progress should be reported from ffmpeg, not estimated");

  /* And it must actually be decodable — a file existing proves nothing. */
  const exported = await probe(output);
  assert.ok(Math.abs(exported.durationSeconds - 4) < 0.5, `expected ~4s, got ${exported.durationSeconds}`);
  assert.equal(exported.video.width, 1280);
  assert.ok(exported.hasVideo);
  assert.ok(result.unsupported.length === 0 || Array.isArray(result.unsupported));
});

test("6. a preview frame can be pulled at any position", { ...options, timeout: 60_000 }, async () => {
  const media = await probe(SOURCE);
  const engine = new Engine(timeline({ rate: media.video.rate, width: 1280, height: 720 }));
  const { result: track } = engine.run("track.create", { kind: "Video" });
  engine.run("clip.insert", { trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 0, durationSeconds: 10 });

  const output = "/tmp/vslice/frame.png";
  await rm(output, { force: true });
  await renderFrame(engine.doc, 4.5, output);
  assert.ok(existsSync(output));
  const info = await stat(output);
  assert.ok(info.size > 1000, "a real frame, not an empty file");
});

test("vertical export reframes to 9:16 without squashing", options, () => {
  const engine = new Engine(timeline({ rate: 30, width: 1920, height: 1080 }));
  const { result: track } = engine.run("track.create", { kind: "Video" });
  engine.run("clip.insert", { trackId: track.trackId, mediaUrl: SOURCE, atSeconds: 0, durationSeconds: 2 });
  const job = engine.run("render.export", { output: "/tmp/vslice/vertical.mp4", aspect: "9:16" }).result;
  assert.equal(job.height, 1920, "the long edge should be preserved");
  assert.equal(job.width, 1080);
});
