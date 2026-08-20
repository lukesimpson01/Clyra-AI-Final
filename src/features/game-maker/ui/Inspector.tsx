/**
 * The inspector. Only relevant sections are shown (spec §49), every field is
 * validated against the component's schema before it is written, and an
 * object made by a generator gets its parameters as live controls rather
 * than as read-only metadata.
 */
import { useMemo, useState } from "react";
import { RefreshCw, Trash2, Wand2 } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { activeScene } from "../ir/project";
import { getComponent, listComponents, validateComponent } from "../gameplay/components";
import { getGenerator } from "../procedural/registry";
import { executeTool } from "../ai/executor";
import type { ToolContext } from "../ai/executor";
import type { Vec3 } from "../ir/types";

function NumberField({ label, value, onCommit, step = 0.1 }: { label: string; value: number; onCommit: (value: number) => void; step?: number }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(4))));
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : String(Number(value.toFixed(4)));
  return (
    <label className="gm-field gm-field--number">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={shown}
        onFocus={() => {
          setFocused(true);
          setDraft(String(Number(value.toFixed(4))));
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = Number(draft);
          if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function VectorField({ label, value, onCommit }: { label: string; value: Vec3; onCommit: (value: Vec3) => void }) {
  return (
    <div className="gm-vector">
      <span className="gm-vector__label">{label}</span>
      <div>
        {(["X", "Y", "Z"] as const).map((axis, index) => (
          <NumberField
            key={axis}
            label={axis}
            value={value[index]!}
            onCommit={(next) => {
              const updated = [...value] as Vec3;
              updated[index] = next;
              onCommit(updated);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function Inspector({ toolContext }: { toolContext: ToolContext }) {
  const project = useEditorState((state) => state.project);
  const selection = useEditorState((state) => state.selection);
  const [adding, setAdding] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const scene = project ? activeScene(project) : null;
  const entity = scene && selection.length === 1 ? scene.entities[selection[0]!] : null;

  const componentOptions = useMemo(
    () => listComponents().filter((component) => !entity?.components.some((existing) => existing.type === component.type)),
    [entity],
  );

  if (!scene) return null;

  if (!entity) {
    return (
      <section className="gm-panel gm-inspector">
        <header className="gm-panel__header"><span>Inspector</span></header>
        <div className="gm-panel__body">
          <p className="gm-empty">
            {selection.length > 1 ? `${selection.length} objects selected. Select one to edit its properties.` : "Select an object in the viewport or the scene tree."}
          </p>
        </div>
      </section>
    );
  }

  const patch = (operations: Parameters<typeof editorStore.applyPatch>[0], label: string) => editorStore.applyPatch(operations, label);
  const generator = entity.generator ? getGenerator(entity.generator.generator) : null;

  return (
    <section className="gm-panel gm-inspector">
      <header className="gm-panel__header">
        <span>Inspector</span>
        <small>{entity.type}</small>
      </header>
      <div className="gm-panel__body">
        <div className="gm-section">
          <label className="gm-field">
            <span>Name</span>
            <input
              value={entity.name}
              onChange={(event) => patch({ operations: [{ op: "rename", entityId: entity.id, name: event.target.value || "Object" }] }, "Rename object")}
            />
          </label>
          <label className="gm-field">
            <span>Tags</span>
            <input
              value={entity.tags.join(", ")}
              onChange={(event) =>
                patch(
                  { operations: [{ op: "setTags", entityId: entity.id, tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 32) }] },
                  "Edit tags",
                )
              }
              placeholder="none"
            />
          </label>
          <p className="gm-hint">id {entity.id}</p>
        </div>

        <div className="gm-section">
          <h4>Transform</h4>
          <VectorField label="Position" value={entity.transform.position} onCommit={(position) => patch({ operations: [{ op: "transform", entityId: entity.id, position }] }, "Move object")} />
          <VectorField label="Scale" value={entity.transform.scale} onCommit={(scale) => patch({ operations: [{ op: "transform", entityId: entity.id, scale }] }, "Scale object")} />
        </div>

        {generator && entity.generator ? (
          <div className="gm-section gm-section--generator">
            <h4>
              <Wand2 size={11} /> {entity.generator.generator}
            </h4>
            <p className="gm-hint">Seed {entity.generator.seed}. Changing a value rebuilds this object and keeps its place in the world.</p>
            {Object.entries(entity.generator.parameters)
              .filter(([, value]) => typeof value === "number" || typeof value === "boolean")
              .slice(0, 10)
              .map(([key, value]) =>
                typeof value === "number" ? (
                  <NumberField
                    key={key}
                    label={key}
                    value={value}
                    onCommit={async (next) => {
                      setRegenerating(true);
                      const result = await executeTool(toolContext, "scene.regenerate", { entityId: entity.id, parameters: { [key]: next } });
                      setRegenerating(false);
                      if (!result.ok) editorStore.log("error", "editor", result.error?.message ?? "Regeneration failed.");
                    }}
                  />
                ) : (
                  <label key={key} className="gm-field gm-field--check">
                    <input
                      type="checkbox"
                      checked={value === true}
                      onChange={async (event) => {
                        setRegenerating(true);
                        const result = await executeTool(toolContext, "scene.regenerate", { entityId: entity.id, parameters: { [key]: event.target.checked } });
                        setRegenerating(false);
                        if (!result.ok) editorStore.log("error", "editor", result.error?.message ?? "Regeneration failed.");
                      }}
                    />
                    <span>{key}</span>
                  </label>
                ),
              )}
            <button
              type="button"
              className="gm-button gm-button--ghost"
              disabled={regenerating}
              onClick={async () => {
                setRegenerating(true);
                await executeTool(toolContext, "scene.regenerate", { entityId: entity.id, seed: Math.floor(Math.random() * 2 ** 28) });
                setRegenerating(false);
              }}
            >
              <RefreshCw size={11} className={cn(regenerating && "gm-spin")} /> New variation
            </button>
          </div>
        ) : null}

        {entity.components.map((component) => {
          const definition = getComponent(component.type);
          return (
            <div key={component.type} className="gm-section">
              <h4>
                {component.type}
                <button
                  type="button"
                  className="gm-section__remove"
                  title={`Remove ${component.type}`}
                  onClick={() => patch({ operations: [{ op: "removeComponent", entityId: entity.id, component: component.type }] }, `Remove ${component.type}`)}
                >
                  <Trash2 size={10} />
                </button>
              </h4>
              {definition ? <p className="gm-hint">{definition.summary}</p> : <p className="gm-hint gm-hint--warn">Unknown component — the runtime will ignore it.</p>}
              {Object.entries(component.data)
                .filter(([key]) => key !== "spec" && key !== "params" && key !== "tiles" && key !== "points")
                .slice(0, 12)
                .map(([key, value]) => {
                  const commit = (next: unknown) => {
                    const merged = { ...component.data, [key]: next };
                    const validation = validateComponent(component.type, merged, entity.components.map((existing) => existing.type));
                    if (!validation.ok) {
                      editorStore.log("warn", "editor", `${component.type}.${key}: ${validation.issues[0] ?? "invalid value"}`);
                      return;
                    }
                    patch({ operations: [{ op: "setComponent", entityId: entity.id, component: component.type, data: validation.data! }] }, `Edit ${component.type}`);
                  };
                  if (typeof value === "number") return <NumberField key={key} label={key} value={value} onCommit={commit} />;
                  if (typeof value === "boolean") {
                    return (
                      <label key={key} className="gm-field gm-field--check">
                        <input type="checkbox" checked={value} onChange={(event) => commit(event.target.checked)} />
                        <span>{key}</span>
                      </label>
                    );
                  }
                  if (typeof value === "string") {
                    return (
                      <label key={key} className="gm-field">
                        <span>{key}</span>
                        <input value={value} onChange={(event) => commit(event.target.value)} />
                      </label>
                    );
                  }
                  return (
                    <p key={key} className="gm-hint">
                      {key}: {Array.isArray(value) ? `${value.length} items` : "object"}
                    </p>
                  );
                })}
            </div>
          );
        })}

        <div className="gm-section">
          {adding ? (
            <select
              className="gm-select"
              autoFocus
              defaultValue=""
              onChange={(event) => {
                const type = event.target.value;
                setAdding(false);
                if (!type) return;
                const validation = validateComponent(type, {}, entity.components.map((existing) => existing.type));
                if (!validation.ok) {
                  editorStore.log("error", "editor", validation.issues.join("; "));
                  return;
                }
                patch({ operations: [{ op: "setComponent", entityId: entity.id, component: type, data: validation.data! }] }, `Add ${type}`);
                if (validation.missingRequirements.length) {
                  editorStore.log("warn", "editor", `${type} also needs ${validation.missingRequirements.join(", ")} to work.`);
                }
              }}
              onBlur={() => setAdding(false)}
            >
              <option value="">Choose a component…</option>
              {componentOptions.map((component) => (
                <option key={component.type} value={component.type}>
                  {component.type} — {component.summary.slice(0, 60)}
                </option>
              ))}
            </select>
          ) : (
            <button type="button" className="gm-button gm-button--ghost" onClick={() => setAdding(true)}>
              Add component
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
