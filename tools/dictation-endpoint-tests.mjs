import assert from "node:assert/strict";
import { computeEndSilenceMs } from "../electron/dictation-endpoint.mjs";

const cases = [
  ["sentence-final punctuation is prompt", { heard: "Send the email.", speechDurationMs: 2700 }, 900],
  ["fast short command stays responsive", { heard: "Open notes", speechDurationMs: 650 }, 1090],
  ["open clause waits for more speech", { heard: "I was thinking about the", speechDurationMs: 2300 }, 2000],
  ["comma signals unfinished thought", { heard: "Firstly,", speechDurationMs: 2100 }, 2000],
  ["late partial recognition gets a grace period", { heard: "", speechDurationMs: 1700 }, 1500],
  ["speaker's longer pauses are respected", { heard: "Keep going", speechDurationMs: 3200, longestPauseMs: 1750 }, 2450],
  ["wait is bounded even after very long pauses", { heard: "Keep going", speechDurationMs: 3200, longestPauseMs: 9000 }, 3000],
];
for (const [name, input, expected] of cases) {
  assert.equal(computeEndSilenceMs(input), expected, name);
  console.log("PASS", name);
}
assert.ok(computeEndSilenceMs({ heard: "I need to" }) > computeEndSilenceMs({ heard: "Done." }));
console.log("PASS incomplete sentences get more silence than complete sentences");
console.log("8 dictation endpoint tests passed.");
