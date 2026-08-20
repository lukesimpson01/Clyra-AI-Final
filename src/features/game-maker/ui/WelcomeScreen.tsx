/**
 * The first screen (spec §244).
 *
 * One sentence is enough to start. Templates are there for people who
 * already know what they want, and recent projects for people coming back.
 */
import { useEffect, useState } from "react";
import { ArrowUp, Boxes, ChevronRight, Clock, Gamepad2, Loader2, PlayCircle, ShieldCheck } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore } from "../store/editorStore";
import { TEMPLATES, projectFromTemplate } from "./templates";
import { listStoredProjects, loadProjectById } from "./persistence";
import type { RuntimeMode } from "../ir/types";
import { createProject } from "../ir/project";

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
    try {
      if (templateId) {
        const template = TEMPLATES.find((entry) => entry.id === templateId)!;
        const project = projectFromTemplate(template, { name: titleFrom(text), concept: text, seed: requestedSeed() });
        editorStore.loadProject(project);
        editorStore.markDirty();
        editorStore.log("info", "editor", `Started from the explicit "${template.name}" template.`);
      } else {
        const runtimeMode = resolveMode(text, mode);
        const baseProject = createProject({
          name: titleFrom(text),
          concept: text,
          mode: runtimeMode,
          genre: "unplanned",
          camera: runtimeMode === "2d" ? "side-scrolling" : runtimeMode === "voxel" ? "first-person" : "third-person",
          coreLoop: "pending AI plan",
        });
        const project = {
          ...baseProject,
          memory: {
            entries: [{
              id: `pending-generation-${Date.now()}`,
              kind: "runbook" as const,
              text,
              tags: ["pending-generation", runtimeMode],
              createdAt: Date.now(),
            }],
          },
        };
        editorStore.loadProject(project);
        editorStore.markDirty();
        editorStore.log("info", "editor", "Created a fresh empty project. Clyra will now plan and build it through the real agent workflow.");
      }
    } catch (error) {
      editorStore.log("error", "editor", error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-welcome">
      <header className="gm-welcome__top">
        <div className="gm-welcome__identity">
          <span><Gamepad2 size={16} /></span>
          <div><strong>Clyra</strong><small>Game Maker</small></div>
        </div>
        <div className="gm-welcome__availability"><i /> Local engines ready</div>
      </header>

      <main className="gm-welcome__main">
        <div className="gm-welcome__hero">
          <div className="gm-welcome__eyebrow">From an idea to a playable world</div>
          <h1>Make the game<br />you want to play.</h1>
          <p>Describe the experience. Clyra plans the build, creates editable scene data, launches the real runtime, and tests what it made.</p>
        </div>

        <div className="gm-welcome__composer">
          <div className="gm-welcome__composer-label"><span>New game</span><small>Enter to create · Shift Enter for a new line</small></div>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                create();
              }
            }}
            placeholder="A third-person fantasy adventure with a village, sword combat, and a ruined tower…"
            rows={4}
            autoFocus
          />
          <div className="gm-welcome__actions">
            <div className="gm-welcome__modes" aria-label="Game dimensions">
              {(["auto", "3d", "2d", "voxel"] as const).map((option) => (
                <button key={option} type="button" className={cn(mode === option && "is-active")} onClick={() => setMode(option)} aria-pressed={mode === option}>
                  {option === "auto" ? "Auto" : option.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="button" className="gm-button gm-button--primary gm-welcome__create" onClick={() => create()} disabled={busy}>
              {busy ? <Loader2 size={14} className="gm-spin" /> : <ArrowUp size={14} />}
              {busy ? "Starting…" : "Create game"}
            </button>
          </div>
        </div>

        <div className="gm-welcome__proof" aria-label="Game Maker capabilities">
          <div><Boxes size={16} /><span><strong>Editable by design</strong><small>Entities, systems, and assets stay yours.</small></span></div>
          <div><PlayCircle size={16} /><span><strong>Real browser runtime</strong><small>2D, 3D, and voxel projects run locally.</small></span></div>
          <div><ShieldCheck size={16} /><span><strong>Verified before complete</strong><small>Playtests and validation gate AI claims.</small></span></div>
        </div>
      </main>

      <div className="gm-welcome__ideas">
        <span>Start with an idea</span>
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
        <h2><span>Starting points</span><small>Templates are explicit foundations, never hidden behind your prompt.</small></h2>
        <div>
          {TEMPLATES.map((template) => (
            <button key={template.id} type="button" onClick={() => create(template.id)} disabled={busy}>
              <span className={cn("gm-template__badge", `is-${template.mode}`)}>{template.mode.toUpperCase()}</span>
              <strong>{template.name}</strong>
              <small>{template.description}</small>
              <ChevronRight className="gm-template__arrow" size={14} />
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
  const qaName = prompt.match(/\bQA_(?:2D|3D)_[A-Za-z0-9_-]+\b/i)?.[0];
  if (qaName) return qaName.slice(0, 48);
  const cleaned = prompt.replace(/^(make|create|build|generate)\s+(me\s+)?(a|an|the)\s+/i, "").trim();
  const words = cleaned.split(/\s+/).slice(0, 4).join(" ");
  return (words || "New game").replace(/^\w/, (character) => character.toUpperCase()).slice(0, 48);
}

function resolveMode(prompt: string, requested: "auto" | RuntimeMode): RuntimeMode {
  if (requested !== "auto") return requested;
  if (/\b(2d|platformer|side.?scroll|top.?down|pixel)\b/i.test(prompt)) return "2d";
  if (/\b(voxel|block world|minecraft)\b/i.test(prompt)) return "voxel";
  return "3d";
}
