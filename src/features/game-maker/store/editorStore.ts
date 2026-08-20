/**
 * The editor store (spec §6, §141, §143).
 *
 * React reads from here; the engine bridge writes into here. No PlayCanvas
 * object ever enters this state — only plain IR — so a React render is never
 * on the frame path and undo/redo is a value swap.
 *
 * Implemented with a plain subscribe/snapshot store rather than adding a
 * state library: `useSyncExternalStore` is built in, and the project already
 * has no global store to reuse.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { ContextFrame, GameProjectIR, Vec3 } from "../ir/types";
import { activeScene, createProject, migrateProject, replaceScene } from "../ir/project";
import { applyScenePatch } from "../ir/patch";
import { HistoryStack, type HistoryEntry } from "../history/history";
import type { Editor3DEngine, EditorTool } from "../engine/Editor3DEngine";
import type { RuntimeHost, RuntimeState } from "../runtime/host";
import type { GameEvent, RuntimeMetrics } from "../runtime/protocol";

export interface ConsoleEntry {
  id: string;
  level: "log" | "info" | "warn" | "error";
  source: "editor" | "runtime" | "ai";
  message: string;
  time: number;
}

export interface ActivityStep {
  id: string;
  label: string;
  detail?: string;
  state: "pending" | "active" | "done" | "failed";
}

export interface AgentTaskView {
  id: string;
  request: string;
  state: string;
  effort: "FAST" | "STANDARD" | "DEEP";
  steps: ActivityStep[];
  /** Populated when the run finishes. */
  summary?: string;
  error?: string;
  diff?: { created: number; changed: number; deleted: number };
  startedAt: number;
}

export interface EditorState {
  project: GameProjectIR | null;
  selection: string[];
  hovered: string | null;
  expanded: Record<string, boolean>;
  tool: EditorTool;
  coordSpace: "world" | "local";
  snap: { translate: number; rotate: number; scale: number };
  runtimeState: RuntimeState;
  runtimeMetrics: RuntimeMetrics | null;
  runtimeEvents: GameEvent[];
  viewportStats: { fps: number; drawCalls: number; triangles: number; entities: number };
  console: ConsoleEntry[];
  history: Omit<HistoryEntry, "before" | "after">[];
  historyPosition: number;
  canUndo: boolean;
  canRedo: boolean;
  task: AgentTaskView | null;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  bottomTab: "console" | "tests" | "profiler" | "history";
  rightTab: "inspector" | "ai";
  assetTab: string;
  followAI: boolean;
}

const INITIAL: EditorState = {
  project: null,
  selection: [],
  hovered: null,
  expanded: {},
  tool: "select",
  coordSpace: "world",
  snap: { translate: 0, rotate: 0, scale: 0 },
  runtimeState: "idle",
  runtimeMetrics: null,
  runtimeEvents: [],
  viewportStats: { fps: 0, drawCalls: 0, triangles: 0, entities: 0 },
  console: [],
  history: [],
  historyPosition: -1,
  canUndo: false,
  canRedo: false,
  task: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  bottomTab: "console",
  rightTab: "inspector",
  assetTab: "all",
  followAI: true,
};

let consoleSequence = 0;

export class EditorStore {
  private state: EditorState = INITIAL;
  private listeners = new Set<() => void>();

  readonly history = new HistoryStack();
  engine: Editor3DEngine | null = null;
  runtime: RuntimeHost | null = null;
  contextFrame: ContextFrame | null = null;

  /** Called when the project changes and should be persisted. */
  onPersist: ((project: GameProjectIR) => void) | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<EditorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /* ---------------- project lifecycle ---------------- */

  loadProject(raw: unknown) {
    const project = migrateProject(raw);
    this.history.clear();
    this.set({
      project,
      selection: [],
      hovered: null,
      history: [],
      historyPosition: -1,
      canUndo: false,
      canRedo: false,
      dirty: false,
      task: null,
      runtimeEvents: [],
    });
    this.engine?.loadScene(project, activeScene(project));
    this.log("info", "editor", `Opened "${project.metadata.name}".`);
  }

  newProject(options: Parameters<typeof createProject>[0]) {
    this.loadProject(createProject(options));
    this.markDirty();
  }

  get project() {
    return this.state.project;
  }

  /**
   * The single write path. Every change — manual or AI — funnels through
   * here, which is what keeps history, the viewport and persistence in sync.
   */
  setProject(project: GameProjectIR, options: { label: string; changed?: string[]; created?: string[]; deleted?: string[]; author?: "user" | "ai" | "system" }) {
    const previous = this.state.project;
    this.set({ project });

    const touched = [...new Set([...(options.changed ?? []), ...(options.created ?? []), ...(options.deleted ?? [])])];
    if (this.engine && previous) this.engine.applyChanges(project, activeScene(project), touched);

    if (this.history.inTransaction) {
      if (options.created?.length) this.history.noteChange("created", options.created);
      if (options.deleted?.length) this.history.noteChange("deleted", options.deleted);
      if (options.changed?.length) this.history.noteChange("changed", options.changed);
    } else if (previous) {
      this.history.push({
        author: options.author ?? "user",
        label: options.label,
        before: previous,
        after: project,
        summary: { created: options.created?.length ?? 0, changed: options.changed?.length ?? 0, deleted: options.deleted?.length ?? 0 },
      });
      this.syncHistory();
    }
    this.markDirty();
  }

  /** Convenience for editor-initiated edits that are naturally one patch. */
  applyPatch(operations: Parameters<typeof applyScenePatch>[1] extends never ? never : Record<string, unknown>, label: string, author: "user" | "ai" = "user") {
    const project = this.state.project;
    if (!project) return null;
    const scene = activeScene(project);
    const { scene: next, result } = applyScenePatch(scene, { sceneId: scene.id, ...operations });
    if (!result.applied) return result;
    this.setProject(replaceScene(project, next), { label, changed: result.changedEntities, author });
    return result;
  }

