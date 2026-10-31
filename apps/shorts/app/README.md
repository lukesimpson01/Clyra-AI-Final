# FRAME video studio

A local, rebranded reconstruction of Crayo's accessible application UI. The landing page and Developer API route are excluded. It does not interact with Crayo's account, billing, or generation backend.

## Run

```sh
npm install
npm run dev -- --port 4173
```

Open [the dashboard](http://127.0.0.1:4173/dashboard). The [advanced editor](http://127.0.0.1:4173/editor/advanced) (now the Studio-based timeline editor, see [ADVANCED_EDITOR.md](ADVANCED_EDITOR.md); the old canvas editor is at `/editor/classic`) is reached from “Polish and export.” `npm run build` verifies the production bundle. `node --test tests/` runs the 49 engine/preset/story/sound/music tests.

## What works locally

- Dashboard, search, profile, projects, assets, tracker, main tool catalog, and twelve free-tool entry screens. No Developer API page or “Earn $75+” button.
- Tool-specific frontend controls and live previews, including Reddit and fake-text story builders. AI generation buttons run 6–12-second mock progress; they do not create backend media.
- Fake-text has a dedicated editor adapted from the user's Clyra project: editable/reorderable message pills, sender switching, import, contact profile, gameplay controls, and audio choices. The Theme panel, iMessage scene, message timing/scroll algorithms, fixed 256 × 454 preview frame around a 240-pixel canvas, and overlaid transport placement follow Clyra's source. FRAME keeps its existing top-tab workflow. The scrubber reveals timed messages and seeks the selected local MP4. Because this mock app has no speech-render backend, message speech durations are estimated locally rather than measured from generated audio.
- AutoClip accepts a local file or a validated YouTube link. The YouTube chooser shows an SVG logo, thumbnail, and embedded player (availability depends on the video owner). Clip settings, Subtitles, and Source now use the same numbered top-step layout as fake-text. The right side is a black subtitle-only preview with live motion, full-text highlight, colours, size, and position, without a scrubber. The former “What is in it” section is removed. Mock generation shows a blue ring reaching 100% before simulated result cards appear.
- Reddit story gameplay picker has 36 distinct items across Subway Surfers, Soap Video, Minecraft, Mario Kart, and Slime Video using animated GIF previews. Fake-text additionally includes four local MP4 gameplay clips copied from the supplied Clyra project (Subway-style, Minecraft, Driving, and Trackmania) so playback and scrubbing can seek real frames.
- Simple editor with media, effects, subtitles, text, audio, video, and tools panels.
- Advanced editor (see [ANIMATION_UPGRADE.md](ANIMATION_UPGRADE.md) for the full animation / motion-graphics / Sound FX upgrade: shared keyframe engine, Basic/Advanced inspector, Graph Editor, motion paths, 45 animation presets, Stories tools, 30 original Sound FX + import slots, 14 original music tracks, a per-clip sound editor) with movable imported image/video, text, subtitle, and shape layers; a timeline; trim timing; split; undo/redo; subtitle style presets with one-word or four-word line timing and per-word animation; caption colors; text outline/shadow; In/Out/Loop animations; anchors; safe area; position/scale/rotation/opacity keyframes with easing; audio upload and preview; and gameplay selection.
- Advanced-editor video export **actually renders and downloads a WebM in the browser**. A 10-second gameplay composition produced a 1.7 MB file in the browser test. Uploaded audio is mixed in when supported by the browser.
- Responsive UI, hover treatments, entry/loading transitions, and reduced-motion support.

## Important limits

This is not a one-to-one, fully functional clone. Source AI services, cloud assets, speech processing, background removal, AutoClip post-upload analysis, and several advanced-editor AI tools are not connected. The advanced editor's current render canvas is vertical 9:16; other export ratios and MP4 output are not implemented. Gameplay thumbnails/GIFs are previews, not full gameplay footage. If using these assets outside local evaluation, check the original provider's rights and attribution terms.

The advanced editor is an extension beyond the source editor: Crayo's “Advanced editor” button opened the same blank editing workspace as its simple editor in the observed account. Its visible text controls included font, outline, shadow, opacity, anchors, and animation presets; a source keyframe timeline was not observed. FRAME's keyframes were added in response to the requested After Effects-like controls.

REA was used for static inspection of publicly delivered Crayo bundles. The focused editor/simple-edit analysis is retained as Evidence `ev_ea5fac8e68cab016878f533e8188ee15f064d2456b0c312de4949492fd3071bf`; AutoClip setup analysis is `ev_1a6f002bd5604edb6d0b249cdcdcc5f0f57ad1ab6f4b668794754dffa8e2583a`. Each selected a narrow set of bundles from a 98-file inventory and reported partial semantic coverage. Static findings do not prove runtime behavior; the browser observations above are separate.
