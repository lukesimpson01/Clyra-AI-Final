import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCursorMotion, isPointerAction } from "../electron/ai-cursor-motion.mjs";

const scenarios = [
  [{ x: 0, y: 0 }, { x: 1200, y: 600 }],
  [{ x: 1200, y: 600 }, { x: -400, y: -250 }],
  [{ x: 2, y: 2 }, { x: 2, y: 2 }],
  [{ x: -250, y: 180 }, { x: -15, y: 180 }],
  [{ x: 160, y: 940 }, { x: 160, y: 1 }],
];
for (const [from, to] of scenarios) {
  for (const speed of ["natural", "fast", "instant"]) {
    const { frames, durationMs } = planCursorMotion(from, to, { speed });
    assert.ok(frames.length > 0 && frames.length <= 26, "bounded real input frames");
    assert.ok(durationMs >= 0 && durationMs <= 350, "motion is responsive");
    assert.deepEqual({ x: frames.at(-1).x, y: frames.at(-1).y }, to, "click target is exact");
    let previousDistance = Math.hypot(to.x - from.x, to.y - from.y);
    for (const frame of frames) {
      assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
      assert.ok(frame.atMs >= 0 && frame.atMs <= durationMs);
      assert.ok(frame.x >= Math.min(from.x, to.x) && frame.x <= Math.max(from.x, to.x), "no X overshoot");
      assert.ok(frame.y >= Math.min(from.y, to.y) && frame.y <= Math.max(from.y, to.y), "no Y overshoot");
      const remaining = Math.hypot(to.x - frame.x, to.y - frame.y);
      assert.ok(remaining <= previousDistance + 0.0001, "movement always approaches target");
      previousDistance = remaining;
    }
  }
}
assert.equal(planCursorMotion({ x: 0, y: 0 }, { x: 500, y: 500 }, { reducedMotion: true }).durationMs, 0);
assert.equal(planCursorMotion({ x: 0, y: 0 }, { x: 500, y: 500 }, { speed: "instant" }).frames.length, 1);
assert.throws(() => planCursorMotion({ x: Number.NaN, y: 0 }, { x: 1, y: 1 }), TypeError);
assert.throws(() => planCursorMotion({ x: 1, y: 1 }, { x: Infinity, y: 2 }), TypeError);
for (const type of ["click", "click_at", "double_click", "right_click", "hover", "focus", "scroll", "drag"]) {
  assert.equal(isPointerAction(type), true, type + " should have real position");
}
for (const type of ["read_page", "extract", "wait", "navigate"]) {
  assert.equal(isPointerAction(type), false, type + " must not fake pointer movement");
}
console.log("AI cursor motion tests passed across 5 paths × 3 speeds, reduced motion, coordinates and action filtering.");

const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const nativeBrowser = code("../electron/browser-manager.mjs");
const desktop = code("../electron/desktop-control.mjs");
const fallback = code("../lib/openbrowser/browser-runtime.ts");
const voice = code("../src/voice/VoiceActivitySurface.tsx");
const glyph = code("../src/components/agent/AgentCursorGlyph.tsx");
const chat = code("../src/components/chat/ChatBrowserRun.tsx");
const vibe = code("../src/components/vibe-coder/preview/AgentCursor.tsx");
const livePreview = code("../src/components/AgentControlledPreview.tsx");
assert.match(nativeBrowser, /Input\.dispatchMouseEvent", \{ type: "mouseMoved"/, "Browser cursor must follow a real CDP move");
assert.match(nativeBrowser, /Observe again before clicking|Observe the page again/, "Browser target must be revalidated");
assert.match(nativeBrowser, /cursorsByTab/, "Never leak one tab's pointer into another");
assert.match(desktop, /screen\.getCursorScreenPoint\(\)/, "Desktop overlay must track the physical OS mouse");
assert.match(desktop, /OS cursor did not reach/, "Click must not execute on an unverified desktop location");
assert.match(desktop, /native-pointer-darwin/, "Packaged macOS must include a native pointer backend");
assert.match(fallback, /actualCursorForAction/, "Playwright previews must report real pointer events");
assert.doesNotMatch(fallback, /const previous = pointerPositions\.get\(activePage\) \|\| \{/, "No invented Playwright pointer origin");
assert.match(voice, /useVoiceBrowserActivity/, "Voice must consume verified browser activity");
assert.match(glyph, /fill="#FFFFFF"/, "Arrow must have a clean white interior");
assert.match(glyph, /stroke="#1E6FFF"/, "Arrow must retain a restrained blue outline");
assert.match(chat, /AgentCursorGlyph/, "Chat must use the shared arrow");
assert.match(vibe, /AgentCursorGlyph/, "Vibe must use the shared arrow");
assert.match(livePreview, /verifiedPoint\(target\)/, "Inline workspace cursor must follow actual DOM click target");
assert.match(livePreview, /markAgentAction\(point, "click"\)/, "Inline pointer must display only after real click dispatch");
assert.doesNotMatch(livePreview, /const moveTo = useCallback\(async \(_target/, "No simulated cursor movement in live previews");
console.log("Cursor source contracts verified across Chromium, OS, Voice, Chat, Vibe, and Playwright.");
