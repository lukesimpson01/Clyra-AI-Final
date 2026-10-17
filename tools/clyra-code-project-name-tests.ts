import assert from "node:assert/strict";
import { displayNameFor, htmlTitleOf, isPromptDerivedName } from "../lib/clyra-code/projects/display-name";

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

test("a prompt-shaped name is recognised as derived", () => {
  equal(isPromptDerivedName("Build me a simple one-page website with a heading"), true);
  equal(isPromptDerivedName("Open a website and check if it's working"), true);
  equal(isPromptDerivedName("New project"), true);
});

test("an ordinary project name is kept", () => {
  equal(isPromptDerivedName("Eval Habit Tracker"), false);
  equal(isPromptDerivedName("Clyra"), false);
});

test("a prompt-named project takes its package name", () => {
  equal(displayNameFor({ name: "Build me a habit tracker app", packageName: "habit-tracker" }), "Habit Tracker");
});

test("a prompt-named project falls back to the page title", () => {
  equal(displayNameFor({ name: "Build me a habit tracker app", packageName: "react-example", htmlTitle: "Habit — build routines" }), "Habit — build routines");
});

test("a name the user typed is never replaced, even if it reads like a prompt", () => {
  equal(displayNameFor({ name: "Build Tracker", renamedByUser: true, packageName: "habit-tracker" }), "Build Tracker");
});

test("the stored name is returned when nothing better is known", () => {
  equal(displayNameFor({ name: "Build me a habit tracker app" }), "Build me a habit tracker app");
});

test("the page title is read from HTML", () => {
  equal(htmlTitleOf("<html><head><title>Gym Tracker</title></head></html>"), "Gym Tracker");
  equal(htmlTitleOf("<html></html>"), undefined);
});

console.log(`\nClyra Code project names — ${assertions} assertions`);
console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
process.exit(failures ? 1 : 0);
