# Clyra Voice Call rebuild map

Date: 28 September 2026

## Migration boundary

The Voice Call renderer and session model are replaced. Existing working
transport, transcription, reasoning, TTS, browser, Google and tool-safety
services remain the source of truth. The rebuild does not add a second model
client, OAuth flow, browser engine or privileged renderer API.

## Existing services reused

| Capability | Existing implementation | Voice integration |
| --- | --- | --- |
| Call transport | Pipecat Small WebRTC, `/voice/session`, `/voice/offer` | `useVoiceCall` remains the single transport owner. |
| Local STT | `backend/voice-pipeline/whisper_cpp_stt.py` | Local 16 kHz segmented transcription, partials and final transcripts. |
| Turn detection | Pipecat + Silero VAD | Speech start/end and barge-in remain server driven. |
| Reasoning | Existing DeepSeek-compatible Pipecat LLM service | No new credentials or model stack. |
| TTS | Existing Fish streaming TTS | Text renders from LLM deltas before TTS completes. |
| Agent tools | `lib/clyra-agent/*` mission registry, policy, verification and checkpoints | Voice routes supported tasks through `/api/agent/route` and durable missions. |
| Google | Restricted Electron preload bridge and existing Google manager | Voice invokes the same authenticated executor and confirmation result. |
| Browser | Existing managed Chromium/CDP/Playwright runtime | Voice uses verified research missions; it does not launch a second browser. |
| Computer safety | `lib/computer-use/*` semantic harness and policy | The voice state model has explicit pause, takeover, approval and computer states; renderer privilege is not widened. |
| Chat memory | App-owned conversation and `onTurn` callback | Completed voice turns return to the originating Chat session. |

## New renderer architecture

- `src/voice/state/voiceSession.ts`: authoritative finite state, event model,
  task/surface/approval types and reducer.
- `src/voice/VoicePresence.tsx`: low-cost charcoal canvas presence driven by
  smoothed real microphone/TTS levels.
- `src/voice/VoiceComposer.tsx`: Type-button-to-composer layout morph with
  Enter, Shift+Enter and Escape behavior.
- `src/voice/VoiceActivitySurface.tsx`: temporary browser, integration and
  Clyra task surface.
- `src/voice/VoiceControlBar.tsx`: pause, resume, takeover, stop and steering
  controls derived from real task capabilities.
- `src/components/voice/VoiceCallScreen.tsx`: fullscreen composition only;
  it does not own parallel call booleans or backend behavior.
- `src/hooks/useVoiceCall.ts`: Pipecat adapter, session reducer owner, typed
  message path, task routing, Google adapter, approvals and cleanup.

## Security boundary

The renderer receives only the existing typed preload capabilities. It never
receives `fs`, `shell`, `child_process`, arbitrary IPC or credentials. Web and
computer observations remain untrusted inputs in the existing tool policy.
Consequential mission and Google actions stay behind their existing approval
systems.

## Deliberate non-duplication

The repository already owns a persistent managed Chromium profile, CDP bridge,
semantic browser representation, verified action loop and synthetic cursor
events. Adding a second Browser Use process would duplicate browser state and
login storage, so this rebuild keeps the current browser runtime. Likewise,
the existing computer-use harness remains the native-control boundary instead
of exposing Cua or raw OS automation directly to React.
