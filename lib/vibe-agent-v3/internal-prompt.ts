/* Marker for prompts Clyra injects into a coding session on the user's behalf
   — the recovery nudges sent when a provider ends a turn early.

   They have to be real user turns for the model to act on them, which means
   they come back through the transcript like anything else. The marker lets
   the transcript drop them, so the agent's own scaffolding is never shown to
   the person who asked for a habit tracker.

   The mark is plain ASCII on purpose. It was originally wrapped in U+2063
   INVISIBLE SEPARATOR so that a leak would at least be invisible — but the
   provider round-trip normalises those characters away, which broke the
   `startsWith` test AND left the bare word "clyra-internal" visible at the top
   of a real reply: the worst of both. Nothing in the detection path may now
   depend on a character that a transport is free to strip. */
export const INTERNAL_PROMPT_MARK = "[clyra:internal]";

/* The pre-2026-08 mark, kept only so sessions already on disk still filter. */
const LEGACY_MARK = "clyra-internal";

/* Leading whitespace and format/invisible characters are tolerated: a provider
   may trim, pad, or re-encode the head of a message, and none of that changes
   whether Clyra wrote it. */
const LEADING_NOISE = /^[\s\u200b-\u200f\u2060-\u2064\u202a-\u202e\ufeff]+/;

const head = (text: string) => text.replace(LEADING_NOISE, "");

export const internalPrompt = (text: string) => `${INTERNAL_PROMPT_MARK} ${text}`;

export const isInternalPrompt = (text: unknown): boolean => {
  if (typeof text !== "string" || text === "") return false;
  const start = head(text);
  return start.startsWith(INTERNAL_PROMPT_MARK) || start.startsWith(LEGACY_MARK);
};

/** Removes the mark from text that is about to be shown anyway.
 *
 *  Belt and braces: `isInternalPrompt` already drops these turns, but a future
 *  render path that forgets to ask should still never print the mark itself. */
export const stripInternalMark = (text: string): string => {
  const start = head(text);
  if (start.startsWith(INTERNAL_PROMPT_MARK)) return start.slice(INTERNAL_PROMPT_MARK.length).trimStart();
  if (start.startsWith(LEGACY_MARK)) return start.slice(LEGACY_MARK.length).trimStart();
  return text;
};
