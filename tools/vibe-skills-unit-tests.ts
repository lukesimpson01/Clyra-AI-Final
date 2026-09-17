import assert from "node:assert/strict";
import { automaticFrontendSkill, FRONTEND_DESIGN_SKILL_ID } from "../lib/vibe-skills/frontend-design";

const selected = automaticFrontendSkill("Make the React dashboard sidebar responsive and improve its empty state.");
assert.ok(selected?.includes(FRONTEND_DESIGN_SKILL_ID));
assert.match(selected ?? "", /existing component library/);
assert.equal(automaticFrontendSkill("Fix a Go CLI argument parser."), null);
console.log(JSON.stringify({ ok: true, assertions: 3 }, null, 2));
