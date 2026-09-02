/* The command engine.
 *
 * Nothing edits the timeline directly — not the UI, not the agent. Every change
 * is a named command with a JSON schema, and that single constraint is what
 * makes the rest of the product possible:
 *
 *   - undo/redo comes free, because a command knows how to describe its inverse
 *   - an LLM can be handed the schemas as tools with no extra plumbing
 *   - a model's mistake is either rejected outright or completely reversible;
 *     there is no half-applied state for a human to clean up
 *   - a human edit and an AI edit take exactly the same path, so they cannot
 *     drift in behaviour
 *
 * A command that throws leaves the document untouched. That is enforced here
 * rather than trusted to each handler: the engine applies every command to a
 * copy and only commits on success.
 */
import {
  clip, gap, track, timeline, timeRange, rationalTime,
  projectRate, tracksOf, trackById, trackIndexById, locateClip, locateClips,
  isClip, isGap, clipId, trackDuration, timelineDuration,
  placeAt, boundaryIndexAt, coalesceGaps, trimTrailingGaps,
  externalReference, secondsToFrames, framesToSeconds, clone, newId,
} from "../../timeline/src/index.mjs";

export class CommandError extends Error {
  constructor(message, code = "invalid_input", details = null) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------- schemas */

/* Deliberately a small hand-rolled validator rather than a JSON Schema
   library. The tool surface is the product's public contract with every model
   provider, and the shapes it needs are simple enough that a dependency would
   buy less than it costs. It emits real JSON Schema for the providers. */

const T = {
  string: (opts = {}) => ({ type: "string", ...opts }),
  number: (opts = {}) => ({ type: "number", ...opts }),
  integer: (opts = {}) => ({ type: "integer", ...opts }),
  boolean: (opts = {}) => ({ type: "boolean", ...opts }),
  enum: (values, opts = {}) => ({ type: "string", enum: values, ...opts }),
  array: (items, opts = {}) => ({ type: "array", items, ...opts }),
  object: (properties, required = [], opts = {}) =>
    ({ type: "object", properties, required, additionalProperties: false, ...opts }),
};

function validate(schema, value, path = "input") {
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new CommandError(`${path} must be an object`);
    }
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) throw new CommandError(`${path}.${key} is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          throw new CommandError(`${path}.${key} is not a recognised field`);
        }
        continue;
      }
      if (child !== undefined && child !== null) validate(childSchema, child, `${path}.${key}`);
    }
    return value;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new CommandError(`${path} must be an array`);
    value.forEach((item, index) => validate(schema.items, item, `${path}[${index}]`));
    return value;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new CommandError(`${path} must be one of: ${schema.enum.join(", ")}`);
  }
  if (schema.type === "string" && typeof value !== "string") {
    throw new CommandError(`${path} must be a string`);
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new CommandError(`${path} must be a boolean`);
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new CommandError(`${path} must be a number`);
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      throw new CommandError(`${path} must be a whole number`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new CommandError(`${path} must be at least ${schema.minimum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      throw new CommandError(`${path} must be greater than ${schema.exclusiveMinimum}`);
    }
  }
  return value;
}

/* ------------------------------------------------------------ helpers */

const requireTrack = (doc, trackId) => {
  const entry = trackById(doc, trackId);
  if (!entry) throw new CommandError(`No track with id "${trackId}"`, "not_found");
  return entry;
};

const requireClip = (doc, id) => {
  const found = locateClip(doc, id);
  if (!found) throw new CommandError(`No clip with id "${id}"`, "not_found");
  return found;
};

/** Time can be given in seconds or frames. Seconds is what a model reasons in
 *  (a transcript is in seconds); frames is what the timeline stores. */
const atFrames = (doc, input, field = "at") => {
  const rate = projectRate(doc);
  if (input[`${field}Frames`] !== undefined) return Math.round(input[`${field}Frames`]);
  if (input[`${field}Seconds`] !== undefined) return secondsToFrames(input[`${field}Seconds`], rate);
  throw new CommandError(`Provide ${field}Seconds or ${field}Frames`);
};

const summariseClip = (found) => ({
  id: found.id,
  name: found.clip.name,
  trackId: found.trackId,
  startSeconds: framesToSeconds(found.start, found.clip.source_range.duration.rate),
  durationSeconds: framesToSeconds(found.duration, found.clip.source_range.duration.rate),
  startFrames: found.start,
  durationFrames: found.duration,
});

/** Split whatever sits at a frame position so the position becomes a boundary.
 *  Every structural edit needs this; doing it in one place is what stops
 *  off-by-one frame errors appearing in five different commands. */
