// Template timing rules. Every generator (fake text, would-you-rather, quiz,
// list, story, narrated) produces the same TimelineItem primitives, and the
// renderer derives what is visible at time t from these items alone. Timing is
// computed here from text length, never from wall-clock animation, so a preview
// and an export of the same project show the same frame at the same time.

import type { CaptionWord, ChoiceItem, ListItem, MessageItem, NarrationItem, QuizItem, StoryItem, TimelineItem, TitleItem } from "./schema";

export type { Pace } from "./schema";
import type { Pace } from "./schema";

const PACE_MULTIPLIER: Record<Exclude<Pace, "custom">, number> = { slow: 1.35, natural: 1, fast: 0.72 };

export function paceMultiplier(pace: Pace, custom = 1) {
  if (pace === "custom") return Math.min(2.5, Math.max(0.4, custom));
  return PACE_MULTIPLIER[pace];
}

export const CHOICE_PROMPT_MS = 2000;
export const CHOICE_OPTION_MS = 800;
export const CHOICE_OR_MS = 450;
export const CHOICE_REVEAL_MS = 2400;
export const QUIZ_QUESTION_MS = 2200;
export const QUIZ_ANSWER_STAGGER_MS = 450;
export const QUIZ_REVEAL_MS = 2600;
export const LIST_TITLE_MS = 1800;
export const LIST_ITEM_MS = 2100;

export function typingDurationMs(text: string, multiplier = 1) {
  const base = 450 + text.length * 32;
  return Math.round(Math.min(2600, Math.max(900, base)) * multiplier);
}

export function holdDurationMs(text: string, multiplier = 1) {
  const base = 700 + text.length * 22;
  return Math.round(Math.min(2600, Math.max(900, base)) * multiplier);
}

export function narrationDurationMs(text: string, multiplier = 1) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(Math.max(1800, words * 380) * multiplier);
}

export function storyDurationMs(text: string, multiplier = 1) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(Math.max(4000, words * 330) * multiplier);
}

type Id = () => string;

export type FakeTextMessageInput = { sender: string; side: "left" | "right"; text: string; reaction?: string };

/** Sequential chat: each bubble waits for its typing indicator, then holds. */
export function buildFakeTextItems(messages: FakeTextMessageInput[], pace: Pace, nextId: Id, custom = 1): MessageItem[] {
  const multiplier = paceMultiplier(pace, custom);
  const items: MessageItem[] = [];
  let cursor = 600;
  messages.forEach((message, index) => {
    const typingMs = typingDurationMs(message.text, multiplier);
    const start = cursor + (index === 0 ? 0 : typingMs);
    const durationMs = holdDurationMs(message.text, multiplier);
    items.push({
      id: nextId(),
      type: "message",
      startMs: start,
      durationMs,
      side: message.side,
      sender: message.sender,
      text: message.text,
      reaction: message.reaction,
      receipt: message.side === "right" ? "read" : "none",
      typingMs,
      speechMs: 0,
    });
    cursor = start + durationMs;
  });
  return items;
}

export function choiceDurationMs(countdownSeconds: number) {
  return CHOICE_PROMPT_MS + CHOICE_OPTION_MS * 2 + CHOICE_OR_MS + countdownSeconds * 1000 + CHOICE_REVEAL_MS;
}

export function buildWouldRatherItems(
  rounds: Array<{ question: string; left: string; right: string; leftPercent: number }>,
  countdownSeconds: number,
  nextId: Id,
): ChoiceItem[] {
  let cursor = 0;
  return rounds.map((round) => {
    const durationMs = choiceDurationMs(countdownSeconds);
    const item: ChoiceItem = {
      id: nextId(),
      type: "choice",
      startMs: cursor,
      durationMs,
      question: round.question,
      left: round.left,
      right: round.right,
      leftPercent: Math.max(5, Math.min(95, Math.round(round.leftPercent))),
      simulatedPercent: true,
      countdownSeconds,
    };
    cursor += durationMs;
    return item;
  });
}

export function quizDurationMs(answerCount: number, countdownSeconds: number) {
  return QUIZ_QUESTION_MS + answerCount * QUIZ_ANSWER_STAGGER_MS + countdownSeconds * 1000 + QUIZ_REVEAL_MS;
}

