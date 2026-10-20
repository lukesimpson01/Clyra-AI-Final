import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, MapPin, Sparkles, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ClyraChatComposerBar,
  assistantBubbleInnerStyle,
  chatBubbleStyle,
  userBubbleInnerStyle,
} from "../chat/ClyraComposerShell";
import { ShiningText } from "../ui/shining-text";
import { MarkdownMessageContent } from "../MarkdownMessageContent";
import type { ClyraPlace } from "../../../lib/maps/types";
import { formatDistance } from "./mapsIcons";

/** One exchange in the map chat. Tool steps and places are attached to the
 * assistant turn that produced them, so the thread reads like the Clyra chat. */
export type MapsAgentStep =
  | { kind: "tool"; name: string; ok: boolean; summary: string }
  | { kind: "map"; label: string };

export interface ComparisonRow {
  name: string;
  distanceKm?: number;
  openNow: string;
  hours?: string;
  phone: boolean;
  website: boolean;
  reviews: string;
}

export interface MapsAgentTurn {
  id: string;
  role: "user" | "assistant";
  text?: string;
  error?: string;
  stopped?: boolean;
  /** Every real step, in order: tool calls and what they did on the map. */
  steps?: MapsAgentStep[];
  comparison?: ComparisonRow[];
  places?: ClyraPlace[];
  pending?: boolean;
}

interface MapsAgentPanelProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  turns: MapsAgentTurn[];
  busy: boolean;
  status: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onSelectPlace: (place: ClyraPlace) => void;
  /** Warms the detail cache ahead of a click, so the sheet opens pre-loaded. */
  onHoverPlace?: (place: ClyraPlace) => void;
  selectedName?: string;
  hasRoute?: boolean;
}

/** Every capability the agent has, shown as starters so the user can see what's possible. */
const STARTERS = [
  "What's around here?",
  "Plan a relaxed day out nearby",
  "Best coffee within a 10 minute walk",
  "How do I get to the CBD by train?",
  "Find somewhere open now",
  "Show me this area in satellite 3D",
  "Weather and air quality here",
  "Remember I prefer walking",
];

/** Collapsed: a Clyra composer pill. Expanded: a right-hand thread built from the
 * same bubble styles, composer bar and reply animation the Clyra chat uses. */
