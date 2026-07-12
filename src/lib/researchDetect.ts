export type ResearchIntent =
  | { kind: "none" }
  | { kind: "web" }
  | { kind: "youtube"; videoUrl?: string };

const YOUTUBE_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

const YOUTUBE_INTENT_RE =
  /\b(?:analy[sz]e|summari[sz]e|review|explain|break\s+down|tell\s+me\s+about)\b.{0,40}\b(?:youtube|yt)\b/i;

const VIDEO_INTENT_RE =
  /\b(?:analy[sz]e|summari[sz]e|review|explain|break\s+down)\b.{0,30}\b(?:this|the)\s+video\b/i;

const WEB_RESEARCH_PATTERNS: RegExp[] = [
  /\bwhat\s+is\s+(?:the\s+)?[A-Z][\w-]+/,
  /\bwhat\s+are\s+(?:the\s+)?[A-Z][\w-]+/,
  /\bwho\s+is\s+[A-Z]/,
  /\bwho\s+are\s+[A-Z]/,
  /\bwhen\s+(?:was|did)\s+[A-Z]/,
  /\bwhere\s+(?:is|are)\s+[A-Z]/,
  /\blatest\s+(?:news|update|version|release)\b/i,
  /\bcurrent\s+(?:price|news|status|version)\b/i,
  /\bprice\s+of\b/i,
  /\bnews\s+about\b/i,
  /\btell\s+me\s+about\s+[A-Z]/,
  /\bcan\s+you\s+(?:research|look\s+up|find\s+out)\b/i,
  /\blook\s+up\b/i,
  /\bresearch\b/i,
  /\bfind\s+out\s+(?:about|if|what|who|when)\b/i,
  /\bdefinition\s+of\b/i,
  /\bmeaning\s+of\b/i,
  /\bis\s+it\s+true\s+that\b/i,
];

const SKIP_PATTERNS: RegExp[] = [
  /^\/vibe\b/i,
  /^\/clip\b/i,
  /\bwrite\s+(?:me\s+)?(?:a\s+)?(?:email|note|essay|story|poem|code|function|script)\b/i,
  /\b(?:rewrite|rephrase|fix|edit|proofread)\s+(?:this|the)\b/i,
  /\bhelp\s+me\s+(?:write|draft|create|brainstorm)\b/i,
  /^(?:hi|hello|hey|thanks|thank you|good\s+(?:morning|afternoon|evening|night)|how\s+are\s+you)\b/i,
  /\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh)\b/i,
  /\b(?:how\s+are\s+you|what'?s\s+up|nice\s+to\s+meet)\b/i,
];

const MATH_PATTERNS: RegExp[] = [
  /\b\d+\s*[\+\-\*\/\^×÷]\s*\d+/,
  /\b\d+\s*%\s*of\s*\d+/,
  /\b(?:solve|calculate|compute|simplify|factor|integrate|differentiate|derivative|equation|algebra|geometry|trigonometry|quadratic|polynomial|matrix|vector)\b/i,
  /\bwhat\s+is\s+\d/,
  /\bhow\s+many\b.{0,30}\b(?:apples|oranges|coins|balls|marbles|students|items|miles|hours)\b/i,
  /\b(?:plus|minus|times|divided\s+by|square\s+root|cube\s+root)\b/i,
  /\b\d+\s*(?:\+|-|\*|\/)\s*\d+/,
];

const CONVERSATIONAL_QUESTION_RE =
  /^(?:how\s+are\s+you|what\s+can\s+you\s+do|who\s+are\s+you|can\s+you\s+help\s+me|what\s+should\s+i\s+do)\??$/i;

function extractYoutubeUrl(query: string): string | undefined {
  const match = query.match(YOUTUBE_URL_RE);
  return match?.[0];
}

function hasProperNounSignal(query: string): boolean {
  return /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(query) || /\b[A-Z]{2,}[\w-]*\b/.test(query);
}

function isMathQuery(query: string): boolean {
  return MATH_PATTERNS.some((pattern) => pattern.test(query));
}

function looksLikeFactualWhatIs(query: string): boolean {
  if (!/\bwhat\s+is\b/i.test(query)) return false;
  if (isMathQuery(query)) return false;
  const tail = query.replace(/^.*?\bwhat\s+is\s+(?:the\s+)?/i, "").trim();
  if (tail.length < 3) return false;
  if (
    /\b(ai|llm|gpt|claude|gemini|fable|opus|api|sdk|framework|browser|model|tool|platform|startup|company|product)\b/i.test(
      query,
    )
  ) {
    return true;
  }
  if (/\d/.test(tail)) return true;
  if (hasProperNounSignal(query)) return true;
  return tail.split(/\s+/).length >= 2;
}

export function detectResearchIntent(query: string): ResearchIntent {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 6) return { kind: "none" };

  if (SKIP_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: "none" };
  }

  if (CONVERSATIONAL_QUESTION_RE.test(trimmed)) {
    return { kind: "none" };
  }

  const youtubeUrl = extractYoutubeUrl(trimmed);
  if (
    youtubeUrl ||
    YOUTUBE_INTENT_RE.test(trimmed) ||
    VIDEO_INTENT_RE.test(trimmed) ||
    (/\byoutube\b/i.test(trimmed) && /\b(?:video|watch|channel)\b/i.test(trimmed))
  ) {
    return { kind: "youtube", videoUrl: youtubeUrl };
  }

  if (isMathQuery(trimmed)) {
    return { kind: "none" };
  }

  if (looksLikeFactualWhatIs(trimmed)) {
    return { kind: "web" };
  }

  if (WEB_RESEARCH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { kind: "web" };
  }

  if (trimmed.endsWith("?")) {
    const factualQuestion =
      /\b(?:what|who|when|where|which|why|how\s+many|how\s+much|is\s+it\s+true)\b/i.test(trimmed) &&
      (hasProperNounSignal(trimmed) ||
        /\b(?:news|price|release|version|company|product|ceo|president|country|city|ai|api)\b/i.test(trimmed));
    if (factualQuestion) {
      return { kind: "web" };
    }
    return { kind: "none" };
  }

  return { kind: "none" };
}

/** @deprecated use detectResearchIntent */
export function needsWebResearch(query: string): boolean {
  return detectResearchIntent(query).kind === "web";
}

export function needsYoutubeResearch(query: string): boolean {
  return detectResearchIntent(query).kind === "youtube";
}
