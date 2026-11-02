import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
/* Clyra Notes data access.

   Everything the workspace can do goes through this module so the Express
   layer stays a thin transport and the same operations can later be reused
   by the desktop shell without a second implementation. */
import path from "node:path";
import { promises as fs } from "node:fs";
import { openNotesDb, newId, dbPath, type DB } from "./schema";
import {
  blocksToMarkdown, markdownToBlocks, parseSpans, spanText, plain,
  type Block, type BlockType, type DraftBlock, type Span,
} from "./blocks";
import { schedule, previewIntervals, type Rating, type SchedulerCard } from "./fsrs";
import { runFormula, checkFormula, type FormulaValue } from "./formula";

let db: DB;

export async function initNotesStore() {
  db = await openNotesDb();
  migrateMarkdownIntoBlocks();
  tidyMigratedPages();
  convertLegacyTables();
  reindexIfEmpty();
}

const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");
const json = (value: unknown) => JSON.stringify(value ?? null);
const unjson = <T,>(raw: unknown, fallback: T): T => {
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(String(raw)) as T; } catch { return fallback; }
};

/* ---------------------------------------------------------------- blocks */

const rowToBlock = (row: Record<string, unknown>): Block => ({
  id: String(row.id),
  page_id: String(row.page_id),
  parent_id: row.parent_id ? String(row.parent_id) : null,
  type: String(row.type) as BlockType,
  text: parseSpans(row.text),
  props: unjson<Record<string, unknown>>(row.props, {}),
  sort: Number(row.sort),
});

export function blockTree(pageId: string): Block[] {
  const rows = db
    .prepare("SELECT * FROM blocks WHERE page_id=? ORDER BY sort")
    .all(pageId) as Array<Record<string, unknown>>;
  const blocks = rows.map(rowToBlock);
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const roots: Block[] = [];
  for (const block of blocks) {
    const parent = block.parent_id ? byId.get(block.parent_id) : null;
    if (parent) (parent.children ??= []).push(block);
    else roots.push(block);
  }
  return roots;
}

const flatten = (blocks: Block[], pageId: string, parentId: string | null = null): Block[] =>
  blocks.flatMap((block, index) => {
    const own = { ...block, page_id: pageId, parent_id: parentId, sort: index };
    return [own, ...flatten(block.children ?? [], pageId, block.id)];
  });

/* The editor sends the whole tree for the page it is editing. Replacing the
   page's blocks in one transaction keeps ordering and nesting consistent and
   removes any need for the client to send fine-grained move operations. */
export function saveBlocks(pageId: string, tree: Block[]) {
  const flat = flatten(tree, pageId);
  const insert = db.prepare(
    `INSERT INTO blocks(id,page_id,parent_id,type,text,props,sort,updated_at)
     VALUES(?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id, type=excluded.type,
       text=excluded.text, props=excluded.props, sort=excluded.sort, updated_at=datetime('now')`,
  );
  db.transaction(() => {
    const keep = new Set(flat.map((block) => block.id));
    const existing = db.prepare("SELECT id FROM blocks WHERE page_id=?").all(pageId) as Array<{ id: string }>;
    const remove = db.prepare("DELETE FROM blocks WHERE id=?");
    for (const row of existing) if (!keep.has(row.id)) remove.run(row.id);
    /* Parents are written before children so the self-referencing foreign
       key holds at every point inside the transaction. */
    for (const block of flat) {
      insert.run(block.id, pageId, block.parent_id, block.type, json(block.text), json(block.props), block.sort);
    }
    db.prepare("UPDATE pages2 SET updated_at=datetime('now') WHERE id=?").run(pageId);
  })();
  indexPage(pageId);
  rebuildLinks(pageId, flat);
  return blockTree(pageId);
}

/* Which pages this one points at, and which point back. Both directions are
   useful in the same panel: what a note builds on, and what builds on it. */
export function pageLinks(pageId: string) {
  const rows = (sql: string) =>
    db.prepare(sql).all(pageId) as Array<{ id: string; title: string; icon: string | null }>;
  const unique = (list: Array<{ id: string; title: string; icon: string | null }>) => {
    const seen = new Set<string>();
    return list.filter((row) => row.id !== pageId && !seen.has(row.id) && seen.add(row.id));
  };
  return {
    outgoing: unique(rows(
      `SELECT DISTINCT p.id, p.title, p.icon FROM page_links l
         JOIN pages2 p ON p.id = l.target_page
        WHERE l.source_page = ? AND p.trashed_at IS NULL`,
    )),
    incoming: unique(rows(
      `SELECT DISTINCT p.id, p.title, p.icon FROM page_links l
         JOIN pages2 p ON p.id = l.source_page
        WHERE l.target_page = ? AND p.trashed_at IS NULL`,
    )),
  };
}

/* ---------------------------------------------------------- search index */

function pageBody(pageId: string) {
  const rows = db.prepare("SELECT text FROM blocks WHERE page_id=? ORDER BY sort").all(pageId) as Array<{ text: string }>;
  return rows.map((row) => spanText(parseSpans(row.text))).filter(Boolean).join("\n");
}

function indexPage(pageId: string) {
  const page = db.prepare("SELECT title, kind, trashed_at FROM pages2 WHERE id=?").get(pageId) as
    | { title: string; kind: string; trashed_at: string | null }
    | undefined;
  db.prepare("DELETE FROM search_fts WHERE page_id=?").run(pageId);
  if (!page || page.trashed_at) return;
  db.prepare("INSERT INTO search_fts(title,body,kind,page_id,block_id) VALUES(?,?,?,?,NULL)")
    .run(page.title || "Untitled", pageBody(pageId), page.kind, pageId);
  const insertBlock = db.prepare("INSERT INTO search_fts(title,body,kind,page_id,block_id) VALUES(?,?,'block',?,?)");
  const blocks = db.prepare("SELECT id,text FROM blocks WHERE page_id=?").all(pageId) as Array<{ id: string; text: string }>;
  db.transaction(() => {
    for (const block of blocks) {
      const text = spanText(parseSpans(block.text));
      if (text.trim()) insertBlock.run(page.title || "Untitled", text, pageId, block.id);
    }
  })();
}

function reindexIfEmpty() {
  const count = db.prepare("SELECT count(*) AS n FROM search_fts").get() as { n: number };
  if (count.n) return;
  const pages = db.prepare("SELECT id FROM pages2 WHERE trashed_at IS NULL").all() as Array<{ id: string }>;
  for (const page of pages) indexPage(page.id);
}

/* --------------------------------------------------------------- links */

function rebuildLinks(pageId: string, blocks: Block[]) {
  db.prepare("DELETE FROM page_links WHERE source_page=?").run(pageId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO page_links(source_page,source_block,target_page) VALUES(?,?,?)",
  );
  const byTitle = db.prepare("SELECT id FROM pages2 WHERE lower(title)=lower(?) AND trashed_at IS NULL LIMIT 1");
  db.transaction(() => {
    for (const block of blocks) {
      const targets = new Set<string>();
      for (const span of block.text as Span[]) {
        if (!span.page) continue;
        if (span.page.startsWith("title:")) {
          const match = byTitle.get(span.page.slice(6)) as { id: string } | undefined;
          if (match) targets.add(match.id);
        } else targets.add(span.page);
      }
      const linked = block.props?.pageId;
      if (typeof linked === "string") targets.add(linked);
      for (const target of targets) if (target !== pageId) insert.run(pageId, block.id, target);
    }
  })();
}

/* --------------------------------------------------------------- pages */

const PAGE_COLUMNS =
  "id,parent_id,kind,database_id,title,icon,cover,cover_offset,class_id,favorite,locked,full_width,text_size,font_style,colour_categories,sort,trashed_at,created_at,updated_at";

/** Whether a page's lock needs a password to open (the hash itself never leaves the database). */
const withLockInfo = (page: Record<string, unknown>) => {
  const row = db.prepare("SELECT lock_hash FROM pages2 WHERE id=?").get(String(page.id)) as { lock_hash?: string | null } | undefined;
  return { ...page, lock_has_password: Boolean(row?.lock_hash) };
};

const hashPassword = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");

export type LockKind = "pin6" | "pin8" | "password";

/** What a passcode must satisfy before it is accepted: the server never trusts the form. */
export function validatePasscode(password: string, kind: LockKind): string | null {
  if (kind === "pin6") return /^\d{6}$/.test(password) ? null : "A 6-digit PIN must be exactly six numbers.";
  if (kind === "pin8") return /^\d{8}$/.test(password) ? null : "An 8-digit PIN must be exactly eight numbers.";
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "That password is too long.";
  return null;
}

/** Locks a page, optionally behind a PIN or password. An empty passcode is a plain lock. */
export function lockPage(id: string, password = "", kind: LockKind = "password") {
  const exists = db.prepare("SELECT 1 FROM pages2 WHERE id=?").get(id);
  if (!exists) return null;
  if (password) {
    const problem = validatePasscode(password, kind);
    if (problem) return { error: problem };
    const salt = randomBytes(16).toString("hex");
    db.prepare("UPDATE pages2 SET locked=1, lock_salt=?, lock_hash=?, lock_kind=?, updated_at=datetime('now') WHERE id=?").run(salt, hashPassword(password, salt), kind, id);
  } else {
    db.prepare("UPDATE pages2 SET locked=1, lock_salt=NULL, lock_hash=NULL, lock_kind=NULL, updated_at=datetime('now') WHERE id=?").run(id);
  }
  return getPage(id);
}

/* Wrong attempts are slowed down: after five misses a page refuses further tries for a growing wait, so a short PIN
   cannot simply be guessed through. Kept in memory: a restart clears it, the stored hash is unaffected. */
const attempts = new Map<string, { misses: number; until: number }>();
export function lockWait(id: string) {
  const entry = attempts.get(id);
  return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
}

/** True when the passcode is right, or the page has none. */
export function checkPageLock(id: string, password = "") {
  const row = db.prepare("SELECT lock_hash, lock_salt FROM pages2 WHERE id=?").get(id) as { lock_hash?: string | null; lock_salt?: string | null } | undefined;
  if (!row) return false;
  if (!row.lock_hash || !row.lock_salt) return true;
  if (lockWait(id)) return false;
  const given = Buffer.from(hashPassword(password, row.lock_salt), "hex");
  const stored = Buffer.from(row.lock_hash, "hex");
  const ok = given.length === stored.length && timingSafeEqual(given, stored);
  if (ok) attempts.delete(id);
  else {
    const entry = attempts.get(id) ?? { misses: 0, until: 0 };
    entry.misses += 1;
    if (entry.misses >= 5) entry.until = Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** (entry.misses - 5));
    attempts.set(id, entry);
  }
  return ok;
}

