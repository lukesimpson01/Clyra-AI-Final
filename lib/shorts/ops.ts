// Pure edits to a Shorts project. The editor, the AI edit path and the tests all
// call these, so there is one implementation of each rule (ripple insert and
// delete, split, retime). Every function returns a new project object and never
// mutates its input, which is what makes undo/redo a matter of keeping snapshots.

import {
  SHORTS_MAX_DURATION_MS,
  projectDurationMs,
  type CaptionStyle,
  type CaptionWord,
  type ShortsBackground,
  type ShortsProject,
  type TimelineItem,
  type TimelineItemType,
} from "./schema";
import {
  LIST_ITEM_MS,
  choiceDurationMs,
  holdDurationMs,
  narrationDurationMs,
  paceMultiplier,
  quizDurationMs,
  storyDurationMs,
  typingDurationMs,
  type Pace,
} from "./templates";

export const SNAP_MS = 100;
export const MIN_ITEM_MS = 200;

let counter = 0;
export function newItemId(prefix = "i") {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function itemTrack(type: TimelineItemType) {
  if (type === "title") return "titles";
  if (type === "narration") return "narration";
  return "story";
}

export function sequenceEnd(items: TimelineItem[]) {
  return items.reduce((end, item) => Math.max(end, item.startMs + item.durationMs), 0);
}

/** Default content for a newly added item. Timing comes from the same rules the generators use. */
export function defaultItem(type: TimelineItemType, startMs: number, index: number, pace: Pace, paceCustom: number): TimelineItem {
  const multiplier = paceMultiplier(pace, paceCustom);
  const id = newItemId();
  switch (type) {
    case "message": {
      const text = "New message";
      const typingMs = typingDurationMs(text, multiplier);
      return { id, type, startMs, durationMs: holdDurationMs(text, multiplier), side: "left", sender: "Them", text, receipt: "none", typingMs, speechMs: 0 };
    }
    case "choice":
      return { id, type, startMs, durationMs: choiceDurationMs(5), question: "Would you rather…?", left: "Option A", right: "Option B", leftPercent: 50, simulatedPercent: true, countdownSeconds: 5 };
    case "quiz":
      return { id, type, startMs, durationMs: quizDurationMs(3, 5), question: "Question?", answers: ["Answer A", "Answer B", "Answer C"], correctIndex: 0, explanation: "Add a one-line reason.", countdownSeconds: 5 };
    case "list-item":
      return { id, type, startMs, durationMs: LIST_ITEM_MS, rank: index + 1, total: index + 1, title: "Item", body: "Add a short detail." };
    case "story": {
      const body = "Write the story here.";
      return { id, type, startMs, durationMs: storyDurationMs(body, multiplier), title: "Story title", body, author: "u/anonymous", upvotes: 0, comments: 0 };
    }
    case "title":
      return { id, type, startMs, durationMs: 2000, text: "Title", subtitle: "" };
    case "narration": {
      const text = "Narration line.";
      return { id, type, startMs, durationMs: narrationDurationMs(text, multiplier), text };
    }
  }
}

export function addItem(project: ShortsProject, type: TimelineItemType): { project: ShortsProject; item: TimelineItem } {
  const track = itemTrack(type);
  const sameTrack = project.items.filter((item) => itemTrack(item.type) === track);
  const start = sequenceEnd(sameTrack);
  const index = project.items.filter((item) => item.type === type).length;
  const item = defaultItem(type, start, index, project.template.pace, project.template.paceCustom);
  return { project: { ...project, items: [...project.items, item].sort(byStart) }, item };
}

export function updateItem(project: ShortsProject, id: string, patch: Partial<TimelineItem>): ShortsProject {
  return {
    ...project,
    items: project.items.map((item) => (item.id === id ? sanitiseItem({ ...item, ...patch } as TimelineItem) : item)).sort(byStart),
  };
}

/** Clamps timing and text length so no edit can produce an impossible timeline. */
export function sanitiseItem(item: TimelineItem): TimelineItem {
  const durationMs = Math.min(SHORTS_MAX_DURATION_MS, Math.max(MIN_ITEM_MS, Math.round(item.durationMs)));
  const startMs = Math.max(0, Math.round(item.startMs));
  return { ...item, startMs, durationMs } as TimelineItem;
}

export function moveItem(project: ShortsProject, id: string, startMs: number): ShortsProject {
  const snapped = Math.max(0, Math.round(startMs / SNAP_MS) * SNAP_MS);
  return updateItem(project, id, { startMs: snapped });
}

export function resizeItem(project: ShortsProject, id: string, durationMs: number): ShortsProject {
  const snapped = Math.max(MIN_ITEM_MS, Math.round(durationMs / SNAP_MS) * SNAP_MS);
  return updateItem(project, id, { durationMs: snapped });
}

/** Removes items and, when `ripple` is set, moves later items on the same track left to close the gap. */
export function deleteItems(project: ShortsProject, ids: string[], ripple: boolean): ShortsProject {
  const removed = project.items.filter((item) => ids.includes(item.id));
  let items = project.items.filter((item) => !ids.includes(item.id));
  if (ripple) {
    for (const gone of removed) {
      const track = itemTrack(gone.type);
      items = items.map((item) => (itemTrack(item.type) === track && item.startMs >= gone.startMs + gone.durationMs ? { ...item, startMs: Math.max(0, item.startMs - gone.durationMs) } : item));
    }
  }
  return { ...project, items: items.sort(byStart) };
}

/** Inserts a copy directly after the original and ripples later items on the same track so nothing overlaps. */
export function duplicateItem(project: ShortsProject, id: string): { project: ShortsProject; copyId: string | null } {
  const original = project.items.find((item) => item.id === id);
  if (!original) return { project, copyId: null };
  const copy = { ...original, id: newItemId(), startMs: original.startMs + original.durationMs } as TimelineItem;
  const track = itemTrack(original.type);
  const items = project.items.map((item) => (itemTrack(item.type) === track && item.startMs >= copy.startMs ? { ...item, startMs: item.startMs + copy.durationMs } : item));
  return { project: { ...project, items: [...items, copy].sort(byStart) }, copyId: copy.id };
}

/**
 * Splits a text-bearing item at a point inside it. Only narration, title and
 * list items support this: splitting a chat message or a quiz would duplicate
 * content that the user would have to rewrite.
 */
export function splitItem(project: ShortsProject, id: string, atMs: number): { project: ShortsProject; splitId: string | null; reason?: string } {
  const item = project.items.find((candidate) => candidate.id === id);
  if (!item) return { project, splitId: null, reason: "Select an item to split." };
  if (!["narration", "title", "list-item"].includes(item.type)) return { project, splitId: null, reason: "Split works on narration, titles and list items." };
  const local = atMs - item.startMs;
  if (local <= MIN_ITEM_MS || local >= item.durationMs - MIN_ITEM_MS) return { project, splitId: null, reason: "Move the playhead inside the item to split it." };
  const firstDuration = Math.round(local);
  const secondDuration = item.durationMs - firstDuration;
  let first = { ...item, durationMs: firstDuration } as TimelineItem;
  let second = { ...item, id: newItemId(), startMs: item.startMs + firstDuration, durationMs: secondDuration } as TimelineItem;
  if (item.type === "narration") {
    // Words are divided in proportion to the time each half keeps.
    const words = item.text.split(/\s+/).filter(Boolean);
    const cut = Math.max(1, Math.min(words.length - 1, Math.round((firstDuration / item.durationMs) * words.length)));
    if (words.length < 2) return { project, splitId: null, reason: "There is not enough text to split." };
    first = { ...first, text: words.slice(0, cut).join(" ") } as TimelineItem;
    second = { ...second, text: words.slice(cut).join(" ") } as TimelineItem;
  }
  if (item.type === "title") second = { ...second, subtitle: "" } as TimelineItem;
  const items = project.items.map((candidate) => (candidate.id === id ? first : candidate));
  return { project: { ...project, items: [...items, second].sort(byStart) }, splitId: second.id };
}

/** Changes the pace preset by scaling every timed item by the ratio between the old and new multipliers. */
export function applyPace(project: ShortsProject, pace: Pace, custom = project.template.paceCustom): ShortsProject {
  const before = paceMultiplier(project.template.pace, project.template.paceCustom);
  const after = paceMultiplier(pace, custom);
  const factor = after / before;
  const items = project.items.map((item) => {
    const next = {
      ...item,
      startMs: Math.round(item.startMs * factor),
      durationMs: Math.max(MIN_ITEM_MS, Math.round(item.durationMs * factor)),
    } as TimelineItem;
    if (next.type === "message") next.typingMs = Math.round(next.typingMs * factor);
    return next;
  });
  return { ...project, items: items.sort(byStart), template: { ...project.template, pace, paceCustom: custom } };
}

export function setBackground(project: ShortsProject, background: ShortsBackground): ShortsProject {
  return { ...project, background };
}

export function setCaptionStyle(project: ShortsProject, style: CaptionStyle): ShortsProject {
  return { ...project, captions: { ...project.captions, style } };
}

export function setCaptionWords(project: ShortsProject, words: CaptionWord[]): ShortsProject {
  return { ...project, captions: { ...project.captions, words: [...words].sort((a, b) => a.startMs - b.startMs) } };
}

export function timelineDuration(project: ShortsProject) {
  return projectDurationMs(project);
}

export function byStart(a: TimelineItem, b: TimelineItem) {
  return a.startMs - b.startMs || a.id.localeCompare(b.id);
}

/** Replaces every item from a generated script in one step, keeping the project's own settings. */
export function replaceItems(project: ShortsProject, items: TimelineItem[]): ShortsProject {
  return { ...project, items: items.map(sanitiseItem).sort(byStart) };
}

export function findItem(project: ShortsProject, id: string) {
  return project.items.find((item) => item.id === id) ?? null;
}

// ---- Music / SFX ---------------------------------------------------------
// Tracks are referenced by filename in the shared library folder (see
// lib/shorts/library.ts), never copied into the project.

export function setMusic(project: ShortsProject, music: ShortsProject["audio"]["music"]): ShortsProject {
  return { ...project, audio: { ...project.audio, music } };
}

export function addSfxCue(project: ShortsProject, file: string, atMs: number): { project: ShortsProject; id: string } {
  const id = newItemId("sfx");
  const cue = { id, file, atMs: Math.max(0, Math.round(atMs)), volume: 0.9 };
  return { project: { ...project, audio: { ...project.audio, sfx: [...project.audio.sfx, cue].sort((a, b) => a.atMs - b.atMs) } }, id };
}

export function updateSfxCue(project: ShortsProject, id: string, patch: Partial<{ atMs: number; volume: number }>): ShortsProject {
  return {
    ...project,
    audio: {
      ...project.audio,
      sfx: project.audio.sfx.map((cue) => (cue.id === id ? { ...cue, ...patch, atMs: Math.max(0, Math.round(patch.atMs ?? cue.atMs)) } : cue)).sort((a, b) => a.atMs - b.atMs),
    },
  };
}

export function removeSfxCue(project: ShortsProject, id: string): ShortsProject {
  return { ...project, audio: { ...project.audio, sfx: project.audio.sfx.filter((cue) => cue.id !== id) } };
}

