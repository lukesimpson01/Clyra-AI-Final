/* The block catalogue. The slash menu, the turn-into menu and the editor all
   read from this one list, so a block cannot appear in a menu without a
   renderer behind it. */

export const BLOCK_TYPES = {
  text:        { label: "Text", icon: "text", group: "Basic blocks", desc: "Start writing with plain text.", shortcut: "/text", keywords: "paragraph plain body" },
  h1:          { label: "Heading 1", icon: "h1", group: "Basic blocks", desc: "Large section heading.", keywords: "title h1 #", md: "#" },
  h2:          { label: "Heading 2", icon: "h2", group: "Basic blocks", desc: "Medium section heading.", keywords: "subtitle h2 ##", md: "##" },
  h3:          { label: "Heading 3", icon: "h3", group: "Basic blocks", desc: "Small section heading.", keywords: "h3 ###", md: "###" },
  h4:          { label: "Heading 4", icon: "h3", group: "Basic blocks", desc: "Smallest section heading.", keywords: "h4 ####", md: "####" },
  bulleted:    { label: "Bulleted list", icon: "bullet", group: "Basic blocks", desc: "A simple bulleted list.", keywords: "unordered ul point", md: "-" },
  numbered:    { label: "Numbered list", icon: "numbers", group: "Basic blocks", desc: "A list with numbering.", keywords: "ordered ol steps", md: "1." },
  todo:        { label: "To-do list", icon: "check_square", group: "Basic blocks", desc: "Track tasks with a checkbox.", keywords: "task checkbox tick", md: "[]" },
  toggle:      { label: "Toggle list", icon: "toggle", group: "Basic blocks", desc: "Hide content inside a toggle.", keywords: "collapse fold details" },
  toggle_h1:   { label: "Toggle heading 1", icon: "toggle", group: "Advanced blocks", desc: "Large heading that collapses.", keywords: "collapse heading", md: ">#" },
  toggle_h2:   { label: "Toggle heading 2", icon: "toggle", group: "Advanced blocks", desc: "Medium heading that collapses.", keywords: "collapse heading", md: ">##" },
  toggle_h3:   { label: "Toggle heading 3", icon: "toggle", group: "Advanced blocks", desc: "Small heading that collapses.", keywords: "collapse heading", md: ">###" },
  quote:       { label: "Quote", icon: "quote", group: "Basic blocks", desc: "Set text apart as a quotation.", keywords: "blockquote cite", md: "\"" },
  callout:     { label: "Callout", icon: "callout", group: "Basic blocks", desc: "Make writing stand out.", keywords: "note info tip warning" },
  divider:     { label: "Divider", icon: "divider", group: "Basic blocks", desc: "A horizontal rule.", keywords: "hr line separator", md: "---" },
  code:        { label: "Code", icon: "code", group: "Media", desc: "Code with a language label.", keywords: "snippet pre monospace", md: "```" },
  equation:    { label: "Block equation", icon: "equation", group: "Advanced blocks", desc: "A block-level formula.", keywords: "math latex tex formula" },
  image:       { label: "Image", icon: "image", group: "Media", desc: "Upload or embed an image.", keywords: "picture photo png jpg" },
  video:       { label: "Video", icon: "video", group: "Media", desc: "Embed a video or YouTube link.", keywords: "mp4 youtube movie" },
  audio:       { label: "Audio", icon: "audio", group: "Media", desc: "Embed an audio recording.", keywords: "sound mp3 recording" },
  file:        { label: "File", icon: "file", group: "Media", desc: "Attach any file.", keywords: "attachment document" },
  pdf:         { label: "PDF", icon: "file", group: "Media", desc: "Embed a PDF to read in place.", keywords: "document slides" },
  bookmark:    { label: "Web bookmark", icon: "bookmark", group: "Media", desc: "Save a link with a preview.", keywords: "url link website" },
  embed:       { label: "Embed", icon: "embed", group: "Embeds", desc: "Embed any page by URL.", keywords: "iframe website" },
  page:        { label: "Page", icon: "page", group: "Basic blocks", desc: "Create a page inside this one.", keywords: "subpage child new" },
  link_to_page:{ label: "Link to page", icon: "link", group: "Basic blocks", desc: "Link an existing page.", keywords: "reference mention" },
  breadcrumb:  { label: "Breadcrumb", icon: "move", group: "Advanced blocks", desc: "Show where this page sits.", keywords: "path parents nav" },
  toc:         { label: "Table of contents", icon: "list", group: "Advanced blocks", desc: "Build a list of headings.", keywords: "outline contents toc" },
  table:       { label: "Table", icon: "table", group: "Basic blocks", desc: "A simple table of rows and columns.", keywords: "grid rows columns spreadsheet" },
  html:        { label: "HTML", icon: "code", group: "Embeds", desc: "Run a small piece of HTML on the page.", keywords: "embed widget iframe snippet new" },
  button:      { label: "Button", icon: "plus", group: "Advanced blocks", desc: "A button that adds content to the page.", keywords: "button action" },
  tabs:        { label: "Tabs", icon: "panel", group: "Advanced blocks", desc: "Show one pane at a time under tabs.", keywords: "tabs panes" },
  ai_block:    { label: "AI Block", icon: "sparkle", group: "Advanced blocks", desc: "A summary or answer that updates on demand.", keywords: "ai summary" },
  synced:      { label: "Synced block", icon: "refresh", group: "Advanced blocks", desc: "The same text in many pages, edited in one place.", keywords: "synced sync linked copy mirror shared reuse" },
  brainstorm:  { label: "Brainstorm", icon: "target", group: "Advanced blocks", desc: "A whiteboard for ideas: stickies, shapes, notes and connectors.", keywords: "brainstorm whiteboard board canvas figjam miro sticky mind map diagram flow" },
  database:    { label: "Database", icon: "table", group: "Database", desc: "A table, board, list, gallery or calendar of records.", keywords: "table board gallery list calendar view inline" },
  chart:       { label: "Cartesian graph", icon: "chart", group: "Advanced blocks", desc: "Plot a Cartesian plane, line, scatter or bar chart.", keywords: "graph plot cartesian plane x y chart visualize data table" },
  columns:     { label: "Columns", icon: "panel", group: "Advanced blocks", desc: "Place blocks side by side.", keywords: "layout side columns" },
  key_term:    { label: "Key term", icon: "book", group: "Study", desc: "A term with its definition.", keywords: "definition glossary vocabulary" },
  study_summary:{ label: "Study summary", icon: "target", group: "Study", desc: "A summary panel for revision.", keywords: "recap revision overview" },
  objective:   { label: "Learning objective", icon: "target", group: "Study", desc: "What you should be able to do.", keywords: "goal outcome objective" },
  exam_checklist:{ label: "Exam checklist", icon: "check_square", group: "Study", desc: "Track what is revised.", keywords: "revision checklist exam" },
  source:      { label: "Source", icon: "link", group: "Study", desc: "Cite where material came from.", keywords: "citation reference bibliography" },
};

