# Exact sound identity and tracking follow-up — 29 October 2026

This follow-up supersedes the earlier audio-readiness claims in `SHORTS_EDITOR_QA_2026-10-29.md`. A file decoding or playing successfully does not establish that it is the requested recording.

## Final library behavior

- All 44 original sound-effect labels remain. **31 effects are enabled; 13 are explicitly unresolved.** All 18 music tracks remain enabled.
- Near-name substitutions were removed. The downloader no longer selects sources by shared words or fuzzy scores. Exact title comparison retains punctuation, digits and repeated letters; only case and formatting whitespace are normalized. The source page, MP3 URL and SHA-256 are pinned as well.
- A named upload is not sufficient by itself. Content screening found that the exact-title Flash candidate contained music, and Swipe contained a spoken quote. Both are unresolved. Local speech recognition was used to flag ambiguity, not to certify the identity or category of every non-speech effect.
- Unresolved entries retain their labels, show their status, and cannot preview or import. Both Studio and Shorts reject direct requests for those recordings with HTTP 409. Rejected files are preserved for recovery, not deleted or relabelled as successful matches.
- Enabled entries link to their exact source page. Titles wrap in narrow drawers, so users can read the full name. The Add action keeps an accessible label when its visible text yields space to the name.
- Automatic filename assignment and AI sound selection now require exact names or explicit catalog IDs. Fah, Fah!!, Fahh, Fah 2, Original Fah and remix suffixes are not silently merged. AI knowledge lists enabled source recordings and no longer describes commercial songs as generated stand-ins or all audio as free original Shorts synthesis.
- Repeated quick preview/stop/replay cannot let an old audio completion clear the newer playback state.

The pinned page identifies a particular upload. Exact titles do not prove that a name has only one upload or that every listener intends that edition; the source link makes that identity reviewable.

## Validation

The final real-browser run used **Exact sounds verified QA 29 Oct** (`v5HW7fLXeg-h`):

- **49 actual Play buttons passed**: 31 enabled effects and all 18 music tracks, with native playback advancing and no media errors.
- **All 13 unresolved entries** had both Play and Add disabled. Direct requests were refused.
- **Whoosh and Fah imports** matched the pinned source fingerprints byte for byte. Their actual durations were used on the timeline.
- Screenshots at **320, 375, 768, 1024 and 1440 px**, plus dark and reduced-motion states, had no horizontal overflow. A follow-up check verified that effect names were not ellipsized or vertically clipped.
- The editor reported **zero page exceptions** during these checks.
- Endpoint tests covered Studio authentication, 256-byte range streaming, source changes being refused, all 13 rejections on both origins, and the complete original MP3 bytes.
- Negative download tests confirmed that unresolved entries are refused without changing existing audio files.
- All 62 retained files fully decode and match their stored hashes. This includes the 13 retained but unavailable files; **49 are currently playable**, not 62.
- Root typecheck, editor typecheck and editor production build passed. The existing large-bundle/runtime-font build warnings remain.
- The running Electron development app was visually checked with the final sound panel: verified source links and disabled unresolved entries were present, including the excluded Flash and Swipe recordings. A stale desktop-control connection required reacquiring the app; no Electron source change was needed. The app is currently open on that sound panel.

Evidence, screenshots, endpoint results and performance measurements are in [qa/2026-10-29-exact-sounds](qa/2026-10-29-exact-sounds/). The checks are repeatable through `tools/qa-shorts-sound-identities.mjs`, `tools/recording-identity-tests.mjs`, `tools/recording-endpoint-tests.mjs` and `tools/verify-shorts-recordings.mjs`.

## Additional tracking repairs

