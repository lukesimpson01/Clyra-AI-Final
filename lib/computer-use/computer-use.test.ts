import assert from "node:assert/strict";
import test from "node:test";
import { DesktopCoordinateMapper } from "./coordinate-mapper";
import { ComputerHarness } from "./harness";
import { ComputerPolicy } from "./policy";
import { SemanticDesktop, redactElement, stableElementId } from "./semantic-desktop";
import type { NativeComputerAdapter, ProposedComputerAction, SemanticDesktopSnapshot } from "./types";

const snapshot = (revision = 1): SemanticDesktopSnapshot => ({ revision, capturedAt: Date.now(), activeApp: "Notes", activeWindow: "w1", windows: [{ id: "w1", appId: "notes", title: "Document", active: true }], changedElementIds: [], elements: [{ id: "el_save", platformId: "save", appId: "notes", windowId: "w1", role: "button", name: "Save", bounds: { x: 10, y: 10, width: 50, height: 20 }, enabled: true, focused: false, actions: ["invoke"], confidence: 1 }] });
const proposal = (overrides: Partial<ProposedComputerAction> = {}): ProposedComputerAction => ({ userGoal: "Save my note", action: "invoke", targetApp: "Notes", targetDescription: "Save", externalSideEffect: false, destructive: false, sendsData: false, changesAccount: false, financial: false, securitySensitive: false, credentialRelated: false, reversible: true, sourceOfInstruction: "USER", ...overrides });

test("semantic index ranks exact active-window matches and redacts secrets", () => {
  const desktop = new SemanticDesktop(); const state = snapshot();
  state.elements.push({ ...state.elements[0], id: stableElementId(undefined, "password"), role: "textfield", name: "Password", value: "hunter2", sensitive: true });
  desktop.update(state); assert.equal(desktop.find("Save", ["button"])[0].element.id, "el_save");
  assert.equal(desktop.find("Password")[0].element.value, "[REDACTED]");
  assert.equal(redactElement(state.elements[1]).value, "[REDACTED]");
});

test("policy stops purchases, credentials, injection, sends, and deletion", () => {
  const policy = new ComputerPolicy();
  assert.equal(policy.review(proposal({ financial: true, amount: 29, currency: "AUD", merchant: "Apple" })).decision, "REQUIRE_USER_CONFIRMATION");
  assert.equal(policy.review(proposal({ credentialRelated: true })).decision, "REQUIRE_USER_TAKEOVER");
  assert.equal(policy.review(proposal({ sourceOfInstruction: "SCREEN_CONTENT" })).decision, "DENY");
  assert.equal(policy.review(proposal({ sendsData: true })).decision, "REQUIRE_USER_CONFIRMATION");
  assert.equal(policy.review(proposal({ destructive: true })).decision, "REQUIRE_USER_CONFIRMATION");
});

test("mixed-DPI coordinate mapping round trips", () => {
  const mapper = new DesktopCoordinateMapper([{ id: "retina", dipBounds: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 2 }, { id: "external", dipBounds: { x: 1000, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, physicalOrigin: { x: 2000, y: 0 } }]);
  assert.deepEqual(mapper.dipToPhysical({ x: 500, y: 100 }), { x: 1000, y: 200 });
  assert.deepEqual(mapper.physicalToDip({ x: 2100, y: 80 }, "external"), { x: 1100, y: 80 });
});

test("harness re-observes, executes serially, and verifies", async () => {
  let revision = 0; const executed: string[] = [];
  const adapter: NativeComputerAdapter = { observe: async () => snapshot(++revision), execute: async action => { executed.push(action.name); return { success: true }; }, releaseInput: async () => undefined };
  const harness = new ComputerHarness(adapter, "Save my note"); await harness.observe();
  await harness.enqueue({ name: "invoke", elementId: "el_save", expected: { windowTitleContains: "Document" } }, proposal());
  assert.deepEqual(executed, ["invoke"]); assert.equal(harness.session.status, "WAITING"); assert.equal(revision, 3);
  await harness.takeControl(); await assert.rejects(harness.observe(), /OBSERVATION_DISABLED/); await harness.cancel();
  assert.equal(harness.session.status, "CANCELLED");
});

test("harness refuses a moved target before input", async () => {
  let revision = 0; let executed = false;
  const adapter: NativeComputerAdapter = { observe: async () => { const state = snapshot(++revision); if (revision > 1) state.elements[0].bounds!.x = 80; return state; }, execute: async () => { executed = true; return { success: true }; }, releaseInput: async () => undefined };
  const harness = new ComputerHarness(adapter, "Save"); await harness.observe();
  await assert.rejects(harness.enqueue({ name: "click", elementId: "el_save" }, proposal({ action: "click" })), /TARGET_MOVED/);
  assert.equal(executed, false);
});
