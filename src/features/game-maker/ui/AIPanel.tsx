/**
 * The AI creator panel (spec §175–§178).
 *
 * Shows contextual chips for what the request will be grounded against,
 * streams the agent's *actions* (never its reasoning), and reports a diff
 * and a verified/unverified verdict when it finishes.
 */
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, CircleDot, Loader2, Pause, Play, Sparkles, Square, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { activeScene } from "../ir/project";
import type { AgentClient } from "../ai/client";

const SUGGESTIONS = [
  "Put a ruined watchtower here",
  "Make this twice as tall",
  "Add three guards around this and test that they patrol",
  "Build a village beside the river with an inn and a blacksmith",
  "Create a door that opens when I press E, then verify it",
];

export function AIPanel({ client }: { client: AgentClient | null }) {
  const task = useEditorState((state) => state.task);
  const project = useEditorState((state) => state.project);
  const selection = useEditorState((state) => state.selection);
  const [prompt, setPrompt] = useState("");
  const [paused, setPaused] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [task?.steps.length, task?.summary]);

  if (!project) return null;
  const scene = activeScene(project);
  const running = Boolean(task && !task.summary && !task.error);
  const selectedName = selection.length === 1 ? scene.entities[selection[0]!]?.name : selection.length ? `${selection.length} objects` : null;

  const submit = () => {
    const text = prompt.trim();
    if (!text || !client || running) return;
    setPrompt("");
    // Freeze the context at the moment of send — this is what "here" means.
    editorStore.captureContext();
    void client.start(text).catch((error) => {
      editorStore.endTask({ error: error instanceof Error ? error.message : String(error) });
    });
  };

  return (
    <section className="gm-panel gm-ai">
      <header className="gm-panel__header">
        <span>
          <Sparkles size={12} /> Clyra
        </span>
        {running ? (
          <div className="gm-ai__controls">
            <button
              type="button"
              title={paused ? "Resume" : "Pause"}
              onClick={() => {
                if (paused) client?.resume();
                else client?.pause();
                setPaused(!paused);
              }}
            >
              {paused ? <Play size={11} /> : <Pause size={11} />}
            </button>
            <button type="button" title="Stop" onClick={() => client?.cancel()}>
              <Square size={11} />
            </button>
          </div>
        ) : null}
      </header>

      <div className="gm-ai__stream" ref={streamRef}>
        {task ? (
          <>
            <p className="gm-ai__request">{task.request}</p>
            {task.steps.length ? (
              <ul className="gm-ai__steps">
                {task.steps.map((step) => (
                  <li key={step.id} className={cn(`is-${step.state}`)}>
                    <span className="gm-ai__bullet">
                      {step.state === "done" ? <Check size={11} /> : step.state === "failed" ? <X size={11} /> : step.state === "active" ? <Loader2 size={11} className="gm-spin" /> : <CircleDot size={9} />}
                    </span>
                    <span>
                      {step.label}
                      {step.detail ? <small>{step.detail}</small> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {task.diff && (task.diff.created || task.diff.changed || task.diff.deleted) ? (
              <div className="gm-ai__diff">
                {task.diff.created ? <span className="is-add">+{task.diff.created} created</span> : null}
                {task.diff.changed ? <span className="is-change">~{task.diff.changed} changed</span> : null}
                {task.diff.deleted ? <span className="is-remove">−{task.diff.deleted} removed</span> : null}
              </div>
            ) : null}

            {task.summary ? (
              <div className="gm-ai__summary">
                <p>{task.summary}</p>
                <button type="button" className="gm-ai__undo" onClick={() => editorStore.undo()}>
                  Undo this whole change
                </button>
              </div>
            ) : null}
            {task.error ? <p className="gm-ai__error">{task.error}</p> : null}
          </>
        ) : (
          <div className="gm-ai__intro">
            <p>Describe what you want. Clyra edits the real project, then verifies it by playing the game.</p>
            <ul>
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" onClick={() => setPrompt(suggestion)}>
                    {suggestion} <ChevronRight size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="gm-ai__composer">
        <div className="gm-ai__chips">
          <span>Scene: {scene.name}</span>
          <span>Mode: {project.runtime.mode.toUpperCase()}</span>
          {selectedName ? <span className="is-selection">Selected: {selectedName}</span> : null}
        </div>
        <div className="gm-ai__input">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Ask anything about your game…"
            rows={2}
            disabled={running}
            aria-label="Ask Clyra about your game"
          />
          <button type="button" className="gm-button gm-button--primary" onClick={running ? () => client?.cancel() : submit} disabled={!running && !prompt.trim()}>
            {running ? <Square size={12} /> : <ChevronRight size={13} />}
          </button>
        </div>
      </div>
    </section>
  );
}
