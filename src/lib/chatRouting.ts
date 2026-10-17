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
    || /^(?:what(?:'| i)?s|who is|when (?:did|is|was)|how many)\b.+\b(?:latest|current|today|this week|news|price|score|release|update|headline|ceo|president)\b/i.test(query)
    // Current recommendations, availability, public documentation, and a
    // time-sensitive event are more useful when grounded in live sources.
    || /\b(?:recommend|recommendation|best|compare|comparison|review|reviews|available|availability|near me|opening hours?|schedule|roadmap|documentation|docs|release notes?|changelog|announced?|happened)\b/i.test(query)
    || /\b(?:weather|forecast|temperature|traffic|stock|share price|exchange rate|market cap|election|results?|standings?|fixture|game|match|concert|flight|restaurant)\b/i.test(query);
}

/** The live-search state should describe the work, never repeat the person's
 * prompt back to them. The query is still sent to the research service. */
export function webSearchProgressLabel(_text: string): string {
  return "Finding current sources";
}

export function wantsYoutubeAndWebSearch(text: string): boolean {
  return Boolean(extractYoutubeUrl(text)) && looksLikeWebSearchQuery(text);
}
