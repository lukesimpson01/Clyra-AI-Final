# Advanced editor — animation, motion graphics & Sound FX upgrade

This documents the upgrade of the FRAME advanced editor (`src/AdvancedEditor.jsx`).
The brief referred to a "Clyra" repository (`ClipperEditor.tsx`, `clipZoomEffect.ts`, `clipSfxTimeline.ts`, …).
Those files are **not in this working copy**. The project here is the FRAME/Crayo clone, so the work extends the editor that actually exists
here and reuses its engine (`src/animationEngine.js`). The Clyra-specific features (Zoom Pins, crop keyframes, the four-sound SFX palette)
could not be audited or regression-tested because their code is absent.

## What already existed (and was kept)

| Existing | Status |
| --- | --- |
| `animationEngine.js`: time-based keyframes, 9 easings, repeat/ping-pong/reverse, colour mixing, frame snapping | Kept; **generalised** (see below). Old saved projects still load (`migrateLayer`), easing is still stored on the *arriving* keyframe |
| Layers (image/video/text/subtitle/shape), timeline drag/trim/split, markers, grouping, undo/redo, local-storage persistence | Kept |
| Subtitle presets (Word/Lines) with per-word animation and colours | Kept and re-organised (below) |
| MediaRecorder → local FFmpeg MP4 export | Kept; extended for SFX mixing |
| Audio upload + preview | Kept; now routed through one shared `AudioContext` |

## What was added

### Shared animation engine (`src/animationEngine.js`)
* **Property registry** (`PROPERTY_DEFS`): 25 typed properties (position, scale, width/height, rotation, skew, opacity, colour, gradient end,
  stroke colour/width, corner radius, shadow, glow, blur, brightness, contrast, saturation, hue, reveal, letter-spacing, font size, volume, pan) with
  range validation (`clampToProperty`). Colours interpolate in sRGB; discrete values hold.
* **Easing**: Linear, Ease In, Ease Out, Ease In & Out, Smooth, Bounce, Elastic, Back, Hold, **Custom cubic-Bézier** (`{type:"cubicBezier",points}`),
  plus `easingSpeedAt` (derivative) which powers the Graph Editor's speed curve.
* **Keyframe operations** (pure, unit-tested): upsert (no duplicates on a frame), delete, move group, stretch/compress, reverse (easing flipped),
  duplicate animation, copy/paste, prev/next navigation, snapping to frames/markers/keyframes/playhead.
* **Procedural motion**: seeded wiggle/shake/oscillate/bounce and audio-reactive offsets — deterministic functions of timeline time only.
* **Sandboxed expressions**: a hand-written parser (no `eval`, no `Function`). Variables `t, value, index, pi`; functions
  `sin cos tan abs sqrt floor ceil round min max pow log exp clamp lerp noise wiggle random deg`. Anything else evaluates to `null` and is ignored.
* **Audio analysis**: `analyzeEnvelope` (per-frame RMS with smoothing), `detectBeats` (sensitivity slider), `bakeToKeyframes` ("Bake to Keyframes").
* **Versioned schema** (`ANIMATION_SCHEMA_VERSION = 2`) and `migrateLayer` (adds stable keyframe ids, clamps values, drops invalid frames).

Preview, scrubbing and export all call the same `sampleProperty`, so a given project time yields identical values everywhere. Nothing uses
CSS animations or wall-clock timers for video content. Project frame rate (24/25/30/60) is stored in the project; keyframe times snap to whole frames.

### Editor UI
* **Motion tab** with *Basic* (Position, Size, Rotation, Opacity, Colour, Effects, an **Animate** two-keyframe guided workflow) and
  *Advanced* (all registry properties, separate X/Y, linked/unlinked width & height, skew, flips, blend modes, assistants, expressions, parenting, graph editor).
  Both modes edit the same data; switching never changes it.
* **Property rows**: diamond toggle, previous/next keyframe, scrub-to-change labels, typed values, per-property Smooth toggle, easing menu with
  **live hover preview** and a draggable Bézier editor, loop/ping-pong/reverse/duplicate/copy/paste/reset, enable/disable animation.
  Editing an animated property at a new time creates/updates only that keyframe; Auto-key is off by default and clearly labelled.
* **Timeline**: expandable layer rows showing only animated property tracks (Advanced adds the core five), draggable diamonds with hover labels,
  multi-select (Shift/⌘), snapping toggle, copy/paste/reverse/stretch/delete for selected keyframes, frame-accurate placement.
* **Keyframe selection**: right-click any diamond to select it (and open a menu: go to, copy, paste, duplicate, reverse, easing, graph editor, delete); selected diamonds
  drag together, and right-dragging selects too. Drag a box across the property tracks to marquee-select; Shift/⌘ adds to the selection.
* **Graph Editor** (collapsed by default): value and speed graphs sampled from the live engine, draggable keyframes, draggable Bézier handles,
  in/out influence sliders, easing presets, Reset to Linear/Smooth, per-channel (X and Y independent).
