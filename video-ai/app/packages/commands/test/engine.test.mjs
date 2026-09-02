/* The command engine's contract, tested.
 *
 * These are the guarantees the rest of the product is built on: every command
 * validates, every mutation is reversible, and a failure changes nothing. If
 * these hold, letting a model drive the timeline is safe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Engine, CommandError, COMMANDS } from "../src/index.mjs";
import { timeline, timelineDuration, locateClips, projectRate } from "../../timeline/src/index.mjs";

const project = () => new Engine(timeline({ name: "Test", rate: 30 }));

const withVideoTrack = () => {
  const engine = project();
  const { result } = engine.run("track.create", { kind: "Video", name: "V1" });
  return { engine, trackId: result.trackId };
};

const withClip = (durationSeconds = 10) => {
  const { engine, trackId } = withVideoTrack();
  const { result } = engine.run("clip.insert", {
    trackId, mediaUrl: "/media/a.mp4", atSeconds: 0, durationSeconds,
  });
  return { engine, trackId, clipId: result.clipId };
};

/* ------------------------------------------------------------ schemas */

test("every command declares a schema and a summary", () => {
  for (const [name, command] of Object.entries(COMMANDS)) {
    assert.ok(command.summary?.length > 10, `${name} needs a real summary`);
    assert.equal(command.input.type, "object", `${name} input must be an object schema`);
    assert.ok(Array.isArray(command.input.required), `${name} must declare required fields`);
  }
});

test("the tool surface is describable for a model", () => {
  const tools = Engine.describe();
  assert.ok(tools.length >= 20, `expected a real command surface, got ${tools.length}`);
  for (const tool of tools) {
    assert.ok(tool.name && tool.description && tool.inputSchema);
  }
  assert.ok(tools.some((t) => t.readOnly), "inspection commands must be marked read-only");
});

/* --------------------------------------------------------- validation */

test("unknown commands are rejected", () => {
  assert.throws(() => project().run("clip.teleport", {}), /Unknown command/);
});

test("missing required input is rejected", () => {
  assert.throws(() => project().run("track.create", {}), /kind is required/);
});

test("wrong types are rejected", () => {
  assert.throws(() => project().run("track.create", { kind: 7 }), CommandError);
});

test("enum values are enforced", () => {
  assert.throws(() => project().run("track.create", { kind: "Hologram" }), /must be one of/);
});

test("unrecognised fields are rejected rather than silently ignored", () => {
  assert.throws(
    () => project().run("track.create", { kind: "Video", colour: "red" }),
    /not a recognised field/,
  );
});

/* ------------------------------------------------------------- tracks */

test("tracks can be created and removed", () => {
  const engine = project();
  const { result } = engine.run("track.create", { kind: "Video" });
  assert.equal(engine.run("project.inspect", {}).result.trackCount, 1);
  engine.run("track.delete", { trackId: result.trackId });
  assert.equal(engine.run("project.inspect", {}).result.trackCount, 0);
});

test("deleting a track that does not exist is a structured error", () => {
  try {
    project().run("track.delete", { trackId: "nope" });
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "not_found");
  }
});

/* -------------------------------------------------------------- clips */

test("a clip lands where it was asked to", () => {
  const { engine, trackId } = withVideoTrack();
  const { result } = engine.run("clip.insert", {
    trackId, mediaUrl: "/media/a.mp4", atSeconds: 2, durationSeconds: 5,
  });
  assert.equal(result.startSeconds, 2);
  assert.equal(result.durationSeconds, 5);
});

test("seconds convert to frames without drift over many edits", () => {
  const { engine, trackId } = withVideoTrack();
  for (let index = 0; index < 50; index += 1) {
    engine.run("clip.insert", {
      trackId, mediaUrl: `/m/${index}.mp4`, atSeconds: index * 2, durationSeconds: 2,
    });
  }
  const rate = projectRate(engine.doc);
  assert.equal(timelineDuration(engine.doc), 100 * rate, "50 × 2s at 30fps must be exactly 3000 frames");
});

