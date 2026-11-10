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
const NUMBER_WORDS = new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred".split(" "));
const isNumberWord = (word) => {
  const w = word.toLowerCase().replace(/[^\p{L}\p{N}:.]/gu, "").replace(/\.$/, "");
  return /^\d+(?:[.:]\d+)?(?:[ap]\.?m\.?)?$/i.test(w) || NUMBER_WORDS.has(w);
};
const STOP_AFTER_NUMBER = new Set("and or so but then to for at in on the a an it that this".split(" "));
const CORRECTION_CUE = /\s*[,.]?\s+(?:actually|no[,.]? wait|wait[,.]? no|i mean|make that|or rather|rather|sorry|correction)[,.]?\s+/i;

/**
 * "set a timer for 5 minutes, actually 6" -> "set a timer for 6 minutes"
 * "let's meet at 5pm, actually let's do 6pm" -> "let's meet at 6pm"
 * The correction swaps the last number (and its unit, if you gave a new one) in what came before.
 */
function applyNumberCorrections(text) {
  const sentenceCue = new RegExp(`([^.!?]*?)${CORRECTION_CUE.source}([^.!?]+)`, "gi");
  return text.replace(sentenceCue, (match, before, after) => {
    // The correction is only the clause that follows the cue ("actually six"); whatever comes after a
    // comma or conjunction ("..., and remind me to call Priya") is a new thought and must survive untouched.
    const split = String(after).match(/^(.*?)(\s*(?:,|;|\s(?:and|but|then|so|also|because|while)\s)[\s\S]*)$/i);
    const head = split ? split[1] : after;
    const rest = split ? split[2] : "";
    const b = before.trim().split(/\s+/);
    const a = head.trim().split(/\s+/);
    if (a.length > 6 || !b.length) return match;
    let ai = -1;
    for (let i = a.length - 1; i >= 0; i -= 1) if (isNumberWord(a[i])) { ai = i; break; }
    let bi = -1;
    for (let i = b.length - 1; i >= 0; i -= 1) if (isNumberWord(b[i])) { bi = i; break; }
    if (ai < 0 || bi < 0) return match;
    // The new number must be (nearly) the end of the correction, otherwise it is a different sentence.
    const trailing = a.slice(ai + 1);
    if (trailing.length > 1 || (trailing[0] && STOP_AFTER_NUMBER.has(trailing[0].toLowerCase().replace(/[^\p{L}]/gu, "")))) return match;
    const unitAfter = trailing[0];
    const replaced = [...b];
    // New unit given ("6 hours") replaces number+old unit; otherwise only the number changes.
    const oldUnit = b[bi + 1] && !STOP_AFTER_NUMBER.has(b[bi + 1].toLowerCase().replace(/[^\p{L}]/gu, "")) ? 1 : 0;
    replaced.splice(bi, unitAfter ? 1 + oldUnit : 1, unitAfter ? `${a[ai]} ${unitAfter}` : a[ai]);
    return replaced.join(" ") + rest;
  });
}

