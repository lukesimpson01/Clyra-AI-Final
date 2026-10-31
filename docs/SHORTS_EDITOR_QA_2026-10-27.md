# Shorts editor verification — 27 October 2026

## Implemented behavior

- Scanning uses one automatic foreground pass for recognised people and objects, with close-up refinement when needed. There is no people/object/none chooser. A source-clip selector supports overlapping footage. Tracking and mask proxies have bounded long edges, including rotated portrait footage. Inference and mask cleanup run in workers with backpressure and cached results.
- Tracking placement has picture picking, horizontal/ground position, relative distance, elevation, letter spacing and thickness. Per-subject ground-contact estimates determine automatic foreground occlusion. Source boxes, aspect ratios and embedded dark bars are respected.
- The scan animation genuinely displaces the live DOM using an SVG image field and displacement filter. One clock drives a 7.6-second down/up cycle. The field is generated only on resize, with a curved Gaussian push/pull lens. Measured overload switches to a single-pass shader sampling the available native video texture. Controls under Scan detail allow adaptive/video/off and strength. Reduced motion, hidden documents, cancellation and cleanup are handled. WebKit needs a nonzero SVG viewport, both image references and a decoded displacement image before the filter is applied.
- A device's next action appends to its evaluated last pose. Intro, lid, movement, turns, holds and screen playback stay in one clip. Repeated screen power actions retain earlier intervals. MacBooks support open/close lid. Cameras can continue from the preceding pose; the scene/path editor has a fullscreen view.
- The AI receives the editor's tool catalog and saved project settings, acts in bounded batches, reads results, limits repeated failed actions and performs a saved-settings review. It can inspect video samples through a separate DeepSeek Flash vision model while text chat keeps its own model. Actions have specific icons and progress text. Structural review is explicitly distinguished from visual verification.
- Export uses a centered dialog with 1080p/720p and destination only, plus actual server progress, cancellation and reveal. Hardware H.264 encoding remains enabled. Empty foreground masks no longer force redundant footage seeks in a tracked overlay.
- Shorts and the advanced editor fade in, respect reduced motion and use their existing shared frontends. The lower-right Clyra exit button was removed. Narrow editor panels become dismissible drawers; export notifications stay within the viewport.
- Twelve named music recordings and fifteen named sound effects are local MP3 files, with source URLs and measured durations in `shorts-library/recordings.json`. Named entries no longer play their generated stand-ins. Other synthesised effects are labelled. GONE, GONE / THANK YOU is labelled as the complete official combined track; Resonance is credited to HOME. Recordings stay in the private, ignored local library.

## Verified

- Root `npm run lint`; editor `tsc --noEmit`; editor production build.
- 22 tracking, motion, portrait geometry, device sequence, screen-state and camera continuity tests passed. DeepSeek vision contracts passed 15 assertions.
- Imported `/Users/lukesimpson/Downloads/IMG_1899.MOV`: 6.2067 seconds, rotated 4K HEVC source. The browser-compatible proxy preserves portrait orientation. Balanced analysis produced 112 samples, Good tracking, 0.688-pixel median error, 0.837 inlier share and 0.958 mask confidence.
- Uncached scan on this machine: 93.432 seconds versus 143.495 seconds for the preceding full-surface-filter version. This is a local comparison under different concurrent work, not a portable benchmark.
- Actual exports of the 6.2-second tracked-title project completed with H.264 video, AAC audio and 720×1280 output. The later run took 94.749 seconds versus 179.835 seconds before the redundant seek reduction. Early output frames visibly include the extruded FUTURE title; the tracked point subsequently leaves view as the camera walks past it.
- A real AI chat request inspected the existing MacBook, appended one 45-degree turn after its lid actions, read the saved settings and retained one device clip. Imported footage then played on that same MacBook after the earlier actions.
- A real DeepSeek Flash call identified the empty hallway, walls, floor, door and useful title locations; it correctly reported no visible person. An initial zero-time hardware-decoder frame was black, so sample capture now starts slightly into the footage.
- Space Cadet preview and timeline import fetched the original local MP3; the imported file measures 203.52 seconds. Fah preview fetched its original named recording. All 27 recording files were downloaded and probed for nonempty duration. Sources include the artist audio URLs in the manifest and the [named Vine Boom source](https://www.myinstants.com/en/instant/vine-boom-sound-70972/).
- Browser screenshots were inspected at 320, 375, 768, 1024 and 1440 pixels, including narrow export and dark theme. Tablet title/toolbar overlap and a phone-width export notification overflow were repaired and rechecked.
- Chromium, Firefox and WebKit rendered the actual footage/title project. Separate live-DOM refraction checks retained typing, button clicks and scrolling, cleaned up correctly and stopped for reduced motion. WebKit's initial blank-filter rendering was found by screenshot inspection and repaired.
- A 125-second forced full-DOM refraction recording exercised repeated cycles and verified interaction and cleanup. The final repeat recorded 1,853 frames, median interval 66.6ms and p95 133.3ms; the earlier run's p95 was 383.3ms during concurrent export work. Full-DOM rendering remains too expensive in this headless setup. Production keeps adaptation enabled and switches to the video surface rather than promising sustained 60fps here. A static before/after grid and text comparison visibly confirms real pixel displacement.
- Electron was restarted with the new server and its running Clyra window was inspected. Studio's built assets were refreshed for the shared advanced editor.

## Practical limits

- Real-footage tracking is a dominant-plane solve with estimated relative depth and ground contact. It is not a reconstructed 3D environment. Three-dimensional camera paths affect synthetic device scenes; ordinary footage is reframed with the 2D camera. The main footage preview remains visible when a 3D camera is inserted.
- The supplied hallway has no person, so real-person crossing/occlusion has not been visually validated on that file. Perspective tracking has synthetic outlier and motion tests.
- Browser engine smoke tests are not physical iPhone Safari tests. Browser zoom, every device pixel ratio, long moving crowds and several simultaneous long source videos have not had a complete visual matrix.
- 60fps over the entire DOM was not achieved in the recorded headless profile. Adaptive video refraction is the lighter path; final performance still depends on video decoding and graphics hardware.
- Vision samples selected moments, not every frame. The agent can edit through its registered tools but is not guaranteed to complete every arbitrary request.

## Repeating checks

`tools/qa-shorts-refraction.mjs` creates a real test surface and a multi-minute recording/performance report under `/tmp/clyra-refraction-qa`. Set `CLYRA_RIPPLE_QA_MS` to change its duration. It disables adaptation deliberately to measure the full DOM cost.

`tools/qa-shorts-browsers.mjs` checks Firefox and WebKit. Set `CLYRA_STUDIO_QA_URL` to the authenticated local Studio project URL. Reports and screenshots are written under `/tmp/clyra-browser-qa`.

`tools/refresh-shorts-audio.mjs` refreshes the private recording manifest and MP3 files; it accepts optional catalog ids. Set `CLYRA_AUDIO_PYTHON` to a Python environment containing yt-dlp for music downloads.
