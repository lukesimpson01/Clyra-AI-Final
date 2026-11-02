/* The template catalogue.

   A template is a block tree, not a markdown string. Markdown could only
   describe headings, lists and tables, which is why every template used to
   arrive as a flat outline; blocks let a template ship the callouts, toggles,
   key terms, objectives, contents and styled tables the editor can already
   render, so what a student gets is a finished page rather than a skeleton.

   Templates are created through the ordinary page API, so there is still no
   template runtime: whatever the editor can do, a template inherits. */
import { inlineMarkdown } from "./editor.js";

/* Block helpers. Text is written as inline markdown so a template stays
   readable in source while still shipping real bold, links and code. */
const b = (type, text = "", props = {}, children = []) =>
  ({ type, text: inlineMarkdown(text), props, children });

const h1 = (text) => b("h1", text);
const h2 = (text) => b("h2", text);
const h3 = (text) => b("h3", text);
const p = (text = "") => b("text", text);
const li = (text = "") => b("bulleted", text);
const num = (text = "") => b("numbered", text);
const todo = (text = "", checked = false) => b("todo", text, { checked });
const quote = (text) => b("quote", text);
const divider = () => b("divider");
const contents = () => b("toc");
const callout = (icon, text, color = "blue") => b("callout", text, { icon, color });
const toggle = (text, children) => b("toggle", text, { collapsed: false }, children);
const term = (name, definition) => b("key_term", definition, { term: name });
const objective = (text) => b("objective", text);
const summary = (text) => b("study_summary", text);
const source = (title, url, kind = "Web") => b("source", "", { title, url, kind });
const checklist = (title, items) =>
  b("exam_checklist", "", { title }, items.map((item) => todo(item)));

/* Tables carry their own presentation. A template that ships a grey wall of
   cells reads as unfinished, so each one names its header tint and its
   column alignment along with the rows.

   The tint is a named colour rather than a hex value: named tints resolve
   through the theme tokens, so a template screenshot and a real page both
   look right in dark mode. */
const table = (rows, options = {}) => b("table", "", {
  rows,
  hasHeader: true,
  striped: options.striped !== false,
  align: options.align || rows[0].map(() => "left"),
  tint: options.tint || "gray",
});

export const TEMPLATE_CATEGORIES = ["Notes", "Study", "Work", "Planning", "Writing", "Research", "Personal"];

