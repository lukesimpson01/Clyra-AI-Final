import { AnimatePresence, motion } from "motion/react";
import { Clock, Loader2, MapPin, Search, MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShiningText } from "../ui/shining-text";
import type { ClyraPlace } from "../../../lib/maps/types";
import { prefetchPlaceDetail } from "./placeDetailCache";
import { formatDistance } from "./mapsIcons";
import { Highlight } from "./Highlight";
import "./maps-ui.css";

/** True when the text reads as a request rather than a place name, so it goes to the AI agent. */
export function looksConversational(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  if (t.split(/\s+/).length >= 5) return true;
  return /\b(best|cheapest|closest|nearest|on the way|along my route|open now|open late|plan|compare|recommend|should i|how (do|long|far)|take me|navigate)\b/.test(t);
}

function recentPlaces(): ClyraPlace[] {
  try {
    const v = JSON.parse(localStorage.getItem("clyra.recentPlaces") || "[]");
    return Array.isArray(v) ? v.slice(0, 5) : [];
  } catch {
    return [];
  }
}

const COMPOSER_EASE = [0.22, 1, 0.36, 1] as const;

interface MapsComposerProps {
  onSubmit: (text: string) => void;
  /** Plain place search: shows a results list instead of starting an AI conversation. */
  onSearch: (text: string) => void;
  onSuggestionPick: (place: ClyraPlace) => void;
  fetchSuggestions: (query: string) => Promise<ClyraPlace[]>;
  thinking: boolean;
  thinkingLabel: string;
  placeholder?: string;
  /** True while the dropdown is showing, so the rest of the map UI can step aside. */
  onOpenChange?: (open: boolean) => void;
}

/** Clyra Maps' floating search/AI bar. Matches Clyra Chat's composer
 * language (rounded pill, white surface, soft shadow, blur-in shimmer while
 * thinking) without depending on the chat-specific ClyraComposerShell, whose
 * state model is tightly coupled to the chat transcript. A single input
 * accepts both plain place lookups and natural-language requests — Clyra
 * decides which on the server, the user never picks a mode. */
export function MapsComposer({ onSubmit, onSearch, onSuggestionPick, fetchSuggestions, thinking, thinkingLabel, placeholder, onOpenChange }: MapsComposerProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<ClyraPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const requestRef = useRef(0);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      requestRef.current += 1;
      if (!q) setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const id = ++requestRef.current;
      const results = await fetchSuggestions(q);
      // a slower, older reply must never replace a newer one; the previous list stays until the new one is ready
      if (id === requestRef.current) setSuggestions(results.slice(0, 6));
    }, 160);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const submit = (forceAi = false) => {
    const text = value.trim();
    if (!text) return;
    setOpen(false);
    inputRef.current?.blur();
    if (forceAi || looksConversational(text)) onSubmit(text);
    else onSearch(text);
  };
  const recents = value.trim().length < 2 ? recentPlaces() : [];
  /* The dropdown's height follows its content on an ease, so a changing result list glides rather than jumps. */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [dropHeight, setDropHeight] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setDropHeight(el.offsetHeight));
    ro.observe(el);
    setDropHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  /* a new set of results fades in over the old instead of replacing it in one frame */
  const listKey = suggestions.map((p) => p.id).join("|") || "none";
  const showDrop = open && !thinking && (suggestions.length > 0 || recents.length > 0 || value.trim().length >= 2);
  useEffect(() => { onOpenChange?.(showDrop); }, [showDrop]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-root pointer-events-auto absolute left-4 top-4 z-40 w-[380px] max-w-[calc(100vw-32px)]">
      <motion.div
        className={
          "overflow-hidden rounded-[20px] bg-white transition-[box-shadow] duration-200 " +
          (focused
            ? "shadow-[0_0_0_1.5px_rgba(0,102,255,.4),0_1px_2px_rgba(16,18,24,.04),0_14px_36px_-14px_rgba(16,18,24,.22)]"
            : "shadow-[0_0_0_1px_rgba(16,18,24,.06),0_1px_2px_rgba(16,18,24,.04),0_14px_36px_-14px_rgba(16,18,24,.2)]")
        }
      >
        <div className="flex items-center gap-2.5 px-4 py-3">
          <AnimatePresence initial={false} mode="wait">
            {thinking ? (
              <motion.span key="loading" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }} className="shrink-0">
                <Loader2 className="h-[18px] w-[18px] animate-spin text-slate-400" />
              </motion.span>
            ) : (
              <motion.span key="search" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.14 }} className="shrink-0">
                <Search className={"h-[18px] w-[18px] transition-colors " + (focused ? "text-slate-500" : "text-slate-400")} />
              </motion.span>
            )}
          </AnimatePresence>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              setOpen(true);
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit(e.shiftKey || e.metaKey);
              if (e.key === "Escape") {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
            placeholder={placeholder || "Search places or ask Clyra"}
            className="h-6 min-w-0 flex-1 bg-transparent text-[14.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {value ? (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setValue("");
                setSuggestions([]);
                setOpen(false);
              }}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-90"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {thinking ? (
          <div className="border-t border-[rgba(16,18,24,.07)] px-4 py-2">
            <ShiningText text={thinkingLabel} className="text-[12.5px]" />
          </div>
        ) : null}

        <div className="mx-drop" data-open={showDrop} style={{ height: showDrop ? dropHeight : 0 }}>
          <div className="mx-drop__inner">
            <div className="mx-drop__body" ref={bodyRef}>
              <div className="mx-drop__list" key={listKey}>
              {recents.length ? <p className="px-4 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recents</p> : null}
              {recents.map((place) => (
                <button
                  key={`recent-${place.id}`}
                  type="button"
                  onMouseEnter={() => prefetchPlaceDetail(place)}
                  onClick={() => {
                    setOpen(false);
                    onSuggestionPick(place);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[#f3f4f6]"
                >
                  <Clock className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="block min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">{place.name}</span>
                </button>
              ))}
              {suggestions.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  onMouseEnter={() => prefetchPlaceDetail(place)}
                  onClick={() => {
                    setValue(place.name);
                    setOpen(false);
                    setSuggestions([]);
                    inputRef.current?.blur();
                    onSuggestionPick(place);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[#f3f4f6] active:scale-[0.99]"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#0d0d0d]"><Highlight text={place.name ?? ""} query={value} /></span>
                    {place.address || place.locality ? (
                      <span className="block truncate text-[12px] text-[#6b6f76]">
                        <Highlight text={[place.address, place.locality, place.region].filter(Boolean).join(", ")} query={value} />
                      </span>
                    ) : null}
                  </span>
                  {place.distanceMeters != null ? <span className="shrink-0 text-[11.5px] text-slate-400">{formatDistance(place.distanceMeters)}</span> : null}
                </button>
              ))}
              {value.trim().length >= 2 ? (
                <button type="button" onClick={() => submit(true)} className="flex w-full items-center gap-2.5 border-t border-[rgba(16,18,24,.07)] px-4 py-2.5 text-left transition-colors hover:bg-[#f3f4f6]">
                  <MessageCircle className="h-4 w-4 shrink-0 text-[#0066ff]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">Ask Clyra: “{value.trim()}”</span>
                </button>
              ) : null}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
