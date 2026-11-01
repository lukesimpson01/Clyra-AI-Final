# Spatial tracking QA

Scores the editor's scene reconstruction and surface pins against ground truth (synthetic) and against the footage itself (real).

Needs the native spatial runtime (`python3 tools/setup-shorts-spatial.py`, Python 3.10+). Paths below use `.venv-spatial/bin/python`.

1. **Synthetic room with exact cameras** — `synth_scene.py OUT [--walkers 1]` renders a walk through a textured room (`scene.mp4`) and writes `truth.json` (true cameras, true projections of a wall, floor and side-wall point, optional crossing person).
2. **Reconstruct** — `studio/server/spatial/engine.py --config cfg.json` (`{"source","from","to","output"}`) writes `solution.json`.
3. **Score vs truth** — `score_poses.py solution truth` (camera centre and rotation error after similarity alignment) and `node score-anchors.mjs solution truth [refSeconds]` (reprojection error of a pin placed by the editor's own `surfaceAnchor`, and surface-normal error, in ground-truth pixels).
4. **Real footage, no truth needed** — `score_photometric.py solution video refSeconds x01 y01` warps every solved frame through the pin's plane back into the reference frame and measures how far the wall texture is off (phase correlation). `refine-anchor.mjs` runs the editor's photometric refinement (`spatial-refine.js`) and writes both pins; feed either to `score_photometric.py` with `ANCHOR_JSON=file`.

5. **Masks** — `make_matte_from_truth.py truth matteDir` writes an editor matte atlas from the true silhouettes (a stand-in detector, to test compositing alone); `score_masks.py occlusion.json truth` scores SAM 2 masks (`studio/server/spatial/occlusion.py`, needs `setup-shorts-spatial.py --advanced`) by IoU and boundary distance.