export function unlockPage(id: string, password = "") {
  const wait = lockWait(id);
  if (wait) return { ok: false as const, error: `Too many attempts. Try again in ${wait}s.`, wait };
  if (!checkPageLock(id, password)) {
    const after = lockWait(id);
    return { ok: false as const, error: after ? `Too many attempts. Try again in ${after}s.` : "That passcode is not right.", wait: after };
  }
  db.prepare("UPDATE pages2 SET locked=0, lock_salt=NULL, lock_hash=NULL, lock_kind=NULL, updated_at=datetime('now') WHERE id=?").run(id);
  return { ok: true as const, page: getPage(id) };
}

export function listPages(includeTrashed = false) {
  return db
    .prepare(
      `SELECT ${PAGE_COLUMNS}, (SELECT inline FROM databases d WHERE d.page_id=pages2.id) AS inline FROM pages2 ${includeTrashed ? "" : "WHERE trashed_at IS NULL"} ORDER BY sort, updated_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
}

export function getPage(id: string, opts: { reveal?: boolean } = {}): Record<string, unknown> | null {
  const page = db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages2 WHERE id=?`).get(id) as
    | Record<string, unknown>
    | undefined;
  if (!page) return null;
  const lockRow = db.prepare("SELECT lock_hash, lock_kind FROM pages2 WHERE id=?").get(id) as { lock_hash?: string | null; lock_kind?: string | null } | undefined;
  page.lock_has_password = Boolean(lockRow?.lock_hash);
  page.lock_kind = lockRow?.lock_hash ? lockRow.lock_kind || "password" : null;
  /* A page with a passcode leaves the server empty-handed until the passcode has been checked: no text, title, icon,
     cover or history travels to the browser, so there is nothing to peek at behind the lock screen. */
  if (page.locked && page.lock_has_password && !opts.reveal) {
    return { ...page, title: "", icon: null, cover: null, blocks: [], backlinks: [], breadcrumb: [], database: null, values: null, versions: [], sealed: true };
  }
  const backlinks = db
    .prepare(
      `SELECT DISTINCT p.id, p.title, p.icon FROM page_links l
       JOIN pages2 p ON p.id=l.source_page
       WHERE l.target_page=? AND p.trashed_at IS NULL`,
    )
    .all(id) as Array<Record<string, unknown>>;
  const breadcrumb: Array<Record<string, unknown>> = [];
  let cursor = page.parent_id ? String(page.parent_id) : null;
  const seen = new Set<string>([id]);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = db.prepare("SELECT id,title,icon,parent_id FROM pages2 WHERE id=?").get(cursor) as
      | Record<string, unknown>
      | undefined;
    if (!parent) break;
    breadcrumb.unshift({ id: parent.id, title: parent.title, icon: parent.icon });
    cursor = parent.parent_id ? String(parent.parent_id) : null;
  }
  const database = page.kind === "database"
    ? getDatabaseByPage(id)
    : page.kind === "record" && page.database_id
      ? getDatabase(String(page.database_id))
      : null;
  return {
    ...page,
    blocks: blockTree(id),
    backlinks,
    breadcrumb,
    database,
    values: page.kind === "record" ? recordValues(id) : null,
    versions: db
      .prepare("SELECT id, created_at FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 25")
      .all(id),
  };
}

const nextSort = (parentId: string | null) => {
  const row = db
    .prepare("SELECT coalesce(max(sort),-1) AS m FROM pages2 WHERE parent_id IS ?")
    .get(parentId) as { m: number };
  return row.m + 1;
};

