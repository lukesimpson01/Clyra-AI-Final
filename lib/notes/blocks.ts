/* Block and rich-text model shared by the server and the editor.

   Inline content is an array of spans rather than an HTML string: the editor
   serialises its contenteditable DOM into spans, which keeps marks, page
   mentions and equations addressable without parsing HTML on every save. */

export type Span = {
  t: string;                 // plain text
  b?: 1; i?: 1; u?: 1; s?: 1; c?: 1;   // bold italic underline strike code
  col?: string;              // text colour token
  bg?: string;               // background colour token
  href?: string;             // external link
  page?: string;             // internal page mention
  date?: string;             // @date mention (ISO)
  eq?: string;               // inline equation (LaTeX)
};

export type Block = {
  id: string;
  page_id: string;
  parent_id: string | null;
  type: BlockType;
  text: Span[];
  props: Record<string, unknown>;
  sort: number;
  children?: Block[];
};

export type BlockType =
  | "text" | "h1" | "h2" | "h3"
  | "bulleted" | "numbered" | "todo"
  | "toggle" | "toggle_h1" | "toggle_h2" | "toggle_h3"
  | "quote" | "callout" | "divider" | "code" | "equation"
  | "image" | "video" | "audio" | "file" | "pdf" | "bookmark" | "embed"
  | "table" | "chart" | "columns" | "column"
  | "page" | "link_to_page" | "breadcrumb" | "toc" | "database" | "synced" | "button"
  | "flashcard_set" | "flashcard" | "quiz" | "question" | "key_term"
  | "study_summary" | "exam_checklist" | "source" | "transcript" | "objective";

/* Types whose children are rendered by the editor as nested blocks. */
export const CONTAINER_TYPES = new Set<BlockType>([
  "toggle", "toggle_h1", "toggle_h2", "toggle_h3", "columns", "column", "callout", "quote",
]);

/* Types that hold no editable inline text of their own. */
export const VOID_TYPES = new Set<BlockType>([
  "divider", "image", "video", "audio", "file", "pdf", "bookmark", "embed",
  "table", "chart", "columns", "breadcrumb", "toc", "database", "synced", "button",
  "flashcard_set", "quiz", "source", "transcript", "link_to_page", "page",
]);

export const spanText = (spans: Span[] | undefined) =>
  (spans || []).map((span) => span.t ?? "").join("");

export const plain = (text: string): Span[] => (text ? [{ t: text }] : []);

export function parseSpans(raw: unknown): Span[] {
  if (Array.isArray(raw)) return raw as Span[];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : plain(String(raw));
  } catch {
    return plain(raw);
  }
}

/* ---------- inline markdown ---------- */

const INLINE = /(\*\*\*|\*\*|__|~~|\*|_|`)|(\[([^\]]*)\]\(([^)\s]+)\))|(\[\[([^\]]+)\]\])|(\$([^$\n]+)\$)/;

export function inlineToSpans(source: string): Span[] {
  const spans: Span[] = [];
  let rest = source;
  const marks: Partial<Span> = {};
  const push = (text: string) => {
    if (!text) return;
    const last = spans[spans.length - 1];
    const span: Span = { ...marks, t: text };
    if (last && sameMarks(last, span)) last.t += text;
    else spans.push(span);
  };
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match || match.index === undefined) {
      push(rest);
      break;
    }
    push(rest.slice(0, match.index));
    rest = rest.slice(match.index);
    if (match[2]) {
      spans.push({ ...marks, t: match[3] || match[4], href: match[4] });
      rest = rest.slice(match[2].length);
    } else if (match[5]) {
      spans.push({ ...marks, t: match[6], page: `title:${match[6]}` });
      rest = rest.slice(match[5].length);
    } else if (match[7]) {
      spans.push({ ...marks, t: match[8], eq: match[8] });
      rest = rest.slice(match[7].length);
    } else {
      const token = match[1]!;
      const key = token === "`" ? "c" : token === "~~" ? "s" : token === "***" ? "bi" : token === "**" || token === "__" ? "b" : "i";
      if (key === "bi") {
        marks.b = marks.b ? undefined : 1;
        marks.i = marks.i ? undefined : 1;
      } else {
        (marks as Record<string, unknown>)[key] = (marks as Record<string, unknown>)[key] ? undefined : 1;
      }
      rest = rest.slice(token.length);
    }
  }
  return spans.filter((span) => span.t !== "");
}