export const TEMPLATES = [
  {
    id: "blank",
    name: "Blank page",
    icon: "page",
    category: "Notes",
    desc: "An empty page with nothing in the way.",
    accent: "#8a8f9c",
    blocks: () => [p("")],
  },

  {
    id: "lecture",
    name: "Lecture notes",
    icon: "mic",
    category: "Notes",
    desc: "Prime, capture, then close the loop after class.",
    accent: "#6e7bf2",
    blocks: () => [
      callout("🎙️", "Fill in the three boxes below **before** the lecture starts. Five minutes of priming is worth an hour of re-reading.", "purple"),
      table([
        ["Module", "Lecturer", "Date", "Week"],
        ["", "", "", ""],
      ], { align: ["left", "left", "left", "center"], tint: "purple" }),
      h2("Before the lecture"),
      objective("By the end of this lecture I should be able to…"),
      li("What is this lecture about, in one sentence?"),
      li("What do I already know about it?"),
      li("What did last week's lecture leave unfinished?"),
      divider(),
      h2("Notes"),
      p("Capture in your own words. Do not transcribe — you are not a stenographer."),
      p(""),
      h3("Key claim"),
      p(""),
      h3("Evidence given"),
      li(""),
      li(""),
      h3("Worked example"),
      p(""),
      divider(),
      h2("Key terms"),
      term("", "Definition in your own words"),
      term("", "Definition in your own words"),
      h2("Questions I still have"),
      callout("❓", "Anything here that is still unanswered by the end of the week is a revision priority.", "orange"),
      li(""),
      li(""),
      h2("After the lecture"),
      summary("Three sentences that would let a friend who missed the lecture pass a question on it."),
      checklist("Close the loop", [
        "Re-read these notes within 24 hours",
        "Turn the key terms into flashcards",
        "Do the assigned reading",
        "Write down one question for the seminar",
      ]),
    ],
  },

  {
    id: "cornell",
    name: "Cornell notes",
    icon: "template",
    category: "Notes",
    desc: "Cue column, note column, and a summary that earns its place.",
    accent: "#3d9b7a",
    blocks: () => [
      callout("📐", "The Cornell method: take notes on the right, write **cue questions** on the left afterwards, then cover the notes and answer the cues from memory.", "green"),
      table([
        ["Cue / question", "Notes"],
        ["", ""],
        ["", ""],
        ["", ""],
        ["", ""],
        ["", ""],
      ], { align: ["left", "left"], tint: "green" }),
      divider(),
      h2("Summary"),
      summary("Write this from memory, with the notes covered. If you cannot, you have not learned it yet."),
      checklist("Cornell discipline", [
        "Cues written after the lecture, not during",
        "Summary written without looking",
        "Anything I could not recall marked for revision",
      ]),
    ],
  },

  {
    id: "class",
    name: "Class notes",
    icon: "book",
    category: "Notes",
    desc: "One lesson: what was covered, what was set, what is due.",
    accent: "#d98b3a",
    blocks: () => [
      table([
        ["Subject", "Topic", "Date", "Homework due"],
        ["", "", "", ""],
      ], { align: ["left", "left", "center", "center"], tint: "orange" }),
      h2("What we covered"),
      li(""),
      li(""),
      li(""),
      h2("Worked examples"),
      toggle("Example 1", [p("**Question:** "), p("**Working:** "), p("**Answer:** ")]),
      toggle("Example 2", [p("**Question:** "), p("**Working:** "), p("**Answer:** ")]),
      h2("Things I found hard"),
      callout("⚠️", "Be specific. \"I did not get it\" is not a revision note.", "orange"),
      li(""),
      divider(),
      h2("Homework"),
      todo("Read the set pages"),
      todo("Attempt the practice questions"),
      todo("Ask about anything still unclear"),
    ],
  },

  {
    id: "textbook",
    name: "Textbook notes",
    icon: "book",
    category: "Notes",
    desc: "Read a chapter once, and never have to read it again.",
    accent: "#4c7fd4",
    blocks: () => [
      callout("📖", "Read the whole section first. Only then come back and fill this in — notes written while reading for the first time are a copy, not an understanding.", "blue"),
      table([
        ["Book", "Chapter", "Pages", "Read on"],
        ["", "", "", ""],
      ], { align: ["left", "left", "center", "center"] }),
      contents(),
      h2("Main argument"),
      quote("State the chapter's central claim in one sentence, in your own words."),
      h2("Key definitions"),
      table([
        ["Term", "Definition", "Why it matters"],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ]),
      h2("Evidence and examples"),
      num(""),
      num(""),
      h2("How this connects"),
      li("Links to: "),
      li("Contradicts: "),
      h2("My questions"),
      li(""),
      divider(),
      summary("The chapter in three sentences."),
      source("", "", "Book"),
    ],
  },

  {
    id: "meeting",
    name: "Group meeting",
    icon: "users",
    category: "Notes",
    desc: "Decisions, owners and dates — nothing lost to memory.",
    accent: "#7a63cf",
    blocks: () => [
      table([
        ["Date", "Time", "Where", "Chair"],
        ["", "", "", ""],
      ], { align: ["center", "center", "left", "left"], tint: "purple" }),
      h2("Attending"),
      li(""),
      li(""),
      h2("Agenda"),
      num(""),
      num(""),
      num("Any other business"),
      divider(),
      h2("Discussion"),
      p(""),
      h2("Decisions"),
      callout("✅", "Only write something here if the group actually agreed it. Everything else belongs under Discussion.", "green"),
      li(""),
      h2("Actions"),
      table([
        ["Action", "Owner", "Due"],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ], { align: ["left", "left", "center"] }),
      h2("Next meeting"),
      p(""),
    ],
  },

  {
    id: "study-guide",
    name: "Study guide",
    icon: "target",
    category: "Study",
    desc: "One topic, taken from first principles to exam-ready.",
    accent: "#2f8f6f",
    blocks: () => [
      callout("🎯", "Build this **once** per topic, then revise from it instead of from your lecture notes.", "green"),
      contents(),
      h2("Learning objectives"),
      objective("Explain … in my own words"),
      objective("Apply … to an unseen problem"),
      objective("Compare … with …"),
      divider(),
      h2("Core concepts"),
      h3("Concept 1"),
      p(""),
      toggle("Why it works", [p("")]),
      h3("Concept 2"),
      p(""),
      toggle("Why it works", [p("")]),
      h2("Definitions"),
      table([
        ["Term", "Definition", "Example"],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ], { tint: "green" }),
      h2("Formulae and rules"),
      b("equation", "", {}),
      p("When it applies: "),
      p("When it does not: "),
      h2("Common mistakes"),
      callout("⚠️", "Every mistake here should be one **you** have actually made. Generic warnings teach nothing.", "red"),
      li(""),
      li(""),
      h2("Exam-style questions"),
      toggle("Question 1", [p("**Question:** "), p("**Answer:** "), p("**Marks lost last time:** ")]),
      toggle("Question 2", [p("**Question:** "), p("**Answer:** "), p("**Marks lost last time:** ")]),
      divider(),
      summary("If I could only remember three things from this topic, they would be…"),
      checklist("Ready for the exam", [
        "I can state every definition without looking",
        "I can derive the key result",
        "I have done at least three past questions",
        "I have marked my own answers against the scheme",
      ]),
    ],
  },

  {
    id: "revision",
    name: "Exam revision",
    icon: "clock",
    category: "Study",
    desc: "A topic-by-topic confidence map and a plan that follows it.",
    accent: "#c9553f",
    blocks: () => [
      table([
        ["Exam", "Date", "Length", "Weighting"],
        ["", "", "", ""],
      ], { align: ["left", "center", "center", "center"], tint: "red" }),
      callout("🧭", "Rate every topic honestly before you plan anything. Revision time should follow the red rows, not the comfortable ones.", "red"),
      h2("Topic confidence"),
      table([
        ["Topic", "Confidence", "Last revised", "Next"],
        ["", "🔴 Low", "", ""],
        ["", "🟠 Medium", "", ""],
        ["", "🟢 High", "", ""],
      ], { align: ["left", "center", "center", "center"] }),
      divider(),
      h2("This week's plan"),
      table([
        ["Day", "Topic", "Method", "Done"],
        ["Mon", "", "Practice questions", "☐"],
        ["Tue", "", "Flashcards", "☐"],
        ["Wed", "", "Past paper", "☐"],
        ["Thu", "", "Weak areas", "☐"],
        ["Fri", "", "Mixed review", "☐"],
      ], { align: ["center", "left", "left", "center"] }),
      h2("Weak areas"),
      quote("What specifically goes wrong — the step, not the topic."),
      li(""),
      li(""),
      h2("Past papers done"),
      table([
        ["Paper", "Score", "Where I lost marks"],
        ["", "", ""],
        ["", "", ""],
      ], { align: ["left", "center", "left"] }),
      divider(),
      checklist("Final week", [
        "Every topic revised at least twice",
        "Two full papers under timed conditions",
        "Formula sheet memorised",
        "Weak areas re-tested and cleared",
        "Equipment, room and time confirmed",
      ]),
    ],
  },

  {
    id: "flashcard-source",
    name: "Term sheet",
    icon: "cards",
    category: "Study",
    desc: "Terms and definitions laid out ready to become cards.",
    accent: "#3f8ecb",
    blocks: () => [
      callout("🃏", "Fill the table, then use **Generate flashcards** from the page menu — each row becomes a card.", "blue"),
      h2("Terms"),
      table([
        ["Term", "Definition", "Example / cue"],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ], { tint: "blue" }),
      h2("Easily confused pairs"),
      table([
        ["This", "Not this", "The difference"],
        ["", "", ""],
        ["", "", ""],
      ]),
      h2("Notes"),
      li(""),
    ],
  },

  {
    id: "practice",
    name: "Practice questions",
    icon: "check_square",
    category: "Study",
    desc: "Attempt, mark, and record what actually went wrong.",
    accent: "#4e9a5c",
    blocks: () => [
      callout("✍️", "Answer with the toggle closed. Opening it before you have written something down turns practice into reading.", "green"),
      table([
        ["Topic", "Source", "Time allowed"],
        ["", "", ""],
      ], { align: ["left", "left", "center"] }),
      h2("Questions"),
      toggle("1.", [p("**My answer:** "), p("**Model answer:** "), p("**Marks:**  / ")]),
      toggle("2.", [p("**My answer:** "), p("**Model answer:** "), p("**Marks:**  / ")]),
      toggle("3.", [p("**My answer:** "), p("**Model answer:** "), p("**Marks:**  / ")]),
      divider(),
      h2("What I got wrong"),
      table([
        ["Question", "What went wrong", "Type of error", "Fix"],
        ["", "", "Careless", ""],
        ["", "", "Method", ""],
        ["", "", "Knowledge", ""],
      ]),
      summary("The single change that would gain me the most marks next time."),
    ],
  },

  {
    id: "planner",
    name: "Weekly study planner",
    icon: "calendar",
    category: "Planning",
    desc: "A week of revision with a review built into it.",
    accent: "#c78a2e",
    blocks: () => [
      callout("🗓️", "Plan the week on Sunday, review it on Friday. A plan you never review is a wish.", "yellow"),
      h2("This week's goal"),
      objective("By Friday I will be able to…"),
      h2("The week"),
      table([
        ["Day", "Morning", "Afternoon", "Evening", "Done"],
        ["Monday", "", "", "", "☐"],
        ["Tuesday", "", "", "", "☐"],
        ["Wednesday", "", "", "", "☐"],
        ["Thursday", "", "", "", "☐"],
        ["Friday", "", "", "", "☐"],
        ["Saturday", "", "", "", "☐"],
        ["Sunday", "", "", "", "☐"],
      ], { align: ["left", "left", "left", "left", "center"], tint: "yellow" }),
      h2("Deadlines this week"),
      todo(""),
      todo(""),
      divider(),
      h2("Friday review"),
      table([
        ["What I planned", "What I did", "Why the gap"],
        ["", "", ""],
      ]),
      summary("One thing to change about next week."),
    ],
  },

  {
    id: "assignment",
    name: "Assignment planner",
    icon: "check_square",
    category: "Planning",
    desc: "A brief broken into dated steps you can actually start.",
    accent: "#5a7fd6",
    blocks: () => [
      table([
        ["Assignment", "Module", "Word count", "Due"],
        ["", "", "", ""],
      ], { align: ["left", "left", "center", "center"] }),
      callout("📌", "Write the brief out in your own words first. Most lost marks are answers to a question that was not asked.", "blue"),
      h2("The brief, in my words"),
      quote("Paste the exact wording of the brief here."),
      h2("Marking criteria"),
      table([
        ["Criterion", "Weight", "What that means here"],
        ["", "", ""],
        ["", "", ""],
      ], { align: ["left", "center", "left"] }),
      divider(),
      h2("Plan"),
      table([
        ["Step", "Target date", "Done"],
        ["Read the brief and criteria", "", "☐"],
        ["Gather sources", "", "☐"],
        ["Outline", "", "☐"],
        ["First draft", "", "☐"],
        ["Edit for argument", "", "☐"],
        ["Proofread and reference", "", "☐"],
        ["Submit", "", "☐"],
      ], { align: ["left", "center", "center"] }),
      h2("Sources"),
      source("", "", "Article"),
      source("", "", "Book"),
      h2("Questions for my tutor"),
      li(""),
    ],
  },

  {
    id: "project",
    name: "Project tracker",
    icon: "board",
    category: "Planning",
    desc: "Scope, milestones, risks and the next action.",
    accent: "#3f9a92",
    blocks: () => [
      h2("Goal"),
      objective("This project is finished when…"),
      callout("🚧", "If you cannot name the next physical action, the project is stalled — not blocked.", "orange"),
      h2("Scope"),
      table([
        ["In scope", "Out of scope"],
        ["", ""],
        ["", ""],
      ]),
      h2("Milestones"),
      table([
        ["Milestone", "Owner", "Date", "Status"],
        ["", "", "", "Not started"],
        ["", "", "", "In progress"],
        ["", "", "", "Done"],
      ], { align: ["left", "left", "center", "center"], tint: "green" }),
      h2("Risks and blockers"),
      table([
        ["Risk", "Likelihood", "Impact", "Mitigation"],
        ["", "Low", "High", ""],
        ["", "", "", ""],
      ], { align: ["left", "center", "center", "left"] }),
      divider(),
      h2("Next actions"),
      todo(""),
      todo(""),
      h2("Decision log"),
      table([
        ["Date", "Decision", "Why"],
        ["", "", ""],
      ], { align: ["center", "left", "left"] }),
    ],
  },

  {
    id: "essay",
    name: "Essay plan",
    icon: "text",
    category: "Writing",
    desc: "Thesis, paragraphs and evidence before a word is written.",
    accent: "#8a5fc4",
    blocks: () => [
      callout("🖋️", "Do not start writing until the thesis line below survives being read aloud.", "purple"),
      h2("Question"),
      quote("Write the essay question out in full, exactly as it was set."),
      h2("Thesis"),
      summary("One sentence. It must be arguable — if nobody could disagree, it is not a thesis."),
      contents(),
      divider(),
      h2("Paragraph 1"),
      p("**Point:** "),
      p("**Evidence:** "),
      p("**Analysis:** "),
      p("**Link back to thesis:** "),
      h2("Paragraph 2"),
      p("**Point:** "),
      p("**Evidence:** "),
      p("**Analysis:** "),
      p("**Link back to thesis:** "),
      h2("Paragraph 3"),
      p("**Point:** "),
      p("**Evidence:** "),
      p("**Analysis:** "),
      p("**Link back to thesis:** "),
      h2("Counter-argument"),
      p("**The strongest objection:** "),
      p("**My response:** "),
      h2("Conclusion"),
      p(""),
      divider(),
      h2("Sources"),
      table([
        ["Source", "Used in", "Page / quote"],
        ["", "", ""],
        ["", "", ""],
      ]),
      checklist("Before submitting", [
        "Every paragraph answers the question",
        "Every claim has evidence",
        "Counter-argument addressed",
        "References formatted correctly",
        "Read aloud once, start to finish",
      ]),
    ],
  },

  {
    id: "reading",
    name: "Reading notes",
    icon: "book",
    category: "Writing",
    desc: "What the text says, and what you make of it.",
    accent: "#b06a8a",
    blocks: () => [
      table([
        ["Text", "Author", "Year", "Read on"],
        ["", "", "", ""],
      ], { align: ["left", "left", "center", "center"], tint: "pink" }),
      h2("Summary"),
      summary("What the text argues, without your opinion in it."),
      h2("Key passages"),
      quote("Paste the passage here."),
      p("*Why this matters:* "),
      quote("Paste the passage here."),
      p("*Why this matters:* "),
      divider(),
      h2("My response"),
      callout("💭", "Keep this section separate from the summary. Confusing what a text says with what you think of it is the most common essay error.", "purple"),
      p(""),
      h2("Vocabulary"),
      term("", ""),
      term("", ""),
      h2("Connections"),
      li("Agrees with: "),
      li("Argues against: "),
      source("", "", "Book"),
    ],
  },

  {
    id: "report",
    name: "Report",
    icon: "file",
    category: "Writing",
    desc: "A formal report with the sections marks are given for.",
    accent: "#4a6d9c",
    blocks: () => [
      contents(),
      h2("Executive summary"),
      summary("Written last, read first. What was done, what was found, what should happen."),
      h2("Introduction"),
      p(""),
      objective("This report sets out to…"),
      h2("Background"),
      p(""),
      h2("Method"),
      num(""),
      num(""),
      divider(),
      h2("Findings"),
      table([
        ["Finding", "Evidence", "Confidence"],
        ["", "", "High"],
        ["", "", "Medium"],
        ["", "", "Low"],
      ], { align: ["left", "left", "center"] }),
      h2("Discussion"),
      p(""),
      toggle("Limitations", [li(""), li("")]),
      h2("Recommendations"),
      num(""),
      num(""),
      h2("Conclusion"),
      p(""),
      divider(),
      h2("References"),
      source("", "", "Article"),
      source("", "", "Web"),
    ],
  },

  {
    id: "research",
    name: "Research notes",
    icon: "search",
    category: "Research",
    desc: "One card per source, then a synthesis across them.",
    accent: "#3d8bb0",
    blocks: () => [
      h2("Research question"),
      quote("Write the research question as a question, not a topic."),
      callout("🔍", "One source per toggle. Keeping them separate is what makes the synthesis at the bottom possible.", "blue"),
      contents(),
      divider(),
      h2("Sources"),
      toggle("Source 1", [
        p("**Reference:** "),
        p("**Central claim:** "),
        p("**Method:** "),
        p("**Useful quote:** "),
        quote("Quote worth keeping."),
        p("**How I would use it:** "),
      ]),
      toggle("Source 2", [
        p("**Reference:** "),
        p("**Central claim:** "),
        p("**Method:** "),
        p("**Useful quote:** "),
        quote("Quote worth keeping."),
        p("**How I would use it:** "),
      ]),
      toggle("Source 3", [
        p("**Reference:** "),
        p("**Central claim:** "),
        p("**Method:** "),
        p("**Useful quote:** "),
        quote("Quote worth keeping."),
        p("**How I would use it:** "),
      ]),
      divider(),
      h2("Synthesis"),
      table([
        ["Question", "Source 1", "Source 2", "Source 3"],
        ["Claim", "", "", ""],
        ["Evidence", "", "", ""],
        ["Weakness", "", "", ""],
      ], { tint: "blue" }),
      h2("Where they agree"),
      li(""),
      h2("Where they disagree"),
      li(""),
      h2("Gaps"),
      summary("What nobody I have read has answered yet."),
    ],
  },

  {
    id: "lab",
    name: "Lab report",
    icon: "template",
    category: "Research",
    desc: "Aim to conclusion, with errors accounted for.",
    accent: "#5c9a4f",
    blocks: () => [
      table([
        ["Experiment", "Date", "Partner", "Apparatus checked"],
        ["", "", "", "☐"],
      ], { align: ["left", "center", "left", "center"], tint: "green" }),
      h2("Aim"),
      objective("To determine…"),
      h2("Hypothesis"),
      quote("If … then … because …"),
      p("**Independent variable:** "),
      p("**Dependent variable:** "),
      p("**Controlled variables:** "),
      h2("Method"),
      num(""),
      num(""),
      num(""),
      callout("🥽", "Record what you actually did, not what the sheet said to do. The difference is usually where the error came from.", "orange"),
      divider(),
      h2("Results"),
      table([
        ["Trial", "Measurement", "Unit", "Uncertainty"],
        ["1", "", "", "±"],
        ["2", "", "", "±"],
        ["3", "", "", "±"],
        ["Mean", "", "", "±"],
      ], { align: ["center", "right", "center", "center"] }),
      b("chart", "", { kind: "scatter", title: "Results", xLabel: "x", yLabel: "y" }),
      h2("Analysis"),
      b("equation", "", {}),
      p(""),
      h2("Sources of error"),
      table([
        ["Error", "Type", "Effect on result", "How to reduce it"],
        ["", "Random", "", ""],
        ["", "Systematic", "", ""],
      ]),
      h2("Conclusion"),
      summary("Does the result support the hypothesis, and how confident can you be?"),
    ],
  },

  {
    id: "literature",
    name: "Literature review",
    icon: "book",
    category: "Research",
    desc: "Themes, method comparison and the gap you are filling.",
    accent: "#7466c0",
    blocks: () => [
      h2("Scope"),
      p("**Field:** "),
      p("**Years covered:** "),
      p("**Inclusion criteria:** "),
      contents(),
      divider(),
      h2("Themes"),
      h3("Theme 1"),
      p("**What the field agrees on:** "),
      p("**Where it splits:** "),
      toggle("Key studies", [li(""), li("")]),
      h3("Theme 2"),
      p("**What the field agrees on:** "),
      p("**Where it splits:** "),
      toggle("Key studies", [li(""), li("")]),
      divider(),
      h2("Method comparison"),
      table([
        ["Study", "Year", "Method", "Sample", "Finding"],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
        ["", "", "", "", ""],
      ], { align: ["left", "center", "left", "center", "left"], tint: "purple" }),
      h2("Gaps and next steps"),
      callout("🧩", "The gap is your contribution. State it as something that is **not yet known**, not as something not yet written about.", "purple"),
      li(""),
      li(""),
      summary("The one-paragraph version of this review."),
      source("", "", "Paper"),
    ],
  },
];

