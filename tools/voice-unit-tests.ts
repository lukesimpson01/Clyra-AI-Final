import assert from "node:assert/strict";
import { stopMediaStreamTracks } from "../src/lib/voicePcmCapture";
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

console.log("voice-unit-tests: reducer assertions passed");
