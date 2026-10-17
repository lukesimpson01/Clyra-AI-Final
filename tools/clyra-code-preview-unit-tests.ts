import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCapabilityMatrix, type HostProbe } from "../lib/clyra-code/platform/capabilities";
import { projectCapabilities, resolvePreview } from "../lib/clyra-code/preview/resolver";
import { detectProjectTargets, type DetectedTarget } from "../lib/clyra-code/targets/detect";
import { setUnavailablePreview } from "../lib/vibe-coder/preview/preview-runner";
import { runWorkspaceValidation } from "../lib/vibe-runtime/validation";

let assertions = 0;
let failures = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
};
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const ok = (value: unknown, message?: string) => { assertions += 1; assert.ok(value, message); };

const cltMac: HostProbe = {
  platform: "darwin", arch: "arm64", osVersion: "24.6.0",
  developerDir: "/Library/Developer/CommandLineTools", hasFullXcode: false, xcodeVersion: null, simctlPath: null,
  swiftPath: "/usr/bin/swift", swiftVersion: "Swift 6.1", sourceKitLspPath: "/usr/bin/sourcekit-lsp",
};
const xcodeMac: HostProbe = {
  ...cltMac,
  developerDir: "/Applications/Xcode.app/Contents/Developer", hasFullXcode: true, xcodeVersion: "Xcode 26",
  simctlPath: "/usr/bin/simctl",
};
const cltMatrix = buildCapabilityMatrix(cltMac);
const xcodeMatrix = buildCapabilityMatrix(xcodeMac);
const target = (t: DetectedTarget["target"], location = "."): DetectedTarget => ({ target: t, location, evidence: [] });

function listing(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      out.push(path.relative(dir, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

async function main() {
  await test("a native iOS project resolves to the iOS provider, never a browser provider", () => {
    const r = resolvePreview([target("ios-native")], cltMatrix);
    equal(r.provider, "IOSSimulatorPreviewProvider");
    equal(r.kind, "ios-simulator");
    equal(r.available, false);
    ok(/unavailable/i.test(r.reason), "the reason must say the runtime is unavailable");
  });

  await test("an iOS project on a Mac with Xcode still does not claim a simulator preview it cannot run", () => {
    const r = resolvePreview([target("ios-native")], xcodeMatrix);
    equal(r.kind, "ios-simulator");
    equal(r.available, false, "the simulator preview is not implemented in this build");
    ok(/not implemented/i.test(r.reason));
  });

  await test("a host that has not been probed reports iOS as unavailable", () => {
    const r = resolvePreview([target("ios-native")], null);
    equal(r.available, false);
    ok(/not been checked/i.test(r.reason));
  });

  await test("a web project resolves to the browser dev-server provider", () => {
    equal(resolvePreview([target("web")], cltMatrix).provider, "WebPreviewProvider");
  });

  await test("an Electron project resolves to the real Electron process provider", () => {
    const r = resolvePreview([target("electron")], cltMatrix);
    equal(r.provider, "ElectronPreviewProvider");
    equal(r.kind, "electron");
  });

  await test("a Swift package has no visual preview and says how to run it", () => {
    const r = resolvePreview([target("swift-package")], cltMatrix);
    equal(r.kind, "none");
    ok(/swift run|swift test/.test(r.reason));
  });

  await test("nothing recognised reports that there is nothing to preview", () => {
    equal(resolvePreview([], cltMatrix).provider, "NoRuntimePreviewProvider");
  });

  await test("the root target is preferred when several targets exist", () => {
    equal(resolvePreview([target("ios-native", "app"), target("web", ".")], cltMatrix).kind, "browser");
    equal(resolvePreview([target("swift-package", "."), target("web", "web")], cltMatrix).kind, "browser", "a non-previewable root falls through to the web target");
  });

  await test("project capabilities reflect the real host, not the mere presence of files", () => {
    const ios = projectCapabilities([target("ios-native")], cltMatrix);
    equal(ios.previewKind, "ios-simulator");
    equal(ios.canPreview, false);
    equal(ios.canAuthor, true, "source can always be authored");
    const web = projectCapabilities([target("web")], cltMatrix);
    equal(web.canPreview, true);
    equal(web.previewKind, "browser");
  });

  await test("resolving a native iOS project creates no file, and detection writes nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-preview-ios-"));
    try {
      mkdirSync(path.join(root, "Sources", "App"), { recursive: true });
      writeFileSync(path.join(root, "Package.swift"), "// swift-tools-version:6.0\n");
      writeFileSync(path.join(root, "Sources", "App", "App.swift"), "import SwiftUI\n");
      const before = listing(root);
      const targets = await detectProjectTargets(root);
      resolvePreview(targets, cltMatrix);
      equal(listing(root), before, "resolution and detection must not create or change any file");
      ok(!before.includes("index.html"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("an unavailable iOS preview is recorded without starting a process or writing HTML", () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-preview-state-"));
    try {
      mkdirSync(path.join(root, "Sources"), { recursive: true });
      writeFileSync(path.join(root, "Package.swift"), "// swift-tools-version:6.0\n");
      const before = listing(root);
      const session = setUnavailablePreview({
        projectId: `test-${Date.now()}`,
        projectPath: root,
        title: "Native iOS runtime unavailable",
        message: "Native iOS runtime verification is unavailable on this host.",
      });
      equal(session.status, "build_failed");
      equal(session.devCommand, "none");
      equal(session.lastError?.title, "Native iOS runtime unavailable");
      equal(listing(root), before, "no file may be added to the project");
      ok(!listing(root).includes("index.html"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("an Xcode project without the Xcode toolchain is skipped, not passed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-validate-xcode-"));
    try {
      mkdirSync(path.join(root, "App.xcodeproj"));
      const evidence = await runWorkspaceValidation(root);
      equal(evidence.length, 1);
      equal(evidence[0].status, "skipped");
      ok(/not run/.test(evidence[0].output ?? ""));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a project with no recognised target is skipped, and validation creates no HTML page", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-validate-empty-"));
    try {
      writeFileSync(path.join(root, "AGENTS.md"), "# Notes\n");
      const before = listing(root);
      const evidence = await runWorkspaceValidation(root);
      equal(evidence.map((e) => e.status), ["skipped"], "an empty project must not be reported as failed");
      equal(listing(root), before, "validation must not create files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("a Swift package is validated with the real toolchain, never as a static HTML site", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-validate-swift-"));
    try {
      mkdirSync(path.join(root, "Sources", "Demo"), { recursive: true });
      mkdirSync(path.join(root, "Tests", "DemoTests"), { recursive: true });
      writeFileSync(path.join(root, "Package.swift"), `// swift-tools-version:6.0
import PackageDescription
let package = Package(name: "Demo", platforms: [.macOS(.v14)], targets: [.target(name: "Demo"), .testTarget(name: "DemoTests", dependencies: ["Demo"])])
`);
      writeFileSync(path.join(root, "Sources", "Demo", "Demo.swift"), "public func add(_ a: Int, _ b: Int) -> Int { a + b }\n");
      writeFileSync(path.join(root, "Tests", "DemoTests", "DemoTests.swift"), "import Testing\n@testable import Demo\n@Test func addWorks() { #expect(add(2, 3) == 5) }\n");
      const evidence = await runWorkspaceValidation(root);
      equal(evidence.map((e) => e.name), ["swift build", "swift test"]);
      equal(evidence.map((e) => e.status), ["passed", "passed"]);
      ok(!evidence.some((e) => e.name === "static HTML entry"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`\nClyra Code preview — ${assertions} assertions`);
  console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
