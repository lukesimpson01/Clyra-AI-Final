const RESEARCH_PATTERNS: RegExp[] = [
  /\bwhat\s+is\b/i,
  /\bwhat\s+are\b/i,
  /\bwho\s+is\b/i,
  /\bwho\s+are\b/i,
  /\bwhen\s+(?:was|did|is|are)\b/i,
  /\bwhere\s+(?:is|are|was|were)\b/i,
  /\bhow\s+(?:many|much|old|long|does|do|did|is|are)\b/i,
  /\bwhy\s+(?:is|are|was|were|did|do|does)\b/i,
  /\bwhich\s+(?:is|are|was|were)\b/i,
  /\btell\s+me\s+about\b/i,
  /\bcan\s+you\s+(?:tell|explain|find|look\s+up|research)\b/i,
  /\blook\s+up\b/i,
  /\bresearch\b/i,
  /\bfind\s+out\b/i,
  /\bcurrent\s+(?:price|news|status|version)\b/i,
  /\blatest\s+(?:news|update|version|release)\b/i,
  /\bprice\s+of\b/i,
  /\bcompare\b.+\band\b/i,
  /\bis\s+it\s+true\b/i,
  /\bdefinition\s+of\b/i,
  /\bmeaning\s+of\b/i,
];

const SKIP_PATTERNS: RegExp[] = [
  /^\/vibe\b/i,
  /^\/clip\b/i,
  /\bwrite\s+(?:me\s+)?(?:a\s+)?(?:email|note|essay|story|poem|code)\b/i,
  /\b(?:rewrite|rephrase|fix|edit|summarize)\s+(?:this|the)\b/i,
  /\bhelp\s+me\s+(?:write|draft|create)\b/i,
];

export function needsWebResearch(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 8) return false;

  if (SKIP_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  if (trimmed.endsWith("?")) return true;

  return RESEARCH_PATTERNS.some((pattern) => pattern.test(trimmed));
}
