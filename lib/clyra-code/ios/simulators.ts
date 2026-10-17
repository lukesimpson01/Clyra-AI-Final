/**
 * iOS Simulator discovery through `xcrun simctl`. Devices are listed from the real
 * tool output. No model names or runtimes are hard-coded. On a host without full
 * Xcode the listing is refused with a reason, never filled in.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PlatformCapabilityMatrix } from "../platform/capabilities";

const execFileAsync = promisify(execFile);

export type IOSSimulatorDevice = {
  udid: string;
  name: string;
  /** Human-readable runtime, e.g. "iOS 26.0". */
  runtime: string;
  /** Raw runtime identifier as simctl reports it. */
  runtimeIdentifier: string;
  state: "Booted" | "Shutdown";
  /** Raw state string, preserved so unusual states are visible rather than hidden. */
  rawState: string;
  available: boolean;
};

export type SimulatorListing =
  | { ok: true; devices: IOSSimulatorDevice[] }
  | { ok: false; reason: string };

/** "com.apple.CoreSimulator.SimRuntime.iOS-26-0" -> "iOS 26.0" */
export function runtimeLabel(identifier: string): string {
  const tail = identifier.split(".").pop() ?? identifier;
  const match = /^(iOS|watchOS|tvOS|xrOS|visionOS)-(\d+(?:-\d+)*)$/.exec(tail);
  if (!match) return tail;
  return `${match[1]} ${match[2].split("-").join(".")}`;
}

type SimctlDeviceEntry = { udid?: unknown; name?: unknown; state?: unknown; isAvailable?: unknown };
type SimctlListing = { devices?: Record<string, SimctlDeviceEntry[] | undefined> };

/** Parses `xcrun simctl list devices available --json`. Unknown or malformed entries are skipped. */
export function parseSimctlDevices(raw: unknown): IOSSimulatorDevice[] {
  const listing = raw as SimctlListing;
  if (!listing || typeof listing !== "object" || !listing.devices || typeof listing.devices !== "object") {
    return [];
  }
  const devices: IOSSimulatorDevice[] = [];
  for (const [runtimeIdentifier, entries] of Object.entries(listing.devices)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry?.udid !== "string" || typeof entry?.name !== "string") continue;
      const rawState = typeof entry.state === "string" ? entry.state : "Unknown";
      const available = entry.isAvailable !== false;
      if (!available) continue;
      devices.push({
        udid: entry.udid,
        name: entry.name,
        runtime: runtimeLabel(runtimeIdentifier),
        runtimeIdentifier,
        state: rawState === "Booted" ? "Booted" : "Shutdown",
        rawState,
        available,
      });
    }
  }
  return devices;
}

/** Lists installed simulators. Refuses when the capability matrix says the Simulator is unavailable. */
export async function listSimulators(matrix: PlatformCapabilityMatrix): Promise<SimulatorListing> {
  if (matrix.apple.iosSimulator.state !== "available") {
    return { ok: false, reason: matrix.apple.iosSimulator.reason };
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, devices: parseSimctlDevices(JSON.parse(stdout)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `simctl could not list simulators: ${message}` };
  }
}
