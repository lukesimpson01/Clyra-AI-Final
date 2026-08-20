/**
 * Scene hierarchy: tree, search, reparent by drag, rename, lock, hide.
 */
import { useMemo, useState } from "react";
import { Box, ChevronDown, ChevronRight, Eye, EyeOff, Lock, Search, Trash2, Unlock, Users, Boxes, Lightbulb, Camera, Trees, Route, Map as MapIcon } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { activeScene } from "../ir/project";
import type { EntityIR } from "../ir/types";

const ICONS: Record<string, typeof Box> = {
  player: Users,
  npc: Users,
  enemy: Users,
  building: Boxes,
  settlement: MapIcon,
  fortress: Boxes,
  dungeon: Boxes,
  light: Lightbulb,
  camera: Camera,
  vegetation: Trees,
  road: Route,
  terrain: MapIcon,
};

export function Hierarchy() {
  const project = useEditorState((state) => state.project);
  const selection = useEditorState((state) => state.selection);
  const expanded = useEditorState((state) => state.expanded);
  const [search, setSearch] = useState("");

  const scene = project ? activeScene(project) : null;
  const matches = useMemo(() => {
    if (!scene || !search.trim()) return null;
    const needle = search.toLowerCase();
    return new Set(
      Object.values(scene.entities)
        .filter((entity) => entity.name.toLowerCase().includes(needle) || entity.type.toLowerCase().includes(needle) || entity.tags.some((tag) => tag.includes(needle)))
        .map((entity) => entity.id),
    );
  }, [scene, search]);

  if (!scene) return null;

  const renderRow = (entity: EntityIR, depth: number) => {
    if (matches && !matches.has(entity.id) && !entity.children.some((child) => matches.has(child))) return null;
    const Icon = ICONS[entity.type] ?? Box;
    const isOpen = expanded[entity.id] ?? depth < 1;
    const isSelected = selection.includes(entity.id);

    return (
      <div key={entity.id}>
        <div
          className={cn("gm-tree__row", isSelected && "is-selected")}
          style={{ paddingLeft: `${8 + depth * 13}px` }}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/gm-entity", entity.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dragged = event.dataTransfer.getData("text/gm-entity");
            if (dragged && dragged !== entity.id) {
              editorStore.applyPatch({ operations: [{ op: "reparent", entityId: dragged, parentId: entity.id }] }, "Reparent object");
            }
          }}
          onClick={(event) => editorStore.select(event.shiftKey ? [...new Set([...selection, entity.id])] : [entity.id])}
          onDoubleClick={() => editorStore.engine?.frameSelection()}
        >
          <button
            type="button"
            className="gm-tree__twisty"
            onClick={(event) => {
              event.stopPropagation();
              editorStore.toggleExpanded(entity.id);
            }}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {entity.children.length ? isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}
          </button>
          <Icon size={12} className="gm-tree__icon" />
          <span className="gm-tree__label">{entity.name}</span>
          <button
            type="button"
            className="gm-tree__action"
            title={entity.visible ? "Hide" : "Show"}
            onClick={(event) => {
              event.stopPropagation();
              editorStore.applyPatch({ operations: [{ op: "setVisible", entityId: entity.id, visible: !entity.visible }] }, entity.visible ? "Hide object" : "Show object");
            }}
          >
            {entity.visible ? <Eye size={11} /> : <EyeOff size={11} />}
          </button>
          <button
            type="button"
            className="gm-tree__action"
            title={entity.locked ? "Unlock" : "Lock"}
            onClick={(event) => {
              event.stopPropagation();
              editorStore.applyPatch({ operations: [{ op: "setLocked", entityId: entity.id, locked: !entity.locked }] }, entity.locked ? "Unlock object" : "Lock object");
            }}
          >
            {entity.locked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
        </div>
        {isOpen ? entity.children.map((childId) => (scene.entities[childId] ? renderRow(scene.entities[childId]!, depth + 1) : null)) : null}
      </div>
    );
  };

  return (
    <section className="gm-panel gm-hierarchy">
      <header className="gm-panel__header">
        <span>Scene</span>
        <div className="gm-search">
          <Search size={11} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search the scene" />
        </div>
      </header>
      <div className="gm-panel__body gm-tree">
        {scene.rootEntities.length ? (
          scene.rootEntities.map((rootId) => (scene.entities[rootId] ? renderRow(scene.entities[rootId]!, 0) : null))
        ) : (
          <p className="gm-empty">This scene is empty. Ask Clyra to build something, or pick a template.</p>
        )}
      </div>
      {selection.length ? (
        <footer className="gm-hierarchy__footer">
          <span>{selection.length} selected</span>
          <button
            type="button"
            onClick={() => {
              editorStore.applyPatch({ operations: selection.map((entityId) => ({ op: "delete", entityId })) }, `Delete ${selection.length} object${selection.length === 1 ? "" : "s"}`);
              editorStore.select([]);
            }}
          >
            <Trash2 size={11} /> Delete
          </button>
        </footer>
      ) : null}
    </section>
  );
}
