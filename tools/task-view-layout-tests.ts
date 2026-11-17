import assert from "node:assert/strict";
import { applyWorkspace, clampFloat, dockApp, emptyLayout, floatApp, resolveRoles, saveWorkspace, validateLayout } from "../src/lib/taskViewLayout";

const ids = ["chat", "vibe", "browser", "notes"];
const stage = { width: 1200, height: 800 };

// an app is in exactly one place at a time
let layout = floatApp(emptyLayout(), "chat");
assert.ok(layout.floats.chat);
layout = dockApp(layout, "chat");
assert.ok(!layout.floats.chat && layout.docked.includes("chat"));
layout = floatApp(layout, "chat");
assert.ok(!layout.docked.includes("chat") && layout.floats.chat);

// roles: the active app is full, others hidden, floats float, docked peek
let roles = resolveRoles(floatApp(emptyLayout(), "vibe"), ids, "chat", stage);
assert.equal(roles.get("chat")!.kind, "full");
assert.equal(roles.get("vibe")!.kind, "float");
assert.equal(roles.get("browser")!.kind, "hidden");
roles = resolveRoles(dockApp(emptyLayout(), "vibe"), ids, "chat", stage);
assert.equal(roles.get("vibe")!.kind, "dock");

// floating boxes stay on the stage and above the minimum size
const box = clampFloat({ x: 0.95, y: 1.2, w: 0.05, h: 5 });
assert.ok(box.x + box.w <= 1 && box.y + box.h <= 1 && box.w >= 0.22 && box.h >= 0.24);

// saved workspaces restore, and drop apps that have since closed
let saved = saveWorkspace(floatApp(floatApp(emptyLayout(), "vibe"), "browser"), "Coding");
saved = { ...saved, floats: {}, docked: [] };
const restored = applyWorkspace(saved, "Coding", ["chat", "browser"]);
assert.ok(restored.floats.browser && !restored.floats.vibe, "vibe is closed, so its float is dropped");

// untrusted storage is sanitised, including old saved layouts that still carry a split
assert.deepEqual(validateLayout({ v: 99 }, ids), emptyLayout());
assert.deepEqual(validateLayout("junk", ids), emptyLayout());
const old = validateLayout({ v: 1, split: { ids: ["chat", "vibe"], ratio: 0.5 }, floats: { ghost: { x: 0, y: 0, w: 0.3, h: 0.3 } }, docked: ["ghost", "chat"], saved: {} }, ids);
assert.deepEqual(old.docked, ["chat"]);
assert.ok(!("split" in old) && !old.floats.ghost);

// an active app that is itself floating still leaves a base app on the stage
roles = resolveRoles(floatApp(emptyLayout(), "chat"), ids, "chat", stage);
assert.equal(roles.get("chat")!.kind, "float");
assert.ok([...roles.values()].some((role) => role.kind === "full"));

console.log("task-view layout: ok");
