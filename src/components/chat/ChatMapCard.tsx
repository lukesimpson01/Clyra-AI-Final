import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ExternalLink, MapPin, Navigation } from "lucide-react";
import type { MapLocationPayload } from "../LocationMapCard";
import type { ClyraPlace } from "../../../lib/maps/types";
import { getPlaceDetail, type PlaceDetailBundle } from "../maps/placeDetailCache";

/** The same MapLibre map the Maps app uses, so the chat and the app can never disagree about a place. */
const MapView = lazy(() => import("../../maps/MapView").then((m) => ({ default: m.MapView })));

const firstSentences = (text: string, max = 260) => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
};

/**
 * A place the assistant is talking about, shown the way the Maps app shows it: the live map with the place pinned,
 * and beside it what is known about it (a photo and summary when a public source has them, its address and exact
 * position). "Directions" opens the Maps app with the destination already entered and the route laid out, waiting
 * for Start; nothing is invented, so a place with no public photo or summary simply shows its address.
 */
export function ChatMapCard({ location }: { location: MapLocationPayload }) {
  const { name, region, country, lat, lon, isCurrentLocation, matchedFrom } = location;
  const place = useMemo<ClyraPlace>(
    () => ({ id: `chat-${lat.toFixed(5)}-${lon.toFixed(5)}`, name: name || "Location", coordinates: [lon, lat], address: [region, country].filter(Boolean).join(", ") || undefined, categories: [], sourceLinks: [] }) as ClyraPlace,
    [lat, lon, name, region, country],
  );
  const [detail, setDetail] = useState<PlaceDetailBundle | null>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void getPlaceDetail(place).then((bundle) => { if (alive) setDetail(bundle); }).catch(() => undefined);
    return () => { alive = false; };
  }, [place]);

  const title = isCurrentLocation ? (name ? `Your location · ${name}` : "Your location") : name || "Location";
  const subtitle = [region, country].filter(Boolean).join(", ");
  const photo = detail?.info?.photos?.[0];
  const summary = detail?.info?.summary ? firstSentences(detail.info.summary) : "";
  const coords = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
  const open = (mode: "directions" | "place") =>
    window.dispatchEvent(new CustomEvent("clyra:open-in-maps", { detail: { mode, name: place.name, coordinates: place.coordinates, address: subtitle || undefined } }));

  return (
    <section className="clyra-mapcard" aria-label={`Map of ${title}`} data-invert-ignore>
      <div className="clyra-mapcard__map">
        <Suspense fallback={<div className="clyra-mapcard__loading">Loading map…</div>}>
          <MapView initialCenter={[lon, lat]} initialZoom={14.5} onReady={(controller) => { controller.setSelectionPin([lon, lat]); setMapReady(true); }} />
        </Suspense>
        {!mapReady ? <div className="clyra-mapcard__loading" aria-hidden>Loading map…</div> : null}
      </div>
      <div className="clyra-mapcard__info">
        {photo ? <img className="clyra-mapcard__photo" src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
        <div className="clyra-mapcard__head">
          <span className="clyra-mapcard__pin" aria-hidden><MapPin /></span>
          <div className="clyra-mapcard__titles">
            <h3 className="clyra-mapcard__title">{title}</h3>
            {subtitle ? <p className="clyra-mapcard__sub">{subtitle}</p> : null}
          </div>
        </div>
        {summary ? (
          <p className="clyra-mapcard__summary">
            {summary}
            {detail?.info?.summaryUrl ? <> <a href={detail.info.summaryUrl} target="_blank" rel="noopener noreferrer">Source</a></> : null}
          </p>
        ) : detail === null ? <p className="clyra-mapcard__summary clyra-mapcard__summary--loading">Looking up details…</p> : null}
        <dl className="clyra-mapcard__facts">
          <div><dt>Position</dt><dd>{coords}</dd></div>
          {matchedFrom && !isCurrentLocation ? <div><dt>Matched from</dt><dd>“{matchedFrom}”</dd></div> : null}
        </dl>
        <div className="clyra-mapcard__actions">
          <button type="button" className="clyra-mapcard__primary" onClick={() => open("directions")}><Navigation /> Directions</button>
          <button type="button" className="clyra-mapcard__secondary" onClick={() => open("place")}><ExternalLink /> Open in Maps</button>
        </div>
        <p className="clyra-mapcard__credit">Map data © OpenStreetMap contributors</p>
      </div>
    </section>
  );
}