export function createPage(input: Record<string, unknown> = {}) {
  const id = String(input.id || newId());
  db.prepare(
    `INSERT INTO pages2(id,parent_id,kind,database_id,title,icon,cover,class_id,full_width,text_size,font_style,sort)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.parentId ? String(input.parentId) : null,
    String(input.kind || "page"),
    input.databaseId ? String(input.databaseId) : null,
    String(input.title ?? ""),
    (input.icon as string) || null,
    (input.cover as string) || null,
    input.classId ?? null,
    input.fullWidth ? 1 : 0,
    String(input.textSize || "medium"),
    String(input.fontStyle || "default"),
    nextSort(input.parentId ? String(input.parentId) : null),
  );
  const blocks = Array.isArray(input.blocks) ? (input.blocks as Block[]) : null;
  if (blocks) saveBlocks(id, blocks);
  else if (typeof input.markdown === "string" && input.markdown.trim()) saveBlocks(id, draftsToBlocks(markdownToBlocks(input.markdown), id));
  else indexPage(id);
  return getPage(id);
}

export function updatePage(id: string, patch: Record<string, unknown>) {
  const current = db.prepare("SELECT * FROM pages2 WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!current) return null;
  // `locked` can only be turned off through unlockPage (which checks the password); on, through lockPage.
  if ("locked" in patch) delete (patch as Record<string, unknown>).locked;
  const fields: Record<string, string> = {
    title: "title", icon: "icon", cover: "cover", coverOffset: "cover_offset",
    parentId: "parent_id", classId: "class_id", favorite: "favorite", locked: "locked",
    fullWidth: "full_width", textSize: "text_size", fontStyle: "font_style", sort: "sort",
    colourCategories: "colour_categories",
  };
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(fields)) {
    if (!(key in patch)) continue;
    const value = patch[key];
    assignments.push(`${column}=?`);
    if (column === "favorite" || column === "locked" || column === "full_width") values.push(value ? 1 : 0);
    else values.push(value === "" || value === undefined ? null : value);
  }
  if (assignments.length) {
    if ("title" in patch && String(patch.title) !== String(current.title)) snapshot(id);
    db.prepare(`UPDATE pages2 SET ${assignments.join(",")}, updated_at=datetime('now') WHERE id=?`).run(...values, id);
  }
  if (Array.isArray(patch.blocks)) saveBlocks(id, patch.blocks as Block[]);
  else indexPage(id);
  return getPage(id);
}

/* Moving a page under one of its own descendants would orphan the subtree,
   so the ancestry is walked before the parent is changed. */
export function movePage(id: string, parentId: string | null, index: number) {
  let cursor = parentId;
  const guard = new Set<string>();
  while (cursor) {
    if (cursor === id || guard.has(cursor)) return { error: "A page cannot be moved inside itself" };
    guard.add(cursor);
    const parent = db.prepare("SELECT parent_id FROM pages2 WHERE id=?").get(cursor) as { parent_id: string | null } | undefined;
    cursor = parent?.parent_id ?? null;
  }
  const siblings = (db
    .prepare("SELECT id FROM pages2 WHERE parent_id IS ? AND id<>? AND trashed_at IS NULL ORDER BY sort")
    .all(parentId, id) as Array<{ id: string }>).map((row) => row.id);
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, id);
  db.transaction(() => {
    db.prepare("UPDATE pages2 SET parent_id=?, updated_at=datetime('now') WHERE id=?").run(parentId, id);
    const setSort = db.prepare("UPDATE pages2 SET sort=? WHERE id=?");
    siblings.forEach((sibling, position) => setSort.run(position, sibling));
  })();
  return { ok: true };
}

export function trashPage(id: string) {
  db.prepare("UPDATE pages2 SET trashed_at=datetime('now') WHERE id=?").run(id);
  for (const row of descendants(id)) db.prepare("DELETE FROM search_fts WHERE page_id=?").run(row);
  db.prepare("DELETE FROM search_fts WHERE page_id=?").run(id);
  return { ok: true };
}

export function restorePage(id: string) {
  db.prepare("UPDATE pages2 SET trashed_at=NULL WHERE id=?").run(id);
  /* A page whose parent is still in the trash would be invisible after a
     restore, so it comes back at the top level instead. */
  const parent = db.prepare(
    "SELECT p.trashed_at AS t FROM pages2 c JOIN pages2 p ON p.id=c.parent_id WHERE c.id=?",
  ).get(id) as { t: string | null } | undefined;
  if (parent?.t) db.prepare("UPDATE pages2 SET parent_id=NULL WHERE id=?").run(id);
  indexPage(id);
  for (const child of descendants(id)) indexPage(child);
  return getPage(id);
}

export function deletePageForever(id: string) {
  db.prepare("DELETE FROM search_fts WHERE page_id=?").run(id);
  db.prepare("DELETE FROM pages2 WHERE id=?").run(id);
  return { ok: true };
}

export function listTrash() {
  return db
    .prepare(`SELECT ${PAGE_COLUMNS} FROM pages2 WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC`)
    .all();
}

function descendants(id: string): string[] {
  const out: string[] = [];
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    const children = db.prepare("SELECT id FROM pages2 WHERE parent_id=?").all(current) as Array<{ id: string }>;
    for (const child of children) { out.push(child.id); queue.push(child.id); }
  }
  return out;
}

export function duplicatePage(id: string, parentId?: string | null): Record<string, unknown> | null {
  const source = db.prepare("SELECT * FROM pages2 WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!source) return null;
  const copy = createPage({
    parentId: parentId === undefined ? source.parent_id : parentId,
    kind: source.kind,
    title: `${source.title || "Untitled"} (copy)`,
    icon: source.icon,
    cover: source.cover,
    classId: source.class_id,
    fullWidth: source.full_width,
    textSize: source.text_size,
    fontStyle: source.font_style,
  })!;
  const newIds = new Map<string, string>();
  const clone = (blocks: Block[]): Block[] =>
    blocks.map((block) => {
      const id = newId();
      newIds.set(block.id, id);
      return { ...block, id, children: clone(block.children ?? []) };
    });
  saveBlocks(String(copy.id), clone(blockTree(id)));
  for (const child of db.prepare("SELECT id FROM pages2 WHERE parent_id=?").all(id) as Array<{ id: string }>) {
    duplicatePage(child.id, String(copy.id));
  }
  return getPage(String(copy.id));
}

/* ------------------------------------------------------------ versions */

function snapshot(pageId: string) {
  const page = db.prepare("SELECT title FROM pages2 WHERE id=?").get(pageId) as { title: string } | undefined;
  if (!page) return;
  const latest = db
    .prepare("SELECT created_at FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 1")
    .get(pageId) as { created_at: string } | undefined;
  /* One snapshot per five minutes: enough to recover a bad edit without
     turning every keystroke burst into a version. */
  if (latest && Date.now() - new Date(`${latest.created_at.replace(" ", "T")}Z`).getTime() < 5 * 60_000) return;
  db.prepare("INSERT INTO page_versions(id,page_id,title,snapshot) VALUES(?,?,?,?)")
    .run(newId(), pageId, page.title, json(blockTree(pageId)));
  db.prepare(
    `DELETE FROM page_versions WHERE page_id=? AND id NOT IN
     (SELECT id FROM page_versions WHERE page_id=? ORDER BY created_at DESC LIMIT 50)`,
  ).run(pageId, pageId);
}

export function saveVersion(pageId: string) { snapshot(pageId); return { ok: true }; }

export function restoreVersion(pageId: string, versionId: string) {
  const version = db.prepare("SELECT * FROM page_versions WHERE id=? AND page_id=?").get(versionId, pageId) as
    | { title: string; snapshot: string }
    | undefined;
  if (!version) return null;
  snapshot(pageId);
  db.prepare("UPDATE pages2 SET title=?, updated_at=datetime('now') WHERE id=?").run(version.title, pageId);
  saveBlocks(pageId, unjson<Block[]>(version.snapshot, []));
  return getPage(pageId);
}

/* -------------------------------------------------------------- search */

const ftsQuery = (query: string) =>
  query.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");

export function search(query: string, filters: Record<string, unknown> = {}) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  let rows: Array<Record<string, unknown>>;
  try {
    rows = db
      .prepare(
        `SELECT s.page_id, s.block_id, s.kind, p.title, p.icon, p.parent_id, p.class_id, p.updated_at,
                snippet(search_fts, 1, '<mark>', '</mark>', '…', 14) AS excerpt, rank
         FROM search_fts s JOIN pages2 p ON p.id=s.page_id
         WHERE search_fts MATCH ? AND p.trashed_at IS NULL
         ORDER BY rank LIMIT 80`,
      )
      .all(ftsQuery(trimmed)) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
  /* Page-level hits win over the block hits inside them so one note does not
     fill the dialog with every paragraph that matched. */
  const best = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const existing = best.get(String(row.page_id));
    if (!existing || (existing.kind === "block" && row.kind !== "block")) best.set(String(row.page_id), row);
  }
  let results = [...best.values()];
  if (filters.classId) results = results.filter((row) => String(row.class_id) === String(filters.classId));
  if (filters.kind) results = results.filter((row) => row.kind === filters.kind);
  return results.slice(0, 40).map((row) => ({ ...row, breadcrumb: breadcrumbFor(String(row.page_id)) }));
}

function breadcrumbFor(pageId: string) {
  const names: string[] = [];
  let cursor = db.prepare("SELECT parent_id FROM pages2 WHERE id=?").get(pageId) as { parent_id: string | null } | undefined;
  const guard = new Set<string>();
  while (cursor?.parent_id && !guard.has(cursor.parent_id)) {
    guard.add(cursor.parent_id);
    const parent = db.prepare("SELECT title,parent_id FROM pages2 WHERE id=?").get(cursor.parent_id) as
      | { title: string; parent_id: string | null }
      | undefined;
    if (!parent) break;
    names.unshift(parent.title || "Untitled");
    cursor = { parent_id: parent.parent_id };
  }
  return names;
}

/* --------------------------------------------------- markdown migration */

function draftsToBlocks(drafts: DraftBlock[], pageId: string, parentId: string | null = null): Block[] {
  return drafts.map((draft, index) => {
    const id = newId();
    return {
      id,
      page_id: pageId,
      parent_id: parentId,
      type: draft.type,
      text: draft.text,
      props: draft.props,
      sort: index,
      children: draftsToBlocks(draft.children, pageId, id),
    };
  });
}

/* Legacy pages keep their markdown column; this converts it into blocks once
   per page. Pages that already have blocks are left untouched. */
function migrateMarkdownIntoBlocks() {
  const pending = db
    .prepare(
      `SELECT p.id, l.markdown FROM pages2 p JOIN pages l ON CAST(l.id AS TEXT)=p.id
       WHERE l.markdown IS NOT NULL AND trim(l.markdown)<>''
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.page_id=p.id)`,
    )
    .all() as Array<{ id: string; markdown: string }>;
  for (const page of pending) saveBlocks(page.id, draftsToBlocks(markdownToBlocks(page.markdown), page.id));
}

/* One-off cleanup of artefacts the markdown migration leaves behind: the
   old build's placeholder icon, and the level-one heading that repeated the
   page title in every note's markdown body. */
function tidyMigratedPages() {
  const applied = db.prepare("SELECT version FROM migrations WHERE version=3").get();
  if (applied) return;
  db.transaction(() => {
    db.prepare("UPDATE pages2 SET icon=NULL WHERE icon IN ('\u25cc', '')").run();
    const pages = db.prepare("SELECT id, title FROM pages2").all() as Array<{ id: string; title: string }>;
    for (const page of pages) {
      const first = db
        .prepare("SELECT id, type, text FROM blocks WHERE page_id=? AND parent_id IS NULL ORDER BY sort LIMIT 1")
        .get(page.id) as { id: string; type: string; text: string } | undefined;
      if (!first || first.type !== "h1") continue;
      if (spanText(parseSpans(first.text)).trim().toLowerCase() !== String(page.title).trim().toLowerCase()) continue;
      /* Never empty a page: the heading only goes if there is other content,
         and the text survives as the page title either way. */
      const count = db.prepare("SELECT count(*) AS n FROM blocks WHERE page_id=?").get(page.id) as { n: number };
      if (count.n < 2) continue;
      db.prepare("DELETE FROM blocks WHERE id=?").run(first.id);
    }
    db.prepare("INSERT OR IGNORE INTO migrations(version) VALUES(3)").run();
  })();
  for (const page of db.prepare("SELECT id FROM pages2").all() as Array<{ id: string }>) indexPage(page.id);
}

/* The first migration turned markdown tables into ordinary paragraphs of
   pipes, because table blocks did not exist yet. This folds those runs back
   into real table blocks, leaving anything that is not a table untouched. */
function convertLegacyTables() {
  const applied = db.prepare("SELECT version FROM migrations WHERE version=4").get();
  if (applied) return;
  const separator = (text: string) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(text) && text.includes("-");
  const cells = (text: string) => text.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
  const pages = db.prepare("SELECT DISTINCT page_id FROM blocks").all() as Array<{ page_id: string }>;
  db.transaction(() => {
    for (const { page_id: pageId } of pages) {
      const rows = db
        .prepare("SELECT id, type, text, sort, parent_id FROM blocks WHERE page_id=? ORDER BY sort")
        .all(pageId) as Array<{ id: string; type: string; text: string; sort: number; parent_id: string | null }>;
      let index = 0;
      let changed = false;
      while (index < rows.length) {
        const line = spanText(parseSpans(rows[index]!.text)).trim();
        const nextLine = index + 1 < rows.length ? spanText(parseSpans(rows[index + 1]!.text)).trim() : "";
        if (rows[index]!.type !== "text" || !line.startsWith("|") || !separator(nextLine)) { index += 1; continue; }
        const group = [rows[index]!];
        let cursor = index + 2;
        const table = [cells(line)];
        while (cursor < rows.length) {
          const candidate = spanText(parseSpans(rows[cursor]!.text)).trim();
          if (rows[cursor]!.type !== "text" || !candidate.startsWith("|")) break;
          table.push(cells(candidate));
          group.push(rows[cursor]!);
          cursor += 1;
        }
        group.push(rows[index + 1]!);
        db.prepare("UPDATE blocks SET type='table', text='[]', props=? WHERE id=?")
          .run(json({ rows: table, hasHeader: true }), rows[index]!.id);
        for (const row of group.slice(1)) db.prepare("DELETE FROM blocks WHERE id=?").run(row.id);
        changed = true;
        index = cursor;
      }
      if (changed) indexPage(pageId);
    }
    db.prepare("INSERT OR IGNORE INTO migrations(version) VALUES(4)").run();
  })();
}

export function pageMarkdown(pageId: string) {
  const page = db.prepare("SELECT title FROM pages2 WHERE id=?").get(pageId) as { title: string } | undefined;
  if (!page) return null;
  return `# ${page.title || "Untitled"}\n\n${blocksToMarkdown(blockTree(pageId))}\n`;
}

/**
 * Adds markdown to an existing page where the caller says: the start, the end, or right after the first block whose
 * text contains `afterText` (a heading, a sentence). Nothing is removed. Returns where it landed.
 */
export function insertMarkdown(pageId: string, markdown: string, where: { position?: "start" | "end" | "after"; afterText?: string } = {}) {
  const page = db.prepare("SELECT title, locked FROM pages2 WHERE id=? AND trashed_at IS NULL").get(pageId) as { title: string; locked: number } | undefined;
  if (!page) return { ok: false as const, error: "That page does not exist." };
  if (page.locked) return { ok: false as const, error: "That page is locked, so nothing was added." };
  const tree = blockTree(pageId);
  const added = draftsToBlocks(markdownToBlocks(markdown), pageId);
  if (!added.length) return { ok: false as const, error: "There was no content to add." };
  let index = tree.length;
  let landed = "the end of the page";
  if (where.position === "start") { index = 0; landed = "the start of the page"; }
  else if (where.position === "after" && where.afterText) {
    const needle = where.afterText.trim().toLowerCase();
    const found = tree.findIndex((block) => JSON.stringify(block).toLowerCase().includes(needle));
    if (found >= 0) { index = found + 1; landed = `after “${where.afterText.slice(0, 60)}”`; }
    else return { ok: false as const, error: `Nothing on the page matched “${where.afterText.slice(0, 60)}”, so nothing was added.` };
  }
  tree.splice(index, 0, ...added);
  saveBlocks(pageId, tree);
  return { ok: true as const, title: page.title || "Untitled", landed };
}

/** Permanently reset Notes' user-owned workspace while preserving schema and
 * migrations. One transaction prevents orphaned study/database/search data. */
