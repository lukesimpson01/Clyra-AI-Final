// Fake Text Story timeline engine. Pure functions only — no fetch, no DOM —
// so the exact same timing and scroll math run in the server's timeline-build
// step, the live editor preview, and the headless export page. The only
// non-deterministic input is real TTS audio duration, which the caller
// supplies per message (measured from the actual synthesized WAV) rather than
// estimated from character count, per the "entire sentence must finish
// speaking" requirement — a message's slot is sized to the real recording.
//
// Sequence per message: typing indicator -> bubble enters -> full TTS plays
// -> short pause -> (scroll, only if the stack now overflows the viewport)
// -> next message's typing. Scroll offset and which messages are on screen
// are both re-derivable from (messages, geometry, viewport) alone, so they
// are never stored on the item — the exact same `resolveFakeTextFrame` call
// in the editor preview and the export page always agrees.

import { outputSize, type FakeTextTheme, type FakeTextTypingDuration, type MessageItem, type ShortsAspect } from "./schema";

/** Must match ShortsCanvas's DESIGN_SHORT_SIDE — the fixed design-space width every layout number is computed against, independent of actual export resolution. */
export const DESIGN_WIDTH = 1080;
const BASE_FONT_PX = 34;
const BASE_LINE_HEIGHT_PX = 44;
const BASE_PADDING_Y_PX = 20;
const BASE_GAP_PX = 14;
const BASE_BOTTOM_PADDING_PX = 24;
const BUBBLE_MAX_WIDTH_FRACTION = 0.76;

/** Derives the chat geometry both the server timeline-build step and the live ShortsCanvas renderer use — one function so they can never disagree. */
export function geometryForFakeText(aspect: ShortsAspect, theme: FakeTextTheme) {
  const design = outputSize(aspect, DESIGN_WIDTH as 1080);
  const chatWidthPx = design.width * (theme.chatWidthPercent / 100);
  const viewportHeightPx = design.height * (theme.chatHeightPercent / 100);
  const geometry: BubbleGeometry = {
    maxWidthFraction: BUBBLE_MAX_WIDTH_FRACTION,
    chatWidthPx,
    fontSizePx: BASE_FONT_PX * theme.fontScale,
    lineHeightPx: BASE_LINE_HEIGHT_PX * theme.fontScale,
    paddingYPx: BASE_PADDING_Y_PX * theme.bubbleScale,
    gapPx: BASE_GAP_PX,
  };
  return { geometry, viewportHeightPx, bottomPaddingPx: BASE_BOTTOM_PADDING_PX, design };
}

export const BUBBLE_ENTER_MS = 220;
export const PAUSE_AFTER_SPEECH_MS = 220;
export const SCROLL_MIN_MS = 350;
export const SCROLL_MAX_MS = 550;
export const RESET_TRANSITION_MS = 320;
export const RESET_FADE_MS = 160;
export const OPEN_DELAY_MS = 400;
export const MAX_SCREENS_PER_SEGMENT = 2.4;

/** A believable typing-indicator duration from message length, capped so long messages don't stall the video. */
export function typingDurationMs(text: string, setting: FakeTextTypingDuration, customMs: number, multiplier = 1): number {
  if (setting === "0.5") return Math.round(500 * multiplier);
  if (setting === "1") return Math.round(1000 * multiplier);
  if (setting === "2") return Math.round(2000 * multiplier);
  if (setting === "custom") return Math.round(Math.min(4000, Math.max(200, customMs)) * multiplier);
  const base = 450 + text.length * 28;
  return Math.round(Math.min(2200, Math.max(500, base)) * multiplier);
}

export type FakeTextScriptMessage = {
  id: string;
  side: "left" | "right";
  sender: string;
  text: string;
  reaction?: string;
  voice?: string;
  mediaAsset?: string;
};

