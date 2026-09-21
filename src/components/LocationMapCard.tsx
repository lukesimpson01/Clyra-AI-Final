import { useMemo, useState } from "react";
import { Check, Copy, MapPin, Navigation, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

/** A verified result from the Clyra Maps geocoder. */
export type LocationMapPlace = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  types?: string[];
};

function formatCoordinate(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
}

/**
 * A small, self-contained map preview for a chat response. It deliberately
 * does not embed a third-party map tile: the pin comes only from Clyra Maps'
 * verified geocoder, and the full interactive map remains available on demand.
 */
export function LocationMapCard({
  places,
  onOpenMaps,
  className,
}: {
  places: LocationMapPlace[];
  onOpenMaps?: (place: LocationMapPlace) => void;
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const visiblePlaces = places.slice(0, 5);
  const active = visiblePlaces[Math.min(activeIndex, visiblePlaces.length - 1)];

  const pinPositions = useMemo(() => {
    if (visiblePlaces.length === 1) return [{ x: 52, y: 49 }];
    const lats = visiblePlaces.map((place) => place.lat);
    const lngs = visiblePlaces.map((place) => place.lng);
    const latRange = Math.max(...lats) - Math.min(...lats) || 1;
    const lngRange = Math.max(...lngs) - Math.min(...lngs) || 1;
    return visiblePlaces.map((place) => ({
      x: 16 + ((place.lng - Math.min(...lngs)) / lngRange) * 68,
      y: 78 - ((place.lat - Math.min(...lats)) / latRange) * 56,
    }));
  }, [visiblePlaces]);

  if (!active) return null;
  const coordinateText = `${formatCoordinate(active.lat, "N", "S")}, ${formatCoordinate(active.lng, "E", "W")}`;

  const copyCoordinates = async () => {
    try {
      await navigator.clipboard?.writeText(`${active.lat.toFixed(6)}, ${active.lng.toFixed(6)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access is optional in browser previews; the coordinates remain visible.
    }
  };

  return (
    <section
      className={cn(
        "my-2 w-full max-w-xl overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/90 shadow-[0_18px_40px_rgba(15,23,42,0.05)]",
        className,
      )}
      data-invert-ignore
      aria-label={`Clyra Maps map for ${active.name}`}
    >
      <div className="relative h-[166px] overflow-hidden border-b border-slate-100 bg-[#edf5ff]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 220" preserveAspectRatio="none" aria-hidden>
          <defs>
            <pattern id="clyra-map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
              <path d="M 28 0 L 0 0 0 28" fill="none" stroke="#c8dbef" strokeWidth="0.8" opacity="0.68" />
            </pattern>
            <linearGradient id="clyra-map-wash" x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="#e9f5ff" />
              <stop offset="1" stopColor="#f7fbff" />
            </linearGradient>
          </defs>
          <rect width="600" height="220" fill="url(#clyra-map-wash)" />
          <rect width="600" height="220" fill="url(#clyra-map-grid)" />
          <path d="M-20 184 C94 143 132 185 224 139 S389 96 465 116 S548 102 630 33" fill="none" stroke="#b5cce5" strokeWidth="12" opacity=".56" />
          <path d="M-20 184 C94 143 132 185 224 139 S389 96 465 116 S548 102 630 33" fill="none" stroke="#fff" strokeWidth="5.5" opacity=".9" />
          <path d="M54 -16 C88 54 112 71 198 93 S311 141 345 236" fill="none" stroke="#c4d7eb" strokeWidth="8" opacity=".65" />
          <path d="M54 -16 C88 54 112 71 198 93 S311 141 345 236" fill="none" stroke="#fff" strokeWidth="3.5" opacity=".92" />
          <path d="M266 -16 L346 236M442 -16L512 236M-18 58L620 161" fill="none" stroke="#d2e2f1" strokeWidth="3" opacity=".9" />
        </svg>
        <div className="absolute left-4 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-[10px] font-semibold tracking-[0.02em] text-slate-600 shadow-sm backdrop-blur">
          <Sparkles className="h-3 w-3 text-[var(--accent-600,#3269db)]" />
          Clyra Maps
        </div>
        <div className="absolute bottom-3 right-4 rounded-md bg-white/70 px-1.5 py-1 font-mono text-[9px] font-medium text-slate-500 backdrop-blur">N ↑</div>
        {pinPositions.map((position, index) => {
          const selected = index === activeIndex;
          return (
            <button
              key={`${visiblePlaces[index].lat}-${visiblePlaces[index].lng}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className="group absolute -translate-x-1/2 -translate-y-full outline-none"
              style={{ left: `${position.x}%`, top: `${position.y}%` }}
              aria-label={`Show ${visiblePlaces[index].name}`}
            >
              <span className={cn("grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-[var(--accent-600,#3269db)] text-white shadow-[0_6px_16px_rgba(37,99,235,.32)] transition-transform", selected ? "scale-110" : "scale-90 opacity-85 group-hover:scale-100")}>
                <MapPin className="h-4 w-4" fill="currentColor" strokeWidth={2.25} />
              </span>
              <span className="mx-auto block h-2.5 w-2.5 -translate-y-1 rotate-45 border-b-2 border-r-2 border-white bg-[var(--accent-600,#3269db)]" />
            </button>
          );
        })}
      </div>

      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Verified location</p>
            <h3 className="mt-1 truncate text-[16px] font-semibold tracking-[-0.02em] text-slate-900">{active.name}</h3>
            <p className="mt-1 line-clamp-2 text-[12px] font-medium leading-relaxed text-slate-500">{active.address}</p>
          </div>
          <button type="button" onClick={() => void copyCoordinates()} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[10.5px] font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700" title="Copy coordinates">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Coords"}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-[10.5px] font-medium text-slate-400">{coordinateText}</span>
          <button type="button" onClick={() => onOpenMaps?.(active)} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-600,#3269db)] px-3 py-1.5 text-[10.5px] font-semibold text-white shadow-sm transition hover:brightness-95 active:scale-[.98]">
            <Navigation className="h-3.5 w-3.5" /> Open in Maps
          </button>
        </div>
        {visiblePlaces.length > 1 ? <div className="mt-4 flex gap-1.5 overflow-x-auto pb-0.5">{visiblePlaces.map((place, index) => <button key={`${place.name}-${index}`} type="button" onClick={() => setActiveIndex(index)} className={cn("max-w-[130px] truncate rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors", index === activeIndex ? "bg-blue-50 text-[var(--accent-700,#2452b6)]" : "bg-slate-50 text-slate-500 hover:bg-slate-100")}>{place.name}</button>)}</div> : null}
      </div>
    </section>
  );
}