export async function clearWorkspace() {
  db.transaction(() => {
    for (const table of [
      "test_answers", "test_attempts", "test_questions", "tests",
      "card_reviews", "cards", "decks",
      "db_relations", "db_values", "db_views", "db_properties", "databases",
      "page_versions", "page_links", "blocks", "source_refs", "sources",
      "comments", "chat_messages", "chats", "transcript_segments", "lecture_sessions",
      "inbox_events", "pages2", "pages", "classes",
    ]) db.prepare(`DELETE FROM ${table}`).run();
  })();
  const files = path.join(path.dirname(dbPath), "files");
  await fs.rm(files, { recursive: true, force: true });
  await fs.mkdir(files, { recursive: true });
  return { ok: true };
}

export function importMarkdown(markdown: string, options: Record<string, unknown> = {}) {
  const lines = String(markdown).split("\n");
  const heading = lines.findIndex((line) => /^#\s+/.test(line.trim()));
  const title = String(options.title || (heading >= 0 ? lines[heading]!.replace(/^#\s+/, "").trim() : "")) || "Imported note";
  const body = heading >= 0 ? lines.slice(heading + 1).join("\n") : markdown;
  return createPage({ title, parentId: options.parentId ?? null, classId: options.classId ?? null, markdown: body });
}

export { dbPath, newId };

/* ------------------------------------------------------------ databases */

export type PropertyType =
  | "title" | "text" | "number" | "select" | "multi_select" | "status" | "date"
  | "person" | "files" | "checkbox" | "url" | "email" | "phone" | "formula"
  | "relation" | "rollup" | "created_time" | "created_by" | "last_edited_time"
  | "last_edited_by" | "button" | "unique_id" | "place";

export const PROPERTY_TYPES: PropertyType[] = [
  "title", "text", "number", "select", "multi_select", "status", "date", "person",
  "files", "checkbox", "url", "email", "phone", "formula", "relation", "rollup",
  "created_time", "created_by", "last_edited_time", "last_edited_by", "button",
  "unique_id", "place",
];

export const VIEW_TYPES = [
  "table", "board", "timeline", "calendar", "list", "gallery", "chart", "feed", "form", "map", "dashboard",
] as const;

/* Types the store computes rather than stores, so the client never tries to
   write them and the table renders them read-only. */
const COMPUTED = new Set<PropertyType>([
  "formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id",
]);

const propertyRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  database_id: String(row.database_id),
  name: String(row.name),
  type: String(row.type) as PropertyType,
  config: unjson<Record<string, unknown>>(row.config, {}),
  sort: Number(row.sort),
  computed: COMPUTED.has(String(row.type) as PropertyType),
});

const viewRow = (row: Record<string, unknown>) => ({
  id: String(row.id),
  database_id: String(row.database_id),
  name: String(row.name),
  type: String(row.type),
  config: unjson<Record<string, unknown>>(row.config, {}),
  sort: Number(row.sort),
});

export function getDatabase(id: string) {
  const database = db.prepare("SELECT * FROM databases WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!database) return null;
  return {
    id: String(database.id),
    page_id: String(database.page_id),
    name: String(database.name),
    inline: Boolean(database.inline),
    page_layout: unjson<Record<string, unknown>>(database.page_layout, {}),
    properties: (db.prepare("SELECT * FROM db_properties WHERE database_id=? ORDER BY sort").all(id) as Array<Record<string, unknown>>).map(propertyRow),
    views: (db.prepare("SELECT * FROM db_views WHERE database_id=? ORDER BY sort").all(id) as Array<Record<string, unknown>>).map(viewRow),
  };
}

export function getDatabaseByPage(pageId: string) {
  const row = db.prepare("SELECT id FROM databases WHERE page_id=?").get(pageId) as { id: string } | undefined;
  return row ? getDatabase(row.id) : null;
}

const DEFAULT_STATUS = [
  { id: "todo", name: "Not started", color: "gray", group: "todo" },
  { id: "doing", name: "In progress", color: "blue", group: "doing" },
  { id: "done", name: "Done", color: "green", group: "done" },
];

export function createDatabase(input: Record<string, unknown> = {}) {
  const inline = Boolean(input.inline);
  const name = String(input.name || "Untitled database");
  const page = createPage({
    parentId: input.parentId ? String(input.parentId) : null,
    kind: "database",
    title: name,
    icon: (input.icon as string) || "▦",
  })!;
  const id = newId();
  db.prepare("INSERT INTO databases(id,page_id,name,inline) VALUES(?,?,?,?)").run(id, String(page.id), name, inline ? 1 : 0);
  const template = Array.isArray(input.properties) && input.properties.length
    ? (input.properties as Array<Record<string, unknown>>)
    : [
        { name: "Name", type: "title" },
        { name: "Status", type: "status", config: { options: DEFAULT_STATUS } },
        { name: "Due", type: "date" },
      ];
  template.forEach((property, index) => addProperty(id, { ...property, sort: index }));
  createView(id, { name: "Table", type: "table" });
  return getDatabase(id);
}

export function addProperty(databaseId: string, input: Record<string, unknown>) {
  const type = String(input.type || "text") as PropertyType;
  if (!PROPERTY_TYPES.includes(type)) return { error: `Unknown property type "${type}"` };
  const config = (input.config as Record<string, unknown>) || {};
  if (type === "formula" && config.expression) {
    const names = (db.prepare("SELECT name FROM db_properties WHERE database_id=?").all(databaseId) as Array<{ name: string }>).map((row) => row.name);
    const error = checkFormula(String(config.expression), names);
    if (error) return { error };
  }
  const id = newId();
  const sort = input.sort ?? ((db.prepare("SELECT coalesce(max(sort),-1) AS m FROM db_properties WHERE database_id=?").get(databaseId) as { m: number }).m + 1);
  db.prepare("INSERT INTO db_properties(id,database_id,name,type,config,sort) VALUES(?,?,?,?,?,?)")
    .run(id, databaseId, String(input.name || "Property"), type, json(config), sort);
  return propertyRow(db.prepare("SELECT * FROM db_properties WHERE id=?").get(id) as Record<string, unknown>);
}

export function updateProperty(propertyId: string, patch: Record<string, unknown>) {
  const property = db.prepare("SELECT * FROM db_properties WHERE id=?").get(propertyId) as Record<string, unknown> | undefined;
  if (!property) return null;
  const config = "config" in patch ? (patch.config as Record<string, unknown>) : unjson<Record<string, unknown>>(property.config, {});
  const type = String(patch.type ?? property.type) as PropertyType;
  if (type === "formula" && config.expression) {
    const names = (db.prepare("SELECT name FROM db_properties WHERE database_id=? AND id<>?").all(property.database_id, propertyId) as Array<{ name: string }>).map((row) => row.name);
    const error = checkFormula(String(config.expression), names);
    if (error) return { error };
  }
  db.prepare("UPDATE db_properties SET name=?, type=?, config=?, sort=? WHERE id=?").run(
    String(patch.name ?? property.name), type, json(config), patch.sort ?? property.sort, propertyId,
  );
  return propertyRow(db.prepare("SELECT * FROM db_properties WHERE id=?").get(propertyId) as Record<string, unknown>);
}

export function deleteProperty(propertyId: string) {
  const property = db.prepare("SELECT type FROM db_properties WHERE id=?").get(propertyId) as { type: string } | undefined;
  if (property?.type === "title") return { error: "The title property cannot be deleted" };
  db.prepare("DELETE FROM db_properties WHERE id=?").run(propertyId);
  return { ok: true };
}

export function createView(databaseId: string, input: Record<string, unknown>) {
  const type = String(input.type || "table");
  if (!(VIEW_TYPES as readonly string[]).includes(type)) return { error: `Unknown view type "${type}"` };
  const id = newId();
  const sort = (db.prepare("SELECT coalesce(max(sort),-1) AS m FROM db_views WHERE database_id=?").get(databaseId) as { m: number }).m + 1;
  db.prepare("INSERT INTO db_views(id,database_id,name,type,config,sort) VALUES(?,?,?,?,?,?)")
    .run(id, databaseId, String(input.name || type.charAt(0).toUpperCase() + type.slice(1)), type, json(input.config || {}), sort);
  return viewRow(db.prepare("SELECT * FROM db_views WHERE id=?").get(id) as Record<string, unknown>);
}

export function updateView(viewId: string, patch: Record<string, unknown>) {
  const view = db.prepare("SELECT * FROM db_views WHERE id=?").get(viewId) as Record<string, unknown> | undefined;
  if (!view) return null;
  db.prepare("UPDATE db_views SET name=?, type=?, config=?, sort=? WHERE id=?").run(
    String(patch.name ?? view.name),
    String(patch.type ?? view.type),
    json("config" in patch ? patch.config : unjson(view.config, {})),
    patch.sort ?? view.sort,
    viewId,
  );
  return viewRow(db.prepare("SELECT * FROM db_views WHERE id=?").get(viewId) as Record<string, unknown>);
}

export function deleteView(viewId: string) {
  const view = db.prepare("SELECT database_id FROM db_views WHERE id=?").get(viewId) as { database_id: string } | undefined;
  if (!view) return { ok: true };
  const count = db.prepare("SELECT count(*) AS n FROM db_views WHERE database_id=?").get(view.database_id) as { n: number };
  if (count.n <= 1) return { error: "A database needs at least one view" };
  db.prepare("DELETE FROM db_views WHERE id=?").run(viewId);
  return { ok: true };
}

/* ---------------------------------------------------------- db records */

export function recordValues(recordId: string) {
  const rows = db.prepare("SELECT property_id, value FROM db_values WHERE record_id=?").all(recordId) as Array<{ property_id: string; value: string }>;
  const values: Record<string, unknown> = {};
  for (const row of rows) values[row.property_id] = unjson<unknown>(row.value, null);
  return values;
}

export function createRecord(databaseId: string, input: Record<string, unknown> = {}) {
  const database = getDatabase(databaseId);
  if (!database) return null;
  const titleProperty = database.properties.find((property) => property.type === "title");
  const values = (input.values as Record<string, unknown>) || {};
  const page = createPage({
    kind: "record",
    databaseId,
    parentId: database.page_id,
    title: String(input.title ?? (titleProperty ? values[titleProperty.id] ?? "" : "")),
    icon: (input.icon as string) || null,
  })!;
  setRecordValues(String(page.id), values);
  return getPage(String(page.id));
}

export function setRecordValues(recordId: string, values: Record<string, unknown>) {
  const record = db.prepare("SELECT database_id FROM pages2 WHERE id=?").get(recordId) as { database_id: string } | undefined;
  if (!record) return { error: "Record not found" };
  const properties = new Map(
    (db.prepare("SELECT * FROM db_properties WHERE database_id=?").all(record.database_id) as Array<Record<string, unknown>>)
      .map((row) => [String(row.id), propertyRow(row)]),
  );
  const upsert = db.prepare(
    "INSERT INTO db_values(record_id,property_id,value) VALUES(?,?,?) ON CONFLICT(record_id,property_id) DO UPDATE SET value=excluded.value",
  );
  db.transaction(() => {
    for (const [propertyId, value] of Object.entries(values)) {
      const property = properties.get(propertyId);
      if (!property || property.computed) continue;
      if (property.type === "title") {
        db.prepare("UPDATE pages2 SET title=?, updated_at=datetime('now') WHERE id=?").run(String(value ?? ""), recordId);
        continue;
      }
      if (property.type === "relation") {
        const targets = Array.isArray(value) ? value.map(String) : [];
        db.prepare("DELETE FROM db_relations WHERE property_id=? AND from_record=?").run(propertyId, recordId);
        const link = db.prepare("INSERT OR IGNORE INTO db_relations(property_id,from_record,to_record) VALUES(?,?,?)");
        for (const target of targets) link.run(propertyId, recordId, target);
      }
      upsert.run(recordId, propertyId, json(value));
    }
    db.prepare("UPDATE pages2 SET updated_at=datetime('now') WHERE id=?").run(recordId);
  })();
  indexPage(recordId);
  return { ok: true, values: recordValues(recordId) };
}

const ROLLUP_FUNCTIONS = ["count", "count_values", "sum", "average", "min", "max", "latest", "earliest", "percent_checked", "show_original"] as const;

function computeRollup(config: Record<string, unknown>, recordId: string, propertyId: string): unknown {
  const targetProperty = config.targetProperty ? String(config.targetProperty) : null;
  const fn = String(config.function || "count");
  const related = (db.prepare("SELECT to_record FROM db_relations WHERE property_id=? AND from_record=?")
    .all(String(config.relationProperty || propertyId), recordId) as Array<{ to_record: string }>).map((row) => row.to_record);
  if (fn === "count") return related.length;
  if (!targetProperty) return null;
  const raw = related.map((id) => {
    const property = db.prepare("SELECT type FROM db_properties WHERE id=?").get(targetProperty) as { type: string } | undefined;
    if (property?.type === "title") return (db.prepare("SELECT title FROM pages2 WHERE id=?").get(id) as { title: string } | undefined)?.title ?? null;
    const row = db.prepare("SELECT value FROM db_values WHERE record_id=? AND property_id=?").get(id, targetProperty) as { value: string } | undefined;
    return row ? unjson<unknown>(row.value, null) : null;
  });
  const present = raw.filter((value) => value !== null && value !== undefined && value !== "");
  const numbers = present.map(Number).filter(Number.isFinite);
  switch (fn) {
    case "count_values": return present.length;
    case "sum": return numbers.reduce((total, value) => total + value, 0);
    case "average": return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
    case "min": return numbers.length ? Math.min(...numbers) : null;
    case "max": return numbers.length ? Math.max(...numbers) : null;
    case "percent_checked": return present.length ? present.filter(Boolean).length / present.length : null;
    case "latest": return present.map(String).sort().pop() ?? null;
    case "earliest": return present.map(String).sort().shift() ?? null;
    default: return present;
  }
}

/* Resolves stored, computed and relation values for one record. */
function resolveRecord(record: Record<string, unknown>, properties: ReturnType<typeof propertyRow>[]): Record<string, unknown> {
  const stored = recordValues(String(record.id));
  const byName: Record<string, FormulaValue> = {};
  const values: Record<string, unknown> = {};
  const uniqueIndex = () => Number(String(record.sort ?? 0)) + 1;

  for (const property of properties) {
    let value: unknown = stored[property.id] ?? null;
    switch (property.type) {
      case "title": value = record.title ?? ""; break;
      case "created_time": value = record.created_at; break;
      case "last_edited_time": value = record.updated_at; break;
      case "created_by": case "last_edited_by": value = property.config.person ?? "You"; break;
      case "unique_id": value = `${property.config.prefix || ""}${uniqueIndex()}`; break;
      case "relation": value = (db.prepare("SELECT to_record FROM db_relations WHERE property_id=? AND from_record=?").all(property.id, record.id) as Array<{ to_record: string }>).map((row) => row.to_record); break;
      case "rollup": value = computeRollup(property.config, String(record.id), property.id); break;
      default: break;
    }
    values[property.id] = value;
    byName[property.name] = Array.isArray(value) ? value.length : (value as FormulaValue);
  }
  /* Formulas run last so they can reference rollups and relations. */
  for (const property of properties.filter((candidate) => candidate.type === "formula")) {
    const expression = String(property.config.expression || "");
    if (!expression.trim()) { values[property.id] = null; continue; }
    const result = runFormula(expression, byName);
    values[property.id] = "error" in result ? { __error: result.error } : result.value instanceof Date ? result.value.toISOString() : result.value;
  }
  return { ...record, values, id: String(record.id) };
}

export function listRecords(databaseId: string) {
  const properties = (db.prepare("SELECT * FROM db_properties WHERE database_id=? ORDER BY sort").all(databaseId) as Array<Record<string, unknown>>).map(propertyRow);
  const rows = db.prepare(`SELECT ${PAGE_COLUMNS} FROM pages2 WHERE database_id=? AND trashed_at IS NULL ORDER BY sort, created_at`).all(databaseId) as Array<Record<string, unknown>>;
  return rows.map((row) => resolveRecord(row, properties));
}

/* ------------------------------------------------------- view querying */

type Condition = { property: string; operator: string; value?: unknown };
type FilterGroup = { conjunction?: "and" | "or"; conditions: Array<Condition | FilterGroup> };

const asArray = (value: unknown) => (Array.isArray(value) ? value : value === null || value === undefined ? [] : [value]);
const textOf = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (typeof value === "object") return textOf((value as Record<string, unknown>).start ?? (value as Record<string, unknown>).name ?? "");
  return String(value);
};
const dateOf = (value: unknown) => {
  const text = typeof value === "object" && value ? String((value as Record<string, unknown>).start ?? "") : String(value ?? "");
  if (!text) return null;
  const date = new Date(text.includes("T") ? text : `${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
};
const startOfDay = (offsetDays = 0) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return new Date(date.getTime() + offsetDays * 86_400_000);
};

function matches(condition: Condition, values: Record<string, unknown>): boolean {
  const value = values[condition.property];
  const target = condition.value;
  const text = textOf(value).toLowerCase();
  const targetText = textOf(target).toLowerCase();
  switch (condition.operator) {
    case "is_empty": return text === "" || asArray(value).length === 0;
    case "is_not_empty": return !(text === "" || asArray(value).length === 0);
    case "is": return text === targetText;
    case "is_not": return text !== targetText;
    case "contains": return text.includes(targetText);
    case "does_not_contain": return !text.includes(targetText);
    case "starts_with": return text.startsWith(targetText);
    case "ends_with": return text.endsWith(targetText);
    case "is_checked": return Boolean(value);
    case "is_unchecked": return !value;
    case "greater_than": return Number(value) > Number(target);
    case "less_than": return Number(value) < Number(target);
    case "greater_or_equal": return Number(value) >= Number(target);
    case "less_or_equal": return Number(value) <= Number(target);
    case "any_of": return asArray(target).map(String).some((item) => asArray(value).map(String).includes(item));
    case "none_of": return !asArray(target).map(String).some((item) => asArray(value).map(String).includes(item));
    case "before": { const date = dateOf(value); return Boolean(date && dateOf(target) && date < dateOf(target)!); }
    case "after": { const date = dateOf(value); return Boolean(date && dateOf(target) && date > dateOf(target)!); }
    case "on_or_before": { const date = dateOf(value); return Boolean(date && dateOf(target) && date <= dateOf(target)!); }
    case "on_or_after": { const date = dateOf(value); return Boolean(date && dateOf(target) && date >= dateOf(target)!); }
    case "is_today": { const date = dateOf(value); return Boolean(date && date >= startOfDay() && date < startOfDay(1)); }
    case "is_before_today": { const date = dateOf(value); return Boolean(date && date < startOfDay()); }
    case "is_within_next_days": { const date = dateOf(value); return Boolean(date && date >= startOfDay() && date < startOfDay(Number(target) || 7)); }
    default: return true;
  }
}

const isGroup = (node: Condition | FilterGroup): node is FilterGroup => Array.isArray((node as FilterGroup).conditions);

function matchesGroup(group: FilterGroup, values: Record<string, unknown>): boolean {
  const conditions = group.conditions || [];
  if (!conditions.length) return true;
  const test = (node: Condition | FilterGroup) => (isGroup(node) ? matchesGroup(node, values) : matches(node, values));
  return group.conjunction === "or" ? conditions.some(test) : conditions.every(test);
}

const compare = (a: unknown, b: unknown) => {
  const numberA = Number(a);
  const numberB = Number(b);
  if (Number.isFinite(numberA) && Number.isFinite(numberB) && textOf(a) !== "" && textOf(b) !== "") return numberA - numberB;
  return textOf(a).localeCompare(textOf(b), undefined, { numeric: true, sensitivity: "base" });
};

export function queryView(viewId: string, overrides: Record<string, unknown> = {}) {
  const view = db.prepare("SELECT * FROM db_views WHERE id=?").get(viewId) as Record<string, unknown> | undefined;
  if (!view) return null;
  const databaseId = String(view.database_id);
  const database = getDatabase(databaseId)!;
  const config = { ...unjson<Record<string, unknown>>(view.config, {}), ...overrides };
  let records = listRecords(databaseId);

  const filter = config.filter as FilterGroup | undefined;
  if (filter) records = records.filter((record) => matchesGroup(filter, record.values as Record<string, unknown>));

  const term = String(config.search || "").trim().toLowerCase();
  if (term) {
    records = records.filter((record) =>
      String(record.title ?? "").toLowerCase().includes(term) ||
      Object.values(record.values as Record<string, unknown>).some((value) => textOf(value).toLowerCase().includes(term)),
    );
  }

  const sorts = (config.sorts as Array<{ property: string; direction?: string }>) || [];
  if (sorts.length) {
    records = [...records].sort((left, right) => {
      for (const sort of sorts) {
        const values = compare(
          (left.values as Record<string, unknown>)[sort.property],
          (right.values as Record<string, unknown>)[sort.property],
        );
        if (values) return sort.direction === "descending" ? -values : values;
      }
      return 0;
    });
  }

  const groupProperty = config.group ? String(config.group) : null;
  let groups: Array<{ key: string; label: string; color?: string; records: unknown[] }> | null = null;
  if (groupProperty) {
    const property = database.properties.find((candidate) => candidate.id === groupProperty);
    const options = (property?.config.options as Array<Record<string, unknown>>) || [];
    const buckets = new Map<string, { key: string; label: string; color?: string; records: unknown[] }>();
    for (const option of options) {
      buckets.set(String(option.id), { key: String(option.id), label: String(option.name), color: String(option.color || "gray"), records: [] });
    }
    buckets.set("", { key: "", label: "No " + (property?.name || "value"), records: [] });
    for (const record of records) {
      const raw = (record.values as Record<string, unknown>)[groupProperty];
      for (const key of (asArray(raw).length ? asArray(raw).map(String) : [""])) {
        if (!buckets.has(key)) buckets.set(key, { key, label: key || "Empty", records: [] });
        buckets.get(key)!.records.push(record);
      }
    }
    const hidden = new Set((config.hiddenGroups as string[]) || []);
    groups = [...buckets.values()].filter((bucket) => !hidden.has(bucket.key));
  }

  return { view: viewRow(view), database, records, groups, config };
}

/* ----------------------------------------------------------- flashcards */

const cardRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...row,
  tags: unjson<string[]>(row.tags, []),
  source: row.source_page_id
    ? { pageId: row.source_page_id, blockId: row.source_block_id, label: row.source_label, timestamp: row.source_timestamp }
    : null,
});

export function listDecks() {
  return db
    .prepare(
      `SELECT d.*, 
              (SELECT count(*) FROM cards WHERE deck_id=d.id) AS card_count,
              (SELECT count(*) FROM cards WHERE deck_id=d.id AND due_at<=datetime('now')) AS due_count,
              (SELECT count(*) FROM cards WHERE deck_id=d.id AND state=2 AND stability>=21) AS mastered_count,
              (SELECT max(last_review) FROM cards WHERE deck_id=d.id) AS last_reviewed
       FROM decks d ORDER BY d.created_at DESC`,
    )
    .all();
}

export function createDeck(input: Record<string, unknown> = {}) {
  const id = newId();
  db.prepare("INSERT INTO decks(id,page_id,name,class_id,topic) VALUES(?,?,?,?,?)").run(
    id, input.pageId ? String(input.pageId) : null, String(input.name || "New deck"), input.classId ?? null, (input.topic as string) || null,
  );
  return db.prepare("SELECT * FROM decks WHERE id=?").get(id);
}

export function updateDeck(id: string, patch: Record<string, unknown>) {
  const deck = db.prepare("SELECT * FROM decks WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!deck) return null;
  db.prepare("UPDATE decks SET name=?, class_id=?, topic=? WHERE id=?").run(
    String(patch.name ?? deck.name), patch.classId ?? deck.class_id, patch.topic ?? deck.topic, id,
  );
  return db.prepare("SELECT * FROM decks WHERE id=?").get(id);
}

export function deleteDeck(id: string) {
  db.prepare("DELETE FROM decks WHERE id=?").run(id);
  return { ok: true };
}

export function listCards(filter: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filter.deckId) { clauses.push("deck_id=?"); values.push(String(filter.deckId)); }
  if (filter.pageId) { clauses.push("source_page_id=?"); values.push(String(filter.pageId)); }
  if (filter.due) clauses.push("due_at<=datetime('now')");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`SELECT * FROM cards ${where} ORDER BY due_at LIMIT 500`).all(...values) as Array<Record<string, unknown>>;
  return rows.map(cardRow);
}

/* Cards are matched on their front text so regenerating from the same note
   tops the deck up instead of filling it with duplicates. */
export function addCards(deckId: string, cards: Array<Record<string, unknown>>) {
  const existing = new Set(
    (db.prepare("SELECT lower(trim(front)) AS key FROM cards WHERE deck_id=?").all(deckId) as Array<{ key: string }>).map((row) => row.key),
  );
  const insert = db.prepare(
    `INSERT INTO cards(id,deck_id,front,back,hint,explanation,card_type,tags,source_page_id,source_block_id,source_label,source_timestamp)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const added: string[] = [];
  db.transaction(() => {
    for (const card of cards) {
      const front = String(card.front ?? card.question ?? "").trim();
      if (!front || existing.has(front.toLowerCase())) continue;
      existing.add(front.toLowerCase());
      const id = newId();
      insert.run(
        id, deckId, front, String(card.back ?? card.answer ?? ""), (card.hint as string) || null,
        (card.explanation as string) || null, String(card.type || card.card_type || "basic"),
        json(card.tags || []), (card.sourcePageId as string) || null, (card.sourceBlockId as string) || null,
        (card.sourceLabel as string) || null, card.sourceTimestamp ?? null,
      );
      added.push(id);
    }
  })();
  return { added: added.length, cards: listCards({ deckId }) };
}

export function updateCard(id: string, patch: Record<string, unknown>) {
  const card = db.prepare("SELECT * FROM cards WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!card) return null;
  db.prepare("UPDATE cards SET front=?, back=?, hint=?, explanation=?, card_type=?, tags=? WHERE id=?").run(
    String(patch.front ?? card.front), String(patch.back ?? card.back),
    patch.hint ?? card.hint, patch.explanation ?? card.explanation,
    String(patch.card_type ?? patch.type ?? card.card_type), json(patch.tags ?? unjson(card.tags, [])), id,
  );
  return cardRow(db.prepare("SELECT * FROM cards WHERE id=?").get(id) as Record<string, unknown>);
}

export function deleteCard(id: string) {
  db.prepare("DELETE FROM cards WHERE id=?").run(id);
  return { ok: true };
}

export function studyQueue(deckId?: string, limit = 60) {
  const rows = db
    .prepare(
      `SELECT * FROM cards WHERE due_at<=datetime('now') ${deckId ? "AND deck_id=?" : ""}
       ORDER BY due_at LIMIT ?`,
    )
    .all(...(deckId ? [deckId, limit] : [limit])) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...cardRow(row), intervals: previewIntervals(row as unknown as SchedulerCard) }));
}

export function reviewCard(id: string, rating: Rating, responseMs?: number) {
  const card = db.prepare("SELECT * FROM cards WHERE id=?").get(id) as (Record<string, unknown> & SchedulerCard) | undefined;
  if (!card) return null;
  const next = schedule(card, rating);
  db.transaction(() => {
    db.prepare(
      "UPDATE cards SET state=?, stability=?, difficulty=?, reps=?, lapses=?, due_at=?, last_review=? WHERE id=?",
    ).run(next.state, next.stability, next.difficulty, next.reps, next.lapses, next.due_at, next.last_review, id);
    db.prepare(
      "INSERT INTO card_reviews(id,card_id,rating,elapsed_days,response_ms,stability,difficulty) VALUES(?,?,?,?,?,?,?)",
    ).run(newId(), id, rating, next.elapsed_days, responseMs ?? null, next.stability, next.difficulty);
  })();
  return { card: cardRow(db.prepare("SELECT * FROM cards WHERE id=?").get(id) as Record<string, unknown>), scheduled: next };
}

export function studyStats() {
  return {
    due: (db.prepare("SELECT count(*) AS n FROM cards WHERE due_at<=datetime('now')").get() as { n: number }).n,
    total: (db.prepare("SELECT count(*) AS n FROM cards").get() as { n: number }).n,
    reviewedToday: (db.prepare("SELECT count(*) AS n FROM card_reviews WHERE date(reviewed_at)=date('now')").get() as { n: number }).n,
    streakDays: (db.prepare("SELECT count(DISTINCT date(reviewed_at)) AS n FROM card_reviews WHERE reviewed_at>=datetime('now','-30 days')").get() as { n: number }).n,
    byDay: db.prepare(
      "SELECT date(reviewed_at) AS day, count(*) AS reviews FROM card_reviews WHERE reviewed_at>=datetime('now','-30 days') GROUP BY day ORDER BY day",
    ).all(),
  };
}

/* ---------------------------------------------------------------- tests */

const questionRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  ...row,
  choices: unjson<unknown[]>(row.choices, []),
  answer: unjson<unknown>(row.answer, null),
  source: row.source_page_id ? { pageId: row.source_page_id, blockId: row.source_block_id } : null,
});