function ensureBoundary(entry, frame, rate) {
  let playhead = 0;
  for (const [index, child] of entry.children.entries()) {
    const duration = child.source_range?.duration?.value ?? 0;
    if (playhead === frame) return index;
    if (frame > playhead && frame < playhead + duration) {
      const offset = frame - playhead;
      const left = clone(child);
      const right = clone(child);
      left.source_range = timeRange(child.source_range.start_time.value, offset, rate);
      right.source_range = timeRange(
        child.source_range.start_time.value + offset,
        duration - offset,
        rate,
      );
      if (isClip(right)) right.metadata.clyra = { ...right.metadata.clyra, id: newId("clip") };
      entry.children.splice(index, 1, left, right);
      return index + 1;
    }
    playhead += duration;
  }
  return entry.children.length;
}

/* ------------------------------------------------------------ registry */

/** Every command: schema, what it does, and how it describes itself to a model. */
export const COMMANDS = {};

const define = (name, { summary, input, handler, mutates = true }) => {
  COMMANDS[name] = { name, summary, input, handler, mutates };
};

/* ---- inspection (read-only; these are what an agent calls first) ---- */

define("project.inspect", {
  summary: "Project settings: name, frame rate, resolution, duration and track count.",
  mutates: false,
  input: T.object({}, []),
  handler: (doc) => {
    const rate = projectRate(doc);
    return {
      name: doc.name,
      rate,
      width: doc.metadata.clyra.width,
      height: doc.metadata.clyra.height,
      durationSeconds: framesToSeconds(timelineDuration(doc), rate),
      durationFrames: timelineDuration(doc),
      trackCount: tracksOf(doc).length,
    };
  },
});

define("timeline.inspect", {
  summary: "Every track and clip with its position and duration in seconds. The agent's view of the edit.",
  mutates: false,
  input: T.object({ trackId: T.string() }, []),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const all = locateClips(doc);
    return {
      rate,
      durationSeconds: framesToSeconds(timelineDuration(doc), rate),
      tracks: tracksOf(doc)
        .filter((entry) => !input.trackId || entry.metadata.clyra.id === input.trackId)
        .map((entry) => ({
          id: entry.metadata.clyra.id,
          name: entry.name,
          kind: entry.kind,
          muted: entry.metadata.clyra.muted,
          locked: entry.metadata.clyra.locked,
          durationSeconds: framesToSeconds(trackDuration(entry), rate),
          clips: all
            .filter((found) => found.trackId === entry.metadata.clyra.id)
            .map(summariseClip),
        })),
    };
  },
});

/* ---- tracks ---- */

define("track.create", {
  summary: "Add a video or audio track.",
  input: T.object({
    kind: T.enum(["Video", "Audio"], { description: "Track type." }),
    name: T.string({ description: "Optional display name." }),
  }, ["kind"]),
  handler: (doc, input) => {
    const entry = track({ kind: input.kind, name: input.name });
    tracksOf(doc).push(entry);
    return { trackId: entry.metadata.clyra.id, name: entry.name, kind: entry.kind };
  },
});

define("track.delete", {
  summary: "Remove a track and everything on it.",
  input: T.object({ trackId: T.string() }, ["trackId"]),
  handler: (doc, input) => {
    const index = trackIndexById(doc, input.trackId);
    if (index < 0) throw new CommandError(`No track with id "${input.trackId}"`, "not_found");
    const [removed] = tracksOf(doc).splice(index, 1);
    return { trackId: input.trackId, removedClips: removed.children.filter(isClip).length };
  },
});

/* ---- clips ---- */

