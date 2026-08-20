import type { ActivitySnapshot, DeviceHealth, DeviceProfile } from "../shared/types";

export type CarePage = "overview" | "smart-care" | "cleanup" | "storage" | "performance" | "network" | "applications" | "security" | "battery" | "activity" | "history" | "settings";

export type Recommendation = {
  id: string;
  title: string;
  detail: string;
  impact: "Low" | "Medium" | "High";
  safety: "Read only" | "Safe" | "Review";
  target: CarePage;
};

export function formatBytes(bytes?: number, compact = false) {
  if (bytes == null || !Number.isFinite(bytes)) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const digits = compact ? (value >= 10 ? 0 : 1) : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function deviceName(profile: DeviceProfile) {
  return profile.device.displayName || profile.device.model || (profile.platform === "macos" ? "your Mac" : "your Windows PC");
}

export function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function recommendations(profile: DeviceProfile, health: DeviceHealth, activity?: ActivitySnapshot | null): Recommendation[] {
  const results: Recommendation[] = [];
  const volume = profile.storage.find((item) => item.systemVolume) || profile.storage[0];
  const freeRatio = volume?.totalBytes ? volume.freeBytes / volume.totalBytes : 1;
  if (volume && freeRatio < .2) results.push({ id: "storage-low", title: `${formatBytes(volume.freeBytes, true)} storage remaining`, detail: "Available space is below 20% of the system volume.", impact: freeRatio < .1 ? "High" : "Medium", safety: "Read only", target: "storage" });
  if (profile.memory.pressure != null && profile.memory.pressure > 65) results.push({ id: "memory-pressure", title: "Memory pressure is elevated", detail: `The operating system reports ${Math.round(profile.memory.pressure)}% memory pressure.`, impact: profile.memory.pressure > 85 ? "High" : "Medium", safety: "Safe", target: "performance" });
  const top = activity?.processes.find((process) => (process.cpuPercent || 0) >= 25 || process.memoryBytes >= profile.memory.totalBytes * .2);
  if (top) results.push({ id: `process-${top.id}`, title: `${top.name} is a leading resource consumer`, detail: `${top.cpuPercent == null ? "CPU unavailable" : `${top.cpuPercent}% CPU`} • ${formatBytes(top.memoryBytes)} memory across ${top.processCount} process${top.processCount === 1 ? "" : "es"}.`, impact: "Medium", safety: "Read only", target: "activity" });
  if (!results.length) results.push({ id: "balanced", title: "No urgent measurable issues", detail: health.primaryConstraint ? `${health.primaryConstraint} is the lowest-scoring measured area.` : "Storage and available memory look balanced from the facts currently available.", impact: "Low", safety: "Read only", target: "smart-care" });
  return results;
}
