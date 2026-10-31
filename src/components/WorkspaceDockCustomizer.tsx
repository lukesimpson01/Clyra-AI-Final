import { useMemo, useRef, useState, type DragEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  Check,
  Globe,
  GraduationCap,
  MapPin,
  MessageCircle,
  MessageCirclePlus,
  Music2,
  RotateCcw,
  Scissors,
  Search,
  SquarePen,
  Trash2,
  Volume2,
} from "lucide-react";
import { cn } from "../lib/utils";

type DockAppId =
  | "chat"
  | "vibe"
  | "clip"
  | "browser"
  | "study"
  | "spotify"
  | "notes"
  | "maps";

type DockApp = {
  id: DockAppId;
  label: string;
  icon: typeof MessageCircle;
  category: "AI Workspace" | "Creative Studio" | "Tools";
  pinned?: boolean;
};

const DOCK_APPS: DockApp[] = [
  { id: "chat", label: "Chat", icon: MessageCircle, category: "AI Workspace", pinned: true },
  { id: "vibe", label: "Vibe Coder", icon: SquarePen, category: "AI Workspace" },
  { id: "browser", label: "Browser", icon: Globe, category: "AI Workspace" },
  { id: "study", label: "Study", icon: GraduationCap, category: "AI Workspace" },
  { id: "clip", label: "Shorts", icon: Scissors, category: "Creative Studio" },
  { id: "notes", label: "Notes", icon: BookOpen, category: "Tools" },
  { id: "maps", label: "Maps", icon: MapPin, category: "Tools" },
  { id: "spotify", label: "Music", icon: Music2, category: "Tools" },
];

const QUICK_ACTIONS: Array<{ id: string; label: string; icon: typeof Search }> = [
  { id: "new-chat", label: "New Chat", icon: MessageCirclePlus },
  { id: "search", label: "Search", icon: Search },
  { id: "voice", label: "Start Voice", icon: Volume2 },
];

const CATEGORY_ORDER = ["AI Workspace", "Creative Studio", "Tools"] as const;
const MAX_DOCK_APPS = 4;

type Props = {
  railTabs: string[];
  onChange: (next: string[]) => void;
  onQuickAction: (id: string) => void;
  onDone: () => void;
};

type DragState = { id: string; source: "library" | "rail" } | null;

function appById(id: string): DockApp | undefined {
  return DOCK_APPS.find((app) => app.id === id);
}