/**
 * Greedy word-wrap line count at a design-space bubble width. Used only to
 * decide WHEN the growing chat needs to scroll or reset — never to crop or
 * resize actual text, which always renders at full size and wraps for real
 * in the DOM. The per-character width is intentionally generous (errs wide)
 * so this never UNDER-counts lines, which would cut off a bubble on screen.
 */
export function estimateBubbleLines(text: string, maxWidthPx: number, fontSizePx: number): number {
  const avgCharWidth = fontSizePx * 0.58;
  const maxChars = Math.max(1, Math.floor(maxWidthPx / avgCharWidth));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1;
  let lineLen = 0;
  for (const word of words) {
    const wordLen = word.length;
    if (lineLen === 0) {
      lineLen = wordLen;
    } else if (lineLen + 1 + wordLen <= maxChars) {
      lineLen += 1 + wordLen;
    } else {
      lines += 1;
      lineLen = wordLen;
    }
    while (lineLen > maxChars) {
      lines += 1;
      lineLen -= maxChars;
    }
  }
  return Math.max(1, lines);
}

export type BubbleGeometry = {
  /** Bubble max-width as a fraction of the chat column width (iMessage-style, ~0.74). */
  maxWidthFraction: number;
  chatWidthPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  paddingYPx: number;
  gapPx: number;
};

export function estimateBubbleHeightPx(text: string, geometry: BubbleGeometry): number {
  const bubbleWidth = geometry.chatWidthPx * geometry.maxWidthFraction - 2 * 18;
  const lines = estimateBubbleLines(text, bubbleWidth, geometry.fontSizePx);
  return Math.round(lines * geometry.lineHeightPx + geometry.paddingYPx * 2);
}

export type FakeTextSegmentPlan = {
  /** Index into the full ordered message list of the first message in this segment. */
  startIndex: number;
  endIndex: number;
};

/**
 * Splits the full ordered message list into "segments" — runs of messages
 * that stay on one continuous chat screen before the conversation clears and
 * continues from the top. A segment breaks once its cumulative bubble height
 * would exceed the configured budget (expressed as a multiple of the visible
 * chat viewport height), which is what keeps a long story from turning into
 * an unreadable sliver of scrolled-up text — once it's full, the chat clears
 * and keeps going rather than scrolling forever.
 */
export function planFakeTextSegments(
  messages: FakeTextScriptMessage[],
  geometry: BubbleGeometry,
  viewportHeightPx: number,
  maxScreensPerSegment = MAX_SCREENS_PER_SEGMENT,
): FakeTextSegmentPlan[] {
  const budget = viewportHeightPx * maxScreensPerSegment;
  const segments: FakeTextSegmentPlan[] = [];
  let startIndex = 0;
  let stackHeight = 0;
  messages.forEach((message, index) => {
    const height = estimateBubbleHeightPx(message.text, geometry) + geometry.gapPx;
    if (stackHeight > 0 && stackHeight + height > budget) {
      segments.push({ startIndex, endIndex: index });
      startIndex = index;
      stackHeight = 0;
    }
    stackHeight += height;
  });
  segments.push({ startIndex, endIndex: messages.length });
  return segments;
}

/** Cumulative scroll offset once messages [segment.startIndex, uptoIndex) are stacked in the viewport. */
function scrollOffsetForCount(
  messages: FakeTextScriptMessage[],
  segment: FakeTextSegmentPlan,
  uptoIndex: number,
  geometry: BubbleGeometry,
  viewportHeightPx: number,
  bottomPaddingPx: number,
): number {
  let stackHeight = 0;
  for (let i = segment.startIndex; i < uptoIndex && i < segment.endIndex; i += 1) {
    stackHeight += estimateBubbleHeightPx(messages[i].text, geometry) + geometry.gapPx;
  }
  return Math.max(0, stackHeight - viewportHeightPx + bottomPaddingPx);
}

export type SpeechDuration = { ms: number; placeholder: boolean };

