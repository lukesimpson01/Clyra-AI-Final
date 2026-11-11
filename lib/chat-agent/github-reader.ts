/**
 * Public GitHub reader for Clyra Chat. Only reads github.com repository
 * metadata and file contents. Private repository access and write operations
 * must come from an authenticated, approval-aware MCP connector instead.
 */
export type PublicRepoReference = { owner: string; name: string; fullName: string };

const REPO_PART = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const OWNER_PART = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const BAD_SEGMENT = /(^|\/)(?:\.\.?|\.git|\.env(?:\..*)?|id_rsa|id_ed25519|cookies|login data|local state|.*\.pem|.*\.key)(?:\/|$)/i;
const PRIVATE_PROFILE = /(^|\/)(?:\.chromium-google-profile|\.agentic-browser-profile|\.playwright-auth|playwright\/\.auth)(?:\/|$)/i;

/** Accept an explicit owner/repo or a link to a public GitHub repository.
 * Reject unrelated hosts and dangerous path components. */
export function parsePublicRepo(input: string): PublicRepoReference | null {
  let name = input.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (/^https?:\/\//i.test(name)) {
    try {
      const url = new URL(name);
      if (url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.port) return null;
      name = url.pathname.replace(/^\//, "").split("/").slice(0, 2).join("/");
    } catch { return null; }
  }
  const parts = name.split("/");
  if (parts.length !== 2 || !OWNER_PART.test(parts[0]) || !REPO_PART.test(parts[1])) return null;
  return { owner: parts[0], name: parts[1], fullName: parts.join("/") };
}

export function isSafePublicCodePath(value: string): boolean {
  const path = String(value || "").trim();
  return path.length > 0 && path.length <= 500 && !path.startsWith("/")
    && !path.includes("\\") && !path.includes("\0")
    && !PRIVATE_PROFILE.test(path) && !BAD_SEGMENT.test(path)
    && path.split("/").every((segment) => segment && !segment.startsWith("."));
}

function githubHeaders(): HeadersInit {
  return { "Accept": "application/vnd.github+json", "User-Agent": "Clyra-Agent-Public-Reader", "X-GitHub-Api-Version": "2022-11-28" };
}

async function githubGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  // The host and path are constructed exclusively from validated input.
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: githubHeaders(),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Repository or file was not found, or it is private. Connect GitHub for private repositories.");
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub's unauthenticated read limit has been reached. Connect GitHub to continue.");
    throw new Error(`GitHub returned HTTP ${response.status}.`);
  }
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 6_000_000) throw new Error("The GitHub response is too large for a safe Chat preview.");
  const raw = await response.text();
  if (raw.length > 6_000_000) throw new Error("The GitHub response exceeded the safe reading limit.");
  return JSON.parse(raw) as T;
}

export async function inspectPublicGitHubRepo(repo: string, focus = "", signal?: AbortSignal) {
  const parsed = parsePublicRepo(repo);
  if (!parsed) throw new Error("Give a public GitHub repository as owner/name or github.com/owner/name.");
  type Metadata = { full_name: string; html_url: string; description: string | null; default_branch: string; updated_at: string; private: boolean; archived: boolean; size: number };
  const meta = await githubGet<Metadata>(`repos/${parsed.owner}/${parsed.name}`, signal);
  if (meta.private) throw new Error("This repository is private. Use an authenticated GitHub connection.");
  let paths: string[] = [];
  let treeTruncated = false;
  let treeError: string | undefined;
  try {
    const tree = await githubGet<{ tree?: Array<{ path: string; type: string }>; truncated?: boolean }>(
      `repos/${parsed.owner}/${parsed.name}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`, signal);
    paths = (tree.tree || []).filter((item) => item.type === "blob" && isSafePublicCodePath(item.path)).map((item) => item.path);
    treeTruncated = Boolean(tree.truncated);
  } catch (error) {
    treeError = error instanceof Error ? error.message : "Could not list files.";
  }
  const tokens = focus.toLowerCase().split(/[^a-z0-9]+/g).filter((word) => word.length > 2).slice(0, 10);
  const scored = paths.map((path) => ({
    path,
    score: tokens.reduce((sum, token) => sum + (path.toLowerCase().includes(token) ? 1 : 0), 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  const shortlist = scored.filter((item) => item.score > 0).slice(0, 75).map((item) => item.path);
  const entryFiles = paths.filter((path) => /^(README(?:\.md)?|package\.json|AGENTS\.md|src\/App\.tsx|server\.ts|lib\/chat-agent\/agent\.ts)$/i.test(path)).slice(0, 16);
  return {
    repository: meta.full_name,
    url: meta.html_url,
    description: meta.description,
    defaultBranch: meta.default_branch,
    updatedAt: meta.updated_at,
    archived: meta.archived,
    approxRepoSizeKB: meta.size,
    totalPublicReadableFiles: paths.length,
    treeTruncated,
    treeError,
    keyFiles: entryFiles,
    matchingPaths: shortlist.length ? shortlist : scored.slice(0, 65).map((item) => item.path),
    note: "Read specific paths with github_public_file before making code-specific claims. This public reader cannot inspect private repositories or commit changes.",
  };
}

export async function readPublicGitHubFile(repo: string, filePath: string, ref?: string, signal?: AbortSignal) {
  const parsed = parsePublicRepo(repo);
  if (!parsed) throw new Error("Give a public GitHub repository as owner/name or github.com/owner/name.");
  if (!isSafePublicCodePath(filePath)) throw new Error("A normal non-secret relative file path is required.");
  if (ref && (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,119}$/.test(ref) || ref.includes("..") || ref.includes("//"))) {
    throw new Error("Invalid Git branch or tag name.");
  }
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const file = await githubGet<{ type: string; name: string; path: string; sha: string; size: number; encoding: string; content?: string; html_url: string }>(
    `repos/${parsed.owner}/${parsed.name}/contents/${encodedPath}${query}`, signal);
  if (file.type !== "file" || file.encoding !== "base64" || !file.content) {
    throw new Error("GitHub did not return a readable UTF-8 file. Binary or large files are unsupported.");
  }
  if (file.size > 750_000) throw new Error("File is too large for a bounded Chat read.");
  const decoded = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (decoded.includes("\0")) throw new Error("This is not a readable text file.");
  const lines = decoded.split("\n");
  const max = 350;
  return {
    repo: parsed.fullName,
    path: file.path,
    sha: file.sha,
    url: file.html_url,
    totalLines: lines.length,
    truncated: lines.length > max,
    content: lines.slice(0, max).map((line, i) => `${i + 1}: ${line}`).join("\n").slice(0, 25_000),
    note: lines.length > max ? "Only the first 350 lines are shown. For complete analysis inspect smaller linked files or a specific section." : undefined,
  };
}
