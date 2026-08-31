/* Code block support: syntax highlighting, bracket pairing and completions.

   Deliberately a small tokenizer rather than a highlighting library: the
   notes app ships no bundler, and a few hundred lines covers the languages a
   student actually pastes. Unknown languages fall back to strings, numbers
   and comments, which is still better than flat text. */

const WORD_LANGUAGES = {
  javascript: {
    keywords: "await async break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield",
    literals: "true false null undefined NaN Infinity",
    builtins: "console Math JSON Object Array String Number Boolean Promise Set Map Date RegExp Error window document fetch setTimeout setInterval parseInt parseFloat isNaN require module exports",
    line: "//", block: ["/*", "*/"],
  },
  typescript: {
    keywords: "abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends finally for from function get if implements import in infer instanceof interface is keyof let namespace never new number of private protected public readonly return satisfies set static string super switch symbol this throw try type typeof undefined unique unknown var void while yield",
    literals: "true false null undefined",
    builtins: "console Math JSON Object Array String Number Boolean Promise Set Map Date Record Partial Readonly Pick Omit",
    line: "//", block: ["/*", "*/"],
  },
  python: {
    keywords: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case",
    literals: "True False None",
    builtins: "print len range int str float list dict set tuple bool open enumerate zip map filter sum min max abs sorted reversed type isinstance super self input round any all format",
    line: "#", block: ['"""', '"""'],
  },
  java: {
    keywords: "abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed",
    literals: "true false null",
    builtins: "String Integer Double Boolean Object System List Map Set ArrayList HashMap Math Exception int long double float char byte short boolean",
    line: "//", block: ["/*", "*/"],
  },
  c: {
    keywords: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while",
    literals: "NULL true false",
    builtins: "printf scanf malloc free memcpy strlen strcpy size_t FILE fopen fclose include define",
    line: "//", block: ["/*", "*/"],
  },
  sql: {
    keywords: "select from where group by having order limit offset insert into values update set delete create table alter drop index view join inner left right outer full on as distinct union all case when then else end and or not null is in between like exists primary key foreign references default constraint",
    literals: "null true false",
    builtins: "count sum avg min max coalesce cast date now current_timestamp substring upper lower length round",
    line: "--", block: ["/*", "*/"],
    caseInsensitive: true,
  },
  json: { keywords: "", literals: "true false null", builtins: "", line: null, block: null },
  css: {
    keywords: "important media supports keyframes import charset font-face root and not or from to",
    literals: "inherit initial unset auto none",
    builtins: "color background display flex grid margin padding border width height position top right bottom left font transform transition opacity z-index gap align-items justify-content",
    line: null, block: ["/*", "*/"],
  },
};
WORD_LANGUAGES.js = WORD_LANGUAGES.javascript;
WORD_LANGUAGES.ts = WORD_LANGUAGES.typescript;
WORD_LANGUAGES.py = WORD_LANGUAGES.python;
WORD_LANGUAGES.cpp = WORD_LANGUAGES.c;
WORD_LANGUAGES.csharp = WORD_LANGUAGES.java;
WORD_LANGUAGES.go = WORD_LANGUAGES.c;
WORD_LANGUAGES.rust = WORD_LANGUAGES.c;

const set = (words) => new Set(String(words || "").split(/\s+/).filter(Boolean));

export function languageSpec(language) {
  const spec = WORD_LANGUAGES[String(language || "").toLowerCase()];
  if (!spec) return { keywords: new Set(), literals: new Set(), builtins: new Set(), line: "//", block: ["/*", "*/"] };
  return {
    keywords: set(spec.keywords),
    literals: set(spec.literals),
    builtins: set(spec.builtins),
    line: spec.line,
    block: spec.block,
    caseInsensitive: spec.caseInsensitive,
  };
}

const escapeHtml = (value) =>
  value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]));

const span = (cls, text) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

/* Markup gets its own pass: tags and attributes carry the meaning, and the
   word-based tokenizer would just colour the text between them. */
