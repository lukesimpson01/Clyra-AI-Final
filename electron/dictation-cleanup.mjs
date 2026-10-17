const CODE_APPS = /(terminal|iterm|warp|cursor|visual studio code|\bcode\b|xcode|zed|sublime|intellij|webstorm|pycharm|android studio|nova|vim|emacs|ghostty|alacritty|kitty|hyper|powershell|cmd\.exe|windows terminal)/i;
const CASUAL_APPS = /(messages|imessage|slack|discord|whatsapp|telegram|signal|messenger|teams|line|wechat|instagram|snapchat|twitter|\bx\b|reddit|facebook)/i;
const FORMAL_APPS = /(mail|outlook|gmail|superhuman|spark|word|pages|docs|notion|obsidian|bear|notes|onenote|pdf|keynote|powerpoint|linear|jira|confluence)/i;
function classifyApp(application) {
  const name = String(application || "");
  if (!name) return "generic";
  if (CODE_APPS.test(name)) return "code";
  if (CASUAL_APPS.test(name)) return "casual";
  if (FORMAL_APPS.test(name)) return "formal";
  return "generic";
}
const FILLER = /(?:^|(?<=[\s,.;:!?]))(?:u+m+|u+h+|e+r+m*|a+h+m+|h+m+|m+m+h*m*|uh-huh)(?=[\s,.;:!?]|$)[\s,]*/gi;
const COMMA_FILLER = /,\s*(?:you know|i mean|sort of|kind of|like|basically|literally)\s*,/gi;
function removeFillers(text) {
  return text.replace(FILLER, "").replace(COMMA_FILLER, ",");
}
function removeStutters(text) {
  let out = text.replace(/\b(\w+)([,\s]+\1\b)+/gi, "$1");
  out = out.replace(/\b((?:\w+\s+){1,3}\w+)([,\s]+\1\b)+/gi, "$1");
  return out;
}
const STRONG_CORRECTION = /^(?:no[,.]? wait|wait[,.]? no|actually[,.]? no|sorry[,.]?|rather[,.]?|correction[,.]?)\s*/i;
function applyCorrections(text) {
  let out = text;
  out = out.replace(/(?:^|[.!?]\s+)([^.!?]*?[.!?]?)\s*(?:scratch that|delete that|ignore that|never mind that)[.!?,]?\s*/gi, (_m, _prev, offset) => offset === 0 ? "" : ". ");
  out = out.replace(/([^,.;!?]+)[,.]?\s+(?:no[,.]? wait|wait[,.]? no|actually[,.]? no|sorry|correction)[,.]?\s+([^.!?]+)/gi, (match, before, after) => {
    const lead = before.trim().split(/\s+/);
    const afterWords = after.trim().split(/\s+/);
    const keep = Math.max(0, lead.length - Math.min(afterWords.length, lead.length));
    return `${lead.slice(0, keep).join(" ")} ${after.trim()}`.trim();
  });
  return out;
}
const NOT_PUNCT_BEFORE = /(?:the|a|an|this|that|my|your|his|her|their|our|time|trial|grace|last|first|ice|stone|dark|full|short|long|dot|question|one|each|every|same|during|for|over|within|that|which)$/i;
function applySpokenPunctuation(text) {
  const tokens = [
    [/\b(?:new paragraph)\b/gi, "\n\n", "newline"],
    [/\b(?:new line|next line|line break)\b/gi, "\n", "newline"],
    [/\b(?:question mark)\b/gi, "?", "attach-left"],
    [/\b(?:exclamation (?:mark|point))\b/gi, "!", "attach-left"],
    [/\b(?:full stop)\b/gi, ".", "attach-left"],
    [/\bsemi-?colon\b/gi, ";", "attach-left"],
    [/\bcolon\b/gi, ":", "attach-left"],
    [/\bellipsis\b/gi, "\u2026", "attach-left"],
    [/\b(?:open (?:paren|parenthesis|bracket))\b/gi, "(", "none"],
    [/\b(?:close (?:paren|parenthesis|bracket))\b/gi, ")", "attach-left"],
    [/\b(?:bullet point|bullet)\b(?=\s)/gi, "\n- ", "newline"]
  ];
  let out = text;
  for (const [pattern, replacement, mode] of tokens) {
    out = out.replace(pattern, (match, offset, whole) => {
      if (mode === "attach-left") {
        const before = whole.slice(0, offset).trimEnd();
        const prevWord = before.split(/\s+/).pop() || "";
        if (NOT_PUNCT_BEFORE.test(prevWord) && /^(?:colon|ellipsis)$/i.test(match)) return match;
        return replacement;
      }
      return replacement;
    });
  }
  out = out.replace(/\s*\b(comma|period)\b(?=[\s.,!?]|$)/gi, (match, word, offset) => {
    const before = out.slice(0, offset).trimEnd().split(/\s+/).pop() || "";
    if (NOT_PUNCT_BEFORE.test(before)) return match;
    const after = out.slice(offset + match.length).trimStart();
    return word.toLowerCase() === "comma" ? "," : after || offset > 0 ? "." : match;
  });
  return out;
}
function assembleEmailsAndUrls(text) {
  let out = text.replace(/\b([a-z0-9._-]+)\s+at\s+([a-z0-9-]+)\s+dot\s+(com|org|net|io|co|ai|dev|app|edu|gov|uk|us)\b(?:\s+dot\s+([a-z]{2,3}))?/gi, (_m, user, host, tld, tld2) => `${user}@${host}.${tld}${tld2 ? `.${tld2}` : ""}`.toLowerCase());
  out = out.replace(/\b((?:https?\s+colon\s+slash\s+slash\s+)?[a-z0-9-]+)\s+dot\s+(com|org|net|io|co|ai|dev|app|edu|gov)\b/gi, (_m, host, tld) => `${host.replace(/\s+colon\s+slash\s+slash\s+/i, "://")}.${tld}`.toLowerCase());
  return out;
}
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
function applyDictionary(text, dictionary) {
  const entries = dictionary.map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return text;
  let out = text;
  for (const entry of entries) {
    if (/\s/.test(entry)) {
      const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), entry);
    }
  }
  const singles = entries.filter((entry) => !/\s/.test(entry));
  if (!singles.length) return out;
  return out.replace(/[A-Za-z][A-Za-z'’-]{3,}/g, (word) => {
    const lower = word.toLowerCase();
    for (const entry of singles) {
      const target = entry.toLowerCase();
      if (lower === target) return entry;
      if (lower[0] === target[0] && lower.length >= 5 && editDistance(lower, target) <= 1) return entry;
    }
    return word;
  });
}
function tidySpacing(text) {
  return text.replace(/[ \t]+([,.;:!?…)])/g, "$1").replace(/\(\s+/g, "(").replace(/([,;:])(?=[^\s\d])/g, "$1 ").replace(/([.!?])(?=[A-Z][a-z])/g, "$1 ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").replace(/,\s*,/g, ",").replace(/^[\s,;:]+/, "").trim();
}
function capitalize(text) {
  let out = text.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, lead, ch) => `${lead}${ch.toUpperCase()}`);
  out = out.replace(/\bi\b(?!['’][a-z]{0})/g, "I");
  return out;
}
function ensureTerminalPunctuation(text, kind) {
  if (!text || /[.!?…:)\]"'`\n-]$/.test(text)) return text;
  const words = text.split(/\s+/).length;
  if (kind === "casual" && words <= 14 && !/[.!?]/.test(text.slice(0, -1))) return text;
  if (kind === "code") return text;
  return /\b(?:who|what|when|where|why|how|is|are|do|does|did|can|could|would|should|will)\b/i.test(text.split(/\s+/)[0] || "") && words <= 18 && !/[.]/.test(text) ? `${text}?` : `${text}.`;
}
const NEEDS_MODEL = /\b(?:actually|i mean|no wait|wait no|scratch that|sorry,|rather|on second thought|let me rephrase|correction)\b/i;
function cleanDictation(input, options = {}) {
  const level = options.level ?? "light";
  const kind = classifyApp(options.application);
  const original = String(input || "").trim();
  if (!original || level === "raw") return { text: original, changed: false, kind, needsModel: false };
  let text = original;
  text = removeFillers(text);
  text = applyCorrections(text);
  if (kind !== "code") text = removeStutters(text);
  if (kind !== "code") text = applySpokenPunctuation(text);
  text = assembleEmailsAndUrls(text);
  text = applyDictionary(text, options.dictionary || []);
  text = tidySpacing(text);
  if (kind !== "code") {
    text = capitalize(text);
    text = ensureTerminalPunctuation(text, kind);
  }
  return { text, changed: text !== original, kind, needsModel: NEEDS_MODEL.test(original) || level === "polished" };
}
export {
  classifyApp,
  cleanDictation
};
