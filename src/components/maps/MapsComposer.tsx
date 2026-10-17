import { AnimatePresence, motion } from "motion/react";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShiningText } from "../ui/shining-text";
import type { ClyraPlace } from "../../../lib/maps/types";
import { prefetchPlaceDetail } from "./placeDetailCache";

const COMPOSER_EASE = [0.22, 1, 0.36, 1] as const;

interface MapsComposerProps {
  onSubmit: (text: string) => void;
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
export function MapsComposer({ onSubmit, onSuggestionPick, fetchSuggestions, thinking, thinkingLabel, placeholder }: MapsComposerProps) {
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

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    setOpen(false);
    onSubmit(text);
  };

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-40 w-[min(560px,92vw)] -translate-x-1/2">
      <motion.div
        layout
        transition={{ duration: 0.22, ease: COMPOSER_EASE }}
        className={
          "overflow-hidden rounded-[26px] border bg-white/95 backdrop-blur-xl transition-[border-color,box-shadow] duration-200 " +
          (focused
            ? "border-slate-300/90 shadow-[0_16px_44px_rgba(15,23,42,.18)]"
            : "border-slate-200/90 shadow-[0_12px_40px_rgba(15,23,42,.14)]")
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
              if (e.key === "Enter") submit();
              if (e.key === "Escape") {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
            placeholder={placeholder || "Search or ask Clyra — “Italian food on the way home”"}
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
          {open && suggestions.length > 0 && !thinking ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.16, ease: COMPOSER_EASE }}
              className="overflow-hidden border-t border-slate-100"
            >
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
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
