#!/usr/bin/env python3
"""Word-level transcription for Shorts caption projects.

Usage: transcribe_words.py <media> <out.json> [tiny|base|small]

Writes {"language": ..., "words": [{"text", "startMs", "endMs"}]}. Progress is
reported on stderr as "STAGE <label>" lines. The model is loaded only for this
process and released when it exits, so transcription never stays resident
between jobs.
"""

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe_words.py <media> <out.json> [model]", file=sys.stderr)
        return 2
    media, out_path = sys.argv[1], sys.argv[2]
    model_name = sys.argv[3] if len(sys.argv) > 3 else "base"
    if model_name not in {"tiny", "base", "small"}:
        model_name = "base"

    try:
        import whisper  # type: ignore
    except Exception as error:  # pragma: no cover - environment dependent
        print(f"whisper is not installed: {error}", file=sys.stderr)
        return 3

    print(f"STAGE Loading the {model_name} speech model", file=sys.stderr, flush=True)
    model = whisper.load_model(model_name)
    print("STAGE Transcribing speech", file=sys.stderr, flush=True)
    result = model.transcribe(media, word_timestamps=True, verbose=False, fp16=False)

    words = []
    for segment in result.get("segments", []):
        for word in segment.get("words", []) or []:
            text = str(word.get("word", "")).strip()
            start = float(word.get("start", 0.0))
            end = float(word.get("end", 0.0))
            if not text or end <= start:
                continue
            words.append({"text": text, "startMs": int(round(start * 1000)), "endMs": int(round(end * 1000))})

    with open(out_path, "w", encoding="utf-8") as handle:
        json.dump({"language": result.get("language", "unknown"), "words": words}, handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