- Optical flow reuses one flat Float64 workspace rather than allocating hundreds of short arrays per point and pyramid level. This adds no dependency or startup model.
- The controlled comparison produced **identical flow positions** before and after, across 480 verified point observations. Maximum known-translation error was **0.06050 proxy pixels**. In the final local run, median loop time changed from 1.512 ms to 1.027 ms and p95 from 5.223 ms to 2.177 ms. Peak process RSS was about 65.6 MiB with a 128 MiB JavaScript heap limit. These are hot-loop measurements, not whole-editor FPS or a physical low-end-device test.
- Surface interpolation now holds the last verified transform through a lost interval. It does not drift toward a future recovered observation before that observation's timestamp.
- New regression cases check lost/reacquired timestamps, blank surfaces, fully masked surfaces, seeding only inside the actual selected quad, and fast alternating camera shake. **All 88 frame/motion/scene tests passed.**
- The independent universal tracker also passed under a 128 MiB heap limit. The 25-frame controlled patch case measured zero anchor error; its allowed test threshold is separately reported as 0.75 px.

The classical flow and planar fitting follow the principles in the [OpenCV optical-flow reference](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html) and [projective geometry reference](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html). No external tracking implementation or restricted research weights were copied for these changes.

## Earlier requested workflows

The [main editor report](SHORTS_EDITOR_QA_2026-10-29.md) records the implementation and previous real checks for automatic scene tilt and relative depth, selectable source videos and surface markers, text shadow and entrance/exit animation, font previews, universal point/region tracking and correction, device action blocks, screen start timing, MacBook lid motion, manual/free-flight camera keys, animated model imports, DeepSeek video inspection and the agent loop, refractive scan playback, word-by-word subtitle entrances, compact stories, theme transitions, entry fades and simple export.

These changes do not establish perfect tracking for every possible video or surface. The supplied corridor still has measured per-surface losses, and its empty scene does not validate people crossing text. Full metric 3D reconstruction, the complete difficult-video A–P test matrix, physical iPhone Safari/4–8 GB hardware testing and sustained 60 fps remain unverified. The system must expose uncertainty when the video does not support an accurate observation.

## Exact source ledger

The table below records the final enabled source identities and preserved unresolved labels.

