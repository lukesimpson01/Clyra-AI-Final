import assert from "node:assert/strict";
import { stopMediaStreamTracks } from "../src/lib/voicePcmCapture";
import { VoiceActivityGate } from "../src/lib/voiceActivityGate";
import { shouldInterruptVoiceReply } from "../src/lib/voiceTurnDetection";
import { TranscriptStabilizer } from "../src/speech/transcriptStabilizer";
import { asksToInspectSharedView } from "../src/lib/voiceVisualIntent";
import { createVoiceSessionState, voiceSessionReducer } from "../src/voice/state/voiceSession";

// The old raw-WebSocket PCM/phrase-buffering protocol (voicePcmPacket.ts,
// voiceSpeech.ts) is gone now that voice calls run over Pipecat + WebRTC --
// mic capture/encoding and TTS chunking are the Pipecat client's and
// server's job. voicePcmCapture.ts is still shared with dictation
// (Cmd+Shift+K + the composer mic button), which stays on its own small
// Fish-ASR WebSocket bridge (backend/voice/websocket/dictation-stream.ts).

let stops = 0;
const tracks = [{ enabled: true, stop: () => { stops += 1; } }, { enabled: true, stop: () => { stops += 1; } }];
stopMediaStreamTracks({ getTracks: () => tracks as unknown as MediaStreamTrack[] });
assert.equal(stops, 2);
assert.ok(tracks.every((track) => track.enabled === false));

let session = createVoiceSessionState();
session = voiceSessionReducer(session, { type: "ENTER", sessionId: "voice-test" });
assert.equal(session.active, true);
assert.equal(session.state, "entering");
session = voiceSessionReducer(session, { type: "MIC_READY" });
assert.equal(session.state, "ready");
session = voiceSessionReducer(session, { type: "STT_PARTIAL", text: "find my" });
assert.equal(session.state, "transcribing");
assert.equal(session.partialTranscript, "find my");
session = voiceSessionReducer(session, { type: "STT_FINAL", text: "find my document" });
assert.equal(session.state, "thinking");
assert.equal(session.committedTranscript, "find my document");
session = voiceSessionReducer(session, { type: "TOKEN", text: "I found " });
session = voiceSessionReducer(session, { type: "TOKEN", text: "it." });
assert.equal(session.responseText, "I found it.");
session = voiceSessionReducer(session, { type: "TOOL_STARTED", tool: "browser.research", taskId: "task-1", label: "Searching the web", canPause: true });
assert.equal(session.state, "acting_browser");
assert.equal(session.activeTask?.label, "Searching the web");
session = voiceSessionReducer(session, { type: "PAUSE" });
assert.equal(session.state, "paused");
session = voiceSessionReducer(session, { type: "TAKE_CONTROL" });
assert.equal(session.state, "user_takeover");
assert.equal(session.userHasControl, true);
session = voiceSessionReducer(session, { type: "RESUME_AGENT" });
assert.equal(session.state, "acting_browser");
assert.equal(session.userHasControl, false);
session = voiceSessionReducer(session, { type: "APPROVAL_REQUIRED", approval: { id: "approval-1", title: "Review", detail: "Send this email" } });
assert.equal(session.state, "awaiting_approval");
assert.equal(session.requiresApproval?.id, "approval-1");
session = voiceSessionReducer(session, { type: "END" });
assert.equal(session.state, "ending");
session = voiceSessionReducer(session, { type: "CLOSED" });
assert.equal(session.active, false);
assert.equal(session.state, "idle");


import { VoiceSpeechPlayer } from "../src/lib/voiceSpeechPlayer";
import { replanVoiceMission } from "../lib/clyra-agent/mission-revision";
import type { MissionRecord, MissionPlan } from "../lib/clyra-agent/core";

// Exercise the real native speech queue without audio hardware or an API key.
class MockUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; }
}
const spoken: MockUtterance[] = [];
const mockSynth = {
  paused: false,
  cancel: () => { spoken.length = 0; },
  getVoices: () => [],
  speak: (utterance: MockUtterance) => { spoken.push(utterance); },
  resume: () => undefined,
};
Object.assign(globalThis, {
  window: { speechSynthesis: mockSynth },
  SpeechSynthesisUtterance: MockUtterance,
});
let drained = 0;
const player = new VoiceSpeechPlayer(() => { drained += 1; });
assert.equal(player.available, true);
player.append("Hello there. This second sentence should follow naturally.");
player.complete();
assert.equal(spoken.length, 1, "first complete sentence plays before the whole reply drains");
assert.equal(spoken[0]?.text, "Hello there.");
spoken[0]?.onend?.();
assert.equal(spoken.length, 2, "queued continuation plays in order");
assert.equal(spoken[1]?.text, "This second sentence should follow naturally.");
spoken[1]?.onend?.();
assert.equal(drained, 1, "a completed spoken reply notifies the call exactly once");
player.append("This is the response I am going to interrupt.");
player.complete();
const cancelledUtterance = spoken[2];
assert.ok(cancelledUtterance, "the interrupted utterance starts");
player.interrupt();
cancelledUtterance?.onend?.();
assert.equal(drained, 1, "a cancelled reply cannot finalize a newer turn");
player.append("A corrected response.");
player.complete();
const corrected = spoken[0];
assert.equal(corrected?.text, "A corrected response.");
corrected?.onend?.();
assert.equal(drained, 2, "new playback recovers after an interruption");

