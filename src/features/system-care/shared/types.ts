export type SystemCarePlatform = "macos" | "windows";

export interface StorageVolume {
  id: string;
  name: string;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  internal: boolean;
  systemVolume: boolean;
  mediaType?: "ssd" | "hdd" | "nvme" | "unknown";
}

export interface DeviceProfile {
  platform: SystemCarePlatform;
  device: {
    hostname: string;
    displayName?: string;
    manufacturer?: string;
    model?: string;
    chassisType?: string;
  };
  os: {
    name: string;
    version: string;
    build: string;
    architecture: "x64" | "arm64";
  };
  cpu: {
    manufacturer: string;
    brand: string;
    physicalCores: number;
    logicalCores: number;
    currentLoad?: number;
  };
  gpu: Array<{ model: string; vramBytes?: number }>;
  memory: { totalBytes: number; availableBytes: number; pressure?: number };
  storage: StorageVolume[];
  battery?: {
    present: boolean;
    percentage: number;
    cycleCount?: number;
    healthPercent?: number;
    charging: boolean;
  };
  thermals?: { cpu?: number; gpu?: number };
  permissions: { partial: boolean; missing: string[] };
  collectedAt: number;
}

export interface SanitizedDeviceContext {
  platform: SystemCarePlatform;
  deviceFamily: string;
  manufacturer?: string;
  model?: string;
  os: { name: string; version: string; build: string; architecture: "x64" | "arm64" };
  cpu: { brand: string; physicalCores: number; logicalCores: number; currentLoad?: number };
  memory: { totalBytes: number; availableBytes: number; pressure?: number };
  storage: Array<Pick<StorageVolume, "name" | "totalBytes" | "usedBytes" | "freeBytes" | "internal" | "systemVolume" | "mediaType">>;
  battery?: Pick<NonNullable<DeviceProfile["battery"]>, "present" | "percentage" | "cycleCount" | "healthPercent" | "charging">;
}

export interface HealthFactor {
  category: "Storage" | "Memory" | "Battery" | "Updates" | "Security";
  score: number;
  confidence: number;
  reasons: string[];
  metrics: Record<string, number | string>;
}

export interface DeviceHealth {
  score: number;
  label: "Excellent" | "Good" | "Needs attention" | "Critical";
  factors: HealthFactor[];
  primaryConstraint: HealthFactor["category"] | null;
}

export interface ProcessGroup {
  id: string;
  name: string;
  executable?: string;
  /** Locally resolved OS application icon. Never sent to Clyra AI. */
  iconDataUrl?: string;
  processCount: number;
  cpuPercent?: number;
  memoryBytes: number;
  parentPid?: number;
  status: "running" | "unknown";
}

export interface ActivitySnapshot {
  collectedAt: number;
  cpu: { loadPercent: number; logicalCores: number };
  memory: { totalBytes: number; availableBytes: number; usedBytes: number; pressure?: number; swapUsedBytes?: number };
  disk: { readBytesPerSecond?: number; writeBytesPerSecond?: number };
  network: { receivedBytes?: number; sentBytes?: number; downloadBytesPerSecond?: number; uploadBytesPerSecond?: number };
  battery?: DeviceProfile["battery"];
  gpu: { loadPercent?: number; model?: string };
  thermals: { cpuCelsius?: number; gpuCelsius?: number };
  processes: ProcessGroup[];
}

export interface InternetSpeedTestResult {
  provider: "Cloudflare";
  testedAt: number;
  latencyMs: number;
  downloadMbps: number;
  uploadMbps: number;
  bytesDownloaded: number;
  bytesUploaded: number;
}

export type InternetSpeedTestStage = "latency" | "download" | "upload" | "complete";

export type ScanJobClass = "LIGHT_IO" | "HEAVY_IO" | "CPU" | "SYSTEM" | "NETWORK";
export type ScanSection = "DEVICE_PROFILE" | "STORAGE" | "MEMORY" | "BATTERY" | "ACTIVITY" | "SYSTEM_HEALTH";

export interface ScanEvent {
  jobId: string;
  section: ScanSection;
  state: "queued" | "running" | "ready" | "unsupported" | "cancelled" | "error";
  completedJobs: number;
  totalJobs: number;
  message: string;
  profile?: DeviceProfile;
  health?: DeviceHealth;
  activity?: ActivitySnapshot;
  error?: { code: string; message: string };
}

export type ActionRisk = "READ_ONLY" | "SAFE" | "REVERSIBLE" | "PERSONAL_DATA" | "ADMIN";

export interface ProposedAction {
  id: string;
  type: string;
  title: string;
  description: string;
  estimatedBytesRecovered?: number;
  benefit: "storage" | "startup" | "performance" | "battery" | "security" | "privacy" | "update";
  risk: ActionRisk;
  requiresApproval: boolean;
  reversible: boolean;
  tool: string;
  args: unknown;
  evidence: string[];
  confidence: number;
}