/* Text-bearing blocks share one editable line; the rest render their own UI. */
export const TEXT_BLOCKS = new Set([
  "text", "h1", "h2", "h3", "h4", "bulleted", "numbered", "todo", "toggle",
  "toggle_h1", "toggle_h2", "toggle_h3", "quote", "callout", "code",
  "equation", "key_term", "study_summary", "objective",
]);

export const CONTAINER_BLOCKS = new Set(["tabs", "tab", "toggle", "toggle_h1", "toggle_h2", "toggle_h3", "callout", "quote", "columns", "column", "exam_checklist"]);
export const LIST_BLOCKS = new Set(["bulleted", "numbered", "todo", "toggle"]);
export const HEADINGS = new Set(["h1", "h2", "h3", "h4", "toggle_h1", "toggle_h2", "toggle_h3"]);

export const TURN_INTO = [
  "text", "h1", "h2", "h3", "h4", "bulleted", "numbered", "todo", "toggle",
  "toggle_h1", "toggle_h2", "toggle_h3", "quote", "callout", "code", "equation", "key_term",
  "chart",
];

export const PLACEHOLDERS = {
  text: "",
  h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4",
  toggle_h1: "Heading 1", toggle_h2: "Heading 2", toggle_h3: "Heading 3",
  bulleted: "List", numbered: "List", todo: "To-do",
  toggle: "Toggle", quote: "Quote", callout: "Callout",
  code: "Code", equation: "E = mc^2",
  key_term: "Definition", study_summary: "Summary", objective: "Objective",
};

/* Markdown shortcuts applied as the student types. */
export const MARKDOWN_RULES = [
  [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^####\s$/, "h4"],
  [/^[-*+]\s$/, "bulleted"], [/^\d+[.)]\s$/, "numbered"],
  [/^\[\]\s$/, "todo"], [/^\[\s?\]\s$/, "todo"],
  [/^>\s$/, "quote"], [/^"\s$/, "quote"],
  [/^```$/, "code"], [/^\|\s$/, "callout"],
  [/^(---|\*\*\*|___)$/, "divider"], [/^toggle\s$/, "toggle"],
];

export const COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
export const CODE_LANGUAGES = ["plain", "javascript", "typescript", "python", "mermaid", "java", "c", "cpp", "csharp", "go", "rust", "sql", "html", "css", "json", "yaml", "bash", "markdown", "r", "matlab", "latex"];