console.log("voice-unit-tests: interruptible native speech queue passed");


const originalPlan: MissionPlan = {
  objective: "Research competitors, then create a note",
  steps: [
    { id: "research", description: "Find sources", toolId: "browser.search", args: { query: "competitors" }, dependsOn: [], status: "completed", verification: { status: "verified" } },
    { id: "note", description: "Write note", toolId: "notes.create", args: { title: "Plan" }, dependsOn: ["research"], status: "pending" },
  ],
};
const originalRecord: MissionRecord = {
  id: "voice-mission-test", state: "PAUSED", plan: originalPlan,
  outputs: { research: { ok: true, data: { urls: ["https://example.org"] } } },
  traces: [], startedAt: Date.now(), updatedAt: Date.now(),
  approval: { stepId: "note", toolId: "notes.create", requestedAt: Date.now() },
};
const unchanged = replanVoiceMission(originalRecord, {
  objective: "Research competitors, then create a note. Add TikTok as a focus",
  steps: structuredClone(originalPlan.steps),
}, "Add TikTok as a focus");
assert.equal(unchanged.plan.steps[0]?.status, "completed");
assert.ok(unchanged.outputs.research, "previous verified source evidence is retained");
assert.equal(unchanged.approval, undefined, "stale write approvals are never reused");
assert.equal(unchanged.plan.objective.includes("TikTok"), true);
const changed = replanVoiceMission(originalRecord, {
  objective: "Research TikTok competitors instead",
  steps: [
    { id: "research", description: "Find updated sources", toolId: "browser.search", args: { query: "TikTok competitors" }, dependsOn: [], status: "pending" },
    originalPlan.steps[1]!,
  ],
}, "Focus on TikTok");
assert.equal(changed.plan.steps[0]?.status, "pending", "changed research query must re-execute");
assert.equal(changed.outputs.research, undefined, "stale results must not pass verification");
assert.equal(changed.plan.steps[1]?.status, "pending", "dependent writes cannot reuse outdated work");
assert.equal(originalRecord.outputs.research?.ok, true, "the old durable checkpoint is not mutated");
console.log("voice-unit-tests: verified mission-revision recovery passed");

console.log("voice-unit-tests: reducer assertions passed");

// Quiet/mumbled starts should register without treating room noise as speech.
const gate = new VoiceActivityGate();
assert.equal(gate.test(0.012), false, "idle room noise should stay quiet");
assert.equal(gate.test(0.042), true, "soft voice opens the gate");
gate.setSpeaking(true);
assert.equal(gate.test(0.029), true, "hysteresis preserves a low-energy syllable");
gate.setSpeaking(false);
assert.equal(gate.test(0.045, false, true), false, "native voice playback must not interrupt itself");
assert.equal(gate.test(0.22, false, true), true, "clear interruption over playback must be detected");
gate.reset();
assert.equal(gate.test(Number.NaN), false, "invalid meter values are ignored");
console.log("voice-unit-tests: adaptive speech gate passed");

assert.equal(shouldInterruptVoiceReply("responding", false), true);
assert.equal(shouldInterruptVoiceReply("thinking", false), true);
assert.equal(shouldInterruptVoiceReply("acting_browser", true), true, "live task acknowledgement must be interruptible");
assert.equal(shouldInterruptVoiceReply("acting_clyra", false), false, "do not cancel an agent that isn't speaking");
console.log("voice-unit-tests: task speech interruption passed");

const captions = new TranscriptStabilizer();
assert.equal(captions.update("Research the competitors"), "Research the competitors");
assert.equal(captions.update("Research the competitors and pricing"), "Research the competitors and pricing");
assert.equal(captions.update("competitors and pricing for TikTok"), "Research the competitors and pricing for TikTok", "rolling STT must not erase early words");
assert.equal(captions.finalize("Research competitor pricing for TikTok"), "Research competitor pricing for TikTok", "final decode remains authoritative");
assert.equal(captions.update("Start a different question"), "Start a different question", "new utterances do not inherit old captions");
captions.reset();
assert.equal(captions.update(""), "");
console.log("voice-unit-tests: rolling transcript stabilizer passed");

assert.equal(asksToInspectSharedView("What can you see?"), true);
assert.equal(asksToInspectSharedView("Read the screen"), true);
assert.equal(asksToInspectSharedView("What is this?"), true);
assert.equal(asksToInspectSharedView("Research competitors then create a report"), false);
assert.equal(asksToInspectSharedView("Actually include Instagram in the plan"), false);
console.log("voice-unit-tests: explicit shared-frame intent passed");
