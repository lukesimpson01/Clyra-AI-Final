/* The block catalogue. The slash menu, the turn-into menu and the editor all
   read from this one list, so a block cannot appear in a menu without a
   renderer behind it. */

export const BLOCK_TYPES = {
  text:        { label: "Text", icon: "text", group: "Basic blocks", desc: "Start writing with plain text.", shortcut: "/text", keywords: "paragraph plain body" },
  h1:          { label: "Heading 1", icon: "h1", group: "Basic blocks", desc: "Large section heading.", keywords: "title h1 #", md: "#" },
  h2:          { label: "Heading 2", icon: "h2", group: "Basic blocks", desc: "Medium section heading.", keywords: "subtitle h2 ##", md: "##" },
  h3:          { label: "Heading 3", icon: "h3", group: "Basic blocks", desc: "Small section heading.", keywords: "h3 ###", md: "###" },
  bulleted:    { label: "Bulleted list", icon: "bullet", group: "Lists", desc: "A simple bulleted list.", keywords: "unordered ul point", md: "-" },
  numbered:    { label: "Numbered list", icon: "numbers", group: "Lists", desc: "A list with numbering.", keywords: "ordered ol steps", md: "1." },
  todo:        { label: "To-do list", icon: "check_square", group: "Lists", desc: "Track tasks with a checkbox.", keywords: "task checkbox tick", md: "[]" },
  toggle:      { label: "Toggle list", icon: "toggle", group: "Lists", desc: "Hide content inside a toggle.", keywords: "collapse fold details" },
  toggle_h1:   { label: "Toggle heading 1", icon: "toggle", group: "Lists", desc: "Large heading that collapses.", keywords: "collapse heading", md: ">#" },
  toggle_h2:   { label: "Toggle heading 2", icon: "toggle", group: "Lists", desc: "Medium heading that collapses.", keywords: "collapse heading", md: ">##" },
  toggle_h3:   { label: "Toggle heading 3", icon: "toggle", group: "Lists", desc: "Small heading that collapses.", keywords: "collapse heading", md: ">###" },
  quote:       { label: "Quote", icon: "quote", group: "Basic blocks", desc: "Set text apart as a quotation.", keywords: "blockquote cite", md: "\"" },
  callout:     { label: "Callout", icon: "callout", group: "Basic blocks", desc: "Make writing stand out.", keywords: "note info tip warning" },
  divider:     { label: "Divider", icon: "divider", group: "Basic blocks", desc: "A horizontal rule.", keywords: "hr line separator", md: "---" },
  code:        { label: "Code", icon: "code", group: "Advanced", desc: "Code with a language label.", keywords: "snippet pre monospace", md: "```" },
  equation:    { label: "Equation", icon: "equation", group: "Advanced", desc: "A block-level formula.", keywords: "math latex tex formula" },
  image:       { label: "Image", icon: "image", group: "Media", desc: "Upload or embed an image.", keywords: "picture photo png jpg" },
  video:       { label: "Video", icon: "video", group: "Media", desc: "Embed a video or YouTube link.", keywords: "mp4 youtube movie" },
  audio:       { label: "Audio", icon: "audio", group: "Media", desc: "Embed an audio recording.", keywords: "sound mp3 recording" },
  file:        { label: "File", icon: "file", group: "Media", desc: "Attach any file.", keywords: "attachment document" },
  pdf:         { label: "PDF", icon: "file", group: "Media", desc: "Embed a PDF to read in place.", keywords: "document slides" },
  bookmark:    { label: "Web bookmark", icon: "bookmark", group: "Media", desc: "Save a link with a preview.", keywords: "url link website" },
  embed:       { label: "Embed", icon: "embed", group: "Media", desc: "Embed any page by URL.", keywords: "iframe website" },
  page:        { label: "Page", icon: "page", group: "Advanced", desc: "Create a page inside this one.", keywords: "subpage child new" },
  link_to_page:{ label: "Link to page", icon: "link", group: "Advanced", desc: "Link an existing page.", keywords: "reference mention" },
  breadcrumb:  { label: "Breadcrumb", icon: "move", group: "Advanced", desc: "Show where this page sits.", keywords: "path parents nav" },
  toc:         { label: "Table of contents", icon: "list", group: "Advanced", desc: "Build a list of headings.", keywords: "outline contents toc" },
  table:       { label: "Table", icon: "table", group: "Advanced", desc: "A simple table of rows and columns.", keywords: "grid rows columns spreadsheet" },
  columns:     { label: "Columns", icon: "panel", group: "Advanced", desc: "Place blocks side by side.", keywords: "layout side columns" },
  key_term:    { label: "Key term", icon: "book", group: "Study", desc: "A term with its definition.", keywords: "definition glossary vocabulary" },
  study_summary:{ label: "Study summary", icon: "target", group: "Study", desc: "A summary panel for revision.", keywords: "recap revision overview" },
  objective:   { label: "Learning objective", icon: "target", group: "Study", desc: "What you should be able to do.", keywords: "goal outcome objective" },
  exam_checklist:{ label: "Exam checklist", icon: "check_square", group: "Study", desc: "Track what is revised.", keywords: "revision checklist exam" },
  source:      { label: "Source", icon: "link", group: "Study", desc: "Cite where material came from.", keywords: "citation reference bibliography" },
};

/* Text-bearing blocks share one editable line; the rest render their own UI. */
export const TEXT_BLOCKS = new Set([
  "text", "h1", "h2", "h3", "bulleted", "numbered", "todo", "toggle",
  "toggle_h1", "toggle_h2", "toggle_h3", "quote", "callout", "code",
  "equation", "key_term", "study_summary", "objective",
]);

export const CONTAINER_BLOCKS = new Set(["toggle", "toggle_h1", "toggle_h2", "toggle_h3", "callout", "quote", "columns", "column", "exam_checklist"]);
export const LIST_BLOCKS = new Set(["bulleted", "numbered", "todo", "toggle"]);
export const HEADINGS = new Set(["h1", "h2", "h3", "toggle_h1", "toggle_h2", "toggle_h3"]);

export const TURN_INTO = [
  "text", "h1", "h2", "h3", "bulleted", "numbered", "todo", "toggle",
  "toggle_h1", "toggle_h2", "toggle_h3", "quote", "callout", "code", "equation", "key_term",
];

export const PLACEHOLDERS = {
  text: "",
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3",
  toggle_h1: "Heading 1", toggle_h2: "Heading 2", toggle_h3: "Heading 3",
  bulleted: "List", numbered: "List", todo: "To-do",
  toggle: "Toggle", quote: "Quote", callout: "Callout",
  code: "Code", equation: "E = mc^2",
  key_term: "Definition", study_summary: "Summary", objective: "Objective",
};

/* Markdown shortcuts applied as the student types. */
export const MARKDOWN_RULES = [
  [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"],
  [/^[-*+]\s$/, "bulleted"], [/^\d+[.)]\s$/, "numbered"],
  [/^\[\]\s$/, "todo"], [/^\[\s?\]\s$/, "todo"],
  [/^>\s$/, "quote"], [/^"\s$/, "quote"],
  [/^```$/, "code"], [/^\|\s$/, "callout"],
  [/^(---|\*\*\*|___)$/, "divider"], [/^toggle\s$/, "toggle"],
];

export const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
export const CODE_LANGUAGES = ["plain", "javascript", "typescript", "python", "java", "c", "cpp", "csharp", "go", "rust", "sql", "html", "css", "json", "yaml", "bash", "markdown", "r", "matlab", "latex"];