* **Preview**: working resize and rotate handles, parent-aware hit testing, real text bounds, alignment guides (centre), and a **motion path** with draggable
  nodes, direction arrows, double-click-to-add and (Advanced) a curve handle per segment. The path is DOM-only and never reaches exported frames.
* **Animation library** (45 presets: Entrance, Exit, Continuous, Motion Graphics, Social Media) with search, categories, engine-sampled hover preview,
  Apply or drag onto an object. Presets write ordinary keyframes/procedural specs and show editable duration, delay, intensity, direction and easing.
  Custom presets can be saved. Entrance and exit presets coexist.
* **Text animation**: whole / word-by-word / letter-by-letter / line-by-line with pop, rise, drop, bounce, spin, fade; stagger, delay, highlight of the active unit,
  "spread across the layer's length" (speech timing), typewriter and counter presets. Text style panel follows Crayo (weight, case, underline/strike, outline, shadow).
* **Shapes**: rectangle, rounded, circle, triangle, hexagon/polygon, star, line, arrow with gradient, stroke, dashes, corner radius, glow, and trim-style reveal.
* **Templates**: 13 faceless-video scenes (title, kinetic type, lower third, story card, quiz, would-you-rather, chat, ranking, stat card, progress, timer, CTA, animated background).
  Inserting creates grouped, fully editable layers with presets already applied.
* **Subtitle menu** (Crayo parity): Edit tab lists cues; Style tab is split into Presets / Text / Position / Colours / Motion sections that fit without scrolling.
  Position offers **Top / Middle / Bottom**, always horizontally centred, plus a fine-tune slider. Extra animations: Bounce, Typewriter, Shake, Glow.
* **Stories tab** (replaces Templates): Fake text story (contact, chat style, editable messages), Would You Rather (question, options, vote split, colours) and Reddit (subreddit, user, title, typed body,
  votes) forms that add grouped, fully editable animated layers. **Video tab**: only the four gameplay backgrounds from the fake-text tool. **Text tab removed** (Subtitles cover it; a + Text button lives in Objects).
* **Subtitles**: default position is Middle. **Lines** presets now match Crayo's 16 line styles (own font, case, outline/box and active-word colour) and never use Word-mode animations.
* **Crayo-style Effects/Tools panels**: *Add a Zoom* (keyframed scale + position so you can frame the zoom), *Split at playhead* with a cuts list and per-cut transitions
  (Fade/Flash/Punch/Slide), *Add a LUT* with Manage LUTs (9 looks, intensity, apply to all), *Manage zooms*, and *Reframe* cameras (Add camera, Import reframe JSON, Camera & reframe card), and the Tools list with subtitles matching Crayo's.
* **Masks**: rectangle/ellipse mask per layer with animatable size/position/feather and invert (rendered identically in preview and export).
* **Chroma key** (image/video: key colour, tolerance, softness, spill suppression), **curved text** (arc ±360°), **anchor point** (rotate/scale pivot, animatable),
  and **vignette**. Chroma key and the new controls were checked to build and render in the app; chroma key was not verified against a real green-screen clip.
* **Trending sounds** (Audio panel): researched list of what's popular right now with TikTok/YouTube search links, source links and licence guidance.
  Reference only — see "Music" below.
* **Layer controls**: hide, lock, mute, solo.

### Sound FX, Music and the sound editor
* **Sound FX tab**: exactly two sections — **Normal** (30: Camera Shutter, Razor Slash, Whoosh, Swoosh, Pop, Click, Mouse Click, Keyboard Typing, Bass Drop, Vine Boom, Impact Hit, Glitch, Swipe,
  Zoom In / Out, Riser, Reverse Whoosh, Notification Ding, Bubble Pop, Flash, Camera Flash, Shimmer, Sparkle, Text Reveal, Typewriter, Record Scratch, UI Tap, Digital Beep, Transition Sweep,
  Cinematic Boom, Metal Clang) and **Brainrot** (14: Rizz, Among Us Role Reveal, Taco Bell Bong, Fortnite Death, Heavenly Music, Fah, Fah 2, Dexter, Tuco Get Out, Romance, Undertaker Bell, Fart With
  Reverb, Discord Leave, Emotional Damage). Every one has a preview play button, waveform, favourite and an **Add** button.
* **What the sounds are**: all 44 are **original FRAME synthesis**. The Mixkit / Pixabay / myinstants files are **not** bundled: Pixabay's licence forbids distributing its content standalone, the Mixkit
  licence text couldn't be retrieved to confirm, and the myinstants clips are third-party recordings. The Brainrot entries are original *sound-alikes* (labelled "original take"); each has a **Use my file**
  button, and *Import audio files* auto-matches names (`fah.mp3` → Fah) so you can swap in the real clip. Imports live in IndexedDB on this device only.