export function MapsAgentPanel({ open, onOpen, onClose, turns, busy, status, onSend, onStop, onSelectPlace, onHoverPlace, selectedName, hasRoute }: MapsAgentPanelProps) {
  const [text, setText] = useState("");
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    onSend(value);
  };

  return (
    <AnimatePresence initial={false} mode="wait">
      {open ? (
        <motion.section
          key="expanded"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Ask Clyra"
          className="pointer-events-auto absolute bottom-4 right-4 top-4 z-40 flex w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[#e7e4dc] bg-[#fbfaf7]/[0.98] shadow-[0_16px_48px_rgba(15,23,42,.16)]"
        >
          <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#3b82f6]" />
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#15171C]">Ask Clyra</h2>
              {selectedName ? <span className="max-w-[140px] truncate text-[12px] text-[#8190a3]">· {selectedName}</span> : null}
            </div>
            <button
              type="button"
              aria-label="Close Ask Clyra"
              onClick={onClose}
              className="grid h-7 w-7 place-items-center rounded-full text-[#8190a3] transition-colors hover:bg-black/5 hover:text-[#15171C]"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
            {turns.length === 0 ? (
              <div className="pt-6">
                <p className="text-[18px] font-semibold tracking-[-0.02em] text-[#15171C]">What would you like to find?</p>
                <p className="mt-1 text-[13px] text-[#8190a3]">Ask about this area, a place you've selected, or a route.</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(selectedName
                    ? [`Is ${selectedName} worth visiting?`, "What's the best time to go?", "Find parking nearby", "Similar places nearby"]
                    : hasRoute
                      ? ["Coffee on the way", "Fuel along my route", "Is there a faster way?", "Plan a stop for lunch"]
                      : STARTERS
                  ).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSend(s)}
                      className="rounded-full border border-[#e7e4dc] bg-white px-3 py-1.5 text-[12.5px] text-[#15171C] transition-colors hover:bg-[#f4f1ea]"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {turns.map((turn) =>
              turn.role === "user" ? (
                <div key={turn.id} style={chatBubbleStyle("user")}>
                  <div style={userBubbleInnerStyle}>{turn.text}</div>
                </div>
              ) : (
                <div key={turn.id} style={chatBubbleStyle("assistant")}>
                  <div style={{ ...assistantBubbleInnerStyle, animation: "clyraReplyIn 1.15s cubic-bezier(.32,.72,0,1) both" }} className="w-full">
                    {turn.steps?.length ? (
                      <ol className="mb-2 space-y-1 text-[12px]">
                        {turn.steps.map((st, i) =>
                          st.kind === "tool" ? (
                            <li key={i} className={"flex items-start gap-1.5 " + (st.ok ? "text-[#8190a3]" : "text-[#b45309]")}>
                              <span className="mt-px w-3 shrink-0 text-center">{st.ok ? "✓" : "!"}</span>
                              <span>
                                {toolLabel(st.name)}
                                {st.summary ? <span className="opacity-80"> — {st.summary}</span> : null}
                              </span>
                            </li>
                          ) : (
                            <li key={i} className="flex items-start gap-1.5 font-medium text-[#3b82f6]">
                              <MapPin className="mt-px h-3 w-3 shrink-0" />
                              <span>{st.label}</span>
                            </li>
                          ),
                        )}
                      </ol>
                    ) : null}
                    {turn.comparison?.length ? <ComparisonTable rows={turn.comparison} /> : null}
                    {turn.pending && !turn.text && !turn.error ? (
                      <ShiningText text={status || "Thinking…"} className="text-[13px]" />
                    ) : null}
                    {turn.text ? (
                      <div className="markdown-body overflow-x-auto">
                        <MarkdownMessageContent content={turn.text} suppressCodeBlocks />
                      </div>
                    ) : null}
                    {turn.error ? <p className="text-[#b45309]">{turn.error}</p> : null}
                    {turn.stopped ? <p className="text-[12px] text-[#8190a3]">Stopped.</p> : null}
                    {turn.places?.length ? (
                      <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                        {turn.places.slice(0, 8).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseEnter={() => onHoverPlace?.(p)}
                            onClick={() => onSelectPlace(p)}
                            className="w-[150px] shrink-0 rounded-xl border border-[#e7e4dc] bg-white p-2.5 text-left transition-all duration-150 hover:border-[#3b82f6]/40 active:scale-[0.98]"
                          >
                            <span className="block truncate text-[13px] font-semibold text-[#15171C]">{p.name}</span>
                            <span className="mt-0.5 block truncate text-[11.5px] capitalize text-[#8190a3]">
                              {p.categories[0]?.replace(/_/g, " ") ?? "Place"}
                              {typeof p.distanceMeters === "number" ? ` · ${formatDistance(p.distanceMeters)}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ),
            )}
          </div>

          <div className="shrink-0 px-3 pb-3 pt-1">
            {busy ? (
              <div className="mb-2 flex items-center justify-between px-1">
                <ShiningText text={status || "Working…"} className="text-[12px]" />
                <button type="button" onClick={onStop} className="flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[#8190a3] hover:bg-black/5">
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>
            ) : null}
            <ClyraChatComposerBar
              text={text}
              onTextChange={setText}
              onSubmit={submit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ask about this area, a place or a route…"
              disabled={busy}
            />
          </div>
        </motion.section>
      ) : (
        <motion.button
          key="collapsed"
          type="button"
          onClick={onOpen}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto absolute bottom-4 left-1/2 z-40 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#e7e4dc] bg-white px-4 py-2.5 text-left text-[14px] text-[#8190a3] shadow-[0_12px_40px_rgba(15,23,42,.14)] transition-colors hover:text-[#15171C]"
        >
          <Sparkles className="h-4 w-4 text-[#3b82f6]" />
          <span className="flex-1 truncate">Ask Clyra about this area…</span>
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#15171C] text-white">
            <ArrowUp className="h-3.5 w-3.5" />
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-[#e7e4dc] bg-white">
      <table className="w-full min-w-[300px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-[#e7e4dc] text-[#8190a3]">
            <th className="px-2.5 py-2 font-medium">Place</th>
            <th className="px-2.5 py-2 font-medium">Distance</th>
            <th className="px-2.5 py-2 font-medium">Open</th>
            <th className="px-2.5 py-2 font-medium">Contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name + r.openNow} className="border-b border-[#f1eee7] last:border-0 align-top">
              <td className="px-2.5 py-2 font-semibold text-[#15171C]">{r.name}</td>
              <td className="px-2.5 py-2 text-[#15171C]">{typeof r.distanceKm === "number" ? `${r.distanceKm} km` : "—"}</td>
              <td className="px-2.5 py-2 text-[#15171C]">
                {r.openNow}
                {r.hours ? <div className="mt-0.5 text-[10.5px] text-[#8190a3]">{r.hours}</div> : null}
              </td>
              <td className="px-2.5 py-2 text-[#8190a3]">{[r.phone && "Phone", r.website && "Website"].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2.5 py-1.5 text-[10.5px] text-[#8190a3]">Distances are straight-line from you. Hours are from OpenStreetMap.</p>
    </div>
  );
}

function toolLabel(name: string): string {
  switch (name) {
    case "search_places":
      return "Searched places";
    case "search_nearby":
      return "Searched nearby";
    case "search_along_route":
      return "Searched along the route";
    case "identify_point":
      return "Identified the point";
    case "inspect_place":
      return "Checked place details";
    case "get_route":
      return "Calculated route";
    case "select_result":
      return "Selected result";
    case "map_control":
      return "Updated the map";
    case "get_weather":
      return "Checked the weather";
    case "compare_places":
      return "Compared places";
    case "save_preference":
      return "Saved a preference";
    case "web_search":
      return "Searched the web";
    default:
      return name;
  }
}
