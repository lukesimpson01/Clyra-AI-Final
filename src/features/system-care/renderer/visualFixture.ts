import type { ActivitySnapshot, DeviceProfile } from "../shared/types";

/** Visual-QA only. The production workspace never calls this fixture. */
export const SYSTEM_CARE_VISUAL_FIXTURE: DeviceProfile = {
  platform: "macos",
  device: { hostname: "qa-device", displayName: "MacBook Pro", manufacturer: "Apple", model: "MacBook Pro", chassisType: "Laptop" },
  os: { name: "macOS", version: "26.1", build: "25B78", architecture: "arm64" },
  cpu: { manufacturer: "Apple", brand: "Apple M2", physicalCores: 8, logicalCores: 8, currentLoad: 17 },
  gpu: [{ model: "Apple M2" }],
  memory: { totalBytes: 8 * 1024 ** 3, availableBytes: 3.1 * 1024 ** 3, pressure: 54 },
  storage: [{ id: "qa-system", name: "Macintosh HD", filesystem: "apfs", totalBytes: 512 * 1024 ** 3, usedBytes: 370 * 1024 ** 3, freeBytes: 142 * 1024 ** 3, internal: true, systemVolume: true, mediaType: "ssd" }],
  battery: { present: true, percentage: 92, healthPercent: 94, cycleCount: 117, charging: false },
  permissions: { partial: false, missing: [] },
  collectedAt: Date.now(),
};

export const SYSTEM_CARE_ACTIVITY_FIXTURE: ActivitySnapshot = {
  collectedAt: Date.now(), cpu: { loadPercent: 18, logicalCores: 8 }, memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4.9 * 1024 ** 3, availableBytes: 3.1 * 1024 ** 3, pressure: 54 }, disk: {}, network: { receivedBytes: 188_000_000, sentBytes: 47_000_000, downloadBytesPerSecond: 820_000, uploadBytesPerSecond: 92_000 }, battery: SYSTEM_CARE_VISUAL_FIXTURE.battery, gpu: { model: "Apple M2" }, thermals: {},
  processes: [
    { id: "chrome", name: "Google Chrome", processCount: 12, cpuPercent: 13.4, memoryBytes: 2.1 * 1024 ** 3, status: "running" },
    { id: "clyra", name: "Clyra", processCount: 7, cpuPercent: 6.2, memoryBytes: 740 * 1024 ** 2, status: "running" },
    { id: "windowserver", name: "WindowServer", processCount: 1, cpuPercent: 5.4, memoryBytes: 610 * 1024 ** 2, status: "running" },
    { id: "spotify", name: "Spotify", processCount: 5, cpuPercent: 1.1, memoryBytes: 380 * 1024 ** 2, status: "running" },
    { id: "finder", name: "Finder", processCount: 1, cpuPercent: .3, memoryBytes: 154 * 1024 ** 2, status: "running" },
  ],
};
