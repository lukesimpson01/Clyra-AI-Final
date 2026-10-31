import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Check, MapPin, Sparkles, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
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

const SHELL_EASE = [0.32, 0.72, 0, 1] as const;

/** Clyra Chat's composer, sized for the map: the prompt on top, a control row beneath with the send button. The
 * same element (shared layoutId) is the collapsed bar and the panel's composer, so opening the panel glides it
 * into place instead of swapping one bar for another. */
function MapsCapsule({
  text,
  onText,
  onSubmit,
  busy,
  placeholder,
  onFocus,
  autoFocus,
  leading,
}: {
  text: string;
  onText: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  onFocus?: () => void;
  autoFocus?: boolean;
  leading?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(120, Math.max(24, el.scrollHeight))}px`;
  }, [text]);
  useEffect(() => { if (autoFocus) requestAnimationFrame(() => ref.current?.focus()); }, [autoFocus]);
  const canSend = Boolean(text.trim()) && !busy;
  return (
    <motion.div
      layoutId="maps-capsule"
      transition={{ layout: { duration: 0.5, ease: SHELL_EASE } }}
      className="maps-capsule"
      onClick={() => ref.current?.focus()}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-[3px] h-[15px] w-[15px] shrink-0 text-[#1E6FFF]" aria-hidden />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[#15171C] outline-none placeholder:text-[#9a9ca3]"
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {leading}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Send"
          disabled={!canSend}
          onClick={(event) => { event.stopPropagation(); if (canSend) onSubmit(); }}
          className={"grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-[240ms] active:scale-95 " + (canSend ? "bg-[#1E6FFF] text-white shadow-[0_2px_10px_-2px_rgba(30,111,255,0.55)] hover:bg-[#1a63e6]" : "bg-[#EDEEF1] text-[#AFB3BB]")}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
    </motion.div>
  );
}

/** Collapsed: Chat's composer floating at the bottom of the map — type and send straight away. Expanded: a
 * right-hand thread with the same bubbles, a timeline of what Clyra did, and the same composer. */
export function MapsAgentPanel({ open, onOpen, onClose, turns, busy, status, onSend, onStop, onSelectPlace, onHoverPlace, selectedName, hasRoute }: MapsAgentPanelProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [turns, busy, reduced]);

  const submit = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    if (!open) onOpen();
    onSend(value);
  };
  const starters = selectedName
    ? [`Is ${selectedName} worth visiting?`, "What's the best time to go?", "Find parking nearby", "Similar places nearby"]
    : hasRoute
      ? ["Coffee on the way", "Fuel along my route", "Is there a faster way?", "Plan a stop for lunch"]
      : STARTERS;
  const placeholder = selectedName ? `Ask about ${selectedName}…` : hasRoute ? "Ask about your route…" : "Ask Clyra anything about the map…";

  return (
    <LayoutGroup id="maps-agent">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            key="expanded"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: 18, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: 0.42, ease: SHELL_EASE }}
            aria-label="Ask Clyra"
            className="pointer-events-auto absolute bottom-4 right-4 top-4 z-40 flex w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_1px_1px_rgba(16,18,24,0.03),0_12px_28px_-10px_rgba(16,18,24,0.16),0_32px_64px_-32px_rgba(16,18,24,0.28),inset_0_0_0_1px_rgba(16,18,24,0.06)]"
          >
            <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3.5">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#15171C]">Ask Clyra</h2>
                {selectedName ? <span className="min-w-0 truncate text-[12.5px] text-[#6b7079]">· {selectedName}</span> : null}
              </div>
              <button
                type="button"
                aria-label="Close Ask Clyra"
                onClick={onClose}
                className="grid h-7 w-7 place-items-center rounded-full text-[#6b7079] transition-colors hover:bg-black/5 hover:text-[#15171C]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
              {turns.length === 0 ? (
                <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: SHELL_EASE, delay: 0.08 }} className="pt-6">
                  <p className="text-[19px] font-semibold tracking-[-0.025em] text-[#15171C]">Where to?</p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-[#6b7079]">Places, routes, day plans, weather, what something is — Clyra can do it on the map.</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {starters.map((s, i) => (
                      <motion.button
                        key={s}
                        type="button"
                        initial={reduced ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: SHELL_EASE, delay: 0.12 + i * 0.025 }}
                        onClick={() => onSend(s)}
                        className="rounded-full bg-[#f3f4f6] px-3 py-1.5 text-[12.5px] font-medium text-[#3b3e45] transition-colors hover:bg-[#e9eaee] hover:text-[#15171C]"
                      >
                        {s}
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              ) : null}

              {turns.map((turn) =>
                turn.role === "user" ? (
                  <motion.div key={turn.id} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: SHELL_EASE }} style={chatBubbleStyle("user")}>
                    <div style={userBubbleInnerStyle}>{turn.text}</div>
                  </motion.div>
                ) : (
                  <div key={turn.id} style={chatBubbleStyle("assistant")}>
                    <div style={{ ...assistantBubbleInnerStyle, maxWidth: "100%" }} className="w-full">
                      {turn.steps?.length ? (
                        <ol className="maps-steps mb-2.5">
                          {turn.steps.map((st, i) => (
                            <motion.li
                              key={i}
                              initial={reduced ? false : { opacity: 0, y: 3 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.24, ease: SHELL_EASE }}
                              className="maps-step"
                              data-state={st.kind === "map" ? "map" : st.ok ? "ok" : "error"}
                            >
                              <span className="maps-step-node" aria-hidden>{st.kind === "map" ? <MapPin className="h-2.5 w-2.5" /> : st.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : "!"}</span>
                              <span className="min-w-0">
                                {st.kind === "map" ? st.label : toolLabel(st.name)}
                                {st.kind === "tool" && st.summary ? <span className="text-[#9a9ca3]"> · {st.summary}</span> : null}
                              </span>
                            </motion.li>
                          ))}
                          {turn.pending && !turn.text && !turn.error ? (
                            <li className="maps-step" data-state="running">
                              <span className="maps-step-node" aria-hidden />
                              <ShiningText text={status || "Thinking…"} className="text-[12.5px]" />
                            </li>
                          ) : null}
                        </ol>
                      ) : turn.pending && !turn.text && !turn.error ? (
                        <ShiningText text={status || "Thinking…"} className="text-[13px]" />
                      ) : null}
                      {turn.comparison?.length ? <ComparisonTable rows={turn.comparison} /> : null}
                      {turn.text ? (
                        <div className="markdown-body overflow-x-auto" style={{ animation: reduced ? undefined : "clyraReplyIn .9s cubic-bezier(.32,.72,0,1) both" }}>
                          <MarkdownMessageContent content={turn.text} suppressCodeBlocks />
                        </div>
                      ) : null}
                      {turn.error ? <p className="text-[#b45309]">{turn.error}</p> : null}
                      {turn.stopped ? <p className="text-[12px] text-[#6b7079]">Stopped.</p> : null}
                      {turn.places?.length ? (
                        <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                          {turn.places.slice(0, 8).map((p, i) => (
                            <motion.button
                              key={p.id}
                              type="button"
                              initial={reduced ? false : { opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.3, ease: SHELL_EASE, delay: Math.min(i, 6) * 0.03 }}
                              onMouseEnter={() => onHoverPlace?.(p)}
                              onClick={() => onSelectPlace(p)}
                              className="w-[150px] shrink-0 rounded-[14px] bg-white p-2.5 text-left shadow-[inset_0_0_0_1px_rgba(16,18,24,0.08)] transition-[box-shadow,transform] duration-150 hover:shadow-[inset_0_0_0_1px_rgba(30,111,255,0.35)] active:scale-[0.98]"
                            >
                              <span className="block truncate text-[13px] font-semibold text-[#15171C]">{p.name}</span>
                              <span className="mt-0.5 block truncate text-[11.5px] capitalize text-[#6b7079]">
                                {p.categories[0]?.replace(/_/g, " ") ?? "Place"}
                                {typeof p.distanceMeters === "number" ? ` · ${formatDistance(p.distanceMeters)}` : ""}
                              </span>
                            </motion.button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )}
            </div>

            <div className="shrink-0 px-3 pb-3 pt-1">
              <MapsCapsule
                text={text}
                onText={setText}
                onSubmit={submit}
                busy={busy}
                placeholder={busy ? "Clyra is working…" : "Ask a follow-up…"}
                autoFocus
                leading={busy ? (
                  <button type="button" onClick={onStop} className="flex h-[28px] items-center gap-1.5 rounded-full bg-[#f3f4f6] px-3 text-[12px] font-medium text-[#3b3e45] transition-colors hover:bg-[#e9eaee]">
                    <Square className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} /> Stop
                  </button>
                ) : selectedName ? (
                  <span className="flex h-[28px] max-w-[200px] items-center gap-1.5 truncate rounded-full bg-[rgba(30,111,255,0.08)] px-3 text-[12px] font-medium text-[#2f63d8]">
                    <MapPin className="h-3 w-3 shrink-0" /> <span className="truncate">{selectedName}</span>
                  </span>
                ) : null}
              />
            </div>
          </motion.section>
        ) : (
          <motion.div
            key="collapsed"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.45, ease: SHELL_EASE }}
            className="pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(500px,calc(100vw-32px))] -translate-x-1/2"
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
          >
            <AnimatePresence>
              {focused && !text.trim() ? (
                <motion.div
                  key="starters"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, transition: { duration: 0.14 } }}
                  transition={{ duration: 0.3, ease: SHELL_EASE }}
                  className="mb-2 flex flex-wrap justify-center gap-1.5"
                >
                  {starters.slice(0, 4).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => { onOpen(); onSend(s); }}
                      className="rounded-full bg-white/95 px-3 py-1.5 text-[12.5px] font-medium text-[#3b3e45] shadow-[0_4px_14px_-6px_rgba(16,18,24,0.25),inset_0_0_0_1px_rgba(16,18,24,0.06)] backdrop-blur transition-colors hover:text-[#15171C]"
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
            <MapsCapsule text={text} onText={setText} onSubmit={submit} busy={busy} placeholder={placeholder} onFocus={() => setFocused(true)} />
          </motion.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
  );
}

function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-[14px] bg-white shadow-[inset_0_0_0_1px_rgba(16,18,24,0.08)]">
      <table className="w-full min-w-[300px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-black/[0.06] text-[#6b7079]">
            <th className="px-2.5 py-2 font-medium">Place</th>
            <th className="px-2.5 py-2 font-medium">Distance</th>
            <th className="px-2.5 py-2 font-medium">Open</th>
            <th className="px-2.5 py-2 font-medium">Contact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name + r.openNow} className="border-b border-black/[0.05] last:border-0 align-top">
              <td className="px-2.5 py-2 font-semibold text-[#15171C]">{r.name}</td>
              <td className="px-2.5 py-2 text-[#15171C]">{typeof r.distanceKm === "number" ? `${r.distanceKm} km` : "—"}</td>
              <td className="px-2.5 py-2 text-[#15171C]">
                {r.openNow}
                {r.hours ? <div className="mt-0.5 text-[10.5px] text-[#6b7079]">{r.hours}</div> : null}
              </td>
              <td className="px-2.5 py-2 text-[#6b7079]">{[r.phone && "Phone", r.website && "Website"].filter(Boolean).join(" · ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2.5 py-1.5 text-[10.5px] text-[#6b7079]">Distances are straight-line from you. Hours are from OpenStreetMap.</p>
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