  private syncHistory() {
    this.set({
      history: this.history.list(),
      historyPosition: this.history.position,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
  }

  beginTransaction(label: string, author: "user" | "ai" | "system") {
    const project = this.state.project;
    if (project) this.history.beginTransaction(label, author, project);
  }

  commitTransaction() {
    const project = this.state.project;
    if (!project) return;
    this.history.commitTransaction(project);
    this.syncHistory();
  }

  abortTransaction() {
    const restored = this.history.abortTransaction();
    if (restored) {
      this.set({ project: restored });
      this.engine?.loadScene(restored, activeScene(restored));
      this.syncHistory();
    }
  }

  undo() {
    const result = this.history.undo();
    if (!result) return;
    this.set({ project: result.project, selection: [] });
    this.engine?.loadScene(result.project, activeScene(result.project));
    this.syncHistory();
    this.markDirty();
    this.log("info", "editor", `Undid "${result.entry.label}".`);
  }

  redo() {
    const result = this.history.redo();
    if (!result) return;
    this.set({ project: result.project, selection: [] });
    this.engine?.loadScene(result.project, activeScene(result.project));
    this.syncHistory();
    this.markDirty();
    this.log("info", "editor", `Redid "${result.entry.label}".`);
  }

  /* ---------------- selection + viewport ---------------- */

  select(entityIds: string[], fromEngine = false) {
    this.set({ selection: entityIds });
    if (!fromEngine) this.engine?.select(entityIds);
  }

  setHovered(entityId: string | null) {
    if (this.state.hovered !== entityId) this.set({ hovered: entityId });
  }

  toggleExpanded(entityId: string) {
    this.set({ expanded: { ...this.state.expanded, [entityId]: !this.state.expanded[entityId] } });
  }

  setTool(tool: EditorTool) {
    this.set({ tool });
    this.engine?.setTool(tool);
  }

  setCoordSpace(space: "world" | "local") {
    this.set({ coordSpace: space });
    this.engine?.setCoordSpace(space);
  }

  setSnap(snap: Partial<EditorState["snap"]>) {
    const next = { ...this.state.snap, ...snap };
    this.set({ snap: next });
    this.engine?.setSnap(next);
  }

  setViewportStats(stats: EditorState["viewportStats"]) {
    this.set({ viewportStats: stats });
  }

  /* ---------------- runtime ---------------- */

  setRuntimeState(runtimeState: RuntimeState) {
    this.set({ runtimeState });
  }

  setRuntimeMetrics(runtimeMetrics: RuntimeMetrics) {
    this.set({ runtimeMetrics });
  }

  pushRuntimeEvent(event: GameEvent) {
    const events = [...this.state.runtimeEvents, event].slice(-200);
    this.set({ runtimeEvents: events });
  }

  /* ---------------- console + activity ---------------- */

  log(level: ConsoleEntry["level"], source: ConsoleEntry["source"], message: string) {
    consoleSequence += 1;
    const entry: ConsoleEntry = { id: `log-${consoleSequence}`, level, source, message, time: Date.now() };
    this.set({ console: [...this.state.console, entry].slice(-400) });
  }

  clearConsole() {
    this.set({ console: [] });
  }

  startTask(task: AgentTaskView) {
    this.set({ task });
  }

  updateTask(patch: Partial<AgentTaskView>) {
    if (!this.state.task) return;
    this.set({ task: { ...this.state.task, ...patch } });
  }

  upsertStep(step: ActivityStep) {
    const task = this.state.task;
    if (!task) return;
    const steps = task.steps.some((existing) => existing.id === step.id)
      ? task.steps.map((existing) => (existing.id === step.id ? { ...existing, ...step } : existing))
      : [...task.steps, step];
    this.set({ task: { ...task, steps } });
  }

  endTask(patch: Partial<AgentTaskView>) {
    if (!this.state.task) return;
    this.set({ task: { ...this.state.task, ...patch } });
  }

  /* ---------------- persistence ---------------- */

  markDirty() {
    if (!this.state.dirty) this.set({ dirty: true });
    this.scheduleSave();
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced autosave — never a full upload per keystroke (spec §141). */
  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const project = this.state.project;
      if (!project || !this.onPersist) return;
      this.set({ saving: true });
      try {
        this.onPersist(project);
        this.set({ dirty: false, saving: false, lastSavedAt: Date.now() });
      } catch (error) {
        this.set({ saving: false });
        this.log("error", "editor", `Autosave failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, 1200);
  }

  setUi(patch: Partial<Pick<EditorState, "bottomTab" | "rightTab" | "assetTab" | "followAI">>) {
    this.set(patch);
  }

  /* ---------------- context ---------------- */

  /** Freeze what the user is looking at, at the moment they hit send. */
  captureContext(): ContextFrame | null {
    this.contextFrame = this.engine?.getContextFrame() ?? null;
    return this.contextFrame;
  }

  setMarkers(markers: { id: string; label: string; center: Vec3; size: Vec3 }[]) {
    if (this.engine) this.engine.markers = markers;
  }

  setGhosts(ghosts: { center: Vec3; size: Vec3 }[]) {
    if (this.engine) this.engine.ghosts = ghosts;
  }
}

export const editorStore = new EditorStore();

export function useEditorState<T>(selector: (state: EditorState) => T): T {
  const subscribe = editorStore.subscribe;
  const getSnapshot = useCallback(() => selector(editorStore.getSnapshot()), [selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useEditorStore(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);
}
