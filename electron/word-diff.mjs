/**
 * Word-level diff between what was heard and what Clyra will insert, for the
 * pill's "fixing it up" animation: removed words are struck through, words Clyra
 * generated or corrected are shown in blue. Case/punctuation-only changes are
 * deliberately calm (shown as unchanged) so the animation highlights real edits.
 */
const MAX_WORDS = 90;

const normalise = (word) => word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** @returns {Array<{type: "same" | "del" | "add", text: string}> | null} null when too long to animate */
export function wordDiff(before, after) {
  const a = String(before || "").split(/\s+/).filter(Boolean);
  const b = String(after || "").split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || a.length > MAX_WORDS || b.length > MAX_WORDS) return null;
  const na = a.map(normalise);
  const nb = b.map(normalise);
  // Longest common subsequence on normalised words.
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = na[i] === nb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += ` ${text}`;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && na[i] === nb[j]) { push("same", b[j]); i += 1; j += 1; continue; }
    // Emit removals before additions so a replacement reads "old → new".
    if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { push("del", a[i]); i += 1; continue; }
    push("add", b[j]); j += 1;
  }
  return out;
}

/** True when the diff contains any visible edit. */
export const hasEdits = (diff) => Boolean(diff && diff.some((segment) => segment.type !== "same"));
