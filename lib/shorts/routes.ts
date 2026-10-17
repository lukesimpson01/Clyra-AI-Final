// HTTP surface for Shorts. Every handler validates its input and returns
// JSON with `ok` plus either data or a human-readable `error`. Media is served
// only from inside a project folder (see store.resolveAssetFile).

import type express from "express";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { inspectYoutube, probeLocalMedia } from "./media";
import { attachSubscriber, cancel, getJob, jobSnapshot } from "./jobs";
import { ScriptGenerationError, clampTone, generateScript, type GenerateInput } from "./ai";
import { attachUpload, importClipResult, startCut, startTranscribe, type ClipImportPayload } from "./operations";
import { exportFileFor, getRenderSpec, startRender } from "./render";
import { startFakeTextTimelineBuild } from "./faketext-build";
import { readCachedMessageSpeech } from "./faketext-tts";
import { gameplayClipAbsolutePath, resolveGameplayClip, scanGameplayLibrary } from "./faketext-gameplay";
import { cleanStaleTemp, deleteProjectDir, ensureProjectDirs, listProjects, newProjectId, presetsFile, readProjectFile, resolveAssetFile, writeProjectFile } from "./store";
import { ensureLibraryDir, libraryDir, resolveLibraryFile, scanLibrary, type LibraryKind } from "./library";
import { shortsDiskUsage } from "./usage";
import {
  SHORTS_FPS_OPTIONS,
  SHORTS_KINDS,
  SHORTS_RESOLUTIONS,
  defaultCaptionStyle,
  emptyProject,
  migrateProject,
  normaliseCaptionStyle,
  safeId,
  type CaptionPreset,
  type ShortsFps,
  type ShortsKind,
  type ShortsProject,
  type ShortsResolution,
} from "./schema";
import { buildFakeTextItems, buildListItems, buildNarratedItems, buildQuizItems, buildStoryItem, buildWouldRatherItems, paceMultiplier, type Pace } from "./templates";

let nextItemCounter = 0;
const nextItemId = () => `i${Date.now().toString(36)}${(nextItemCounter++).toString(36)}`;

function ok(res: express.Response, body: Record<string, unknown> = {}) {
  res.json({ ok: true, ...body });
}

function fail(res: express.Response, status: number, error: string) {
  res.status(status).json({ ok: false, error });
}