test("splitting produces two clips that tile the original", () => {
  const { engine, clipId } = withClip(10);
  const { result } = engine.run("clip.split", { clipId, atSeconds: 4 });
  assert.equal(result.left.durationSeconds, 4);
  assert.equal(result.right.durationSeconds, 6);
  assert.equal(result.left.durationSeconds + result.right.durationSeconds, 10);
});

test("a split outside the clip is refused", () => {
  const { engine, clipId } = withClip(10);
  try {
    engine.run("clip.split", { clipId, atSeconds: 25 });
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "out_of_range");
  }
});

test("a refused command leaves the timeline untouched", () => {
  const { engine, clipId } = withClip(10);
  const before = JSON.stringify(engine.doc);
  assert.throws(() => engine.run("clip.split", { clipId, atSeconds: 99 }));
  assert.equal(JSON.stringify(engine.doc), before, "a failed command must not mutate");
});

test("ripple delete closes the gap; plain delete leaves it", () => {
  const { engine, trackId } = withVideoTrack();
  const a = engine.run("clip.insert", { trackId, mediaUrl: "/a.mp4", atSeconds: 0, durationSeconds: 5 }).result;
  engine.run("clip.insert", { trackId, mediaUrl: "/b.mp4", atSeconds: 5, durationSeconds: 5 });
  assert.equal(timelineDuration(engine.doc), 10 * 30);

  engine.run("clip.delete", { clipId: a.clipId, ripple: true });
  assert.equal(timelineDuration(engine.doc), 5 * 30, "ripple should pull the later clip earlier");

  const remaining = locateClips(engine.doc)[0];
  assert.equal(remaining.start, 0);
});

test("moving a clip changes its position", () => {
  const { engine, clipId } = withClip(4);
  const { result } = engine.run("clip.move", { clipId, toSeconds: 10 });
  assert.equal(result.startSeconds, 10);
});

test("a locked track refuses edits", () => {
  const { engine, trackId, clipId } = withClip(5);
  engine.doc.tracks.children[0].metadata.clyra.locked = true;
  try {
    engine.run("clip.delete", { clipId });
    assert.fail("should have thrown");
  } catch (error) {
    assert.equal(error.code, "locked");
  }
});

test("speed changes timeline duration but keeps the source", () => {
  const { engine, clipId } = withClip(10);
  const { result } = engine.run("clip.speed", { clipId, speed: 2 });
  assert.equal(result.durationSeconds, 5, "double speed halves the time it occupies");
});

/* -------------------------------------------------------- transforms */

test("a punch-in zoom is two keyframes", () => {
  const { engine, clipId } = withClip(6);
  const { result } = engine.run("transform.animate", {
    clipId, property: "scale", from: 1, to: 1.15, easing: "easeInOut",
  });
  assert.equal(result.keyframes, 2);
});

/* ----------------------------------------------------------- captions */

test("captions create their own track once and reuse it", () => {
  const engine = project();
  engine.run("caption.create", { text: "First", startSeconds: 0, endSeconds: 2 });
  engine.run("caption.create", { text: "Second", startSeconds: 2, endSeconds: 4 });
  const captionTracks = engine.doc.tracks.children.filter((t) => t.metadata.clyra.role === "captions");
  assert.equal(captionTracks.length, 1, "should not create a second caption track");
  assert.equal(captionTracks[0].children.filter((c) => c.metadata?.clyra?.kind === "caption").length, 2);
});

test("a caption ending before it starts is refused", () => {
  assert.throws(
    () => project().run("caption.create", { text: "x", startSeconds: 5, endSeconds: 2 }),
    /endSeconds must be after/,
  );
});

/* -------------------------------------------------------------- audio */

test("gain in decibels converts to a linear multiplier", () => {
  const { engine, clipId } = withClip(5);
  const { result } = engine.run("audio.gain", { clipId, db: -6 });
  assert.ok(Math.abs(result.gain - 0.501) < 0.01, `-6dB should be ~0.5, got ${result.gain}`);
});

/* --------------------------------------------------------- undo/redo */

test("every mutation is undoable", () => {
  const { engine, trackId } = withVideoTrack();
  engine.run("clip.insert", { trackId, mediaUrl: "/a.mp4", atSeconds: 0, durationSeconds: 5 });
  assert.equal(locateClips(engine.doc).length, 1);
  engine.undo();
  assert.equal(locateClips(engine.doc).length, 0);
  engine.redo();
  assert.equal(locateClips(engine.doc).length, 1);
});

