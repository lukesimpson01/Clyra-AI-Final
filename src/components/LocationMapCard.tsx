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

  const pad = 0.02;
  const bbox = [lon - pad, lat - pad * 0.75, lon + pad, lat + pad * 0.75].join(",");
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
  const openMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

  return (
    <div
      className={cn(
        "my-2 w-full max-w-xl overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/90 shadow-[0_18px_40px_rgba(15,23,42,0.05)]",
        className,
      )}
      data-invert-ignore
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <PinIcon />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-slate-800">{place}</p>
            {matchedFrom && !isCurrentLocation ? (
              <p className="truncate text-[11.5px] font-medium text-slate-400">Matched from "{matchedFrom}"</p>
            ) : (
              <p className="text-[11.5px] font-medium text-slate-400">{formatCoords(lat, lon)}</p>
            )}
          </div>
        </div>
        <a
          href={openMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition-colors hover:bg-slate-200"
        >
          <ExternalMapIcon />
          Open in Maps
        </a>
      </div>
      <div className="h-[220px] w-full bg-slate-100">
        <iframe
          title={`Map of ${place}`}
          src={embedSrc}
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
}