export type FakeTextTimelineOptions = {
  typingEnabled: boolean;
  typingDuration: FakeTextTypingDuration;
  typingDurationCustomMs: number;
  paceMultiplier: number;
  geometry: BubbleGeometry;
  viewportHeightPx: number;
  bottomPaddingPx: number;
  maxScreensPerSegment?: number;
};

/**
 * Builds the authoritative MessageItem[] timeline: typing -> bubble-enter ->
 * full TTS playback -> short pause -> scroll window (only when the stack now
 * overflows the viewport) -> next message. Strictly sequential, never
 * overlapping. Real per-message audio duration (ms) must be supplied by the
 * caller (from measuring the synthesized speech), not estimated, so the full
 * sentence always finishes before the conversation advances.
 */
export function buildFakeTextTimeline(messages: FakeTextScriptMessage[], speechDurations: Map<string, SpeechDuration>, options: FakeTextTimelineOptions): MessageItem[] {
  const segments = planFakeTextSegments(messages, options.geometry, options.viewportHeightPx, options.maxScreensPerSegment);
  const items: MessageItem[] = [];
  let cursor = OPEN_DELAY_MS;
  let segmentIndex = 0;

  messages.forEach((message, index) => {
    if (segmentIndex < segments.length - 1 && index === segments[segmentIndex].endIndex) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const isSegmentStart = segment.startIndex === index;
    if (isSegmentStart && index > 0) cursor += RESET_TRANSITION_MS;

    const typingMs = options.typingEnabled ? typingDurationMs(message.text, options.typingDuration, options.typingDurationCustomMs, options.paceMultiplier) : 0;
    cursor += typingMs;
    const startMs = cursor;
    const speech = speechDurations.get(message.id) ?? { ms: 0, placeholder: true };
    const speechMs = speech.ms;
    const pauseMs = Math.round(PAUSE_AFTER_SPEECH_MS * options.paceMultiplier);

    const before = scrollOffsetForCount(messages, segment, index, options.geometry, options.viewportHeightPx, options.bottomPaddingPx);
    const after = scrollOffsetForCount(messages, segment, index + 1, options.geometry, options.viewportHeightPx, options.bottomPaddingPx);
    const scrollNeeded = after - before;
    const scrollMs = scrollNeeded > 1 ? Math.round(Math.min(SCROLL_MAX_MS, Math.max(SCROLL_MIN_MS, SCROLL_MIN_MS + scrollNeeded * 0.6)) * options.paceMultiplier) : 0;

    const durationMs = BUBBLE_ENTER_MS + speechMs + pauseMs + scrollMs;
    items.push({
      id: message.id,
      type: "message",
      startMs,
      durationMs,
      side: message.side,
      sender: message.sender,
      text: message.text,
      reaction: message.reaction,
      receipt: message.side === "right" ? "read" : "none",
      typingMs,
      speechMs,
      ...(message.voice ? { voice: message.voice } : {}),
      ...(message.mediaAsset ? { mediaAsset: message.mediaAsset } : {}),
    });
    cursor = startMs + durationMs;
  });
  return items;
}

function easeScroll(p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  return 1 - Math.pow(1 - clamped, 3);
}

export type FakeTextFrame = {
  segmentIndex: number;
  /** Messages currently on screen, oldest first, already past their bubble-enter start time. */
  visible: Array<{ message: FakeTextScriptMessage; item: MessageItem; enterProgress: number }>;
  typing: { side: "left" | "right" } | null;
  scrollOffsetPx: number;
  /** 0 = fully settled on the current segment; ramps 0->1 then back as a reset transition fades the old segment away. */
  resetFadeOut: number;
};

/**
 * Resolves what the chat looks like at an arbitrary timeMs, given the
 * already-timed items. Re-derives segments and scroll offsets from the same
 * pure functions the builder used, so this never drifts from how the
 * timeline was actually laid out — called once per rendered frame by
 * ShortsCanvas, in both the live preview and the export capture loop.
 */
