import assert from "node:assert/strict";
import { displayNameFor, htmlTitleOf } from "../lib/clyra-code/projects/display-name";

assert.equal(htmlTitleOf("<!doctype html><title>My &amp; Your Workspace</title>"), "My & Your Workspace");
assert.equal(htmlTitleOf("<head><TITLE class='app'>  Study   Planner  </TITLE></head>"), "Study Planner");
assert.equal(htmlTitleOf("<html><head></head><body>nothing</body></html>"), undefined);
assert.equal(displayNameFor({ name: "Saved custom name", renamedByUser: true, htmlTitle: "Different title" }), "Saved custom name");
assert.equal(displayNameFor({ name: "Untitled project", htmlTitle: "Finance dashboard", packageName: "untitled" }), "Finance dashboard");
assert.equal(displayNameFor({ name: "Starter", htmlTitle: "Vite + React", packageName: "@demo/customer-portal" }), "customer portal");
assert.equal(displayNameFor({ name: "Clyra project", htmlTitle: "<script>alert(1)</script>", packageName: "app" }), "Clyra project");
assert.equal(displayNameFor({ name: "" }), "Untitled project");
console.log("8 project display-name tests passed.");
