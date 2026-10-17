const KEY = "clyra-personal-dictionary";
export function personalDictionary(): string[] { try { return JSON.parse(localStorage.getItem(KEY) || "[]").filter((v: unknown) => typeof v === "string").slice(0, 250); } catch { return []; } }
export function savePersonalDictionary(words: string[]) { localStorage.setItem(KEY, JSON.stringify([...new Set(words.map((w) => w.trim()).filter(Boolean))].slice(0, 250))); }
export function applyDictionary(text: string, words = personalDictionary()) {
  return words.reduce((out, word) => out.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "gi"), word), text);
}

/** Safe offline cleanup; deliberately avoids changing wording or facts. */
export function localDictationCleanup(input: string) {
  return input.replace(/\b(?:um+|uh+)\b[\s,]*/gi, "").replace(/\b(\w+)(\s+\1\b)+/gi, "$1").replace(/\bnew paragraph\b/gi, "\n\n").replace(/\bnew line\b/gi, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s{2,}/g, " ").trim();
}
