import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { clyraDataPath } from "../runtime-paths";

export type MemoryKind = "user" | "agent" | "project" | "session";
export type MemoryState = "active" | "superseded" | "archived" | "deleted";
export type MemoryCategory =
  | "profile"
  | "preference"
  | "fact"
  | "goal"
  | "lesson"
  | "decision"
  | "workflow"
  | "technical"
  | "correction"
  | "recovery";
export type Sensitivity = "low" | "personal" | "sensitive";

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  /** 'user' (global), 'agent' (operational), 'project:<id>', 'session:<id>' */
  scope: string;
  category: MemoryCategory;
  content: string;
  source: string;
  confidence: number;
  sensitivity: Sensitivity;
  state: MemoryState;
  pinned: number;
  expiresAt: string | null;
  projectRef: string | null;
  sessionRef: string | null;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export type MemoryVersion = {
  id: number;
  entryId: string;
  revision: number;
  content: string;
  category: MemoryCategory;
  kind: MemoryKind;
  scope: string;
  confidence: number;
  reason: string | null;
  createdAt: string;
};

export type PendingChange = {
  id: string;
  targetType: "memory" | "skill" | "identity";
  targetId: string | null;
  action: "create" | "update" | "delete" | "archive";
  proposed: string;
  beforeSnapshot: string | null;
  rationale: string | null;
  source: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  resolvedAt: string | null;
};

export type AuditEventRow = {
  id: number;
  event: string;
  entityType: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: string;
};

export type MemorySession = {
  id: string;
  title: string;
  projectRef: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  version: number;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type SkillVersion = {
  id: number;
  skillId: string;
  version: number;
  content: string;
  description: string;
  reason: string | null;
  createdAt: string;
};

export type LearningJob = {
  id: string;
  kind: string;
  payload: string;
  state: "queued" | "running" | "done" | "failed";
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_POLICIES = {
  autoMemoryWrites: "auto",
  autoSkillWrites: "review",
  autoIdentityChanges: "review",
  sensitiveApproval: "review",
  retentionDays: "365",
  memoryBudgetTokens: "1400",
  llmCuration: "on",
} as const;

export type MemoryPolicies = Record<string, string>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('user','agent','project','session')),
  scope TEXT NOT NULL DEFAULT 'user',
  category TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'conversation',
  confidence REAL NOT NULL DEFAULT 0.5,
  sensitivity TEXT NOT NULL DEFAULT 'low' CHECK (sensitivity IN ('low','personal','sensitive')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','superseded','archived','deleted')),
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  project_ref TEXT,
  session_ref TEXT,
  superseded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS memory_entries_scope ON memory_entries(scope, state);
CREATE INDEX IF NOT EXISTS memory_entries_kind ON memory_entries(kind, category, state);
CREATE INDEX IF NOT EXISTS memory_entries_updated ON memory_entries(updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content, category UNINDEXED, kind UNINDEXED, scope UNINDEXED, id UNINDEXED
);

CREATE TABLE IF NOT EXISTS memory_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS memory_versions_entry ON memory_versions(entry_id, revision DESC);

CREATE TABLE IF NOT EXISTS pending_changes (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('memory','skill','identity')),
  target_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete','archive')),
  proposed TEXT NOT NULL,
  before_snapshot TEXT,
  rationale TEXT,
  source TEXT NOT NULL DEFAULT 'learning',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS pending_changes_status ON pending_changes(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS audit_events_recent ON audit_events(id DESC);

CREATE TABLE IF NOT EXISTS memory_sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  project_ref TEXT,
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS memory_sessions_recent ON memory_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS session_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS session_messages_session ON session_messages(session_id, id);

CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
  session_id UNINDEXED, text, role UNINDEXED
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS skills_status ON skills(status, name);

CREATE TABLE IF NOT EXISTS skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS skill_versions_skill ON skill_versions(skill_id, version DESC);

CREATE TABLE IF NOT EXISTS learning_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS learning_jobs_state ON learning_jobs(state, created_at);

CREATE TABLE IF NOT EXISTS memory_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const MEMORY_DIR = "memory";

export function memoryDataPath(...segments: string[]) {
  return clyraDataPath(MEMORY_DIR, ...segments);
}

export function memoryDbPath() {
  return clyraDataPath("data", "clyra-memory.sqlite");
}

export function skillsDir() {
  return clyraDataPath("skills");
}

let cached: Database.Database | null = null;

export function openMemoryDb(): Database.Database {
  if (cached) return cached;
  const dbPath = memoryDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  cached = db;
  return db;
}

/** Test isolation: close the cached handle and (optionally) point storage
 * elsewhere via CLYRA_DATA_ROOT before reopening. */
export function closeMemoryDb() {
  if (cached) {
    cached.close();
    cached = null;
  }
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
