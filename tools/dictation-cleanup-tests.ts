import assert from "node:assert/strict";
import { classifyApp, cleanDictation, looksLikeInstruction } from "../electron/dictation-cleanup.mjs";

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
// The correction replaces only what it corrects, keeping everything before it
assert.equal(c("send the the quarterly report to sam no wait to priya before friday"), "Send the quarterly report to priya before friday.");
assert.equal(c("meet at five no wait at six pm"), "Meet at six pm.");
// Number / time corrections (the "5 minutes... actually 6" case)
assert.equal(c("set a timer for 5 minutes actually 6"), "Set a timer for 6 minutes.");
assert.equal(c("Set a timer for 5 minutes, actually 6."), "Set a timer for 6 minutes.");
assert.equal(c("hey let's meet at 5pm, actually let's do 6pm"), "Hey let's meet at 6pm.");
assert.equal(c("call me at 5 no wait 6 pm"), "Call me at 6 pm.");
assert.equal(c("it costs 5 dollars actually 6 dollars"), "It costs 6 dollars.");
assert.equal(c("remind me in five minutes actually ten minutes"), "Remind me in ten minutes.");
assert.equal(c("set a timer for 5 minutes actually 6 hours"), "Set a timer for 6 hours.");
assert.equal(cleanDictation("i actually like it").text, "I actually like it.");
assert.equal(c("send it to sam, actually to priya"), "Send it to priya.");
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
// A correction the rules resolved no longer needs the model (it could only undo it)
assert.equal(cleanDictation("set a timer for 5 minutes actually 6").needsModel, false);
// A correction only replaces its own clause; the rest of the sentence survives
assert.equal(c("Set a timer for five minutes, actually six, and remind me to call Priya before Friday."), "Set a timer for six minutes, and remind me to call Priya before Friday.");
assert.equal(c("meet at three actually four pm, then lunch"), "Meet at four pm, then lunch.");
// A spoken number can be several words: the whole run is replaced ("nine" -> "ten thirty", not "thirty")
assert.equal(c("Remind me to call Claire tomorrow at nine, no wait, make that ten thirty."), "Remind me to call Claire tomorrow at ten thirty.");
assert.equal(c("Book it for twenty five people, I mean thirty"), "Book it for thirty people.");
// The model sometimes writes "ten thirty" as 1030: after a time word it is a clock time, and a correction swaps it in whole
assert.equal(c("Remind me to call Claire tomorrow at 9, no wait, make that 1030."), "Remind me to call Claire tomorrow at 10:30.");
assert.equal(c("Let's meet at 530 tomorrow"), "Let's meet at 5:30 tomorrow.");
assert.equal(c("it costs 1030 dollars"), "It costs 1030 dollars.");
assert.equal(c("we sold 2500 units"), "We sold 2500 units.");
assert.equal(c("open now, and, uh, add it as a stop"), "Open now, and add it as a stop.");
// Selection routing: instruction vs replacement text
for (const yes of ["make it sound smarter", "Make it longer.", "rewrite this more formally", "translate to French", "shorten it", "fix the grammar", "can you make this friendlier", "turn this into bullet points", "add more detail", "summarize"]) assert.equal(looksLikeInstruction(yes), true, yes);
for (const no of ["see you at six tomorrow", "add milk to the list", "the quarterly numbers look strong", "I think we should make a plan for the trip next week because it will be fun", "thanks for your help"]) assert.equal(looksLikeInstruction(no), false, no);
console.log("dictation-cleanup-tests: all assertions passed");
