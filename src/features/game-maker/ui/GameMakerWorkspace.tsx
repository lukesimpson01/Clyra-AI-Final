/**
 * Clyra Game Maker — the workspace shell.
 *
 * Layout follows spec §42: scene tree, viewport, inspector, an asset strip,
 * a lower dock (console/tests/profiler/history) and the AI creator panel.
 * It holds the wiring — engine, runtime, AI client, persistence, shortcuts —
 * and nothing else; every panel is its own component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Cuboid,
  Gamepad2,
  Grid3X3,
  Loader2,
  Move3D,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Rotate3D,
  Scaling,
  Square,
  Undo2,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { activeScene } from "../ir/project";
import { Viewport } from "./Viewport";
import { Hierarchy } from "./Hierarchy";
import { Inspector } from "./Inspector";
import { AssetBrowser } from "./AssetBrowser";
import { BottomDock } from "./BottomDock";
import { AIPanel } from "./AIPanel";
import { WelcomeScreen } from "./WelcomeScreen";
import { AgentClient } from "../ai/client";
import type { ToolContext } from "../ai/executor";
import { ensureRuntimeHost } from "../runtime/createHost";
import { loadStoredProject, storeProject } from "./persistence";
import type { EditorTool } from "../engine/Editor3DEngine";

const TOOL_BUTTONS: { id: EditorTool; icon: typeof MousePointer2; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "Q" },
  { id: "move", icon: Move3D, label: "Move", key: "W" },
  { id: "rotate", icon: Rotate3D, label: "Rotate", key: "E" },
  { id: "scale", icon: Scaling, label: "Scale", key: "R" },
];

export default function GameMakerWorkspace() {
  const state = useEditorState((snapshot) => snapshot);
  const [booting, setBooting] = useState(true);
  const clientRef = useRef<AgentClient | null>(null);

  /* ---- the tool context every tool call runs against ---- */
  const toolContext = useMemo<ToolContext>(
    () => ({
      getProject: () => {
        const project = editorStore.project;
        if (!project) throw new Error("No project is open.");
        return project;
      },
      setProject: (project, options) => editorStore.setProject(project, { ...options, author: "ai" }),
      getContextFrame: () => editorStore.contextFrame,
      history: editorStore.history,
      runtime: () => editorStore.runtime,
      ensureRuntime: ensureRuntimeHost,
      onSelect: (entityIds) => {
        editorStore.select(entityIds);
        if (editorStore.getSnapshot().followAI) editorStore.engine?.frameSelection();
      },
      onActivity: (message) => editorStore.log("info", "ai", message),
    }),
    [],
  );

  /* ---- restore the last project (spec §144) ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadStoredProject();
        if (!cancelled && stored) editorStore.loadProject(stored);
      } catch (error) {
        editorStore.log("warn", "editor", `Could not restore the last project: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    editorStore.onPersist = (project) => void storeProject(project);
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- the AI client, wired to the activity feed ---- */
  useEffect(() => {
    const client = new AgentClient(toolContext, {
      onAccepted: (effort) => {
        editorStore.beginTransaction(editorStore.getSnapshot().task?.request ?? "Clyra change", "ai");
        editorStore.updateTask({ effort, state: "RUNNING" });
      },
      onState: (agentState, detail) => editorStore.updateTask({ state: agentState, ...(detail ? {} : {}) }),
      onPlan: (plan) => {
        for (const step of plan.steps) {
          editorStore.upsertStep({ id: `plan-${step.id}`, label: step.intent || step.tool, state: "pending" });
        }
      },
      onToolStart: (requestId, tool, intent) => editorStore.upsertStep({ id: requestId, label: describeTool(tool), detail: intent, state: "active" }),
      onToolEnd: (requestId, tool, ok, detail) => editorStore.upsertStep({ id: requestId, label: describeTool(tool), detail, state: ok ? "done" : "failed" }),
      onComplete: (result) => {
        editorStore.commitTransaction();
        const entry = editorStore.getSnapshot().history[editorStore.getSnapshot().historyPosition];
        editorStore.endTask({
          summary: result.verified ? result.summary : `${result.summary}\n\nNote: the final validation did not come back clean — check the Console and Tests tabs.`,
          diff: entry?.summary,
        });
      },
      onFailed: (error) => {
        editorStore.commitTransaction();
        editorStore.endTask({ error });
      },
      onCancelled: () => {
        editorStore.commitTransaction();
        editorStore.endTask({ error: "Stopped. The work completed so far is kept — undo it in one step if you want it gone." });
      },
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [toolContext]);

  /* ---- the AI panel starts the task; mirror it into the store ---- */
  const startTask = useCallback((request: string) => {
    editorStore.startTask({ id: `t-${Date.now()}`, request, state: "RECEIVING", effort: "STANDARD", steps: [], startedAt: Date.now() });
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    const original = client.start.bind(client);
    client.start = async (request, effort) => {
      startTask(request);
      return original(request, effort);
    };
  }, [startTask]);

  /* ---- keyboard shortcuts (never while typing) ---- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editorStore.redo();
        else editorStore.undo();
        return;
      }
      if (meta) return;

      switch (event.key.toLowerCase()) {
        case "q": editorStore.setTool("select"); break;
        case "w": editorStore.setTool("move"); break;
        case "e": editorStore.setTool("rotate"); break;
        case "r": editorStore.setTool("scale"); break;
        case "f": editorStore.engine?.frameSelection(); break;
        case "delete":
        case "backspace": {
          const selection = editorStore.getSnapshot().selection;
          if (selection.length) {
            editorStore.applyPatch({ operations: selection.map((entityId) => ({ op: "delete", entityId })) }, `Delete ${selection.length} object${selection.length === 1 ? "" : "s"}`);
            editorStore.select([]);
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- play controls ---- */
  const play = async () => {
    const project = editorStore.project;
    if (!project) return;
    try {
      const host = await toolContext.ensureRuntime();
      await host.load(project);
      host.play();
    } catch (error) {
      editorStore.log("error", "editor", error instanceof Error ? error.message : String(error));
    }
  };

  if (booting) {
    return (
      <div className="gm-boot">
        <Loader2 className="gm-spin" size={18} />
        <p>Opening Game Maker…</p>
      </div>
    );
  }

  if (!state.project) return <WelcomeScreen />;

  const scene = activeScene(state.project);
  const playing = state.runtimeState === "playing";
  const paused = state.runtimeState === "paused";
  const inPlayMode = playing || paused || state.runtimeState === "loading";

  return (
    <div className="gm-shell">
      <header className="gm-topbar">
        <button type="button" className="gm-project" onClick={() => editorStore.loadProject(null as never)} title="Close this project">
          <span><Gamepad2 size={14} /></span>
          <div>
            <strong>{state.project.metadata.name}</strong>
            <small>{scene.name} · rev {scene.revision}</small>
          </div>
          <ChevronDown size={12} />
        </button>

        <div className="gm-toolstrip">
          {TOOL_BUTTONS.map((button) => (
            <button
              key={button.id}
              type="button"
              className={cn(state.tool === button.id && "is-active")}
              title={`${button.label} (${button.key})`}
              onClick={() => editorStore.setTool(button.id)}
            >
              <button.icon size={13} />
            </button>
          ))}
          <span className="gm-divider" />
          <button
            type="button"
            className={cn(state.coordSpace === "local" && "is-active")}
            title="World / local space"
            onClick={() => editorStore.setCoordSpace(state.coordSpace === "world" ? "local" : "world")}
          >
            <Cuboid size={13} />
          </button>
          <button
            type="button"
            className={cn(state.snap.translate > 0 && "is-active")}
            title="Grid snapping"
            onClick={() => editorStore.setSnap({ translate: state.snap.translate > 0 ? 0 : 1, rotate: state.snap.rotate > 0 ? 0 : 15, scale: state.snap.scale > 0 ? 0 : 0.25 })}
          >
            <Grid3X3 size={13} />
          </button>
        </div>

        <div className="gm-history-controls">
          <button type="button" disabled={!state.canUndo} onClick={() => editorStore.undo()} title="Undo (⌘Z)"><Undo2 size={13} /></button>
          <button type="button" disabled={!state.canRedo} onClick={() => editorStore.redo()} title="Redo (⇧⌘Z)"><Redo2 size={13} /></button>
        </div>

        <div className="gm-runtime-controls">
          {inPlayMode ? (
            <>
              <button type="button" onClick={() => (playing ? editorStore.runtime?.pause() : editorStore.runtime?.play())} title={playing ? "Pause" : "Resume"}>
                {playing ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  editorStore.runtime?.stop();
                  editorStore.setRuntimeState("idle");
                }}
                title="Back to the editor"
              >
                <Square size={12} /> Stop
              </button>
            </>
          ) : (
            <button type="button" className="is-play" onClick={play} title="Play in the browser">
              <Play size={12} /> Play
            </button>
          )}
        </div>

        <div className="gm-status">
          {state.saving ? <span><Loader2 size={10} className="gm-spin" /> Saving</span> : state.dirty ? <span>Unsaved</span> : state.lastSavedAt ? <span>Saved</span> : null}
        </div>
      </header>

      <Hierarchy />

      <div className="gm-stage">
        <Viewport />
        <AssetBrowser />
      </div>

      <div className="gm-right">
        <nav className="gm-right__tabs">
          <button type="button" className={cn(state.rightTab === "inspector" && "is-active")} onClick={() => editorStore.setUi({ rightTab: "inspector" })}>
            Inspector
          </button>
          <button type="button" className={cn(state.rightTab === "ai" && "is-active")} onClick={() => editorStore.setUi({ rightTab: "ai" })}>
            Clyra
          </button>
          <button
            type="button"
            className={cn("gm-right__follow", state.followAI && "is-active")}
            title="Follow Clyra's work with the camera"
            onClick={() => editorStore.setUi({ followAI: !state.followAI })}
          >
            <RotateCcw size={11} />
          </button>
        </nav>
        {state.rightTab === "inspector" ? <Inspector toolContext={toolContext} /> : <AIPanel client={clientRef.current} />}
      </div>

      <BottomDock toolContext={toolContext} />
    </div>
  );
}

function describeTool(tool: string): string {
  const map: Record<string, string> = {
    "editor.getContext": "Reading what you're looking at",
    "scene.query": "Searching the scene",
    "scene.applyPatch": "Editing the scene",
    "scene.place": "Working out where that is",
    "scene.generate": "Generating content",
    "scene.regenerate": "Rebuilding that object",
    "terrain.modify": "Shaping the terrain",
    "asset.search": "Looking through assets",
    "material.generate": "Making a material",
    "character.generate": "Creating characters",
    "gameplay.configure": "Wiring gameplay",
    "quest.configure": "Writing a quest",
    "ui.generate": "Building the UI",
    "code.edit": "Writing a script",
    "navigation.build": "Building navigation",
    "runtime.start": "Starting the game",
    "runtime.query": "Reading the running game",
    "runtime.input": "Driving the player",
    "test.run": "Playtesting",
    "performance.profile": "Measuring performance",
    "project.validate": "Checking the project",
    "history.checkpoint": "Saving a restore point",
    "tool.discover": "Finding the right tool",
  };
  return map[tool] ?? tool;
}