test("undo walks back through a whole sequence", () => {
  const { engine, trackId } = withVideoTrack();
  for (let index = 0; index < 5; index += 1) {
    engine.run("clip.insert", { trackId, mediaUrl: `/${index}.mp4`, atSeconds: index, durationSeconds: 1 });
  }
  assert.equal(locateClips(engine.doc).length, 5);
  for (let index = 0; index < 5; index += 1) engine.undo();
  assert.equal(locateClips(engine.doc).length, 0);
});

test("read-only commands do not enter the undo stack", () => {
  const { engine } = withClip(5);
  const depth = engine.past.length;
  engine.run("timeline.inspect", {});
  engine.run("project.inspect", {});
  assert.equal(engine.past.length, depth, "inspection must not be undoable");
});

test("a new edit clears the redo stack", () => {
  const { engine, trackId } = withVideoTrack();
  engine.run("clip.insert", { trackId, mediaUrl: "/a.mp4", atSeconds: 0, durationSeconds: 2 });
  engine.undo();
  assert.equal(engine.canRedo, true);
  engine.run("clip.insert", { trackId, mediaUrl: "/b.mp4", atSeconds: 0, durationSeconds: 2 });
  assert.equal(engine.canRedo, false);
});

/* --------------------------------------------------------- batching */

test("a batch applies atomically — a bad step rolls back the whole plan", () => {
  const { engine, trackId } = withVideoTrack();
  const before = JSON.stringify(engine.doc);
  assert.throws(() => engine.runAll([
    { command: "clip.insert", input: { trackId, mediaUrl: "/a.mp4", atSeconds: 0, durationSeconds: 5 } },
    { command: "clip.insert", input: { trackId, mediaUrl: "/b.mp4", atSeconds: 5, durationSeconds: 5 } },
    { command: "clip.split", input: { clipId: "does-not-exist", atSeconds: 1 } },
  ]));
  assert.equal(JSON.stringify(engine.doc), before, "a failed plan must leave nothing behind");
});

test("a good batch applies every step", () => {
  const { engine, trackId } = withVideoTrack();
  const { applied } = engine.runAll([
    { command: "clip.insert", input: { trackId, mediaUrl: "/a.mp4", atSeconds: 0, durationSeconds: 5 } },
    { command: "clip.insert", input: { trackId, mediaUrl: "/b.mp4", atSeconds: 5, durationSeconds: 5 } },
  ]);
  assert.equal(applied, 2);
  assert.equal(locateClips(engine.doc).length, 2);
});

/* ------------------------------------------------- the target workflow */

test("the whole AI workflow: cut pauses, zoom, caption, undo", () => {
  const { engine, trackId } = withVideoTrack();
  engine.run("clip.insert", { trackId, mediaUrl: "/interview.mp4", atSeconds: 0, durationSeconds: 30 });

  /* A model reads the transcript, finds a pause at 10–11s, and removes it —
     exactly the sequence the product exists to make possible. */
  const [original] = locateClips(engine.doc);
  engine.run("clip.split", { clipId: original.id, atSeconds: 10 });
  const afterFirst = locateClips(engine.doc);
  engine.run("clip.split", { clipId: afterFirst[1].id, atSeconds: 11 });
  const pause = locateClips(engine.doc)[1];
  engine.run("clip.delete", { clipId: pause.id, ripple: true });

  assert.equal(timelineDuration(engine.doc), 29 * 30, "one second of pause should be gone");

  const first = locateClips(engine.doc)[0];
  engine.run("transform.animate", { clipId: first.id, property: "scale", from: 1, to: 1.12 });
  engine.run("caption.create", { text: "Welcome back", startSeconds: 0, endSeconds: 3 });

  const view = engine.run("timeline.inspect", {}).result;
  assert.ok(view.tracks.length >= 2, "should have a video track and a caption track");

  /* And every one of those steps is reversible. */
  engine.undo(); engine.undo(); engine.undo();
  assert.equal(timelineDuration(engine.doc), 30 * 30, "undo should restore the original length");
});
