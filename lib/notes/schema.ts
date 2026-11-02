/* Clyra Notes — workspace schema.
   One SQLite database backs pages, blocks, databases, study material and AI
   grounding. Existing markdown pages are migrated into blocks additively:
   the original `pages.markdown` column is retained so a downgrade or an
   external export never loses a user's writing. */
import Database from "better-sqlite3";
import path from "node:path";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

const dataRoot = path.join(process.cwd(), "data", "notes");
const dbPath = path.join(dataRoot, "clyra-notes.db");

export type DB = Database.Database;
export const newId = () => randomUUID();

/* Pages, blocks and databases all use text ids so records created offline can
   keep the id they were born with. Legacy integer page ids are preserved as
   text ("41") by the migration, which keeps every existing link working. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS pages2(
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES pages2(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'page',            -- page | database | record
  database_id TEXT,                             -- set when kind='record'
  title TEXT NOT NULL DEFAULT '',
  icon TEXT,
  cover TEXT,
  cover_offset REAL DEFAULT 50,
  class_id INTEGER,
  favorite INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  full_width INTEGER NOT NULL DEFAULT 0,
  text_size TEXT NOT NULL DEFAULT 'medium',
  font_style TEXT NOT NULL DEFAULT 'default',
  colour_categories TEXT NOT NULL DEFAULT '[]',
  sort REAL NOT NULL DEFAULT 0,
  trashed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pages2_parent ON pages2(parent_id, sort);
CREATE INDEX IF NOT EXISTS pages2_database ON pages2(database_id);
CREATE INDEX IF NOT EXISTS pages2_trash ON pages2(trashed_at);

CREATE TABLE IF NOT EXISTS blocks(
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',                -- plain text with inline marks
  props TEXT NOT NULL DEFAULT '{}',             -- JSON, type specific
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS blocks_page ON blocks(page_id, parent_id, sort);

CREATE TABLE IF NOT EXISTS databases(
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  inline INTEGER NOT NULL DEFAULT 0,
  page_layout TEXT NOT NULL DEFAULT '{}',       -- JSON: header/detail properties
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS db_properties(
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                           -- title|text|number|select|...
  config TEXT NOT NULL DEFAULT '{}',            -- JSON: options, format, formula
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS db_properties_db ON db_properties(database_id, sort);

CREATE TABLE IF NOT EXISTS db_values(
  record_id TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES db_properties(id) ON DELETE CASCADE,
  value TEXT,                                   -- JSON encoded
  PRIMARY KEY(record_id, property_id)
);

CREATE TABLE IF NOT EXISTS db_views(
  id TEXT PRIMARY KEY,
  database_id TEXT NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Table',
  type TEXT NOT NULL DEFAULT 'table',
  config TEXT NOT NULL DEFAULT '{}',            -- JSON: filters, sorts, group…
  sort REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS db_views_db ON db_views(database_id, sort);

/* Relation edges are stored once per direction so a rollup can read either
   side without scanning every record's JSON value. */
CREATE TABLE IF NOT EXISTS db_relations(
  property_id TEXT NOT NULL REFERENCES db_properties(id) ON DELETE CASCADE,
  from_record TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  to_record TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  PRIMARY KEY(property_id, from_record, to_record)
);
CREATE INDEX IF NOT EXISTS db_relations_to ON db_relations(property_id, to_record);

