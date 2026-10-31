// Undo/redo for the Shorts editor. Each edit is a command holding the project
// state before and after it. Manual edits and AI edits both go through
// `commit`, so there is no special path that bypasses history. Rapid edits to
// the same control (a slider drag, typing) merge into one step.

import type { ShortsProject } from "../../lib/shorts/schema";

export type Command = {
  label: string;
  /** Edits sharing a key within the merge window collapse into one undo step. */
  mergeKey?: string;
  before: ShortsProject;
  after: ShortsProject;
  at: number;
};

export type History = {
  past: Command[];
  future: Command[];
};

export const HISTORY_LIMIT = 300;
export const MERGE_WINDOW_MS = 900;

export function emptyHistory(): History {
  return { past: [], future: [] };
}

/** Records an edit. Returns the new project state and the new history. */
export function commit(history: History, current: ShortsProject, next: ShortsProject, label: string, mergeKey?: string, now = Date.now()): History {
  if (current === next) return history;
  const last = history.past.at(-1);
  if (mergeKey && last && last.mergeKey === mergeKey && now - last.at < MERGE_WINDOW_MS) {
    const merged: Command = { ...last, after: next, at: now };
    return { past: [...history.past.slice(0, -1), merged], future: [] };
  }
  const command: Command = { label, mergeKey, before: current, after: next, at: now };
  return { past: [...history.past, command].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(history: History): { history: History; project: ShortsProject | null } {
  const command = history.past.at(-1);
  if (!command) return { history, project: null };
  return {
    history: { past: history.past.slice(0, -1), future: [command, ...history.future].slice(0, HISTORY_LIMIT) },
    project: command.before,
  };
}

export function redo(history: History): { history: History; project: ShortsProject | null } {
  const command = history.future[0];
  if (!command) return { history, project: null };
  return {
    history: { past: [...history.past, command].slice(-HISTORY_LIMIT), future: history.future.slice(1) },
    project: command.after,
  };
}

export function undoLabel(history: History) {
  return history.past.at(-1)?.label ?? null;
}

export function redoLabel(history: History) {
  return history.future[0]?.label ?? null;
}
