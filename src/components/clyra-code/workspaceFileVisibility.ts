/**
 * User-facing file explorer policy. This is presentation-only: it never
 * deletes or rewrites agent instructions needed by the coding harness.
 */
export function shouldShowWorkspaceFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  const hiddenDirectories = new Set([".git", ".agent", ".agents", ".clyra", ".opencode", "node_modules"]);
  if (segments.some((segment) => hiddenDirectories.has(segment.toLowerCase()))) return false;
  if (segments.some((segment) => /^(?:AGENTS|CLAUDE|SOUL|SYSTEM_PROMPT)\.md$/i.test(segment))) return false;
  return true;
}