const sameMarks = (a: Span, b: Span) =>
  a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.c === b.c &&
  a.col === b.col && a.bg === b.bg && a.href === b.href && a.page === b.page && a.eq === b.eq;

export function spansToMarkdown(spans: Span[] | undefined): string {
  return (spans || [])
    .map((span) => {
      if (span.eq) return `$${span.eq}$`;
      let text = span.t ?? "";
      if (span.c) text = `\`${text}\``;
      if (span.b) text = `**${text}**`;
      if (span.i) text = `*${text}*`;
      if (span.s) text = `~~${text}~~`;
      if (span.href) text = `[${text}](${span.href})`;
      return text;
    })
    .join("");
}

/* ---------- markdown document <-> blocks ---------- */

type DraftBlock = { type: BlockType; text: Span[]; props: Record<string, unknown>; children: DraftBlock[] };

const draft = (type: BlockType, text: Span[] = [], props: Record<string, unknown> = {}): DraftBlock =>
  ({ type, text, props, children: [] });

/* Converts a markdown document into a flat-enough block tree. List nesting is
   derived from indentation so imported notes keep their structure. */
const splitRow = (line: string) =>
  line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

const isTableSeparator = (line: string | undefined) =>
  Boolean(line && /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-"));

export function markdownToBlocks(markdown: string): DraftBlock[] {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const root: DraftBlock[] = [];
  const stack: Array<{ indent: number; block: DraftBlock }> = [];
  let index = 0;

  const append = (block: DraftBlock, indent: number) => {
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    (parent ? parent.block.children : root).push(block);
    stack.push({ indent, block });
  };

  while (index < lines.length) {
    const line = lines[index]!;
    const indent = line.match(/^\s*/)![0].replace(/\t/g, "  ").length;
    const body = line.trim();
    index += 1;

    if (!body) continue;

    /* A pipe table is a run of lines; the separator row is what tells it
       apart from a paragraph that merely contains a pipe. */
    if (body.startsWith("|") && isTableSeparator(lines[index]?.trim())) {
      const rows: string[][] = [splitRow(body)];
      index += 1;
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[index]!.trim()));
        index += 1;
      }
      append(draft("table", [], { rows, hasHeader: true }), indent);
      continue;
    }

    const fence = body.match(/^```(\w*)$/);
    if (fence) {
      const code: string[] = [];
      while (index < lines.length && lines[index]!.trim() !== "```") code.push(lines[index++]!);
      index += 1;
      append(draft("code", plain(code.join("\n")), { language: fence[1] || "plain" }), indent);
      continue;
    }
    const chart = body.match(/^:::chart(?:\s+(\{.*\}))?$/i);
    if (chart) {
      while (index < lines.length && lines[index]!.trim() !== ":::") index += 1;
      if (index < lines.length) index += 1;
      let props: Record<string, unknown> = {};
      try { props = chart[1] ? JSON.parse(chart[1]) : {}; } catch { /* keep defaults */ }
      append(draft("chart", [], props), indent);
      continue;
    }
    if (/^(---|\*\*\*|___)$/.test(body)) {
      append(draft("divider"), indent);
      continue;
    }
    const heading = body.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      append(draft(`h${heading[1]!.length}` as BlockType, inlineToSpans(heading[2]!)), indent);
      continue;
    }
    /* The trailing space of an empty list item is lost to trim(), so the
       content group is optional — otherwise "- " parses as a paragraph. */
    const todo = body.match(/^[-*+]\s*\[( |x|X)\]\s*(.*)$/);
    if (todo) {
      append(draft("todo", inlineToSpans(todo[2]!), { checked: todo[1] !== " " }), indent);
      continue;
    }
    const bullet = body.match(/^[-*+](?:\s+(.*))?$/);
    if (bullet) {
      append(draft("bulleted", inlineToSpans(bullet[1] ?? "")), indent);
      continue;
    }
    const numbered = body.match(/^\d+[.)](?:\s+(.*))?$/);
    if (numbered) {
      append(draft("numbered", inlineToSpans(numbered[1] ?? "")), indent);
      continue;
    }
    const quote = body.match(/^>\s?(.*)$/);
    if (quote) {
      append(draft("quote", inlineToSpans(quote[1]!)), indent);
      continue;
    }
    append(draft("text", inlineToSpans(body)), indent);
  }
  return root;
}

