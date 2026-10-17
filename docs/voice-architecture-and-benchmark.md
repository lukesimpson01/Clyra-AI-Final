# Voice Call Architecture

Date: 22 August 2026. Replaces the previous Faster-Whisper/Chatterbox +
raw-WebSocket design described in this file's earlier revisions.

## Stack

```
Browser mic (WebRTC, @pipecat-ai/client-js + small-webrtc-transport)
  -> POST /voice/offer (Node: attaches system prompt + history server-side)
    -> POST /api/offer (Python: Pipecat SmallWebRTCTransport SDP answer)
        Silero VAD / turn detection
        Local whisper.cpp STT (warm, on-device, rolling interim captions)
    <- Pipecat pipeline: STT -> LLM -> TTS, real barge-in/interruption
  -> DeepSeek (OpenAI-compatible) LLM, or the in-process Test Mode echo route
  -> Fish Audio TTS (wss://api.fish.audio/v1/tts/live, streaming)
  -> Browser speaker (WebRTC)
```

`PipelineTask(enable_rtvi=True)` emits connection/listening/thinking/
speaking/transcript events over the WebRTC data channel; the frontend
(`src/hooks/useVoiceCall.ts`) consumes them via `@pipecat-ai/client-js`
(`RTVIEvent`), not custom timers.

## Local speech recognition and live captions

Voice calls use Clyra's `WhisperCppSTTService`
(`backend/voice-pipeline/whisper_cpp_stt.py`). It starts one local
`whisper-server` process and keeps the selected model warm, so audio stays
on-device and the model is not reloaded for every utterance. While VAD reports
speech, it decodes an eight-second rolling audio window roughly every 750 ms
and emits Pipecat `InterimTranscriptionFrame` events; when the turn ends it
decodes the complete utterance for the final transcript.

The call screen renders those genuine interim events as the subtitle directly
below the Clyra presence. The finalized utterance remains visible through the
brief thinking state and clears as the response starts. It is never a fake or
timer-generated caption.

## Test Mode

A persisted, off-by-default UI setting (Settings -> Voice). When on, the
LLM stage is a loopback route served by the same Python process
(`backend/voice-pipeline/echo_llm.py`) that streams back exactly what local
Whisper heard, in the real OpenAI streaming chunk format `OpenAILLMService`
expects -- so every other stage (WebRTC, VAD, local Whisper, Fish TTS, barge-in,
turn management) still runs for real, but DeepSeek is never called. Exists
so voice-call development and testing doesn't spend DeepSeek credits.

## Environment

```env
FISH_AUDIO_API_KEY=
FISH_TTS_REFERENCE_ID=
FISH_TTS_MODEL=s1
DEEPSEEK_API_KEY=            # existing chat key, reused as-is
VOICE_SAMPLE_RATE=16000
VOICE_PIPELINE_URL=http://127.0.0.1:8787
```

## Dictation is separate

Cmd+Shift+K global dictation and the composer's mic button never needed an
LLM or TTS turn, so they kept their own small WS bridge to Fish's REST ASR
(`backend/voice/websocket/dictation-stream.ts`) instead of going through
the Pipecat pipeline above.

## Verified

- Real `@pipecat-ai/client-js` browser client connects through the full
  stack: WebRTC ICE, RTVI `client-ready` handshake, pipeline start --
  confirmed via `backend/voice-pipeline` server logs during manual and
  Playwright-driven browser testing.
- A standalone `aiortc` peer-connection script exercises `/api/offer`
  directly (SDP offer/answer, `connectionState: connected`) without the
  browser, isolating the Python worker's WebRTC handling.
- `backend/voice-pipeline/test_pipeline_unit.py` covers config defaults,
  the PCM->WAV helper, `/health`, and the Test Mode echo route's streaming
  format against the real `openai` client.
- `tools/voice-call-webrtc-e2e.mjs` drives the actual app UI in a real
  Chromium (Playwright) with a fake mic device and asserts the call reaches
  Listening and ends cleanly.

## Not yet verified in this environment

Real Fish Audio TTS behavior, barge-in-mid-sentence, a 10-minute soak, and
reconnect-after-network-loss still need a real `FISH_AUDIO_API_KEY` (and
ideally a recorded speech fixture at `tmp/voice-bench/wallace-cl-2.wav`).
This development machine does not have one configured. Local Whisper can be
tested without sending microphone audio off-device; a full call also needs the
local model/runtime installed via `npm run setup:speech`.