export const templateById = (id) => TEMPLATES.find((template) => template.id === id) || null;

/* Blocks arrive as a plain tree; the store needs stable ids before it can
   write parent links, so they are minted here rather than server-side. */
export function templateBlocks(template) {
  const id = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  const walk = (list) => list.map((block) => ({
    id: id(),
    type: block.type,
    text: block.text || [],
    props: block.props || {},
    children: walk(block.children || []),
  }));
  return walk(template.blocks());
}

/* ---------------------------------------------------------------------------------------------------------------
   Redesigned layouts.

   The first catalogue was a set of outlines. These are finished pages: a banner that says what the page is for, the
   things you fill in side by side (columns), real checklists you can tick (circle to-dos, not "☐" in a table), the
   guidance folded into toggles so it never crowds the page, and a review at the end that closes the loop. Each also
   ships an icon and a cover, so a new page does not arrive looking like a blank sheet with a title.
   --------------------------------------------------------------------------------------------------------------- */
const columns = (...cols) => b("columns", "", {}, cols.map((children) => b("column", "", {}, children)));
const how = (text) => toggle("How to use this page", [p(text)]);
const gradient = (a, c) => `linear-gradient(120deg, ${a} 0%, ${c} 100%)`;

const UPGRADES = {
  planner: {
    blocks: () => [
      callout("🗓️", "**Plan on Sunday, review on Friday.** A week you never look back on teaches you nothing about how to plan the next one.", "yellow"),
      columns(
        [h3("🎯 This week's goal"), objective("By Friday I will be able to…"), p("")],
        [h3("📌 Must not slip"), todo(""), todo(""), todo("")],
      ),
      h2("The week"),
      table([
        ["Day", "Morning", "Afternoon", "Evening"],
        ["Monday", "", "", ""], ["Tuesday", "", "", ""], ["Wednesday", "", "", ""], ["Thursday", "", "", ""],
        ["Friday", "", "", ""], ["Saturday", "", "", ""], ["Sunday", "", "", ""],
      ], { align: ["left", "left", "left", "left"], tint: "yellow" }),
      h2("Deadlines and exams"),
      table([["What", "Module", "Due", "Hours I need"], ["", "", "", ""], ["", "", "", ""]], { align: ["left", "left", "center", "center"] }),
      h2("Daily wins"),
      columns(
        [h3("Mon – Wed"), todo(""), todo(""), todo("")],
        [h3("Thu – Sun"), todo(""), todo(""), todo("")],
      ),
      divider(),
      h2("Friday review"),
      columns(
        [h3("✅ What worked"), li(""), li("")],
        [h3("🔁 What to change"), li(""), li("")],
      ),
      summary("The one thing I will do differently next week."),
      how("Fill the goal first, then block the deadlines into the grid, then add only what still fits. Leave the review until Friday: it is the part that makes next week's plan better."),
    ],
  },
  assignment: {
    blocks: () => [
      callout("📌", "Write the brief in your own words **before** you read anything else. Most lost marks answer a question that was not asked.", "blue"),
      table([["Assignment", "Module", "Word count", "Due"], ["", "", "", ""]], { align: ["left", "left", "center", "center"], tint: "blue" }),
      columns(
        [h3("📝 The brief, in my words"), p("")],
        [h3("🎓 What earns the marks"), table([["Criterion", "Weight"], ["", ""], ["", ""], ["", ""]], { align: ["left", "center"] })],
      ),
      quote("Paste the exact wording of the brief here so you can check your answer against it later."),
      h2("Plan"),
      todo("Read the brief and the marking criteria"),
      todo("Gather and skim sources"),
      todo("Outline the argument"),
      todo("Write the first draft"),
      todo("Edit for argument, then for style"),
      todo("Proofread and check references"),
      todo("Submit — and keep the receipt"),
      h2("Sources"),
      source("", "", "Article"), source("", "", "Book"),
      toggle("Questions for my tutor", [li(""), li("")]),
      toggle("Pre-submission check", [todo("Answers every part of the brief"), todo("Within the word count"), todo("Every claim has a source"), todo("References formatted correctly")]),
      how("Fill the table at the top, rewrite the brief, then work down the plan. Tick each step as it is done so the page always shows what is left."),
    ],
  },
  project: {
    blocks: () => [
      callout("🚀", "A project is finished when you can say so. **Write the finish line first**, then everything else is a route to it.", "green"),
      columns(
        [h3("🏁 Done means"), objective("This project is finished when…")],
        [h3("📅 Key dates"), table([["Start", "Review", "Finish"], ["", "", ""]], { align: ["center", "center", "center"] })],
      ),
      h2("Scope"),
      columns(
        [h3("In"), li(""), li(""), li("")],
        [h3("Out"), li(""), li(""), li("")],
      ),
      h2("Milestones"),
      table([
        ["Milestone", "Owner", "Date", "Status"],
        ["", "", "", "Not started"],
        ["", "", "", "In progress"],
        ["", "", "", "Done"],
      ], { align: ["left", "left", "center", "center"], tint: "green" }),
      h2("Next actions"),
      callout("🚧", "If you cannot name the next physical action, the project is **stalled**, not blocked.", "orange"),
      todo(""), todo(""), todo(""),
      h2("Risks"),
      table([["Risk", "Likelihood", "Impact", "What I will do"], ["", "Low", "High", ""], ["", "", "", ""]], { align: ["left", "center", "center", "left"], tint: "red" }),
      toggle("Decision log", [table([["Date", "Decision", "Why"], ["", "", ""]], { align: ["center", "left", "left"] })]),
      how("Fill the finish line and scope first. Keep milestones short; keep the next actions list to three. Move finished actions out as you go."),
    ],
  },
  meeting: {
    blocks: () => [
      table([["Date", "Time", "Where", "Chair", "Notes by"], ["", "", "", "", ""]], { align: ["center", "center", "left", "left", "left"], tint: "purple" }),
      columns(
        [h3("👥 Attending"), li(""), li(""), li("")],
        [h3("🗒️ Agenda"), num(""), num(""), num("Any other business")],
      ),
      divider(),
      h2("Discussion"),
      toggle("Item 1", [p("")]),
      toggle("Item 2", [p("")]),
      h2("Decisions"),
      callout("✅", "Only record what the group **actually agreed**. Everything else stays under Discussion.", "green"),
      li(""), li(""),
      h2("Actions"),
      table([["Action", "Owner", "Due", "Status"], ["", "", "", "Open"], ["", "", "", "Open"], ["", "", "", "Open"]], { align: ["left", "left", "center", "center"], tint: "purple" }),
      columns(
        [h3("📅 Next meeting"), p("")],
        [h3("📨 To send afterwards"), todo("Share these notes"), todo("Chase the actions")],
      ),
      how("Fill the header before the meeting, write decisions as they are made, and give every action an owner and a date before everyone leaves."),
    ],
  },
  revision: {
    blocks: () => [
      callout("🎯", "Revision is **recall**, not re-reading. Every block below makes you pull something out of your head.", "red"),
      columns(
        [h3("📚 Exam"), table([["Module", "Date", "Weight"], ["", "", ""]], { align: ["left", "center", "center"] })],
        [h3("⏳ Time I have"), p("Days left: "), p("Hours I can give it: ")],
      ),
      h2("Topics"),
      table([["Topic", "Confidence (1–5)", "Revised", "Next review"], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""]], { align: ["left", "center", "center", "center"], tint: "red" }),
      h2("Spaced review"),
      columns(
        [h3("Day 1"), todo("Learn it"), todo("Self-test")],
        [h3("Day 3"), todo("Recall without notes"), todo("Fix gaps")],
        [h3("Day 7"), todo("Past paper question"), todo("Mark it")],
      ),
      h2("Past papers"),
      table([["Paper", "Score", "Marks lost on", "Fixed?"], ["", "", "", ""], ["", "", "", ""]], { align: ["left", "center", "left", "center"] }),
      checklist("Ready for the exam", ["I can explain every topic without notes", "I have done at least three timed past papers", "I know where I lose marks and have fixed it", "Everything I need for the day is packed"]),
      how("List every topic with an honest confidence score, revise the lowest first, and book each review on the day shown. Update the scores after every self-test."),
    ],
  },
  lecture: {
    blocks: () => [
      callout("🎙️", "Spend **five minutes before** the lecture on the first two sections. Priming is worth an hour of re-reading.", "purple"),
      table([["Module", "Lecturer", "Date", "Week"], ["", "", "", ""]], { align: ["left", "left", "center", "center"], tint: "purple" }),
      columns(
        [h3("🔭 Before"), objective("By the end I should be able to…"), li("What is this lecture about, in one sentence?")],
        [h3("📖 Read first"), todo("Skim the slides or reading"), todo("Note three questions")],
      ),
      h2("During"),
      p(""),
      toggle("Key terms", [term("", "")]),
      toggle("Examples worth keeping", [p("")]),
      divider(),
      h2("After"),
      columns(
        [h3("✍️ In my own words"), p("")],
        [h3("❓ Still unclear"), li(""), li("")],
      ),
      summary("The one idea from today I would teach someone else."),
      checklist("Close the loop", ["Rewrite the three main ideas from memory", "Turn the key terms into flashcards", "Book time to ask what is still unclear"]),
    ],
  },
};

