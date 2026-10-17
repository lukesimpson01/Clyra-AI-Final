/**
 * Deterministic intent predicates used by Chat's send path. They decide which
 * surface a message belongs to (weather, map, Clyra Code), so they are pure
 * string functions with no React dependency and are covered by
 * tools/chat-intent-unit-tests.ts.
 */

export function looksLikeWeatherQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return (
    /\b(?:weather|forecast|temperature|humidity|precip(?:itation)?|how\s+(?:hot|cold|warm)|is it\s+(?:raining|snowing)|will it\s+rain)\b/i.test(
      t,
    ) || /^(?:what(?:'| i)?s|how(?:'| i)?s)\s+the\s+weather\b/i.test(t)
  );
}

export function extractWeatherLocation(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/^\/(?:weather|forecast)\s*/i, "")
    .trim();
  const patterns = [
    /\b(?:weather|forecast|temperature)\s+(?:in|for|at|near)\s+(.+?)(?:\?|$)/i,
    /\b(?:in|for|at|near)\s+([A-Za-z][A-Za-z0-9 .,'-]{1,80})(?:\?|$)/i,
    // A bare "whole string is a place name" fallback — only valid when the
    // text doesn't itself read like a generic weather question ("what's the
    // weather like", "is it raining"), otherwise phrases like "what's" get
    // geocoded as if they were a place. Reserved for a direct reply such as
    // "Tokyo" to a "which location?" prompt.
    /^([A-Za-z][A-Za-z0-9 .,'-]{1,80})$/,
  ];
  for (const [index, pattern] of patterns.entries()) {
    if (index === patterns.length - 1 && looksLikeWeatherQuery(cleaned)) continue;
    const match = cleaned.match(pattern);
    const loc = match?.[1]?.trim().replace(/[?.!]+$/, "").trim();
    if (!loc) continue;
    if (/^(?:the weather|weather|forecast|today|now|please)$/i.test(loc)) {
      continue;
    }
    if (loc.length < 2) continue;
    return loc;
  }
  return null;
}

export function looksLikeLocationQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeWeatherQuery(t)) return false;
  if (/^\/maps?\b/i.test(t)) return true;
  if (/\bwhere\s+am\s+i\b/i.test(t)) return true;
  return /\b(?:where\s+is|where'?s|show\s+(?:me\s+)?(?:a\s+)?map|map\s+of|directions?\s+to|location\s+of)\b/i.test(t)
    || /\bshow\s+.+\s+on\s+(?:a|the)\s+map\b/i.test(t)
    // "Show me where the Sydney Opera House is." asks for a place by its
    // position. Only a trailing "is/are" counts, so "show me where the bug is
    // in my code" stays a normal question.
    || /\bshow\s+(?:me\s+)?where\s+.+\s+(?:is|are)\s*[.?!]*\s*$/i.test(t);
}

export function isAskingForCurrentLocation(text: string): boolean {
  const t = text.trim();
  return /^\/maps?\s*$/i.test(t) || /\bwhere\s+am\s+i\b/i.test(t) || /\bmy\s+(?:current\s+)?location\b/i.test(t);
}

export function extractLocationQuery(text: string): string | null {
  const cleaned = text.trim().replace(/^\/maps?\s*/i, "").trim();
  const patterns = [
    /\bshow\s+(?:me\s+)?where\s+(.+?)\s+(?:is|are)\s*[.?!]*\s*$/i,
    /\bwhere'?s\s+(.+?)(?:\?|$)/i,
    /\bwhere\s+is\s+(.+?)(?:\?|$)/i,
    /\bshow\s+(?:me\s+)?(?:a\s+)?map\s+of\s+(.+?)(?:\?|$)/i,
    /\bmap\s+of\s+(.+?)(?:\?|$)/i,
    /\blocation\s+of\s+(.+?)(?:\?|$)/i,
    /\bdirections?\s+to\s+(.+?)(?:\?|$)/i,
    /\bshow\s+(.+?)\s+on\s+(?:a|the)\s+map\b/i,
    // Bare "whole string is a place" fallback, same guard rationale as
    // extractWeatherLocation — only when it doesn't itself read like a
    // generic maps question.
    /^([A-Za-z][A-Za-z0-9 .,'-]{1,80})$/,
  ];
  for (const [index, pattern] of patterns.entries()) {
    if (index === patterns.length - 1 && looksLikeLocationQuery(cleaned)) continue;
    const match = cleaned.match(pattern);
    let loc = match?.[1]?.trim().replace(/[?.!]+$/, "").trim();
    if (!loc) continue;
    if (/^(?:the map|map|here|there|me|my location)$/i.test(loc)) continue;
    // A leading article ("the Eiffel Tower") reads naturally in English but
    // throws off landmark search relevance ranking — "Eiffel Tower" alone
    // correctly ranks the famous Paris one first; keeping "the" attached
    // instead surfaces obscure same-named replicas.
    loc = loc.replace(/^(?:the|a|an)\s+/i, "").trim();
    if (loc.length < 2) continue;
    return loc;
  }
  return null;
}

/**
 * Whether a message is a request to build or repair a software project, and so
 * belongs in Clyra Code (Vibe Coder). It needs an action verb together with a
 * project-like object. A technology name on its own never counts: "a guide to
 * learning TypeScript" is writing, not a project to create.
 */
export function isVibeBuildRequest(prompt: string): boolean {
  const text = prompt.trim().toLowerCase();
  if (!text) return false;
  const projectAction =
    /\b(?:fix|debug|refactor|lint|compile|resolve|patch|migrate|production-ready)\b/.test(text) &&
    /\b(?:app|apps|project|repo|repository|codebase|bugs?|errors?|features?|build|dependenc(?:y|ies)|compiler|typecheck|tests?|functions?|components?|modules?|files?|scripts?)\b/.test(text);
  const creation = /\b(?:make|create|design|build|scaffold)\s+(?:me\s+)?(?:an?\s+)?(?:web\s+app|website|landing\s+page|dashboard|prototype|mobile\s+app|game)\b/.test(text);
  return projectAction || creation;
}
