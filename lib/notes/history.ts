/* Version history, powered by git.

   Notes keeps one small repository beside its database. Every time a change
   is accepted from chat, the page is committed twice: the state it was in
   before, and the state after. The commit message carries the chat message it
   came from, so any message that changed a note can open exactly what that
   note looked like then, see what changed, and restore it. Each page is
   stored as lossless JSON (for faithful previews and restores) next to a
   readable markdown rendering (for diffs). */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as store from "./store";
import { dbPath } from "./schema";
import type { Block } from "./blocks";

const repo = path.join(path.dirname(dbPath), "history");
let ready: boolean | null = null;

const git = (args: string[], input?: string) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

function ensure(): boolean {
  if (ready !== null) return ready;
  try {
    fs.mkdirSync(path.join(repo, "pages"), { recursive: true });
    if (!fs.existsSync(path.join(repo, ".git"))) {
      execFileSync("git", ["init", "-q", repo], { stdio: "ignore" });
      git(["config", "user.name", "Clyra Notes"]);
      git(["config", "user.email", "notes@clyra.local"]);
      git(["config", "commit.gpgsign", "false"]);
    }
    ready = true;
  } catch { ready = false; }
  return ready;
}

export type Version = { sha: string; at: string; label: string; messageId?: string; chatId?: string; editId?: string; kind?: string };

export function snapshot(pageId: string, label: string, meta: Record<string, unknown> = {}): { ok: true; sha: string | null } | { ok: false; error: string } {
  if (!ensure()) return { ok: false, error: "Version history needs git, which was not found." };
  const page = store.getPage(pageId) as Record<string, unknown> | null;
  if (!page) return { ok: false, error: "That page does not exist." };
  try {
    const blocks = store.blockTree(pageId);
    const md = store.pageMarkdown(pageId) ?? "";
    fs.writeFileSync(path.join(repo, "pages", `${pageId}.json`), JSON.stringify({ title: page.title || "Untitled", icon: page.icon ?? null, blocks }, null, 1));
    fs.writeFileSync(path.join(repo, "pages", `${pageId}.md`), md);
    git(["add", "--", `pages/${pageId}.json`, `pages/${pageId}.md`]);
    /* An unchanged page has nothing to commit; the latest version still stands for this label. */
    try { git(["diff", "--cached", "--quiet"]); return { ok: true, sha: latest(pageId)?.sha ?? null }; } catch { /* there are staged changes */ }
    git(["commit", "-q", "-m", `${label.slice(0, 120)}\n\n${JSON.stringify({ pageId, ...meta })}`]);
    return { ok: true, sha: git(["rev-parse", "HEAD"]).trim() };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "Could not record that version." }; }
}

const parse = (line: string): Version | null => {
  const [sha, at, subject, body] = line.split("\u001f");
  if (!sha) return null;
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse((body || "").trim().split("\n").pop() || "{}"); } catch { /* label only */ }
  return { sha, at: at!, label: subject || "Version", messageId: meta.messageId as string | undefined, chatId: meta.chatId as string | undefined, editId: meta.editId as string | undefined, kind: meta.kind as string | undefined };
};

export function list(pageId: string, limit = 80): Version[] {
  if (!ensure()) return [];
  try {
    const out = git(["log", `-n${limit}`, "--format=%H%x1f%aI%x1f%s%x1f%b%x1e", "--", `pages/${pageId}.json`]);
    return out.split("\u001e").map((chunk) => parse(chunk.trim())).filter(Boolean) as Version[];
  } catch { return []; }
}
const latest = (pageId: string) => list(pageId, 1)[0] ?? null;

export function read(pageId: string, sha: string) {
  if (!ensure() || !/^[0-9a-f]{7,40}$/.test(sha)) return null;
  try {
    const parsed = JSON.parse(git(["show", `${sha}:pages/${pageId}.json`]));
    const markdown = git(["show", `${sha}:pages/${pageId}.md`]);
    let before = "";
    try { before = git(["show", `${sha}~1:pages/${pageId}.md`]); } catch { /* first version */ }
    return { ...parsed, markdown, previous: before, version: list(pageId, 200).find((v) => v.sha.startsWith(sha)) ?? null };
  } catch { return null; }
}

export function restore(pageId: string, sha: string) {
  const version = read(pageId, sha) as { blocks: Block[] } | null;
  if (!version) return { ok: false as const, error: "That version could not be read." };
  const before = snapshot(pageId, "Before restoring an earlier version", { kind: "restore-guard" });
  if (!before.ok) return { ok: false as const, error: before.error };
  store.saveBlocks(pageId, version.blocks);
  const after = snapshot(pageId, "Restored an earlier version", { kind: "restore", from: sha });
  return { ok: true as const, sha: after.ok ? after.sha : null };
}
