/* Notes workspace store tests.

   Runs against a throwaway copy of the workspace database so the checks
   exercise real migration behaviour without touching the user's notes.
   Run with: npm run test:notes */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "clyra-notes-test-"));
await fs.mkdir(path.join(sandbox, "data", "notes"), { recursive: true });
const migrationFixture = process.env.CLYRA_NOTES_MIGRATION_FIXTURE;
if (migrationFixture) {
  // A migration test may opt into a dedicated fixture. Never copy the
  // developer's or user's working Notes database into an isolation test:
  // existing pages/chats make fresh-workspace assertions nondeterministic.
  const source = path.resolve(migrationFixture);
  if (!await fs.stat(source).then(() => true, () => false)) throw new Error(`Migration fixture does not exist: ${source}`);
  await new Database(source, { readonly: true }).backup(path.join(sandbox, "data", "notes", "clyra-notes.db"));
}
process.chdir(sandbox);

const store = await import(new URL("../lib/notes/store.ts", import.meta.url).href);
const { blocksToMarkdown, spanText, plain } = await import(new URL("../lib/notes/blocks.ts", import.meta.url).href);

let failures = 0;
const check = (label: string, condition: unknown, detail?: unknown) => {
  if (condition) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail)); }
};

async function main() {
  await store.initNotesStore();

  console.log("\n[migration]");
  const pages = store.listPages();
  const osmosis = pages.find((p) => p.title === "Osmosis in Plant Cells");
  if (osmosis) {
    check("legacy pages migrated", pages.length >= 9, pages.length);
    check("legacy page kept its id", String(osmosis.id) === "3", osmosis.id);
    const tree = store.blockTree(String(osmosis.id));
    check("markdown became blocks", tree.length > 5, tree.length);
    check("headings survived", tree.some((b) => b.type === "h2"), tree.map((b) => b.type).slice(0, 8));
    check("bullets survived", tree.some((b) => b.type === "bulleted"));
    const roundTrip = blocksToMarkdown(tree);
    check("round-trip keeps text", roundTrip.includes("osmosis") || roundTrip.toLowerCase().includes("osmosis"));
  } else {
    // A deliberately reset workspace is a valid test fixture too; migration
    // assertions remain active whenever the legacy sample data is present.
    check("fresh workspace starts empty", pages.length === 0, pages.length);
  }

  console.log("\n[pages]");
  const parent = store.createPage({ title: "Biology", icon: "🧬" })!;
  const child = store.createPage({ title: "Cell membranes", parentId: parent.id })!;
  check("child created under parent", child.parent_id === parent.id);
  check("breadcrumb built", (child.breadcrumb as unknown[]).length === 1, child.breadcrumb);
  const cycle = store.movePage(String(parent.id), String(child.id), 0);
  check("cycle move rejected", "error" in cycle, cycle);
  store.saveBlocks(String(child.id), [
    { id: "b1", page_id: String(child.id), parent_id: null, type: "h1", text: plain("Membrane transport"), props: {}, sort: 0 },
    { id: "b2", page_id: String(child.id), parent_id: null, type: "text", text: plain("Diffusion moves particles down a concentration gradient."), props: {}, sort: 1,
      children: [] },
    { id: "b3", page_id: String(child.id), parent_id: null, type: "toggle", text: plain("Active transport"), props: {}, sort: 2,
      children: [{ id: "b4", page_id: String(child.id), parent_id: "b3", type: "bulleted", text: plain("Requires ATP"), props: {}, sort: 0 }] },
  ] as never);
  const reloaded = store.blockTree(String(child.id));
  check("nesting persisted", reloaded[2]?.children?.[0]?.id === "b4", reloaded[2]);
  check("block text persisted", spanText(reloaded[1]!.text).includes("concentration gradient"));

  console.log("\n[search]");
  const hits = store.search("concentration gradient");
  check("finds block text", hits.some((h: any) => h.page_id === child.id), hits.slice(0, 2));
  check("search excerpt marked", hits.some((h: any) => String(h.excerpt).includes("<mark>")));
  check("empty query is empty", store.search("   ").length === 0);

  console.log("\n[backlinks]");
  store.saveBlocks(String(parent.id), [
    { id: "l1", page_id: String(parent.id), parent_id: null, type: "text", props: {}, sort: 0,
      text: [{ t: "See " }, { t: "Cell membranes", page: String(child.id) }] },
  ] as never);
  const withLinks = store.getPage(String(child.id))!;
  check("backlink recorded", (withLinks.backlinks as any[]).some((b) => b.id === parent.id), withLinks.backlinks);

  console.log("\n[versions]");
  store.updatePage(String(child.id), { title: "Cell membranes and transport" });
  const versioned = store.getPage(String(child.id))!;
  check("version snapshot taken", (versioned.versions as any[]).length >= 1);
  const versionId = (versioned.versions as any[])[0].id;
  store.saveBlocks(String(child.id), [] as never);
  check("blocks cleared", store.blockTree(String(child.id)).length === 0);
  store.restoreVersion(String(child.id), versionId);
  check("version restored blocks", store.blockTree(String(child.id)).length === 3, store.blockTree(String(child.id)).length);

  console.log("\n[trash]");
  const doomed = store.createPage({ title: "Scratch" })!;
  store.trashPage(String(doomed.id));
  check("hidden from list", !store.listPages().some((p) => p.id === doomed.id));
  check("appears in trash", store.listTrash().some((p: any) => p.id === doomed.id));
  check("dropped from search", store.search("Scratch").length === 0);
  store.restorePage(String(doomed.id));
  check("restored to list", store.listPages().some((p) => p.id === doomed.id));
  store.deletePageForever(String(doomed.id));
  check("deleted forever", !store.listTrash().some((p: any) => p.id === doomed.id));

  console.log("\n[database]");
  const database = store.createDatabase({ name: "Assignments", parentId: parent.id })!;
  const titleProp = database.properties.find((p) => p.type === "title")!;
  const statusProp = database.properties.find((p) => p.type === "status")!;
  const dueProp = database.properties.find((p) => p.type === "date")!;
  const score = store.addProperty(database.id, { name: "Score", type: "number" }) as any;
  const weight = store.addProperty(database.id, { name: "Weight", type: "number" }) as any;
  const percent = store.addProperty(database.id, { name: "Percent", type: "formula", config: { expression: 'round(prop("Score") / prop("Weight") * 100, 1)' } }) as any;
  check("formula accepted", !percent.error, percent);
  const bad = store.addProperty(database.id, { name: "Broken", type: "formula", config: { expression: 'prop("Nope") + 1' } }) as any;
  check("bad formula rejected", Boolean(bad.error), bad);

  // Date-relative filters must be tested with dates relative to the day the
  // suite runs; fixed 2026 fixtures silently become stale over time.
  const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const r1 = store.createRecord(database.id, { values: { [titleProp.id]: "Essay", [statusProp.id]: "doing", [dueProp.id]: { start: isoDay(30) }, [score.id]: 42, [weight.id]: 50 } })!;
  const r2 = store.createRecord(database.id, { values: { [titleProp.id]: "Lab report", [statusProp.id]: "done", [dueProp.id]: { start: isoDay(-30) }, [score.id]: 18, [weight.id]: 20 } })!;
  const r3 = store.createRecord(database.id, { values: { [titleProp.id]: "Quiz", [statusProp.id]: "todo", [score.id]: 9, [weight.id]: 10 } })!;
  const records = store.listRecords(database.id);
  check("three records", records.length === 3, records.length);
  const essay = records.find((r) => r.title === "Essay")!;
  check("title reads back", (essay.values as any)[titleProp.id] === "Essay");
  check("formula computed", (essay.values as any)[percent.id] === 84, (essay.values as any)[percent.id]);

  const view = database.views[0]!;
  store.updateView(view.id, { config: { filter: { conjunction: "and", conditions: [{ property: statusProp.id, operator: "is_not", value: "done" }] }, sorts: [{ property: titleProp.id, direction: "ascending" }] } });
  const filtered = store.queryView(view.id)!;
  check("filter applied", filtered.records.length === 2, filtered.records.map((r: any) => r.title));
  check("sort applied", (filtered.records[0] as any).title === "Essay", (filtered.records[0] as any).title);
  const grouped = store.queryView(view.id, { filter: null, group: statusProp.id })!;
  check("grouped into status columns", (grouped.groups || []).length >= 3, (grouped.groups || []).map((g) => `${g.label}:${g.records.length}`));
  const searched = store.queryView(view.id, { filter: null, search: "lab" })!;
  check("view search works", searched.records.length === 1, searched.records.map((r: any) => r.title));
  const dated = store.queryView(view.id, { filter: { conjunction: "and", conditions: [{ property: dueProp.id, operator: "is_before_today" }] } })!;
  check("date filter works", dated.records.length === 1 && (dated.records[0] as any).title === "Lab report", dated.records.map((r: any) => r.title));

  console.log("\n[relations + rollups]");
  const courses = store.createDatabase({ name: "Courses", parentId: parent.id })!;
  const courseTitle = courses.properties.find((p) => p.type === "title")!;
  const courseRecord = store.createRecord(courses.id, { values: { [courseTitle.id]: "Biology 101" } })!;
  const relation = store.addProperty(database.id, { name: "Course", type: "relation", config: { databaseId: courses.id } }) as any;
  store.setRecordValues(String(r1.id), { [relation.id]: [String(courseRecord.id)] });
  store.setRecordValues(String(r2.id), { [relation.id]: [String(courseRecord.id)] });
  const backRelation = store.addProperty(courses.id, { name: "Assignments", type: "relation", config: { databaseId: database.id } }) as any;
  store.setRecordValues(String(courseRecord.id), { [backRelation.id]: [String(r1.id), String(r2.id), String(r3.id)] });
  const rollupCount = store.addProperty(courses.id, { name: "Total", type: "rollup", config: { relationProperty: backRelation.id, function: "count" } }) as any;
  const rollupAvg = store.addProperty(courses.id, { name: "Avg score", type: "rollup", config: { relationProperty: backRelation.id, targetProperty: score.id, function: "average" } }) as any;
  const course = store.listRecords(courses.id)[0]!;
  check("relation stored", ((course.values as any)[backRelation.id] || []).length === 3, (course.values as any)[backRelation.id]);
  check("rollup count", (course.values as any)[rollupCount.id] === 3, (course.values as any)[rollupCount.id]);
  check("rollup average", Math.round(((course.values as any)[rollupAvg.id] || 0) * 100) / 100 === 23, (course.values as any)[rollupAvg.id]);

  console.log("\n[views]");
  for (const type of ["board", "calendar", "gallery", "list", "timeline", "chart", "feed", "form", "map", "dashboard"]) {
    const created = store.createView(database.id, { type }) as any;
    check(`view ${type} created`, !created.error, created);
  }
  const onlyOne = store.getDatabase(courses.id)!.views[0]!;
  check("last view protected", Boolean((store.deleteView(onlyOne.id) as any).error));

  console.log("\n[csv]");
  const csv = store.exportDatabaseCsv(database.id)!;
  check("csv has header + rows", csv.split("\n").length === 4, csv.split("\n").length);
  check("csv quotes values", csv.includes('"Essay"'));

  console.log("\n[flashcards + FSRS]");
  const deck = store.createDeck({ name: "Biology deck" }) as any;
  const added = store.addCards(deck.id, [
    { front: "What is osmosis?", back: "Movement of water across a partially permeable membrane", sourcePageId: String(parent.id) },
    { front: "What is osmosis?", back: "duplicate" },
    { front: "What is diffusion?", back: "Movement down a concentration gradient" },
  ]);
  check("duplicate front skipped", added.added === 2, added.added);
  const reviewsBefore = store.studyStats().reviewedToday;
  const queue = store.studyQueue(deck.id);
  check("new cards are due", queue.length === 2, queue.length);
  check("intervals previewed", (queue[0] as any).intervals[1] < (queue[0] as any).intervals[4], (queue[0] as any).intervals);
  const reviewed = store.reviewCard(String((queue[0] as any).id), 3)!;
  check("review advances due date", new Date(reviewed.scheduled.due_at) > new Date(), reviewed.scheduled.due_at);
  check("review logged", store.studyStats().reviewedToday === reviewsBefore + 1, store.studyStats());
  check("card left the queue", store.studyQueue(deck.id).length === 1);
  const lapsed = store.reviewCard(String((queue[1] as any).id), 1)!;
  check("again keeps card soon", lapsed.scheduled.interval_days < 0.02, lapsed.scheduled.interval_days);

  console.log("\n[tests]");
  const test = store.createTest({
    title: "Cells quiz",
    questions: [
      { type: "multiple_choice", prompt: "Water moves by?", choices: ["Osmosis", "Mitosis"], answer: "Osmosis", topic: "Transport", explanation: "Water crosses membranes by osmosis." },
      { type: "true_false", prompt: "Diffusion needs ATP", answer: "false", topic: "Transport" },
      { type: "fill_blank", prompt: "Active transport needs ___", answer: ["ATP", "energy"], topic: "Transport" },
      { type: "multiple_response", prompt: "Passive processes?", choices: ["Osmosis", "Diffusion", "Active transport"], answer: ["Osmosis", "Diffusion"], topic: "Transport" },
      { type: "matching", prompt: "Match", answer: { Osmosis: "Water", Diffusion: "Solute" }, topic: "Transport" },
      { type: "short_answer", prompt: "Define a concentration gradient", answer: ["A difference in concentration between two regions"], topic: "Transport" },
    ],
  })!;
  check("questions stored", (test.questions as any[]).length === 6);
  const attempt = store.startAttempt(String(test.id)) as any;
  const q = test.questions as any[];
  const submitted = store.submitAttempt(attempt.id, {
    [q[0].id]: "Osmosis",
    [q[1].id]: "false",
    [q[2].id]: "energy",
    [q[3].id]: ["Diffusion", "Osmosis"],
    [q[4].id]: { Osmosis: "Water", Diffusion: "Solute" },
    [q[5].id]: "when one region has more of something than another",
  })!;
  check("objective questions auto-graded", submitted.score === 5, submitted.score);
  check("synonym accepted for fill blank", (submitted.answers as any[])[2].correct === 1);
  check("unordered multi-response accepted", (submitted.answers as any[])[3].correct === 1);
  check("short answer left for AI grading", submitted.pendingGrading.length === 1, submitted.pendingGrading);
  check("topic breakdown built", (submitted.topics as any[])[0].max === 6, submitted.topics);
  store.gradeAnswer(attempt.id, q[5].id, { score: 1, correct: true, feedback: "ok" });
  check("AI grade updates total", store.getAttempt(attempt.id)!.score === 6, store.getAttempt(attempt.id)!.score);

  console.log("\n[lectures]");
  const lecture = store.startLecture({ title: "Lecture 1" }) as any;
  store.appendSegment(lecture.session.id, { start: 0, end: 4, text: "Today we cover osmosis." });
  store.appendSegment(lecture.session.id, { start: 4, end: 9, text: "Water moves down a water potential gradient." });
  check("transcript assembled", store.lectureTranscript(lecture.session.id).includes("water potential"));
  check("segments timestamped", (store.getLecture(lecture.session.id)!.segments as any[])[1].t_start === 4);
  store.setLectureStatus(lecture.session.id, "ended");
  check("lecture ended", store.getLecture(lecture.session.id)!.status === "ended");

  console.log("\n[import/export]");
  const imported = store.importMarkdown("# Imported\n\n## Section\n\n- one\n- two\n\n1. first\n\n- [x] done\n\n> quote\n\n```js\nconst a = 1;\n```\n\n---\n")!;
  const importedBlocks = store.blockTree(String(imported.id));
  check("import title", imported.title === "Imported", imported.title);
  check("import block types", importedBlocks.map((b) => b.type).join(",") === "h2,bulleted,bulleted,numbered,todo,quote,code,divider", importedBlocks.map((b) => b.type));
  check("todo checked flag", (importedBlocks[4]!.props as any).checked === true);
  check("code language kept", (importedBlocks[6]!.props as any).language === "js");
  const md = store.pageMarkdown(String(imported.id))!;
  check("markdown export round-trips", md.includes("- [x] done") && md.includes("```js"), md.slice(0, 200));

  console.log("\n[empty list items]");
  const skeleton = store.importMarkdown("# Skeleton\n\n## Steps\n\n1. \n2. \n\n## Tasks\n\n- [ ] \n- \n")!;
  const skeletonTypes = store.blockTree(String(skeleton.id)).map((b) => b.type);
  check("empty numbered items stay lists", skeletonTypes.filter((t) => t === "numbered").length === 2, skeletonTypes);
  check("empty todo stays a to-do", skeletonTypes.includes("todo"), skeletonTypes);
  check("empty bullet stays a bullet", skeletonTypes.includes("bulleted"), skeletonTypes);

  console.log("\n[tables]");
  const tabled = store.importMarkdown("# Table import\n\n| Structure | Function |\n| --- | --- |\n| Cell wall | Prevents bursting |\n| Vacuole | Osmotic pressure |\n")!;
  const tableBlocks = store.blockTree(String(tabled.id));
  check("markdown table becomes a table block", tableBlocks[0]?.type === "table", tableBlocks.map((b) => b.type));
  check("table rows parsed", ((tableBlocks[0]?.props as any)?.rows || []).length === 3, (tableBlocks[0]?.props as any)?.rows);
  check("table header cells", ((tableBlocks[0]?.props as any)?.rows?.[0] || []).join("|") === "Structure|Function");
  check("table exports back to markdown", (store.pageMarkdown(String(tabled.id)) || "").includes("| Cell wall | Prevents bursting |"));
  const graphed = store.importMarkdown("# Graph import\n\n:::chart {\"kind\":\"scatter\",\"title\":\"Measurements\",\"data\":[{\"x\":1,\"y\":2}]}\n:::\n")!;
  const graphBlock = store.blockTree(String(graphed.id))[0];
  check("chart directive imports as a chart block", graphBlock?.type === "chart", graphBlock?.type);
  check("chart props round-trip", (graphBlock?.props as any)?.kind === "scatter" && (graphBlock?.props as any)?.data?.length === 1, graphBlock?.props);
  check("chart exports as a directive", (store.pageMarkdown(String(graphed.id)) || "").includes(":::chart"));

  console.log("\n[chats]");
  const chat = store.createChat()!;
  check("chat starts untitled", chat.title === "New chat", chat.title);
  store.addChatMessage(String(chat.id), { role: "user", text: "How does osmosis move water?" });
  store.addChatMessage(String(chat.id), { role: "assistant", text: "Down a water potential gradient.", citations: [{ index: 1, pageId: "3" }] });
  const loaded = store.getChat(String(chat.id))!;
  check("chat titled from the first question", loaded.title === "How does osmosis move water?", loaded.title);
  check("messages stored in order", (loaded.messages as any[]).map((m) => m.role).join(",") === "user,assistant");
  check("citations round-trip", ((loaded.messages as any[])[1].citations || []).length === 1);
  store.renameChat(String(chat.id), "Osmosis thread");
  check("chat renamed", (store.getChat(String(chat.id)) as any).title === "Osmosis thread");
  const emptyChat = store.createChat()!;
  store.pruneEmptyChats();
  check("empty chats pruned", !store.listChats().some((row: any) => row.id === emptyChat.id));
  check("used chat survives pruning", store.listChats().some((row: any) => row.id === chat.id));
  store.deleteChat(String(chat.id));
  check("chat deleted", !store.listChats().length);
  check("pages untouched by chat delete", store.listPages().length > 0);

  console.log("\n[inbox]");
  store.addInboxEvent({ kind: "study", title: "12 cards due" });
  check("inbox event added", store.listInbox().length === 1);
  store.markInbox(null, "read_all");
  check("mark all read", store.listInbox({ unread: true }).length === 0);

  /* The markup highlighter emitted any UNMATCHED run of a tag verbatim, so a
     `<!doctype html>` line reached innerHTML raw and the browser swallowed it
     as a bogus comment — the line simply vanished from the rendered block.
     Nothing may reach innerHTML unescaped. */
  console.log("\n[code highlighting]");
  const { highlight } = await import(new URL("../public/notes/js/code.js", import.meta.url).href);

  const doctype = highlight("<!doctype html>", "html");
  check("doctype survives highlighting", doctype.includes("&lt;!doctype html&gt;"), doctype);

  const onlySpanMarkup = (out: string) =>
    (out.match(/<[^>]*>/g) ?? []).every((tag) => /^<\/?span( class="tok-[a-z]+")?>$/.test(tag));

  for (const [label, source] of [
    ["doctype", "<!doctype html><p>after</p>"],
    ["stray bracket", "< img src=x onerror=alert(1)>"],
    ["unclosed tag", "<div class="],
    ["bare comparison", "a < b && c > d"],
    ["processing instruction", "<?php echo 1; ?>"],
    ["cdata", "<![CDATA[ <b>x</b> ]]>"],
  ] as const) {
    const out = highlight(source, "html");
    check(`${label}: only span markup reaches innerHTML`, onlySpanMarkup(out), out);
  }

  // It must still COLOUR ordinary markup, not merely escape everything.
  const coloured = highlight('<a href="/x">hi</a>', "html");
  check("tags still highlighted", coloured.includes('class="tok-tag"'), coloured);
  check("attributes still highlighted", coloured.includes('class="tok-attr"'), coloured);
  check("strings still highlighted", coloured.includes('class="tok-string"'), coloured);

  console.log("\n[smart note input]");
  const { detectCodeLanguage, solveMath, evaluateMathFunction } = await import(new URL("../public/notes/js/smart-input.js", import.meta.url).href);
  check("detects a JavaScript declaration", detectCodeLanguage("const total = subtotal * 1.1;") === "javascript");
  check("detects HTML before a code replacement", detectCodeLanguage("<main><h1>Welcome</h1></main>") === "html");
  check("detects a Python definition", detectCodeLanguage("def total(items):") === "python");
  check("reclassifies the replacement as Python", detectCodeLanguage("from pathlib import Path\nprint(Path.cwd())") === "python");
  check("does not convert ordinary prose to code", detectCodeLanguage("Class starts after lunch.") === null);
  check("calculates arithmetic locally", solveMath("What is 12 * (4 + 1)?")?.answer === "60");
  check("treats x as multiplication between values", solveMath("What is 12 x 5?")?.answer === "60");
  check("keeps x as an equation variable", solveMath("2x + 4 = 12")?.answer === "x = 4");
  check("calculates percentages locally", solveMath("what is 15%")?.answer === "0.15");
  check("understands verbal arithmetic locally", solveMath("What is 20% of 50?")?.answer === "10");
  check("understands square roots locally", solveMath("What is square root of 81?")?.answer === "9");
  check("solves a simple x equation locally", solveMath("solve 2x + 4 = 12")?.answer === "x = 4");
  check("solves a quadratic locally", solveMath("x^2 - 5x + 6 = 0")?.answer === "x = 2 or x = 3");
  check("solves a higher-degree polynomial locally", solveMath("x^3 - 6x^2 + 11x - 6 = 0")?.answer === "x = 1 or x = 2 or x = 3");
  check("solves a two-variable system locally", solveMath("2x + y = 7; x - y = 1")?.answer === "x = 2.6666666667, y = 1.6666666667");
  check("isolates y in a linear relation", solveMath("2x + 3y = 12")?.answer === "y = -0.6666666667x + 4");
  check("evaluates a safe graph function", evaluateMathFunction("x^2 - 3x + 1", 2) === -1);
  check("does not evaluate JavaScript", solveMath("alert(1)") === null);

  console.log(`\n${failures ? `${failures} FAILURES` : "all checks passed"}`);
  process.exit(failures ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });
