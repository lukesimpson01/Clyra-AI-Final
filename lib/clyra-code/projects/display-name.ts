/**
 * Stable human-readable project labels for the Clyra Code workspace.
 *
 * The project list may have a temporary prompt/placeholder as its stored name.
 * Derive a display-only label from the project's own manifest or HTML title
 * without ever modifying the persisted project name or ID.
 */

export type ProjectDisplayNameInput = {
  name: string;
  renamedByUser?: boolean;
  packageName?: string | null;
  htmlTitle?: string | null;
};

function clean(value: unknown, max = 90): string {
  return typeof value === "string"
    ? value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

/** Extract a safe text title from an HTML entry point; no HTML is executed. */
export function htmlTitleOf(html: string): string | undefined {
  const match = /<title(?:\s+[^>]*)?>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return undefined;
  const title = clean(match[1].replace(/<[^>]*>/g, "").replace(/&(?:amp|#38);/gi, "&").replace(/&(?:lt|#60);/gi, "<").replace(/&(?:gt|#62);/gi, ">").replace(/&(?:quot|#34);/gi, '"').replace(/&#39;|&apos;/gi, "'"));
  return title || undefined;
}

function placeholder(value: string): boolean {
  return !value
    || /^(?:untitled(?:\s+project)?|new\s+(?:vibe\s+)?project|vibe\s+project|new\s+app|my\s+app|react\s+app|vite(?:\s*\+\s*react)?|clyra(?:\s+project)?)$/i.test(value)
    || /^(?:build|make|create|develop|generate|design)\s+(?:me\s+)?(?:a|an|the|my)\s+/i.test(value);
}

function usefulTitle(value: string) {
  const v = clean(value);
  return v && !placeholder(v) && !/^(?:localhost|index|home|untitled|vite\s*\+\s*react)$/i.test(v) ? v : "";
}

function packageToLabel(value: string) {
  const last = clean(value).replace(/^@[^/]+\//, "");
  if (!last || placeholder(last)) return "";
  return last.replace(/[-_]+/g, " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function displayNameFor(input: ProjectDisplayNameInput): string {
  const stored = clean(input.name);
  if (input.renamedByUser && stored) return stored;
  if (!placeholder(stored)) return stored;
  return usefulTitle(input.htmlTitle ?? "")
    || packageToLabel(input.packageName ?? "")
    || stored
    || "Untitled project";
}