function asString(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function pickResolution(value: unknown): ShortsResolution {
  return SHORTS_RESOLUTIONS.includes(Number(value) as ShortsResolution) ? (Number(value) as ShortsResolution) : 1080;
}

function pickFps(value: unknown): ShortsFps {
  return SHORTS_FPS_OPTIONS.includes(Number(value) as ShortsFps) ? (Number(value) as ShortsFps) : 30;
}

function pickQuality(value: unknown): "fast" | "balanced" | "high" {
  return value === "fast" || value === "high" ? value : "balanced";
}

function pickPace(value: unknown): Pace {
  return value === "slow" || value === "fast" || value === "custom" ? value : "natural";
}

/** Builds timeline items for a generated script. Pure data in, typed timeline out. */
function itemsForScript(script: Awaited<ReturnType<typeof generateScript>>, pace: Pace, countdownSeconds: number, customPace: number) {
  const multiplier = paceMultiplier(pace, customPace);
  switch (script.kind) {
    case "fake-text":
      return {
        items: buildFakeTextItems(script.messages.map((message) => ({ sender: message.sender, side: message.side, text: message.text, reaction: message.reaction })), pace, nextItemId, customPace),
        title: script.title,
      };
    case "would-rather":
      return { items: buildWouldRatherItems(script.rounds, countdownSeconds, nextItemId), title: script.title };
    case "reddit-story":
      return { items: [buildStoryItem(script.title, script.body, script.author, nextItemId, multiplier)], title: script.title };
    case "gameplay-story":
      return { items: [buildStoryItem(script.title, script.body, script.author, nextItemId, multiplier)], title: script.title };
    case "narrated-story":
      return { items: buildNarratedItems(script.scenes, nextItemId, multiplier), title: script.title };
    case "quiz":
      return { items: buildQuizItems(script.questions, countdownSeconds, nextItemId), title: script.title };
    case "list":
      return { items: buildListItems(script.title, script.items, nextItemId), title: script.title };
  }
}

export function registerShortsRoutes(app: express.Express) {
  const removed = cleanStaleTemp();
  if (removed) console.log(`[shorts] removed ${removed} stale temp item(s)`);
  ensureLibraryDir("music");
  ensureLibraryDir("sfx");

  // ---- Music / SFX library -----------------------------------------------
  // Real folders on disk (see lib/shorts/library.ts). A file dropped in shows
  // up on the next list call — there is no import step and no database row.

  app.get("/api/shorts/library/:kind", async (req, res) => {
    const kind = req.params.kind === "sfx" ? "sfx" : req.params.kind === "music" ? "music" : null;
    if (!kind) return fail(res, 400, "Unknown library");
    try {
      ok(res, { tracks: await scanLibrary(kind as LibraryKind), folder: libraryDir(kind as LibraryKind) });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : "The library could not be read.");
    }
  });

  app.get("/api/shorts/library/:kind/:file", (req, res) => {
    const kind = req.params.kind === "sfx" ? "sfx" : req.params.kind === "music" ? "music" : null;
    if (!kind) return fail(res, 400, "Unknown library");
    const file = resolveLibraryFile(kind as LibraryKind, decodeURIComponent(String(req.params.file)));
    if (!file) return fail(res, 404, "That audio file is no longer in the library folder.");
    res.setHeader("Cache-Control", "private, max-age=120");
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) fail(res, 404, "Audio file not found");
    });
  });

  app.get("/api/shorts/usage", async (_req, res) => {
    try {
      ok(res, { usage: await shortsDiskUsage() });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : "Could not measure Shorts storage usage.");
    }
  });

  // ---- Projects ---------------------------------------------------------

  app.get("/api/shorts/projects", (_req, res) => {
    ok(res, { projects: listProjects() });
  });

  app.post("/api/shorts/projects", (req, res) => {
    const kind = (SHORTS_KINDS as readonly string[]).includes(String(req.body?.kind)) ? (req.body.kind as ShortsKind) : null;
    if (!kind) return fail(res, 400, "Choose a Shorts tool before creating a project.");
    const id = newProjectId();
    const now = new Date().toISOString();
    const title = asString(req.body?.title, 160) || defaultTitle(kind);
    const base = emptyProject({ id, kind, title, now, aspect: pickAspect(req.body?.aspect) });
    const generated = req.body?.generated as { items?: unknown; captionWords?: unknown } | undefined;
    const project = migrateProject({
      ...base,
      items: Array.isArray(generated?.items) ? generated.items : [],
      captions: {
        enabled: Boolean(req.body?.captionsEnabled),
        style: normaliseCaptionStyle(req.body?.captionStyle ?? defaultCaptionStyle()),
        words: Array.isArray(generated?.captionWords) ? generated.captionWords : [],
      },
      narration: { enabled: Boolean(req.body?.narration?.enabled), voice: asString(req.body?.narration?.voice, 40) },
      // New projects can only start with a colour or gradient. Video backgrounds
      // are attached through attach-upload, which copies the file into the project.
      background: isPlainBackground(req.body?.background) ? req.body.background : base.background,
      settings: { resolution: pickResolution(req.body?.resolution), fps: pickFps(req.body?.fps) },
      template: base.template,
    });
    writeProjectFile(project);
    ok(res, { project });
  });

  app.get("/api/shorts/projects/:id", (req, res) => {
    const project = readSafe(req.params.id);
    if (!project) return fail(res, 404, "This project no longer exists.");
    ok(res, { project });
  });

  app.put("/api/shorts/projects/:id", (req, res) => {
    const id = safeId(req.params.id);
    const stored = readSafe(id);
    if (!stored) return fail(res, 404, "This project no longer exists.");
    if (!req.body || typeof req.body !== "object") return fail(res, 400, "Project body is required.");
    try {
      // Server-owned fields never come from the client: exports, clip metadata and
      // the source/asset binding are only changed by the operations that create them.
      const project = migrateProject({
        ...req.body,
        id,
        kind: stored.kind,
        createdAt: stored.createdAt,
        updatedAt: new Date().toISOString(),
        source: stored.source,
        clip: stored.clip,
        exports: stored.exports,
        background: keepVideoBackground(req.body.background, stored),
      });
      writeProjectFile(project);
      ok(res, { project, savedAt: project.updatedAt });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "The project could not be saved.");
    }
  });

  app.delete("/api/shorts/projects/:id", (req, res) => {
    const id = safeId(req.params.id);
    if (!id) return fail(res, 400, "Invalid project");
    ok(res, { deleted: deleteProjectDir(id) });
  });

  app.get("/api/shorts/projects/:id/assets/:file", (req, res) => {
    const file = resolveAssetFile(safeId(req.params.id), `assets/${path.basename(String(req.params.file))}`);
    if (!file) return fail(res, 404, "Asset not found");
    res.setHeader("Cache-Control", "private, max-age=600");
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) fail(res, 404, "Asset not found");
    });
  });

  app.get("/api/shorts/projects/:id/exports/:file", (req, res) => {
    const file = exportFileFor(safeId(req.params.id), String(req.params.file));
    if (!file) return fail(res, 404, "Export not found");
    const size = statSync(file).size;
    const download = req.query.download === "1";
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", String(size));
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${path.basename(file)}"`);
    createReadStream(file).pipe(res);
  });

  // Small inline-image uploads (contact avatar, message stickers). JSON body keeps this consistent with the rest of the API instead of adding a multipart path for a handful of KB.
  app.post("/api/shorts/projects/:id/faketext/image", (req, res) => {
    const id = safeId(req.params.id);
    const project = readSafe(id);
    if (!project) return fail(res, 404, "This project no longer exists.");
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    const match = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return fail(res, 400, "Choose a PNG, JPEG, WEBP or GIF image.");
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 6 * 1024 * 1024) return fail(res, 400, "Image is too large (max 6MB).");
    const dir = ensureProjectDirs(id);
    const name = `img-${Date.now().toString(36)}.${extension}`;
    writeFileSync(path.join(dir, "assets", name), buffer);
    ok(res, { assetPath: `assets/${name}` });
  });

  app.get("/api/shorts/faketext/gameplay-library", (_req, res) => {
    ok(res, { clips: scanGameplayLibrary() });
  });

  app.post("/api/shorts/projects/:id/faketext/gameplay-library", async (req, res) => {
    const id = safeId(req.params.id);
    const project = readSafe(id);
    if (!project) return fail(res, 404, "This project no longer exists.");
    const clip = resolveGameplayClip(asString(req.body?.clipId, 60));
    if (!clip) return fail(res, 404, "That gameplay clip is no longer available.");
    try {
      const dir = ensureProjectDirs(id);
      const assetName = `gameplay-${clip.id}.mp4`;
      copyFileSync(gameplayClipAbsolutePath(clip), path.join(dir, "assets", assetName));
      const probe = await probeLocalMedia(path.join(dir, "assets", assetName));
      const next = {
        ...project,
        updatedAt: new Date().toISOString(),
        background: { type: "video" as const, file: `assets/${assetName}`, trimStartMs: 0, speed: 1, dim: 0.2, zoom: 1, offsetX: 0, offsetY: 0, blurPx: 0, muted: true },
      };
      writeProjectFile(migrateProject(next));
      const saved = readProjectFile(id);
      ok(res, { project: saved, probe });
    } catch (error) {
      fail(res, 500, error instanceof Error ? error.message : "That clip could not be attached.");
    }
  });

  app.post("/api/shorts/projects/:id/attach-upload", async (req, res) => {
    try {
      const project = await attachUpload(safeId(req.params.id), asString(req.body?.uploadId, 80), asString(req.body?.title, 200), Boolean(req.body?.muted));
      ok(res, { project });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "The upload could not be attached.");
    }
  });

  // ---- Source metadata --------------------------------------------------

  app.post("/api/shorts/source/inspect", async (req, res) => {
    try {
      const info = await inspectYoutube(asString(req.body?.url, 600));
      ok(res, { source: info });
    } catch (error) {
      fail(res, 422, error instanceof Error ? error.message : "The link could not be inspected.");
    }
  });

  app.post("/api/shorts/source/probe", async (req, res) => {
    const uploadId = asString(req.body?.uploadId, 80);
    if (!/^[a-f0-9-]+\.(?:mp4|mov|m4v|webm|mkv)$/i.test(uploadId)) return fail(res, 400, "Invalid upload identifier");
    const file = clyraDataPath(".clyra", "clipper-uploads", uploadId);
    if (!existsSync(file)) return fail(res, 404, "The uploaded video is no longer available.");
    try {
      const probe = await probeLocalMedia(file);
      ok(res, { probe: { ...probe, uploadId, name: asString(req.body?.name, 200) || uploadId } });
    } catch (error) {
      fail(res, 422, error instanceof Error ? error.message : "The file could not be read.");
    }
  });

  // ---- AI ---------------------------------------------------------------

  app.post("/api/shorts/ai/generate", async (req, res) => {
    const kind = asString(req.body?.kind, 40);
    if (!["fake-text", "would-rather", "reddit-story", "narrated-story", "quiz", "list", "gameplay-story"].includes(kind)) {
      return fail(res, 400, "Choose a generator first.");
    }
    const prompt = asString(req.body?.prompt, 1_500);
    if (!prompt) return fail(res, 400, "Describe what the video should be about.");
    const input: GenerateInput = {
      kind: kind as GenerateInput["kind"],
      prompt,
      tone: clampTone(req.body?.tone),
      count: Math.min(12, Math.max(2, Number(req.body?.count) || 5)),
      mode: asString(req.body?.mode, 40) || undefined,
      participants: Array.isArray(req.body?.participants) ? req.body.participants.map((name: unknown) => asString(name, 40)).filter(Boolean).slice(0, 4) : undefined,
      relationship: asString(req.body?.relationship, 80) || undefined,
      ending: asString(req.body?.ending, 120) || undefined,
    };
    try {
      const script = await generateScript(input);
      const pace = pickPace(req.body?.pace);
      const countdown = Math.min(15, Math.max(3, Number(req.body?.countdownSeconds) || 5));
      const built = itemsForScript(script, pace, countdown, Number(req.body?.customPace) || 1);
      ok(res, { script, items: built.items, title: built.title });
    } catch (error) {
      if (error instanceof ScriptGenerationError) {
        return fail(res, error.code === "no_key" ? 503 : 502, error.message);
      }
      fail(res, 500, error instanceof Error ? error.message : "Script generation failed");
    }
  });

  // ---- Jobs -------------------------------------------------------------

  app.post("/api/shorts/projects/:id/render", (req, res) => {
    const id = safeId(req.params.id);
    if (!readSafe(id)) return fail(res, 404, "This project no longer exists.");
    const origin = `${req.protocol}://${req.get("host") || "127.0.0.1:3000"}`;
    const job = startRender(id, {
      resolution: pickResolution(req.body?.resolution),
      fps: pickFps(req.body?.fps),
      quality: pickQuality(req.body?.quality),
      origin: origin.replace("localhost", "127.0.0.1"),
    });
    ok(res, { job: jobSnapshot(job) });
  });

  app.post("/api/shorts/projects/:id/cut", (req, res) => {
    try {
      const job = startCut(safeId(req.params.id), {
        inMs: Math.max(0, Number(req.body?.inMs) || 0),
        outMs: Math.max(0, Number(req.body?.outMs) || 0),
        crop: validCrop(req.body?.crop),
        copyStreams: Boolean(req.body?.copyStreams),
        resolution: pickResolution(req.body?.resolution),
        fps: pickFps(req.body?.fps),
        quality: pickQuality(req.body?.quality),
        aspect: pickAspect(req.body?.aspect),
      });
      ok(res, { job: jobSnapshot(job) });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "The cut could not start.");
    }
  });

  app.post("/api/shorts/projects/:id/faketext/build-timeline", (req, res) => {
    const id = safeId(req.params.id);
    if (!readSafe(id)) return fail(res, 404, "This project no longer exists.");
    const origin = `${req.protocol}://${req.get("host") || "127.0.0.1:3000"}`;
    try {
      const job = startFakeTextTimelineBuild(id, origin.replace("localhost", "127.0.0.1"));
      ok(res, { job: jobSnapshot(job) });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "The conversation timeline could not be built.");
    }
  });

  // Serves a message's already-synthesized voice for live preview playback. Looked up by (voice, text), not a stored path, so an edited message simply serves nothing until the next timeline build re-synthesizes it.
  app.get("/api/shorts/projects/:id/faketext/speech/:messageId", (req, res) => {
    const id = safeId(req.params.id);
    const project = readSafe(id);
    if (!project) return fail(res, 404, "This project no longer exists.");
    const item = project.items.find((candidate) => candidate.id === req.params.messageId);
    if (!item || item.type !== "message") return fail(res, 404, "Message not found.");
    const side = item.side === "right" ? "user" : "contact";
    const voice = item.voice || (side === "user" ? project.fakeText.voices.userVoice : project.fakeText.voices.contactVoice);
    const cached = readCachedMessageSpeech(id, voice, item.text);
    if (!cached || cached.placeholder) return fail(res, 404, "This line has no synthesized voice yet. Build the conversation timeline first.");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Accept-Ranges", "bytes");
    res.sendFile(cached.file, (error) => {
      if (error && !res.headersSent) fail(res, 404, "Voice audio not found");
    });
  });

  app.post("/api/shorts/projects/:id/transcribe", (req, res) => {
    const model = req.body?.model === "tiny" || req.body?.model === "small" ? req.body.model : "base";
    try {
      const job = startTranscribe(safeId(req.params.id), model);
      ok(res, { job: jobSnapshot(job) });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "Transcription could not start.");
    }
  });

  app.post("/api/shorts/clips/import", async (req, res) => {
    const payload = req.body as ClipImportPayload;
    if (!payload || typeof payload.output !== "string") return fail(res, 400, "A clip result is required.");
    try {
      const project = await importClipResult({
        ...payload,
        title: asString(payload.title, 160) || "AI clip",
        aspect: pickAspect(payload.aspect),
      });
      ok(res, { project });
    } catch (error) {
      fail(res, 400, error instanceof Error ? error.message : "The clip could not be imported.");
    }
  });

  app.get("/api/shorts/jobs/:id", (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) return fail(res, 404, "This job is no longer tracked. Reopen the project to see its output.");
    ok(res, { job: jobSnapshot(job) });
  });

  app.get("/api/shorts/jobs/:id/events", (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) return fail(res, 404, "Job not found");
    attachSubscriber(job, res);
  });

  app.post("/api/shorts/jobs/:id/cancel", (req, res) => {
    const job = getJob(String(req.params.id));
    if (!job) return fail(res, 404, "Job not found");
    cancel(job);
    ok(res, { job: jobSnapshot(job) });
  });

  // Served to the headless frame renderer only. Specs exist for the lifetime of a render job.
  app.get("/api/shorts/renders/:jobId/spec", (req, res) => {
    const spec = getRenderSpec(String(req.params.jobId));
    if (!spec) return fail(res, 404, "No active render for this id");
    ok(res, { spec });
  });

  // ---- Caption presets ---------------------------------------------------

  app.get("/api/shorts/presets", (_req, res) => {
    ok(res, { presets: readPresets() });
  });

  app.put("/api/shorts/presets", (req, res) => {
    const list = Array.isArray(req.body?.presets) ? req.body.presets : null;
    if (!list) return fail(res, 400, "A preset list is required.");
    const presets: CaptionPreset[] = list.slice(0, 60).map((raw: any) => ({
      id: safeId(raw?.id),
      name: asString(raw?.name, 60) || "Preset",
      style: normaliseCaptionStyle(raw?.style),
      builtin: Boolean(raw?.builtin),
      isDefault: Boolean(raw?.isDefault),
    }));
    writePresets(presets);
    ok(res, { presets });
  });
}

