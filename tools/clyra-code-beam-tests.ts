import assert from "node:assert/strict";
import { BEAM_SPEED_PX_PER_SECOND, beamDurationSeconds, roundedRectPerimeter } from "../src/components/clyra-code/beamGeometry";

const circle = roundedRectPerimeter(100, 100, 50);
assert.ok(Math.abs(circle - Math.PI * 100) < 1e-8);
const square = roundedRectPerimeter(100, 100, 0);
assert.equal(square, 400);
const wide = roundedRectPerimeter(620, 145, 22);
const narrow = roundedRectPerimeter(300, 145, 22);
assert.ok(wide > narrow);
assert.ok(beamDurationSeconds(wide) > beamDurationSeconds(narrow));
assert.ok(Math.abs(wide / beamDurationSeconds(wide) - BEAM_SPEED_PX_PER_SECOND) < 1e-8);
assert.ok(Math.abs(narrow / beamDurationSeconds(narrow) - BEAM_SPEED_PX_PER_SECOND) < 1e-8);
assert.equal(roundedRectPerimeter(0, 80, 22), 0);
assert.equal(roundedRectPerimeter(-5, 80, 22), 0);
assert.equal(beamDurationSeconds(100, 0), 0);
assert.equal(beamDurationSeconds(0), 0);
assert.ok(Number.isFinite(roundedRectPerimeter(80, 50, 1000)));
console.log("PASS composer blue beam moves at constant px/s on corners, short and long edges, and responsive sizes.");
