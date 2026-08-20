/**
 * The first screen (spec §244).
 *
 * One sentence is enough to start. Templates are there for people who
 * already know what they want, and recent projects for people coming back.
 */
import { useEffect, useState } from "react";
import { ChevronRight, Clock, Gamepad2, Loader2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore } from "../store/editorStore";
import { TEMPLATES, projectFromTemplate, templateForPrompt } from "./templates";
import { listStoredProjects, loadProjectById } from "./persistence";
import type { RuntimeMode } from "../ir/types";

const IDEAS = [
  { label: "Fantasy village", prompt: "A third-person fantasy adventure in a medieval village beside a river", mode: "3d" as const },
  { label: "Block sandbox", prompt: "A Minecraft-like survival sandbox with caves, ores and day/night", mode: "voxel" as const },
  { label: "Pixel platformer", prompt: "A 2D pixel platformer with three levels, coins and enemies", mode: "2d" as const },
  { label: "Ruined castle", prompt: "A third-person game exploring an abandoned mountain kingdom with a ruined fortress", mode: "3d" as const },
];

/**
 * A world is a pure function of its seed (spec §191). `?gmSeed=` pins it, so
 * a world can be reproduced exactly — for sharing a layout you liked, for
 * reporting a bug against the world that caused it, and for tests that need
 * the same village every run.
 */
function requestedSeed(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("gmSeed");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function WelcomeScreen() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"auto" | RuntimeMode>("auto");
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<{ id: string; name: string; updatedAt: number; mode: string }[]>([]);

  useEffect(() => {
    void listStoredProjects().then((projects) => setRecent(projects.slice(0, 6)));
  }, []);

  const create = (templateId?: string) => {
    const text = prompt.trim() || "A third-person adventure";
    setBusy(true);
    // Deliberately synchronous and local: the first playable slice is built
    // by deterministic generators, not by waiting on a model (spec §180).
    setTimeout(() => {
      try {
        const template = templateId
          ? TEMPLATES.find((entry) => entry.id === templateId)!
          : templateForPrompt(text, mode === "auto" ? undefined : mode);
        const project = projectFromTemplate(template, { name: titleFrom(text), concept: text, seed: requestedSeed() });
        editorStore.loadProject(project);
        editorStore.markDirty();
        editorStore.log("info", "editor", `Started from the "${template.name}" template. Ask Clyra to shape it into your game.`);
      } catch (error) {
        editorStore.log("error", "editor", error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    }, 16);
  };

  return (
    <div className="gm-welcome">
      <div className="gm-welcome__identity">
        <span><Gamepad2 size={16} /></span>
        Clyra Game Maker
      </div>

      <div className="gm-welcome__hero">
        <h1>Describe a game.</h1>
        <p>Clyra builds it in the browser, then plays it to check its own work.</p>
      </div>

      <div className="gm-welcome__composer">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              create();
            }
          }}
          placeholder="Make me a third-person fantasy adventure with a village, a castle, sword combat and a dungeon boss…"
          rows={3}
          autoFocus
        />
        <div className="gm-welcome__actions">
          <div className="gm-welcome__modes" aria-label="Game dimensions">
            {(["auto", "3d", "2d", "voxel"] as const).map((option) => (
              <button key={option} type="button" className={cn(mode === option && "is-active")} onClick={() => setMode(option)}>
                {option === "auto" ? "Auto" : option.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="gm-button gm-button--primary" onClick={() => create()} disabled={busy}>
            {busy ? <Loader2 size={13} className="gm-spin" /> : null}
            Create <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="gm-welcome__ideas">
        <span>Try</span>
        {IDEAS.map((idea) => (
          <button
            key={idea.label}
            type="button"
            onClick={() => {
              setPrompt(idea.prompt);
              setMode(idea.mode);
            }}
          >
            {idea.label}
          </button>
        ))}
      </div>

      <section className="gm-welcome__templates">
        <h2>Or start from a template</h2>
        <div>
          {TEMPLATES.map((template) => (
            <button key={template.id} type="button" onClick={() => create(template.id)} disabled={busy}>
              <span className={cn("gm-template__badge", `is-${template.mode}`)}>{template.mode.toUpperCase()}</span>
              <strong>{template.name}</strong>
              <small>{template.description}</small>
            </button>
          ))}
        </div>
      </section>

      {recent.length ? (
        <section className="gm-welcome__recent">
          <h2><Clock size={12} /> Recent</h2>
          <div>
            {recent.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  const loaded = await loadProjectById(project.id);
                  setBusy(false);
                  if (loaded) editorStore.loadProject(loaded);
                  else editorStore.log("error", "editor", `"${project.name}" could not be opened.`);
                }}
              >
                <strong>{project.name}</strong>
                <small>{project.mode.toUpperCase()} · {new Date(project.updatedAt).toLocaleDateString()}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function titleFrom(prompt: string): string {
  const cleaned = prompt.replace(/^(make|create|build|generate)\s+(me\s+)?(a|an|the)\s+/i, "").trim();
  const words = cleaned.split(/\s+/).slice(0, 4).join(" ");
  return (words || "New game").replace(/^\w/, (character) => character.toUpperCase()).slice(0, 48);
}
