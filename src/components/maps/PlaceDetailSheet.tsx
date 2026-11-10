import { motion, AnimatePresence } from "motion/react";
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Clock, Compass, ExternalLink, Globe, ImageOff, Eye, MapPin, Navigation2, Phone, Share2, Sparkles, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { PlaceLibraryMenu } from "./PlaceLibraryMenu";
import { PlaceConditions } from "./PlaceConditions";
import { ShiningText } from "../ui/shining-text";
import type { ClyraPlace, Route } from "../../../lib/maps/types";
import { formatDistance, formatDuration } from "./mapsIcons";
import { openingState } from "../../../lib/maps/openingHours";
import { PhotoCarousel, type CarouselPhoto } from "./PhotoCarousel";
import { getPlaceDetail, getPlaceWeb, peekPlaceDetail, prefetchPlaceDetail, type PlaceEnrichResult, type PlaceWebResult, type PlaceInfoResult, type PlaceReviewsResult, type StreetImage } from "./placeDetailCache";

interface PlaceDetailSheetProps {
  place: ClyraPlace;
  identifying: boolean;
  nearby: ClyraPlace[];
  route: Route | null;
  routeLoading: boolean;
  onClose: () => void;
  onStart: () => void;
  onDirections: (place: ClyraPlace) => void;
  onSelectNearby: (place: ClyraPlace) => void;
  onAskClyra: (place: ClyraPlace) => void;
  onNearby: (place: ClyraPlace) => void;
}

/** Satellite backdrop centred on the place, used when it has no photos: a 3×3 grid of
 * imagery tiles positioned so the exact point sits in the middle of the hero. */
function SatelliteHero({ coordinates }: { coordinates: [number, number] }) {
  const z = 17;
  const n = 2 ** z;
  const fx = ((coordinates[0] + 180) / 360) * n;
  const latRad = (coordinates[1] * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const left = 204 - (1 + (fx - tx)) * 256;
  const top = 115 - (1 + (fy - ty)) * 256;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#dfe6dc]" aria-hidden>
      <div className="absolute" style={{ left, top, width: 768, height: 768 }}>
        {[-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map((dx) => (
            <img
              key={`${dx}-${dy}`}
              src={`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty + dy}/${tx + dx}`}
              alt=""
              draggable={false}
              className="absolute h-[256px] w-[256px]"
              style={{ left: (dx + 1) * 256, top: (dy + 1) * 256 }}
            />
          )),
        )}
      </div>
      <span className="absolute left-1/2 top-[115px] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-[#ea4335] shadow-md" />
    </div>
  );
}

/** Google-style round action: a tinted circle with a label underneath. */
function CircleAction({ label, onClick, primary, pressed, children }: { label: string; onClick: () => void; primary?: boolean; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} className="group flex w-[60px] flex-col items-center gap-1.5 text-[11.5px] font-medium text-[#3a3d44] outline-none">
      <span className={"grid h-11 w-11 place-items-center rounded-full transition-all duration-150 group-hover:scale-105 group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-blue-400 " + (primary ? "bg-[#0066ff] text-white shadow-[0_6px_14px_-6px_rgba(0,102,255,.6)]" : pressed ? "bg-[#0066ff]/12 text-[#0052cc]" : "bg-[#f3f4f6] text-[#3a3d44] group-hover:bg-[#eceef1]")}>{children}</span>
      {label}
    </button>
  );
}

const SAVED_KEY = "clyra.savedPlaces";
const EASE = [0.22, 1, 0.36, 1] as const;

function readSaved(): ClyraPlace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSaved(list: ClyraPlace[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    // Storage unavailable (private window): the save simply isn't remembered.
  }
}

/** The public OSM page for this object, or a map link for points. Used by Share. */
function shareUrlFor(place: ClyraPlace): string {
  const [lng, lat] = place.coordinates;
  const osm = place.id.match(/^osm-(node|way|relation)-(\d+)/);
  if (osm) return `https://www.openstreetmap.org/${osm[1]}/${osm[2]}`;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Entrance for a section that appears once its data resolves and then just
 * stays mounted across place switches — the fade plays on first reveal only,
 * never replays while the user is clicking through results. */
function reveal(index = 0) {
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, ease: EASE, delay: Math.min(index * 0.035, 0.18) },
  };
}

