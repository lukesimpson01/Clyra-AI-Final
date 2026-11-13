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

/** Numbered result rows synced with the numbered pins on the map: hovering a row lights its pin and back. */
export function PlaceResultsList({ places, hoveredId, onHover, onHoverPrefetch, onSelect, title }: PlaceResultsListProps) {
  if (!places.length) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mx-sheet mx-sheet--auto"
      aria-label="Results"
    >
      <div className="mx-head" style={{ paddingBottom: 6 }}>
        <div className="min-w-0">
          <p className="mx-eyebrow">{places.length} place{places.length === 1 ? "" : "s"}</p>
          {title ? <h3 className="mx-title capitalize">{title}</h3> : null}
        </div>
      </div>
      <ul className="mx-scroll" style={{ padding: "0 6px 8px", margin: 0, listStyle: "none" }}>
        {places.map((place, i) => (
          <li key={place.id}>
            <button
              type="button"
              className="mx-row"
              data-hover={hoveredId === place.id}
              onMouseEnter={() => { onHover(place.id); onHoverPrefetch?.(place); }}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(place)}
            >
              <span className="mx-num">{i + 1}</span>
              <span className="mx-row__body">
                <span className="mx-row__title">{place.name}</span>
                <span className="mx-row__meta">
                  {place.categories[0] ? <span className="capitalize">{place.categories[0].replace(/_/g, " ")}</span> : null}
                  {typeof place.distanceMeters === "number" ? (
                    <span className="inline-flex items-center gap-1"><MapPin size={11} /> {formatDistance(place.distanceMeters)}</span>
                  ) : null}
                  {typeof place.detourSeconds === "number" ? (
                    <span className="inline-flex items-center gap-1" style={{ color: "var(--mx-accent-ink)" }}><Clock size={11} /> +{Math.round(place.detourSeconds / 60)} min</span>
                  ) : null}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
