import assert from "node:assert/strict";
import { classifyApp, cleanDictation } from "../electron/dictation-cleanup.mjs";

const c = (text: string, opts = {}) => cleanDictation(text, opts).text;

// Fillers & stutters
assert.equal(c("um so i think uh we should go"), "So I think we should go.");
assert.equal(c("the the meeting is at five"), "The meeting is at five.");
// Spoken punctuation and layout
assert.equal(c("hello comma how are you question mark"), "Hello, how are you?");
assert.equal(c("first line new line second line"), "First line\nSecond line.");
assert.equal(c("thanks new paragraph best regards"), "Thanks\n\nBest regards.");
// Not a command: "period" as a noun stays
assert.match(c("it was a period of growth"), /period of growth/);
// Self-corrections
assert.equal(c("meet me at five no wait six"), "Meet me at six.");
assert.equal(c("send it today. scratch that. send it tomorrow"), "Send it tomorrow.");
// Emails and URLs
assert.equal(c("email me at sam at gmail dot com"), "Email me at sam@gmail.com.");
assert.match(c("go to clyra dot ai"), /clyra\.ai/);
// Dictionary: exact casing and near-miss
assert.match(c("open clyra settings", { dictionary: ["Clyra"] }), /Clyra/);
assert.match(c("ask clara about it", { dictionary: ["Clyra"] }), /Ask Clyra/); // the classic mishearing snaps onto the dictionary
assert.match(c("ask sarah about it", { dictionary: ["Clyra"] }), /Sarah|sarah/i); // unrelated words are left alone
assert.match(c("ping kayla about the quarterly review", { dictionary: ["Kaila"] }), /Kaila/);
// App-aware behaviour
assert.equal(classifyApp("Terminal"), "code");
assert.equal(classifyApp("Slack"), "casual");
assert.equal(classifyApp("Mail"), "formal");
assert.equal(c("git status dash dash short", { application: "Terminal" }), "git status dash dash short");
assert.equal(c("sounds good see you then", { application: "Messages" }), "Sounds good see you then");
assert.equal(c("sounds good see you then", { application: "Mail" }), "Sounds good see you then.");
// Raw level is untouched
assert.equal(c("um hello comma there", { level: "raw" }), "um hello comma there");
// Model escalation flag
assert.equal(cleanDictation("i want pizza actually make it pasta").needsModel, true);
assert.equal(cleanDictation("i want pasta").needsModel, false);
console.log("dictation-cleanup-tests: all assertions passed");
