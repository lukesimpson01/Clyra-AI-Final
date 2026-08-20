import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const FIXED_BINARIES = new Set(["/usr/sbin/sysctl", "/usr/bin/sw_vers", "/usr/bin/pmset", "/usr/bin/memory_pressure", "/bin/ps", "/usr/sbin/netstat", "powershell.exe"]);

async function fixedObservation(executable, args, timeout = 900) {
  if (!FIXED_BINARIES.has(executable)) throw new Error("System Care observation is not registered.");
  const { stdout } = await execFileAsync(executable, args, {
    timeout,
    maxBuffer: 512 * 1024,
    windowsHide: true,
    encoding: "utf8",
  });
  return String(stdout).trim();
}

function architecture() {
  return os.arch() === "arm64" ? "arm64" : "x64";
}

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { idle, total };
}

async function currentCpuLoad() {
  const before = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const after = cpuSnapshot();
  const total = after.total - before.total;
  return total > 0 ? Math.max(0, Math.min(100, ((total - (after.idle - before.idle)) / total) * 100)) : undefined;
}

async function currentMemory() {
  const totalBytes = os.totalmem();
  if (process.platform === "darwin") {
    try {
      const output = await fixedObservation("/usr/bin/memory_pressure", ["-Q"], 900);
      const freePercent = Number(output.match(/memory free percentage:\s*(\d+)%/i)?.[1]);
      if (Number.isFinite(freePercent)) {
        const availableBytes = Math.round(totalBytes * freePercent / 100);
        return { totalBytes, availableBytes, usedBytes: totalBytes - availableBytes, pressure: 100 - freePercent };
      }
    } catch { /* fall back to the cross-platform memory observation */ }
  }
  const availableBytes = os.freemem();
  return { totalBytes, availableBytes, usedBytes: Math.max(0, totalBytes - availableBytes) };
}

function processName(command) {
  const clean = String(command || "Unknown").trim();
  if (process.platform === "darwin") {
    const appBundle = clean.match(/\/(?:Applications|System\/Applications)\/([^/]+)\.app\//i)?.[1];
    if (appBundle) return appBundle;
  }
  const leaf = clean.split(/[\\/]/).filter(Boolean).at(-1) || clean;
  return leaf.replace(/\.app$/i, "").replace(/\.exe$/i, "") || "Unknown";
}

function groupProcesses(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = processName(row.executable || row.name);
    const key = name.toLocaleLowerCase();
    const current = groups.get(key) || { id: key, name, executable: row.executable, processCount: 0, cpuPercent: 0, cpuMeasured: false, memoryBytes: 0, status: "running" };
    current.processCount += 1;
    current.memoryBytes += Number(row.memoryBytes) || 0;
    if (Number.isFinite(row.cpuPercent)) {
      current.cpuPercent += Number(row.cpuPercent);
      current.cpuMeasured = true;
    }
    groups.set(key, current);
  }
  return [...groups.values()]
    .map(({ cpuMeasured, ...group }) => ({ ...group, cpuPercent: cpuMeasured ? Math.round(group.cpuPercent * 10) / 10 : undefined }))
    .sort((a, b) => ((b.cpuPercent || 0) - (a.cpuPercent || 0)) || (b.memoryBytes - a.memoryBytes));
}

async function macProcesses() {
  const output = await fixedObservation("/bin/ps", ["-axo", "pid=,ppid=,%cpu=,rss=,comm="], 5000);
  const rows = output.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), cpuPercent: Number(match[3]), memoryBytes: Number(match[4]) * 1024, executable: match[5] }];
  });
  return groupProcesses(rows);
}

