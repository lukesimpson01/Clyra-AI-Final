import assert from "node:assert/strict";
import { routeSpeechIntent } from "../src/speech/intentRouter";
import { EndpointDetector } from "../src/speech/endpointDetector";
import { TranscriptStabilizer } from "../src/speech/transcriptStabilizer";

assert.equal(routeSpeechIntent("Make this shorter and more professional.", { selectedText: "A long paragraph" }).intent, "REWRITE_SELECTION");
assert.equal(routeSpeechIntent("Reply saying Friday works for me.").intent, "INSERT_GENERATED_TEXT");
assert.equal(routeSpeechIntent("Hey Sam I'll be there at five.").intent, "DICTATE");
assert.equal(routeSpeechIntent("Delete that last sentence.").intent, "DELETE_TEXT");

const detector = new EndpointDetector();
assert.equal(detector.push({ level: .12, partial: "yeah", now: 0 }), false);
assert.equal(detector.push({ level: 0, partial: "yeah", now: 300 }), false);
assert.equal(detector.push({ level: 0, partial: "yeah", now: 660 }), true);
detector.reset(); detector.push({ level: .12, partial: "I think that", now: 0 });
assert.equal(detector.push({ level: 0, partial: "I think that", now: 600 }), false);

const stabilizer = new TranscriptStabilizer();
assert.equal(stabilizer.update("I will arrive Tuesday"), "I will arrive Tuesday");
assert.equal(stabilizer.update("I will arrive Thursday"), "I will arrive Thursday");
console.log("speech-flow-unit-tests: 10 assertions passed");
