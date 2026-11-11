import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCapabilityMatrix, probePlatformCapabilities, type HostProbe } from "../lib/clyra-code/platform/capabilities";
import { classifyDirectory, detectProjectTargets, primaryTarget } from "../lib/clyra-code/targets/detect";
import { parseBuildDiagnostics, summarizeDiagnostics } from "../lib/clyra-code/diagnostics/parse-diagnostics";
import {
  parseSwiftBuildSeconds, parseSwiftTests, runSwiftPackage, swiftArgs, SwiftPackageError,
} from "../lib/clyra-code/swift/swift-package";
import { parseSimctlDevices, listSimulators, runtimeLabel } from "../lib/clyra-code/ios/simulators";
import { execFileSync } from "node:child_process";

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
const ok = (value: unknown, message?: string) => { assertions += 1; assert.ok(value, message); };
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.deepEqual(actual, expected, message); };

// A host probe with everything present, used as the base for the matrix tests.
const fullXcodeMac: HostProbe = {
  platform: "darwin", arch: "arm64", osVersion: "24.6.0",
  developerDir: "/Applications/Xcode.app/Contents/Developer", hasFullXcode: true, xcodeVersion: "Xcode 26.1",
  simctlPath: "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
  swiftPath: "/usr/bin/swift", swiftVersion: "Swift version 6.2", sourceKitLspPath: "/usr/bin/sourcekit-lsp",
};
const cltOnlyMac: HostProbe = {
  ...fullXcodeMac,
  developerDir: "/Library/Developer/CommandLineTools", hasFullXcode: false, xcodeVersion: null, simctlPath: null,
};
const windowsHost: HostProbe = {
  platform: "win32", arch: "x64", osVersion: "10.0.22631",
  developerDir: null, hasFullXcode: false, xcodeVersion: null, simctlPath: null,
  swiftPath: "C:\\Swift\\bin\\swift.exe", swiftVersion: "Swift version 6.1", sourceKitLspPath: "C:\\Swift\\bin\\sourcekit-lsp.exe",
};

