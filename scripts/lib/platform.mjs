/**
 * Shared cross-platform helpers for Clyra + OpenCluely launchers.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);

export function isWin() {
  return process.platform === "win32";
}

export function isMac() {
  return process.platform === "darwin";
}

export function isLinux() {
  return process.platform === "linux";
}

/** Resolve first existing binary via where/which. */
export async function whichBin(bin) {
  const cmd = isWin() ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(cmd, [bin], { timeout: 4000, windowsHide: true });
    return String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) || null;
  } catch {
    return null;
  }
}

/** Prefer python on Windows, python3 elsewhere. */
export async function resolvePython() {
  const candidates = isWin()
    ? ["py", "python", "python3"]
    : ["python3", "python", "/usr/bin/python3", "/opt/homebrew/bin/python3"];
  for (const bin of candidates) {
    if (bin === "py") {
      try {
        await execFileAsync("py", ["-3", "-c", "print(1)"], { timeout: 4000, windowsHide: true });
        return { command: "py", argsPrefix: ["-3"] };
      } catch {
        continue;
      }
    }
    const found = await whichBin(bin);
    if (found || bin.startsWith("/")) {
      try {
        await execFileAsync(found || bin, ["-c", "print(1)"], { timeout: 4000, windowsHide: true });
        return { command: found || bin, argsPrefix: [] };
      } catch {
        /* try next */
      }
    }
  }
  return { command: isWin() ? "python" : "python3", argsPrefix: [] };
}

/**
 * Resize an image with ImageMagick, avoiding Windows convert.exe clash.
 * Returns resized buffer or original on failure.
 */
export function resizeImageBufferSync(inputBuffer, { maxEdge = 1280, quality = 85 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clyra-img-"));
  const input = path.join(dir, "in.png");
  const output = path.join(dir, "out.jpg");
  try {
    fs.writeFileSync(input, inputBuffer);
    const args = [input, "-resize", `${maxEdge}x${maxEdge}>`, "-quality", String(quality), output];
    // Prefer `magick` (IM7). Never call bare `convert` on Windows (filesystem tool).
    const attempts = isWin()
      ? [["magick", args]]
      : [
          ["magick", args],
          ["convert", args],
        ];
    for (const [bin, binArgs] of attempts) {
      try {
        execFileSync(bin, binArgs, { timeout: 15_000, windowsHide: true });
        if (fs.existsSync(output)) return fs.readFileSync(output);
      } catch {
        /* try next */
      }
    }
    return inputBuffer;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Load KEY=VALUE files into process.env without overriding existing values. */
export function loadEnvFile(filePath, { override = false } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (!override && process.env[key] != null && process.env[key] !== "") continue;
    process.env[key] = value;
  }
  return true;
}

export function electronBin(appDir) {
  const local = isWin()
    ? path.join(appDir, "node_modules", "electron", "dist", "electron.exe")
    : path.join(appDir, "node_modules", ".bin", "electron");
  if (fs.existsSync(local)) return local;
  // Fallback to cli shim
  return path.join(appDir, "node_modules", ".bin", isWin() ? "electron.cmd" : "electron");
}

export function spawnElectron(appDir, args = [], env = {}) {
  const bin = electronBin(appDir);
  const childEnv = { ...process.env, ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  return spawn(bin, [".", ...args], {
    cwd: appDir,
    env: childEnv,
    stdio: "inherit",
    windowsHide: false,
    shell: isWin() && bin.endsWith(".cmd"),
  });
}
