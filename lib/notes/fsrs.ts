/* FSRS-4.5 spaced repetition scheduler.

   Chosen over SM-2 because the study features are meant to schedule real
   revision: FSRS models stability and difficulty separately, so a card the
   student keeps failing stops drifting out to month-long intervals. */

export type Rating = 1 | 2 | 3 | 4;          // again | hard | good | easy
export type CardState = 0 | 1 | 2 | 3;       // new | learning | review | relearning

export type SchedulerCard = {
  state: CardState;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  due_at: string | null;
  last_review: string | null;
};

export type Scheduled = {
  state: CardState;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  due_at: string;
  last_review: string;
  interval_days: number;
  elapsed_days: number;
};

/* Published FSRS-4.5 default weights. Kept as one array so a future
   optimiser can replace them wholesale from a user's own review log. */
export const DEFAULT_WEIGHTS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031,
  1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];

const DECAY = -0.5;
const FACTOR = 19 / 81;
const MAX_INTERVAL = 3650;
/* Cards rated Again come back in ten minutes rather than a day: the whole
   point of a lapse is another attempt inside the same study session. */
const RELEARN_MINUTES = 10;
const LEARN_MINUTES = 5;

const clampDifficulty = (value: number) => Math.min(10, Math.max(1, value));
const clampStability = (value: number) => Math.max(0.01, value);

export const retrievability = (elapsedDays: number, stability: number) =>
  stability <= 0 ? 0 : Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);

const intervalFor = (stability: number, requestRetention: number) =>
  Math.min(
    MAX_INTERVAL,
    Math.max(1, Math.round((stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1))),
  );

const initialDifficulty = (w: number[], rating: Rating) =>
  clampDifficulty(w[4]! - (rating - 3) * w[5]!);

const nextDifficulty = (w: number[], difficulty: number, rating: Rating) => {
  const next = difficulty - w[6]! * (rating - 3);
  /* Mean reversion towards the difficulty a "good" first answer implies,
     which stops long streaks from pinning difficulty at either extreme. */
  return clampDifficulty(w[7]! * initialDifficulty(w, 3) + (1 - w[7]!) * next);
};

const stabilityAfterRecall = (
  w: number[], difficulty: number, stability: number, r: number, rating: Rating,
) => {
  const hardPenalty = rating === 2 ? w[15]! : 1;
  const easyBonus = rating === 4 ? w[16]! : 1;
  return clampStability(
    stability *
      (1 +
        Math.exp(w[8]!) *
          (11 - difficulty) *
          Math.pow(stability, -w[9]!) *
          (Math.exp((1 - r) * w[10]!) - 1) *
          hardPenalty *
          easyBonus),
  );
};

const stabilityAfterLapse = (w: number[], difficulty: number, stability: number, r: number) =>
  clampStability(
    w[11]! *
      Math.pow(difficulty, -w[12]!) *
      (Math.pow(stability + 1, w[13]!) - 1) *
      Math.exp((1 - r) * w[14]!),
  );

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, (to.getTime() - from.getTime()) / 86_400_000);

const toSql = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

const parseSql = (value: string | null) => {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
};

export function schedule(
  card: SchedulerCard,
  rating: Rating,
  options: { now?: Date; requestRetention?: number; weights?: number[] } = {},
): Scheduled {
  const w = options.weights?.length === DEFAULT_WEIGHTS.length ? options.weights : DEFAULT_WEIGHTS;
  const requestRetention = options.requestRetention ?? 0.9;
  const now = options.now ?? new Date();
  const last = parseSql(card.last_review);
  const elapsedDays = last ? daysBetween(last, now) : 0;

  let { stability, difficulty } = card;
  let state: CardState = card.state;
  let lapses = card.lapses;

  if (state === 0 || stability <= 0) {
    stability = clampStability(w[rating - 1]!);
    difficulty = initialDifficulty(w, rating);
    state = rating === 1 ? 1 : 2;
  } else {
    const r = retrievability(elapsedDays, stability);
    difficulty = nextDifficulty(w, difficulty, rating);
    if (rating === 1) {
      stability = stabilityAfterLapse(w, difficulty, stability, r);
      lapses += 1;
      state = 3;
    } else {
      stability = stabilityAfterRecall(w, difficulty, stability, r, rating);
      state = 2;
    }
  }

  let due: Date;
  let intervalDays: number;
  if (rating === 1) {
    intervalDays = RELEARN_MINUTES / (60 * 24);
    due = new Date(now.getTime() + RELEARN_MINUTES * 60_000);
  } else if (state === 1) {
    intervalDays = LEARN_MINUTES / (60 * 24);
    due = new Date(now.getTime() + LEARN_MINUTES * 60_000);
  } else {
    intervalDays = intervalFor(stability, requestRetention);
    due = new Date(now.getTime() + intervalDays * 86_400_000);
  }

  return {
    state,
    stability,
    difficulty,
    reps: card.reps + 1,
    lapses,
    due_at: toSql(due),
    last_review: toSql(now),
    interval_days: intervalDays,
    elapsed_days: elapsedDays,
  };
}

/* Interval each button would produce, so the study screen can label the
   answer buttons honestly instead of showing four identical choices. */
export function previewIntervals(card: SchedulerCard, options: { now?: Date } = {}) {
  return ([1, 2, 3, 4] as Rating[]).reduce<Record<Rating, number>>((out, rating) => {
    out[rating] = schedule(card, rating, options).interval_days;
    return out;
  }, {} as Record<Rating, number>);
}

export const formatInterval = (days: number) => {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
};
