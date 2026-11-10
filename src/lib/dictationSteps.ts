/** The visible stages of a dictation, as tool-call style rows: what Clyra is doing, and what it found. */
export type DictationStepId = "listen" | "endpoint" | "transcribe" | "fix" | "polish";
export type DictationStepState = "active" | "done" | "skipped" | "failed";
export interface DictationStep {
  id: DictationStepId;
  label: string;
  state: DictationStepState;
  /** Short result shown beside the label: "6.2s", "0.8s · Parakeet", "removed 2 fillers". */
  detail?: string;
}

const FILLER = /(?:^|\s)(?:u+m+|u+h+|e+r+m*|ah+m+|h+m+)(?=[\s,.;:!?]|$)/gi;

/** What the tidy-up changed, in words, from the raw transcript and the cleaned text. */
export function summarizeFix(raw: string, cleaned: string): string {
  const fillers = (raw.match(FILLER) ?? []).length;
  const parts: string[] = [];
  if (fillers) parts.push(`removed ${fillers} filler${fillers === 1 ? "" : "s"}`);
  const rawWords = raw.trim().split(/\s+/).length;
  const cleanWords = cleaned.trim().split(/\s+/).length;
  if (/\b(no wait|actually|make that|i mean|scratch that)\b/i.test(raw) && cleanWords < rawWords - fillers) parts.push("fixed a correction");
  if (/^[a-z]/.test(raw) && /^[A-Z0-9]/.test(cleaned)) parts.push("capitalised");
  if (!/[.!?]$/.test(raw.trim()) && /[.!?]$/.test(cleaned.trim())) parts.push("added punctuation");
  return parts.join(" · ") || "no changes needed";
}
