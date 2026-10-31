import { AnimatePresence, motion } from "motion/react";
import { Clock, Loader2, MapPin, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShiningText } from "../ui/shining-text";
import type { ClyraPlace } from "../../../lib/maps/types";
import { prefetchPlaceDetail } from "./placeDetailCache";
import { formatDistance } from "./mapsIcons";

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
}

/** Clyra Maps' floating search/AI bar. Matches Clyra Chat's composer
 * language (rounded pill, white surface, soft shadow, blur-in shimmer while
 * thinking) without depending on the chat-specific ClyraComposerShell, whose
 * state model is tightly coupled to the chat transcript. A single input
 * accepts both plain place lookups and natural-language requests — Clyra
 * decides which on the server, the user never picks a mode. */
export function MapsComposer({ onSubmit, onSearch, onSuggestionPick, fetchSuggestions, thinking, thinkingLabel, placeholder }: MapsComposerProps) {
  const [value, setValue] = useState("");
  const [suggestions, setSuggestions] = useState<ClyraPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const results = await fetchSuggestions(q);
      setSuggestions(results.slice(0, 6));
    }, 120);
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

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-40 w-[380px] max-w-[calc(100vw-32px)]">
      <motion.div
        layout
        transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
        className={
          "overflow-hidden rounded-[24px] bg-white transition-[box-shadow] duration-200 " +
          (focused
            ? "shadow-[0_1px_1px_rgba(16,18,24,0.03),0_10px_24px_-8px_rgba(16,18,24,0.15),0_30px_60px_-28px_rgba(16,18,24,0.28),inset_0_0_0_1px_rgba(30,111,255,0.22)]"
            : "shadow-[0_1px_1px_rgba(16,18,24,0.03),0_8px_20px_-8px_rgba(16,18,24,0.12),0_28px_56px_-28px_rgba(16,18,24,0.24),inset_0_0_0_1px_rgba(16,18,24,0.06)]")
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
          <div className="border-t border-slate-100 px-4 py-2">
            <ShiningText text={thinkingLabel} className="text-[12.5px]" />
          </div>
        ) : null}

        <AnimatePresence>
          {open && (suggestions.length > 0 || recents.length > 0 || value.trim().length >= 2) && !thinking ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: COMPOSER_EASE }}
              className="overflow-hidden border-t border-slate-100"
            >
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
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
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
                    onSuggestionPick(place);
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 active:scale-[0.99]"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-900">{place.name}</span>
                    {place.address || place.locality ? (
                      <span className="block truncate text-[11.5px] text-slate-500">
                        {[place.address, place.locality, place.region].filter(Boolean).join(", ")}
                      </span>
                    ) : null}
                  </span>
                  {place.distanceMeters != null ? <span className="shrink-0 text-[11.5px] text-slate-400">{formatDistance(place.distanceMeters)}</span> : null}
                </button>
              ))}
              {value.trim().length >= 2 ? (
                <button type="button" onClick={() => submit(true)} className="flex w-full items-center gap-2.5 border-t border-slate-100 px-4 py-2.5 text-left transition-colors hover:bg-slate-50">
                  <Sparkles className="h-4 w-4 shrink-0 text-[#3b82f6]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-900">Ask Clyra: “{value.trim()}”</span>
                </button>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