CREATE TABLE IF NOT EXISTS page_versions(
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  title TEXT,
  snapshot TEXT NOT NULL,                       -- JSON block tree
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS page_versions_page ON page_versions(page_id, created_at DESC);

/* A link row is written for every @mention, [[wiki link]] and inline page
   reference, which is what makes backlinks exact rather than title guesses. */
CREATE TABLE IF NOT EXISTS page_links(
  source_page TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  source_block TEXT,
  target_page TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  PRIMARY KEY(source_page, source_block, target_page)
);
CREATE INDEX IF NOT EXISTS page_links_target ON page_links(target_page);

CREATE TABLE IF NOT EXISTS decks(
  id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES pages2(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled deck',
  class_id INTEGER,
  topic TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* FSRS state per card. The state column follows the FSRS convention:
   0 new, 1 learning, 2 review, 3 relearning. */
CREATE TABLE IF NOT EXISTS cards(
  id TEXT PRIMARY KEY,
  deck_id TEXT REFERENCES decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL DEFAULT '',
  back TEXT NOT NULL DEFAULT '',
  hint TEXT,
  explanation TEXT,
  card_type TEXT NOT NULL DEFAULT 'basic',      -- basic|cloze|term|qa|concept
  tags TEXT NOT NULL DEFAULT '[]',
  source_page_id TEXT,
  source_block_id TEXT,
  source_label TEXT,
  source_timestamp REAL,
  state INTEGER NOT NULL DEFAULT 0,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cards_due ON cards(due_at);
CREATE INDEX IF NOT EXISTS cards_deck ON cards(deck_id);

CREATE TABLE IF NOT EXISTS card_reviews(
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,                      -- 1 again 2 hard 3 good 4 easy
  elapsed_days REAL NOT NULL DEFAULT 0,
  response_ms INTEGER,
  stability REAL,
  difficulty REAL,
  reviewed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS card_reviews_card ON card_reviews(card_id, reviewed_at);

CREATE TABLE IF NOT EXISTS tests(
  id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES pages2(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Practice test',
  class_id INTEGER,
  config TEXT NOT NULL DEFAULT '{}',            -- JSON: time limit, exam mode
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_questions(
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'multiple_choice',
  prompt TEXT NOT NULL DEFAULT '',
  choices TEXT NOT NULL DEFAULT '[]',           -- JSON array
  answer TEXT NOT NULL DEFAULT 'null',          -- JSON, shape depends on type
  explanation TEXT,
  topic TEXT,
  points REAL NOT NULL DEFAULT 1,
  source_page_id TEXT,
  source_block_id TEXT,
  sort REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS test_questions_test ON test_questions(test_id, sort);

CREATE TABLE IF NOT EXISTS test_attempts(
  id TEXT PRIMARY KEY,
  test_id TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  score REAL,
  max_score REAL
);

CREATE TABLE IF NOT EXISTS test_answers(
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES test_questions(id) ON DELETE CASCADE,
  response TEXT,                                -- JSON
  score REAL NOT NULL DEFAULT 0,
  correct INTEGER,
  feedback TEXT
);
CREATE INDEX IF NOT EXISTS test_answers_attempt ON test_answers(attempt_id);

CREATE TABLE IF NOT EXISTS lecture_sessions(
  id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES pages2(id) ON DELETE CASCADE,
  class_id INTEGER,
  status TEXT NOT NULL DEFAULT 'recording',     -- recording|paused|ended
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS transcript_segments(
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES lecture_sessions(id) ON DELETE CASCADE,
  t_start REAL NOT NULL DEFAULT 0,
  t_end REAL,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS transcript_session ON transcript_segments(session_id, t_start);

/* Every AI-produced artefact records what it was derived from, so "Show
   source" can jump to the exact block instead of guessing. */
CREATE TABLE IF NOT EXISTS source_refs(
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,                     -- card|question|block|page
  owner_id TEXT NOT NULL,
  page_id TEXT,
  block_id TEXT,
  source_id INTEGER,
  label TEXT,
  timestamp_s REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS source_refs_owner ON source_refs(owner_kind, owner_id);

/* Chat threads. Kept separate from pages: a conversation is a transcript,
   not a document, and deleting one should never touch the notes it cited. */
/* Small workspace flags that must follow the workspace rather than one browser (whether the welcome tour has been seen). */
CREATE TABLE IF NOT EXISTS app_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chats(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS chats_recent ON chats(updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages(
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  sources TEXT NOT NULL DEFAULT '[]',
  citations TEXT NOT NULL DEFAULT '[]',
  searched TEXT,
  sort REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages(chat_id, sort);

/* Comments on a page, or on one block of it. A block id is kept as text rather than a reference: a block can be deleted
   while the conversation about it is worth keeping, and the comment then simply says what it was on. */
CREATE TABLE IF NOT EXISTS comments(
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages2(id) ON DELETE CASCADE,
  block_id TEXT,
  quote TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS comments_page ON comments(page_id, created_at);

CREATE TABLE IF NOT EXISTS inbox_events(
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT,
  page_id TEXT,
  read_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS inbox_created ON inbox_events(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  title, body, kind UNINDEXED, page_id UNINDEXED, block_id UNINDEXED
);
`;

export async function openNotesDb(): Promise<DB> {
  await fs.mkdir(dataRoot, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  legacySchema(db);
  db.exec(SCHEMA);
  /* Additive migration for documents created before smart colour coding. */
  const pageColumns = new Set((db.prepare("PRAGMA table_info(pages2)").all() as Array<{ name: string }>).map((c) => c.name));
  if (!pageColumns.has("colour_categories")) db.exec("ALTER TABLE pages2 ADD COLUMN colour_categories TEXT NOT NULL DEFAULT '[]'");
  /* Page locks can carry a password: only a salted scrypt hash is ever stored. */
  if (!pageColumns.has("lock_hash")) db.exec("ALTER TABLE pages2 ADD COLUMN lock_hash TEXT");
  if (!pageColumns.has("lock_salt")) db.exec("ALTER TABLE pages2 ADD COLUMN lock_salt TEXT");
  /* "pin6" | "pin8" | "password": how the unlock screen should ask for it. */
  if (!pageColumns.has("lock_kind")) db.exec("ALTER TABLE pages2 ADD COLUMN lock_kind TEXT");
  /* A chat can belong to one note: the note's own thread, kept with it. */
  const chatColumns = new Set((db.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>).map((c) => c.name));
  if (!chatColumns.has("page_id")) db.exec("ALTER TABLE chats ADD COLUMN page_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS chats_page ON chats(page_id, updated_at DESC)");
  migrateLegacyPages(db);
  return db;
}

/* The pre-block schema is still created so a user who opens an older build,
   or an export written against it, keeps working. Nothing reads `markdown`
   for editing any more — it is only the migration input and a safety copy. */
function legacySchema(db: DB) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS classes(id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#5474e8', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, title TEXT NOT NULL, markdown TEXT DEFAULT '', class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL, favorite INTEGER DEFAULT 0, inbox INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY, page_id INTEGER, class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL, title TEXT, type TEXT, url TEXT, content TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY);`);
  const columns = new Set(
    (db.prepare("PRAGMA table_info(pages)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, definition] of [
    ["parent_id", "INTEGER"],
    ["icon", "TEXT"],
    ["cover", "TEXT"],
    ["font_style", "TEXT DEFAULT 'default'"],
    ["small_text", "INTEGER DEFAULT 0"],
    ["full_width", "INTEGER DEFAULT 0"],
    ["text_size", "TEXT DEFAULT 'medium'"],
  ] as Array<[string, string]>) {
    if (!columns.has(name)) db.exec(`ALTER TABLE pages ADD COLUMN ${name} ${definition}`);
  }
}

const done = (db: DB, version: number) => {
  const row = db.prepare("SELECT version FROM migrations WHERE version=?").get(version);
  return Boolean(row);
};

/* Copies every legacy row into `pages2` + `blocks` exactly once. Legacy ids
   become the text id of the new page, so old links and bookmarks resolve. */
function migrateLegacyPages(db: DB) {
  if (done(db, 2)) return;
  const legacy = db
    .prepare("SELECT * FROM pages ORDER BY id")
    .all() as Array<Record<string, unknown>>;
  const insertPage = db.prepare(
    `INSERT OR IGNORE INTO pages2(id,parent_id,kind,title,icon,cover,class_id,favorite,full_width,text_size,font_style,sort,created_at,updated_at)
     VALUES(@id,@parent_id,'page',@title,@icon,@cover,@class_id,@favorite,@full_width,@text_size,@font_style,@sort,@created_at,@updated_at)`,
  );
  db.transaction(() => {
    legacy.forEach((row, index) => {
      insertPage.run({
        id: String(row.id),
        parent_id: row.parent_id == null ? null : String(row.parent_id),
        title: String(row.title ?? ""),
        icon: (row.icon as string) || null,
        cover: (row.cover as string) || null,
        class_id: row.class_id ?? null,
        favorite: row.favorite ? 1 : 0,
        full_width: row.full_width ? 1 : 0,
        text_size: (row.text_size as string) || "medium",
        font_style: (row.font_style as string) || "default",
        sort: index,
        created_at: String(row.created_at ?? new Date().toISOString()),
        updated_at: String(row.updated_at ?? new Date().toISOString()),
      });
    });
    db.prepare("INSERT OR IGNORE INTO migrations(version) VALUES(2)").run();
  })();
}

export { dbPath, dataRoot };
