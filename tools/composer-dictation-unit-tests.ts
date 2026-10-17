import assert from "node:assert/strict";
import {
  appendDictatedText,
  canStartDictation,
  DICTATION_HOLD_THRESHOLD_MS,
  formatDictationElapsed,
  isDictationHold,
  isDictationSessionOpen,
} from "../src/lib/composerDictation";

// Tap vs press-and-hold: a press shorter than the threshold is a tap (toggle).
assert.equal(isDictationHold(0, DICTATION_HOLD_THRESHOLD_MS - 1), false);
assert.equal(isDictationHold(0, DICTATION_HOLD_THRESHOLD_MS), true);
assert.equal(isDictationHold(1_000, 3_500), true);

// Recovery: an error must not block the next attempt, but busy phases must.
assert.equal(canStartDictation("idle"), true);
assert.equal(canStartDictation("error"), true);
assert.equal(canStartDictation("starting"), false);
assert.equal(canStartDictation("listening"), false);
assert.equal(canStartDictation("transcribing"), false);

// Listening is not claimed until capture starts; Cancel covers both open phases.
assert.equal(isDictationSessionOpen("starting"), true);
assert.equal(isDictationSessionOpen("listening"), true);
assert.equal(isDictationSessionOpen("transcribing"), false);
assert.equal(isDictationSessionOpen("idle"), false);

// Dictation fills the composer and appends to the existing draft; it never replaces it.
assert.equal(appendDictatedText("", "  Can you research Electron? "), "Can you research Electron?");
assert.equal(appendDictatedText("Draft", "more words"), "Draft more words");
assert.equal(appendDictatedText("Draft ", "more words"), "Draft more words");
assert.equal(appendDictatedText("Draft", "   "), "Draft");
assert.equal(appendDictatedText("   ", "Hello"), "Hello");

// Recording clock is m:ss and never shows a negative or non-finite value.
assert.equal(formatDictationElapsed(0), "0:00");
assert.equal(formatDictationElapsed(9), "0:09");
assert.equal(formatDictationElapsed(75.9), "1:15");
assert.equal(formatDictationElapsed(-4), "0:00");
assert.equal(formatDictationElapsed(Number.NaN), "0:00");

console.log("composer-dictation-unit-tests: 24 assertions passed");
