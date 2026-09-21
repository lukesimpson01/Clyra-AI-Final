import { useCallback, useEffect, useRef, useState } from "react";
import { Command, Send, Sparkles } from "lucide-react";
import { ClyraStandardMap, type MapContextSnapshot } from "./ClyraStandardMap";
import { prewarmMapLibre } from "./mapRenderer";

/**
 * Clyra Maps workspace.
 *
 * One renderer (MapLibre + OpenFreeMap), one map surface, one camera system.
 * This is the thin shell around the map: it owns the bottom AI composer and
 * forwards a compact map-context snapshot to Clyra so the assistant can reason
 * about the visible map without ever receiving tile data.
 *
 * The composer collapses to a compact "Ask Clyra" pill when idle and expands
 * on hover/focus so it never covers the map more than necessary.
 */

function compactContext(context: MapContextSnapshot | null): string {
  if (!context) return "";
  const [lng, lat] = context.center;
  const parts = [`center ${lat.toFixed(4)},${lng.toFixed(4)}`, `zoom ${context.zoom.toFixed(1)}`];
  if (context.selectedPlace) parts.push(`selected “${context.selectedPlace.label}”`);
  if (context.route) parts.push(`route ${(context.route.distanceM / 1000).toFixed(1)} km ${context.route.mode}`);
  return parts.join(" · ");
}

export function ClyraMapsWorkspace({ initialCommand, onAskClyra }: {
  initialCommand?: string;
  onAskClyra?: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [context, setContext] = useState<MapContextSnapshot | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const expanded = hovered || focused || text.trim().length > 0;

  // Warm the MapLibre worker pool the moment the workspace mounts.
  useEffect(() => { prewarmMapLibre(); }, []);

  // Cmd/Ctrl-K focuses the map composer (scoped to this workspace).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = useCallback(() => {
    const query = text.trim();
    if (!query || !onAskClyra) return;
    const ctx = compactContext(context);
    onAskClyra(ctx ? `[Map context: ${ctx}] ${query}` : query);
    setText("");
    inputRef.current?.blur();
  }, [context, onAskClyra, text]);

  return (
    <div className="clyra-maps" data-testid="clyra-maps">
      <ClyraStandardMap initialCommand={initialCommand} onContextChange={setContext} />
      <form
        className={`clyra-maps__composer${expanded ? " is-expanded" : ""}`}
        data-expanded={expanded || undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onSubmit={(event) => { event.preventDefault(); submit(); }}
      >
        <button
          type="button"
          className="clyra-maps__composer-command"
          aria-label="Ask Clyra"
          onClick={() => inputRef.current?.focus()}
        >
          <Command size={16} strokeWidth={1.8} />
        </button>
        <input
          ref={inputRef}
          value={text}
          placeholder={expanded ? "Ask Clyra about this map…" : "Ask Clyra…"}
          aria-label="Ask Clyra about this map"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setText(""); inputRef.current?.blur(); }
            else if (event.key === "Enter") { event.preventDefault(); submit(); }
          }}
        />
        {expanded ? (
          <button type="submit" className="clyra-maps__composer-send" aria-label="Send">
            <Send size={15} />
          </button>
        ) : (
          <span className="clyra-maps__composer-hint" aria-hidden="true">
            <Sparkles size={13} />
          </span>
        )}
      </form>
    </div>
  );
}

/** Mounted once at startup so MapLibre is warm before Maps is opened. */
export function ClyraMapsPrewarm() {
  useEffect(() => { prewarmMapLibre(); }, []);
  return null;
}

export default ClyraMapsWorkspace;