function highlightMarkup(code) {
  let out = "";
  let index = 0;
  while (index < code.length) {
    const open = code.indexOf("<", index);
    if (open === -1) { out += escapeHtml(code.slice(index)); break; }
    out += escapeHtml(code.slice(index, open));
    const close = code.indexOf(">", open);
    if (close === -1) { out += escapeHtml(code.slice(open)); break; }
    const tag = code.slice(open, close + 1);
    if (tag.startsWith("<!--")) { out += span("comment", tag); index = close + 1; continue; }
    /* Walk the matches and escape the gaps between them explicitly. A plain
       `tag.replace(...)` emits every unmatched run VERBATIM, which is how a
       `<!doctype html>` line used to disappear from a rendered block: its
       leading `<!` matched no alternative, went out raw, and the browser
       swallowed it as a bogus comment. Nothing may reach innerHTML unescaped. */
    const pattern = /("[^"]*"|'[^']*')|([\w:-]+)(?==)|(<\/?)([\w:-]+)|(\/?>)/g;
    let cursor = 0;
    for (const match of tag.matchAll(pattern)) {
      const [text, string, attr, bracket, name, tail] = match;
      out += escapeHtml(tag.slice(cursor, match.index));
      if (string) out += span("string", string);
      else if (attr) out += span("attr", attr);
      else if (name) out += escapeHtml(bracket) + span("tag", name);
      else if (tail) out += escapeHtml(tail);
      else out += escapeHtml(text);
      cursor = match.index + text.length;
    }
    out += escapeHtml(tag.slice(cursor));
    index = close + 1;
  }
  return out;
}

export function highlight(code, language) {
  const lang = String(language || "plain").toLowerCase();
  if (lang === "plain" || !code) return escapeHtml(code);
  if (lang === "html" || lang === "xml" || lang === "svg") return highlightMarkup(code);

  const spec = languageSpec(lang);
  let out = "";
  let index = 0;

  const isWordStart = (char) => /[A-Za-z_$]/.test(char);
  const isWord = (char) => /[A-Za-z0-9_$]/.test(char);

  while (index < code.length) {
    const rest = code.slice(index);

    if (spec.block && rest.startsWith(spec.block[0])) {
      const close = code.indexOf(spec.block[1], index + spec.block[0].length);
      const end = close === -1 ? code.length : close + spec.block[1].length;
      out += span("comment", code.slice(index, end));
      index = end;
      continue;
    }
    if (spec.line && rest.startsWith(spec.line)) {
      const end = code.indexOf("\n", index);
      const stop = end === -1 ? code.length : end;
      out += span("comment", code.slice(index, stop));
      index = stop;
      continue;
    }
    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      let cursor = index + 1;
      while (cursor < code.length) {
        if (code[cursor] === "\\") { cursor += 2; continue; }
        if (code[cursor] === quote) { cursor += 1; break; }
        cursor += 1;
      }
      out += span("string", code.slice(index, cursor));
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(quote) && !isWord(code[index - 1] || " ")) {
      const match = rest.match(/^0[xXbBoO][0-9a-fA-F_]+|^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?n?/);
      if (match) { out += span("number", match[0]); index += match[0].length; continue; }
    }
    if (isWordStart(quote)) {
      let cursor = index;
      while (cursor < code.length && isWord(code[cursor])) cursor += 1;
      const word = code.slice(index, cursor);
      const probe = spec.caseInsensitive ? word.toLowerCase() : word;
      const next = code.slice(cursor).match(/^\s*\(/);
      if (spec.keywords.has(probe)) out += span("keyword", word);
      else if (spec.literals.has(probe)) out += span("literal", word);
      else if (spec.builtins.has(probe)) out += span("builtin", word);
      else if (next) out += span("function", word);
      else if (/^[A-Z]/.test(word)) out += span("type", word);
      else out += escapeHtml(word);
      index = cursor;
      continue;
    }
    if (/[+\-*/%=<>!&|^~?:]/.test(quote)) { out += span("operator", quote); index += 1; continue; }
    if (/[{}[\]()]/.test(quote)) { out += span("bracket", quote); index += 1; continue; }
    out += escapeHtml(quote);
    index += 1;
  }
  return out;
}

/* ------------------------------------------------------ bracket pairing */

export const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
const CLOSERS = new Set(Object.values(PAIRS));

/* Returns the text and caret after handling the key, or null to let the
   browser insert normally. */
