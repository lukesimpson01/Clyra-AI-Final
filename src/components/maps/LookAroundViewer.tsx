import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Coordinate } from "../../../lib/maps/types";

interface StreetShot {
  id: string;
  provider: string;
  url: string;
  thumbnailUrl?: string;
  distanceMeters?: number;
  takenAt?: string;
  license?: string;
  sourcePage?: string;
}

/** Full-screen street-level viewer (open imagery from Panoramax and KartaView).
 * Arrow keys / buttons step through nearby captures, nearest first. */
export function LookAroundViewer({ coordinates, title, onClose }: { coordinates: Coordinate; title?: string; onClose: () => void }) {
  const [shots, setShots] = useState<StreetShot[] | null>(null);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    setShots(null);
    setIndex(0);
    fetch("/api/maps/street-imagery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates }),
    })
      .then((r) => r.json())
      .then((d) => live && setShots(Array.isArray(d.images) ? d.images : []))
      .catch(() => live && setShots([]));
    return () => {
      live = false;
    };
  }, [coordinates]);

  const step = useCallback((d: number) => shots?.length && (setLoaded(false), setIndex((i) => (i + d + shots.length) % shots.length)), [shots]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const shot = shots?.[index];
  return (
    <div role="dialog" aria-label="Look Around" className="absolute inset-0 z-50 flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between px-5 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/50">Look Around</p>
          <p className="truncate text-[14px] font-semibold">{title || "Street-level view"}</p>
        </div>
        <button type="button" aria-label="Close Look Around" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {shots === null ? (
          <div className="grid h-full place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/70" />
          </div>
        ) : !shot ? (
          <div className="grid h-full place-items-center text-center text-white/70">
            <div>
              <ImageOff className="mx-auto mb-2 h-8 w-8" />
              <p className="text-[14px]">No open street-level imagery near here.</p>
              <p className="text-[12px] text-white/50">Coverage comes from community captures and varies by area.</p>
            </div>
          </div>
        ) : (
          <>
            {!loaded ? <Loader2 className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/60" /> : null}
            <img key={shot.id} src={shot.url} alt={`Street view ${index + 1}`} onLoad={() => setLoaded(true)} className={"h-full w-full object-contain transition-opacity duration-200 " + (loaded ? "opacity-100" : "opacity-0")} />
            {shots.length > 1 ? (
              <>
                <button type="button" aria-label="Previous image" onClick={() => step(-1)} className="absolute left-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25">
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button type="button" aria-label="Next image" onClick={() => step(1)} className="absolute right-4 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 hover:bg-white/25">
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </>
        )}
      </div>

      {shot ? (
        <div className="px-5 pb-4 pt-3">
          {shots && shots.length > 1 ? (
            <div className="mb-2 flex gap-2 overflow-x-auto [scrollbar-width:none]">
              {shots.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`Image ${i + 1}`}
                  onClick={() => {
                    setLoaded(false);
                    setIndex(i);
                  }}
                  className={"h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 " + (i === index ? "border-white" : "border-transparent opacity-60 hover:opacity-100")}
                >
                  <img src={s.thumbnailUrl || s.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-[12px] text-white/60">
            {shot.distanceMeters != null ? `${Math.round(shot.distanceMeters)} m away · ` : ""}
            {shot.takenAt ? `Taken ${new Date(shot.takenAt).toLocaleDateString()} · ` : ""}
            {shot.license ? `${shot.license} · ` : ""}
            {shot.sourcePage ? (
              <a href={shot.sourcePage} target="_blank" rel="noopener noreferrer" className="underline">
                {shot.provider}
              </a>
            ) : (
              shot.provider
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
