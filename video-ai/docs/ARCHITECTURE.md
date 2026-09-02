# Clyra Video — architecture

An AI-native non-linear editor. The premise: **a text-only model should be able
to edit video competently**, without vision, without screenshots, and without
driving UI controls. That is only possible if the project state and every
available operation are expressible as structured data.

Everything below follows from that one requirement.

```
        UI  ────────────┐
                        ▼
   Agent Tool API ──► Command Engine ──► OTIO timeline ──► Render backend
   (typed schemas)     (validate/undo)    (canonical)       (FFmpeg / MLT)
                                              ▲
                                    Media analysis index
                                 (transcript, shots, loudness)
```

## Why each layer exists

**OpenTimelineIO as the canonical model.** OTIO is the industry interchange
format (Apache-2.0, ASWF-governed). Using it rather than a bespoke JSON means
projects round-trip to Premiere, Resolve and Final Cut for free, and it is a
schema other tools already understand. The canonical timeline is the single
source of truth; everything else is a projection of it.

**A command engine, not direct mutation.** Nothing — not the UI, not the agent —
edits the timeline directly. Every change is a named, typed, validated command.
This buys four things at once: undo/redo for free, a deterministic audit trail,
identical behaviour whether a human or a model made the edit, and a surface that
can be exposed to an LLM without exposing internals.

**Media analysis as an index.** A model cannot watch footage. So the footage is
pre-analysed into timestamped structure — transcript, speakers, silences, shot
boundaries, loudness, motion — and *that* is what the model reads. "Remove pauses
longer than 0.8s" becomes a query over the silence index, not a vision problem.

**A render abstraction.** The canonical format must not be coupled to one
renderer. OTIO → internal render graph → backend. FFmpeg ships first because it
is sufficient for the vertical slice and has no linking obligations; MLT and
HyperFrames slot in behind the same interface later.

## What the reference projects taught us

Studied, not copied. See `LICENSE_AUDIT.md` for what each may be used for.

| Project | What we took from it |
|---|---|
| **FableCut** | Its agent surface is coarse — `get_project` / `patch_project` / `set_project`. The model reads and rewrites the whole document. This is the thing to improve on: it cannot validate a single operation, cannot undo one step, and forces the model to hold the entire project in context. Our command API is fine-grained for exactly these reasons. |
| **Editly** | A declarative JSON edit spec compiling to FFmpeg is proven and simple. Our render graph is close in spirit to its clip/layer model. |
| **OpenCut** | Splits `apps/api`, `apps/desktop`, `apps/web` over a shared core — the separation we adopt for `apps/desktop` and `apps/web`. |
| **timeline-studio** | Local-first architecture, and a `MODEL_LICENSES.md` that confirms bundled AI models carry terms separate from the repo licence. |
| **HyperFrames** | Deterministic HTML→video rendering; an agent-friendly composition target for titles and captions later. |
| **Revideo** | Programmatic scene composition in TypeScript; a candidate motion-graphics backend. |
| **Frontstage** | GPL-3.0 — **not cloned, not read at file level.** Concepts only, reimplemented independently. |

## Packages

### `packages/timeline`
The OTIO-backed project model: tracks, clips, media references, transitions,
effects, markers, captions, metadata. Pure data and pure functions — no I/O, no
rendering, no agent awareness. Serialises to `.otio`.

### `packages/commands`
The command API. Every command declares a JSON schema, validates its input,
mutates the timeline deterministically, returns structured output, and produces
an inverse for undo.

```
project.inspect     timeline.inspect    media.inspect     media.search
transcript.search   track.create        track.delete      clip.insert
clip.move           clip.trim           clip.split        clip.delete
clip.duplicate      clip.speed          transform.set     transform.animate
keyframe.add        keyframe.update     keyframe.delete   transition.add
transition.remove   effect.add          effect.update     effect.remove
audio.gain          audio.fade          audio.duck        caption.create
caption.style       render.preview      render.export
```

The invariant that makes AI editing safe: **a command either applies completely
and is undoable, or it is rejected with a structured error.** There is no state
in which a half-applied model mistake has to be cleaned up by hand.

### `packages/agent`
Provider-independent. OpenAI, Anthropic, Gemini, OpenRouter, Ollama, or any
OpenAI-compatible endpoint. The model sees tool schemas and structured state,
never implementation internals.

MCP is *one transport*, not the architecture. All three of these reach the same
command API:

```
LLM → native function calling → commands
LLM → MCP                     → commands
LLM → REST / WebSocket        → commands
```

### `packages/media-analysis`
Adapters producing a timestamped index: Whisper transcription, silence
detection, speaker segmentation, shot detection, OCR, object/face metadata,
loudness, motion scoring, embeddings for semantic search.

```json
{
  "start": 42.1, "end": 48.7,
  "transcript": "...", "speaker": "speaker_1",
  "objects": [], "ocr": [],
  "shotType": "medium", "motionScore": 0.4
}
```

### `packages/render`
`OTIO → internal render graph → backend`. FFmpeg first; MLT and HyperFrames
behind the same interface.

### `packages/editor`
The NLE surface: timeline, preview canvas, media bin, inspector, effects,
captions, keyframe editor, waveforms, snapping, ripple edit, razor, linked A/V,
zoom, undo history. Wears Clyra's design language — the same tokens, tab strip
and panel chrome as Notes and the AI Browser, via `notes-ui.css`.

### `apps/desktop` / `apps/web`
Desktop gets native filesystem, hardware acceleration and local FFmpeg. The
editor core stays renderer-agnostic so the web build shares it.

## The interaction this is all for

> "Remove all pauses longer than 0.8 seconds, keep the strongest 60 seconds,
> make it vertical, add captions and add subtle punch-in zooms."

1. Agent calls `transcript.search` and `media.inspect` — reads structure, not pixels.
2. Emits a batch of validated commands: `clip.split`, `clip.delete`, `transform.animate`, `caption.create`.
3. Command engine applies them atomically against the OTIO timeline.
4. Editor re-renders from the timeline.
5. Every step is on the undo stack, individually.
6. `render.export` produces the MP4.

## Milestone 1 — the vertical slice

Deliberately not Premiere. Prove the spine end to end:

1. Import MP4 → 2. probe → 3. transcript → 4. OTIO timeline → 5. multi-track UI
→ 6. preview → 7. expose to AI as typed commands → 8. AI splits/trims/moves
→ 9. captions → 10. undo/redo → 11. export MP4.

## Non-negotiables

- Nothing mutates the timeline except through a command.
- Every command is schema-validated and reversible.
- The canonical format is never coupled to a renderer.
- The model never touches UI controls or implementation internals.
- No GPL source enters `app/`.