function readSafe(id: string) {
  const safe = safeId(id);
  try {
    return readProjectFile(safe);
  } catch (error) {
    console.warn(`[shorts] unreadable project ${safe}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * A video background may only reference an asset this project already owns.
 * Anything else reverts to the stored background, so a client cannot point the
 * renderer at an arbitrary file.
 */
function keepVideoBackground(value: unknown, stored: ShortsProject) {
  if (!value || typeof value !== "object" || (value as { type?: string }).type !== "video") return value;
  const requested = String((value as { file?: string }).file || "");
  const owned = [stored.source?.file, stored.background.type === "video" ? stored.background.file : null].filter(Boolean);
  return owned.includes(requested) ? value : stored.background;
}

function isPlainBackground(value: unknown) {
  return Boolean(value) && typeof value === "object" && ["solid", "gradient"].includes(String((value as { type?: string }).type));
}

function validCrop(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const crop = value as Record<string, unknown>;
  const x = Number(crop.x);
  const y = Number(crop.y);
  const w = Number(crop.w);
  const h = Number(crop.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

function pickAspect(value: unknown): ShortsProject["aspect"] {
  return value === "4:5" || value === "1:1" || value === "16:9" ? value : "9:16";
}

function defaultTitle(kind: ShortsKind) {
  const titles: Record<ShortsKind, string> = {
    "ai-clip": "AI clip",
    "fake-text": "Fake text story",
    "would-rather": "Would you rather",
    "reddit-story": "Story",
    "narrated-story": "Narrated story",
    quiz: "Quiz",
    list: "List",
    "gameplay-story": "Gameplay story",
    "caption-video": "Caption video",
    "cut-crop": "Cut and crop",
  };
  return titles[kind];
}

function readPresets(): CaptionPreset[] {
  const file = presetsFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { presets?: unknown };
    return Array.isArray(parsed.presets) ? parsed.presets.map((raw: any) => ({
      id: safeId(raw?.id),
      name: asString(raw?.name, 60) || "Preset",
      style: normaliseCaptionStyle(raw?.style),
      builtin: Boolean(raw?.builtin),
      isDefault: Boolean(raw?.isDefault),
    })) : [];
  } catch {
    return [];
  }
}

function writePresets(presets: CaptionPreset[]) {
  const file = presetsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${Date.now().toString(36)}.tmp`;
  writeFileSync(temp, JSON.stringify({ presets }, null, 2));
  // Atomic replace, same as project saves.
  renameSync(temp, file);
}
