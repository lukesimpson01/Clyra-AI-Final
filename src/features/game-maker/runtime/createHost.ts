/**
 * One place that builds a RuntimeHost wired to the editor store.
 *
 * Both the viewport (when the user presses Play) and the AI tool executor
 * (when an agent calls runtime.start) need a host, and they must produce an
 * identically-wired one — otherwise a load warning or a runtime error is
 * reported down one path and silently swallowed down the other.
 */
import { RuntimeHost } from "./host";
import { editorStore } from "../store/editorStore";

export function createRuntimeHost(): RuntimeHost {
  return new RuntimeHost({
    onState: (state) => editorStore.setRuntimeState(state),
    onLog: (entry) => editorStore.log(entry.level, "runtime", entry.message),
    onError: (message) => editorStore.log("error", "runtime", message),
    onEvent: (event) => editorStore.pushRuntimeEvent(event),
    onMetrics: (metrics) => editorStore.setRuntimeMetrics(metrics),
    onLoaded: (info) => {
      for (const warning of info.warnings) editorStore.log("warn", "runtime", warning);
      editorStore.log("info", "runtime", `Loaded scene "${info.sceneId}" with ${info.entityCount} entities.`);
    },
  });
}

/**
 * Return the live host, creating and mounting one if needed. Handles the
 * case where the project switched engine since the last Play: the sandboxed
 * document is engine-specific, so an incompatible host is replaced.
 */
export async function ensureRuntimeHost(): Promise<RuntimeHost> {
  const mode = editorStore.project?.runtime.mode ?? "3d";
  const existing = editorStore.runtime;
  if (existing) {
    const compatible = existing.mode === mode || (mode === "voxel" && existing.mode === "3d");
    if (compatible) return existing;
    existing.dispose();
    editorStore.runtime = null;
  }

  const mount = document.querySelector<HTMLElement>(".gm-viewport__runtime");
  if (!mount) throw new Error("The play surface is not mounted yet. Open a project and try again.");

  const host = createRuntimeHost();
  editorStore.runtime = host;
  await host.mount(mount, mode);
  return host;
}