const LIST_PREFIX: Partial<Record<BlockType, string>> = {
  bulleted: "- ",
  quote: "> ",
};

export function blocksToMarkdown(blocks: Block[], depth = 0): string {
  const pad = "  ".repeat(depth);
  const out: string[] = [];
  let counter = 0;
  for (const block of blocks) {
    const text = spansToMarkdown(block.text);
    counter = block.type === "numbered" ? counter + 1 : 0;
    switch (block.type) {
      case "h1": out.push(`${pad}# ${text}`); break;
      case "h2": out.push(`${pad}## ${text}`); break;
      case "h3": out.push(`${pad}### ${text}`); break;
      case "toggle_h1": out.push(`${pad}# ${text}`); break;
      case "toggle_h2": out.push(`${pad}## ${text}`); break;
      case "toggle_h3": out.push(`${pad}### ${text}`); break;
      case "bulleted": case "toggle": out.push(`${pad}- ${text}`); break;
      case "numbered": out.push(`${pad}${counter}. ${text}`); break;
      case "todo": out.push(`${pad}- [${block.props?.checked ? "x" : " "}] ${text}`); break;
      case "quote": out.push(`${pad}> ${text}`); break;
      case "callout": out.push(`${pad}> ${block.props?.icon || "💡"} ${text}`); break;
      case "divider": out.push(`${pad}---`); break;
      case "table": {
        const rows = (block.props?.rows as string[][]) || [];
        if (rows.length) {
          const width = Math.max(...rows.map((row) => row.length));
          const line = (row: string[]) => `${pad}| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
          out.push([line(rows[0]!), `${pad}|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n"));
        }
        break;
      }
      case "chart": {
        /* A fenced directive is both human-readable and lossless on import;
           JSON is data-only and never executed by the markdown parser. */
        out.push(`${pad}:::chart ${JSON.stringify(block.props || {})}\n${pad}:::`);
        break;
      }

      case "code": out.push(`${pad}\`\`\`${block.props?.language || ""}\n${text}\n${pad}\`\`\``); break;
      case "equation": out.push(`${pad}$$\n${text}\n$$`); break;
      case "image": case "video": case "audio": case "file": case "pdf":
        out.push(`${pad}![${block.props?.caption || block.type}](${block.props?.url || ""})`); break;
      case "bookmark": case "embed":
        out.push(`${pad}[${block.props?.title || block.props?.url || ""}](${block.props?.url || ""})`); break;
      case "key_term": out.push(`${pad}**${block.props?.term || ""}** — ${text}`); break;
      case "page": case "link_to_page":
        out.push(`${pad}- [[${block.props?.title || "Untitled"}]]`); break;
      default: out.push(`${pad}${text}`);
    }
    if (block.children?.length) out.push(blocksToMarkdown(block.children, depth + 1));
  }
  return out.filter((line) => line !== undefined).join("\n\n").replace(/\n{3,}/g, "\n\n");
}

export type { DraftBlock };
