"""AI voiceover generation for Clyra Clipper.

Turns a script into narration audio through the same TTS provider Clyra's
live voice call already uses — Fish Audio (see backend/voice-pipeline/bot.py)
— rather than a second, unrelated provider. The live call pipeline talks to
Fish Audio's streaming WebSocket API through pipecat; this is a standalone
one-shot client speaking the identical wire protocol (verified against
pipecat's own FishAudioTTSService: same endpoint, same start/text/flush/stop
event sequence, same auth), because a batch "render this script to a file"
job has no pipeline to attach to.

Runs under the voice virtualenv (.venv-voice311), the only interpreter in
this repo with `websockets` and `ormsgpack` installed — the main clipper
pipeline's system python3 does not have them, so this is intentionally a
separate process, not an import.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time

import ormsgpack
from websockets.asyncio.client import connect as websocket_connect

FISH_WS_URL = "wss://api.fish.audio/v1/tts/live"
SAMPLE_RATE = 44_100
CHANNELS = 1
SAMPLE_WIDTH_BYTES = 2  # Fish Audio's "pcm" format is 16-bit signed, matching
# pipecat's own TTSAudioRawFrame(audio_data, sample_rate, 1, ...) construction.

# `flush` does not end an utterance — Fish Audio's live endpoint is built for
# an open-ended conversational session, and only replies with a `finish`
# event once it has received an explicit `stop`. Verified empirically: a
# short script produces one audio chunk and then silence indefinitely, with
# no `finish` ever arriving on its own. So this client watches for a gap in
# audio arrival — the server has caught up with everything it was asked to
# say — and only then sends `stop` to close out the utterance cleanly. A
# short gap risks cutting off a still-generating long script (confirmed: a
# 1.5s gap fired mid-synthesis on a 5-sentence passage), so the gap is
# generous rather than snappy.
IDLE_GAP_SECONDS = 4.0
STOP_GRACE_SECONDS = 15.0
# The default 1 MiB per-message limit is too small for Fish Audio's own
# framing — a multi-sentence script can arrive as a single chunk well past
# that (1.4 MB was observed for five sentences), which otherwise kills the
# connection with a 1009 "message too big" close before `finish` arrives.
MAX_WS_MESSAGE_BYTES = 16 * 1024 * 1024


def emit(step, status, **data):
    print(json.dumps({"type": "progress", "step": step, "status": status, **data}), flush=True)


class VoiceoverError(Exception):
    pass


async def synthesize(text: str, *, api_key: str, reference_id: str | None, model: str | None) -> bytes:
    """Return raw 16-bit PCM audio for `text`, or raise VoiceoverError."""
    headers = {"Authorization": f"Bearer {api_key}", "model": model or "s2-pro"}
    chunks: list[bytes] = []
    finish_reason: str | None = None

    async with websocket_connect(FISH_WS_URL, additional_headers=headers, max_size=MAX_WS_MESSAGE_BYTES) as ws:
        start_message = {
            "event": "start",
            "request": {
                "text": "",
                "sample_rate": SAMPLE_RATE,
                "latency": "normal",
                "format": "pcm",
                "normalize": True,
                "prosody": {"speed": 1.0, "volume": 0},
                "reference_id": reference_id,
            },
        }
        await ws.send(ormsgpack.packb(start_message))
        await ws.send(ormsgpack.packb({"event": "text", "text": text}))
        await ws.send(ormsgpack.packb({"event": "flush"}))

        last_audio_at = time.monotonic()
        stop_sent = False
        while True:
            wait_budget = IDLE_GAP_SECONDS - (time.monotonic() - last_audio_at)
            if wait_budget <= 0 and not stop_sent:
                await ws.send(ormsgpack.packb({"event": "stop"}))
                stop_sent = True
                wait_budget = STOP_GRACE_SECONDS
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, wait_budget))
            except asyncio.TimeoutError:
                if stop_sent:
                    raise VoiceoverError("Fish Audio never confirmed the script finished")
                continue
            if not isinstance(raw, (bytes, bytearray)):
                continue
            message = ormsgpack.unpackb(raw)
            if not isinstance(message, dict):
                continue
            event = message.get("event")
            if event == "audio":
                audio = message.get("audio")
                if audio:
                    chunks.append(bytes(audio))
                    last_audio_at = time.monotonic()
            elif event == "finish":
                finish_reason = message.get("reason", "unknown")
                break

    if finish_reason == "error":
        raise VoiceoverError("Fish Audio reported a synthesis error")
    if not chunks:
        raise VoiceoverError("Fish Audio returned no audio for this script")
    return b"".join(chunks)


def encode_to_mp4(pcm: bytes, output_path: str) -> None:
    """AAC-in-MP4, not WAV: this is what /output/:filename already serves
    (Content-Type: video/mp4, hardcoded for the rendered clips it was built
    for), and what the SFX-track mixer downstream already expects to `-i`
    alongside other clip audio — so a voiceover is playable and mixable
    without adding a second file format to either path."""
    import subprocess

    ffmpeg = os.environ.get("CLYRA_FFMPEG") or "ffmpeg"
    subprocess.run(
        [
            ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS), "-i", "pipe:0",
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
            output_path,
        ],
        input=pcm,
        check=True,
    )


async def main_async(args) -> int:
    api_key = os.environ.get("FISH_AUDIO_API_KEY", "").strip()
    if not api_key:
        emit("voiceover", "error", message="Fish Audio is not configured (FISH_AUDIO_API_KEY missing)")
        return 1
    text = args.text.strip()
    if not text:
        emit("voiceover", "error", message="Script text is empty")
        return 1
    if len(text) > 4_000:
        emit("voiceover", "error", message="Script is too long for a single voiceover pass (4,000 character limit)")
        return 1

    reference_id = args.reference_id or os.environ.get("FISH_TTS_REFERENCE_ID") or None
    model = args.model or os.environ.get("FISH_TTS_MODEL") or None

    emit("voiceover", "running", message="Generating voiceover audio...", overall=10)
    try:
        pcm = await synthesize(text, api_key=api_key, reference_id=reference_id, model=model)
    except VoiceoverError as exc:
        emit("voiceover", "error", message=str(exc))
        return 1
    except Exception as exc:  # network/protocol failures surface honestly, not as silent empty audio
        emit("voiceover", "error", message=f"Could not reach Fish Audio: {exc}")
        return 1

    emit("voiceover", "running", message="Encoding audio file...", overall=80)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)
    try:
        encode_to_mp4(pcm, args.output)
    except Exception as exc:
        emit("voiceover", "error", message=f"Could not encode the generated audio: {exc}")
        return 1
    duration_seconds = len(pcm) / (SAMPLE_WIDTH_BYTES * CHANNELS * SAMPLE_RATE)
    emit(
        "voiceover",
        "complete",
        message="Voiceover ready.",
        overall=100,
        output=args.output,
        durationSeconds=round(duration_seconds, 2),
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a voiceover clip through Clyra's Fish Audio TTS.")
    parser.add_argument("text", help="The script to narrate.")
    parser.add_argument("output", help="Output WAV path.")
    parser.add_argument("--reference-id", dest="reference_id", default=None, help="Fish Audio voice reference id.")
    parser.add_argument("--model", dest="model", default=None, help="Fish Audio TTS model id.")
    args = parser.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
