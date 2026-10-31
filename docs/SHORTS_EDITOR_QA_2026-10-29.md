# Shorts editor implementation and verification — 29 October 2026

The [30 October spatial V3 report](SHORTS_SPATIAL_V3.md) supersedes this report’s planar-only tracking description. This report supersedes the 27 October report. Work and verification span 27–29 October. The editor is integrated into the existing Shorts app and uses the same sources in web and Electron development.

**Later exact-sound audit:** the previous 62-file playback check established decoding, not correct source identity. The [sound-identity follow-up](SHORTS_SOUND_IDENTITY_QA_2026-10-29.md) supersedes audio readiness below: 34 sound effects and 18 music tracks are enabled; 10 original effect labels are preserved but explicitly unresolved and blocked from preview/import. It also records the later tracking hardening and 88 passing frame tests.

## Delivered behavior

### Tracking and scene text

- Point and custom-region selection use source coordinates, including preview scaling, crop, portrait orientation and letterboxing. Small targets use a native-resolution region, with a selection magnifier. Category recognition is not required.
- Tracking loads on demand. Local appearance matching, sparse feature motion, bounded workers, verified reference variants and timestamp-aware search feed one confidence-aware track. Cursor hotspots and blinking carets have separate handling. Optional face, hand and body verification loads only when needed.
- Observed, predicted, occluded, lost and reacquired states remain distinct. Corrections repair a bounded interval. Raw source measurements and the camera trajectory are separate; changing camera settings reuses the source track. The camera holds verified framing during target loss.
- Scene understanding uses DeepSeek vision samples. Per-surface tracking follows selected walls separately from the overall camera solve. Pixel evidence refines visible corridor corners, distinguishing a narrow receding wall from the front-facing wall beside it. Unsupported edges are not invented.
- A clicked surface supplies the default perspective. Relative depth, manual adjustment, entrance/exit animation, font previews, text shadow and per-split foreground placement remain editable. Perspective markers identify candidate attachment points. Source selection supports several video clips.
- Placement no longer asks users to choose people/object/none or a walk-through/text-in-scene template. Automatic foreground analysis runs at an adaptive cadence. Low-confidence or extreme close-up projections fade rather than claiming an accurate pin.
- The transparent tracked overlay now preserves the native footage underneath; its WebGL clear alpha had caused a black preview.

### Devices, camera paths and models

- Next actions append after the sequence's last action, independently of the playhead. They create separate source-time blocks on the same timeline track and reuse the same device/page.
- Intro movement is preserved exactly. Later movement, turns, holds, screen power, exits and MacBook lid actions continue from the previous pose. Lid motion uses a bounded smooth curve.
- Importing screen media defaults to starting at its action. Explicit start/time overrides are available. Screen-off intervals no longer reveal the video prematurely or repeatedly seek hidden media.
- Move-to-position offers an interactive scene view. Camera paths support fullscreen viewing, continuing from the last pose, manual keys and WASD/Q/E navigation with Space to add a key. Preset and manual spatial keys appear as timeline diamonds.
- Imported GLB/glTF and FBX models can use animation clips. Two imported characters and their motions were exercised in the saved Mixamo QA scene.

### Scan, AI, subtitles, audio and controls

- The scan effect performs actual pixel displacement. Live DOM uses an SVG displacement field generated only on resize; one monotonic clock moves a bowed lens down and up. Available video pixels can use a single-pass texture shader. A restrained blue ridge and sheen follow the wave. Hidden tabs, reduced motion, cleanup and measured overload are handled.
- Scan playback starts normally and can switch to a cached forward/reverse loop. Reverse preparation uses bounded two-second chunks. Native video remains available when the visual effect adapts down or disables itself.
- AI chat can inspect sampled video through DeepSeek vision and receives the editor tool catalog, project state and spatial editing tools. The bounded action loop reads back saved changes and limits repeated failures. Action icons, progress text and shimmer distinguish actual work. A structural readback is not presented as visual proof.
- The OpenFilm editing skill is installed at `.claude/skills/openfilm/SKILL.md` for Claude Code.
- Subtitle Lines reveal words individually with slide motion over roughly 0.85 of the font height, using aligned word times when present. Manually entered cues use a documented even-timing fallback. None displays the line without entrance animation.
- The 62 retained MP3 files include 18 music tracks and 44 sound-effect entries. The later identity audit enables 34 effects and blocks 10 unresolved entries. The library records source URLs, measured duration and hashes. Studio serves and streams the library from its own origin, avoiding dependence on the Shorts preview server for audio playback. Playback begins inside the click gesture; import uses the same verified recording.
- Export is centered, with 1080p/720p, destination, real progress, cancellation and reveal. Hardware H.264 encoding remains available.
- Full-height story panels use compact controls and flexible remaining space. Narrow WYR cards put the vote slider above the toggle; the header fits the drawer. Dark fields and navigation have readable contrast. Editor and embedded tools retain the same blue accent, `#4568ee`, through theme changes.
- Shorts/editor entry fades and reduced-motion handling remain integrated; the lower-right Clyra exit control was removed.

## Checks repeated on 29 October

| Check | Result |
|---|---|
| Root `npm run lint` | Passed |
| Editor `npm exec tsc -- -p studio/ui --noEmit` | Passed |
| Editor `npm run build:ui` | Passed; existing large-chunk/runtime-font warnings remain |
| Frame/motion/scene tests | Final follow-up: 88 passed, 0 failed |
| Focused export, subtitle, font and file server tests | 22 passed, 0 failed |
| Universal tracking regression | Passed, including camera hold during lost tracking; final controlled 25-frame case measured 0 px anchor error against a separate 0.75 px acceptance threshold |
| All library MP3s | 62 fully decoded; all recorded hashes match |
| Chromium story layouts | 320, 375, 768, 1024 and 1440 px: no document or embedded horizontal overflow |
| WYR dark layouts | All five widths; readable inputs, unclipped AI Writer, no card overflow |
| Theme controls | Light/dark accent both `#4568ee`; embedded tool receives dark; saved dark preference retained in earlier reload check |
| Firefox and WebKit | Real editor viewer loaded; real DOM refraction, typing, click and reduced motion passed; no page exceptions |
| Electron | Opened Shorts, entered the advanced editor, selected the saved corridor project, scrubbed to 0.8 s and inspected its wall-title depth/shadow controls |