export function listTests() {
  return db
    .prepare(
      `SELECT t.*, (SELECT count(*) FROM test_questions WHERE test_id=t.id) AS question_count,
              (SELECT count(*) FROM test_attempts WHERE test_id=t.id AND finished_at IS NOT NULL) AS attempt_count,
              (SELECT max(score*1.0/nullif(max_score,0)) FROM test_attempts WHERE test_id=t.id AND finished_at IS NOT NULL) AS best_ratio
       FROM tests t ORDER BY t.created_at DESC`,
    )
    .all();
}

export function getTest(id: string) {
  const test = db.prepare("SELECT * FROM tests WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!test) return null;
  return {
    ...test,
    config: unjson<Record<string, unknown>>(test.config, {}),
    questions: (db.prepare("SELECT * FROM test_questions WHERE test_id=? ORDER BY sort").all(id) as Array<Record<string, unknown>>).map(questionRow),
    attempts: db.prepare("SELECT * FROM test_attempts WHERE test_id=? ORDER BY started_at DESC LIMIT 20").all(id),
  };
}

export function createTest(input: Record<string, unknown> = {}) {
  const id = newId();
  db.prepare("INSERT INTO tests(id,page_id,title,class_id,config) VALUES(?,?,?,?,?)").run(
    id, input.pageId ? String(input.pageId) : null, String(input.title || "Practice test"), input.classId ?? null, json(input.config || {}),
  );
  if (Array.isArray(input.questions)) setQuestions(id, input.questions as Array<Record<string, unknown>>);
  return getTest(id);
}

export function setQuestions(testId: string, questions: Array<Record<string, unknown>>) {
  const insert = db.prepare(
    `INSERT INTO test_questions(id,test_id,type,prompt,choices,answer,explanation,topic,points,source_page_id,source_block_id,sort)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM test_questions WHERE test_id=?").run(testId);
    questions.forEach((question, index) => {
      insert.run(
        String(question.id || newId()), testId, String(question.type || "multiple_choice"),
        String(question.prompt || ""), json(question.choices || []), json(question.answer ?? null),
        (question.explanation as string) || null, (question.topic as string) || null,
        Number(question.points ?? 1), (question.sourcePageId as string) || null,
        (question.sourceBlockId as string) || null, index,
      );
    });
  })();
  return getTest(testId);
}

export function deleteTest(id: string) {
  db.prepare("DELETE FROM tests WHERE id=?").run(id);
  return { ok: true };
}

export function startAttempt(testId: string) {
  const id = newId();
  db.prepare("INSERT INTO test_attempts(id,test_id) VALUES(?,?)").run(id, testId);
  return db.prepare("SELECT * FROM test_attempts WHERE id=?").get(id);
}

const normalise = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");

/* Objective question types are graded here; short answer and essay are sent
   to the AI grader by the route layer and written back with gradeAnswer. */
export function autoGrade(question: Record<string, unknown>, response: unknown): { score: number; correct: boolean | null } | null {
  const answer = question.answer;
  const points = Number(question.points ?? 1);
  switch (question.type) {
    case "multiple_choice":
    case "true_false": {
      const correct = normalise(response) === normalise(answer);
      return { score: correct ? points : 0, correct };
    }
    case "multiple_response": {
      const expected = asArray(answer).map(normalise).sort();
      const given = asArray(response).map(normalise).sort();
      const correct = expected.length === given.length && expected.every((item, index) => item === given[index]);
      return { score: correct ? points : 0, correct };
    }
    case "fill_blank":
    case "definition":
    case "matching": {
      if (question.type === "matching") {
        const expected = (answer ?? {}) as Record<string, unknown>;
        const given = (response ?? {}) as Record<string, unknown>;
        const keys = Object.keys(expected);
        const hits = keys.filter((key) => normalise(expected[key]) === normalise(given[key])).length;
        return { score: keys.length ? (hits / keys.length) * points : 0, correct: hits === keys.length };
      }
      /* Any listed acceptable answer counts, so a different but correct
         wording is not marked wrong. */
      const accepted = asArray(answer).map(normalise);
      const correct = accepted.includes(normalise(response));
      return { score: correct ? points : 0, correct };
    }
    default:
      return null;
  }
}

export function submitAttempt(attemptId: string, responses: Record<string, unknown>) {
  const attempt = db.prepare("SELECT * FROM test_attempts WHERE id=?").get(attemptId) as Record<string, unknown> | undefined;
  if (!attempt) return null;
  const questions = (db.prepare("SELECT * FROM test_questions WHERE test_id=? ORDER BY sort").all(attempt.test_id) as Array<Record<string, unknown>>).map(questionRow);
  const insert = db.prepare("INSERT INTO test_answers(id,attempt_id,question_id,response,score,correct,feedback) VALUES(?,?,?,?,?,?,?)");
  let score = 0;
  let maxScore = 0;
  const pending: string[] = [];
  db.transaction(() => {
    db.prepare("DELETE FROM test_answers WHERE attempt_id=?").run(attemptId);
    for (const question of questions) {
      maxScore += Number(question.points ?? 1);
      const response = responses[String(question.id)];
      const graded = autoGrade(question, response);
      if (graded) score += graded.score;
      else pending.push(String(question.id));
      insert.run(newId(), attemptId, String(question.id), json(response ?? null), graded?.score ?? 0, graded ? (graded.correct ? 1 : 0) : null, null);
    }
    db.prepare("UPDATE test_attempts SET finished_at=datetime('now'), score=?, max_score=? WHERE id=?").run(score, maxScore, attemptId);
  })();
  return { ...getAttempt(attemptId)!, pendingGrading: pending };
}

export function gradeAnswer(attemptId: string, questionId: string, result: { score: number; feedback?: string; correct?: boolean }) {
  db.prepare("UPDATE test_answers SET score=?, feedback=?, correct=? WHERE attempt_id=? AND question_id=?").run(
    result.score, result.feedback ?? null, result.correct === undefined ? null : result.correct ? 1 : 0, attemptId, questionId,
  );
  const totals = db.prepare("SELECT sum(score) AS total FROM test_answers WHERE attempt_id=?").get(attemptId) as { total: number };
  db.prepare("UPDATE test_attempts SET score=? WHERE id=?").run(totals.total ?? 0, attemptId);
  return getAttempt(attemptId);
}

export function getAttempt(attemptId: string) {
  const attempt = db.prepare("SELECT * FROM test_attempts WHERE id=?").get(attemptId) as Record<string, unknown> | undefined;
  if (!attempt) return null;
  const answers = db
    .prepare(
      `SELECT a.*, q.prompt, q.type, q.choices, q.answer AS expected, q.explanation, q.topic, q.points,
              q.source_page_id, q.source_block_id
       FROM test_answers a JOIN test_questions q ON q.id=a.question_id
       WHERE a.attempt_id=? ORDER BY q.sort`,
    )
    .all(attemptId) as Array<Record<string, unknown>>;
  const byTopic = new Map<string, { topic: string; score: number; max: number }>();
  for (const answer of answers) {
    const topic = String(answer.topic || "General");
    const bucket = byTopic.get(topic) ?? { topic, score: 0, max: 0 };
    bucket.score += Number(answer.score ?? 0);
    bucket.max += Number(answer.points ?? 1);
    byTopic.set(topic, bucket);
  }
  return {
    ...attempt,
    answers: answers.map((answer) => ({
      ...answer,
      response: unjson<unknown>(answer.response, null),
      expected: unjson<unknown>(answer.expected, null),
      choices: unjson<unknown[]>(answer.choices, []),
      source: answer.source_page_id ? { pageId: answer.source_page_id, blockId: answer.source_block_id } : null,
    })),
    topics: [...byTopic.values()].map((bucket) => ({ ...bucket, ratio: bucket.max ? bucket.score / bucket.max : 0 })),
  };
}

/* ------------------------------------------------------------- lectures */

export function startLecture(input: Record<string, unknown> = {}) {
  const page = input.pageId
    ? getPage(String(input.pageId))
    : createPage({ title: String(input.title || `Lecture · ${new Date().toLocaleDateString()}`), classId: input.classId ?? null, icon: "🎙" });
  if (!page) return null;
  const id = newId();
  db.prepare("INSERT INTO lecture_sessions(id,page_id,class_id) VALUES(?,?,?)").run(id, String(page.id), input.classId ?? null);
  return { session: db.prepare("SELECT * FROM lecture_sessions WHERE id=?").get(id), page };
}

export function appendSegment(sessionId: string, segment: Record<string, unknown>) {
  const id = newId();
  db.prepare("INSERT INTO transcript_segments(id,session_id,t_start,t_end,text) VALUES(?,?,?,?,?)").run(
    id, sessionId, Number(segment.start ?? 0), segment.end === undefined ? null : Number(segment.end), String(segment.text || ""),
  );
  return db.prepare("SELECT * FROM transcript_segments WHERE id=?").get(id);
}

export function setLectureStatus(sessionId: string, status: string) {
  db.prepare("UPDATE lecture_sessions SET status=?, ended_at=CASE WHEN ?='ended' THEN datetime('now') ELSE ended_at END WHERE id=?")
    .run(status, status, sessionId);
  return getLecture(sessionId);
}

export function getLecture(sessionId: string): Record<string, unknown> | null {
  const session = db.prepare("SELECT * FROM lecture_sessions WHERE id=?").get(sessionId) as Record<string, unknown> | undefined;
  if (!session) return null;
  return {
    ...session,
    segments: db.prepare("SELECT * FROM transcript_segments WHERE session_id=? ORDER BY t_start").all(sessionId),
  };
}

export function lectureTranscript(sessionId: string) {
  const segments = db.prepare("SELECT t_start, text FROM transcript_segments WHERE session_id=? ORDER BY t_start").all(sessionId) as Array<{ t_start: number; text: string }>;
  return segments.map((segment) => segment.text).join(" ").trim();
}

/* --------------------------------------------------- sources and inbox */

export function listSources(filter: Record<string, unknown> = {}) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filter.pageId) { clauses.push("page_id=?"); values.push(filter.pageId); }
  if (filter.classId) { clauses.push("class_id=?"); values.push(filter.classId); }
  return db.prepare(`SELECT * FROM sources ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT 200`).all(...values);
}

export function addSource(input: Record<string, unknown>) {
  return db
    .prepare("INSERT INTO sources(page_id,class_id,title,type,url,content) VALUES(?,?,?,?,?,?) RETURNING *")
    .get(input.pageId ?? null, input.classId ?? null, String(input.title || input.url || "Source"), String(input.type || "web"), (input.url as string) || null, String(input.content || ""));
}

export function addSourceRefs(ownerKind: string, ownerId: string, refs: Array<Record<string, unknown>>) {
  const insert = db.prepare("INSERT INTO source_refs(id,owner_kind,owner_id,page_id,block_id,source_id,label,timestamp_s) VALUES(?,?,?,?,?,?,?,?)");
  db.transaction(() => {
    for (const ref of refs) {
      insert.run(newId(), ownerKind, ownerId, (ref.pageId as string) || null, (ref.blockId as string) || null, ref.sourceId ?? null, (ref.label as string) || null, ref.timestamp ?? null);
    }
  })();
  return { ok: true };
}

export function sourceRefs(ownerKind: string, ownerId: string) {
  return db
    .prepare(
      `SELECT r.*, p.title AS page_title, p.icon AS page_icon FROM source_refs r
       LEFT JOIN pages2 p ON p.id=r.page_id WHERE r.owner_kind=? AND r.owner_id=?`,
    )
    .all(ownerKind, ownerId);
}

/* ------------------------------------------------------------- comments */

export function listComments(pageId: string) {
  return db.prepare("SELECT * FROM comments WHERE page_id=? ORDER BY created_at, rowid").all(pageId)
    .map((row) => ({ ...(row as Record<string, unknown>), resolved: Boolean((row as Record<string, unknown>).resolved) }));
}

/* How many open comments each block of a page carries, so the editor can mark them without loading the thread. */
export function commentCounts(pageId: string) {
  return db.prepare("SELECT block_id, count(*) AS n FROM comments WHERE page_id=? AND resolved=0 AND block_id IS NOT NULL GROUP BY block_id").all(pageId);
}

export function addComment(pageId: string, input: Record<string, unknown>) {
  const body = String(input.body || "").trim().slice(0, 4000);
  if (!body) return { error: "A comment needs some text" };
  if (!db.prepare("SELECT 1 FROM pages2 WHERE id=?").get(pageId)) return { error: "Page not found" };
  const id = newId();
  db.prepare("INSERT INTO comments(id,page_id,block_id,quote,body) VALUES(?,?,?,?,?)")
    .run(id, pageId, input.blockId ? String(input.blockId) : null, String(input.quote || "").replace(/\s+/g, " ").trim().slice(0, 240), body);
  return db.prepare("SELECT * FROM comments WHERE id=?").get(id);
}

export function updateComment(id: string, input: Record<string, unknown>) {
  const row = db.prepare("SELECT * FROM comments WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!row) return { error: "Comment not found" };
  const body = input.body === undefined ? String(row.body) : String(input.body).trim().slice(0, 4000);
  if (!body) return { error: "A comment needs some text" };
  const resolved = input.resolved === undefined ? Number(row.resolved) : input.resolved ? 1 : 0;
  db.prepare("UPDATE comments SET body=?, resolved=?, updated_at=datetime('now') WHERE id=?").run(body, resolved, id);
  const next = db.prepare("SELECT * FROM comments WHERE id=?").get(id) as Record<string, unknown>;
  return { ...next, resolved: Boolean(next.resolved) };
}

export function deleteComment(id: string) {
  db.prepare("DELETE FROM comments WHERE id=?").run(id);
  return { ok: true };
}

/* ----------------------------------------------------------------- meta */

export function getMeta(key: string) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key=?").get(key) as { value: string } | undefined;
  return { key, value: row?.value ?? null };
}

export function setMeta(key: string, value: string | null) {
  if (value === null || value === "") db.prepare("DELETE FROM app_meta WHERE key=?").run(key);
  else db.prepare("INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  return getMeta(key);
}

/* ---------------------------------------------------------- synced blocks */

export function listSynced() {
  return db.prepare("SELECT id, text, updated_at FROM synced_blocks ORDER BY updated_at DESC LIMIT 100").all();
}
export function getSynced(id: string) { return db.prepare("SELECT id, text, updated_at FROM synced_blocks WHERE id=?").get(id) ?? null; }
export function createSynced(text = "") {
  const id = newId();
  db.prepare("INSERT INTO synced_blocks(id,text) VALUES(?,?)").run(id, String(text).slice(0, 20000));
  return getSynced(id);
}
export function saveSynced(id: string, text: string) {
  db.prepare("UPDATE synced_blocks SET text=?, updated_at=datetime('now') WHERE id=?").run(String(text).slice(0, 20000), id);
  return getSynced(id);
}

/* ---------------------------------------------------------------- chats */

export function listChats(pageId?: string) {
  return db.prepare(
    `SELECT c.*, (SELECT count(*) FROM chat_messages WHERE chat_id=c.id) AS message_count,
            (SELECT text FROM chat_messages WHERE chat_id=c.id AND role='user' ORDER BY sort LIMIT 1) AS opener,
            (SELECT title FROM pages2 WHERE id=c.page_id) AS page_title,
            (SELECT icon FROM pages2 WHERE id=c.page_id) AS page_icon
     FROM chats c ${pageId ? "WHERE c.page_id=?" : ""} ORDER BY c.updated_at DESC LIMIT 100`,
  ).all(...(pageId ? [pageId] : []));
}

export function getChat(id: string): Record<string, unknown> | null {
  const chat = db.prepare("SELECT c.*, (SELECT title FROM pages2 WHERE id=c.page_id) AS page_title, (SELECT icon FROM pages2 WHERE id=c.page_id) AS page_icon FROM chats c WHERE c.id=?").get(id) as Record<string, unknown> | undefined;
  if (!chat) return null;
  const messages = (db.prepare("SELECT * FROM chat_messages WHERE chat_id=? ORDER BY sort").all(id) as Array<Record<string, unknown>>)
    .map((row) => ({
      ...row,
      sources: unjson<unknown[]>(row.sources, []),
      citations: unjson<unknown[]>(row.citations, []),
    }));
  return { ...chat, messages };
}

export function createChat(title?: string, pageId?: string | null) {
  const id = newId();
  db.prepare("INSERT INTO chats(id,title,page_id) VALUES(?,?,?)").run(id, String(title || "New chat"), pageId ? String(pageId) : null);
  return getChat(id);
}

/* The first question becomes the thread's name, which is what makes the
   history list readable without asking anyone to name anything. */
export function addChatMessage(chatId: string, message: Record<string, unknown>) {
  const chat = db.prepare("SELECT id, title FROM chats WHERE id=?").get(chatId) as { id: string; title: string } | undefined;
  if (!chat) return { error: "Chat not found" };
  const sort = (db.prepare("SELECT coalesce(max(sort),-1) AS m FROM chat_messages WHERE chat_id=?").get(chatId) as { m: number }).m + 1;
  const id = newId();
  db.prepare(
    "INSERT INTO chat_messages(id,chat_id,role,text,sources,citations,searched,sort) VALUES(?,?,?,?,?,?,?,?)",
  ).run(id, chatId, String(message.role || "user"), String(message.text || ""),
    json(message.sources || []), json(message.citations || []), (message.searched as string) || null, sort);
  if (message.role === "user" && (chat.title === "New chat" || !chat.title.trim())) {
    const title = String(message.text || "").replace(/\s+/g, " ").trim().slice(0, 70) || "New chat";
    db.prepare("UPDATE chats SET title=? WHERE id=?").run(title, chatId);
  }
  db.prepare("UPDATE chats SET updated_at=datetime('now') WHERE id=?").run(chatId);
  return db.prepare("SELECT * FROM chat_messages WHERE id=?").get(id);
}

export function renameChat(id: string, title: string) {
  db.prepare("UPDATE chats SET title=? WHERE id=?").run(String(title || "New chat").slice(0, 120), id);
  return db.prepare("SELECT * FROM chats WHERE id=?").get(id);
}

export function deleteChat(id: string) {
  db.prepare("DELETE FROM chats WHERE id=?").run(id);
  return { ok: true };
}

/* Threads that were opened and never used are not history. */
export function pruneEmptyChats(keepId?: string) {
  db.prepare(
    `DELETE FROM chats WHERE id<>coalesce(?, '') AND NOT EXISTS (SELECT 1 FROM chat_messages WHERE chat_id=chats.id)`,
  ).run(keepId ?? null);
  return { ok: true };
}

export function listInbox(filter: Record<string, unknown> = {}) {
  const clauses = ["archived_at IS NULL"];
  if (filter.unread) clauses.push("read_at IS NULL");
  return db.prepare(`SELECT * FROM inbox_events WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`).all();
}

export function addInboxEvent(event: Record<string, unknown>) {
  const id = newId();
  db.prepare("INSERT INTO inbox_events(id,kind,title,body,page_id) VALUES(?,?,?,?,?)").run(
    id, String(event.kind || "system"), String(event.title || ""), (event.body as string) || null, (event.pageId as string) || null,
  );
  return db.prepare("SELECT * FROM inbox_events WHERE id=?").get(id);
}

export function markInbox(id: string | null, action: "read" | "archive" | "read_all") {
  if (action === "read_all") db.prepare("UPDATE inbox_events SET read_at=datetime('now') WHERE read_at IS NULL").run();
  else if (id && action === "read") db.prepare("UPDATE inbox_events SET read_at=datetime('now') WHERE id=?").run(id);
  else if (id) db.prepare("UPDATE inbox_events SET archived_at=datetime('now') WHERE id=?").run(id);
  return listInbox();
}

/* ------------------------------------------------------ classes, export */

export function listClasses() {
  return db.prepare("SELECT * FROM classes ORDER BY name").all();
}

export function createClass(name: string, color?: string) {
  return db.prepare("INSERT INTO classes(name,color) VALUES(?,?) RETURNING *").get(name, color || "#5474e8");
}

export function renameClass(id: number, name: string) {
  db.prepare("UPDATE classes SET name=? WHERE id=?").run(name, id);
  return db.prepare("SELECT * FROM classes WHERE id=?").get(id);
}

export function deleteClass(id: number) {
  db.prepare("UPDATE pages2 SET class_id=NULL WHERE class_id=?").run(id);
  db.prepare("DELETE FROM classes WHERE id=?").run(id);
  return { ok: true };
}

const safeName = (value: string) => value.replace(/[^\w \-.]/g, "").trim() || "Untitled";

export async function exportAll() {
  const root = path.join(process.cwd(), "exports");
  await fs.mkdir(root, { recursive: true });
  const pages = db
    .prepare(`SELECT p.id, p.title, coalesce(c.name,'Notes') AS class_name FROM pages2 p LEFT JOIN classes c ON c.id=p.class_id WHERE p.trashed_at IS NULL AND p.kind<>'record'`)
    .all() as Array<{ id: string; title: string; class_name: string }>;
  for (const page of pages) {
    const directory = path.join(root, safeName(page.class_name));
    await fs.mkdir(directory, { recursive: true });
    const body = pageMarkdown(page.id) ?? "";
    await fs.writeFile(path.join(directory, `${safeName(page.title || `Note ${page.id}`)}.md`), body);
  }
  return { path: root, count: pages.length };
}

export function exportDatabaseCsv(databaseId: string) {
  const database = getDatabase(databaseId);
  if (!database) return null;
  const records = listRecords(databaseId);
  const escape = (value: unknown) => `"${textOf(value).replace(/"/g, '""')}"`;
  const header = database.properties.map((property) => escape(property.name)).join(",");
  const rows = records.map((record) =>
    database.properties.map((property) => escape((record.values as Record<string, unknown>)[property.id])).join(","),
  );
  return [header, ...rows].join("\n");
}

export function bootstrap() {
  return {
    pages: listPages(),
    classes: listClasses(),
    decks: listDecks(),
    tests: listTests(),
    study: studyStats(),
    inbox: listInbox(),
    sources: listSources(),
    trash: listTrash().length,
  };
}
