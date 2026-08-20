# Clyra Voice Call

## Active architecture

```text
Browser microphone (mono PCM16, 16 kHz)
  → WebSocket /voice/stream
  → local level/VAD endpointing
  → streaming Async Flash ASR (Fish batch ASR fallback)
  → DeepSeek V4 Flash response stream
  → semantic speech chunks
  → Fish Audio S2-Pro /v1/tts/live
  → mono PCM16, 24 kHz packets
  → browser scheduled playback + output level meter
```

Voice Call uses `websocket/fish-voice-stream-handler.ts`. It owns one call
session while reusing the existing streaming ASR client and retaining Fish ASR
as a fallback. Clyra's conversation ID, compact voice prompt, history, usage
ledger, cancellation behavior, and Fish voice identity are preserved.

## Environment

```env
FISH_API_KEY=sk-fish-...
FISH_VOICE_ID=optional-provider-voice-id
FISH_VOICE_ID_CLYRA=optional-provider-voice-id
FISH_VOICE_ID_WARM=optional-provider-voice-id
FISH_VOICE_ID_BRIGHT=optional-provider-voice-id
FISH_VOICE_ID_CALM=optional-provider-voice-id
FISH_ASR_LANGUAGE=en
VOICE_SAMPLE_RATE=16000
```

The Fish credential is server-only. Never use a `VITE_` prefix or expose it in
the session/config response.

## Protocol

Client → server:

- `audio`, `flush`, `utterance`
- `mute`, `barge_in`, `playback_done`
- `set_voice`, `ping`

Server → client:

- `ready`, `pipeline_mode`, `status`
- `transcript_final`, `dictation_final`
- `llm_token`, `llm_done`
- `tts_format`, binary PCM packets, `tts_done`
- fatal or recoverable `error`

## Verification

```bash
npm run test:voice
npm run test:voice-e2e -- /path/to/audio.m4a
npm run test:voice-e2e:dictation -- /path/to/audio.m4a
```

The end-to-end runner converts the fixture to the same 16 kHz PCM sent by the
browser and verifies STT → Clyra LLM → S2-Pro PCM output. It writes latency and
audio artifacts under `tmp/voice-bench/e2e-*`.
