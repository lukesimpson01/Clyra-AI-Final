import { motion, AnimatePresence } from "motion/react";
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Clock, ExternalLink, Globe, ImageOff, Eye, MapPin, Navigation2, Phone, Share2, Sparkles, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { PlaceLibraryMenu } from "./PlaceLibraryMenu";
import { PlaceConditions } from "./PlaceConditions";
import { ShiningText } from "../ui/shining-text";
import type { ClyraPlace, Route } from "../../../lib/maps/types";
import { formatDistance, formatDuration } from "./mapsIcons";
import { openingState } from "../../../lib/maps/openingHours";
import { getPlaceDetail, peekPlaceDetail, prefetchPlaceDetail, type PlaceInfoResult, type PlaceReviewsResult, type StreetImage } from "./placeDetailCache";

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
export function PlaceDetailSheet({ place, identifying, nearby, route, routeLoading, onClose, onStart, onDirections, onSelectNearby, onAskClyra }: PlaceDetailSheetProps) {
  const isPin = place.id.startsWith("pin-");
  const [info, setInfo] = useState<PlaceInfoResult | null>(null);
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
    setStreetIndex(null);
    setShareNote(null);
    setSaved(readSaved().some((p) => p.id === place.id));

    const cached = peekPlaceDetail(place);
    if (cached) {
      setInfo(cached.info);
      setLoadingInfo(false);
      setReviews(cached.reviews);
      setReviewsChecked(cached.reviewsChecked);
      setStreetImages(cached.streetImages);
    } else {
      setInfo(null);
      setLoadingInfo(true);
      setReviews(null);
      setReviewsChecked(false);
      setStreetImages(null);
    }

    getPlaceDetail(place).then((bundle) => {
      if (cancelled) return;
      setInfo(bundle.info);
      setLoadingInfo(false);
      setReviews(bundle.reviews);
      setReviewsChecked(bundle.reviewsChecked);
      setStreetImages(bundle.streetImages);
    });

    return () => {
      cancelled = true;
    };
  }, [place.id, place.name, place.coordinates, isPin]);

  const photos = info?.photos ?? [];
  const photo = photos[photoIndex];
  const category = place.categories[0]?.replace(/_/g, " ");
  const addressLine = place.address
    ? [place.address, place.locality, place.region].filter(Boolean).join(", ")
    : [place.locality, place.region].filter(Boolean).join(", ");
  const [lng, lat] = place.coordinates;
  const hours = useMemo(() => openingState(place.openingHours?.raw), [place.openingHours?.raw, place.id]);
  const hoursLines = place.openingHours?.raw ? place.openingHours.raw.split(";").map((s) => s.trim()).filter(Boolean) : [];
  const heroLoading = loadingInfo || identifying;
  const hasDetailLines = Boolean(addressLine || isPin || hoursLines.length || place.phone || place.website);

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
      className="pointer-events-auto absolute bottom-4 left-4 top-[88px] z-30 flex w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white/97 shadow-[0_16px_48px_rgba(15,23,42,.16)] backdrop-blur-xl"
    >
      <div className="relative h-[190px] w-full shrink-0 overflow-hidden bg-[#f4f1ea]">
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
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-[12px] text-slate-400"
            >
              <ImageOff className="h-5 w-5" /> No photos found here
            </motion.div>
          )}
        </AnimatePresence>

        {photo && photos.length > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)}
              className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 shadow transition-transform hover:bg-white active:scale-90"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={() => setPhotoIndex((i) => (i + 1) % photos.length)}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 shadow transition-transform hover:bg-white active:scale-90"
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

        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/95 text-slate-600 shadow transition-transform hover:bg-white hover:text-slate-900 active:scale-90">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pb-3 pt-4">
          {identifying && isPin ? (
            <div className="space-y-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>
              <h3 className="text-[20px] font-bold leading-tight text-slate-950">{place.name}</h3>
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

          {!identifying ? <PlaceConditions coordinates={place.coordinates} /> : null}

          {route ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[#3b82f6]/[0.07] px-3 py-2.5">
              <div>
                <p className="text-[18px] font-bold leading-none text-slate-950">{formatDuration(route.durationSeconds)}</p>
                <p className="mt-1 text-[12px] text-slate-500">{formatDistance(route.distanceMeters)} · fastest route</p>
              </div>
              <Button size="lg" variant="primary" className="rounded-full" onClick={onStart}>
                <Navigation2 className="h-4 w-4" /> Start
              </Button>
            </div>
          ) : routeLoading ? (
            <div className="mt-3 text-[12.5px]"><ShiningText text="Finding the route…" className="text-[12.5px]" /></div>
          ) : isPin && !identifying ? (
            <div className="mt-3">
              <Button size="lg" variant="primary" className="rounded-full" onClick={() => onDirections(place)}>
                <Navigation2 className="h-4 w-4" /> Directions
              </Button>
            </div>
          ) : null}

          {!identifying ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {!isPin ? (
                <Button size="lg" variant="secondary" className="rounded-full" onClick={() => onDirections(place)}>
                  <Navigation2 className="h-4 w-4" /> Directions
                </Button>
              ) : null}
              <PlaceLibraryMenu place={place} />
              {place.website ? (
                <Button size="lg" variant="secondary" className="rounded-full" onClick={() => window.open(place.website, "_blank", "noopener,noreferrer")}>
                  <Globe className="h-4 w-4" /> Website
                </Button>
              ) : null}
              {place.phone ? (
                <Button size="lg" variant="secondary" className="rounded-full" onClick={() => window.open(`tel:${place.phone}`)}>
                  <Phone className="h-4 w-4" /> Call
                </Button>
              ) : null}
              <Button size="lg" variant="secondary" className="rounded-full" onClick={toggleSave} aria-pressed={saved}>
                {saved ? <BookmarkCheck className="h-4 w-4 text-[#3b82f6]" /> : <Bookmark className="h-4 w-4" />} {saved ? "Saved" : "Save"}
              </Button>
              <Button size="lg" variant="secondary" className="rounded-full" onClick={share}>
                <Share2 className="h-4 w-4" /> Share
              </Button>
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
            {hoursLines.length ? (
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <ul className="space-y-0.5">{hoursLines.map((line) => <li key={line}>{line}</li>)}</ul>
              </div>
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
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[12px] font-semibold text-slate-900 shadow">
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

        {photos.length > 1 ? (
          <motion.div {...reveal(3)} className="border-t border-slate-100 px-4 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Photos</p>
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {photos.map((p, i) => (
                <button
                  key={p.url}
                  type="button"
                  aria-label={`Show photo ${i + 1}`}
                  onClick={() => setPhotoIndex(i)}
                  className={"h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-150 active:scale-95 " + (i === photoIndex ? "border-[#3b82f6]" : "border-transparent hover:border-slate-200")}
                >
                  <img src={p.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}

        {reviewsChecked && !isPin && !identifying ? (
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
            <Button size="lg" variant="secondary" className="w-full rounded-full" onClick={() => onAskClyra(place)}>
              <Sparkles className="h-4 w-4 text-[#3b82f6]" /> Ask Clyra about this place
            </Button>
          </motion.div>
        ) : null}

        <p className="border-t border-slate-100 px-4 py-2.5 text-[10.5px] leading-relaxed text-slate-400">
          Data © OpenStreetMap contributors
          {info?.summary ? " · Wikipedia" : ""}
          {photos.length ? " · Wikimedia Commons" : ""}
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