export function resolveFakeTextFrame(items: MessageItem[], timeMs: number, geometry: BubbleGeometry, viewportHeightPx: number, bottomPaddingPx: number, maxScreensPerSegment = MAX_SCREENS_PER_SEGMENT): FakeTextFrame {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs);
  const messages: FakeTextScriptMessage[] = sorted.map((item) => ({ id: item.id, side: item.side, sender: item.sender, text: item.text, reaction: item.reaction, voice: item.voice, mediaAsset: item.mediaAsset }));
  const segments = planFakeTextSegments(messages, geometry, viewportHeightPx, maxScreensPerSegment);

  if (!sorted.length) return { segmentIndex: 0, visible: [], typing: null, scrollOffsetPx: 0, resetFadeOut: 0 };

  // Which segment is "current": the latest one whose fade-in point has passed.
  let activeSegmentIndex = 0;
  for (let s = 0; s < segments.length; s += 1) {
    const firstItem = sorted[segments[s].startIndex];
    const fadeStart = s === 0 ? 0 : firstItem.startMs - firstItem.typingMs - RESET_TRANSITION_MS;
    if (timeMs >= fadeStart) activeSegmentIndex = s;
  }
  const segment = segments[activeSegmentIndex];
  const segmentItems = sorted.slice(segment.startIndex, segment.endIndex);

  // Reset fade: only meaningful right before the active segment's own first message, fading the PREVIOUS segment out.
  let resetFadeOut = 0;
  if (activeSegmentIndex > 0) {
    const firstItem = sorted[segment.startIndex];
    const fadeStart = firstItem.startMs - firstItem.typingMs - RESET_TRANSITION_MS;
    const fadeEnd = fadeStart + RESET_FADE_MS;
    if (timeMs >= fadeStart && timeMs < fadeEnd) resetFadeOut = easeScroll((timeMs - fadeStart) / RESET_FADE_MS);
    else if (timeMs >= fadeEnd && timeMs < firstItem.startMs - firstItem.typingMs) resetFadeOut = 1;
  }

  const visible = segmentItems
    .filter((item) => timeMs >= item.startMs)
    .map((item) => ({
      message: { id: item.id, side: item.side, sender: item.sender, text: item.text, reaction: item.reaction, voice: item.voice, mediaAsset: item.mediaAsset },
      item,
      enterProgress: Math.min(1, Math.max(0, (timeMs - item.startMs) / BUBBLE_ENTER_MS)),
    }));

  const typingItem = segmentItems.find((item) => timeMs >= item.startMs - item.typingMs && timeMs < item.startMs && item.typingMs > 0);
  const typing = typingItem ? { side: typingItem.side } : null;

  // Scroll offset: settled at the count of fully-visible messages, but interpolated across the most recent message's scroll window so the motion is smooth, not a snap.
  const visibleCount = visible.length;
  const target = scrollOffsetForCount(messages, segment, segment.startIndex + visibleCount, geometry, viewportHeightPx, bottomPaddingPx);
  let scrollOffsetPx = target;
  const lastVisible = visible.at(-1);
  if (lastVisible) {
    const prevOffset = scrollOffsetForCount(messages, segment, segment.startIndex + visibleCount - 1, geometry, viewportHeightPx, bottomPaddingPx);
    if (Math.abs(target - prevOffset) > 1) {
      const scrollStart = lastVisible.item.startMs + BUBBLE_ENTER_MS + lastVisible.item.speechMs + PAUSE_AFTER_SPEECH_MS;
      const scrollEnd = lastVisible.item.startMs + lastVisible.item.durationMs;
      if (timeMs < scrollStart) scrollOffsetPx = prevOffset;
      else if (timeMs < scrollEnd) scrollOffsetPx = prevOffset + (target - prevOffset) * easeScroll((timeMs - scrollStart) / Math.max(1, scrollEnd - scrollStart));
    }
  }

  return { segmentIndex: activeSegmentIndex, visible, typing, scrollOffsetPx, resetFadeOut };
}