export function buildQuizItems(
  questions: Array<{ question: string; answers: string[]; correctIndex: number; explanation: string }>,
  countdownSeconds: number,
  nextId: Id,
): QuizItem[] {
  let cursor = 0;
  return questions.map((question) => {
    const durationMs = quizDurationMs(question.answers.length, countdownSeconds);
    const item: QuizItem = {
      id: nextId(),
      type: "quiz",
      startMs: cursor,
      durationMs,
      question: question.question,
      answers: question.answers,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      countdownSeconds,
    };
    cursor += durationMs;
    return item;
  });
}

export function buildListItems(title: string, entries: Array<{ title: string; body: string }>, nextId: Id): Array<TitleItem | ListItem> {
  const items: Array<TitleItem | ListItem> = [];
  let cursor = 0;
  items.push({ id: nextId(), type: "title", startMs: cursor, durationMs: LIST_TITLE_MS, text: title });
  cursor += LIST_TITLE_MS;
  const total = entries.length;
  entries.forEach((entry, index) => {
    items.push({
      id: nextId(),
      type: "list-item",
      startMs: cursor,
      durationMs: LIST_ITEM_MS,
      rank: total - index,
      total,
      title: entry.title,
      body: entry.body,
    });
    cursor += LIST_ITEM_MS;
  });
  return items;
}

export function buildStoryItem(title: string, body: string, author: string, nextId: Id, multiplier = 1): StoryItem {
  return {
    id: nextId(),
    type: "story",
    startMs: 0,
    durationMs: storyDurationMs(body, multiplier),
    title,
    body,
    author: author || "u/anonymous",
    upvotes: 0,
    comments: 0,
  };
}

export function buildNarratedItems(scenes: Array<{ text: string }>, nextId: Id, multiplier = 1): NarrationItem[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const durationMs = narrationDurationMs(scene.text, multiplier);
    const item: NarrationItem = { id: nextId(), type: "narration", startMs: cursor, durationMs, text: scene.text };
    cursor += durationMs;
    return item;
  });
}

/**
 * Spreads words across a span proportionally to character length. Used for
 * generated scripts, where no speech recognizer has run. Captions from real
 * audio come from transcription instead and replace these.
 */
export function estimateWordTimings(text: string, startMs: number, endMs: number): CaptionWord[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length || endMs <= startMs) return [];
  const total = words.reduce((sum, word) => sum + word.length + 1, 0);
  let cursor = startMs;
  return words.map((word, index) => {
    const share = ((word.length + 1) / total) * (endMs - startMs);
    const start = cursor;
    cursor = index === words.length - 1 ? endMs : cursor + share;
    return { text: word, startMs: Math.round(start), endMs: Math.round(cursor) };
  });
}

/** Groups word-timed captions into pages. A page breaks on a pause or on the word limit. */
export function captionPages(words: CaptionWord[], wordsPerPage: number, pauseBreakMs = 900) {
  const pages: Array<{ words: CaptionWord[]; startMs: number; endMs: number }> = [];
  let current: CaptionWord[] = [];
  const limit = Math.max(1, Math.round(wordsPerPage));
  for (const word of words) {
    const last = current.at(-1);
    if (current.length && (current.length >= limit || (last && word.startMs - last.endMs > pauseBreakMs))) {
      pages.push({ words: current, startMs: current[0].startMs, endMs: current.at(-1)!.endMs });
      current = [];
    }
    current.push(word);
  }
  if (current.length) pages.push({ words: current, startMs: current[0].startMs, endMs: current.at(-1)!.endMs });
  return pages;
}

/** Restart item start times so the sequence is contiguous with no gaps. */
export function packSequence<T extends TimelineItem>(items: T[], gapMs = 0): T[] {
  let cursor = 0;
  return items.map((item) => {
    const next = { ...item, startMs: cursor };
    cursor += item.durationMs + gapMs;
    return next;
  });
}

/** Multiplies every item timing by a pace factor. Used when the user changes the pace preset. */
export function retimeItems<T extends TimelineItem>(items: T[], factor: number): T[] {
  return items.map((item) => ({
    ...item,
    startMs: Math.round(item.startMs * factor),
    durationMs: Math.max(100, Math.round(item.durationMs * factor)),
    ...(item.type === "message" ? { typingMs: Math.round(item.typingMs * factor) } : {}),
  }) as T);
}

export function itemsActiveAt(items: TimelineItem[], timeMs: number) {
  return items.filter((item) => timeMs >= item.startMs && timeMs < item.startMs + item.durationMs);
}

