/**
 * One history for manual edits and AI edits alike (spec §80, §81, §143).
 *
 * An entire AI task collapses into ONE undo entry: `beginTransaction` opens a
 * group, every patch inside it lands in that group, and `commit` pushes a
 * single semantic entry. That is what makes "undo" after a generated castle
 * remove the castle rather than one wall.
 */
import type { GameProjectIR } from "../ir/types";

export interface HistoryEntry {
  id: string;
  author: "user" | "ai" | "system";
  label: string;
  timestamp: number;
  /** Counts shown in the AI diff panel (spec §178). */
  summary: { created: number; changed: number; deleted: number };
  /** Full project snapshot taken *before* the entry was applied. */
  before: GameProjectIR;
  after: GameProjectIR;
}

export interface Checkpoint {
  id: string;
  label: string;
  timestamp: number;
  project: GameProjectIR;
}

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

export class HistoryStack {
  private entries: HistoryEntry[] = [];
  private cursor = -1;
  private checkpoints: Checkpoint[] = [];
  private transaction: { label: string; author: HistoryEntry["author"]; before: GameProjectIR; changed: Set<string>; created: Set<string>; deleted: Set<string> } | null = null;
  private readonly limit: number;

  constructor(limit = 60) {
    this.limit = limit;
  }

  get canUndo() {
    return this.cursor >= 0;
  }

  get canRedo() {
    return this.cursor < this.entries.length - 1;
  }

  get inTransaction() {
    return this.transaction !== null;
  }

  list(): Omit<HistoryEntry, "before" | "after">[] {
    return this.entries.map(({ before: _before, after: _after, ...rest }) => rest);
  }

  /** Index of the entry the project currently sits at, -1 for "original". */
  get position() {
    return this.cursor;
  }

  beginTransaction(label: string, author: HistoryEntry["author"], project: GameProjectIR) {
    if (this.transaction) return;
    this.transaction = { label, author, before: structuredClone(project), changed: new Set(), created: new Set(), deleted: new Set() };
  }

  /** Record which entities an operation touched, for the diff summary. */
  noteChange(kind: "created" | "changed" | "deleted", entityIds: string[]) {
    if (!this.transaction) return;
    for (const id of entityIds) this.transaction[kind].add(id);
  }

  abortTransaction(): GameProjectIR | null {
    const open = this.transaction;
    this.transaction = null;
    return open ? open.before : null;
  }

  commitTransaction(project: GameProjectIR): HistoryEntry | null {
    const open = this.transaction;
    this.transaction = null;
    if (!open) return null;
    // Nothing actually happened — do not litter history with empty turns.
    if (JSON.stringify(open.before) === JSON.stringify(project)) return null;
    return this.pushEntry({
      author: open.author,
      label: open.label,
      before: open.before,
      after: project,
      summary: { created: open.created.size, changed: open.changed.size, deleted: open.deleted.size },
    });
  }

  /** Record a single, non-grouped edit (a manual gizmo drag, a rename). */
  push(options: {
    author: HistoryEntry["author"];
    label: string;
    before: GameProjectIR;
    after: GameProjectIR;
    summary?: HistoryEntry["summary"];
  }): HistoryEntry {
    return this.pushEntry({ ...options, summary: options.summary ?? { created: 0, changed: 1, deleted: 0 } });
  }

  private pushEntry(options: {
    author: HistoryEntry["author"];
    label: string;
    before: GameProjectIR;
    after: GameProjectIR;
    summary: HistoryEntry["summary"];
  }): HistoryEntry {
    // A new edit after undo discards the redo tail.
    this.entries = this.entries.slice(0, this.cursor + 1);
    const entry: HistoryEntry = {
      id: nextId("history"),
      timestamp: Date.now(),
      author: options.author,
      label: options.label,
      summary: options.summary,
      before: structuredClone(options.before),
      after: structuredClone(options.after),
    };
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.cursor = this.entries.length - 1;
    return entry;
  }

  undo(): { project: GameProjectIR; entry: HistoryEntry } | null {
    if (!this.canUndo) return null;
    const entry = this.entries[this.cursor]!;
    this.cursor -= 1;
    return { project: structuredClone(entry.before), entry };
  }

  redo(): { project: GameProjectIR; entry: HistoryEntry } | null {
    if (!this.canRedo) return null;
    this.cursor += 1;
    const entry = this.entries[this.cursor]!;
    return { project: structuredClone(entry.after), entry };
  }

  /* ---------------- checkpoints (spec §80) ---------------- */

  checkpoint(label: string, project: GameProjectIR): Checkpoint {
    const checkpoint: Checkpoint = { id: nextId("checkpoint"), label, timestamp: Date.now(), project: structuredClone(project) };
    this.checkpoints.push(checkpoint);
    if (this.checkpoints.length > 20) this.checkpoints.shift();
    return checkpoint;
  }

  listCheckpoints(): Omit<Checkpoint, "project">[] {
    return this.checkpoints.map(({ project: _project, ...rest }) => rest);
  }

  rollback(checkpointId: string): GameProjectIR | null {
    const checkpoint = this.checkpoints.find((entry) => entry.id === checkpointId);
    return checkpoint ? structuredClone(checkpoint.project) : null;
  }

  clear() {
    this.entries = [];
    this.checkpoints = [];
    this.cursor = -1;
    this.transaction = null;
  }
}
