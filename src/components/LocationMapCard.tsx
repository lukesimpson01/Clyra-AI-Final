import { cn } from "../lib/utils";

export type MapLocationPayload = {
  name: string;
  region?: string;
  country?: string;
  lat: number;
  lon: number;
  isCurrentLocation?: boolean;
  matchedFrom?: string;
};

function ExternalMapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
      <path d="M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s-6.5-6.14-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.86-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

function formatCoords(lat: number, lon: number) {
  const latLabel = `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"}`;
  const lonLabel = `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
  return `${latLabel}, ${lonLabel}`;
}

/** The interactive OpenStreetMap view of a place (marker included), with its attribution and a link out. */
export function MapPanel({ lat, lon, title, height = 220, zoom = 0.02 }: { lat: number; lon: number; title: string; height?: number; zoom?: number }) {
  const bbox = [lon - zoom, lat - zoom * 0.75, lon + zoom, lat + zoom * 0.75].join(",");
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
  const openMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  return (
    <div className="relative w-full overflow-hidden bg-slate-100" style={{ height }}>
      <iframe title={`Map of ${title}`} src={embedSrc} className="h-full w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      <a
        href={openMapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-9 left-3 flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[12px] font-medium text-slate-700 shadow-[0_2px_10px_rgba(15,23,42,0.12)] backdrop-blur transition-colors hover:bg-white"
      >
        <ExternalMapIcon />
        Open in Maps
      </a>
    </div>
  );
}

export function LocationMapCard({
  location,
  className,
}: {
  location: MapLocationPayload;
  className?: string;
}) {
  const { name, region, country, lat, lon, isCurrentLocation, matchedFrom } = location;

  const place = isCurrentLocation
    ? name
      ? `Current location · ${name}`
      : "Current location"
    : [name, region, country].filter(Boolean).join(", ");

  return (
    <div
      className={cn(
        "my-2 w-full max-w-xl overflow-hidden rounded-[26px] border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_44px_-18px_rgba(15,23,42,0.18)]",
        className,
      )}
      data-invert-ignore
    >
      <div className="flex items-center gap-3 px-5 pb-3 pt-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <PinIcon />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-[-0.015em] text-slate-900">{place}</p>
          <p className="truncate text-[12px] text-slate-400">
            {matchedFrom && !isCurrentLocation ? `Matched from “${matchedFrom}”` : formatCoords(lat, lon)}
          </p>
        </div>
      </div>
      <MapPanel lat={lat} lon={lon} title={place} height={240} />
      <p className="px-5 py-2 text-[10.5px] text-slate-400">© OpenStreetMap contributors</p>
    </div>
  );
}
