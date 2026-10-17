import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function bytesToDisplay(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

async function directorySize(directory) {
  try {
    // `du` asks the filesystem for aggregate allocation directly. It is far
    // cheaper than stat-ing thousands of cache files on the Electron event
    // loop, and the timeout keeps a problematic volume from blocking Care.
    const { stdout } = await execFileAsync("du", ["-sk", directory], { timeout: 1_500, maxBuffer: 64 * 1024 });
    const kibibytes = Number(stdout.trim().split(/\s+/)[0]);
    return { bytes: Number.isFinite(kibibytes) ? kibibytes * 1024 : 0, timedOut: false };
  } catch {
    return { bytes: 0, timedOut: true };
  }
}

async function diskUsage() {
  if (process.platform === "win32") return null;
  try {
    const { stdout } = await execFileAsync("df", ["-k", "/"], { timeout: 3_000, maxBuffer: 64 * 1024 });
    const row = stdout.trim().split(/\r?\n/).at(-1)?.trim().split(/\s+/) || [];
    const totalKb = Number(row[1]); const usedKb = Number(row[2]); const availableKb = Number(row[3]);
    if (![totalKb, usedKb, availableKb].every(Number.isFinite)) return null;
    return { totalBytes: totalKb * 1024, usedBytes: usedKb * 1024, availableBytes: availableKb * 1024 };
  } catch { return null; }
}

/** Read only: no personal documents, browser data, or files outside OS caches. */
export async function collectCareSnapshot() {
  const [disk, cache] = await Promise.all([
    diskUsage(),
    process.platform === "darwin" ? directorySize(path.join(os.homedir(), "Library", "Caches")) : Promise.resolve({ bytes: 0, timedOut: false }),
  ]);
  const totalMemory = os.totalmem();
  const usedMemory = Math.max(0, totalMemory - os.freemem());
  const cpuCount = Math.max(1, os.cpus().length);
  const normalizedLoad = Math.max(0, Math.min(100, Math.round((os.loadavg()[0] / cpuCount) * 100)));
  return {
    scannedAt: new Date().toISOString(),
    disk: disk && { totalBytes: disk.totalBytes, usedBytes: disk.usedBytes, availableBytes: disk.availableBytes, usedPercent: Math.round((disk.usedBytes / disk.totalBytes) * 100), totalLabel: bytesToDisplay(disk.totalBytes), usedLabel: bytesToDisplay(disk.usedBytes), availableLabel: bytesToDisplay(disk.availableBytes) },
    memory: { totalBytes: totalMemory, usedBytes: usedMemory, usedPercent: totalMemory ? Math.round((usedMemory / totalMemory) * 100) : 0, totalLabel: bytesToDisplay(totalMemory), usedLabel: bytesToDisplay(usedMemory) },
    cpu: { loadPercent: normalizedLoad, cores: cpuCount },
    caches: { bytes: cache.bytes, label: bytesToDisplay(cache.bytes), timedOut: cache.timedOut },
  };
}
