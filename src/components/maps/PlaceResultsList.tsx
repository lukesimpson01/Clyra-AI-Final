import { motion } from "motion/react";
import { Clock, MapPin } from "lucide-react";
import type { ClyraPlace } from "../../../lib/maps/types";
import { formatDistance } from "./mapsIcons";

interface PlaceResultsListProps {
  places: ClyraPlace[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  /** Warms the detail cache ahead of a click, so the sheet opens pre-loaded. */
  onHoverPrefetch?: (place: ClyraPlace) => void;
  onSelect: (place: ClyraPlace) => void;
  title?: string;
}

/** Numbered result cards synced with the numbered pins MapController draws
 * on the map — hovering a card highlights its pin and vice versa. */
export function PlaceResultsList({ places, hoveredId, onHover, onHoverPrefetch, onSelect, title }: PlaceResultsListProps) {
  if (!places.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto absolute bottom-4 left-4 z-20 max-h-[60vh] w-[300px] overflow-y-auto rounded-2xl border border-slate-200/90 bg-white/95 shadow-[0_12px_40px_rgba(15,23,42,.14)] backdrop-blur-xl"
    >
      {title ? (
        <div className="sticky top-0 border-b border-slate-100 bg-white/95 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
          {title}
        </div>
      ) : null}
      <ul>
        {places.map((place, i) => (
          <li key={place.id}>
            <button
              type="button"
              onMouseEnter={() => {
                onHover(place.id);
                onHoverPrefetch?.(place);
              }}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(place)}
              className={
                "flex w-full items-start gap-2.5 border-b border-slate-50 px-4 py-3 text-left transition-colors last:border-b-0 active:scale-[0.99] " +
                (hoveredId === place.id ? "bg-slate-50" : "hover:bg-slate-50")
              }
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-[#3b82f6] text-[10px] font-bold text-slate-900">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-slate-900">{place.name}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-slate-500">
                  {place.categories[0] ? <span className="capitalize">{place.categories[0].replace(/_/g, " ")}</span> : null}
                  {typeof place.distanceMeters === "number" ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> {formatDistance(place.distanceMeters)}
                    </span>
                  ) : null}
                  {typeof place.detourSeconds === "number" ? (
                    <span className="inline-flex items-center gap-1 text-[#3b82f6]">
                      <Clock className="h-3 w-3" /> +{Math.round(place.detourSeconds / 60)} min
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
