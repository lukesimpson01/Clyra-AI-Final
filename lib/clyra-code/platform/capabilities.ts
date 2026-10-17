/**
 * Platform capability matrix for Clyra Code.
 *
 * Every capability is derived from a host probe. Nothing is inferred from the
 * fact that a project can be edited. A capability that a probe cannot confirm is
 * reported as "unavailable" with the reason, never as available.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CapabilityState = "available" | "unavailable";

export type Capability = {
  state: CapabilityState;
  /** Always set. Explains an unavailable state, or names the evidence for an available one. */
  reason: string;
};

export type HostProbe = {
  platform: NodeJS.Platform;
  arch: string;
  osVersion: string;
  /** Output of `xcode-select -p`, or null when it cannot be read. */
  developerDir: string | null;
  /** True only when developerDir points at a full Xcode.app, not Command Line Tools. */
  hasFullXcode: boolean;
  xcodeVersion: string | null;
  simctlPath: string | null;
  swiftPath: string | null;
  swiftVersion: string | null;
  sourceKitLspPath: string | null;
};

export type PlatformCapabilityMatrix = {
  host: { platform: NodeJS.Platform; arch: string; osVersion: string };
  swift: {
    toolchain: Capability;
    packageManager: Capability;
    sourceKitLsp: Capability;
  };
  apple: {
    xcode: Capability;
    iosBuild: Capability;
    iosSimulator: Capability;
    xctestIos: Capability;
    codeSigning: Capability;
    archive: Capability;
  };
  /** Generic activities. Apply to every project target that can run on this host. */
  activities: {
    author: Capability;
    build: Capability;
    run: Capability;
    simulate: Capability;
    debug: Capability;
    test: Capability;
    sign: Capability;
    distribute: Capability;
  };
};

const available = (reason: string): Capability => ({ state: "available", reason });
const unavailable = (reason: string): Capability => ({ state: "unavailable", reason });

export function buildCapabilityMatrix(probe: HostProbe): PlatformCapabilityMatrix {
  const isMac = probe.platform === "darwin";

  const swiftToolchain = probe.swiftPath && probe.swiftVersion
    ? available(`Swift toolchain at ${probe.swiftPath} (${probe.swiftVersion}).`)
    : unavailable("No Swift toolchain found. Install the Swift toolchain, then reopen Clyra Code.");

  const swiftPackageManager = probe.swiftPath && probe.swiftVersion
    ? available("Swift Package Manager ships with the Swift toolchain.")
    : unavailable("Requires the Swift toolchain.");

  const sourceKitLsp = probe.sourceKitLspPath
    ? available(`SourceKit-LSP at ${probe.sourceKitLspPath}.`)
    : unavailable("sourcekit-lsp was not found on PATH.");

  const xcode = !isMac
    ? unavailable(`Xcode requires macOS. This host is ${probe.platform}.`)
    : probe.hasFullXcode
      ? available(`Xcode ${probe.xcodeVersion ?? "(version unknown)"} at ${probe.developerDir}.`)
      : unavailable(
        probe.developerDir
          ? `Active developer directory is ${probe.developerDir}. Full Xcode is required; Command Line Tools cannot build or run iOS apps.`
          : "No active developer directory. Install Xcode from the App Store and select it with xcode-select.",
      );

  const iosBuild = !isMac
    ? unavailable("iOS builds require macOS with Xcode. This host cannot run Apple's iOS SDK.")
    : xcode.state === "available"
      ? available("xcodebuild is available for iOS builds.")
      : unavailable(xcode.reason);

  const iosSimulator = !isMac
    ? unavailable("The iOS Simulator requires macOS with Xcode. Not available on this host.")
    : xcode.state !== "available"
      ? unavailable(xcode.reason)
      : probe.simctlPath
        ? available(`simctl at ${probe.simctlPath}.`)
        : unavailable("simctl was not found in the active Xcode.");

  const xctestIos = iosBuild.state === "available" && iosSimulator.state === "available"
    ? available("XCTest can run on the iOS Simulator.")
    : unavailable("Requires macOS, Xcode and the iOS Simulator.");

  const codeSigning = iosBuild.state === "available"
    ? available("Signing is available. Identities are read only when a build needs them.")
    : unavailable("Requires macOS with Xcode.");

  const archive = iosBuild.state === "available"
    ? available("xcodebuild archive is available. Uploading is a separate, approval-gated action.")
    : unavailable("Requires macOS with Xcode.");

  const hasSwiftBuild = swiftToolchain.state === "available";

  return {
    host: { platform: probe.platform, arch: probe.arch, osVersion: probe.osVersion },
    swift: {
      toolchain: swiftToolchain,
      packageManager: swiftPackageManager,
      sourceKitLsp,
    },
    apple: { xcode, iosBuild, iosSimulator, xctestIos, codeSigning, archive },
    activities: {
      author: available("Source files can always be created and edited."),
      build: hasSwiftBuild
        ? available("Swift packages build with the Swift toolchain. Web and Node targets use their own build commands.")
        : unavailable("Swift packages need the Swift toolchain. Web and Node targets are unaffected."),
      run: available("Web, Node and Electron targets run through their project commands."),
      simulate: iosSimulator,
      debug: hasSwiftBuild
        ? available("Swift test and runtime diagnostics are available. LLDB needs a full Xcode install on macOS.")
        : unavailable("Requires the Swift toolchain."),
      test: available("Project test commands run on this host. Swift and XCTest results come from the real runner."),
      sign: codeSigning,
      distribute: archive,
    },
  };
}

async function run(file: string, args: string[], timeoutMs = 5000): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 });
    return `${stdout}${stderr}`.trim();
  } catch {
    return null;
  }
}

async function which(binary: string): Promise<string | null> {
  if (process.platform === "win32") {
    const out = await run("where", [binary]);
    return out ? out.split(/\r?\n/)[0].trim() : null;
  }
  const out = await run("/usr/bin/which", [binary]);
  return out ? out.trim() : null;
}

/** Probes the real host. Each probe is one fixed command with fixed arguments. */
export async function probeHost(): Promise<HostProbe> {
  const isMac = process.platform === "darwin";

  const developerDir = isMac ? await run("/usr/bin/xcode-select", ["-p"]) : null;
  const hasFullXcode = Boolean(developerDir && developerDir.endsWith("/Xcode.app/Contents/Developer") && existsSync(developerDir));
  const xcodeVersion = hasFullXcode ? await run("/usr/bin/xcodebuild", ["-version"]) : null;

  const simctlPath = hasFullXcode ? await run("/usr/bin/xcrun", ["--find", "simctl"]) : null;

  const swiftPath = await which("swift");
  const swiftVersionOutput = swiftPath ? await run(swiftPath, ["--version"]) : null;
  const swiftVersion = swiftVersionOutput ? swiftVersionOutput.split(/\r?\n/)[0].trim() : null;

  const sourceKitLspPath = await which("sourcekit-lsp");

  return {
    platform: process.platform,
    arch: os.arch(),
    osVersion: os.release(),
    developerDir,
    hasFullXcode,
    xcodeVersion: xcodeVersion ? xcodeVersion.split(/\r?\n/)[0].trim() : null,
    simctlPath: simctlPath ? simctlPath.trim() : null,
    swiftPath,
    swiftVersion,
    sourceKitLspPath,
  };
}

export async function probePlatformCapabilities(): Promise<PlatformCapabilityMatrix> {
  return buildCapabilityMatrix(await probeHost());
}
