import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { MissionRecord } from "./core";

/** Durable, transactional mission trace storage. It stores state snapshots, not
 * model prompts or credentials, so interrupted work can be safely resumed. */
export class MissionStore {
  private db: Database.Database;
  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS clyra_missions (
      id TEXT PRIMARY KEY, project_id TEXT, state TEXT NOT NULL, payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
  }
  save(record: MissionRecord) {
    this.db.prepare(`INSERT INTO clyra_missions(id,project_id,state,payload,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,state=excluded.state,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(record.id, record.projectId || null, record.state, JSON.stringify(record), record.updatedAt);
  }
  get(id: string): MissionRecord | null {
    const row = this.db.prepare("SELECT payload FROM clyra_missions WHERE id=?").get(id) as { payload?: string } | undefined;
    if (!row?.payload) return null;
    try { return JSON.parse(row.payload) as MissionRecord; } catch { return null; }
  }
  interrupted() {
    return (this.db.prepare("SELECT payload FROM clyra_missions WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED') ORDER BY updated_at DESC").all() as Array<{ payload: string }>)
      .flatMap((row) => { try { return [JSON.parse(row.payload) as MissionRecord]; } catch { return []; } });
  }
  close() { this.db.close(); }
}