/** Google-Maps-style place panel on the left. Sections render only when a real
 * source supplied them. Opening state comes from parsed OSM hours; unparseable
 * hours hide the state rather than guessing. */
export function PlaceDetailSheet({ place, identifying, nearby, route, routeLoading, onClose, onStart, onDirections, onSelectNearby, onAskClyra, onNearby }: PlaceDetailSheetProps) {
  const isPin = place.id.startsWith("pin-");
  const [info, setInfo] = useState<PlaceInfoResult | null>(null);
  const [enrich, setEnrich] = useState<PlaceEnrichResult | null>(null);
  const [web, setWeb] = useState<PlaceWebResult | null>(null);
  const [webLoading, setWebLoading] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [weekOpen, setWeekOpen] = useState(false);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [reviews, setReviews] = useState<PlaceReviewsResult | null>(null);
  const [reviewsChecked, setReviewsChecked] = useState(false);
  const [streetImages, setStreetImages] = useState<StreetImage[] | null>(null);
  const [streetIndex, setStreetIndex] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // Each selection starts clean. A place already warmed by a hover prefetch
  // (or a prior visit) hydrates straight from cache — no skeleton flash — while
  // the fetch still runs so the cache itself stays correct for next time.
  useEffect(() => {
    let cancelled = false;
    setPhotoIndex(0);
    setFailedPhotos([]);
    setWeb(null);
    setWebLoading(!place.id.startsWith("pin-"));
    setWeekOpen(false);
    setStreetIndex(null);
    setShareNote(null);
    setSaved(readSaved().some((p) => p.id === place.id));

    const cached = peekPlaceDetail(place);
    if (cached) {
      setInfo(cached.info);
      setEnrich(cached.enrich);
      setLoadingInfo(false);
      setReviews(cached.reviews);
      setReviewsChecked(cached.reviewsChecked);
      setStreetImages(cached.streetImages);
    } else {
      setInfo(null);
      setEnrich(null);
      setLoadingInfo(true);
      setReviews(null);
      setReviewsChecked(false);
      setStreetImages(null);
    }

    getPlaceDetail(place).then((bundle) => {
      if (cancelled) return;
      setInfo(bundle.info);
      setEnrich(bundle.enrich);
      setLoadingInfo(false);
      setReviews(bundle.reviews);
      setReviewsChecked(bundle.reviewsChecked);
      setStreetImages(bundle.streetImages);
    });

    void getPlaceWeb(place).then((result) => {
      if (cancelled) return;
      setWeb(result);
      setWebLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [place.id, place.name, place.coordinates, isPin]);

  const photos = info?.photos ?? [];
  const photo = photos[photoIndex];
  /* the carousel: the best-sourced pictures first, street imagery last and labelled as such; any that fail to load drop out */
  const slides: CarouselPhoto[] = useMemo(() => {
    const base: CarouselPhoto[] = enrich?.photos?.length
      ? enrich.photos
      : (info?.photos ?? []).map((p) => ({ url: p.url, source: p.attribution?.split(" · ")[0] || "Wikimedia Commons", caption: p.attribution }));
    const street: CarouselPhoto[] = (streetImages ?? []).slice(0, 1).map((st) => ({ url: st.url, source: `Street view · ${st.provider}`, caption: st.takenAt ? `Taken ${new Date(st.takenAt).toLocaleDateString()}` : st.license, link: st.sourcePage }));
    return [...base, ...street].filter((p) => !failedPhotos.includes(p.url));
  }, [enrich, info, streetImages, failedPhotos]);
  const weekly = enrich?.hours?.weekly ?? web?.hours?.weekly;
  const hoursSource = enrich?.hours?.source ?? web?.hours?.source;
  const ratings = useMemo(() => {
    const merged = [...(enrich?.ratings ?? [])];
    for (const r of web?.ratings ?? []) if (!merged.some((m) => m.source === r.source)) merged.push(r);
    return merged;
  }, [enrich, web]);
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const category = place.categories[0]?.replace(/_/g, " ");
  const addressLine = place.address
    ? [place.address, place.locality, place.region].filter(Boolean).join(", ")
    : [place.locality, place.region].filter(Boolean).join(", ");
  const [lng, lat] = place.coordinates;
  const hours = useMemo(() => openingState(place.openingHours?.raw), [place.openingHours?.raw, place.id]);
  const hoursLines = place.openingHours?.raw ? place.openingHours.raw.split(";").map((s) => s.trim()).filter(Boolean) : [];
  const heroLoading = loadingInfo || identifying;
  const hasDetailLines = Boolean(addressLine || isPin || hoursLines.length || place.phone || place.website || !isPin);

  const toggleSave = () => {
    const current = readSaved();
    const next = saved ? current.filter((p) => p.id !== place.id) : [{ ...place, sourceLinks: place.sourceLinks ?? [] }, ...current];
    writeSaved(next);
    setSaved(!saved);
  };

  const share = async () => {
    const url = shareUrlFor(place);
    const title = place.name ?? "Place";
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        setShareNote(null);
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied");
    } catch {
      setShareNote("Couldn't share right now");
    }
  };

  const streetImage = streetIndex != null && streetImages ? streetImages[streetIndex] : null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.26, ease: EASE }}
      aria-label={`${place.name ?? "Place"} details`}
      className="mx-sheet !top-[72px]"
    >
      {slides.length ? (
        <div className="relative shrink-0">
          <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-[#3a3d44] shadow-[0_0_0_1px_rgba(16,18,24,.06),0_4px_12px_-4px_rgba(16,18,24,.25)] transition-transform hover:bg-white hover:text-[#0d0d0d] active:scale-90">
            <X className="h-4 w-4" />
          </button>
          <PhotoCarousel photos={slides} alt={place.name ?? "Place"} onFail={(url) => setFailedPhotos((f) => (f.includes(url) ? f : [...f, url]))} />
        </div>
      ) : (
      <div className="relative h-[190px] w-full shrink-0 overflow-hidden bg-[#f1f2f4]">
        
        <AnimatePresence initial={false}>
          {photo ? (
            <motion.img
              key={`photo-${photo.url}`}
              src={photo.url}
              alt={place.name ?? ""}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : streetImages?.length ? (
            <motion.img
              key={`street-${streetImages[0].url}`}
              src={streetImages[0].url}
              alt={`Street imagery near ${place.name ?? "this point"}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE }}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : heroLoading ? (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#f4f1ea] to-[#ece6d8]"
            >
              <motion.div
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent"
                animate={{ x: ["-100%", "300%"] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
              />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0">
              <SatelliteHero coordinates={place.coordinates} />
            </motion.div>
          )}
        </AnimatePresence>

        {photo && photos.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
              className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white text-slate-700 shadow transition-transform hover:bg-white active:scale-90"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white text-slate-700 shadow transition-transform hover:bg-white active:scale-90"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white">
              {photoIndex + 1} / {photos.length}
            </span>
          </>
        ) : null}
        {photo?.attribution ? <span className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">{photo.attribution}</span> : null}
        {!photo && streetImages?.length ? (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">Street imagery · {streetImages[0].provider}</span>
        ) : null}

        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-[#3a3d44] shadow-[0_0_0_1px_rgba(16,18,24,.06),0_4px_12px_-4px_rgba(16,18,24,.25)] transition-transform hover:bg-white hover:text-[#0d0d0d] active:scale-90">
          <X className="h-4 w-4" />
        </button>
      </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-3 pt-4">
          {identifying && isPin ? (
            <div className="space-y-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#0d0d0d]">{place.name}</h3>
                <PlaceConditions coordinates={place.coordinates} compact />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12.5px] text-slate-500">
                {isPin ? null : category ? <span className="capitalize">{category}</span> : null}
                {typeof place.distanceMeters === "number" ? <span>· {formatDistance(place.distanceMeters)} away</span> : null}
              </p>
              {reviews ? (
                <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-slate-600">
                  <Star className="h-3.5 w-3.5 fill-[#f59e0b] text-[#f59e0b]" />
                  <span className="font-semibold text-slate-900">{reviews.rating?.toFixed(1)}</span>
                  <span>· {reviews.count} open review{reviews.count === 1 ? "" : "s"}</span>
                </p>
              ) : null}
              {hours.state !== "unknown" ? (
                <p className="mt-1 text-[12.5px] font-medium">
                  {hours.state === "open" ? <span className="text-[#15803d]">Open</span> : null}
                  {hours.state === "open" ? <span className="text-slate-500"> · Closes {hours.closesAt}</span> : null}
                  {hours.state === "open24" ? <span className="text-[#15803d]">Open 24 hours</span> : null}
                  {hours.state === "closed" ? <span className="text-[#b91c1c]">Closed</span> : null}
                  {hours.state === "closed" && hours.opensAt ? <span className="text-slate-500"> · Opens {hours.opensAt}{hours.opensOn ? ` ${hours.opensOn}` : ""}</span> : null}
                </p>
              ) : null}
            </motion.div>
          )}

          {route ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#f3f4f6] px-3 py-2.5">
              <div>
                <p className="text-[18px] font-bold leading-none text-slate-950">{formatDuration(route.durationSeconds)}</p>
                <p className="mt-1 text-[12px] text-slate-500">{formatDistance(route.distanceMeters)} · fastest route</p>
              </div>
              <button type="button" className="mx-btn mx-btn--primary" onClick={onStart}>
                <Navigation2 className="h-4 w-4" /> Start
              </button>
            </div>
          ) : routeLoading ? (
            <div className="mt-3 text-[12.5px]"><ShiningText text="Finding the route…" className="text-[12.5px]" /></div>
          ) : isPin && !identifying ? (
            <div className="mt-3">
              <button type="button" className="mx-btn mx-btn--primary" onClick={() => onDirections(place)}>
                <Navigation2 className="h-4 w-4" /> Directions
              </button>
            </div>
          ) : null}

          {!identifying ? (
            <div className="mt-4 flex items-start justify-between gap-1" role="toolbar" aria-label="Place actions">
              {!isPin ? <CircleAction label="Directions" primary onClick={() => onDirections(place)}><Navigation2 className="h-[18px] w-[18px]" /></CircleAction> : null}
              <CircleAction label={saved ? "Saved" : "Save"} pressed={saved} onClick={toggleSave}>
                {saved ? <BookmarkCheck className="h-[18px] w-[18px]" /> : <Bookmark className="h-[18px] w-[18px]" />}
              </CircleAction>
              <CircleAction label="Nearby" onClick={() => onNearby(place)}><Compass className="h-[18px] w-[18px]" /></CircleAction>
              <PlaceLibraryMenu place={place} variant="circle" />
              {place.phone ? <CircleAction label="Call" onClick={() => window.open(`tel:${place.phone}`)}><Phone className="h-[18px] w-[18px]" /></CircleAction> : null}
              {place.website ? <CircleAction label="Website" onClick={() => window.open(place.website, "_blank", "noopener,noreferrer")}><Globe className="h-[18px] w-[18px]" /></CircleAction> : null}
              <CircleAction label="Share" onClick={share}><Share2 className="h-[18px] w-[18px]" /></CircleAction>
            </div>
          ) : null}
          {shareNote ? <p className="mt-2 text-[12px] text-slate-500">{shareNote}</p> : null}
        </div>

        {!identifying && hasDetailLines ? (
          <motion.div {...reveal(0)} className="space-y-2.5 border-t border-slate-100 px-4 py-3 text-[13px] text-slate-700">
            {addressLine ? (
              <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{addressLine}</span></p>
            ) : null}
            {isPin ? (
              <p className={addressLine ? "pl-[22px] text-[12px] text-slate-500" : "flex items-start gap-2"}>
                {addressLine ? null : <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />}
                <span className={addressLine ? "" : "text-[12px] text-slate-500"}>{lat.toFixed(6)}, {lng.toFixed(6)}</span>
              </p>
            ) : null}
            {weekly?.length || hoursLines.length ? (
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => setWeekOpen((v) => !v)} aria-expanded={weekOpen} className="flex w-full items-center gap-2 text-left">
                    {hours.state === "open" ? <span className="mx-pill" data-tone="ok">Open · until {hours.closesAt}</span> : null}
                    {hours.state === "open24" ? <span className="mx-pill" data-tone="ok">Open 24 hours</span> : null}
                    {hours.state === "closed" ? <span className="mx-pill" data-tone="bad">Closed{hours.opensAt ? ` · opens ${hours.opensAt}${hours.opensOn ? ` ${hours.opensOn}` : ""}` : ""}</span> : null}
                    {hours.state === "unknown" && weekly?.length ? <span className="text-slate-700">{weekly.find((d) => d.day === todayName)?.text ?? "Hours"}</span> : null}
                    <span className="ml-auto text-[12px] font-semibold text-[#0052cc]">{weekOpen ? "Hide hours" : "All hours"}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {weekOpen ? (
                      <motion.ul
                        key="week"
                        className="mx-week"
                        style={{ overflow: "hidden" }}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.26, ease: EASE }}
                      >
                        {weekly?.length
                          ? weekly.map((d) => <li key={d.day} data-today={d.day === todayName}><span>{d.day}</span><span>{d.text}</span></li>)
                          : hoursLines.map((line) => <li key={line}><span>{line}</span></li>)}
                      </motion.ul>
                    ) : null}
                  </AnimatePresence>
                  {hoursSource ? <p className="mt-1 text-[10.5px] text-slate-400">Hours from {hoursSource}</p> : null}
                </div>
              </div>
            ) : null}
            {!isPin && !weekly?.length && !hoursLines.length ? (
              <p className="flex items-center gap-2 text-slate-500">
                <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                {webLoading ? <ShiningText text="Checking opening hours…" className="text-[13px]" /> : <span>Opening hours not published</span>}
              </p>
            ) : null}
            {place.phone ? <p className="flex items-start gap-2"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{place.phone}</span></p> : null}
            {place.website ? (
              <p className="flex items-start gap-2">
                <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <a href={place.website} target="_blank" rel="noopener noreferrer" className="truncate text-[#3b82f6] hover:underline">{place.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
              </p>
            ) : null}
          </motion.div>
        ) : null}

        {!identifying && streetImages !== null ? (
          <motion.div {...reveal(1)} className="border-t border-slate-100 px-4 py-3">
            {streetImages.length ? (
              <button type="button" onClick={() => setStreetIndex(0)} className="group relative block w-full overflow-hidden rounded-xl">
                <img src={streetImages[0].url} alt="" loading="lazy" className="h-[110px] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-900 shadow">
                  <Eye className="h-3.5 w-3.5" /> Street Look
                </span>
              </button>
            ) : (
              <p className="text-[12.5px] text-slate-400">Street imagery unavailable here</p>
            )}
          </motion.div>
        ) : null}

        {info?.summary ? (
          <motion.div {...reveal(2)} className="border-t border-slate-100 px-4 py-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">About</p>
            <p className="text-[13px] leading-relaxed text-slate-700">{info.summary}</p>
            {info.summaryUrl ? (
              <a href={info.summaryUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3b82f6] hover:underline">
                Read more on Wikipedia <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </motion.div>
        ) : null}

        {ratings.length > 0 && !isPin && !identifying ? (
          <motion.div {...reveal(4)} className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Ratings & reviews</p>
            {ratings.map((r) => (
              <div key={r.source}>
                <div className="mx-rating">
                  <span className="mx-rating__score">{r.value.toFixed(1)}</span>
                  <span className="mx-rating__meta">
                    <span className="mx-rating__stars" aria-label={`${r.value} out of 5`}>{"★".repeat(Math.round(r.value))}<span style={{ color: "#d8dbe0" }}>{"★".repeat(5 - Math.round(r.value))}</span></span>
                    <br />
                    {typeof r.count === "number" ? `${r.count.toLocaleString()} ratings · ` : ""}
                    {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.source}</a> : r.source}
                  </span>
                </div>
                {r.reviews?.length ? (
                  <div className="px-1 pt-1">
                    {r.reviews.slice(0, 3).map((rv, i) => (
                      <p key={i} className="mx-review">
                        <b>{rv.author ?? "Reviewer"}</b>{typeof rv.rating === "number" ? ` · ${"★".repeat(Math.round(rv.rating))}` : ""}{rv.when ? ` · ${rv.when}` : ""}
                        <br />
                        {rv.text.length > 220 ? `${rv.text.slice(0, 220)}…` : rv.text}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
            <p className="mt-2 text-[10.5px] text-slate-400">Shown with the source each rating came from.</p>
          </motion.div>
        ) : null}

        {!ratings.length && reviewsChecked && !isPin && !identifying && !webLoading ? (
          <motion.div {...reveal(4)} className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Reviews</p>
            {reviews?.items.length ? (
              <ul className="space-y-2.5">
                {reviews.items.slice(0, 3).map((r) => (
                  <li key={r.id} className="text-[13px]">
                    <p className="font-semibold text-slate-900">{"★".repeat(Math.round(r.rating))}<span className="text-slate-300">{"★".repeat(5 - Math.round(r.rating))}</span> <span className="font-normal text-slate-500">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ""}</span></p>
                    {r.text ? <p className="mt-0.5 text-slate-700">{r.text}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-slate-500">No open reviews yet.</p>
            )}
            <p className="mt-2 text-[10.5px] text-slate-400">Reviews from Mangrove Open Reviews</p>
          </motion.div>
        ) : null}

        {nearby.length > 0 ? (
          <motion.div {...reveal(5)} className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Nearby</p>
            <ul className="space-y-1">
              {nearby.slice(0, 6).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onMouseEnter={() => prefetchPlaceDetail(n)}
                    onClick={() => onSelectNearby(n)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50 active:scale-[0.99]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">{n.name}</span>
                      {n.categories[0] ? <span className="block truncate text-[11.5px] capitalize text-slate-500">{n.categories[0].replace(/_/g, " ")}</span> : null}
                    </span>
                    {typeof n.distanceMeters === "number" ? <span className="shrink-0 text-[11.5px] text-slate-400">{formatDistance(n.distanceMeters)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}

        {!identifying ? (
          <motion.div {...reveal(6)} className="border-t border-slate-100 px-4 py-3">
            <button type="button" className="mx-btn mx-btn--block" onClick={() => onAskClyra(place)}>
              <Sparkles className="h-4 w-4 text-[#3b82f6]" /> Ask Clyra about this place
            </button>
          </motion.div>
        ) : null}

        <p className="border-t border-slate-100 px-4 py-2.5 text-[10.5px] leading-relaxed text-slate-400">
          Data © OpenStreetMap contributors
          {enrich?.sources?.length ? ` · ${enrich.sources.join(" · ")}` : `${info?.summary ? " · Wikipedia" : ""}${photos.length ? " · Wikimedia Commons" : ""}`}
          {streetImages?.length ? ` · ${[...new Set(streetImages.map((s) => s.provider))].join(", ")}` : ""}
        </p>
      </div>

      <AnimatePresence>
        {streetImage && streetImages ? (
          <motion.div
            key="street-look"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            role="dialog"
            aria-label="Street Look"
            className="absolute inset-0 z-10 flex flex-col bg-black/90 text-white"
          >
            <div className="flex items-center justify-between px-4 py-3 text-[13px]">
              <span className="font-semibold">Street Look · {streetImage.provider}</span>
              <button type="button" aria-label="Close Street Look" onClick={() => setStreetIndex(null)} className="grid h-8 w-8 place-items-center rounded-full transition-transform hover:bg-white/10 active:scale-90">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1">
              <AnimatePresence initial={false}>
                <motion.img
                  key={streetImage.id}
                  src={streetImage.url}
                  alt="Street imagery"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: EASE }}
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </AnimatePresence>
              {streetImages.length > 1 ? (
                <>
                  <button type="button" aria-label="Previous image" onClick={() => setStreetIndex((i) => ((i ?? 0) - 1 + streetImages.length) % streetImages.length)} className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/15 transition-transform hover:bg-white/25 active:scale-90">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label="Next image" onClick={() => setStreetIndex((i) => ((i ?? 0) + 1) % streetImages.length)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/15 transition-transform hover:bg-white/25 active:scale-90">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>
            <div className="px-4 py-3 text-[11.5px] leading-relaxed text-white/70">
              {streetImage.takenAt ? <span>Taken {new Date(streetImage.takenAt).toLocaleDateString()} · </span> : null}
              {streetImage.license ? <span>{streetImage.license} · </span> : null}
              {streetImage.sourcePage ? <a href={streetImage.sourcePage} target="_blank" rel="noopener noreferrer" className="underline">{streetImage.provider}</a> : <span>{streetImage.provider}</span>}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  );
}