const IDENTITY = {
  blank: ["📄", ["#eef0f4", "#f7f8fa"]], lecture: ["🎙️", ["#e3e6fd", "#f1f2fe"]], cornell: ["🧭", ["#e3ecf9", "#f1f6fc"]],
  class: ["🎓", ["#e6edfb", "#f3f6fd"]], textbook: ["📘", ["#e1ecf8", "#f0f6fc"]], meeting: ["👥", ["#ece3f7", "#f6f1fb"]],
  "study-guide": ["🎯", ["#dff0e8", "#eff8f3"]], revision: ["🧠", ["#f9e3e0", "#fcf1ef"]], "flashcard-source": ["🗂️", ["#e3f0f2", "#f1f8f9"]],
  practice: ["✏️", ["#f5e9d9", "#fbf4ea"]], planner: ["🗓️", ["#f7ecd2", "#fcf6e6"]], assignment: ["📌", ["#e0e8f8", "#f0f4fc"]],
  project: ["🚀", ["#dcefea", "#eef8f5"]], essay: ["🖋️", ["#efe5dc", "#f7f2ed"]], reading: ["📖", ["#e8eedf", "#f3f7ee"]],
  report: ["📊", ["#e3e9f2", "#f1f4f9"]], research: ["🔬", ["#e0eef0", "#eff7f8"]], lab: ["🧪", ["#e5eadf", "#f2f5ee"]], literature: ["📚", ["#ece2ea", "#f6f0f5"]],
};
for (const template of TEMPLATES) {
  const upgrade = UPGRADES[template.id];
  if (upgrade) Object.assign(template, upgrade);
  const [emoji, [from, to]] = IDENTITY[template.id] || ["📄", ["#eef0f4", "#f7f8fa"]];
  template.emoji = emoji;
  template.cover = template.id === "blank" ? null : gradient(from, to);
}


