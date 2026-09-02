/* The canonical project model.
 *
 * This is an OpenTimelineIO document held in memory. OTIO is the industry
 * interchange format, so a project built here opens in Premiere, Resolve and
 * Final Cut without a bespoke exporter — and, more importantly for us, its
 * schema is something other tools already understand.
 *
 * Everything in this file is pure. No I/O, no rendering, no awareness that an
 * agent exists. Mutation happens only through the command engine, which is what
 * makes undo and validation possible at all.
 *
 * Time is rational — a numerator over a rate — not floating seconds. Video is
 * full of rates that do not divide cleanly (23.976, 29.97), and accumulating
 * float error across a few hundred edits puts frames in the wrong place. OTIO
 * models time this way for the same reason.
 */

export const OTIO_SCHEMA = {
  timeline: "Timeline.1",
  stack: "Stack.1",
  track: "Track.1",
  clip: "Clip.1",
  gap: "Gap.1",
  externalReference: "ExternalReference.1",
  rationalTime: "RationalTime.1",
  timeRange: "TimeRange.1",
  transition: "Transition.1",
  marker: "Marker.1",
  effect: "Effect.1",
};

/* ------------------------------------------------------------------ time */

export const rationalTime = (value, rate) => ({
  OTIO_SCHEMA: OTIO_SCHEMA.rationalTime,
  value: Math.round(value),
  rate,
});

export const timeRange = (startValue, durationValue, rate) => ({
  OTIO_SCHEMA: OTIO_SCHEMA.timeRange,
  start_time: rationalTime(startValue, rate),
  duration: rationalTime(durationValue, rate),
});

/** Seconds → frames at a rate. Rounds to the nearest frame, never truncates:
 *  truncation biases every conversion earlier and the error accumulates. */
export const secondsToFrames = (seconds, rate) => Math.round(Number(seconds) * rate);
export const framesToSeconds = (frames, rate) => frames / rate;

export const rangeEnd = (range) => range.start_time.value + range.duration.value;

/** Do two ranges overlap? Touching end-to-start is not an overlap. */
export const rangesOverlap = (a, b) =>
  a.start_time.value < rangeEnd(b) && b.start_time.value < rangeEnd(a);

/* ----------------------------------------------------------------- nodes */

let sequence = 0;
export const newId = (prefix = "n") =>
  `${prefix}_${Date.now().toString(36)}${(sequence += 1).toString(36)}`;

export function externalReference(targetUrl, availableRange) {
  return {
    OTIO_SCHEMA: OTIO_SCHEMA.externalReference,
    target_url: targetUrl,
    available_range: availableRange ?? null,
    metadata: {},
  };
}

export function clip({ name, mediaReference, sourceRange, id = newId("clip"), metadata = {} }) {
  return {
    OTIO_SCHEMA: OTIO_SCHEMA.clip,
    name: name ?? "Clip",
    media_reference: mediaReference ?? null,
    source_range: sourceRange,
    effects: [],
    markers: [],
    /* Our own identity and per-clip state live under a namespaced metadata key.
       OTIO carries unknown metadata through round-trips untouched, so this
       survives a trip through another NLE. */
    metadata: { clyra: { id, transform: null, speed: 1, ...metadata } },
  };
}

/** A gap is real content in OTIO — it is how a track expresses empty time.
 *  Deleting a clip leaves a gap; a ripple delete removes it. */
export function gap(durationFrames, rate) {
  return {
    OTIO_SCHEMA: OTIO_SCHEMA.gap,
    name: "Gap",
    source_range: timeRange(0, durationFrames, rate),
    effects: [],
    markers: [],
    metadata: {},
  };
}

export function track({ name, kind = "Video", id = newId("track") }) {
  return {
    OTIO_SCHEMA: OTIO_SCHEMA.track,
    name: name ?? kind,
    kind,
    children: [],
    source_range: null,
    effects: [],
    markers: [],
    metadata: { clyra: { id, muted: false, locked: false, gain: 1 } },
  };
}

export function timeline({ name = "Untitled", rate = 30, width = 1920, height = 1080 } = {}) {
  return {
    OTIO_SCHEMA: OTIO_SCHEMA.timeline,
    name,
    global_start_time: rationalTime(0, rate),
    tracks: {
      OTIO_SCHEMA: OTIO_SCHEMA.stack,
      name: "tracks",
      children: [],
      source_range: null,
      effects: [],
      markers: [],
      metadata: {},
    },
    metadata: { clyra: { rate, width, height, version: 1 } },
  };
}

/* --------------------------------------------------------------- queries */

export const projectRate = (doc) => doc.metadata?.clyra?.rate ?? 30;
export const tracksOf = (doc) => doc.tracks.children;

export const trackById = (doc, trackId) =>
  tracksOf(doc).find((entry) => entry.metadata?.clyra?.id === trackId) ?? null;

export const trackIndexById = (doc, trackId) =>
  tracksOf(doc).findIndex((entry) => entry.metadata?.clyra?.id === trackId);

export const isClip = (node) => node?.OTIO_SCHEMA === OTIO_SCHEMA.clip;
export const isGap = (node) => node?.OTIO_SCHEMA === OTIO_SCHEMA.gap;

export const clipId = (node) => node?.metadata?.clyra?.id ?? null;

/** Every clip on every track, with where it sits. The command layer works in
 *  timeline coordinates, but OTIO stores tracks as consecutive runs, so this
 *  walk is what translates between the two. */
export function locateClips(doc) {
  const found = [];
  for (const [trackIndex, entry] of tracksOf(doc).entries()) {
    let playhead = 0;
    for (const [childIndex, child] of entry.children.entries()) {
      const duration = child.source_range?.duration?.value ?? 0;
      if (isClip(child)) {
        found.push({
          clip: child,
          id: clipId(child),
          track: entry,
          trackId: entry.metadata?.clyra?.id ?? null,
          trackIndex,
          childIndex,
          start: playhead,
          end: playhead + duration,
          duration,
        });
      }
      playhead += duration;
    }
  }
  return found;
}

export const locateClip = (doc, id) => locateClips(doc).find((entry) => entry.id === id) ?? null;

/** Where a track's content ends, in frames. */
export function trackDuration(entry) {
  return entry.children.reduce((total, child) => total + (child.source_range?.duration?.value ?? 0), 0);
}

/** Where the whole timeline ends — the longest track. */
export const timelineDuration = (doc) =>
  tracksOf(doc).reduce((longest, entry) => Math.max(longest, trackDuration(entry)), 0);

/* ------------------------------------------------------------ mutation */

/* These are the low-level primitives the command layer composes. They are
   exported because commands need them, not because anything else should. */

/** Place a node at a timeline position, padding with a gap if it starts past
 *  the end of the track's existing content. */
export function placeAt(entry, node, startFrame, rate) {
  const duration = trackDuration(entry);
  if (startFrame > duration) entry.children.push(gap(startFrame - duration, rate));
  /* Landing inside existing content means splitting whatever is there; the
     command layer resolves that before calling in, so by here the position is
     always at or past the end, or exactly on a boundary. */
  const boundary = boundaryIndexAt(entry, startFrame);
  entry.children.splice(boundary, 0, node);
  return node;
}

/** The child index at a frame position, if that position is on a boundary. */
export function boundaryIndexAt(entry, frame) {
  let playhead = 0;
  for (const [index, child] of entry.children.entries()) {
    if (playhead === frame) return index;
    playhead += child.source_range?.duration?.value ?? 0;
  }
  return entry.children.length;
}

/** Trailing gaps are invisible but they extend the timeline and confuse
 *  duration maths, so they are swept after any structural edit. */
export function trimTrailingGaps(entry) {
  while (entry.children.length && isGap(entry.children[entry.children.length - 1])) {
    entry.children.pop();
  }
}

/** Merge neighbouring gaps left behind by deletes. */
export function coalesceGaps(entry, rate) {
  const merged = [];
  for (const child of entry.children) {
    const previous = merged[merged.length - 1];
    if (isGap(child) && previous && isGap(previous)) {
      previous.source_range = timeRange(
        0,
        previous.source_range.duration.value + child.source_range.duration.value,
        rate,
      );
      continue;
    }
    merged.push(child);
  }
  entry.children = merged;
  trimTrailingGaps(entry);
}

/* ------------------------------------------------------- serialisation */

export const clone = (value) => structuredClone(value);
export const toOtioJson = (doc) => JSON.stringify(doc, null, 2);
export const fromOtioJson = (text) => JSON.parse(text);
