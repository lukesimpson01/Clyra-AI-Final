/** Lightweight, deterministic routing guards used before Chat invokes a
 * costly external research path. They deliberately favour a direct answer
 * whenever freshness is not explicit. */
export function extractYoutubeUrl(text: string): string | null {
  const match = text.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[\w\-?=&%.]+/i,
  );
  if (!match?.[0]) return null;
  return match[0].startsWith("http") ? match[0] : `https://${match[0]}`;
}

export function looksLikeWebSearchQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const expression = t.replace(/^(?:what(?:'s| is)?|calculate|solve)\s+/i, "").replace(/[?=]/g, "").trim();
  if (/^[\d\s+\-*/×x().,]+$/i.test(expression) && /\d/.test(expression)) return false;
  const youtube = extractYoutubeUrl(t);
  const query = youtube ? t.replace(youtube, "").trim() : t;
  if (!query) return false;
  return /^(?:search|look\s*up|find|research|google)\b/i.test(query)
    || /\b(?:search the web|look online|from the (?:web|internet)|web search)\b/i.test(query)
    || /\b(?:latest|current|today'?s|this week'?s|breaking)\b.+\b(?:news|price|score|release|update|headline)s?\b/i.test(query)
    || /^(?:what(?:'| i)?s|who is|when (?:did|is|was)|how many)\b.+\b(?:latest|current|today|this week|news|price|score|release|update|headline|ceo|president)\b/i.test(query);
}

export function wantsYoutubeAndWebSearch(text: string): boolean {
  return Boolean(extractYoutubeUrl(text)) && looksLikeWebSearchQuery(text);
}