function applyCorrections(text) {
  text = applyNumberCorrections(text);
  let out = text;
  out = out.replace(/(?:^|[.!?]\s+)([^.!?]*?[.!?]?)\s*(?:scratch that|delete that|ignore that|never mind that)[.!?,]?\s*/gi, (_m, _prev, offset) => offset === 0 ? "" : ". ");
  // "<before> no wait <after>": drop the part of <before> that the correction replaces.
  //  - If <after> starts with a word that also appears in <before> ("... to Sam, no wait, to Priya"),
  //    cut <before> at that word's last occurrence and keep everything earlier intact.
  //  - Otherwise replace only the trailing words of <before> (at most as many as <after> has, max 3).
  out = out.replace(/([^.;!?]+?)[,.]?\s+(?:no[,.]? wait|wait[,.]? no|actually[,.]? no|sorry|correction)[,.]?\s+([^.!?]+)/gi, (_match, before, after) => {
    const lead = before.trim().split(/\s+/);
    const tail = after.trim().split(/\s+/);
    const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    const anchor = norm(tail[0] || "");
    let cut = -1;
    if (anchor) {
      for (let i = lead.length - 1; i > 0; i -= 1) {
        if (norm(lead[i]) === anchor) { cut = i; break; }
      }
    }
    if (cut < 0) cut = Math.max(0, lead.length - Math.min(tail.length, 3, lead.length));
    return `${lead.slice(0, cut).join(" ")} ${after.trim()}`.trim();
  });
  // ", actually to Priya" / ", I mean at six pm": a softer cue, so only act when it clearly
  // restarts a phrase the earlier part also contained (shared anchor word).
  out = out.replace(/([^.;!?]+?),\s*(?:actually|i mean|or rather|make that)[,.]?\s+([^.!?]+)/gi, (match, before, after) => {
    const lead = before.trim().split(/\s+/);
    const tail = after.trim().split(/\s+/);
    const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
    const anchor = norm(tail[0] || "");
    if (!anchor || tail.length > 8) return match;
    for (let i = lead.length - 1; i > 0; i -= 1) if (norm(lead[i]) === anchor) return `${lead.slice(0, i).join(" ")} ${after.trim()}`.trim();
    return match;
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
// Speech models sometimes title-case ordinary words mid-sentence ("Hi, How are You?"). Only a closed list of
// function words that are never names is lowered, never at the start of a sentence or line, and never when the
// next word is a capitalised name ("The Hobbit", "Of Mice And Men"), which is how a title or proper noun begins.
const NEVER_CAPITAL = new Set("how you are is was were the a an and or but to of in on at for with what when where why who do does did could would should we they he she it my your our their this that these those not have has had so if then than as by from about".split(" "));
function fixStrayCapitals(text) {
  const tokens = text.split(/(\s+)/);
  const bare = (token) => String(token || "").replace(/^["'(\[]+|[,.;:!?"')\]]+$/g, "");
  for (let i = 2; i < tokens.length; i += 2) {
    const token = tokens[i];
    const word = bare(token);
    if (!/^[A-Z][a-z]+$/.test(word) || !NEVER_CAPITAL.has(word.toLowerCase())) continue;
    if (/[.!?…:]["')\]]?$/.test(tokens[i - 2] || "") || /\n/.test(tokens[i - 1]) || /^["'(\[]/.test(token)) continue;
    const next = bare(tokens[i + 2]);
    if (/^[A-Z]/.test(next) && !NEVER_CAPITAL.has(next.toLowerCase()) && next !== "I") continue;
    const at = token.indexOf(word);
    tokens[i] = token.slice(0, at) + word[0].toLowerCase() + token.slice(at + 1);
  }
  return tokens.join("");
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
    text = fixStrayCapitals(text);
    text = capitalize(text);
    text = ensureTerminalPunctuation(text, kind);
  }
  return { text, changed: text !== original, kind, needsModel: NEEDS_MODEL.test(text) || level === "polished" };
}
// With text selected, speech is either replacement text ("see you at six") or an instruction for the
// selection ("make it sound smarter", "make it longer", "translate to French"). Instructions are short
// and open with an editing verb or an "it/this" request; anything else just replaces the selection.
const INSTRUCTION_VERBS = "make|rewrite|rephrase|reword|reply|respond|shorten|lengthen|expand|elaborate|condense|summari[sz]e|simplify|clarify|improve|enhance|polish|proofread|fix|correct|translate|convert|turn|change|edit|revise|tweak|tighten|soften|formali[sz]e|humani[sz]e|capitali[sz]e|uppercase|lowercase|bold|italici[sz]e|format|add|remove|delete|replace|insert|continue|finish|complete|shorter|longer|clearer|better|smarter|funnier|nicer|more|less|sound|use|write|expand|bullet|list|organi[sz]e|restructure|paraphrase|spell|check|can you|could you|please|would you";
const INSTRUCTION_RE = new RegExp(`^(?:(?:ok(?:ay)?|hey|clyra|so|now|and|then)[ ,]+)?(?:${INSTRUCTION_VERBS})\\b`, "i");
function looksLikeInstruction(spoken) {
  const text = String(spoken || "").trim().replace(/[.!?]+$/g, "");
  if (!text) return false;
  const words = text.split(/\s+/).length;
  if (words > 24) return false;
  if (!INSTRUCTION_RE.test(text)) return false;
  // "Add milk to the list" or "Replace the filter" can also be plain sentences: require an object that
  // refers to the selection, or a clearly editorial request, for the ambiguous verbs.
  if (/^(?:add|remove|delete|replace|insert|use|write|check|list|bold|format|more|less|sound|turn|change|fix|correct|continue|finish|complete)\b/i.test(text)) {
    return /\b(?:it|this|that|these|those|selection|selected|text|sentence|paragraph|message|email|wording|tone|here|everything)\b/i.test(text) || /\b(?:shorter|longer|formal|casual|friendly|professional|polite|clearer|concise|detail|punctuation|grammar|spelling|bullets?|capital|caps)\b/i.test(text);
  }
  return true;
}
export {
  classifyApp,
  cleanDictation,
  looksLikeInstruction
};
