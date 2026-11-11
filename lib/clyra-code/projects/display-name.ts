/**
 * Human-friendly project titles returned by Clyra Code.
 * Pure helper: it reads no files and never changes a saved project name.
 */
type DisplayNameCandidate = {
  name: string;
  renamedByUser?: boolean;
  packageName?: string | null;
  htmlTitle?: string | null;
};
const GENERIC_NAMES = new Set([
  "untitled", "untitled project", "new project", "vite + react",
  "vite + react + ts", "vite + typescript", "react app",
  "react + vite", "my app", "app", "index",
]);
const decodeEntities = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, code: string) => {
  const key = code.toLowerCase();
  const map: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  if (map[key]) return map[key];
  const numeric = key.startsWith("#x") ? Number.parseInt(key.slice(2), 16)
    : key.startsWith("#") ? Number.parseInt(key.slice(1), 10) : NaN;
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 0x10ffff
    ? String.fromCodePoint(numeric) : _match;
});
const clean = (value?: string | null) => decodeEntities(String(value ?? ""))
  .replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ").trim().slice(0, 96);

export function htmlTitleOf(html: string): string | undefined {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html || ""))?.[1];
  const cleaned = clean(title);
  return cleaned || undefined;
}

/** Honour explicit user renames; otherwise prefer the app's meaningful display title. */
export function displayNameFor(entry: DisplayNameCandidate): string {
  const original = clean(entry.name);
  if (entry.renamedByUser && original) return original;
  const title = clean(entry.htmlTitle);
  if (title && !GENERIC_NAMES.has(title.toLowerCase())) return title;
  const packageName = clean(entry.packageName).replace(/^@[^/]+\//, "").replace(/[-_]+/g, " ");
  if (packageName && !GENERIC_NAMES.has(packageName.toLowerCase())) return packageName;
  return original || "Untitled project";
}
