# Spatial tracking V3 — implementation and validation

30 October 2026. This report supersedes the planar-only tracking limitations in the 29 October editor report. It records measured results, not a universal accuracy guarantee.

## Rendering and editing

One COLMAP coordinate system and source-time camera timeline now drive placement, text/images/video/models, inspection and export. Camera translations and quaternion rotations interpolate only across neighbouring verified poses, with interpolated calibration. Surface normals remain fixed in world space; surface attachments cannot billboard. Local/world transforms, parent anchors, explicit sidedness, relative depth, four-corner manual constraints and motion diamonds are editable without model inference. A manual depth is labelled as a user choice.

Flat assets intersect calibrated rays with their actual camera-space plane. Per-pixel clipping preserves visible portions when the title centre leaves the screen or a corner crosses the near plane. Virtual assets share depth testing. Static reconstructed geometry remains occluding during per-instance foreground overrides. Calibrated foreground depth, instance silhouettes and explicit Front/Behind/Manual ordering use the same visibility implementation for models and flat assets. Invalid, stale or out-of-range depth is not treated as an observed surface.

Video, Points, Wireframe and 3D Inspect display cached solved geometry. Placement previews use the production compositor. Guides clip to the preview, including zoom and overlapping properties drawers. The inspector reads valid layer HTML independently of attribute order. AI tools can inspect/place native anchors, edit normals, sidedness and parents, add motion keys, set per-instance ordering/ranges and refine foreground without a camera rescan. Actions have specific status text and icons.

## Native analysis and installation

The lightweight browser tracker remains available. Native OpenCV/COLMAP is optional, installed outside Electron's app bundle:

```sh
python3 tools/setup-shorts-spatial.py
python3 tools/setup-shorts-spatial.py --matching
python3 tools/setup-shorts-spatial.py --advanced
```

Use Python 3.10 or newer; 3.12 is recommended. `--matching` installs filtered ALIKED/LightGlue recovery. `--advanced` adds SAM 2.1 Tiny and Video Depth Anything Small. Models load only in isolated analysis jobs. The current Intel Mac uses CPU inference; CUDA/MPS paths are feature detected. `CLYRA_SPATIAL_HOME` and `CLYRA_SPATIAL_PYTHON` can point to an external runtime. This is not a packaged Windows runtime validation.

The scheduler uses measured planar fit, parallax, confidence and available resources. Neural recovery is restricted to textured missing camera frames, a bounded candidate/reference budget, calibrated PnP and reprojection checks. Longer sparse sequences propose bounded nonlocal appearance pairs and require geometric verification before bundle adjustment. Jobs run one at a time with two CPU threads, a 15-minute limit and a memory watchdog. Source content hashes prevent stale reuse after same-path video replacement.

Foreground refinement stores the forward pass on disk and streams the backward pass rather than retaining whole intervals in RAM. It uses actual source presentation timestamps. Disk capacity bounds refinement; `refinedThroughUs` and `refinementLimitFrames` record coverage. Explicit brush edits update the chosen source frame and instance without rerunning the camera or models. Source masks remain unchanged and unaffected frames retain references.

VGGT was researched but is not installed or advertised as operational. Its commercial checkpoint is separately gated; the original research checkpoint is not an interchangeable commercial dependency. The Intel 16 GB test computer is not an appropriate default for that model.

## Measured checks

Evidence: `docs/qa/2026-10-30-spatial-v3/` and the 29 October spatial-repair folder.

| Check | Result |
|---|---|
| Supplied IMG_1899.MOV native sparse reconstruction | 30/38 poses; 1,720 reliable points; median reprojection 0.46335 pixels at 540×960 |
| Source-frame refinement | 147 verified poses of 186 samples, ending at 4.873333 seconds |
| Cold full camera job | 101.99 seconds; 430.8 MB peak RSS |
| Cached reconstruction plus decoding/refinement | 48.558 seconds; 449.85 MB peak RSS; not a cold-solve comparison |
| Native planar first 2 seconds | 24/24 good samples; median 0.3952 pixels; 11.249 seconds |
| Held-out corridor LightGlue recovery | 21 PnP inliers; 1.22157 pixel reprojection; 18.045 seconds |
| Real SAM two-person sample | Five observed masks; 24 refined masks; persistent separate IDs |
| Bounded mask refinement alone | 24 frames; 11.836 seconds; 299.13 MB peak RSS |
| Real-mask foreground compositor | Three timestamps; Front reveals the covered text, Behind preserves silhouettes; no browser errors |
| Per-instance override | Separate people, missing ID, manual depths 3/5 and static-wall occlusion passed |
| Production GPU clipping fixture | Offscreen-centre title remains partially visible; near-plane crossing retained; decal/double-sided and virtual depth ordering passed |
| Imported animated model in spatial compositor | Real glTF animation moved projected centre 31.5 pixels; no shader/browser errors |
| UI views and motion keys | Four views opened; key added/removed; five widths had no document overflow; no page errors |
| Regression suite | 121 frame tests passed |
| Native brush edit API | Completed without camera/model work; exact source-frame edits and missing-instance handling tested |
| Bounded nonlocal pairs | 10/10 held-out real corridor pairs geometrically verified in 521 ms; this is not a full real wall-return test |

The GPU fixture uses exact camera/plane data, explicitly distinct from reconstructing a real video. The person compositor fixture uses real SAM masks with an explicit manual fixed camera; it does not claim a camera solve of that sample. The earlier corridor export had ECC 0.997–0.999 and residual translation below approximately 0.31 pixels at 540×960 over four checked frames. The new V3 exports passed seven full-film preview comparisons: corridor ECC 0.99938–0.99971 with less than 0.05 pixel translation, foreground ECC 0.99849–0.99854 with less than 0.023 pixel translation. Green-title boundary IoU was 0.975–0.982 after H.264 encoding. Full-film previews preserve the native video plus transparent spatial layer; the layer-only background fixture is not used as a color reference for HDR footage. The corridor export is 1080×1920/30 FPS (186 frames), and the foreground export is 1920×1080/30 FPS (24 frames), both written to Downloads.

## Remaining validation limits

The supplied corridor approaches a nearly blank door. Its final 1.3 seconds do not contain enough verified geometry for an exact world pose. Unsupported intervals remain uncertain; extra smoothing does not fabricate observations. That clip does not contain a full wall pass-and-return or crossing person. Those combined real-world scenarios, fine hair boundary ground truth, arbitrary furniture, severe shake, actual 4/8 GB hardware, physical iPhone Safari and packaged Windows remain unverified. Synthetic clipping tests do not substitute for those real capture tests. The isolated 20-second headless scan profile on this loaded Intel Mac recorded median 33.3 ms and p95 66.7 ms; adaptive quality reduced the render surface to 188×335. Sustained 60 FPS was not demonstrated. The effect can fall back to native video when its measured budget is exhausted.

Audio is tracked independently: 34 exact-source sound effects and 18 music recordings are enabled. Ten unresolved effect names remain unchanged and blocked as requested. Near-name or punctuation variants are not silently substituted.

Verification used the repository design-director, pixel-perfect-ui-engineer and visual-qa-and-refinement pipeline. Two visual repairs addressed inspector loading and guide overlap, followed by a five-width recheck. Dark mode retained #4568ee and reduced-motion was active. Root/editor typechecks, the UI build, 121 frame regressions and the native correction test passed. Electron was relaunched, but the native computer-control connection lacked editor accessibility and returned noWindowsAvailable/invalid-app errors; the latest advanced-editor interaction is therefore browser-verified, not a completed native UI sign-off.
