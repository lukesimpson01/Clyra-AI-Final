# Advanced editor (Shorts Editor)

`/editor/advanced` now opens a timeline editor built on the MIT-licensed OpenFilm Studio (cloned to `../openfilm`),
restyled light with FRAME's blue accent and carrying FRAME's tools. The previous canvas editor is still at
`/editor/classic`.

## Run it
FRAME's dev server starts it for you: open `/editor/advanced` (the first start takes up to ~30 s). It runs
`../openfilm/packages/openfilm/bin/openfilm.mjs open frame-projects/<name>` and redirects the browser there. A project
opens **blank** with a welcome screen (Text story, Reddit story, Would you rather, Subtitles, Text & shapes, Music).
Set `FRAME_OPENFILM_BIN` to use another checkout. Studio needs its UI built once: `pnpm install` in `../openfilm`.

## Layout
A full-height tool rail on the left (as in the Shorts home tools): **‹ back to Shorts home** at the top, then Media,
Subtitles, Elements, Animate, Music, Sound FX and Stories. The Subtitles panel is open when a project opens. Export is
top right. A chosen control shows a blue icon or label with nothing behind it; grey appears only on hover.

## Tools
| Tool | What it does |
| --- | --- |
| Subtitles | As in Crayo: choose **AI subtitles** (needs a transcription service; none is connected) or **Manual subtitles**. Manual: Edit lists the cues with their times; type straight into a cue and it shows on the video instantly; Add subtitle adds one at the playhead. Style: Word / Lines, a grid of preset tiles, and the gear for text, position (Top / Middle / Bottom), colors and motion. |
| Elements | Heading, text, caption, 8 shapes, your own media. |
| Animate | Animation presets as editable keyframes on the selected element. |
| Music / Sound FX | Search, play, Add. Sound FX has Normal and Brainrot. |
| Stories | The home page's own Fake text, Reddit and Would-you-rather tools run in the sidebar (Shorts' `/embed/<tool>`, the same components with their preview left out and the step bar on top). Every change in the tool goes straight to the story on the video; selecting a story clip opens its tool as it was left. |

The Stage menu puts **Popular** first: 9:16 (TikTok, Reels, Shorts) and 16:9 (full screen), then the other shapes.

## Properties (right inspector, shown when an element is selected)
Keyframes section: previous / next key, **Keyframe all**, and a track per animated property where each ◆ can be
clicked (go there) or dragged (retime). Rows: stopwatch (animate), value (drag the number to scrub), ◆ add / remove a
key at the playhead, easing for that key. Drag the blue handle on the picture to place the element (a key when its
position is animated). Stories show their own editors (messages, posts, questions).

Edits reach the preview at once: the editor posts the changed layer to the preview's pages (runtime.js listens), and
the file is written as well.

## How layers work
Every FRAME layer is one page clip, `frame/<id>.html`, holding its JSON and the shared runtime
(`frame/runtime.js` + `engine.js`, the same animation engine as the classic editor). Stories and would-you-rather are a
single page holding several timed layers, so a long story is one iframe, not dozens. Studio writes these files through
`PUT /api/projects/:id/files?path=frame/…&overwrite=1` (restricted to `frame/`, see `studio/server/files.mjs`).

## Export
Studio's export renders the film headlessly and encodes with ffmpeg; FRAME layers are exact because every frame is a
pure function of time. A 5 s vertical test with a text story and gameplay rendered at 1080×1920.

## Timeline lines, keyframes and transitions
- Lines work like iMovie (`frame/lines.ts`): videos, photos and stories share the Video line; sounds go on Audio lines;
  titles and shapes, subtitles and transitions each get their own line. A line nobody has named shows what it holds.
  Clips show their layer's name.
- Keyframes: **D** keys every property at the playhead, and **E** toggles easy ease (slow in, slow out). Each animated
  clip shows its keys as diamonds along its bottom edge; clicking a diamond seeks to it.
- Transitions (`frame/transitions*.{ts,js}`, 38 CapCut Classic effects in one WebGL2 renderer): select a video or photo,
  pick At start or At end, then click a tile. Where the clip touches another, the transition sits centred on the cut.
  At a free edge it fades in from black or out to black. A chip on the Video line marks each one. Tiles play over real
  gameplay while hovered. `frame/tests/transitions.browser.html` checks the endpoints, determinism and parameter sweeps.
- Stories draw their gameplay inside their own page (`background` on the layer), so a story is one clip on the Video
  line.
- The Shorts home **Projects** page lists every tool's projects. A finished render becomes a project carrying a frame of
  the video; advanced-editor projects use the editor's own poster (`/api/advanced/poster`).

## Tests
`pnpm test` in `../openfilm/packages/openfilm` includes `studio/ui/src/frame/tests/*` (animation engine, presets,
sound FX / music catalogue, sound edit, story builders) and `studio/server/frame-file.test.mjs`.

## Known limits
- Automatic transcription needs a speech service and is not connected; subtitles are typed.
- OpenFilm's AI chat lives in its Electron desktop app (`apps/desktop`) and drives a local agent (Claude Code, Codex).
  Neither agent works on this machine at the moment, so the web editor has no chat panel. Motion graphics in OpenFilm
  are agent skills (`skills/motion-graphics`) plus Studio's own page editing, which is kept.
- A project with many separate FRAME layers (each its own page) renders slower than one with grouped stories.
- Commercial songs are not bundled; their slots play FRAME takes.
- The home Reddit tool's Generate is still a mock: no MP4 is rendered there (export a Reddit story from the advanced
  editor instead). Fake text and Would you rather render real MP4s.
- The per-clip waveform sound editor of the classic editor is replaced by Studio's clip trim, speed, volume and fades.