* **Music tab** (Spotify-style, blue): hero search, filter chips, featured track, cover art, per-section lists, preview with a now-playing bar, Add, credit panel, Upload. Your list is the catalogue:
  **6 Kevin MacLeod tracks are bundled and playable** (Sneaky Snitch, Fluffing a Duck, Scheming Weasel (faster), Monkeys Spinning Monkeys, Investigations, Run Amok — CC BY 4.0, credit text + Copy credit
  provided; "Scheming Weasel" only exists on incompetech as the "(faster)" file). The **12 commercial songs** (Metro Boomin, Dana and Alden, Tyler the Creator, Pharrell, Lovibe, Caleb Arredondo,
  Kanye West, AMBNT, Voj/Narvent, Eyewitness Records, C418, Bring Me the Horizon) are **import slots** with a source link — no audio is shipped; they play once you add your own licensed copy.
  14 FRAME-composed originals sit in a fifth section.
* **Sound editor** (select a sound clip → *Edit sound*): waveform you drag across to select; **Cut out selection**, **Keep only selection**, **Speed** (0.25–4×, selection or whole sound when nothing is selected), Reset,
  Play. Edits are non-destructive `segments` stored **on that timeline clip only** — the saved library sound is never modified.

### Properties panel & timeline
* **Properties panel (right sidebar, After Effects layout)**: Transform (Anchor Point, Position, Scale, Rotation, Opacity), Contents (shape: type, Size with link, Roundness, Fill, Gradient, Stroke, Dashes; media; text),
  Effects, Mask, Timing/Parent, Assistants & expressions (Advanced). Every property has a **stopwatch** (start/stop animating), blue scrubbable values (drag, click to type, ↑/↓), and previous / **add keyframe** / next buttons,
  plus an easing menu when animated. The old left "Motion" tab was removed — this replaces it.
* **Layer order**: drag the grip on any timeline track up or down to restack layers (top row = in front). New layers go on top; video/image backgrounds go to the back.

## Music: what was and wasn't done
Research (25 Oct 2026) found only editorial roundups, not usage data: "Two Fishes" (Corbin Mims audio clip), "Ramalama (Bang Bang)" by Róisín Murphy (Halloween reveals),
"Quiet on the Creek" by Saucy Santana (fading), and Jess Glynne as TikTok's top artist of 2026. For live rankings use TikTok Creative Center.
**Downloading those songs from YouTube as MP3 was deliberately not built**: they are copyrighted recordings, ripping them breaks YouTube's terms, and bundling them would
make the product unshippable. The supported routes are: upload audio you own or have licensed (Audio → Upload), TikTok's Commercial Music Library (free for Business
accounts, licence is TikTok-scoped), or a licensed library. The editor already mixes uploaded audio into exports and can duck it under subtitles.

## Verification performed
* `node --test tests/` — **49 tests** (engine, keyframe operations, presets, templates, SFX library incl. every sound rendered/finite/non-silent, boundaries, migration, expressions).
* Browser checks: Position A/B (left→right over 2 s; moving the key to 4 s), shapes, presets, templates, Graph Editor, motion path, SFX add/inspector,
  advanced mode, sidebar hover (real pointer), subtitle sections, and an **export from real Chrome** → MP4 with H.264 video + AAC audio containing the SFX.
* Performance (production build, 47 animated layers): ~0.7 ms per scrub step. (The dev build is ~50× slower because React runs in development mode.)

## Not done / known limits (nothing below is faked in the UI)
* Clyra files (`ClipperEditor`, Zoom Pins, crop keyframes, `clipSfxTimeline`) are absent — not audited.
* **Not implemented**: nested compositions, track mattes/alpha-luma mattes/freeform masks/chroma key, 2.5D/perspective/anchor-point, text-on-path, freehand/Bézier shape drawing,
  motion tracking & stabilisation, time remapping/speed ramps, particles, parallax depth, proxies, off-thread audio analysis, true multi-track audio lanes,
  independent pitch shifting (speed changes pitch too), voice-reaction sounds (gasps, laughs — need licensed recordings), and automatic narration ducking (ducks under subtitles instead).
* Curved motion paths use a quadratic bend handle per segment (not full cubic handles); X and Y still interpolate independently.
* Beat/level reactions analyse audio on the main thread.
* Export is still real-time MediaRecorder capture followed by local FFmpeg; a browser tab in the background throttles it. Click Export from a real user gesture so audio can start
  (otherwise the export falls back to video-only).
* Crayo parity: the subtitle menu, text inspector and layout were matched by direct comparison in Chrome; Crayo's licensed stock music/SFX and AI features are not reproduced.
* Sound licensing: the synthesised library is free to ship. If third-party packs are added later, record their source/creator/licence in the same metadata fields and verify
  redistribution rights inside an editor — do not assume "free for YouTube" allows repackaging.
