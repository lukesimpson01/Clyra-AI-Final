import assert from "node:assert/strict";
import { detectPlatformIntent, shouldAskPlatform } from "../src/components/clyra-code/store";
import { BRIEF_COPY, DESIGN_LANGUAGE, PRODUCT_BAR, answerDirective, briefLine, isBriefPlatform, platformDirective, platformFromAnswer } from "../src/components/clyra-code/appBrief";

let assertions = 0;
let failures = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
};
const equal = (actual: unknown, expected: unknown, message?: string) => { assertions += 1; assert.deepEqual(actual, expected, message); };
const ok = (value: unknown, message?: string) => { assertions += 1; assert.ok(value, message); };

test("iOS prompts are detected as iOS, including iPhone and SwiftUI wording", () => {
  equal(detectPlatformIntent("Build me an iPhone expense tracker"), "ios");
  equal(detectPlatformIntent("Build a SwiftUI habit tracker"), "ios");
  equal(detectPlatformIntent("Make an iOS app for gym workouts"), "ios");
  equal(detectPlatformIntent("Build a native iOS app with tabs"), "ios");
});

test("desktop and web prompts keep their existing detection", () => {
  equal(detectPlatformIntent("Build a desktop app for notes"), "desktop");
  equal(detectPlatformIntent("Build an Electron tool"), "desktop");
  equal(detectPlatformIntent("Build a website for my bakery"), "web");
  equal(detectPlatformIntent("Make a React dashboard"), "web");
});

test("styling-only mentions of iOS or Apple never select a platform", () => {
  equal(detectPlatformIntent("Build a website with an iOS-style look"), "web");
  equal(detectPlatformIntent("Build a website with an iOS style"), "web");
  equal(detectPlatformIntent("Build a web app with an Apple theme"), "web");
});

test("prompts naming two platforms are ambiguous and ask the user", () => {
  equal(detectPlatformIntent("Build a website that also works on iPhone"), null);
  equal(detectPlatformIntent("Build a desktop app and an iOS app"), null);
  equal(shouldAskPlatform("Build a website that also works on iPhone"), true, "an ambiguous two-platform request must ask instead of guessing");
});

test("a request with no platform signal still asks which platform to target", () => {
  equal(shouldAskPlatform("Build me a habit tracker app"), true);
  equal(shouldAskPlatform("Fix the header spacing"), false);
});

test("the platform question maps every option to the right platform", () => {
  equal(platformFromAnswer("Web app"), "web");
  equal(platformFromAnswer("Desktop app"), "desktop");
  equal(platformFromAnswer("iOS app"), "ios");
  equal(platformFromAnswer("Choose for me"), null);
});

test("answer directives keep the existing framework choices and add iOS", () => {
  ok(/Tauri desktop app/.test(answerDirective("Tauri")));
  ok(/Electron desktop app/.test(answerDirective("Electron")));
  ok(/Record the decision/.test(answerDirective("Choose for me")));
  ok(/native iOS app in SwiftUI/.test(answerDirective("iOS app")));
  ok(/Build this as a responsive website/.test(answerDirective("Web app")));
});

test("every chip platform has a directive and a complete brief", () => {
  for (const platform of ["web", "desktop", "ios"] as const) {
    ok(isBriefPlatform(platform));
    ok(/Build this as/.test(platformDirective(platform)), `${platform} directive must say what to build`);
    const copy = BRIEF_COPY[platform];
    ok(copy.label && copy.noun && copy.functionExample && copy.stylingExample, `${platform} brief must be complete`);
  }
  ok(!isBriefPlatform("android"));
});

test("the iOS directive forbids claiming a simulator or device run that did not happen", () => {
  const directive = platformDirective("ios");
  ok(/SwiftUI/.test(directive));
  ok(/do not claim/i.test(directive), "must tell the agent not to claim unverified runs");
  ok(/simulator or device/i.test(directive));
});

test("every platform directive carries the product bar and the design language", () => {
  for (const platform of ["web", "desktop", "ios"] as const) {
    const directive = platformDirective(platform);
    ok(directive.includes(PRODUCT_BAR), `${platform} must expand the request into a complete product`);
    ok(directive.includes(DESIGN_LANGUAGE), `${platform} must use the shared design language`);
  }
  for (const answer of ["Tauri", "Electron", "Choose for me"]) {
    ok(answerDirective(answer).includes(PRODUCT_BAR), `${answer} answer must carry the product bar`);
  }
});

test("the iOS directive asks for a Swift Testing deployment target and native structure", () => {
  const directive = platformDirective("ios");
  ok(/macOS 14/.test(directive), "Swift Testing needs macOS 14 in Package.swift");
  ok(/NavigationStack/.test(directive) && /TabView/.test(directive));
  ok(/Dynamic Type/.test(directive) && /accessibility labels/.test(directive));
});

test("the desktop directive enforces Electron's security boundary", () => {
  const directive = platformDirective("desktop");
  ok(/contextIsolation true/.test(directive) && /nodeIntegration false/.test(directive));
  ok(/typed preload bridge/.test(directive));
});

test("iOS examples describe native structure, not web layouts", () => {
  ok(/tabs|Settings/.test(BRIEF_COPY.ios.functionExample));
  ok(/Dynamic Type/.test(BRIEF_COPY.ios.stylingExample));
  ok(!/iphone 1\d|simulator/i.test(BRIEF_COPY.ios.stylingExample), "copy must not present a simulator as available");
});

test("example lines are labelled so the agent can tell behaviour from presentation", () => {
  equal(briefLine("function", "x"), "What it does: x");
  equal(briefLine("styling", "y"), "How it looks: y");
});

console.log(`\nClyra Code brief — ${assertions} assertions`);
console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