The UI pipeline used the repository's design-director, pixel-perfect-ui-engineer and visual-qa-and-refinement instructions. Screenshots exposed low-contrast WYR fields, a narrow header overflow and Reddit's white post container in dark mode; those defects were repaired and visually rechecked in two focused cycles. The smallest WYR drawer uses 186 px cards; larger drawers use 158 px cards, with remaining height available for scrolling. Dark Reddit and text-story controls were also checked in the actual embedded panels, without page exceptions.

Evidence is saved in [qa/2026-10-29](qa/2026-10-29/), including five-width screenshots, browser reports, test logs, audio verification and the corridor analysis result. [Corridor preview](qa/2026-10-29/corridor-preview.png) and [export frame](qa/2026-10-29/corridor-export.png) show tilted text on the inner side wall and a front-facing title at the end door at 0.8 seconds.

## Real footage and exports

The original `/Users/lukesimpson/Downloads/IMG_1899.MOV` was preserved. Its 6.2067-second rotated 4K HEVC footage is in **Corridor surface QA 28 Oct** (`IrM9lkMjxFm4`). Analysis `fe15b73ad9acbe87` stores 112 samples at a 288×512 analysis size. Its recorded elapsed time is 41.037 seconds, camera median fit error 0.682 proxy pixels and camera inlier share 85.1%, with no detected hard cuts. Earlier runs used different cached vision/settings and concurrent workloads, so they are not a controlled speed comparison.

| Surface | Reported quality | Lost samples |
|---|---|---:|
| Wood floor | Poor | 13.4% |
| Left inner wall | Good | 9.8% |
| Left foreground wall face | Poor | 21.4% |
| Right inner wall | Poor | 29.5% |
| Right foreground wall face | Poor | 48.2% |
| End wall with door | Poor | 21.4% |

These are actual uncertainty measurements, including surfaces leaving view. The overall camera's Good label must not be read as Good tracking on every surface.

Verified exports retained in Downloads:

- `Clyra-corridor-surfaces-verified.mp4`: 720×1280, H.264/AAC, 186 video frames, 6.2 seconds. Preview and export visibly agree at the checked timestamp. The measured export took about 57.5 seconds in the earlier headless run.
- `Clyra-device-actions-test.mp4`: 720×1280 H.264, 276 frames, 9.2 seconds. Real UI actions appended Close lid at 7.6 seconds and Open lid at 8.4 seconds as separate blocks despite the playhead being at zero.
- `Clyra-Mixamo-scene-test.mp4`: 720×1280 H.264, 51 frames, 1.7 seconds, with imported animated characters.

All three files were probed again on 29 October. The earlier black `Clyra-corridor-surfaces-test.mp4` is a failed intermediate, not the verified result.

Earlier real UI audio checks exercised all 62 Play buttons (30 Normal, 14 Brainrot, 18 Music) with native playback advancing and no errors. Space Cadet and Fah were imported through their Add buttons into **Audio playback QA 28 Oct**; the imported bytes matched the catalog recordings. MyInstants' named Fah page and its Download MP3 link were inspected in the browser.

Earlier native-resolution benchmarks recorded a 4K cursor maximum verified error of 0.21434 px, with hidden frames unverified and a large jump reacquired. A separate variable-frame-rate case retained 30 actual source timestamps and measured 0.33655 px maximum error. These controlled recordings do not establish universal real-world accuracy. The supplied corridor's separate 2D point track verified only 62.1% of 372 samples and correctly retained lost intervals.

## Remaining validation limits

- This is planar perspective plus estimated relative depth and foreground contact, not metric 3D reconstruction or a guaranteed shake-proof world anchor. The per-surface losses above remain material. Manual correction is available.
- People crossing the title were not visually validated using the empty corridor. Long crowd identity tests, difficult caret relocation, every cursor appearance and the complete requested A–P scenario matrix have not all been completed.
- The earlier active headless scan profile measured median frame intervals of 33.3 ms and p95 149.9 ms under concurrent work. Sustained 60 fps was not demonstrated. Adaptive degradation is enabled; physical GPU, iPhone Safari and 4–8 GB hardware profiling remain outstanding.
- The cross-browser checks use desktop browser engines, not physical iPhone Safari. Browser zoom and all pixel ratios have not had a full matrix.
- Three-dimensional cameras control actual 3D scenes. Ordinary footage uses the 2D follow camera; it is not rebuilt as a full 3D environment.
- Vision inspects sampled frames and cannot guarantee understanding of invisible geometry. The AI has a concrete tool harness, not a guarantee of completing every arbitrary request.
- The earlier Electron corridor check displayed **Corridor surface QA 28 Oct** at 0.8 seconds, with the left-wall title selected, its surface quality and relative depth controls visible, and both tilted side text and front-facing EXIT rendered over the footage. The later exact-sound follow-up leaves the app open on Sound FX. Desktop navigation sometimes required reacquiring the desktop-control connection; the check used an accessibility-enabled development launch. This is not a packaged-binary validation.

Optional cleanup of two old agent-created temporary browser profiles was rejected by automatic approval review because removal commands were not permitted. No alternate deletion method was used. User media and unrelated working-tree changes were preserved.