export function WorkspaceDockCustomizer({
  railTabs,
  onChange,
  onQuickAction,
  onDone,
}: Props) {
  const [drag, setDrag] = useState<DragState>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [overRemove, setOverRemove] = useState(false);
  const [saved, setSaved] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const rail = useMemo(() => {
    const order = Array.isArray(railTabs) ? railTabs : [];
    return order
      .map((id) => appById(id))
      .filter((app): app is DockApp => Boolean(app));
  }, [railTabs]);

  const available = useMemo(
    () => DOCK_APPS.filter((app) => !app.pinned && !railTabs.includes(app.id)),
    [railTabs],
  );

  const atCapacity = rail.filter((app) => !app.pinned).length >= MAX_DOCK_APPS;

  const commit = (next: string[]) => {
    onChange(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  };

  const addApp = (id: string, atIndex?: number) => {
    if (id === "chat" || railTabs.includes(id)) return;
    const apps = railTabs.filter((t) => t !== "chat");
    if (apps.length >= MAX_DOCK_APPS) return;
    const nextApps = atIndex == null ? [...apps, id] : [...apps.slice(0, atIndex), id, ...apps.slice(atIndex)];
    commit(["chat", ...nextApps]);
  };

  const removeApp = (id: string) => {
    if (id === "chat") return;
    commit(railTabs.filter((t) => t !== id));
  };

  const moveApp = (id: string, toIndex: number) => {
    const apps = railTabs.filter((t) => t !== "chat");
    const from = apps.indexOf(id);
    if (from < 0) return;
    const next = [...apps];
    next.splice(from, 1);
    const clamped = Math.max(0, Math.min(next.length, toIndex));
    next.splice(clamped, 0, id);
    commit(["chat", ...next]);
  };

  const computeDropIndex = (clientX: number) => {
    const preview = previewRef.current;
    if (!preview) return null;
    const items = Array.from(preview.querySelectorAll<HTMLElement>("[data-dock-index]"));
    if (!items.length) return 0;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return items.length;
  };

  const onDragStart = (id: string, source: "library" | "rail", event: DragEvent) => {
    setDrag({ id, source });
    event.dataTransfer.effectAllowed = "move";
    try { event.dataTransfer.setData("text/plain", id); } catch { /* noop */ }
  };

  const onPreviewDragOver = (event: DragEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndex(computeDropIndex(event.clientX));
  };

  const onPreviewDrop = (event: DragEvent) => {
    event.preventDefault();
    if (!drag) return;
    const index = computeDropIndex(event.clientX) ?? 0;
    const apps = railTabs.filter((t) => t !== "chat");
    const from = apps.indexOf(drag.id);

    if (drag.source === "library") {
      addApp(drag.id, Math.max(0, index - 1));
    } else if (from >= 0) {
      const target = index - 1;
      const adjusted = target > from ? target - 1 : target;
      moveApp(drag.id, adjusted);
    }
    resetDrag();
  };

  const resetDrag = () => {
    setDrag(null);
    setDropIndex(null);
    setOverRemove(false);
  };

  const restoreDefaults = () => {
    commit(["chat", "vibe", "clip"]);
  };

  const dirty = railTabs.length !== 3 || railTabs[1] !== "vibe" || railTabs[2] !== "clip";

  return (
    <div className="clys-dock">
      <div className="clys-dock__head">
        <div>
          <h3 className="clys-dock__title">Customise Clyra</h3>
          <p className="clys-dock__subtitle">Make your workspace yours.</p>
        </div>
        <button type="button" className="clys-icon-btn" onClick={onDone} aria-label="Done customising">
          <Check aria-hidden />
        </button>
      </div>

      {/* Live dock preview — a light, pill-shaped replica of the real switcher
          in its hover state. It is the real, editable drop zone. */}
      <div
        ref={previewRef}
        className={cn("clys-dock__preview", dropIndex != null && "is-over")}
        onDragOver={onPreviewDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
        }}
        onDrop={onPreviewDrop}
      >
        <AnimatePresence initial={false}>
          {rail.map((app, index) => {
            const Icon = app.icon;
            const isDragging = drag?.id === app.id && drag.source === "rail";
            return (
              <motion.div
                key={app.id}
                layout
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.16 } }}
                transition={{ type: "spring", stiffness: 500, damping: 40, mass: 0.7 }}
                className="clys-dock__slot"
                data-dock-index={index}
              >
                {dropIndex === index ? <span className="clys-dock__marker" aria-hidden /> : null}
                <div
                  className={cn(
                    "clys-dock__item",
                    app.pinned && "clys-dock__item--pinned",
                    isDragging && "is-dragging",
                  )}
                  title={app.label}
                  draggable={!app.pinned}
                  onDragStart={(event) => !app.pinned && onDragStart(app.id, "rail", event)}
                  onDragEnd={resetDrag}
                >
                  <Icon className="clys-dock__icon" aria-hidden />
                  <span className="clys-dock__label">{app.label}</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {dropIndex === rail.length ? <span className="clys-dock__marker clys-dock__marker--end" aria-hidden /> : null}
      </div>

      <p className="clys-dock__hint">Drag items to add, rearrange or remove them.</p>

      {/* Available apps & actions. */}
      <div className="clys-dock__library">
        {CATEGORY_ORDER.map((category) => {
          const items = available.filter((app) => app.category === category);
          if (!items.length) return null;
          return (
            <div key={category} className="clys-dock__group">
              <p className="clys-dock__group-label">{category}</p>
              <div className="clys-dock__grid">
                {items.map((app) => {
                  const Icon = app.icon;
                  return (
                    <button
                      key={app.id}
                      type="button"
                      className={cn(
                        "clys-dock__lib-item",
                        drag?.id === app.id && drag.source === "library" && "is-dragging",
                      )}
                      draggable
                      onDragStart={(event) => onDragStart(app.id, "library", event)}
                      onDragEnd={resetDrag}
                      onClick={() => addApp(app.id)}
                      title={`Add ${app.label}`}
                    >
                      <Icon className="clys-dock__lib-icon" aria-hidden />
                      <span className="clys-dock__lib-label">{app.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="clys-dock__group">
          <p className="clys-dock__group-label">Quick Actions</p>
          <div className="clys-dock__grid">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  className="clys-dock__lib-item clys-dock__lib-item--action"
                  onClick={() => onQuickAction(action.id)}
                >
                  <Icon className="clys-dock__lib-icon" aria-hidden />
                  <span className="clys-dock__lib-label">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Removal drop zone. */}
      <div
        className={cn("clys-dock__remove", overRemove && "is-over")}
        onDragOver={(event) => {
          if (!drag || drag.source !== "rail") return;
          event.preventDefault();
          setOverRemove(true);
        }}
        onDragLeave={() => setOverRemove(false)}
        onDrop={(event) => {
          event.preventDefault();
          if (drag && drag.source === "rail") removeApp(drag.id);
          resetDrag();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        <span>Drag here to remove</span>
      </div>

      {/* Footer. */}
      <div className="clys-dock__footer">
        <button type="button" className="clys-btn" onClick={restoreDefaults} disabled={!dirty}>
          <RotateCcw aria-hidden />
          Restore Defaults
        </button>
        <div className="clys-dock__footer-right">
          {atCapacity ? <span className="clys-dock__limit">Dock full</span> : null}
          {saved ? <span className="clys-dock__saved">Saved</span> : null}
          <button type="button" className="clys-btn clys-btn--primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
