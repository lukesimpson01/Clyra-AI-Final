import assert from "node:assert/strict";
import { collectCareSnapshot } from "../electron/care-manager.mjs";

const snapshot = await collectCareSnapshot();
assert.match(snapshot.scannedAt, /^\d{4}-\d{2}-\d{2}T/);
assert.ok(snapshot.memory.totalBytes > 0);
assert.ok(snapshot.memory.usedBytes >= 0 && snapshot.memory.usedBytes <= snapshot.memory.totalBytes);
assert.ok(snapshot.memory.usedPercent >= 0 && snapshot.memory.usedPercent <= 100);
assert.ok(snapshot.cpu.cores >= 1 && snapshot.cpu.loadPercent >= 0 && snapshot.cpu.loadPercent <= 100);
assert.ok(snapshot.caches.bytes >= 0 && typeof snapshot.caches.timedOut === "boolean");
if (snapshot.disk) assert.ok(snapshot.disk.usedPercent >= 0 && snapshot.disk.usedPercent <= 100);
console.log("care manager unit tests passed");
