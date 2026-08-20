/**
 * The viewport: the persistent editor canvas plus the sandboxed play frame.
 *
 * Both live here permanently; Play swaps which one is visible rather than
 * destroying the editor engine, so returning from Play is instant and the
 * camera is exactly where it was.
 */
import { useEffect, useRef } from "react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { Editor3DEngine } from "../engine/Editor3DEngine";
import { ensureRuntimeHost } from "../runtime/createHost";
import { activeScene } from "../ir/project";

export function Viewport({ onEngineReady }: { onEngineReady?: (engine: Editor3DEngine) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeMountRef = useRef<HTMLDivElement>(null);
  const runtimeState = useEditorState((state) => state.runtimeState);
  const viewportStats = useEditorState((state) => state.viewportStats);
  const tool = useEditorState((state) => state.tool);
  const playing = runtimeState === "playing" || runtimeState === "paused" || runtimeState === "loading";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Editor3DEngine({
      onSelectionChange: (ids) => editorStore.select(ids, true),
      onHover: (id) => editorStore.setHovered(id),
      onStats: (stats) => editorStore.setViewportStats(stats),
      onTransformCommit: (changes) => {
        const project = editorStore.project;
        if (!project) return;
        editorStore.applyPatch(
          { operations: changes.map((change) => ({ op: "transform", entityId: change.entityId, position: change.position, rotation: change.rotation, scale: change.scale })) },
          changes.length === 1 ? "Move object" : `Move ${changes.length} objects`,
        );
      },
    });
    engine.initialize(canvas);
    editorStore.engine = engine;
    const project = editorStore.project;
    if (project) engine.loadScene(project, activeScene(project));
    onEngineReady?.(engine);

    return () => {
      engine.dispose();
      if (editorStore.engine === engine) editorStore.engine = null;
    };
  }, [onEngineReady]);

  // The runtime frame is created lazily on first Play and then reused. Which
  // document it loads depends on the project's engine, so a project that
  // switches between 2D and 3D transparently gets a fresh frame.
  useEffect(() => {
    if (!playing || !runtimeMountRef.current) return;
    void ensureRuntimeHost().catch((error) => {
      editorStore.log("error", "runtime", error instanceof Error ? error.message : String(error));
    });
  }, [playing]);

  return (
    <div className="gm-viewport">
      <canvas ref={canvasRef} className={cn("gm-viewport__canvas", playing && "is-hidden")} data-tool={tool} />
      <div ref={runtimeMountRef} className={cn("gm-viewport__runtime", !playing && "is-hidden")} />

      {!playing ? (
        <div className="gm-viewport__hud">
          <span>{viewportStats.fps} fps</span>
          <span>{viewportStats.drawCalls} draws</span>
          <span>{viewportStats.entities} objects</span>
        </div>
      ) : null}
    </div>
  );
}