/* ---------------------------------------------------------------------------------------------------------------
   The second catalogue: working documents, formal and restrained. These are pages people actually keep open — they
   open with guidance written as real prompts and a first example row, so a new page reads as a finished document
   rather than empty boxes. Colour is left to the page: tables and callouts use the neutral tint.
   --------------------------------------------------------------------------------------------------------------- */
const note = (text) => callout("💡", text, "default");
const grid = (head, rows, align) => table([head, ...rows], { align: align || head.map(() => "left"), tint: "default" });
const blank = (n, make = li) => Array.from({ length: n }, () => make(""));
const meta = (...pairs) => grid(pairs.map(([k]) => k), [pairs.map(([, v]) => v || "")]);

const EXTRA = [
  /* ---------------- Work ---------------- */
  { id: "agenda", name: "Meeting agenda", emoji: "🗓️", category: "Work", icon: "page", desc: "A timed agenda with owners, sent before the meeting starts.", blocks: () => [
    meta(["Date"], ["Time"], ["Location / link"], ["Facilitator"]),
    h2("Purpose"), p("In one sentence: what must be true when this meeting ends?"),
    h2("Agenda"),
    grid(["Time", "Topic", "Owner", "Outcome needed"], [["5 min", "Context and goal", "", "Shared understanding"], ["20 min", "", "", "Decision"], ["10 min", "", "", "Actions agreed"]], ["left", "left", "left", "left"]),
    h2("Pre-reads"), li("Link or attach anything people should read first"), li(""),
    h2("Decisions"), li(""), h2("Actions"), grid(["Action", "Owner", "Due"], [["", "", ""], ["", "", ""]]),
    how("Send it the day before. Every item needs an owner and an outcome — if you cannot name the outcome, it probably does not need a meeting."),
  ]},
  { id: "one-on-one", name: "1:1 meeting", emoji: "🤝", category: "Work", icon: "users", desc: "A running log for a recurring one-to-one: wins, blockers and follow-ups.", blocks: () => [
    meta(["With"], ["Date"], ["Cadence"]),
    columns([h3("Their topics"), li(""), li("")], [h3("My topics"), li(""), li("")]),
    h2("How are things going?"), p("Workload, energy, anything in the way."),
    h2("Wins since last time"), li(""), h2("Blockers"), li(""),
    h2("Feedback"), columns([h3("For them"), p("")], [h3("For me"), p("")]),
    h2("Follow-ups"), todo(""), todo(""),
    toggle("Career and growth", [p("What do they want to learn or take on next?")]),
  ]},
  { id: "project-brief", name: "Project brief", emoji: "📋", category: "Work", icon: "page", desc: "Problem, goals, scope, owners and risks on a single page.", blocks: () => [
    meta(["Project"], ["Owner"], ["Sponsor"], ["Start"], ["Target date"]),
    h2("Problem"), p("What is wrong or missing today, and for whom?"),
    h2("Goals"), num("The outcome we want, measurable where possible"), num(""),
    h2("Non-goals"), li("What this project deliberately will not do"),
    h2("Scope and deliverables"), grid(["Deliverable", "Owner", "Due", "Status"], [["", "", "", "Not started"], ["", "", "", "Not started"]], ["left", "left", "center", "center"]),
    h2("Success measures"), grid(["Measure", "Today", "Target"], [["", "", ""]], ["left", "center", "center"]),
    h2("Risks and dependencies"), grid(["Risk", "Impact", "Mitigation"], [["", "Medium", ""]]),
    h2("Stakeholders"), grid(["Name", "Role", "Needs from this project"], [["", "", ""]]),
  ]},
  { id: "decision-record", name: "Decision record", emoji: "⚖️", category: "Work", icon: "page", desc: "Capture the options, the choice and the reasoning so it is never relitigated.", blocks: () => [
    meta(["Decision"], ["Date"], ["Decider"], ["Status"]),
    h2("Context"), p("What forced this decision now?"),
    h2("Options considered"),
    grid(["Option", "For", "Against", "Cost / effort"], [["A", "", "", ""], ["B", "", "", ""], ["Do nothing", "", "", ""]]),
    h2("Decision"), callout("✅", "State the choice in one plain sentence.", "default"),
    h2("Why"), p(""), h2("Consequences"), li("What changes because of this"), li("What we accept giving up"),
    h2("Review date"), p("When will we check this was right?"),
  ]},
  { id: "status-report", name: "Weekly status report", emoji: "📈", category: "Work", icon: "page", desc: "What shipped, what is next and what needs help — readable in a minute.", blocks: () => [
    meta(["Week of"], ["Author"], ["Overall"]),
    callout("📌", "**Summary:** one sentence a busy reader can stop at.", "default"),
    h2("Progress this week"), li(""), li(""),
    h2("Planned for next week"), li(""), li(""),
    h2("Metrics"), grid(["Metric", "Last week", "This week", "Target"], [["", "", "", ""]], ["left", "center", "center", "center"]),
    h2("Risks and blockers"), grid(["Issue", "Owner", "Help needed"], [["", "", ""]]),
    h2("Decisions needed"), todo(""),
  ]},
  { id: "okrs", name: "Goals and OKRs", emoji: "🎯", category: "Work", icon: "page", desc: "Objectives with measurable key results and honest weekly check-ins.", blocks: () => [
    meta(["Period"], ["Team / owner"]),
    h2("Objective 1"), p("An inspiring, qualitative outcome."),
    grid(["Key result", "Start", "Target", "Now", "Confidence"], [["", "0", "", "", ""], ["", "0", "", "", ""], ["", "0", "", "", ""]], ["left", "center", "center", "center", "center"]),
    h2("Objective 2"), p(""), grid(["Key result", "Start", "Target", "Now", "Confidence"], [["", "0", "", "", ""], ["", "0", "", "", ""]], ["left", "center", "center", "center", "center"]),
    h2("Weekly check-ins"), toggle("Week 1", [p("What moved? What is at risk?")]), toggle("Week 2", [p("")]),
    h2("Retrospective"), columns([h3("What worked"), li("")], [h3("What to change"), li("")]),
  ]},
  { id: "retrospective", name: "Retrospective", emoji: "🔁", category: "Work", icon: "page", desc: "Look back as a team and leave with a few changes you will really make.", blocks: () => [
    meta(["Period"], ["Facilitator"], ["Attendees"]),
    columns([h3("Went well"), li(""), li("")], [h3("Did not go well"), li(""), li("")], [h3("Ideas"), li(""), li("")]),
    h2("Themes"), p("Group what came up. What is the pattern?"),
    h2("Commitments"), grid(["Change we will make", "Owner", "By when"], [["", "", ""], ["", "", ""]]),
    h2("Last time's commitments"), todo(""), todo(""),
  ]},
  { id: "client-call", name: "Client call notes", emoji: "📞", category: "Work", icon: "page", desc: "Needs, objections, commitments and the follow-up email, in order.", blocks: () => [
    meta(["Client"], ["Contact"], ["Date"], ["Stage"]),
    h2("Their situation"), p("What are they trying to achieve, and what is in the way?"),
    h2("What they asked for"), li(""), h2("Objections and concerns"), li(""),
    h2("What we promised"), grid(["Commitment", "Owner", "Date"], [["", "", ""]]),
    h2("Next step"), callout("➡️", "Agree the next meeting before the call ends.", "default"),
    toggle("Follow-up email draft", [p("Thanks for your time today. To recap…")]),
  ]},
  { id: "proposal", name: "Proposal", emoji: "📑", category: "Work", icon: "page", desc: "A persuasive, structured proposal from problem to price.", blocks: () => [
    meta(["Prepared for"], ["Prepared by"], ["Date"], ["Valid until"]),
    h2("Summary"), p("The problem, our approach and the outcome, in three sentences."),
    h2("The problem"), p(""), h2("Our approach"), num(""), num(""), num(""),
    h2("Timeline"), grid(["Phase", "What happens", "Duration"], [["1", "", ""], ["2", "", ""], ["3", "", ""]], ["center", "left", "center"]),
    h2("Investment"), grid(["Item", "Detail", "Cost"], [["", "", ""], ["", "", ""], ["Total", "", ""]], ["left", "left", "right"]),
    h2("Why us"), li(""), h2("Next steps"), todo("Approve proposal"), todo("Sign agreement"), todo("Kick-off call"),
  ]},
  { id: "sop", name: "Process / SOP", emoji: "🧾", category: "Work", icon: "page", desc: "A repeatable procedure anyone can follow without asking.", blocks: () => [
    meta(["Process"], ["Owner"], ["Last reviewed"], ["Version"]),
    h2("Purpose"), p("Why this process exists and when to use it."),
    h2("Before you start"), todo("Access you need"), todo("Information to have to hand"),
    h2("Steps"), num(""), num(""), num(""),
    callout("⚠️", "Name the step people most often get wrong.", "default"),
    h2("Done looks like"), li(""), h2("If something goes wrong"), p("Who to contact and what to try first."),
    toggle("Change log", [grid(["Date", "Change", "By"], [["", "", ""]])]),
  ]},
  { id: "prd", name: "Product requirements", emoji: "🧩", category: "Work", icon: "page", desc: "Problem, users, requirements and open questions for a feature.", blocks: () => [
    meta(["Feature"], ["Owner"], ["Status"], ["Target release"]),
    h2("Background"), p("Why now? What evidence do we have?"),
    h2("Users and jobs to be done"), grid(["User", "Job they are trying to do", "Today's pain"], [["", "", ""]]),
    h2("Requirements"), grid(["#", "Requirement", "Priority"], [["1", "", "Must"], ["2", "", "Should"], ["3", "", "Could"]], ["center", "left", "center"]),
    h2("Out of scope"), li(""), h2("Success metrics"), li(""),
    h2("Open questions"), grid(["Question", "Owner", "Answer"], [["", "", ""]]),
    h2("Launch plan"), todo("Design signed off"), todo("Build complete"), todo("QA passed"), todo("Announce"),
  ]},
  { id: "interview-scorecard", name: "Interview scorecard", emoji: "🧑‍💼", category: "Work", icon: "page", desc: "Score every candidate against the same criteria, then decide.", blocks: () => [
    meta(["Candidate"], ["Role"], ["Interviewer"], ["Date"]),
    h2("Criteria"), grid(["Criterion", "Score (1–5)", "Evidence"], [["Role skills", "", ""], ["Problem solving", "", ""], ["Communication", "", ""], ["Values / team fit", "", ""]], ["left", "center", "left"]),
    h2("Strengths"), li(""), h2("Concerns"), li(""),
    h2("Recommendation"), callout("🗳️", "Strong yes · Yes · No · Strong no — then one sentence of reasoning.", "default"),
  ]},
  { id: "job-tracker", name: "Job application tracker", emoji: "🧭", category: "Work", icon: "table", desc: "Every application, contact and next step in one table.", blocks: () => [
    note("Update this table the moment anything changes — it is only useful if it is current."),
    grid(["Company", "Role", "Applied", "Contact", "Stage", "Next step"], [["", "", "", "", "Applied", ""], ["", "", "", "", "Applied", ""], ["", "", "", "", "Applied", ""]], ["left", "left", "center", "left", "center", "left"]),
    h2("Interview prep"), todo("Research the company"), todo("Prepare three stories"), todo("Questions to ask them"),
    h2("Follow-ups"), todo(""),
  ]},

  /* ---------------- Study ---------------- */
  { id: "seminar", name: "Seminar notes", emoji: "🗣️", category: "Study", icon: "page", desc: "Prepare, contribute and capture the discussion.", blocks: () => [
    meta(["Module"], ["Topic"], ["Date"], ["Reading"]),
    h2("Preparation"), li("Key argument of the reading"), li("One thing I disagree with"), li("One question to ask"),
    h2("Discussion"), p(""), h2("Points I want to remember"), li(""),
    h2("After"), summary("What did the group conclude, and what is still open?"),
  ]},
  { id: "timetable", name: "Study timetable", emoji: "⏱️", category: "Study", icon: "table", desc: "A realistic weekly timetable with fixed commitments and study blocks.", blocks: () => [
    note("Block fixed commitments first, then place study around them. Leave one evening empty."),
    grid(["Time", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [["08:00", "", "", "", "", "", "", ""], ["10:00", "", "", "", "", "", "", ""], ["12:00", "", "", "", "", "", "", ""], ["14:00", "", "", "", "", "", "", ""], ["16:00", "", "", "", "", "", "", ""], ["18:00", "", "", "", "", "", "", ""]], ["left", "center", "center", "center", "center", "center", "center", "center"]),
    h2("Weekly targets"), todo("Hours of focused study"), todo("Past paper attempts"),
  ]},
  { id: "glossary", name: "Glossary", emoji: "🔤", category: "Study", icon: "page", desc: "Terms, definitions and examples, ready to turn into flashcards.", blocks: () => [
    note("One row per term. Write the definition in your own words, then add an example."),
    grid(["Term", "Definition", "Example", "Related"], [["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""]]),
  ]},
  { id: "mistake-log", name: "Mistake log", emoji: "🧯", category: "Study", icon: "table", desc: "Track what you got wrong, why, and the fix — the fastest way to improve.", blocks: () => [
    grid(["Date", "Question / topic", "What I did", "Why it was wrong", "The fix"], [["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]]),
    h2("Patterns"), p("After ten entries: what keeps happening?"),
  ]},
  { id: "thesis-tracker", name: "Thesis tracker", emoji: "🎓", category: "Study", icon: "page", desc: "Chapters, word counts, supervisor feedback and deadlines.", blocks: () => [
    meta(["Title"], ["Supervisor"], ["Deadline"]),
    h2("Chapters"), grid(["Chapter", "Target words", "Written", "Status", "Feedback"], [["Introduction", "", "", "Not started", ""], ["Literature review", "", "", "Not started", ""], ["Methods", "", "", "Not started", ""], ["Results", "", "", "Not started", ""], ["Discussion", "", "", "Not started", ""]], ["left", "center", "center", "center", "left"]),
    h2("Supervisor meetings"), toggle("Meeting 1", [p("Agreed actions:")]),
    h2("Milestones"), todo("Proposal approved"), todo("Ethics approved"), todo("Draft submitted"), todo("Final submission"),
  ]},
  { id: "citations", name: "Citation log", emoji: "🔖", category: "Research", icon: "table", desc: "Every source with its reference, quote and why it matters.", blocks: () => [
    grid(["Source", "Reference", "Key point / quote", "Page", "Used in"], [["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]]),
  ]},

  /* ---------------- Planning ---------------- */
  { id: "weekly-review", name: "Weekly review", emoji: "🧹", category: "Planning", icon: "page", desc: "Close the week, clear the inbox and set up the next one.", blocks: () => [
    meta(["Week of"]),
    h2("Look back"), columns([h3("Wins"), li(""), li("")], [h3("Misses"), li(""), li("")]),
    h2("Clear the decks"), todo("Empty inboxes"), todo("Review open tasks"), todo("Check the calendar for next week"),
    h2("Next week"), num("Top priority"), num(""), num(""),
    summary("One lesson from this week."),
  ]},
  { id: "daily-plan", name: "Daily plan", emoji: "☀️", category: "Planning", icon: "page", desc: "Three priorities, a time-blocked day and an end-of-day shutdown.", blocks: () => [
    meta(["Date"], ["Energy (1–5)"]),
    h2("Top three"), todo(""), todo(""), todo(""),
    h2("Schedule"), grid(["Time", "Plan", "Actual"], [["09:00", "", ""], ["11:00", "", ""], ["13:00", "", ""], ["15:00", "", ""], ["17:00", "", ""]], ["left", "left", "left"]),
    h2("Shutdown"), todo("Capture loose ends"), todo("Choose tomorrow's top three"),
  ]},
  { id: "goal-setting", name: "Goal setting", emoji: "🧗", category: "Planning", icon: "page", desc: "Turn an ambition into a measurable goal with milestones and habits.", blocks: () => [
    h2("The goal"), objective("In one sentence, specific and measurable"),
    h2("Why it matters"), p(""),
    h2("Milestones"), grid(["Milestone", "Date", "Done"], [["", "", ""], ["", "", ""], ["", "", ""]], ["left", "center", "center"]),
    h2("Weekly habits that get me there"), todo(""), todo(""),
    h2("Obstacles and plans"), grid(["If this happens…", "I will…"], [["", ""]]),
  ]},
  { id: "budget", name: "Monthly budget", emoji: "💷", category: "Planning", icon: "table", desc: "Income, fixed costs, spending and savings for the month.", blocks: () => [
    meta(["Month"], ["Total income"]),
    h2("Fixed costs"), grid(["Item", "Planned", "Actual"], [["Rent", "", ""], ["Bills", "", ""], ["Transport", "", ""]], ["left", "right", "right"]),
    h2("Spending"), grid(["Category", "Planned", "Actual"], [["Food", "", ""], ["Going out", "", ""], ["Other", "", ""]], ["left", "right", "right"]),
    h2("Savings"), grid(["Goal", "Target", "Saved"], [["", "", ""]], ["left", "right", "right"]),
    summary("What I will change next month."),
  ]},
  { id: "content-calendar", name: "Content calendar", emoji: "🗂️", category: "Planning", icon: "table", desc: "Plan what you publish, where and when.", blocks: () => [
    grid(["Date", "Topic", "Format", "Channel", "Owner", "Status"], [["", "", "", "", "", "Idea"], ["", "", "", "", "", "Idea"], ["", "", "", "", "", "Idea"]], ["center", "left", "left", "left", "left", "center"]),
    h2("Ideas backlog"), li(""), li(""),
  ]},

  /* ---------------- Writing ---------------- */
  { id: "blog-post", name: "Blog post", emoji: "✍️", category: "Writing", icon: "page", desc: "From angle to outline to draft to publish checklist.", blocks: () => [
    meta(["Working title"], ["Audience"], ["Target length"]),
    h2("The angle"), p("What will the reader know or be able to do after reading?"),
    h2("Outline"), num("Hook"), num(""), num(""), num("Conclusion and call to action"),
    h2("Draft"), p(""),
    h2("Before publishing"), todo("Headline tested against three alternatives"), todo("Facts and links checked"), todo("Read aloud once"), todo("Image and metadata added"),
  ]},
  { id: "cover-letter", name: "Cover letter", emoji: "✉️", category: "Writing", icon: "page", desc: "A tight three-paragraph letter with a checklist to tailor it.", blocks: () => [
    meta(["Role"], ["Company"], ["Contact"]),
    h2("Opening"), p("Why this role at this company, in two sentences."),
    h2("Evidence"), p("Two achievements that match what they asked for, with numbers."),
    h2("Close"), p("What you want to happen next."),
    checklist("Tailoring", ["Names the company and role", "Mirrors the job description's language", "Under one page", "Proofread by someone else"]),
  ]},

  /* ---------------- Research ---------------- */
  { id: "experiment-log", name: "Experiment log", emoji: "🧫", category: "Research", icon: "page", desc: "Hypothesis, method, results and what you will try next.", blocks: () => [
    meta(["Experiment"], ["Date"], ["Owner"]),
    h2("Hypothesis"), p("If we change X, then Y will happen, because Z."),
    h2("Method"), num(""), num(""), h2("Variables"), grid(["Variable", "Type", "Value"], [["", "Independent", ""], ["", "Dependent", ""], ["", "Controlled", ""]]),
    h2("Results"), p(""), h2("Interpretation"), p("Did the result support the hypothesis? What else could explain it?"),
    h2("Next"), todo(""),
  ]},
  { id: "user-interview", name: "User interview", emoji: "🎙️", category: "Research", icon: "page", desc: "A discussion guide and a place for verbatim quotes and insights.", blocks: () => [
    meta(["Participant"], ["Date"], ["Interviewer"]),
    h2("Warm-up"), li("Tell me about your role"), h2("Core questions"), num("Walk me through the last time you…"), num("What was hardest about it?"), num("What did you do instead?"),
    h2("Notable quotes"), quote("Paste verbatim quotes here."),
    h2("Insights"), grid(["Observation", "Why it matters", "Confidence"], [["", "", ""]]),
  ]},
  { id: "swot", name: "SWOT analysis", emoji: "🧭", category: "Research", icon: "page", desc: "Strengths, weaknesses, opportunities and threats, with actions.", blocks: () => [
    columns([h3("Strengths"), li(""), li("")], [h3("Weaknesses"), li(""), li("")]),
    columns([h3("Opportunities"), li(""), li("")], [h3("Threats"), li(""), li("")]),
    h2("So what?"), grid(["Action", "Addresses", "Owner"], [["", "", ""]]),
  ]},
  { id: "competitor-analysis", name: "Competitor analysis", emoji: "🔍", category: "Research", icon: "table", desc: "Compare alternatives side by side and find the gap.", blocks: () => [
    grid(["", "Us", "Competitor A", "Competitor B"], [["Target customer", "", "", ""], ["Pricing", "", "", ""], ["Strengths", "", "", ""], ["Weaknesses", "", "", ""], ["Differentiator", "", "", ""]]),
    h2("Where is the gap?"), p(""),
  ]},

  /* ---------------- Personal ---------------- */
  { id: "journal", name: "Daily journal", emoji: "📔", category: "Personal", icon: "page", desc: "A calm daily page: gratitude, highlights and reflection.", blocks: () => [
    meta(["Date"], ["Mood"]),
    h2("Three things I am grateful for"), num(""), num(""), num(""),
    h2("Highlight of the day"), p(""), h2("What I learned"), p(""), h2("Tomorrow"), todo("")
  ]},
  { id: "habit-tracker", name: "Habit tracker", emoji: "✅", category: "Personal", icon: "table", desc: "Seven days, every habit, at a glance.", blocks: () => [
    grid(["Habit", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], [["", "", "", "", "", "", "", ""], ["", "", "", "", "", "", "", ""], ["", "", "", "", "", "", "", ""]], ["left", "center", "center", "center", "center", "center", "center", "center"]),
    note("Mark a day with ✓. Never miss twice."), summary("What made the good days easy?"),
  ]},
  { id: "trip", name: "Trip itinerary", emoji: "🧳", category: "Personal", icon: "page", desc: "Bookings, day-by-day plan and a packing list.", blocks: () => [
    meta(["Destination"], ["Dates"], ["Travellers"]),
    h2("Bookings"), grid(["What", "Reference", "Date / time", "Cost"], [["Flights", "", "", ""], ["Stay", "", "", ""]]),
    h2("Day by day"), toggle("Day 1", [li("Morning"), li("Afternoon"), li("Evening")]), toggle("Day 2", [li("")]),
    h2("Packing"), todo("Passport and documents"), todo("Chargers"), todo("Medication"),
  ]},
  { id: "workout-log", name: "Workout log", emoji: "🏋️", category: "Personal", icon: "table", desc: "Sets, reps and weight, session by session.", blocks: () => [
    meta(["Date"], ["Focus"]),
    grid(["Exercise", "Set 1", "Set 2", "Set 3", "Notes"], [["", "", "", "", ""], ["", "", "", "", ""], ["", "", "", "", ""]], ["left", "center", "center", "center", "left"]),
    summary("How did it feel? What to change next time."),
  ]},
  { id: "recipe", name: "Recipe", emoji: "🍳", category: "Personal", icon: "page", desc: "Ingredients, method and notes for next time.", blocks: () => [
    meta(["Serves"], ["Prep"], ["Cook"]),
    columns([h3("Ingredients"), li(""), li(""), li("")], [h3("Method"), num(""), num(""), num("")]),
    h2("Notes"), p("What to change next time."),
  ]},
  { id: "book-notes", name: "Book notes", emoji: "📚", category: "Personal", icon: "page", desc: "The big ideas, quotes and what you will actually do differently.", blocks: () => [
    meta(["Title"], ["Author"], ["Finished"], ["Rating"]),
    h2("The book in one paragraph"), p(""),
    h2("Big ideas"), num(""), num(""), num(""),
    h2("Quotes"), quote(""), h2("What I will do differently"), todo(""), todo(""),
  ]},
];

/* ---------------------------------------------------------------------------------------------------------------
   Notion's top templates, by group. Notion sorts its gallery into Work, Life and School; each of ours now sits in the same
   group as the Notion template it corresponds to (Cornell Notes, Class Notes, Student Planner, Meeting Notes, Project
   Tracker, Habit Tracker, Budget...), and the use cases Notion leads with that we lacked are added below in the same
   shape: a short banner, the things you fill in side by side, and a tracker you can keep editing.
   --------------------------------------------------------------------------------------------------------------- */
const NOTION = [
  { id: "student-dashboard", name: "Student dashboard", emoji: "🎓", category: "Study", icon: "book",
    desc: "Classes, deadlines and this week's tasks on one page, like Notion's Student Life.", blocks: () => [
      callout("🎓", "Open this first each day. **Classes** on the left, **what is due** on the right, everything else underneath.", "default"),
      columns(
        [h3("📚 Classes"), table([["Class", "Day / time", "Room"], ["", "", ""], ["", "", ""], ["", "", ""], ["", "", ""]], { align: ["left", "left", "left"] })],
        [h3("✅ This week"), todo(""), todo(""), todo(""), todo(""), todo("")]),
      h2("Assignments"),
      table([["Assignment", "Class", "Due", "Status"], ["", "", "", "Not started"], ["", "", "", "Not started"], ["", "", "", "Not started"]], { align: ["left", "left", "center", "center"] }),
      h2("Exams"),
      table([["Exam", "Date", "Topics", "Revised"], ["", "", "", ""], ["", "", "", ""]], { align: ["left", "center", "left", "center"] }),
      toggle("Term goals", [todo(""), todo(""), todo("")]),
      toggle("Useful links", [li(""), li("")]),
    ] },
  { id: "applications", name: "School applications tracker", emoji: "📮", category: "Planning", icon: "template",
    desc: "Deadlines, essays and recommendations for every application.", blocks: () => [
      callout("📮", "One row per application. Work backwards from the deadline: **essay draft two weeks out**, recommendations asked **a month out**.", "default"),
      table([["School", "Deadline", "Essay", "Recommendations", "Status"], ["", "", "Not started", "0 / 2", "Researching"], ["", "", "Not started", "0 / 2", "Researching"], ["", "", "Not started", "0 / 2", "Researching"]], { align: ["left", "center", "center", "center", "center"] }),
      h2("Essay drafts"), toggle("Personal statement", [p("")]), toggle("Why this school", [p("")]),
      checklist("Every application", ["Transcript requested", "Test scores sent", "Recommendations confirmed", "Fee paid", "Submitted and confirmation saved"]),
    ] },
  { id: "roadmap", name: "Roadmap", emoji: "🗺️", category: "Work", icon: "template",
    desc: "Now, next and later, with the reason behind each bet.", blocks: () => [
      callout("🗺️", "A roadmap is a set of **bets with reasons**, not a promise of dates. Keep Now small.", "default"),
      columns(
        [h3("Now"), todo(""), todo(""), todo("")],
        [h3("Next"), todo(""), todo(""), todo("")],
        [h3("Later"), li(""), li(""), li("")]),
      h2("Initiatives"),
      table([["Initiative", "Why it matters", "Owner", "Quarter", "Status"], ["", "", "", "", "Planned"], ["", "", "", "", "Planned"], ["", "", "", "", "Planned"]], { align: ["left", "left", "left", "center", "center"] }),
      h2("Not doing"), li(""), li(""),
    ] },
  { id: "task-tracker", name: "Task tracker", emoji: "✅", category: "Work", icon: "check_square",
    desc: "To do, doing and done on one board, with a backlog beneath.", blocks: () => [
      columns([h3("To do"), todo(""), todo(""), todo("")], [h3("Doing"), todo(""), todo("")], [h3("Done"), todo("", true)]),
      h2("Backlog"),
      table([["Task", "Owner", "Priority", "Due"], ["", "", "Medium", ""], ["", "", "Medium", ""], ["", "", "Medium", ""], ["", "", "Medium", ""]], { align: ["left", "left", "center", "center"] }),
      toggle("How to use this board", [p("Move a task between columns by dragging its handle. Keep Doing to three items or fewer.")]),
    ] },
  { id: "reading-list", name: "Reading list", emoji: "📖", category: "Personal", icon: "book",
    desc: "What you are reading, what is next and what you thought.", blocks: () => [
      columns([h3("📖 Reading now"), todo(""), todo("")], [h3("⏭️ Up next"), li(""), li(""), li("")]),
      h2("Library"),
      table([["Title", "Author", "Status", "Rating", "Takeaway"], ["", "", "To read", "", ""], ["", "", "To read", "", ""], ["", "", "To read", "", ""], ["", "", "To read", "", ""]], { align: ["left", "left", "center", "center", "left"] }),
    ] },
  { id: "team-wiki", name: "Team wiki", emoji: "📚", category: "Work", icon: "book",
    desc: "A home for how your team works: onboarding, processes and who to ask.", blocks: () => [
      callout("📚", "Start here. Keep each page short, give it an **owner**, and link to it instead of copying it.", "default"),
      columns(
        [h3("🚀 Getting started"), li("Onboarding checklist"), li("Tools and accounts"), li("Who is who")],
        [h3("⚙️ How we work"), li("Meetings and rituals"), li("Decisions and reviews"), li("Support and on-call")],
        [h3("🧭 Reference"), li("Glossary"), li("Policies"), li("Brand and style")]),
      h2("Pages"),
      table([["Page", "Owner", "Updated", "Status"], ["", "", "", "Current"], ["", "", "", "Current"], ["", "", "", "Needs review"]], { align: ["left", "left", "center", "center"] }),
      toggle("How to add a page", [p("Make it a sub-page of the right section, add an owner and a review date, then link it from this home.")]),
    ] },
  { id: "crm", name: "Sales CRM", emoji: "🤝", category: "Work", icon: "template",
    desc: "Leads, deals and next steps in one pipeline.", blocks: () => [
      columns(
        [h3("Lead"), todo(""), todo(""), todo("")],
        [h3("Talking"), todo(""), todo("")],
        [h3("Proposal"), todo("")],
        [h3("Won"), todo("", true)]),
      h2("Accounts"),
      table([["Company", "Contact", "Stage", "Value", "Next step", "When"], ["", "", "Lead", "", "", ""], ["", "", "Lead", "", "", ""], ["", "", "Lead", "", "", ""]], { align: ["left", "left", "center", "right", "left", "center"] }),
      toggle("Follow-up rules", [li("Reply within a day"), li("Never leave a deal without a dated next step")]),
    ] },
  { id: "lesson-plan", name: "Lesson plan", emoji: "🍎", category: "Study", icon: "book",
    desc: "Objectives, timing and materials for a single lesson.", blocks: () => [
      meta(["Subject"], ["Year group"], ["Date"], ["Length"]),
      h2("Objectives"), todo("Students can ..."), todo("Students can ..."),
      h2("Plan"),
      table([["Time", "Activity", "Grouping", "Resources"], ["5 min", "Starter", "Whole class", ""], ["15 min", "Teach", "Whole class", ""], ["20 min", "Practice", "Pairs", ""], ["10 min", "Review", "Whole class", ""]], { align: ["center", "left", "left", "left"] }),
      columns([h3("Materials"), li(""), li("")], [h3("Check for understanding"), li(""), li("")]),
      h2("Reflection"), p("What worked, what to change next time."),
    ] },
  { id: "meal-planner", name: "Meal planner", emoji: "🥗", category: "Personal", icon: "page",
    desc: "A week of meals and the shopping list that goes with it.", blocks: () => [
      table([["Day", "Breakfast", "Lunch", "Dinner"], ["Mon", "", "", ""], ["Tue", "", "", ""], ["Wed", "", "", ""], ["Thu", "", "", ""], ["Fri", "", "", ""], ["Sat", "", "", ""], ["Sun", "", "", ""]], { align: ["left", "left", "left", "left"] }),
      columns([h3("🛒 Shopping list"), todo(""), todo(""), todo(""), todo("")], [h3("🧊 Already have"), li(""), li("")]),
      toggle("Favourite recipes", [li(""), li("")]),
    ] },
  { id: "moving-checklist", name: "Moving checklist", emoji: "📦", category: "Personal", icon: "check_square",
    desc: "Everything to do before, during and after a move.", blocks: () => [
      columns(
        [h3("Eight weeks out"), todo("Give notice"), todo("Book movers or a van"), todo("Start decluttering")],
        [h3("Two weeks out"), todo("Pack non-essentials"), todo("Redirect mail"), todo("Update your address")],
        [h3("Moving day"), todo("Meter readings"), todo("Final walk-through"), todo("Keys handed over")]),
      h2("After the move"), checklist("Settle in", ["Unpack the essentials first", "Test smoke alarms", "Register with local services", "Say hello to the neighbours"]),
      h2("Costs"),
      table([["Item", "Cost", "Paid"], ["Movers", "", ""], ["Bond / deposit", "", ""], ["Utilities set-up", "", ""]], { align: ["left", "right", "center"] }),
    ] },
  { id: "class-schedule", name: "Class schedule", emoji: "🗓️", category: "Study", icon: "template",
    desc: "A weekly timetable with room for homework and exams.", blocks: () => [
      table([["Time", "Mon", "Tue", "Wed", "Thu", "Fri"], ["9:00", "", "", "", "", ""], ["10:00", "", "", "", "", ""], ["11:00", "", "", "", "", ""], ["1:00", "", "", "", "", ""], ["2:00", "", "", "", "", ""]], { align: ["center", "left", "left", "left", "left", "left"] }),
      columns([h3("📝 Homework"), todo(""), todo(""), todo("")], [h3("🧪 Exams"), li(""), li("")]),
    ] },
];
TEMPLATES.push(...NOTION.map((entry) => ({ accent: "#8a8f9c", ...entry })));

/* Notion's three groups. A template belongs to the group of the Notion template it matches. */
export const TEMPLATE_GROUPS = ["Work", "Life", "School"];
const LIFE = new Set(["journal", "habit-tracker", "trip", "workout-log", "recipe", "book-notes", "reading-list", "weekly-review", "daily-plan", "goal-setting", "budget", "meal-planner", "moving-checklist"]);
const WORK = new Set(["meeting", "agenda", "one-on-one", "project", "project-brief", "decision-record", "status-report", "okrs", "retrospective", "client-call", "proposal", "sop", "prd", "interview-scorecard", "job-tracker", "content-calendar", "blog-post", "cover-letter", "user-interview", "swot", "competitor-analysis", "roadmap", "task-tracker", "report", "team-wiki", "crm"]);
export const templateGroup = (template) => (LIFE.has(template.id) ? "Life" : WORK.has(template.id) || template.category === "Work" ? "Work" : "School");

/* The restrained look: neutral tints and cover, one quiet icon. Applied to every template, the original catalogue
   included, so the gallery reads as one family of documents rather than a box of colour swatches. */
const SOFT = ["#f1f2f4", "#f8f8f9"];
const neutral = (list) => list.map((block) => {
  const props = { ...(block.props || {}) };
  if (block.type === "table") props.tint = "default";
  if (block.type === "callout") props.color = "default";
  return { ...block, props, children: neutral(block.children || []) };
});
for (const entry of EXTRA) {
  TEMPLATES.push({ accent: "#8a8f9c", ...entry });
}
for (const template of TEMPLATES) {
  if (!template.cover || template.id !== "blank") template.cover = template.id === "blank" ? null : gradient(SOFT[0], SOFT[1]);
  template.accent = "#5f6672";
  const original = template.blocks;
  template.blocks = () => neutral(original());
}
