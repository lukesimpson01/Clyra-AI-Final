# Licence audit

Clyra Video is a **proprietary commercial product**. Every dependency below was
checked before any code was written, because the cost of discovering a copyleft
obligation after shipping is a rewrite.

Licences were read from each repository's own metadata on the dates below. This
file is the gate: **if a component is not listed here as "may vendor" or "may
link", its code does not go into `app/`.**

Audited: 2026-09-01.

## Summary

| Repository | Licence | Verdict | How we may use it |
|---|---|---|---|
| `AcademySoftwareFoundation/OpenTimelineIO` | Apache-2.0 | ✅ **Depend + vendor** | Canonical timeline model. Attribution required. |
| `heygen-com/hyperframes` | Apache-2.0 | ✅ **Depend** | Optional HTML→video render backend. |
| `midrender/revideo` | MIT | ✅ **Depend** | Optional programmatic render backend. |
| `mifi/editly` | MIT | ✅ **Depend + study** | JSON edit-spec → FFmpeg. Good prior art for our render graph. |
| `MartinDelophy/ai-video-editor` (timeline-studio) | MIT | ✅ **Study + borrow** | Local-first editor architecture. |
| `ronak-create/FableCut` | MIT | ✅ **Study + borrow** | Agent-facing REST/MCP project model. |
| `OpenCut-app/OpenCut` | MIT | ✅ **Study + borrow** | Timeline UI, editor API, headless render. |
| `OpenCut-app/opencut-classic` | MIT | ✅ **Study + borrow** | Original codebase; simpler to learn from. |
| `mltframework/mlt` | **LGPL-2.1** | ⚠️ **Subprocess only** | See "MLT" below. Never statically linked. |
| `x777/frontstage` | **GPL-3.0** | ⛔ **Reference only — never copy** | See "Frontstage" below. |

## MLT — the LGPL question, and why we invoke it as a subprocess

MLT is LGPL-2.1. LGPL permits use from proprietary software, but attaches
conditions to *linking*: if we link MLT into our binary, we owe users the
ability to relink against a modified MLT, and we must not statically link
without providing object files.

We avoid the entire question by **never linking MLT at all**. The render
backend invokes the `melt` binary as a separate process over a documented CLI
and an XML document. That is arm's-length use of an unmodified program — the
same relationship a user has when they run `melt` themselves — and it carries
no obligation over our own source.

This also happens to be the better engineering choice: a crash in a render does
not take the editor with it.

### The optional-module trap

**MLT's licence is not the whole story.** Many of MLT's optional modules link
GPL libraries — `x264`, `frei0r`, and others. Building MLT with those modules
produces a *GPL* binary, and shipping it alongside our product invites the
argument that the combination is one work.

Therefore, any MLT we ship must be built with GPL modules explicitly disabled,
and the build flags recorded here. Until that build is audited, the FFmpeg
backend is the shipping path.

## Frontstage — quarantined

Frontstage is GPL-3.0. GPL-3.0 is strong copyleft: incorporating any part of it
into our product would oblige us to release our entire product under GPL-3.0.

**We do not clone Frontstage into this workspace.** The instruction to clone it
to `references/` was deliberately not followed, and here is the reasoning:

- The only permitted use is *reading it to understand its architecture*. That
  does not require the source to sit inside our repository.
- Source on disk beside our own is how accidental copy-paste happens — by us,
  by a teammate, or by an AI assistant with repository-wide file access. The
  risk is not hypothetical; it is the single most likely way a proprietary
  product acquires a GPL obligation.
- Nothing is lost. Architecture can be studied from its public documentation
  and, if a specific mechanism needs understanding, read in a browser and
  described in prose in `ARCHITECTURE.md` — never pasted.

If Frontstage must be studied at file level, clone it **outside this
repository** entirely, read it, and write findings as prose. Independent
reimplementation from a described concept is lawful; transcription is not.

## FFmpeg — the licence depends on the build

FFmpeg is LGPL-2.1+ *by default*, but is commonly built `--enable-gpl` (which
pulls in `x264`, `x265`, and other GPL components). A GPL FFmpeg binary cannot
be bundled with a proprietary product without triggering GPL obligations.

Like MLT, we invoke `ffmpeg` as a subprocess rather than linking it, which keeps
our own source unaffected. For **distribution**, we must either:

1. ship an LGPL-only FFmpeg build (no `--enable-gpl`), or
2. not bundle FFmpeg and require the user to supply it, or
3. license the relevant codecs commercially.

This decision is deferred to packaging, and is flagged here so it cannot be
forgotten. The build currently on this machine is a third-party static build
whose flags are unverified — fine for development, **not** for shipping.

## What a permissive repo licence does *not* cover

An MIT or Apache licence on a repository covers **that repository's source**. It
does not automatically cover:

- **Bundled models** — Whisper weights, detection models, and embeddings each
  carry their own terms. Whisper's weights are MIT, but a fine-tune may not be.
- **Fonts** — frequently the most restrictive asset in a video product. Caption
  rendering must use fonts we have a licence to embed and redistribute.
- **Sample media** — demo footage and audio in these repos is often unlicensed
  or licensed for demonstration only. None of it ships.
- **Transitive dependencies** — a permissive top-level package can depend on a
  copyleft one. Requires a resolved-tree scan, not a top-level read.

**Action outstanding:** a transitive licence scan of the final dependency tree
before first release. Not yet performed.

## Codec patents — separate from copyright

H.264 and HEVC are patent-encumbered independently of any software licence.
Distributing an encoder may require a licence from the relevant patent pool
regardless of what FFmpeg's copyright licence permits. This is a commercial and
legal question, not an engineering one, and needs an answer before release.

## Attribution obligations

Apache-2.0 (OpenTimelineIO, HyperFrames) requires that we retain copyright
notices and ship a copy of the licence. MIT likewise requires the notice.
A `THIRD_PARTY_NOTICES` file must be generated and shipped with the product;
this has not been done yet, and is a release blocker.

## Status of this audit

This audit covers **top-level repository licences only**. Still outstanding
before any commercial release:

- [ ] Transitive dependency licence scan of the resolved tree
- [ ] MLT build-flag audit (if MLT is shipped at all)
- [ ] FFmpeg build provenance and licence for the shipped binary
- [ ] Model, font and sample-media licence review
- [ ] Codec patent position
- [ ] Generated `THIRD_PARTY_NOTICES`

None of these block development. All of them block shipping.
