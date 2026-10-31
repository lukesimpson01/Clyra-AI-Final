// HTTP surface that ties the Clyra Editor (vendor/openfilm) to the rest of Clyra:
//
//  /api/openfilm/status, /launch        start the editor and hand the UI the address to frame
//  /api/openfilm/sources                everything Clyra can feed it: Shorts projects, AI Clipper clips, Music and SFX
//  /api/openfilm/send                   put those into the editor (a new project, or the one that is open)
//  /api/openfilm/exports                what the editor rendered, so Shorts can use it
//  /api/openfilm/bridge/*               what the editor calls back into: Whisper STT, Creator voices, Clyra's model
//
// The bridge routes are authenticated with a per-launch bearer (editorBridgeToken) that only the editor process
// receives, so they work without Clyra's UI cookie and cannot be reached by anything else on the machine.

import express from "express";
import crypto from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chatComplete } from "../ai/provider-router";
import { clipperOutputDir } from "../runtime-paths";
import { SHORTS_VOICES } from "../shorts/voices";
import { fetchSpeech } from "../shorts/tts-client";
import { probeLocalMedia, resolvePython, resolveTool, runProcess } from "../shorts/media";
import { resolveLibraryFile, scanLibrary } from "../shorts/library";
import { ensureProjectDirs, listProjects, projectDir, readProjectFile } from "../shorts/store";
import { editorAddress, editorApi, editorBridgeToken, editorPaths, editorStatus, ensureEditor } from "./manager";

type SendItem = {
  kind: "shorts-export" | "shorts-source" | "clipper" | "library-music" | "library-sfx";
  projectId?: string;
  file: string;
  /** Attach the project's word-timed captions as the clip's editable subtitles. */
  subtitles?: boolean;
};

function bearerOk(req: express.Request) {
  const header = String(req.headers.authorization || "");
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  return given.length === editorBridgeToken.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(editorBridgeToken));
}

/** True for a bridge request that carries the editor's own token (server.ts lets these past the UI-cookie guard). */
export function isEditorBridgeRequest(req: express.Request) {
  return req.path.startsWith("/api/openfilm/bridge") && bearerOk(req);
}

