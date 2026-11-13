/* What a tool call actually did, as a short list of concrete actions.

   A row that only says "Preparing an edit" hides the work. These helpers turn
   the tool's real inputs and results into the steps a person would describe:
   which note was read, where the change goes, which sections were written,
   that a table with four rows was added, how many lines changed. Everything
   here is derived from data the tool already has; nothing is invented. */

export type StepAction = { kind: "read" | "find" | "write" | "add" | "remove" | "check" | "open" | "wait"; label: string; meta?: string; icon?: string };
export type StepChanges = { added: number; removed: number };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const plain = (line: string) => line.replace(/^\s*(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "").replace(/[*_`~]|\[\^?[^\]]*\]\([^)]*\)/g, "").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const words = (markdown: string) => (markdown.match(/[\p{L}\p{N}’']+/gu) || []).length;

/* The parts a block of markdown is made of. */
export function shapeOf(markdown: string) {
  const lines = markdown.split("\n");
  const headings: string[] = [];
  let bullets = 0, numbered = 0, todos = 0, quotes = 0, paragraphs = 0, code = 0, inCode = false;
  let tableRows = 0, tableCols = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) { if (!inCode) code += 1; inCode = !inCode; continue; }
    if (inCode || !line) continue;
    if (/^#{1,6}\s/.test(line)) headings.push(plain(line));
    else if (/^[-*+]\s+\[[ xX]\]/.test(line)) todos += 1;
    else if (/^[-*+]\s/.test(line)) bullets += 1;
    else if (/^\d+[.)]\s/.test(line)) numbered += 1;
    else if (/^>/.test(line)) quotes += 1;
    else if (/^\|.*\|$/.test(line)) { if (!/^\|[\s:|-]+\|$/.test(line)) { tableRows += 1; tableCols = Math.max(tableCols, line.split("|").length - 2); } }
    else paragraphs += 1;
  }
  return { headings, bullets, numbered, todos, quotes, paragraphs, code, tableRows, tableCols, words: words(markdown), lines: lines.filter((l) => l.trim()).length };
}

/* The writing a block of markdown represents, one action per meaningful part. */
export function writeActions(markdown: string, limit = 7): StepAction[] {
  const shape = shapeOf(markdown);
  const out: StepAction[] = shape.headings.slice(0, 4).map((heading) => ({ kind: "write", label: `Writing the section “${clip(heading, 48)}”` }));
  if (shape.headings.length > 4) out.push({ kind: "write", label: `Writing ${plural(shape.headings.length - 4, "more section")}` });
  if (shape.tableRows) out.push({ kind: "add", label: "Adding a table", meta: `${plural(Math.max(0, shape.tableRows - 1), "row")} × ${plural(shape.tableCols, "column")}` });
  if (shape.bullets) out.push({ kind: "add", label: `Adding ${plural(shape.bullets, "bullet point")}` });
  if (shape.numbered) out.push({ kind: "add", label: `Adding ${plural(shape.numbered, "numbered step")}` });
  if (shape.todos) out.push({ kind: "add", label: `Adding ${plural(shape.todos, "checklist item")}` });
  if (shape.quotes) out.push({ kind: "add", label: `Adding ${plural(shape.quotes, "quote")}` });
  if (shape.code) out.push({ kind: "add", label: `Adding ${plural(shape.code, "code block")}` });
  if (shape.paragraphs) out.push({ kind: "write", label: `Writing ${plural(shape.paragraphs, "paragraph")}`, meta: plural(shape.words, "word") });
  if (!out.length) out.push({ kind: "write", label: `Writing “${clip(plain(markdown.split("\n").find((l) => l.trim()) || ""), 50)}”` });
  return out.slice(0, limit);
}

/* Lines added and removed between two texts, by longest common subsequence
   over lines (texts here are a note passage, so this stays small). */
export function lineChanges(before: string, after: string): StepChanges {
  const a = before.split("\n").map((l) => l.trim()).filter(Boolean);
  const b = after.split("\n").map((l) => l.trim()).filter(Boolean);
  if (a.length * b.length > 250_000) return { added: b.length, removed: a.length };
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const same = dp[0][0];
  return { added: b.length - same, removed: a.length - same };
}

/* The heading a passage sits under, so "where" can be said in the note's own words. */
export function sectionOf(markdown: string, needle: string): string | null {
  const at = needle ? markdown.indexOf(needle) : -1;
  if (at < 0) return null;
  const before = markdown.slice(0, at).split("\n").reverse().find((line) => /^#{1,6}\s/.test(line.trim()));
  return before ? plain(before.trim()) : null;
}

export const readActions = (title: string, markdown: string): StepAction[] => {
  const shape = shapeOf(markdown);
  /* A note's first heading is often its own title; reading it twice says nothing. */
  shape.headings = shape.headings.filter((heading) => heading.trim().toLowerCase() !== title.trim().toLowerCase());
  const out: StepAction[] = [{ kind: "open", label: `Opened “${clip(title, 50)}”`, meta: plural(shape.words, "word") }];
  shape.headings.slice(0, 5).forEach((heading) => out.push({ kind: "read", label: `Read “${clip(heading, 50)}”` }));
  if (shape.headings.length > 5) out.push({ kind: "read", label: `Read ${plural(shape.headings.length - 5, "more section")}` });
  if (shape.tableRows) out.push({ kind: "read", label: "Read a table", meta: plural(Math.max(0, shape.tableRows - 1), "row") });
  const items = shape.bullets + shape.numbered + shape.todos;
  if (items) out.push({ kind: "read", label: `Read ${plural(items, "list item")}` });
  return out;
};

export const placeLabel = (position: string, afterText?: string, section?: string | null) =>
  position === "start" ? "Placing it at the top of the note"
    : position === "after" && afterText ? `Placing it after “${clip(plain(afterText), 44)}”`
      : section ? `Placing it at the end of “${clip(section, 44)}”` : "Placing it at the end of the note";

/* Each action gets the icon for what it actually is: a table is drawn as a
   table, a checklist as a checkbox, a rename as type, a web result as a link.
   The kind only decides the colour; this decides the picture. */
const ICON_RULES: Array<[RegExp, string]> = [
  [/^Writing (the section|\d+ more section)/, "h2"],
  [/^Read “.*”$|^Read \d+ more section/, "align_left"],
  [/^Re-read/, "history"],
  [/table|column/i, "table"],
  [/bullet point/, "bullet"],
  [/numbered step/, "numbers"],
  [/checklist item|^Checked the plan/, "check_square"],
  [/list item|^Found \d+ results/, "list"],
  [/quote/, "quote"],
  [/code block/, "code"],
  [/paragraph|^Extracted/, "text"],
  [/^Fetched/, "embed"],
  [/^Opened|^Created the page/, "page"],
  [/^Searched|^Looked for/, "search"],
  [/^No notes matched/, "eye_off"],
  [/^Matched|^Found the passage|^Placing it/, "target"],
  [/links? to follow|^Linked/, "link"],
  [/^Compared/, "eye"],
  [/^Showing the change/, "highlighter"],
  [/^Waiting/, "clock"],
  [/citation/, "alert"],
  [/^Rewrote/, "pencil"],
  [/^Removed the passage|^Moved it to Trash/, "trash"],
  [/^Renamed/, "type_size"],
  [/icon|favourites/, "star"],
  [/^Moved/, "move"],
  [/^Filled in/, "grid"],
  [/^Card:|more cards/, "cards"],
  [/^Saved to/, "book"],
  [/template/, "template"],
  [/^Recoloured/, "palette"],
  [/^Started /, "users"],
  [/^Still to do/, "flag"],
  [/^Copied every block/, "duplicate"],
];
export function withIcons(actions?: StepAction[]): StepAction[] | undefined {
  return actions?.map((action) => {
    if (action.icon) return action;
    const rule = ICON_RULES.find(([pattern]) => pattern.test(action.label));
    /* A web result is listed by its title with its site as the detail. */
    const icon = rule?.[1] ?? (action.kind === "open" && action.meta && /\.[a-z]{2,}$/i.test(action.meta) ? "link" : undefined);
    return icon ? { ...action, icon } : action;
  });
}