| Original label | Status | Exact source / reason |
|---|---|---|
| Camera Shutter | Enabled | [Camera shutter](https://www.myinstants.com/en/instant/camera-shutter-181/) |
| Camera Flash | Enabled | [camera flash](https://www.myinstants.com/en/instant/camera-flash-76132/) |
| Flash | Unresolved | The exact-title page contains music; a camera flash effect is not verified. |
| Razor Slash | Unresolved | No exact source title matched. |
| Whoosh | Enabled | [Whoosh](https://www.myinstants.com/en/instant/whoosh-8122/) |
| Swoosh | Enabled | [Swoosh](https://www.myinstants.com/en/instant/swoosh/) |
| Swipe | Unresolved | The exact-title page contains a spoken cosmetics quote; a swipe transition effect is not verified. |
| Zoom In / Out | Unresolved | No exact source title matched. |
| Reverse Whoosh | Unresolved | No exact source title matched. |
| Transition Sweep | Unresolved | No exact source title matched. |
| Glitch | Enabled | [Glitch](https://www.myinstants.com/en/instant/glitch/) |
| Riser | Enabled | [Riser](https://www.myinstants.com/en/instant/riser-51700/) |
| Impact Hit | Unresolved | No exact source title matched. |
| Cinematic Boom | Enabled | [Cinematic Boom](https://www.myinstants.com/en/instant/cinematic-boom/) |
| Bass Drop | Enabled | [bass drop](https://www.myinstants.com/en/instant/bass-drop-66469/) |
| Vine Boom | Enabled | [vine  boom](https://www.myinstants.com/en/instant/vine-boom-23240/) |
| Metal Clang | Enabled | [Metal clang](https://www.myinstants.com/en/instant/metal-clang-13080/) |
| Record Scratch | Enabled | [Record Scratch](https://www.myinstants.com/en/instant/record-scratch/) |
| Click | Unresolved | No exact source title matched. |
| Mouse Click | Enabled | [Mouse Click](https://www.myinstants.com/en/instant/mouse-click-84937/) |
| UI Tap | Unresolved | No exact source title matched. |
| Keyboard Typing | Enabled | [keyboard typing](https://www.myinstants.com/en/instant/keyboard-typing-48467/) |
| Typewriter | Enabled | [Typewriter](https://www.myinstants.com/en/instant/typewriter-15339/) |
| Text Reveal | Unresolved | No exact source title matched. |
| Digital Beep | Unresolved | No exact source title matched. |
| Notification Ding | Unresolved | No exact source title matched. |
| Pop | Enabled | [pop](https://www.myinstants.com/en/instant/pop/) |
| Bubble Pop | Enabled | [Bubble Pop](https://www.myinstants.com/en/instant/bubble-pop-70116/) |
| Shimmer | Enabled | [Shimmer](https://www.myinstants.com/en/instant/shimmer/) |
| Sparkle | Enabled | [sparkle](https://www.myinstants.com/en/instant/sparkle-88039/) |
| Rizz Sound Effect | Enabled | [rizz sound effect](https://www.myinstants.com/en/instant/rizz-sound-effect-54189/) |
| Among Us Role Reveal | Enabled | [Among Us role reveal](https://www.myinstants.com/en/instant/among-us-role-reveal-15722/) |
| Taco Bell Bong | Enabled | [Taco Bell Bong](https://www.myinstants.com/en/instant/taco-bell-bong-42481/) |
| Death Sound (Fortnite) | Enabled | [Death sound (Fortnite)](https://www.myinstants.com/en/instant/death-sound-fortnite-13941/) |
| Heavenly Music | Unresolved | No exact source title matched. |
| Fah | Enabled | [fah](https://www.myinstants.com/en/instant/fah-26585/) |
| Fah 2 | Enabled | [FAH 2](https://www.myinstants.com/en/instant/fah-2-5686/) |
| Dexter Meme | Enabled | [Dexter meme](https://www.myinstants.com/en/instant/dexter-meme-26140/) |
| Tuco Get Out | Enabled | [tuco GET OUT](https://www.myinstants.com/en/instant/tuco-get-out-65678/) |
| Romance | Enabled | [Romance](https://www.myinstants.com/en/instant/romance-18444/) |
| The Undertaker Bell | Enabled | [The Undertaker Bell](https://www.myinstants.com/en/instant/the-undertaker-bell-30938/) |
| Fart With Reverb | Enabled | [fart with reverb](https://www.myinstants.com/en/instant/fart-with-reverb-17715/) |
| Discord Leave Noise | Enabled | [Discord Leave Noise](https://www.myinstants.com/en/instant/discord-leave-noise-46083/) |
| Emotional Damage Meme | Enabled | [Emotional Damage Meme](https://www.myinstants.com/en/instant/emotional-damage-meme-74555/) |

## Follow-up: remaining 10 effects filled (user-approved substitutes)

Freesound has no CC0 upload with the exact titles of these ten labels, so the user approved type-matched CC0 recordings. Each keeps its real source title, page, author and SHA-256 (`substitute: true` in `sound-recordings.mjs`); the catalog label is unchanged. `tools/import-shorts-reviewed-substitutes.mjs` downloaded them. All 44 effects are now verified and playable (`tools/verify-shorts-recordings.mjs`, `tools/recording-identity-tests.mjs` pass). Audio was checked by decode, duration and hash, not by listening.

| Label | Source recording (CC0) |
|---|---|
| Flash | [Camera Flash_Crackle_Near_Mono.wav](https://freesound.org/people/_stubb/sounds/406614/) |
| Razor Slash | [Slash](https://freesound.org/people/qubodup/sounds/442903/) |
| Swipe | [Swipe.wav](https://freesound.org/people/LilMati/sounds/702773/) |
| Zoom In / Out | [Dramatic Camera Zoom](https://freesound.org/people/sanaku/sounds/371882/) |
| Reverse Whoosh | [Backwards Whoosh](https://freesound.org/people/SlavicMagic/sounds/446010/) |
| Transition Sweep | [Transition Swoosh](https://freesound.org/people/adh.dreaming/sounds/632763/) |
| Impact Hit | [Hit Impact](https://freesound.org/people/MadPanCake/sounds/660770/) |
| UI Tap | [Aggressive Button Tap / UI Tap Hit](https://freesound.org/people/subquire/sounds/833601/) |
| Text Reveal | [Data Reveal Sound](https://freesound.org/people/Sky_Motion/sounds/511418/) |
| Heavenly Music | [Choir of Voices - Single Chord](https://freesound.org/people/bone666138/sounds/274121/) |