function vttStamp(ms: number) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000), m = Math.floor(t / 60_000) % 60, s = Math.floor(t / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}`;
}

/** Word-timed captions as WebVTT with a timestamp tag in front of every word after a cue's first. */
function wordsToVtt(words: Array<{ text: string; startMs: number; endMs: number }>) {
  const cues: string[] = [];
  let group: typeof words = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].startMs;
    const end = Math.max(group[group.length - 1].endMs, start + 200);
    const text = group.map((word, i) => (i === 0 ? word.text : `<${vttStamp(word.startMs)}>${word.text}`)).join(" ");
    cues.push(`${vttStamp(start)} --> ${vttStamp(end)}\n${text}`);
    group = [];
  };
  for (const word of words) {
    if (group.length && (group.length >= 7 || word.endMs - group[0].startMs > 2800 || word.startMs - group[group.length - 1].endMs > 700)) flush();
    group.push(word);
  }
  flush();
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

function listClipperClips(limit = 60) {
  const dir = clipperOutputDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^[\w.-]+\.mp4$/i.test(name))
    .map((name) => ({ name, stat: statSync(path.join(dir, name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map(({ name, stat }) => ({ file: name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }));
}

function listEditorExports(limit = 40) {
  const root = editorPaths().exports;
  if (!existsSync(root)) return [];
  const found: Array<{ file: string; bytes: number; modifiedAt: string; mtimeMs: number }> = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) walk(full, depth + 1);
      else if (entry.isFile() && /\.(mp4|mov|webm|gif|mp3|wav|vtt|srt)$/i.test(entry.name)) {
        const stat = statSync(full);
        found.push({ file: path.relative(root, full), bytes: stat.size, modifiedAt: stat.mtime.toISOString(), mtimeMs: stat.mtimeMs });
      }
    }
  };
  walk(root, 0);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit).map(({ mtimeMs: _drop, ...rest }) => rest);
}

type Resolved = { absolute: string; words?: Array<{ text: string; startMs: number; endMs: number }>; title: string };

function resolveItem(item: SendItem): Resolved {
  const file = path.basename(String(item.file || ""));
  if (!file) throw new Error("An item has no file.");
  if (item.kind === "clipper") {
    const absolute = path.join(clipperOutputDir(), file);
    if (!existsSync(absolute)) throw new Error(`The clip ${file} is no longer in the clip folder.`);
    return { absolute, title: file };
  }
  if (item.kind === "library-music" || item.kind === "library-sfx") {
    const absolute = resolveLibraryFile(item.kind === "library-music" ? "music" : "sfx", file);
    if (!absolute) throw new Error(`${file} is no longer in your library.`);
    return { absolute, title: file };
  }
  const id = String(item.projectId || "");
  const project = id ? readProjectFile(id) : null;
  if (!project) throw new Error("That Shorts project no longer exists.");
  if (item.kind === "shorts-export") {
    const absolute = path.join(ensureProjectDirs(id), "exports", file);
    if (!existsSync(absolute)) throw new Error("That export no longer exists.");
    return { absolute, title: project.title };
  }
  const relative = String(project.source?.file || "");
  const absolute = relative ? path.join(projectDir(id), relative) : "";
  if (!absolute || !existsSync(absolute)) throw new Error("That project has no source video.");
  return { absolute, title: project.title, words: item.subtitles && project.captions.words.length ? project.captions.words : undefined };
}

export function registerOpenFilmRoutes(app: express.Express, clyraPort: number) {
  const guard = (handler: (req: express.Request, res: express.Response) => Promise<void>) => async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "The editor request failed." });
    }
  };

  app.get("/api/openfilm/status", guard(async (_req, res) => {
    res.json({ ok: true, ...(await editorStatus()) });
  }));

  // Where to frame the editor. `to` is a path inside it (a project). The address carries the editor's launch key, so
  // it is only ever given to Clyra's own UI.
  app.post("/api/openfilm/launch", guard(async (req, res) => {
    const run = await ensureEditor(clyraPort);
    const to = typeof req.body?.to === "string" && /^\/(?!\/)[^\s\\]*$/.test(req.body.to) ? req.body.to : "/";
    res.json({ ok: true, url: editorAddress(run, to), origin: run.origin });
  }));

  app.get("/api/openfilm/sources", guard(async (_req, res) => {
    const projects = listProjects()
      .map((summary) => readProjectFile(summary.id))
      .filter((project): project is NonNullable<typeof project> => Boolean(project))
      .slice(0, 80)
      .map((project) => ({
        id: project.id,
        title: project.title,
        kind: project.kind,
        aspect: project.aspect,
        updatedAt: project.updatedAt,
        hasSource: Boolean(project.source?.file),
        hasCaptions: project.captions.words.length > 0,
        thumbnail: project.source?.thumbnail ? `/api/shorts/projects/${project.id}/${project.source.thumbnail}` : null,
        exports: project.exports.map((record) => ({ file: record.file, durationMs: record.durationMs, aspect: record.aspect, createdAt: record.createdAt })),
      }));
    const [music, sfx] = await Promise.all([scanLibrary("music"), scanLibrary("sfx")]);
    res.json({
      ok: true,
      projects,
      clips: listClipperClips(),
      music: music.map((track) => ({ file: track.file, title: track.title, durationMs: track.durationMs })),
      sfx: sfx.map((track) => ({ file: track.file, title: track.title, durationMs: track.durationMs })),
      exports: listEditorExports(),
    });
  }));

  // Put Clyra media into the editor: copied into the project's assets (a copy, so editing never changes the Shorts
  // original), laid on the timeline, and the editor told to show it.
  app.post("/api/openfilm/send", guard(async (req, res) => {
    const items: SendItem[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 24) : [];
    if (!items.length) { res.status(400).json({ ok: false, error: "Choose something to send." }); return; }
    const resolved = items.map((item) => ({ item, ...resolveItem(item) }));

    let projectId = typeof req.body?.projectId === "string" && req.body.projectId ? req.body.projectId : "";
    let projectPath = "";
    let created = false;
    if (!projectId) {
      const name = String(req.body?.name || resolved[0].title || "Untitled").slice(0, 80);
      const made = await editorApi<{ project: { id: string; path: string } }>(clyraPort, "projects", { json: { name } });
      projectId = made.project.id;
      projectPath = made.project.path;
      created = true;
    } else {
      projectPath = (await editorApi<{ project: { path: string } }>(clyraPort, `projects/${encodeURIComponent(projectId)}`)).project.path;
    }
    const base = `projects/${encodeURIComponent(projectId)}`;

    const landed = await editorApi<{ landed: string[] }>(clyraPort, `${base}/files/bring`, {
      json: { into: "assets/clyra", mode: "copy", paths: resolved.map((entry) => entry.absolute) },
    });

    // The first video of a new project sets the shape of the canvas, and a word-timed transcript is written beside
    // the clip it belongs to so the editor's subtitles are made from it. Each item is its own edit so a video can
    // follow the one before it on the same track.
    type Doc = { doc: { tracks: Array<{ clips: Array<{ id: string; src: string }> }> } };
    const clipIdFor = (doc: Doc["doc"], rel: string) => {
      let found: string | null = null;
      for (const track of doc.tracks) for (const clip of track.clips) if (clip.src.split("#")[0] === rel) found = clip.id;
      return found;
    };
    let stageSet = !created;
    let lastVideo: string | null = null;
    if (!created) {
      const film = await editorApi<Partial<Doc>>(clyraPort, base);
      for (const track of film.doc?.tracks ?? []) for (const clip of track.clips) if (/\.(mp4|mov|webm|m4v)(#|$)/i.test(clip.src)) lastVideo = clip.id;
    }
    for (let i = 0; i < resolved.length; i++) {
      const entry = resolved[i];
      const rel = landed.landed[i];
      if (!rel) continue;
      const isAudio = entry.item.kind === "library-music" || entry.item.kind === "library-sfx";
      if (entry.words?.length) await writeFile(path.join(projectPath, rel.replace(/\.[^./]+$/, ".vtt")), wordsToVtt(entry.words), "utf8");
      const ops: unknown[] = [];
      if (!isAudio && !stageSet) {
        const probed = await probeLocalMedia(entry.absolute).catch(() => null);
        if (probed?.width && probed.height) ops.push({ op: "stage", w: probed.width, h: probed.height });
        stageSet = true;
      }
      if (isAudio) ops.push({ op: "insert", clip: { src: rel }, newTrack: 0 });
      else if (lastVideo) ops.push({ op: "insert", clip: { src: rel }, after: lastVideo });
      else ops.push({ op: "insert", clip: { src: rel } });
      const applied = await editorApi<Doc>(clyraPort, `${base}/edit`, { json: { base: null, ops } });
      if (!isAudio) lastVideo = clipIdFor(applied.doc, rel) ?? lastVideo;
    }

    await editorApi(clyraPort, "open", { json: { path: projectPath, now: false, fallback: 0 } });
    res.json({ ok: true, projectId, created, count: landed.landed.length });
  }));

  app.get("/api/openfilm/exports", guard(async (_req, res) => {
    res.json({ ok: true, exports: listEditorExports() });
  }));

  app.get("/api/openfilm/exports/file", guard(async (req, res) => {
    const root = path.resolve(editorPaths().exports);
    const target = path.resolve(root, String(req.query.file || ""));
    if (!target.startsWith(root + path.sep) || !existsSync(target) || !statSync(target).isFile()) { res.status(404).json({ ok: false, error: "Export not found." }); return; }
    if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename="${path.basename(target)}"`);
    createReadStream(target).pipe(res);
  }));

  // ── Bridge: called by the editor process ────────────────────────────────────────────────────────────────────────
  const bridge = (handler: (req: express.Request, res: express.Response) => Promise<void>) => guard(async (req, res) => {
    if (!bearerOk(req)) { res.status(401).json({ ok: false, error: "Not the editor." }); return; }
    await handler(req, res);
  });

  app.get("/api/openfilm/bridge/voices", bridge(async (_req, res) => {
    res.json({ ok: true, voices: [...SHORTS_VOICES] });
  }));

  app.post("/api/openfilm/bridge/tts", bridge(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const voice = typeof req.body?.voice === "string" ? req.body.voice : "Max";
    if (!text || text.length > 600) { res.status(400).json({ ok: false, error: "Text must contain 1 to 600 characters." }); return; }
    const speech = await fetchSpeech(`http://127.0.0.1:${clyraPort}`, text, voice);
    res.setHeader("Content-Type", speech.extension === "mp3" ? "audio/mpeg" : "audio/wav");
    res.setHeader("X-Clyra-TTS-Duration", String(speech.durationMs));
    res.send(speech.bytes);
  }));

  app.post("/api/openfilm/bridge/asr", express.raw({ type: () => true, limit: "400mb" }), bridge(async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) { res.status(400).json({ ok: false, error: "No audio was sent." }); return; }
    const model = ["tiny", "base", "small"].includes(String(req.query.model)) ? String(req.query.model) : "base";
    const dir = await mkdtemp(path.join(tmpdir(), "clyra-editor-asr-"));
    try {
      const input = path.join(dir, "speech.bin");
      const wav = path.join(dir, "speech.wav");
      const out = path.join(dir, "words.json");
      await writeFile(input, body);
      const converted = await runProcess(resolveTool("ffmpeg"), ["-y", "-v", "error", "-i", input, "-vn", "-ac", "1", "-ar", "16000", wav], { timeoutMs: 10 * 60_000 });
      if (converted.code !== 0) throw new Error(`The audio could not be read: ${converted.stderr.trim().split("\n").at(-1) || "unknown error"}`);
      const helper = path.join(process.cwd(), "lib", "shorts", "transcribe_words.py");
      if (!existsSync(helper)) throw new Error("The transcription helper is missing from this build.");
      const result = await runProcess(resolvePython(), [helper, wav, out, model], { timeoutMs: 45 * 60_000 });
      if (result.code !== 0) {
        const detail = result.stderr.trim().split("\n").filter(Boolean).at(-1) || `exit ${result.code}`;
        throw new Error(`Transcription failed: ${detail.slice(0, 300)}. Check that the Python "whisper" package is installed.`);
      }
      const parsed = JSON.parse(await readFile(out, "utf8")) as { language?: string; words?: Array<{ text: string; startMs: number; endMs: number }> };
      const words = (parsed.words ?? []).map((word) => ({ text: word.text, start: word.startMs / 1000, end: word.endMs / 1000 }));
      const probed = await probeLocalMedia(wav).catch(() => null);
      res.json({ ok: true, language: parsed.language, text: words.map((word) => word.text).join(" "), words, duration: probed ? probed.durationMs / 1000 : undefined });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

  app.post("/api/openfilm/bridge/translate", bridge(async (req, res) => {
    const system = String(req.body?.system || "");
    const user = String(req.body?.user || "");
    if (!system || !user) { res.status(400).json({ ok: false, error: "Nothing to translate." }); return; }
    const completion = await chatComplete({
      capability: "fast-text",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.2,
      maxTokens: 4_000,
      responseFormat: "json_object",
    });
    res.json({ ok: true, text: completion.text });
  }));

}
