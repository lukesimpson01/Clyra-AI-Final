import assert from "node:assert/strict";
import { calculateDeviceHealth, sanitizeDeviceContextForAI } from "../src/features/system-care/shared/intelligence";
import { parseSystemCareToolCall } from "../src/features/system-care/shared/tool-registry";
import type { DeviceProfile } from "../src/features/system-care/shared/types";

function fixture(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return {
    platform: "macos",
    device: { hostname: "private-host", manufacturer: "Apple", model: "MacBook Pro", displayName: "Luke's Mac", chassisType: "Laptop" },
    os: { name: "macOS", version: "26.1", build: "25B1", architecture: "arm64" },
    cpu: { manufacturer: "Apple", brand: "Apple M2", physicalCores: 8, logicalCores: 8, currentLoad: 12 },
    gpu: [],
    memory: { totalBytes: 8e9, availableBytes: 4e9, pressure: 50 },
    storage: [{ id: "private-volume-id", name: "Macintosh HD", filesystem: "apfs", totalBytes: 500e9, usedBytes: 300e9, freeBytes: 200e9, internal: true, systemVolume: true }],
    battery: { present: true, percentage: 82, healthPercent: 94, charging: false },
    permissions: { partial: false, missing: [] },
    collectedAt: 1,
    ...overrides,
  };
}

const sanitized = sanitizeDeviceContextForAI(fixture());
assert.equal("hostname" in sanitized, false, "hostname must never reach AI context");
assert.equal(JSON.stringify(sanitized).includes("Luke"), false, "private display names must be removed");
assert.equal(JSON.stringify(sanitized).includes("private-volume-id"), false, "local volume IDs must be removed");

const healthy = calculateDeviceHealth(fixture());
assert.ok(healthy.score >= 90);
assert.equal(healthy.primaryConstraint, null);

const lowStorage = calculateDeviceHealth(fixture({
  storage: [{ id: "system", name: "Macintosh HD", filesystem: "apfs", totalBytes: 500e9, usedBytes: 475e9, freeBytes: 25e9, internal: true, systemVolume: true }],
}));
assert.equal(lowStorage.primaryConstraint, "Storage");
assert.ok(lowStorage.factors.find((factor) => factor.category === "Storage")!.score < 50);

assert.deepEqual(parseSystemCareToolCall("getDeviceProfile", {}), {});
assert.throws(() => parseSystemCareToolCall("shell", { command: "rm -rf /" }), /Unregistered/);
assert.throws(() => parseSystemCareToolCall("moveFilesToTrash", { candidateIds: ["x"] }), /approvalId/);
assert.throws(() => parseSystemCareToolCall("getDeviceProfile", { command: "whoami" }), /Unrecognized key/);

console.log("System Care unit tests passed.");
