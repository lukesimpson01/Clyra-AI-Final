/* HTTP surface for the notes workspace. Registered by server.ts so the
   routes live beside the store they call rather than in the main file. */
import path from "node:path";
import os from "node:os";
import { promises as fsp } from "node:fs";
import type express from "express";
import * as store from "./store";
import * as ai from "./ai";
import { runWebSearchResearch } from "../research/research-handlers";
import { safeFetchUserUrl } from "../security/safe-fetch";
import * as recorder from "./recorder";
import { blocksToMarkdown, markdownToBlocks, spanText, parseSpans, type Block } from "./blocks";
import { registerNotesBrowseRoutes } from "./browse";
import type { Rating } from "./fsrs";

/* Drafts carry no ids; the store needs them before it can write parent
   links, so they are minted on the way in. */
function draftsToPageBlocks(drafts: Array<Record<string, unknown>>): Block[] {
  let sequence = 0;
  const walk = (list: Array<Record<string, unknown>>): Block[] => list.map((draft) => ({
    id: `d${Date.now().toString(36)}${(sequence += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    page_id: "",
    parent_id: null,
    type: draft.type as Block["type"],
    text: (draft.text || []) as Block["text"],
    props: (draft.props || {}) as Record<string, unknown>,
    sort: 0,
    children: walk((draft.children || []) as Array<Record<string, unknown>>),
  }));
  return walk(drafts);
}

const fail = (res: express.Response, error: unknown) => {
  const status = error instanceof ai.AiError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Request failed";
  res.status(status).json({ error: message });
};

const wrap = (handler: (req: express.Request, res: express.Response) => unknown) =>
  async (req: express.Request, res: express.Response) => {
    try {
      const result = await handler(req, res);
      if (res.headersSent) return;
      if (result && typeof result === "object" && "error" in (result as Record<string, unknown>)) {
        res.status(400).json(result);
        return;
      }
      if (result === null) { res.status(404).json({ error: "Not found" }); return; }
      res.json(result);
    } catch (error) {
      if (!res.headersSent) fail(res, error);
    }
  };

/* Turns page/block references into labelled AI context. Blocks are resolved
   individually so a generated card can point at the exact paragraph. */
function contextFor(refs: Array<Record<string, unknown>>): ai.ContextChunk[] {
  const chunks: ai.ContextChunk[] = [];
  for (const ref of refs) {
    if (ref.text) {
      chunks.push({
        pageId: String(ref.pageId ?? ""),
        blockId: (ref.blockId as string) ?? null,
        title: String(ref.title || "Selection"),
        text: String(ref.text),
      });
      continue;
    }
    const pageId = ref.pageId ? String(ref.pageId) : null;
    if (!pageId) continue;
    const page = store.getPage(pageId);
    if (!page) continue;
    const title = String(page.title || "Untitled");
    const blockIds = Array.isArray(ref.blockIds) ? (ref.blockIds as string[]) : null;
    if (blockIds?.length) {
      const found = new Map<string, Block>();
      const walk = (blocks: Block[]) => blocks.forEach((block) => { found.set(block.id, block); walk(block.children ?? []); });
      walk(page.blocks as Block[]);
      for (const blockId of blockIds) {
        const block = found.get(blockId);
        if (block) chunks.push({ pageId, blockId, title, text: spanText(block.text) });
      }
    } else {
      /* A whole page is sent block by block rather than as one blob, so the
         model can cite a real block id and "Show source" lands on the exact
         paragraph instead of the top of the page. */
      const blocks = page.blocks as Block[];
      const parts = blocks
        .map((block) => ({ blockId: block.id, text: blocksToMarkdown([block]) }))
        .filter((part) => part.text.trim());
      /* Adjacent blocks are merged when a page is long: past roughly forty
         chunks the prompt cost outweighs the extra precision, and the first
         block of each group still gives a real anchor to jump to. */
      const MAX_CHUNKS = 40;
      if (parts.length > 1) {
        const groupSize = Math.ceil(parts.length / MAX_CHUNKS);
        for (let index = 0; index < parts.length; index += groupSize) {
          const group = parts.slice(index, index + groupSize);
          chunks.push({ pageId, blockId: group[0]!.blockId, title, text: group.map((part) => part.text).join("\n\n") });
        }
      } else {
        chunks.push({ pageId, blockId: null, title, text: blocksToMarkdown(blocks) });
      }
    }
  }
  return chunks.filter((chunk) => chunk.text.trim());
}

const refsFrom = (body: Record<string, unknown>) =>
  Array.isArray(body.sources) ? (body.sources as Array<Record<string, unknown>>) : [];

/* A model will happily answer with the label it saw ("S1") in a field meant
   for a block id. Provenance is only useful if "Show source" lands somewhere
   real, so anything not present in the context it was given is dropped. */
function sanitiseProvenance<T extends { sourcePageId?: string; sourceBlockId?: string }>(
  items: T[], context: ai.ContextChunk[],
): T[] {
  const pages = new Set(context.map((chunk) => chunk.pageId));
  const blocks = new Set(context.map((chunk) => chunk.blockId).filter(Boolean) as string[]);
  const fallbackPage = context[0]?.pageId;
  return items.map((item) => ({
    ...item,
    sourcePageId: item.sourcePageId && pages.has(item.sourcePageId) ? item.sourcePageId : fallbackPage,
    sourceBlockId: item.sourceBlockId && blocks.has(item.sourceBlockId) ? item.sourceBlockId : undefined,
  }));
}


/* ---------------------------------------------------------------- preview

   A code block's Preview needs a real address, not a `srcdoc:` frame: the
   panel carries the same URL bar as the Vibe Coder preview, and that bar has
   to name something the Open-externally button can actually open. Snippets are
   held in memory only — they are a transient view of a block the database
   already owns, so nothing here is persisted or survives a restart. */

type PreviewEntry = { html: string; created: number };
const previews = new Map<string, PreviewEntry>();
const PREVIEW_TTL_MS = 60 * 60 * 1000;
const PREVIEW_MAX = 60;

function prunePreviews() {
  const cutoff = Date.now() - PREVIEW_TTL_MS;
  for (const [id, entry] of previews) if (entry.created < cutoff) previews.delete(id);
  // Oldest-first eviction keeps a long editing session from growing forever.
  while (previews.size > PREVIEW_MAX) {
    const oldest = [...previews.entries()].sort((a, b) => a[1].created - b[1].created)[0];
    if (!oldest) break;
    previews.delete(oldest[0]);
  }
}

/** Wraps a bare fragment so a CSS-only or SVG-only block still renders, and
 *  guarantees a doctype: without one the page is in quirks mode, where a
 *  `height: 100vh` body does not re-measure when the panel goes full screen. */
function previewDocument(language: string, code: string): string {
  const key = language.toLowerCase();
  if (key === "css") {
    return `<!doctype html>\n<meta charset="utf-8"><style>${code}</style>` +
      `<body><main><h1>Heading</h1><p>Paragraph text for the styles above.</p><button>Button</button></main>`;
  }
  if (key === "svg") {
    return `<!doctype html>\n<meta charset="utf-8">` +
      `<style>html,body{height:100%;margin:0;display:grid;place-items:center;background:#fff}</style><body>${code}`;
  }
  return /^\s*<!doctype/i.test(code) ? code : `<!doctype html>\n${code}`;
}


/* ------------------------------------------------------------- run files

   A code block's Run writes the snippet to a scratch file and then runs it.
   The write happens HERE rather than in the terminal because the drawer talks
   to a real PTY, and a PTY echoes everything sent to it: piping the snippet in
   from the browser meant the user watched a heredoc — or a screen-filling
   base64 blob — scroll past before their own output appeared. With the file
   already on disk, the terminal receives one short, readable line.

   The shell the drawer opens is already a full-permission shell on this
   machine, so writing one file the user just asked to run adds no reach; the
   only constraints are that it lands in the OS temp directory under a name
   this process generates. */

const RUN_EXTENSIONS: Record<string, string> = {
  python: "py", python3: "py", py: "py",
  javascript: "js", js: "js", mjs: "mjs",
  typescript: "ts", ts: "ts",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh",
  ruby: "rb", rb: "rb",
  go: "go", php: "php", r: "R", sql: "sql",
};

export function registerNotesRoutes(app: express.Application, express_: typeof express, recordUsage: ai.UsageRecorder) {
  ai.setUsageRecorder(recordUsage);

  app.get("/notes", (_req, res) => res.sendFile(path.join(process.cwd(), "public", "notes", "index.html")));
  app.use("/notes", express_.static(path.join(process.cwd(), "public", "notes")));
  app.use("/notes-files", express_.static(path.join(process.cwd(), "data", "notes", "files"), { index: false, dotfiles: "deny" }));

  /* ---- workspace ---- */
  app.get("/api/notes/bootstrap", wrap(() => ({ ...store.bootstrap(), ai: ai.aiConfigured() })));
  app.get("/api/notes/search", wrap((req) => store.search(String(req.query.q || ""), req.query)));
  app.get("/api/notes/trash", wrap(() => store.listTrash()));
  app.get("/api/notes/inbox", wrap((req) => store.listInbox(req.query)));
  app.delete("/api/notes/workspace", wrap(() => store.clearWorkspace()));
  app.post("/api/notes/inbox/:id/:action", wrap((req) => store.markInbox(req.params.id, req.params.action as "read" | "archive")));
  app.post("/api/notes/inbox/read-all", wrap(() => store.markInbox(null, "read_all")));

  /* ---- code block preview ---- */
  app.post("/api/notes/run-file", wrap(async (req) => {
    const language = String(req.body?.language ?? "").toLowerCase();
    const code = String(req.body?.code ?? "");
    const ext = RUN_EXTENSIONS[language];
    if (!ext) return { error: `${language || "This language"} cannot be run` };
    if (!code.trim()) return { error: "Nothing to run" };
    const name = `clyra-notes-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const file = path.join(os.tmpdir(), name);
    await fsp.writeFile(file, code, "utf8");
    return { path: file };
  }));

  app.post("/api/notes/preview", wrap((req, res) => {
    const language = String(req.body?.language ?? "html");
    const code = String(req.body?.code ?? "");
    if (!code.trim()) return { error: "Nothing to preview" };
    prunePreviews();
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
    const html = previewDocument(language, code);
    previews.set(id, { html, created: Date.now() });
    res.status(201);
    /* `html` comes back with the URL because the panel renders through the
       frame's `srcdoc`, not by navigating to the URL — see the comment on the
       GET route. The URL is still real: it backs the address bar and the
       open-externally button. */
    return { id, url: `/notes/preview/${id}`, html };
  }));

  app.get("/notes/preview/:id", (req, res) => {
    const entry = previews.get(req.params.id);
    if (!entry) {
      res.status(404).type("html").send(
        "<!doctype html><meta charset=\"utf-8\"><style>body{font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0;color:#96989D}</style><body>This preview has expired. Press Preview again.");
      return;
    }
    /* Isolation comes from the `sandbox` ATTRIBUTE on the preview frame:
       without `allow-same-origin` the snippet gets an opaque origin, so it
       cannot touch this app's storage, cookies or API even though it is served
       from the same host. That matters here in a way it does not for the Vibe
       Coder preview, which frames a separate dev-server origin and can afford
       `allow-same-origin`; a note's snippet framed same-origin WITH that flag
       could call /api/notes and delete the user's pages.

       The panel therefore renders through the frame's `srcdoc` rather than by
       navigating to this URL: an opaque-origin document loaded by navigation
       is refused by the app's global `X-Frame-Options: SAMEORIGIN` (an opaque
       origin is not "same origin"), which left the panel blank. `srcdoc`
       inherits the sandbox without that conflict.

       This route still serves the real page, for the address bar's
       open-externally button — a top-level navigation the user asked for, to
       their own code, deliberately not sandboxed. */
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(entry.html);
  });

  /* The reading proxy for the browser panel. Registered here so it shares
     the workspace's route prefix and lifecycle. */
  registerNotesBrowseRoutes(app);

  /* ---- pages ---- */
  app.get("/api/notes/pages", wrap(() => store.listPages()));
  app.get("/api/notes/pages/:id", wrap((req) => store.getPage(req.params.id)));
  app.post("/api/notes/pages", wrap((req, res) => { res.status(201); return store.createPage(req.body); }));
  app.post("/api/notes/pages/:id/lock", wrap((req) => store.lockPage(req.params.id, String(req.body?.password ?? ""), (["pin6", "pin8", "password"].includes(String(req.body?.kind)) ? String(req.body.kind) : "password") as store.LockKind)));
  app.post("/api/notes/pages/:id/check-lock", wrap((req) => { const wait = store.lockWait(req.params.id); if (wait) return { ok: false, wait, message: `Too many attempts. Try again in ${wait}s.` }; const ok = store.checkPageLock(req.params.id, String(req.body?.password ?? "")); const after = ok ? 0 : store.lockWait(req.params.id); return { ok, wait: after, message: after ? `Too many attempts. Try again in ${after}s.` : undefined, page: ok ? store.getPage(req.params.id, { reveal: true }) : undefined }; }));
  app.post("/api/notes/pages/:id/unlock", wrap((req, res) => {
    const result = store.unlockPage(req.params.id, String(req.body?.password ?? ""));
    if (!result.ok) res.status(403);
    return result;
  }));
  app.patch("/api/notes/pages/:id", wrap((req) => store.updatePage(req.params.id, req.body)));
  app.put("/api/notes/pages/:id/blocks", wrap((req) => store.saveBlocks(req.params.id, (req.body.blocks || []) as Block[])));
  app.post("/api/notes/pages/:id/agent-edit", wrap((req) => store.applyAgentEdit(req.params.id, req.body || {})));
  app.post("/api/notes/pages/:id/move", wrap((req) => store.movePage(req.params.id, req.body.parentId ?? null, Number(req.body.index ?? 0))));
  app.post("/api/notes/pages/:id/duplicate", wrap((req) => store.duplicatePage(req.params.id)));
  app.delete("/api/notes/pages/:id", wrap((req) => store.trashPage(req.params.id)));
  app.post("/api/notes/pages/:id/restore", wrap((req) => store.restorePage(req.params.id)));
  app.delete("/api/notes/pages/:id/forever", wrap((req) => store.deletePageForever(req.params.id)));
  app.post("/api/notes/pages/:id/versions", wrap((req) => store.saveVersion(req.params.id)));
  app.post("/api/notes/pages/:id/versions/:versionId/restore", wrap((req) => store.restoreVersion(req.params.id, req.params.versionId)));
  app.get("/api/notes/pages/:id/links", wrap((req) => store.pageLinks(req.params.id)));
  app.get("/api/notes/pages/:id/markdown", wrap((req, res) => {
    const markdown = store.pageMarkdown(req.params.id);
    if (markdown === null) return null;
    res.type("text/markdown").send(markdown);
    return undefined;
  }));

  /* ---- databases ---- */
  app.post("/api/notes/databases", wrap((req, res) => { res.status(201); return store.createDatabase(req.body); }));
  app.get("/api/notes/databases/:id", wrap((req) => store.getDatabase(req.params.id)));
  app.get("/api/notes/pages/:id/database", wrap((req) => store.getDatabaseByPage(req.params.id)));
  app.get("/api/notes/databases/:id/records", wrap((req) => store.listRecords(req.params.id)));
  app.post("/api/notes/databases/:id/records", wrap((req, res) => { res.status(201); return store.createRecord(req.params.id, req.body); }));
  app.post("/api/notes/databases/:id/properties", wrap((req) => store.addProperty(req.params.id, req.body)));
  app.patch("/api/notes/properties/:id", wrap((req) => store.updateProperty(req.params.id, req.body)));
  app.delete("/api/notes/properties/:id", wrap((req) => store.deleteProperty(req.params.id)));
  app.post("/api/notes/databases/:id/views", wrap((req) => store.createView(req.params.id, req.body)));
  app.patch("/api/notes/views/:id", wrap((req) => store.updateView(req.params.id, req.body)));
  app.delete("/api/notes/views/:id", wrap((req) => store.deleteView(req.params.id)));
  app.post("/api/notes/views/:id/query", wrap((req) => store.queryView(req.params.id, req.body || {})));
  app.patch("/api/notes/records/:id", wrap((req) => store.setRecordValues(req.params.id, req.body.values || {})));
  app.get("/api/notes/databases/:id/csv", wrap((req, res) => {
    const csv = store.exportDatabaseCsv(req.params.id);
    if (csv === null) return null;
    res.type("text/csv").send(csv);
    return undefined;
  }));

  /* ---- classes ---- */
  app.get("/api/notes/classes", wrap(() => store.listClasses()));
  app.post("/api/notes/classes", wrap((req, res) => { res.status(201); return store.createClass(String(req.body.name || "New course"), req.body.color); }));
  app.patch("/api/notes/classes/:id", wrap((req) => store.renameClass(Number(req.params.id), String(req.body.name || "").trim() || "Untitled")));
  app.delete("/api/notes/classes/:id", wrap((req) => store.deleteClass(Number(req.params.id))));

  /* ---- flashcards ---- */
  app.get("/api/notes/decks", wrap(() => store.listDecks()));
  app.post("/api/notes/decks", wrap((req, res) => { res.status(201); return store.createDeck(req.body); }));
  app.patch("/api/notes/decks/:id", wrap((req) => store.updateDeck(req.params.id, req.body)));
  app.delete("/api/notes/decks/:id", wrap((req) => store.deleteDeck(req.params.id)));
  app.get("/api/notes/cards", wrap((req) => store.listCards(req.query)));
  app.post("/api/notes/decks/:id/cards", wrap((req) => store.addCards(req.params.id, req.body.cards || [])));
  app.patch("/api/notes/cards/:id", wrap((req) => store.updateCard(req.params.id, req.body)));
  app.delete("/api/notes/cards/:id", wrap((req) => store.deleteCard(req.params.id)));
  app.get("/api/notes/study/queue", wrap((req) => store.studyQueue(
    req.query.deckId ? String(req.query.deckId) : undefined,
    /* The session length is a workspace preference, clamped here so a bad
       value cannot ask the database for everything. */
    Math.min(200, Math.max(5, Number(req.query.limit) || 60)),
  )));
  app.get("/api/notes/study/stats", wrap(() => store.studyStats()));
  app.post("/api/notes/cards/:id/review", wrap((req) => store.reviewCard(req.params.id, Number(req.body.rating) as Rating, req.body.responseMs)));

  /* ---- tests ---- */
  app.get("/api/notes/tests", wrap(() => store.listTests()));
  app.get("/api/notes/tests/:id", wrap((req) => store.getTest(req.params.id)));
  app.post("/api/notes/tests", wrap((req, res) => { res.status(201); return store.createTest(req.body); }));
  app.put("/api/notes/tests/:id/questions", wrap((req) => store.setQuestions(req.params.id, req.body.questions || [])));
  app.delete("/api/notes/tests/:id", wrap((req) => store.deleteTest(req.params.id)));
  app.post("/api/notes/tests/:id/attempts", wrap((req, res) => { res.status(201); return store.startAttempt(req.params.id); }));
  app.get("/api/notes/attempts/:id", wrap((req) => store.getAttempt(req.params.id)));

  /* Objective questions are marked immediately; anything needing judgement is
     graded by the model afterwards so the score is never a guess. */
  app.post("/api/notes/attempts/:id/submit", wrap(async (req) => {
    const submitted = store.submitAttempt(req.params.id, req.body.responses || {});
    if (!submitted) return null;
    if (submitted.pendingGrading.length && ai.aiConfigured()) {
      const attempt = store.getAttempt(req.params.id)!;
      for (const questionId of submitted.pendingGrading) {
        const answer = (attempt.answers as Array<Record<string, unknown>>).find((row) => row.question_id === questionId);
        if (!answer) continue;
        try {
          const graded = await ai.gradeResponse({
            prompt: String(answer.prompt),
            expected: answer.expected,
            response: answer.response,
            points: Number(answer.points ?? 1),
            context: answer.source_page_id ? contextFor([{ pageId: answer.source_page_id, blockIds: answer.source_block_id ? [answer.source_block_id] : undefined }]) : [],
          });
          store.gradeAnswer(req.params.id, questionId, {
            score: graded.score,
            correct: graded.correct,
            feedback: JSON.stringify({
              feedback: graded.feedback,
              correct_points: graded.correct_points,
              missing_points: graded.missing_points,
              improved_answer: graded.improved_answer,
            }),
          });
        } catch (error) {
          /* A grading failure must not lose the attempt: the answer stays
             ungraded and the review screen offers to grade it again. */
          store.gradeAnswer(req.params.id, questionId, {
            score: 0,
            feedback: JSON.stringify({ error: error instanceof Error ? error.message : "Grading failed" }),
          });
        }
      }
    }
    return store.getAttempt(req.params.id);
  }));

  /* ---- lectures ---- */
  app.post("/api/notes/lectures", wrap((req, res) => { res.status(201); return store.startLecture(req.body); }));
  app.get("/api/notes/lectures/:id", wrap((req) => store.getLecture(req.params.id)));
  app.post("/api/notes/lectures/:id/segments", wrap((req) => store.appendSegment(req.params.id, req.body)));
  app.post("/api/notes/lectures/:id/status", wrap((req) => store.setLectureStatus(req.params.id, String(req.body.status || "ended"))));
  /* ---- spoken notes: upload a recording, transcribe it, write it up ---- */

  /* The note itself: read the transcript, decide what the recording is, write it in a layout that suits it, perform any task the
     speaker gave, and keep the transcript behind a toggle. The raw lecture page is never overwritten. */
  const writeSpokenNote = async (sessionId: string, options: { hint?: string; title?: string; onStage?: (stage: "analysing" | "writing") => void } = {}) => {
    const transcript = store.lectureTranscript(sessionId);
    if (!transcript.trim()) throw new Error("There is no transcript to work from yet.");
    const session = store.getLecture(sessionId)!;
    const titles = (store.listPages() as Array<Record<string, unknown>>).filter((page) => !page.inline && page.kind !== "record").map((page) => String(page.title || "Untitled"));
    options.onStage?.("analysing");
    const analysis = await ai.analyseSpeech(transcript, titles, options.hint);
    /* context from the rest of the workspace: notes that match what was talked about */
    const related: ai.ContextChunk[] = [];
    const seen = new Set<string>([String(session.page_id)]);
    for (const topic of analysis.topics.slice(0, 4)) {
      for (const hit of (store.search(topic) as Array<Record<string, unknown>>).slice(0, 2)) {
        const id = String(hit.page_id);
        if (seen.has(id) || related.length >= 5) continue;
        seen.add(id);
        const markdown = store.pageMarkdown(id);
        if (markdown) related.push({ pageId: id, title: String(hit.title || "Untitled"), text: markdown.slice(0, 1800) });
      }
    }
    options.onStage?.("writing");
    const composed = await ai.composeFromSpeech(transcript, analysis, related);
    const paragraphs = transcript.match(/[\s\S]{1,700}(?:\s|$)/g) || [transcript];
    const drafts = [
      ...composed.blocks,
      { type: "divider", text: [], props: {}, children: [] },
      { type: "toggle", text: [{ t: "Full transcript" }], props: { collapsed: true }, children: paragraphs.map((chunk) => ({ type: "text", text: [{ t: chunk.trim() }], props: {}, children: [] })) },
    ];
    const page = store.createPage({
      parentId: session.page_id,
      title: options.title || composed.title || analysis.title,
      icon: analysis.icon,
      blocks: draftsToPageBlocks(drafts as Array<Record<string, unknown>>),
    });
    return { page, analysis, passes: composed.passes };
  };

  app.post("/api/notes/lectures/transcribe", express_.raw({ type: "application/octet-stream", limit: "400mb" }), wrap(async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return { error: "No audio was received." };
    const name = path.basename(String(req.query.name || "recording")).slice(0, 120);
    const hint = String(req.query.hint || "auto");
    const job = recorder.startJob();
    const title = String(req.query.title || "").trim() || name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Recording";
    /* the work runs on after this reply; the page asks how far along it is */
    void (async () => {
      try {
        const { segments, seconds } = await recorder.transcribeRecording(body, name, job);
        if (!segments.length) throw new Error("No speech could be heard in that recording.");
        const started = store.startLecture({ title });
        if (!started) throw new Error("Could not make the page for this recording.");
        const sessionId = String((started.session as Record<string, unknown>).id);
        for (const segment of segments) store.appendSegment(sessionId, segment);
        store.setLectureStatus(sessionId, "ended");
        job.result = { sessionId, pageId: (started.page as Record<string, unknown>).id, seconds, words: segments.reduce((total, segment) => total + segment.text.split(/\s+/).length, 0) };
        if (ai.aiConfigured()) {
          const written = await writeSpokenNote(sessionId, { hint, onStage: (stage) => { job.stage = stage; job.progress = stage === "analysing" ? 0.84 : 0.92; } });
          job.result = { ...job.result, notePageId: (written.page as Record<string, unknown>).id, kind: written.analysis.kind, tasks: written.analysis.tasks.length };
        }
        job.stage = "done"; job.progress = 1; job.status = "done";
      } catch (error) {
        job.status = "failed"; job.error = error instanceof Error ? error.message : "Could not transcribe that recording.";
      }
    })();
    return { id: job.id };
  }));
  app.get("/api/notes/lectures/jobs/:id", wrap((req) => {
    const job = recorder.getJob(String(req.params.id));
    if (!job) return { error: "That recording is no longer being processed." };
    return { id: job.id, status: job.status, stage: job.stage, progress: job.progress, ...(job.error ? { failure: job.error } : {}), heard: job.segments.length, text: job.segments.slice(-1)[0]?.text || "", result: job.result };
  }));

  app.post("/api/notes/lectures/:id/notes", wrap(async (req) => {
    if (ai.aiConfigured()) {
      try {
        const written = await writeSpokenNote(String(req.params.id), { hint: req.body?.hint, title: req.body?.title });
        return { page: written.page, generated: { title: (written.page as Record<string, unknown>).title, kind: written.analysis.kind } };
      } catch (error) {
        if (error instanceof Error && /no transcript/i.test(error.message)) return { error: error.message };
        /* the older single-pass writer is still there if the careful route fails */
      }
    }
    const transcript = store.lectureTranscript(req.params.id);
    if (!transcript.trim()) return { error: "There is no transcript to work from yet." };
    const session = store.getLecture(req.params.id)!;
    const generated = await ai.generateLectureNotes(transcript, { title: req.body.title, course: req.body.course });
    /* The raw transcript page is never overwritten — clean notes become a
       child page so both remain available from the same lecture. */
    const page = store.createPage({
      parentId: session.page_id,
      title: generated.title || "Lecture notes",
      icon: "📝",
      markdown: generated.markdown,
    });
    return { page, generated };
  }));

  /* ---- comments ---- */
  app.get("/api/notes/pages/:id/comments", wrap((req) => store.listComments(req.params.id)));
  app.get("/api/notes/pages/:id/comment-counts", wrap((req) => store.commentCounts(req.params.id)));
  app.post("/api/notes/pages/:id/comments", wrap((req, res) => { res.status(201); return store.addComment(req.params.id, req.body || {}); }));
  app.patch("/api/notes/comments/:id", wrap((req) => store.updateComment(req.params.id, req.body || {})));
  app.delete("/api/notes/comments/:id", wrap((req) => store.deleteComment(req.params.id)));

  /* ---- places for the database Map view: looked up once, then remembered ---- */
  const placeCache = new Map<string, { lat: number; lon: number; label: string } | null>();
  app.post("/api/notes/geocode", wrap(async (req) => {
    const { geocodePlace } = await import("../research/weather");
    const wanted = [...new Set(((req.body?.places || []) as unknown[]).map((place) => String(place).trim().slice(0, 160)).filter(Boolean))].slice(0, 40);
    const results: Record<string, { lat: number; lon: number; label: string } | null> = {};
    let lookups = 0;
    for (const place of wanted) {
      if (!placeCache.has(place)) {
        if (lookups >= 12) { results[place] = null; continue; }
        if (lookups) await new Promise((resolve) => setTimeout(resolve, 1100));
        lookups += 1;
        const found = await geocodePlace(place).catch(() => null);
        const hit = found?.place;
        placeCache.set(place, hit ? { lat: hit.latitude, lon: hit.longitude, label: [hit.name, hit.admin1, hit.country].filter(Boolean).join(", ") } : null);
      }
      results[place] = placeCache.get(place) ?? null;
    }
    return { results };
  }));

  /* ---- synced blocks ---- */
  app.get("/api/notes/synced", wrap(() => store.listSynced()));
  app.get("/api/notes/synced/:id", wrap((req) => store.getSynced(req.params.id) ?? { error: "That synced block no longer exists." }));
  app.post("/api/notes/synced", wrap((req, res) => { res.status(201); return store.createSynced(req.body?.text); }));
  app.put("/api/notes/synced/:id", wrap((req) => store.saveSynced(req.params.id, String(req.body?.text ?? ""))));

  /* ---- workspace flags ---- */
  app.get("/api/notes/meta/:key", wrap((req) => store.getMeta(String(req.params.key).slice(0, 60))));
  app.put("/api/notes/meta/:key", wrap((req) => store.setMeta(String(req.params.key).slice(0, 60), req.body?.value === undefined || req.body?.value === null ? null : String(req.body.value).slice(0, 2000))));

  /* ---- chats ---- */
  app.get("/api/notes/chats", wrap((req) => store.listChats(req.query.pageId ? String(req.query.pageId) : undefined)));
  app.post("/api/notes/chats", wrap((req, res) => { res.status(201); return store.createChat(req.body?.title, req.body?.pageId); }));
  app.get("/api/notes/chats/:id", wrap((req) => store.getChat(req.params.id)));
  app.post("/api/notes/chats/:id/messages", wrap((req) => store.addChatMessage(req.params.id, req.body || {})));
  app.patch("/api/notes/chats/:id", wrap((req) => store.renameChat(req.params.id, String(req.body?.title || ""))));
  app.delete("/api/notes/chats/:id", wrap((req) => store.deleteChat(req.params.id)));
  app.post("/api/notes/chats/prune", wrap((req) => store.pruneEmptyChats(req.body?.keepId)));

  /* ---- sources ---- */
  app.get("/api/notes/sources", wrap((req) => store.listSources(req.query)));
  app.post("/api/notes/sources", wrap((req, res) => { res.status(201); return store.addSource(req.body); }));
  app.get("/api/notes/source-refs/:kind/:id", wrap((req) => store.sourceRefs(req.params.kind, req.params.id)));

  /* ---- attachments ---- */
  /* Raw binary rather than base64 JSON: the global express.json() parser only
     claims application/json, so octet-stream reaches this route untouched and
     a 20 MB slide deck does not inflate by a third on the way in. */
  app.post("/api/notes/upload", express_.raw({ type: "application/octet-stream", limit: "40mb" }), wrap(async (req) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return { error: "No file data was received." };
    const original = String(req.query.name || "file");
    const safe = path.basename(original).replace(/[^\w.\- ]/g, "_").slice(0, 120) || "file";
    const directory = path.join(process.cwd(), "data", "notes", "files");
    await fsp.mkdir(directory, { recursive: true });
    const stored = `${store.newId()}-${safe}`;
    await fsp.writeFile(path.join(directory, stored), body);
    return { url: `/notes-files/${encodeURIComponent(stored)}`, name: safe, size: body.length, type: String(req.query.type || "") };
  }));

  /* The files already uploaded to this workspace, newest first, so "/file" can offer them instead of only an upload. */
  app.get("/api/notes/files", wrap(async () => {
    const directory = path.join(process.cwd(), "data", "notes", "files");
    const names = await fsp.readdir(directory).catch(() => [] as string[]);
    const files = await Promise.all(names.filter((n) => !n.startsWith(".")).map(async (stored) => {
      const stat = await fsp.stat(path.join(directory, stored)).catch(() => null);
      if (!stat?.isFile()) return null;
      return { url: `/notes-files/${encodeURIComponent(stored)}`, name: stored.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, ""), size: stat.size, modifiedAt: stat.mtimeMs };
    }));
    return { files: files.filter(Boolean).sort((a, b) => (b!.modifiedAt - a!.modifiedAt)).slice(0, 80) };
  }));

  /* Can this address be shown inside a page? Many sites forbid framing; asking first lets the editor show a real
     card with an "Open" button instead of an empty box. Fetched through the SSRF-safe fetcher. */
  app.get("/api/notes/embed-check", wrap(async (req) => {
    const url = String(req.query.url || "");
    if (!/^https?:\/\//i.test(url)) return { embeddable: false, reason: "Not a web address." };
    try {
      const response = await safeFetchUserUrl(url, { timeoutMs: 8_000, headers: { "user-agent": "Mozilla/5.0 Clyra" } });
      const frameOptions = (response.headers.get("x-frame-options") || "").toLowerCase();
      const csp = (response.headers.get("content-security-policy") || "").toLowerCase();
      const ancestors = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim() ?? "";
      const blocked = /deny|sameorigin/.test(frameOptions) || (ancestors && !/\*/.test(ancestors));
      const html = /html/.test(response.headers.get("content-type") || "") ? (await response.text()).slice(0, 60_000) : "";
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 140);
      return { reachable: true, embeddable: response.ok && !blocked, title, reason: blocked ? "This site does not allow itself to be shown inside other pages." : response.ok ? undefined : `The site answered ${response.status}.` };
    } catch (error) {
      /* The editor needs to distinguish a page that forbids framing (where
         the reader proxy can still help) from no network at all. */
      return { reachable: false, embeddable: false, reason: error instanceof Error ? error.message : "The site could not be reached." };
    }
  }));

  /* ---- import / export ---- */
  app.post("/api/notes/import/markdown", wrap((req, res) => { res.status(201); return store.importMarkdown(String(req.body.markdown || ""), req.body); }));
  app.post("/api/notes/export", wrap(() => store.exportAll()));

  /* ---- AI ---- */
  app.get("/api/notes/ai/status", (_req, res) => res.json({ configured: ai.aiConfigured(), actions: Object.keys(ai.INLINE_ACTIONS) }));

  app.post("/api/notes/ai/inline", wrap(async (req) =>
    ({ text: await ai.inlineAction(String(req.body.action || "improve"), String(req.body.text || ""), { instruction: req.body.instruction, context: contextFor(refsFrom(req.body)) }) })));

  app.post("/api/notes/ai/ask", wrap(async (req) => {
    const context = contextFor(refsFrom(req.body));
    const question = String(req.body.question || "");
    /* Clyra's existing research handler is reused rather than a second search
       integration, and only when the notes plainly cannot answer. */
    let searched: string | null = null;
    if (req.body.web !== false) {
      const decision = await ai.decideWebSearch(question, context);
      if (decision.needed) {
        const research = await runWebSearchResearch({ query: decision.query, maxResults: 5, fetchTop: 3 })
          .catch(() => null);
        if (research?.ok) {
          searched = decision.query;
          for (const page of research.pages) {
            if (page.blocked || !page.excerpt.trim()) continue;
            context.push({ pageId: "", blockId: null, title: `Web: ${page.url}`, text: page.excerpt });
          }
        }
      }
    }
    const text = await ai.workspaceAnswer(question, context);
    /* Citations stay one-per-chunk so an [S12] marker can jump to a block,
       while the visible source list is one entry per page. */
    const citations = context.map((chunk, index) => ({
      index: index + 1, pageId: chunk.pageId, blockId: chunk.blockId, title: chunk.title,
    }));
    const pages = new Map<string, { pageId: string; title: string; url?: string }>();
    for (const chunk of context) {
      const web = chunk.title.startsWith("Web: ");
      const key = web ? chunk.title : chunk.pageId;
      if (!pages.has(key)) {
        pages.set(key, web
          ? { pageId: "", title: chunk.title.slice(5), url: chunk.title.slice(5) }
          : { pageId: chunk.pageId, title: chunk.title });
      }
    }
    return { text, citations, searched, sources: [...pages.values()] };
  }));

  app.post("/api/notes/ai/flashcards", wrap(async (req) => {
    const context = contextFor(refsFrom(req.body));
    if (!context.length) return { error: "Select a page or some text to generate cards from." };
    const deckId = req.body.deckId ? String(req.body.deckId) : null;
    const existing = deckId ? store.listCards({ deckId }).map((card) => String((card as Record<string, unknown>).front)) : [];
    const cards = await ai.generateCards(context, { count: req.body.count, difficulty: req.body.difficulty, style: req.body.style, existing });
    return { cards: sanitiseProvenance(cards, context) };
  }));

  app.post("/api/notes/ai/questions", wrap(async (req) => {
    const context = contextFor(refsFrom(req.body));
    if (!context.length) return { error: "Select a page or some text to generate questions from." };
    return { questions: sanitiseProvenance(await ai.generateQuestions(context, req.body), context) };
  }));

  app.post("/api/notes/ai/study-guide", wrap(async (req) => {
    const context = contextFor(refsFrom(req.body));
    if (!context.length) return { error: "Select a page to build a study guide from." };
    const generated = await ai.generateStudyGuide(context, { focus: req.body.focus });
    const page = store.createPage({
      parentId: req.body.parentId ?? context[0]!.pageId,
      title: generated.title || "Study guide",
      icon: "🎯",
      markdown: generated.markdown,
    });
    return { page, generated };
  }));

  app.post("/api/notes/ai/source-notes", wrap(async (req) => {
    const context = contextFor(refsFrom(req.body));
    if (!context.length) return { error: "Add a source before generating notes." };
    const generated = await ai.generateNotesFromSource(context, { title: req.body.title });
    const page = store.createPage({
      parentId: req.body.parentId ?? null,
      classId: req.body.classId ?? null,
      title: generated.title || req.body.title || "Imported notes",
      markdown: generated.markdown,
    });
    return { page, generated };
  }));

  /* One document endpoint for every "make me a page" path: the chat's
     Create page, the study-guide generator and the composer all go through
     the harness so they produce the same quality of page. */
  app.post("/api/notes/ai/document", wrap(async (req) => {
    const instruction = String(req.body.instruction || "").trim();
    if (!instruction) return { error: "Say what the document should cover" };
    const context = contextFor((req.body.sources || []) as Array<Record<string, unknown>>);
    const composed = await ai.composeStructuredDocument({
      instruction,
      context,
      title: req.body.title ? String(req.body.title) : undefined,
      maxRevisions: req.body.maxRevisions === undefined ? undefined : Number(req.body.maxRevisions),
    });
    if (req.body.create === false) return composed;
    const page = store.createPage({
      parentId: req.body.parentId ?? null,
      classId: req.body.classId ?? null,
      title: composed.title,
      blocks: draftsToPageBlocks(composed.blocks),
    });
    return { page, passes: composed.passes, outstanding: composed.outstanding };
  }));

  app.post("/api/notes/ai/formula", wrap(async (req) => ai.generateFormula(String(req.body.request || ""), (req.body.properties || []) as string[])));
}

export { contextFor, markdownToBlocks, parseSpans };
