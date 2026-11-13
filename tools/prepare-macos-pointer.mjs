/**
 * Build the macOS CGEvent pointer helper into Electron's asar-unpacked area.
 * Shipping a prebuilt helper avoids requiring Xcode/Swift on user machines.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const root = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const source = path.join(root, "electron", "native-pointer.swift");
  const binary = path.join(root, "electron", "native-pointer-darwin");
  await mkdir(path.dirname(binary), { recursive: true });
  try {
    await promisify(execFile)("xcrun", ["swiftc", source, "-O", "-o", binary], { timeout: 90_000 });
    await chmod(binary, 0o755);
    console.log("macOS native cursor helper built for Electron packaging.");
  } catch (error) {
    throw new Error("macOS native pointer helper build failed. Install Xcode Command Line Tools on the BUILD machine: " + (error?.message || error));
  }
}