async function main() {
  await test("parses located, unlocated and warning diagnostics", () => {
    const output = [
      "/work/Sources/App/Model.swift:12:5: error: cannot find 'Store' in scope",
      "/work/Sources/App/View.swift:3:1: warning: variable 'x' was never used",
      "error: no such module 'Missing'",
      "Build complete! (1.2s)",
    ].join("\n");
    const diagnostics = parseBuildDiagnostics(output);
    equal(diagnostics.length, 3);
    equal(diagnostics[0], { file: "/work/Sources/App/Model.swift", line: 12, column: 5, severity: "error", message: "cannot find 'Store' in scope" });
    equal(diagnostics[1].severity, "warning");
    equal(diagnostics[2], { severity: "error", message: "no such module 'Missing'" });
    equal(summarizeDiagnostics(diagnostics), { errors: 2, warnings: 1 });
  });

  await test("de-duplicates repeated diagnostics", () => {
    const line = "/w/A.swift:1:1: error: boom";
    equal(parseBuildDiagnostics(`${line}\n${line}\n`).length, 1);
  });

  await test("matrix: full Xcode on macOS makes the Simulator available", () => {
    const matrix = buildCapabilityMatrix(fullXcodeMac);
    equal(matrix.apple.iosSimulator.state, "available");
    equal(matrix.apple.iosBuild.state, "available");
    equal(matrix.activities.simulate.state, "available");
  });

  await test("matrix: Command Line Tools never enable iOS build or Simulator", () => {
    const matrix = buildCapabilityMatrix(cltOnlyMac);
    equal(matrix.apple.xcode.state, "unavailable");
    equal(matrix.apple.iosBuild.state, "unavailable");
    equal(matrix.apple.iosSimulator.state, "unavailable");
    ok(/Command Line Tools/.test(matrix.apple.iosSimulator.reason), "reason must name the Command Line Tools limitation");
    // Swift still works: this is the Windows-equivalent authoring path.
    equal(matrix.swift.toolchain.state, "available");
    equal(matrix.swift.packageManager.state, "available");
  });

  await test("matrix: Windows never shows a Simulator, but keeps Swift authoring", () => {
    const matrix = buildCapabilityMatrix(windowsHost);
    equal(matrix.apple.iosSimulator.state, "unavailable");
    equal(matrix.apple.iosBuild.state, "unavailable");
    equal(matrix.activities.simulate.state, "unavailable");
    equal(matrix.activities.sign.state, "unavailable");
    equal(matrix.swift.sourceKitLsp.state, "available");
    equal(matrix.activities.author.state, "available");
  });

  await test("matrix: missing Swift toolchain disables package build without touching web", () => {
    const matrix = buildCapabilityMatrix({ ...cltOnlyMac, swiftPath: null, swiftVersion: null, sourceKitLspPath: null });
    equal(matrix.swift.toolchain.state, "unavailable");
    equal(matrix.activities.build.state, "unavailable");
    equal(matrix.activities.run.state, "available", "web and Node run must not depend on Swift");
  });

  await test("every unavailable capability carries a reason", () => {
    for (const probe of [cltOnlyMac, windowsHost]) {
      const matrix = buildCapabilityMatrix(probe);
      const all = [...Object.values(matrix.apple), ...Object.values(matrix.swift), ...Object.values(matrix.activities)];
      for (const capability of all) {
        ok(capability.reason.length > 0, "each capability must explain itself");
      }
    }
  });

  await test("live host probe matches what this Mac actually has", async () => {
    const matrix = await probePlatformCapabilities();
    if (process.platform !== "darwin") return;
    // This host runs only Command Line Tools. The Simulator must be reported unavailable.
    const developerDir = execFileSync("/usr/bin/xcode-select", ["-p"], { encoding: "utf8" }).trim();
    if (!developerDir.endsWith("/Xcode.app/Contents/Developer")) {
      equal(matrix.apple.iosSimulator.state, "unavailable", "no full Xcode, so the Simulator must not be reported");
    }
    equal(typeof matrix.host.platform, "string");
  });

  await test("target: Package.swift is a Swift package", () => {
    equal(classifyDirectory(".", ["Package.swift", "Sources", "Tests"])?.target, "swift-package");
  });

  await test("target: Xcode project wins over a co-located Package.swift", () => {
    const target = classifyDirectory("App", ["App.xcodeproj", "Package.swift", "Sources"]);
    equal(target?.target, "ios-native");
    ok(target?.evidence.includes("App.xcodeproj"));
  });

  await test("target: web, electron and backend come from package.json dependencies", () => {
    equal(classifyDirectory(".", ["package.json"], { dependencies: ["react", "vite"], scripts: ["dev"] })?.target, "web");
    equal(classifyDirectory(".", ["package.json"], { dependencies: ["electron"], main: "electron/main.mjs", scripts: [] })?.target, "electron");
    equal(classifyDirectory(".", ["package.json"], { dependencies: ["express"], scripts: [] })?.target, "backend");
  });

  await test("target: an empty folder is not a target", () => {
    equal(classifyDirectory(".", ["notes.txt"]), null);
  });

  await test("detects a multi-package repository from root and children", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-targets-"));
    try {
      mkdirSync(path.join(root, "core"));
      writeFileSync(path.join(root, "core", "Package.swift"), "// swift-tools-version:6.0\n");
      mkdirSync(path.join(root, "web"));
      writeFileSync(path.join(root, "web", "package.json"), JSON.stringify({ dependencies: { next: "15" } }));
      mkdirSync(path.join(root, "node_modules", "ignored"), { recursive: true });
      writeFileSync(path.join(root, "node_modules", "ignored", "package.json"), JSON.stringify({ dependencies: { react: "1" } }));
      const targets = await detectProjectTargets(root);
      equal(targets.map((t) => `${t.location}:${t.target}`).sort(), ["core:swift-package", "web:web"]);
      equal(primaryTarget(targets)?.location, "core");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("swift arguments are fixed arrays with validated options", () => {
    equal(swiftArgs("build", { configuration: "release" }), ["build", "--configuration", "release"]);
    equal(swiftArgs("test", { filter: "AppTests.testAdd" }), ["test", "--filter", "AppTests.testAdd"]);
    equal(swiftArgs("run", { product: "tool" }), ["run", "tool"]);
    equal(swiftArgs("show-dependencies"), ["package", "show-dependencies", "--format", "json"]);
  });

  await test("swift arguments reject shell syntax and misplaced options", () => {
    const rejects = (fn: () => unknown) => assert.throws(fn, SwiftPackageError);
    rejects(() => swiftArgs("test", { filter: "x; rm -rf ~" }));
    rejects(() => swiftArgs("run", { product: "tool && curl evil" }));
    rejects(() => swiftArgs("build", { filter: "A.b" }));
    rejects(() => swiftArgs("build", { product: "tool" }));
    rejects(() => swiftArgs("build", { configuration: "profile" as "debug" }));
    assertions += 5;
  });

  await test("parses build time and XCTest totals", () => {
    equal(parseSwiftBuildSeconds("Build complete! (3.71s)"), 3.71);
    equal(parseSwiftTests("Test Suite 'All tests' passed.\nExecuted 42 tests, with 0 failures (0 unexpected) in 2.100 (2.150) seconds"), {
      framework: "xctest", total: 42, failed: 0, passed: 42, durationSeconds: 2.1,
    });
    equal(parseSwiftTests("Executed 3 tests, with 1 failure (0 unexpected) in 0.5 (0.6) seconds")?.failed, 1);
  });

  await test("parses Swift Testing totals", () => {
    equal(parseSwiftTests("✔ Test run with 84 tests in 12 suites passed after 4.100 seconds."), {
      framework: "swift-testing", total: 84, failed: 0, passed: 84, durationSeconds: 4.1,
    });
    equal(parseSwiftTests("✘ Test run with 5 tests in 2 suites failed after 0.2 seconds.")?.failed, 5);
    equal(parseSwiftTests("nothing relevant"), undefined);
    equal(parseSwiftTests("Executed 0 tests, with 0 failures (0 unexpected) in 0.0 (0.0) seconds\n✔ Test run with 2 tests in 0 suites passed after 0.013 seconds."), {
      framework: "swift-testing", total: 2, failed: 0, passed: 2, durationSeconds: 0.013,
    });
  });

  await test("simctl runtime labels come from the identifier", () => {
    equal(runtimeLabel("com.apple.CoreSimulator.SimRuntime.iOS-26-0"), "iOS 26.0");
    equal(runtimeLabel("com.apple.CoreSimulator.SimRuntime.watchOS-11-5"), "watchOS 11.5");
    equal(runtimeLabel("unknown-runtime"), "unknown-runtime");
  });

  await test("simctl parser keeps only available, well-formed devices", () => {
    const devices = parseSimctlDevices({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
          { udid: "AAA", name: "iPhone 17", state: "Booted", isAvailable: true },
          { udid: "BBB", name: "iPad Air", state: "Shutdown", isAvailable: false },
          { name: "missing udid", state: "Shutdown" },
        ],
        "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
          { udid: "CCC", name: "iPhone 16", state: "Shutdown", isAvailable: true },
        ],
      },
    });
    equal(devices.map((d) => [d.udid, d.runtime, d.state]), [
      ["AAA", "iOS 26.0", "Booted"],
      ["CCC", "iOS 18.6", "Shutdown"],
    ]);
    equal(parseSimctlDevices(null), []);
    equal(parseSimctlDevices({ devices: "nope" }), []);
  });

  await test("simulator listing refuses without calling simctl when unavailable", async () => {
    const matrix = buildCapabilityMatrix(cltOnlyMac);
    const listing = await listSimulators(matrix);
    equal(listing.ok, false);
    if (!listing.ok) ok(/Command Line Tools/.test(listing.reason));
  });

  // Real toolchain execution, only when this host has a Swift toolchain.
  const hasSwift = (() => {
    try { execFileSync("swift", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
  })();

  await test("real swift build and test run on a fresh package", async () => {
    if (!hasSwift) { console.log("      (skipped: no swift toolchain)"); return; }
    const root = mkdtempSync(path.join(tmpdir(), "clyra-swift-ok-"));
    try {
      mkdirSync(path.join(root, "Sources", "Demo"), { recursive: true });
      mkdirSync(path.join(root, "Tests", "DemoTests"), { recursive: true });
      writeFileSync(path.join(root, "Package.swift"), `// swift-tools-version:5.9
import PackageDescription
let package = Package(
  name: "Demo",
  platforms: [.macOS(.v14)],
  targets: [
    .target(name: "Demo"),
    .testTarget(name: "DemoTests", dependencies: ["Demo"]),
  ]
)
`);
      writeFileSync(path.join(root, "Sources", "Demo", "Demo.swift"), "public func add(_ a: Int, _ b: Int) -> Int { a + b }\n");
      writeFileSync(path.join(root, "Tests", "DemoTests", "DemoTests.swift"), `import Testing
@testable import Demo
@Test func addWorks() { #expect(add(2, 3) == 5) }
@Test func addIsCommutative() { #expect(add(1, 4) == add(4, 1)) }
`);
      const build = await runSwiftPackage(root, "build", { timeoutMs: 300_000 });
      equal(build.ok, true, `build should succeed: ${build.tail}`);
      ok(typeof build.durationMs === "number" && build.durationMs > 0);
      const testRun = await runSwiftPackage(root, "test", { timeoutMs: 300_000 });
      equal(testRun.ok, true, `tests should pass: ${testRun.tail}`);
      equal(testRun.tests?.failed, 0);
      ok((testRun.tests?.total ?? 0) >= 1, `at least one test must be counted from real output; tail: ${testRun.tail}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("real swift build reports structured compiler errors", async () => {
    if (!hasSwift) { console.log("      (skipped: no swift toolchain)"); return; }
    const root = mkdtempSync(path.join(tmpdir(), "clyra-swift-bad-"));
    try {
      mkdirSync(path.join(root, "Sources", "Broken"), { recursive: true });
      writeFileSync(path.join(root, "Package.swift"), `// swift-tools-version:5.9
import PackageDescription
let package = Package(name: "Broken", targets: [.target(name: "Broken")])
`);
      writeFileSync(path.join(root, "Sources", "Broken", "Broken.swift"), "public func f() -> Int {\n  return undefinedSymbol\n}\n");
      const build = await runSwiftPackage(root, "build", { timeoutMs: 300_000 });
      equal(build.ok, false);
      ok(build.diagnosticCounts.errors >= 1, "compile error must be counted");
      const located = build.diagnostics.find((d) => d.severity === "error" && d.file?.endsWith("Broken.swift"));
      ok(located, "the error must carry its file");
      equal(located?.line, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await test("swift command refuses a directory without Package.swift", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "clyra-swift-none-"));
    try {
      let threw = false;
      try { await runSwiftPackage(root, "build"); } catch (error) { threw = error instanceof SwiftPackageError; }
      equal(threw, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`\nClyra Code platform — ${assertions} assertions`);
  console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
