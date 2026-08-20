import type { DeviceHealth, DeviceProfile, HealthFactor, SanitizedDeviceContext } from "./types";

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function sanitizeDeviceContextForAI(profile: DeviceProfile): SanitizedDeviceContext {
  const family = profile.device.chassisType || (profile.platform === "macos" ? "Mac" : "Windows PC");
  return {
    platform: profile.platform,
    deviceFamily: family,
    manufacturer: profile.device.manufacturer,
    model: profile.device.model,
    os: { ...profile.os },
    cpu: { ...profile.cpu },
    memory: { ...profile.memory },
    storage: profile.storage.map(({ name, totalBytes, usedBytes, freeBytes, internal, systemVolume, mediaType }) => ({
      name,
      totalBytes,
      usedBytes,
      freeBytes,
      internal,
      systemVolume,
      mediaType,
    })),
    battery: profile.battery ? { ...profile.battery } : undefined,
  };
}

export function calculateDeviceHealth(profile: DeviceProfile): DeviceHealth {
  const systemVolume = profile.storage.find((volume) => volume.systemVolume) ?? profile.storage[0];
  const freeRatio = systemVolume?.totalBytes ? systemVolume.freeBytes / systemVolume.totalBytes : 1;
  const storageScore = freeRatio >= 0.2 ? 100 : freeRatio >= 0.1 ? 70 + ((freeRatio - 0.1) / 0.1) * 30 : freeRatio * 700;
  const memoryAvailableRatio = profile.memory.totalBytes ? profile.memory.availableBytes / profile.memory.totalBytes : 1;
  const pressure = profile.memory.pressure;
  const memoryScore = pressure == null
    ? 85
    : pressure <= 65 ? 100 : pressure <= 85 ? 100 - (pressure - 65) * 2 : 60 - (pressure - 85) * 4;

  const factors: HealthFactor[] = [
    {
      category: "Storage",
      score: clamp(storageScore),
      confidence: systemVolume ? 1 : 0.35,
      reasons: systemVolume
        ? [freeRatio < 0.1 ? "The system volume has less than 10% free space." : freeRatio < 0.2 ? "The system volume is beginning to run low." : "The system volume has comfortable free space."]
        : ["System volume capacity could not be measured."],
      metrics: systemVolume ? { freeBytes: systemVolume.freeBytes, totalBytes: systemVolume.totalBytes, freePercent: Math.round(freeRatio * 100) } : {},
    },
    {
      category: "Memory",
      score: clamp(memoryScore),
      confidence: profile.memory.pressure == null ? 0.25 : 0.95,
      reasons: [pressure == null
        ? `The OS reports ${Math.round(memoryAvailableRatio * 100)}% free memory, but pressure data is unavailable, so memory health is not scored confidently.`
        : pressure > 85 ? "Memory pressure is high right now." : pressure > 65 ? "Memory pressure is elevated." : "Current memory pressure is normal."],
      metrics: { totalBytes: profile.memory.totalBytes, availableBytes: profile.memory.availableBytes, ...(pressure == null ? {} : { pressure: Math.round(pressure) }) },
    },
  ];

  if (profile.battery?.present) {
    const health = profile.battery.healthPercent;
    factors.push({
      category: "Battery",
      score: clamp(health ?? 100),
      confidence: health == null ? 0.3 : 0.9,
      reasons: [health == null ? "Battery condition is available, but original-capacity health is not." : health < 80 ? "Battery capacity has declined substantially." : "Battery capacity is within a healthy range."],
      metrics: { percentage: profile.battery.percentage, ...(health == null ? {} : { healthPercent: health }), ...(profile.battery.cycleCount == null ? {} : { cycleCount: profile.battery.cycleCount }) },
    });
  }

  const weighted = factors.reduce((sum, factor) => sum + factor.score * factor.confidence, 0);
  const confidence = factors.reduce((sum, factor) => sum + factor.confidence, 0) || 1;
  const score = clamp(weighted / confidence);
  const label = score >= 90 ? "Excellent" : score >= 75 ? "Good" : score >= 50 ? "Needs attention" : "Critical";
  const constrained = [...factors].filter((factor) => factor.confidence >= 0.6).sort((a, b) => a.score - b.score)[0];
  return { score, label, factors, primaryConstraint: constrained?.score < 85 ? constrained.category : null };
}