define("clip.insert", {
  summary: "Place a piece of media on a track at a time position.",
  input: T.object({
    trackId: T.string(),
    mediaUrl: T.string({ description: "Path or URL of the source media." }),
    atSeconds: T.number({ minimum: 0, description: "Where on the timeline it starts." }),
    atFrames: T.integer({ minimum: 0 }),
    sourceInSeconds: T.number({ minimum: 0, description: "In-point within the source." }),
    durationSeconds: T.number({ exclusiveMinimum: 0, description: "How much of the source to use." }),
    name: T.string(),
  }, ["trackId", "mediaUrl", "durationSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const entry = requireTrack(doc, input.trackId);
    if (entry.metadata.clyra.locked) throw new CommandError("That track is locked", "locked");
    const start = atFrames(doc, { ...input, atSeconds: input.atSeconds ?? 0 });
    const durationFrames = secondsToFrames(input.durationSeconds, rate);
    if (durationFrames <= 0) throw new CommandError("durationSeconds must be greater than zero");

    const node = clip({
      name: input.name ?? input.mediaUrl.split("/").pop(),
      mediaReference: externalReference(input.mediaUrl),
      sourceRange: timeRange(secondsToFrames(input.sourceInSeconds ?? 0, rate), durationFrames, rate),
    });
    /* Inserting into the middle splits what is there rather than overwriting:
       an insert should never silently destroy footage. */
    const index = ensureBoundary(entry, start, rate);
    if (start > trackDuration(entry)) placeAt(entry, node, start, rate);
    else entry.children.splice(index, 0, node);
    return { clipId: clipId(node), ...summariseClip(requireClip(doc, clipId(node))) };
  },
});

define("clip.split", {
  summary: "Cut a clip in two at a time position. The razor tool.",
  input: T.object({
    clipId: T.string(),
    atSeconds: T.number({ minimum: 0, description: "Timeline position of the cut." }),
    atFrames: T.integer({ minimum: 0 }),
  }, ["clipId"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const at = atFrames(doc, input);
    if (at <= found.start || at >= found.end) {
      throw new CommandError(
        `The cut must fall inside the clip (${framesToSeconds(found.start, rate)}s–${framesToSeconds(found.end, rate)}s)`,
        "out_of_range",
      );
    }
    ensureBoundary(found.track, at, rate);
    const after = locateClips(doc).filter((entry) => entry.trackId === found.trackId);
    const left = after.find((entry) => entry.start === found.start);
    const right = after.find((entry) => entry.start === at);
    return { left: summariseClip(left), right: summariseClip(right) };
  },
});

define("clip.trim", {
  summary: "Change where a clip starts or ends without moving other clips.",
  input: T.object({
    clipId: T.string(),
    startSeconds: T.number({ minimum: 0, description: "New in-point on the timeline." }),
    endSeconds: T.number({ exclusiveMinimum: 0, description: "New out-point on the timeline." }),
  }, ["clipId"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    if (found.track.metadata.clyra.locked) throw new CommandError("That track is locked", "locked");
    const start = input.startSeconds === undefined ? found.start : secondsToFrames(input.startSeconds, rate);
    const end = input.endSeconds === undefined ? found.end : secondsToFrames(input.endSeconds, rate);
    if (end <= start) throw new CommandError("The end must come after the start");

    const source = found.clip.source_range;
    /* Trimming the head walks the source in-point forward by the same amount,
       so the frames stay in sync with the media rather than sliding. */
    const headDelta = start - found.start;
    found.clip.source_range = timeRange(
      source.start_time.value + headDelta,
      end - start,
      rate,
    );
    if (headDelta > 0) found.track.children.splice(found.childIndex, 0, gap(headDelta, rate));
    coalesceGaps(found.track, rate);
    return summariseClip(requireClip(doc, input.clipId));
  },
});

define("clip.move", {
  summary: "Move a clip to a different time, and optionally a different track.",
  input: T.object({
    clipId: T.string(),
    toSeconds: T.number({ minimum: 0 }),
    toFrames: T.integer({ minimum: 0 }),
    trackId: T.string({ description: "Move to this track. Defaults to staying put." }),
  }, ["clipId"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const target = input.trackId ? requireTrack(doc, input.trackId) : found.track;
    if (target.metadata.clyra.locked) throw new CommandError("That track is locked", "locked");
    const to = atFrames(doc, { ...input, atSeconds: input.toSeconds, atFrames: input.toFrames }, "at")
      ?? found.start;

    const node = found.track.children[found.childIndex];
    found.track.children.splice(found.childIndex, 1, gap(found.duration, rate));
    coalesceGaps(found.track, rate);

    const index = ensureBoundary(target, to, rate);
    if (to > trackDuration(target)) placeAt(target, node, to, rate);
    else target.children.splice(index, 0, node);
    coalesceGaps(target, rate);
    return summariseClip(requireClip(doc, input.clipId));
  },
});

define("clip.delete", {
  summary: "Remove a clip. Ripple closes the gap and pulls later clips earlier.",
  input: T.object({
    clipId: T.string(),
    ripple: T.boolean({ description: "Close the gap left behind. Default false." }),
  }, ["clipId"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    if (found.track.metadata.clyra.locked) throw new CommandError("That track is locked", "locked");
    if (input.ripple) found.track.children.splice(found.childIndex, 1);
    else found.track.children.splice(found.childIndex, 1, gap(found.duration, rate));
    coalesceGaps(found.track, rate);
    return { clipId: input.clipId, rippled: Boolean(input.ripple) };
  },
});

define("clip.duplicate", {
  summary: "Copy a clip and place the copy directly after it.",
  input: T.object({ clipId: T.string() }, ["clipId"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const copy = clone(found.clip);
    copy.metadata.clyra = { ...copy.metadata.clyra, id: newId("clip") };
    found.track.children.splice(found.childIndex + 1, 0, copy);
    return summariseClip(requireClip(doc, clipId(copy)));
  },
});

define("clip.speed", {
  summary: "Change playback speed. 2 is double speed, 0.5 is half.",
  input: T.object({
    clipId: T.string(),
    speed: T.number({ exclusiveMinimum: 0, description: "Multiplier." }),
  }, ["clipId", "speed"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const previous = found.clip.metadata.clyra.speed ?? 1;
    /* Speed changes how long the same source occupies on the timeline. The
       source range is unchanged; the timeline duration scales. */
    const scaled = Math.max(1, Math.round((found.duration * previous) / input.speed));
    found.clip.metadata.clyra.speed = input.speed;
    found.clip.source_range = timeRange(found.clip.source_range.start_time.value, scaled, rate);
    return { ...summariseClip(requireClip(doc, input.clipId)), speed: input.speed };
  },
});

/* ---- transform and keyframes ---- */

define("transform.set", {
  summary: "Set scale, position or rotation on a clip. Used for punch-in zooms and reframing.",
  input: T.object({
    clipId: T.string(),
    scale: T.number({ exclusiveMinimum: 0 }),
    x: T.number(), y: T.number(),
    rotation: T.number(),
  }, ["clipId"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const current = found.clip.metadata.clyra.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, keyframes: [] };
    const next = {
      ...current,
      ...(input.scale !== undefined ? { scale: input.scale } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    };
    found.clip.metadata.clyra.transform = next;
    return { clipId: input.clipId, transform: next };
  },
});

define("transform.animate", {
  summary: "Animate a transform between two values over the clip. This is how a punch-in zoom is made.",
  input: T.object({
    clipId: T.string(),
    property: T.enum(["scale", "x", "y", "rotation"]),
    from: T.number(), to: T.number(),
    easing: T.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  }, ["clipId", "property", "from", "to"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const transform = found.clip.metadata.clyra.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, keyframes: [] };
    transform.keyframes = (transform.keyframes ?? []).filter((k) => k.property !== input.property);
    transform.keyframes.push(
      { property: input.property, atFrames: 0, value: input.from, easing: input.easing ?? "easeInOut" },
      { property: input.property, atFrames: found.duration, value: input.to, easing: input.easing ?? "easeInOut" },
    );
    transform[input.property] = input.from;
    found.clip.metadata.clyra.transform = transform;
    return { clipId: input.clipId, property: input.property, keyframes: transform.keyframes.length };
  },
});

/* ---- audio ---- */

define("audio.gain", {
  summary: "Set the level of a clip or a whole track, in decibels.",
  input: T.object({
    clipId: T.string(), trackId: T.string(),
    db: T.number({ description: "Decibels. 0 is unchanged, -6 is half as loud." }),
  }, ["db"]),
  handler: (doc, input) => {
    const gainValue = 10 ** (input.db / 20);
    if (input.clipId) {
      const found = requireClip(doc, input.clipId);
      found.clip.metadata.clyra.gain = gainValue;
      return { clipId: input.clipId, db: input.db, gain: gainValue };
    }
    if (input.trackId) {
      const entry = requireTrack(doc, input.trackId);
      entry.metadata.clyra.gain = gainValue;
      return { trackId: input.trackId, db: input.db, gain: gainValue };
    }
    throw new CommandError("Provide clipId or trackId");
  },
});

define("audio.fade", {
  summary: "Fade a clip's audio in or out over a duration.",
  input: T.object({
    clipId: T.string(),
    inSeconds: T.number({ minimum: 0 }),
    outSeconds: T.number({ minimum: 0 }),
  }, ["clipId"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    found.clip.metadata.clyra.fade = {
      inSeconds: input.inSeconds ?? 0,
      outSeconds: input.outSeconds ?? 0,
    };
    return { clipId: input.clipId, fade: found.clip.metadata.clyra.fade };
  },
});

/* ---- captions ---- */

define("caption.create", {
  summary: "Add a caption over a time range.",
  input: T.object({
    text: T.string(),
    startSeconds: T.number({ minimum: 0 }),
    endSeconds: T.number({ exclusiveMinimum: 0 }),
    trackId: T.string({ description: "Caption track. One is created if omitted." }),
  }, ["text", "startSeconds", "endSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    if (input.endSeconds <= input.startSeconds) {
      throw new CommandError("endSeconds must be after startSeconds");
    }
    let entry = input.trackId
      ? requireTrack(doc, input.trackId)
      : tracksOf(doc).find((candidate) => candidate.metadata.clyra.role === "captions");
    if (!entry) {
      entry = track({ kind: "Video", name: "Captions" });
      entry.metadata.clyra.role = "captions";
      tracksOf(doc).push(entry);
    }
    const start = secondsToFrames(input.startSeconds, rate);
    const duration = secondsToFrames(input.endSeconds - input.startSeconds, rate);
    const node = clip({
      name: input.text.slice(0, 40),
      sourceRange: timeRange(0, duration, rate),
      metadata: { kind: "caption", text: input.text },
    });
    placeAt(entry, node, Math.max(start, trackDuration(entry)), rate);
    return { captionId: clipId(node), trackId: entry.metadata.clyra.id, text: input.text };
  },
});

/* ---- keyframes ---- */

define("keyframe.add", {
  summary: "Add a keyframe to an animated property at a time inside the clip.",
  input: T.object({
    clipId: T.string(),
    property: T.enum(["scale", "x", "y", "rotation", "opacity", "volume"]),
    atSeconds: T.number({ minimum: 0, description: "Offset from the clip's start." }),
    value: T.number(),
    easing: T.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  }, ["clipId", "property", "atSeconds", "value"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const at = secondsToFrames(input.atSeconds, rate);
    if (at > found.duration) {
      throw new CommandError("The keyframe falls past the end of the clip", "out_of_range");
    }
    const transform = found.clip.metadata.clyra.transform
      ?? { scale: 1, x: 0, y: 0, rotation: 0, keyframes: [] };
    transform.keyframes = (transform.keyframes ?? []).filter(
      (k) => !(k.property === input.property && k.atFrames === at),
    );
    transform.keyframes.push({
      property: input.property, atFrames: at, value: input.value,
      easing: input.easing ?? "easeInOut",
    });
    transform.keyframes.sort((a, b) => a.atFrames - b.atFrames);
    found.clip.metadata.clyra.transform = transform;
    return { clipId: input.clipId, property: input.property, atSeconds: input.atSeconds, value: input.value };
  },
});

define("keyframe.update", {
  summary: "Change the value or easing of an existing keyframe.",
  input: T.object({
    clipId: T.string(),
    property: T.enum(["scale", "x", "y", "rotation", "opacity", "volume"]),
    atSeconds: T.number({ minimum: 0 }),
    value: T.number(),
    easing: T.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  }, ["clipId", "property", "atSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const at = secondsToFrames(input.atSeconds, rate);
    const keyframes = found.clip.metadata.clyra.transform?.keyframes ?? [];
    const target = keyframes.find((k) => k.property === input.property && k.atFrames === at);
    if (!target) throw new CommandError("No keyframe at that position", "not_found");
    if (input.value !== undefined) target.value = input.value;
    if (input.easing !== undefined) target.easing = input.easing;
    return { clipId: input.clipId, property: input.property, value: target.value, easing: target.easing };
  },
});

define("keyframe.delete", {
  summary: "Remove a keyframe.",
  input: T.object({
    clipId: T.string(),
    property: T.enum(["scale", "x", "y", "rotation", "opacity", "volume"]),
    atSeconds: T.number({ minimum: 0 }),
  }, ["clipId", "property", "atSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const at = secondsToFrames(input.atSeconds, rate);
    const transform = found.clip.metadata.clyra.transform;
    const before = transform?.keyframes?.length ?? 0;
    if (transform) {
      transform.keyframes = (transform.keyframes ?? []).filter(
        (k) => !(k.property === input.property && k.atFrames === at),
      );
    }
    const removed = before - (transform?.keyframes?.length ?? 0);
    if (!removed) throw new CommandError("No keyframe at that position", "not_found");
    return { clipId: input.clipId, removed };
  },
});

/* ---- transitions ---- */

define("transition.add", {
  summary: "Add a transition between two adjacent clips, centred on their cut.",
  input: T.object({
    clipId: T.string({ description: "The clip the transition follows." }),
    kind: T.enum(["dissolve", "fade", "wipe", "slide"]),
    durationSeconds: T.number({ exclusiveMinimum: 0 }),
  }, ["clipId", "kind", "durationSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const found = requireClip(doc, input.clipId);
    const frames = secondsToFrames(input.durationSeconds, rate);
    /* A transition needs media on both sides to dissolve between; half of it
       hangs over each clip, so neither may be shorter than half its length. */
    if (frames / 2 > found.duration) {
      throw new CommandError("The transition is longer than the clip can support", "out_of_range");
    }
    const node = {
      OTIO_SCHEMA: "Transition.1",
      name: input.kind,
      transition_type: "SMPTE_Dissolve",
      in_offset: rationalTime(Math.floor(frames / 2), rate),
      out_offset: rationalTime(Math.ceil(frames / 2), rate),
      metadata: { clyra: { id: newId("xn"), kind: input.kind } },
    };
    found.track.children.splice(found.childIndex + 1, 0, node);
    return { transitionId: node.metadata.clyra.id, kind: input.kind, durationSeconds: input.durationSeconds };
  },
});

define("transition.remove", {
  summary: "Remove a transition.",
  input: T.object({ transitionId: T.string() }, ["transitionId"]),
  handler: (doc, input) => {
    for (const entry of tracksOf(doc)) {
      const index = entry.children.findIndex(
        (child) => child.metadata?.clyra?.id === input.transitionId,
      );
      if (index >= 0) { entry.children.splice(index, 1); return { transitionId: input.transitionId }; }
    }
    throw new CommandError(`No transition with id "${input.transitionId}"`, "not_found");
  },
});

/* ---- effects ---- */

const EFFECTS = ["blur", "sharpen", "brightness", "contrast", "saturation", "lut", "crop", "stabilise", "denoise", "chromaKey"];

define("effect.add", {
  summary: `Add an effect to a clip. One of: ${EFFECTS.join(", ")}.`,
  input: T.object({
    clipId: T.string(),
    effect: T.enum(EFFECTS),
    amount: T.number({ description: "Strength, where meaningful. 0–1 for most." }),
  }, ["clipId", "effect"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const node = {
      OTIO_SCHEMA: "Effect.1",
      name: input.effect,
      effect_name: input.effect,
      metadata: { clyra: { id: newId("fx"), amount: input.amount ?? 1 } },
    };
    found.clip.effects.push(node);
    return { effectId: node.metadata.clyra.id, effect: input.effect, amount: node.metadata.clyra.amount };
  },
});

define("effect.update", {
  summary: "Change an effect's strength.",
  input: T.object({
    clipId: T.string(), effectId: T.string(),
    amount: T.number(),
  }, ["clipId", "effectId", "amount"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const node = found.clip.effects.find((fx) => fx.metadata?.clyra?.id === input.effectId);
    if (!node) throw new CommandError(`No effect with id "${input.effectId}"`, "not_found");
    node.metadata.clyra.amount = input.amount;
    return { effectId: input.effectId, amount: input.amount };
  },
});

define("effect.remove", {
  summary: "Remove an effect from a clip.",
  input: T.object({ clipId: T.string(), effectId: T.string() }, ["clipId", "effectId"]),
  handler: (doc, input) => {
    const found = requireClip(doc, input.clipId);
    const before = found.clip.effects.length;
    found.clip.effects = found.clip.effects.filter((fx) => fx.metadata?.clyra?.id !== input.effectId);
    if (found.clip.effects.length === before) {
      throw new CommandError(`No effect with id "${input.effectId}"`, "not_found");
    }
    return { clipId: input.clipId, effectId: input.effectId };
  },
});

/* ---- audio ducking ---- */

define("audio.duck", {
  summary: "Lower a music track wherever a speech track is loud, so narration stays intelligible.",
  input: T.object({
    trackId: T.string({ description: "The track to lower — usually music." }),
    againstTrackId: T.string({ description: "The track to duck against — usually dialogue." }),
    db: T.number({ description: "How far to duck. Default -12." }),
  }, ["trackId", "againstTrackId"]),
  handler: (doc, input) => {
    const entry = requireTrack(doc, input.trackId);
    requireTrack(doc, input.againstTrackId);
    const db = input.db ?? -12;
    /* Recorded as intent rather than baked keyframes: the render backend has
       the actual loudness envelope and can place the ramps far better than a
       command with no access to the audio could. */
    entry.metadata.clyra.duck = { againstTrackId: input.againstTrackId, db };
    return { trackId: input.trackId, againstTrackId: input.againstTrackId, db };
  },
});

/* ---- caption styling ---- */

define("caption.style", {
  summary: "Set how captions look — font, size, colour, position.",
  input: T.object({
    trackId: T.string({ description: "Caption track. Defaults to the first one." }),
    font: T.string(), sizePx: T.number({ exclusiveMinimum: 0 }),
    colour: T.string(), background: T.string(),
    position: T.enum(["top", "middle", "bottom"]),
    bold: T.boolean(), uppercase: T.boolean(),
  }, []),
  handler: (doc, input) => {
    const entry = input.trackId
      ? requireTrack(doc, input.trackId)
      : tracksOf(doc).find((candidate) => candidate.metadata.clyra.role === "captions");
    if (!entry) throw new CommandError("There is no caption track yet", "not_found");
    const style = { ...(entry.metadata.clyra.captionStyle ?? {}) };
    for (const key of ["font", "sizePx", "colour", "background", "position", "bold", "uppercase"]) {
      if (input[key] !== undefined) style[key] = input[key];
    }
    entry.metadata.clyra.captionStyle = style;
    return { trackId: entry.metadata.clyra.id, style };
  },
});

/* ---- media and transcript (the agent's eyes) ---- */

/* The engine holds an analysis index per media path. It is populated by the
   host application calling attachAnalysis(); the command layer only reads it,
   so these commands stay pure and synchronous like every other. */

define("media.inspect", {
  summary: "Facts about a piece of media: duration, resolution, frame rate, codecs, and what analysis is available.",
  mutates: false,
  input: T.object({ mediaUrl: T.string() }, ["mediaUrl"]),
  handler: (doc, input, context) => {
    const index = context?.analysis?.get(input.mediaUrl);
    if (!index) {
      throw new CommandError(
        `No analysis for "${input.mediaUrl}". Import and analyse it first.`,
        "not_analysed",
      );
    }
    return {
      ...index.media,
      loudness: index.loudness ?? null,
      available: index.counts ?? {},
    };
  },
});

define("media.search", {
  summary: "Find moments in the footage by kind — silence, speech or shot change — optionally longer than a duration.",
  mutates: false,
  input: T.object({
    mediaUrl: T.string(),
    kind: T.enum(["silence", "speech", "shot"]),
    longerThanSeconds: T.number({ minimum: 0 }),
  }, ["mediaUrl", "kind"]),
  handler: (doc, input, context) => {
    const index = context?.analysis?.get(input.mediaUrl);
    if (!index) throw new CommandError(`No analysis for "${input.mediaUrl}"`, "not_analysed");
    const floor = input.longerThanSeconds ?? 0;
    const matches = index.segments
      .filter((segment) => segment.kind === input.kind)
      .filter((segment) => (segment.duration ?? (segment.end - segment.start)) > floor);
    return {
      count: matches.length,
      segments: matches.map((segment) => ({
        start: segment.start,
        end: segment.end,
        duration: segment.duration ?? segment.end - segment.start,
        text: segment.text ?? undefined,
      })),
    };
  },
});

define("transcript.search", {
  summary: "Find where something was said, with timestamps. This is how an edit is driven by what the footage says.",
  mutates: false,
  input: T.object({
    mediaUrl: T.string(),
    query: T.string({ description: "Words to look for. Omit to get the whole transcript." }),
  }, ["mediaUrl"]),
  handler: (doc, input, context) => {
    const index = context?.analysis?.get(input.mediaUrl);
    if (!index) throw new CommandError(`No analysis for "${input.mediaUrl}"`, "not_analysed");
    const speech = index.segments.filter((segment) => segment.kind === "speech");
    if (!speech.length) {
      throw new CommandError("That media has no transcript. Run transcription first.", "no_transcript");
    }
    const needle = String(input.query ?? "").toLowerCase();
    const matches = needle
      ? speech.filter((segment) => segment.text.toLowerCase().includes(needle))
      : speech;
    return {
      count: matches.length,
      segments: matches.map((segment) => ({
        start: segment.start, end: segment.end,
        text: segment.text, speaker: segment.speaker ?? undefined,
      })),
    };
  },
});

/* ---- rendering ---- */

/* Render commands describe the job rather than performing it: the engine is
   synchronous and pure, and encoding is neither. The host runs the returned
   job through packages/render and reports back. */

define("render.preview", {
  summary: "Ask for a preview frame at a time position.",
  mutates: false,
  input: T.object({
    atSeconds: T.number({ minimum: 0 }),
    width: T.integer({ exclusiveMinimum: 0 }),
    height: T.integer({ exclusiveMinimum: 0 }),
  }, ["atSeconds"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const duration = framesToSeconds(timelineDuration(doc), rate);
    if (input.atSeconds > duration) {
      throw new CommandError(`The timeline is only ${duration}s long`, "out_of_range");
    }
    return {
      job: "preview",
      atSeconds: input.atSeconds,
      width: input.width ?? doc.metadata.clyra.width,
      height: input.height ?? doc.metadata.clyra.height,
    };
  },
});

define("render.export", {
  summary: "Ask for the finished video. Use aspect to produce a vertical or square cut.",
  mutates: false,
  input: T.object({
    output: T.string({ description: "Where to write the file." }),
    aspect: T.enum(["source", "16:9", "9:16", "1:1", "4:5"]),
    crf: T.integer({ minimum: 0, description: "Quality; lower is better. 20 is a good default." }),
    preset: T.enum(["ultrafast", "veryfast", "fast", "medium", "slow"]),
  }, ["output"]),
  handler: (doc, input) => {
    const rate = projectRate(doc);
    const sourceWidth = doc.metadata.clyra.width;
    const sourceHeight = doc.metadata.clyra.height;
    /* The long edge is preserved when reframing, so a vertical cut of 1080p
       footage comes out 1080×1920 rather than a downscaled crop. */
    const longEdge = Math.max(sourceWidth, sourceHeight);
    const frame = {
      source: [sourceWidth, sourceHeight],
      "16:9": [longEdge, Math.round((longEdge * 9) / 16)],
      "9:16": [Math.round((longEdge * 9) / 16), longEdge],
      "1:1": [longEdge, longEdge],
      "4:5": [Math.round((longEdge * 4) / 5), longEdge],
    }[input.aspect ?? "source"];

    if (timelineDuration(doc) === 0) {
      throw new CommandError("There is nothing on the timeline to export", "empty_timeline");
    }
    return {
      job: "export",
      output: input.output,
      width: frame[0], height: frame[1],
      fps: rate,
      crf: input.crf ?? 20,
      preset: input.preset ?? "medium",
      durationSeconds: framesToSeconds(timelineDuration(doc), rate),
    };
  },
});

/* -------------------------------------------------------------- engine */

export class Engine {
  constructor(doc = timeline()) {
    this.doc = doc;
    /* Media analysis, keyed by media url. The agent reads footage through
       this — it is the substitute for vision. */
    this.analysis = new Map();
    this.past = [];
    this.future = [];
    this.log = [];
    this.limit = 200;
  }

  /** The tool surface, as JSON Schema — what gets handed to a model. */
  static describe() {
    return Object.values(COMMANDS).map((command) => ({
      name: command.name,
      description: command.summary,
      readOnly: !command.mutates,
      inputSchema: command.input,
    }));
  }

  /**
   * Run one command.
   *
   * The document is only replaced if the handler completes. A command that
   * throws — because a model invented a clip id, or asked for a cut outside a
   * clip — leaves the project exactly as it was. That guarantee is what makes
   * it safe to let a model drive this at all.
   */
  run(name, input = {}) {
    const command = COMMANDS[name];
    if (!command) throw new CommandError(`Unknown command "${name}"`, "unknown_command");
    validate(command.input, input);

    if (!command.mutates) {
      return { ok: true, command: name, result: command.handler(this.doc, input, this) };
    }

    const before = clone(this.doc);
    let result;
    try {
      result = command.handler(this.doc, input, this);
    } catch (error) {
      this.doc = before;
      throw error;
    }
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
    this.log.push({ command: name, input, at: Date.now() });
    return { ok: true, command: name, result };
  }

  /** Run a batch atomically: all of them, or none. An agent emits plans, and a
   *  plan that is half-right should not leave a half-edited timeline. */
  runAll(steps) {
    const before = clone(this.doc);
    const results = [];
    try {
      for (const step of steps) results.push(this.run(step.command, step.input ?? {}));
    } catch (error) {
      this.doc = before;
      throw error;
    }
    return { ok: true, applied: results.length, results };
  }

  /** Attach an analysis index so media.* and transcript.* can answer. */
  attachAnalysis(mediaUrl, index) {
    this.analysis.set(mediaUrl, index);
    return this;
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return { ok: false, reason: "nothing_to_undo" };
    this.future.push(clone(this.doc));
    this.doc = previous;
    return { ok: true };
  }

  redo() {
    const next = this.future.pop();
    if (!next) return { ok: false, reason: "nothing_to_redo" };
    this.past.push(clone(this.doc));
    this.doc = next;
    return { ok: true };
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

export { validate, T };