export function handlePairs(text, caret, key, selectionEnd) {
  const closing = PAIRS[key];
  const selected = selectionEnd > caret ? text.slice(caret, selectionEnd) : "";

  if (closing) {
    /* Wrapping a selection is the common case for quotes and brackets. */
    if (selected) {
      return { text: text.slice(0, caret) + key + selected + closing + text.slice(selectionEnd), caret: caret + 1 + selected.length + 1 };
    }
    /* A quote already at the caret means the pair is being closed, not opened. */
    if (key === closing && text[caret] === key) return { text, caret: caret + 1 };
    return { text: text.slice(0, caret) + key + closing + text.slice(caret), caret: caret + 1 };
  }
  if (CLOSERS.has(key) && text[caret] === key) return { text, caret: caret + 1 };
  if (key === "Backspace" && !selected) {
    const before = text[caret - 1];
    if (before && PAIRS[before] && text[caret] === PAIRS[before]) {
      return { text: text.slice(0, caret - 1) + text.slice(caret + 1), caret: caret - 1 };
    }
  }
  return null;
}

/* Enter inside a brace pair opens a body and indents it, which is the one
   editor behaviour whose absence is felt immediately. */
export function handleNewline(text, caret, indentUnit = "  ") {
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const indent = (line.match(/^[ \t]*/) || [""])[0];
  const before = text[caret - 1];
  const after = text[caret];
  if (before && PAIRS[before] && PAIRS[before] === after && before !== '"' && before !== "'" && before !== "`") {
    const inner = indent + indentUnit;
    return { text: `${text.slice(0, caret)}\n${inner}\n${indent}${text.slice(caret)}`, caret: caret + 1 + inner.length };
  }
  const extra = /[{[(:]$/.test(line.trimEnd()) ? indentUnit : "";
  return { text: `${text.slice(0, caret)}\n${indent}${extra}${text.slice(caret)}`, caret: caret + 1 + indent.length + extra.length };
}

/* ---------------------------------------------------------- completions */

/* Snippets insert working code, not just the word: `${}` marks where the
   caret lands so accepting a suggestion leaves you mid-expression. */
const SNIPPETS = {
  javascript: [
    ["function", "function ${}() {}", "function name() {}"],
    ["const", "const ${} = ", "const x = "],
    ["let", "let ${} = ", "let x = "],
    ["if", "if (${}) {}", "if (cond) {}"],
    ["for", "for (const ${} of items) {}", "for…of"],
    ["log", "console.log(${})", "console.log()"],
    ["arrow", "(${}) => {}", "() => {}"],
    ["try", "try {\n  ${}\n} catch (error) {}", "try / catch"],
    ["async", "async function ${}() {}", "async function"],
  ],
  python: [
    ["def", "def ${}():", "def name():"],
    ["class", "class ${}:", "class Name:"],
    ["if", "if ${}:", "if cond:"],
    ["for", "for ${} in items:", "for…in"],
    ["print", "print(${})", "print()"],
    ["try", "try:\n    ${}\nexcept Exception:", "try / except"],
  ],
  sql: [
    ["select", "SELECT ${} FROM ", "SELECT … FROM"],
    ["join", "JOIN ${} ON ", "JOIN … ON"],
    ["where", "WHERE ${}", "WHERE"],
  ],
};
SNIPPETS.typescript = [
  ["interface", "interface ${} {}", "interface Name {}"],
  ["type", "type ${} = ", "type Name ="],
  ...SNIPPETS.javascript,
];
SNIPPETS.js = SNIPPETS.javascript;
SNIPPETS.ts = SNIPPETS.typescript;
SNIPPETS.py = SNIPPETS.python;

/* Members offered after a dot. Enough of the standard library that the
   common chains complete without pretending to know every API. */
const MEMBERS = {
  console: ["log", "warn", "error", "info", "table", "time", "timeEnd"],
  Math: ["floor", "ceil", "round", "abs", "min", "max", "random", "pow", "sqrt"],
  JSON: ["stringify", "parse"],
  Object: ["keys", "values", "entries", "assign", "freeze", "fromEntries"],
  Array: ["from", "isArray", "of"],
  Promise: ["all", "allSettled", "race", "resolve", "reject"],
  document: ["querySelector", "querySelectorAll", "createElement", "getElementById", "addEventListener"],
  window: ["addEventListener", "setTimeout", "setInterval", "location", "localStorage"],
};
const ARRAY_MEMBERS = ["length", "map", "filter", "reduce", "forEach", "find", "findIndex", "includes", "indexOf", "slice", "splice", "push", "pop", "shift", "unshift", "join", "sort", "reverse", "some", "every", "flat", "concat"];
const STRING_MEMBERS = ["length", "slice", "substring", "toUpperCase", "toLowerCase", "trim", "split", "replace", "replaceAll", "includes", "startsWith", "endsWith", "padStart", "padEnd", "repeat", "match"];
const PY_MEMBERS = ["append", "extend", "insert", "remove", "pop", "sort", "reverse", "keys", "values", "items", "get", "strip", "split", "join", "format", "upper", "lower", "replace", "startswith", "endswith"];

const FUNCTION_KINDS = new Set(["function", "method", "builtin"]);

/* Suggestions come from the language plus every identifier already in the
   block, so a variable you defined two lines up completes like a keyword. */
export function completionsFor(code, caret, language) {
  const lang = String(language || "").toLowerCase();
  const before = code.slice(0, caret);
  const spec = languageSpec(lang);
  const items = [];
  const seen = new Set();

  /* After a dot the list is members of what precedes it, not the whole
     language — that is the difference between a word list and completion. */
  const member = before.match(/([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)?$/);
  if (member) {
    const owner = member[1];
    const prefix = member[2] || "";
    const python = lang.startsWith("py");
    const pool = MEMBERS[owner]
      || (python ? PY_MEMBERS : [...new Set([...ARRAY_MEMBERS, ...STRING_MEMBERS])]);
    for (const name of pool) {
      if (!name.toLowerCase().startsWith(prefix.toLowerCase()) || seen.has(name)) continue;
      seen.add(name);
      const callable = !["length", "location", "localStorage"].includes(name);
      items.push({
        label: name,
        kind: callable ? "method" : "property",
        detail: MEMBERS[owner] ? owner : "member",
        insert: callable ? `${name}(\${})` : name,
      });
    }
    return { prefix, items: rank(items, prefix).slice(0, 9) };
  }

  const prefixMatch = before.match(/[A-Za-z_$][\w$]*$/);
  if (!prefixMatch) return { prefix: "", items: [] };
  const prefix = prefixMatch[0];

  const push = (label, kind, insert, detail) => {
    if (seen.has(label) || label === prefix) return;
    if (!label.toLowerCase().startsWith(prefix.toLowerCase())) return;
    seen.add(label);
    items.push({ label, kind, insert: insert || label, detail });
  };

  for (const [label, insert, detail] of SNIPPETS[lang] || []) push(label, "snippet", insert, detail);
  for (const word of spec.keywords) push(word, "keyword", `${word} `);
  for (const word of spec.literals) push(word, "literal");
  for (const word of spec.builtins) push(word, "builtin");

  /* Identifiers already written, typed by how they were used. */
  const declared = new Map();
  for (const match of code.matchAll(/\b(?:function|def|class)\s+([A-Za-z_$][\w$]*)/g)) declared.set(match[1], "function");
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.set(match[1], "variable");
  for (const [label, kind] of declared) push(label, kind, kind === "function" ? `${label}(\${})` : label, "in this block");
  for (const word of new Set(code.match(/[A-Za-z_$][\w$]{1,}/g) || [])) push(word, "text", word, "in this block");

  return { prefix, items: rank(items, prefix).slice(0, 9) };
}

/* Exact-prefix matches first, then things you wrote yourself, then length. */
function rank(items, prefix) {
  const weight = { snippet: 0, method: 1, property: 1, function: 2, variable: 2, keyword: 3, builtin: 4, literal: 5, text: 6 };
  return items.sort((a, b) => {
    const exact = Number(b.label.startsWith(prefix)) - Number(a.label.startsWith(prefix));
    if (exact) return exact;
    const kind = (weight[a.kind] ?? 9) - (weight[b.kind] ?? 9);
    if (kind) return kind;
    return a.label.length - b.label.length || a.label.localeCompare(b.label);
  });
}

export { FUNCTION_KINDS };
