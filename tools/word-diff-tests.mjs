import assert from "node:assert/strict";
import { hasEdits, wordDiff } from "../electron/word-diff.mjs";

const flat = (d) => d.map((s) => `${s.type}:${s.text}`).join(" | ");
// Fillers removed -> struck
assert.equal(flat(wordDiff("um so i think we should go", "So I think we should go.")), "del:um | same:So I think we should go.");
// Replacement reads old -> new
assert.equal(flat(wordDiff("meet at five no wait six", "Meet at six.")), "same:Meet at | del:five no wait | same:six.");
// Generated words are 'add'
assert.equal(flat(wordDiff("send the report", "Send the quarterly report.")), "same:Send the | add:quarterly | same:report.");
// Case / punctuation only -> calm (no edits)
assert.equal(hasEdits(wordDiff("hello there", "Hello, there.")), false);
// Too long to animate -> null
assert.equal(wordDiff(Array(200).fill("word").join(" "), "x"), null);
assert.equal(wordDiff("", "x"), null);
console.log("word-diff-tests: all assertions passed");
