/* HTTP surface for the notes workspace. Registered by server.ts so the
   routes live beside the store they call rather than in the main file. */
import path from "node:path";
import { promises as fsp } from "node:fs";
import type express from "express";
import * as store from "./store";
import * as ai from "./ai";
import { runWebSearchResearch } from "../research/research-handlers";
import { blocksToMarkdown, markdownToBlocks, spanText, parseSpans, type Block } from "./blocks";
import type { Rating } from "./fsrs";

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
  app.post("/api/notes/inbox/:id/:action", wrap((req) => store.markInbox(req.params.id, req.params.action as "read" | "archive")));
  app.post("/api/notes/inbox/read-all", wrap(() => store.markInbox(null, "read_all")));

  /* ---- pages ---- */
  app.get("/api/notes/pages", wrap(() => store.listPages()));
  app.get("/api/notes/pages/:id", wrap((req) => store.getPage(req.params.id)));
  app.post("/api/notes/pages", wrap((req, res) => { res.status(201); return store.createPage(req.body); }));
  app.patch("/api/notes/pages/:id", wrap((req) => store.updatePage(req.params.id, req.body)));
  app.put("/api/notes/pages/:id/blocks", wrap((req) => store.saveBlocks(req.params.id, (req.body.blocks || []) as Block[])));
  app.post("/api/notes/pages/:id/move", wrap((req) => store.movePage(req.params.id, req.body.parentId ?? null, Number(req.body.index ?? 0))));
  app.post("/api/notes/pages/:id/duplicate", wrap((req) => store.duplicatePage(req.params.id)));
  app.delete("/api/notes/pages/:id", wrap((req) => store.trashPage(req.params.id)));
  app.post("/api/notes/pages/:id/restore", wrap((req) => store.restorePage(req.params.id)));
  app.delete("/api/notes/pages/:id/forever", wrap((req) => store.deletePageForever(req.params.id)));
  app.post("/api/notes/pages/:id/versions", wrap((req) => store.saveVersion(req.params.id)));
  app.post("/api/notes/pages/:id/versions/:versionId/restore", wrap((req) => store.restoreVersion(req.params.id, req.params.versionId)));
  app.get("/api/notes/pages/:id/markdown", wrap((req, res) => {
    const markdown = store.pageMarkdown(req.params.id);
    if (markdown === null) return null;
    res.type("text/markdown").send(markdown);
    return undefined;
  }));

  /* ---- databases ---- */
  app.post("/api/notes/databases", wrap((req, res) => { res.status(201); return store.createDatabase(req.body); }));
  app.get("/api/notes/databases/:id", wrap((req) => store.getDatabase(req.params.id)));
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
  app.get("/api/notes/study/queue", wrap((req) => store.studyQueue(req.query.deckId ? String(req.query.deckId) : undefined)));
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
  app.post("/api/notes/lectures/:id/notes", wrap(async (req) => {
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

  /* ---- chats ---- */
  app.get("/api/notes/chats", wrap(() => store.listChats()));
  app.post("/api/notes/chats", wrap((req, res) => { res.status(201); return store.createChat(req.body?.title); }));
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

  app.post("/api/notes/ai/formula", wrap(async (req) => ai.generateFormula(String(req.body.request || ""), (req.body.properties || []) as string[])));
}

export { contextFor, markdownToBlocks, parseSpans };
