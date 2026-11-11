import assert from "node:assert/strict";
import { GENERATED_APPS_EVENT, readGeneratedApps, setGeneratedApp } from "../src/lib/userGeneratedApps";

const store = new Map<string, string>();
const events: string[] = [];
const previousWindow = (globalThis as { window?: unknown }).window;
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  },
  dispatchEvent: (event: Event) => { events.push(event.type); return true; },
};
try {
  assert.deepEqual(readGeneratedApps(), []);
  assert.equal(setGeneratedApp("my-project", "  My Calendar  ", true)[0].name, "My Calendar");
  assert.deepEqual(readGeneratedApps().map((x) => x.projectId), ["my-project"]);
  assert.equal(events[0], GENERATED_APPS_EVENT);
  assert.equal(setGeneratedApp("my-project", "Updated Calendar", true).length, 1);
  assert.equal(readGeneratedApps()[0].name, "Updated Calendar");

  assert.deepEqual(setGeneratedApp("../escape", "Bad", true), []);
  assert.equal(readGeneratedApps().length, 1);
  assert.equal(setGeneratedApp("other-project", "", true).length, 1);
  assert.equal(readGeneratedApps().length, 1);
  assert.equal(setGeneratedApp("other-project", "a".repeat(200), true)[0].name.length, 72);
  assert.deepEqual(readGeneratedApps().map((x) => x.projectId), ["other-project", "my-project"]);

  for (let i = 0; i < 60; i++) setGeneratedApp(`project_${i}`, `App ${i}`, true);
  assert.equal(readGeneratedApps().length, 40);
  assert.equal(readGeneratedApps()[0].projectId, "project_59");
  const withoutLatest = setGeneratedApp("project_59", "", false);
  assert.ok(!withoutLatest.some((x) => x.projectId === "project_59"));

  const key = [...store.keys()][0];
  store.set(key, "not json");
  assert.deepEqual(readGeneratedApps(), []);
  store.set(key, JSON.stringify([
    { projectId: "safe", name: "Safe", addedAt: 1 },
    { projectId: "safe", name: "Duplicate", addedAt: 2 },
    { projectId: "../../bad", name: "Unsafe", addedAt: 3 },
  ]));
  assert.deepEqual(readGeneratedApps().map((x) => x.name), ["Safe"]);
  console.log("PASS user generated app shortcuts: pin, rename, dedupe, unpin, invalid ID, missing name, capped length, capped count, invalid JSON, stale data");
} finally {
  if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = previousWindow;
}