async function windowsProcesses() {
  const script = "Get-Process | Select-Object Id,ProcessName,WorkingSet64,Path | ConvertTo-Json -Compress";
  const output = await fixedObservation("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 2200);
  const parsed = JSON.parse(output || "[]");
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return groupProcesses(list.map((item) => ({ name: item.ProcessName, executable: item.Path || item.ProcessName, memoryBytes: Number(item.WorkingSet64) || 0 })));
}

async function networkTotals() {
  if (process.platform === "darwin") {
    const output = await fixedObservation("/usr/sbin/netstat", ["-ibn"], 1200);
    const lines = output.split("\n");
    const header = lines.find((line) => /\bIbytes\b/.test(line) && /\bObytes\b/.test(line));
    if (!header) return {};
    let receivedBytes = 0;
    let sentBytes = 0;
    for (const line of lines.slice(lines.indexOf(header) + 1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 9 || fields[0] === "lo0" || !/^<Link#/.test(fields[2] || "")) continue;
      receivedBytes += Number(fields.at(-5)) || 0;
      sentBytes += Number(fields.at(-2)) || 0;
    }
    return { receivedBytes, sentBytes };
  }
  const script = "$s=Get-NetAdapterStatistics | Where-Object {$_.Name -ne $null};[pscustomobject]@{received=($s|Measure-Object ReceivedBytes -Sum).Sum;sent=($s|Measure-Object SentBytes -Sum).Sum}|ConvertTo-Json -Compress";
  try {
    const parsed = JSON.parse(await fixedObservation("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 1800));
    return { receivedBytes: Number(parsed.received) || 0, sentBytes: Number(parsed.sent) || 0 };
  } catch { return {}; }
}

export async function collectActivitySnapshot() {
  const [loadPercent, processes, network, details, memory] = await Promise.all([
    currentCpuLoad(),
    process.platform === "darwin" ? macProcesses() : windowsProcesses(),
    networkTotals(),
    process.platform === "darwin" ? macDetails() : Promise.resolve({ battery: undefined }),
    currentMemory(),
  ]);
  return {
    collectedAt: Date.now(),
    cpu: { loadPercent: Math.round((loadPercent || 0) * 10) / 10, logicalCores: os.cpus().length },
    memory,
    disk: {},
    network,
    battery: details.battery,
    gpu: {},
    thermals: {},
    processes,
  };
}

async function timedFetch(url, options = {}) {
  const started = performance.now();
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), cache: "no-store", headers: { "Cache-Control": "no-cache", ...(options.headers || {}) } });
  if (!response.ok) throw Object.assign(new Error(`Speed test provider returned ${response.status}.`), { code: "NetworkUnavailable" });
  const buffer = await response.arrayBuffer();
  return { elapsedMs: Math.max(1, performance.now() - started), bytes: buffer.byteLength };
}

export async function runInternetSpeedTest(onStage = () => undefined) {
  onStage("latency");
  const latencySamples = [];
  for (let index = 0; index < 3; index += 1) {
    const sample = await timedFetch(`https://speed.cloudflare.com/__down?bytes=1&nonce=${crypto.randomUUID()}`);
    latencySamples.push(sample.elapsedMs);
  }
  onStage("download");
  const download = await timedFetch(`https://speed.cloudflare.com/__down?bytes=10000000&nonce=${crypto.randomUUID()}`);
  onStage("upload");
  const uploadBody = new Uint8Array(2_000_000);
  crypto.randomFillSync(uploadBody);
  const uploadStarted = performance.now();
  const uploadResponse = await fetch("https://speed.cloudflare.com/__up", { method: "POST", body: uploadBody, signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-cache" } });
  if (!uploadResponse.ok) throw Object.assign(new Error(`Speed test upload returned ${uploadResponse.status}.`), { code: "NetworkUnavailable" });
  await uploadResponse.arrayBuffer();
  const uploadElapsed = Math.max(1, performance.now() - uploadStarted);
  const result = {
    provider: "Cloudflare",
    testedAt: Date.now(),
    latencyMs: Math.round(latencySamples.sort((a, b) => a - b)[1] * 10) / 10,
    downloadMbps: Math.round(((download.bytes * 8) / download.elapsedMs / 1000) * 10) / 10,
    uploadMbps: Math.round(((uploadBody.byteLength * 8) / uploadElapsed / 1000) * 10) / 10,
    bytesDownloaded: download.bytes,
    bytesUploaded: uploadBody.byteLength,
  };
  onStage("complete");
  return result;
}

async function systemVolume() {
  const root = process.platform === "win32" ? `${process.env.SystemDrive || "C:"}\\` : "/";
  const stats = await statfs(root);
  const totalBytes = Number(stats.blocks) * Number(stats.bsize);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  return {
    id: "system-volume",
    name: process.platform === "darwin" ? "Macintosh HD" : (process.env.SystemDrive || "Windows"),
    filesystem: "unknown",
    totalBytes,
    usedBytes: Math.max(0, totalBytes - freeBytes),
    freeBytes,
    internal: true,
    systemVolume: true,
    mediaType: "unknown",
  };
}

function parsePmsetBattery(text) {
  const percentage = Number(text.match(/(\d+)%/)?.[1]);
  if (!Number.isFinite(percentage)) return undefined;
  return {
    present: true,
    percentage,
    charging: /charging|charged|AC Power/i.test(text) && !/discharging/i.test(text),
  };
}

async function macDetails() {
  const [model, physicalCores, osVersion, build, battery] = await Promise.all([
    fixedObservation("/usr/sbin/sysctl", ["-n", "hw.model"]).catch(() => "Mac"),
    fixedObservation("/usr/sbin/sysctl", ["-n", "hw.physicalcpu"]).then(Number).catch(() => undefined),
    fixedObservation("/usr/bin/sw_vers", ["-productVersion"]).catch(() => os.release()),
    fixedObservation("/usr/bin/sw_vers", ["-buildVersion"]).catch(() => os.release()),
    fixedObservation("/usr/bin/pmset", ["-g", "batt"]).then(parsePmsetBattery).catch(() => undefined),
  ]);
  return { manufacturer: "Apple", model, physicalCores, osName: "macOS", osVersion, build, battery };
}

async function windowsDetails() {
  const script = [
    "$c=Get-CimInstance Win32_ComputerSystem;",
    "$o=Get-CimInstance Win32_OperatingSystem;$p=Get-CimInstance Win32_Processor;",
    "[pscustomobject]@{manufacturer=$c.Manufacturer;model=$c.Model;caption=$o.Caption;version=$o.Version;build=$o.BuildNumber;physicalCores=($p|Measure-Object NumberOfCores -Sum).Sum}|ConvertTo-Json -Compress",
  ].join("");
  try {
    const parsed = JSON.parse(await fixedObservation("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 1500));
    return { manufacturer: parsed.manufacturer, model: parsed.model, physicalCores: Number(parsed.physicalCores) || undefined, osName: parsed.caption || "Windows", osVersion: parsed.version || os.release(), build: parsed.build || os.release() };
  } catch {
    return { manufacturer: undefined, model: "Windows PC", osName: "Windows", osVersion: os.release(), build: os.release() };
  }
}

export async function collectDeviceProfile() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    const error = new Error("Clyra System Care currently supports macOS and Windows.");
    error.code = "UnsupportedPlatformFeature";
    throw error;
  }
  const cpus = os.cpus();
  const [platformDetails, storage, load, memory] = await Promise.all([
    process.platform === "darwin" ? macDetails() : windowsDetails(),
    systemVolume(),
    currentCpuLoad(),
    currentMemory(),
  ]);
  const logicalCores = Math.max(1, cpus.length);
  return {
    platform: process.platform === "darwin" ? "macos" : "windows",
    device: {
      hostname: os.hostname(),
      displayName: platformDetails.model,
      manufacturer: platformDetails.manufacturer,
      model: platformDetails.model,
      chassisType: /book|laptop|portable/i.test(platformDetails.model || "") ? "Laptop" : process.platform === "darwin" ? "Mac" : "Windows PC",
    },
    os: { name: platformDetails.osName, version: platformDetails.osVersion, build: platformDetails.build, architecture: architecture() },
    cpu: {
      manufacturer: process.platform === "darwin" && /Apple/i.test(cpus[0]?.model || "") ? "Apple" : "Unknown",
      brand: cpus[0]?.model?.trim() || "Unknown processor",
      physicalCores: platformDetails.physicalCores || logicalCores,
      logicalCores,
      currentLoad: load,
    },
    gpu: [],
    memory: { totalBytes: memory.totalBytes, availableBytes: memory.availableBytes, pressure: memory.pressure },
    storage: [storage],
    battery: platformDetails.battery,
    permissions: { partial: false, missing: [] },
    collectedAt: Date.now(),
  };
}

export class SystemCareService {
  #jobs = new Map();

  async profile() {
    return collectDeviceProfile();
  }

  async activity() {
    return collectActivitySnapshot();
  }

  async speedTest(onStage) {
    return runInternetSpeedTest(onStage);
  }

  startSmartScan(sender) {
    const jobId = crypto.randomUUID();
    const state = { cancelled: false };
    this.#jobs.set(jobId, state);
    const sections = ["DEVICE_PROFILE", "STORAGE", "MEMORY", "BATTERY", "ACTIVITY", "SYSTEM_HEALTH"];
    const emit = (payload) => {
      if (!sender.isDestroyed()) sender.send("system-care:scan-event", { jobId, totalJobs: sections.length, ...payload });
    };
    setTimeout(async () => {
      let completedJobs = 0;
      try {
        emit({ section: "DEVICE_PROFILE", state: "running", completedJobs, message: "Understanding this device…" });
        const profile = await collectDeviceProfile();
        if (state.cancelled) throw Object.assign(new Error("Scan cancelled."), { code: "Cancelled" });
        completedJobs += 1;
        emit({ section: "DEVICE_PROFILE", state: "ready", completedJobs, message: "Device profile ready", profile });
        for (const [section, message, supported] of [
          ["STORAGE", "Storage capacity measured", true],
          ["MEMORY", "Memory condition measured", true],
          ["BATTERY", profile.battery ? "Battery condition measured" : "No battery detected", Boolean(profile.battery)],
          ["ACTIVITY", "Live activity and processes measured", true],
          ["SYSTEM_HEALTH", "Health factors calculated locally", true],
        ]) {
          if (state.cancelled) throw Object.assign(new Error("Scan cancelled."), { code: "Cancelled" });
          emit({ section, state: "running", completedJobs, message: message.replace(/ measured$/, "…") });
          const activity = section === "ACTIVITY" ? await collectActivitySnapshot() : undefined;
          await new Promise((resolve) => setTimeout(resolve, 260));
          completedJobs += 1;
          emit({ section, state: supported ? "ready" : "unsupported", completedJobs, message, profile: section === "SYSTEM_HEALTH" ? profile : undefined, activity });
        }
      } catch (error) {
        emit({ section: "SYSTEM_HEALTH", state: error?.code === "Cancelled" ? "cancelled" : "error", completedJobs, message: error?.message || "Scan could not finish", error: { code: error?.code || "ObservationFailed", message: error?.message || "Scan could not finish" } });
      } finally {
        this.#jobs.delete(jobId);
      }
    }, 0);
    return { jobId };
  }

  cancel(jobId) {
    const job = this.#jobs.get(jobId);
    if (job) job.cancelled = true;
    return { ok: Boolean(job) };
  }
}
