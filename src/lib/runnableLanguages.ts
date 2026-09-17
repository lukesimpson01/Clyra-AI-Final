/** Language metadata for the chat's fenced-code-block header (display name + how to run it in a real shell). */
type LanguageInfo = {
  displayName: string;
  /** File extension used for the scratch file written before running. Omit for non-runnable languages. */
  ext?: string;
  /** Builds the shell command that executes a file at the given path. */
  command?: (filePath: string) => string;
};

const LANGUAGE_INFO: Record<string, LanguageInfo> = {
  python: { displayName: "Python", ext: "py", command: (p) => `python3 ${p}` },
  python3: { displayName: "Python", ext: "py", command: (p) => `python3 ${p}` },
  py: { displayName: "Python", ext: "py", command: (p) => `python3 ${p}` },
  javascript: { displayName: "JavaScript", ext: "js", command: (p) => `node ${p}` },
  js: { displayName: "JavaScript", ext: "js", command: (p) => `node ${p}` },
  mjs: { displayName: "JavaScript", ext: "mjs", command: (p) => `node ${p}` },
  // JSX/TSX depend on an application bundler and its module graph. Showing a
  // terminal Run control for a scratch file would be a false promise; their
  // source is still copyable and readable like it is in Clyra Notes.
  jsx: { displayName: "JSX" },
  typescript: { displayName: "TypeScript", ext: "ts", command: (p) => `npx --yes tsx ${p}` },
  ts: { displayName: "TypeScript", ext: "ts", command: (p) => `npx --yes tsx ${p}` },
  tsx: { displayName: "TSX" },
  bash: { displayName: "Bash", ext: "sh", command: (p) => `bash ${p}` },
  sh: { displayName: "Shell", ext: "sh", command: (p) => `bash ${p}` },
  shell: { displayName: "Shell", ext: "sh", command: (p) => `bash ${p}` },
  zsh: { displayName: "Zsh", ext: "sh", command: (p) => `zsh ${p}` },
  ruby: { displayName: "Ruby", ext: "rb", command: (p) => `ruby ${p}` },
  rb: { displayName: "Ruby", ext: "rb", command: (p) => `ruby ${p}` },
  go: { displayName: "Go", ext: "go", command: (p) => `go run ${p}` },
  php: { displayName: "PHP", ext: "php", command: (p) => `php ${p}` },
  perl: { displayName: "Perl", ext: "pl", command: (p) => `perl ${p}` },
  r: { displayName: "R", ext: "R", command: (p) => `Rscript ${p}` },
  swift: { displayName: "Swift", ext: "swift", command: (p) => `swift ${p}` },
  json: { displayName: "JSON" },
  jsonc: { displayName: "JSON" },
  html: { displayName: "HTML" },
  xml: { displayName: "XML" },
  css: { displayName: "CSS" },
  scss: { displayName: "SCSS" },
  yaml: { displayName: "YAML" },
  yml: { displayName: "YAML" },
  markdown: { displayName: "Markdown" },
  md: { displayName: "Markdown" },
  sql: { displayName: "SQL", ext: "sql", command: (p) => `sqlite3 :memory: < ${p}` },
  diff: { displayName: "Diff" },
  patch: { displayName: "Diff" },
  plaintext: { displayName: "Text" },
  text: { displayName: "Text" },
  txt: { displayName: "Text" },
};

export function getLanguageDisplayName(language: string | undefined): string {
  if (!language) return "Text";
  const info = LANGUAGE_INFO[language.toLowerCase()];
  if (info) return info.displayName;
  return language.length <= 4 ? language.toUpperCase() : language[0].toUpperCase() + language.slice(1);
}

export function isRunnableLanguage(language: string | undefined): boolean {
  if (!language) return false;
  return Boolean(LANGUAGE_INFO[language.toLowerCase()]?.command);
}

/** Languages Clyra Notes opens in its isolated live-preview surface rather
 * than sending to the shell. Keep this next to the runner table so Chat and
 * Notes expose the same code-block affordances. */
export function isPreviewableLanguage(language: string | undefined): boolean {
  return ["html", "svg", "css"].includes(String(language || "").toLowerCase());
}

/** Builds the exact text to send to a real shell: writes the snippet to a scratch file, then runs it. */
export function buildRunScript(language: string, code: string): string | null {
  const info = LANGUAGE_INFO[language.toLowerCase()];
  if (!info?.command || !info.ext) return null;
  const filePath = `/tmp/clyra-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${info.ext}`;
  const marker = "CLYRA_EOF";
  return [
    `cat > ${filePath} << '${marker}'`,
    code,
    marker,
    info.command(filePath),
    "",
  ].join("\n");
}
