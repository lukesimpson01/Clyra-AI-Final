import { BookMarked, Briefcase, ChevronDown, Car, DownloadCloud, Clock, Home, MapPin, Star, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClyraPlace } from "../../../lib/maps/types";
import { deleteGuide, LIBRARY_EVENT, readLibrary, removeFromGuide, setParked, type Library } from "../../maps/library";
import { OFFLINE_EVENT, readAreas, removeArea, type OfflineArea } from "../../maps/offline";
import { prefetchPlaceDetail } from "./placeDetailCache";

const RECENTS_KEY = "clyra.recentPlaces";
const SAVED_KEY = "clyra.savedPlaces";

function read(key: string): ClyraPlace[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Records a visited place at the front of Recents (deduped, capped). */
export function pushRecent(place: ClyraPlace) {
  if (!place.name || place.id.startsWith("pin-")) return;
  try {
    const next = [place, ...read(RECENTS_KEY).filter((p) => p.id !== place.id)].slice(0, 12);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("clyra-maps-recents"));
  } catch {
    // Storage unavailable: recents just aren't kept.
  }
}

function Row({ place, icon, onSelect, onRemove }: { place: ClyraPlace; icon: React.ReactNode; onSelect: (p: ClyraPlace) => void; onRemove?: () => void }) {
  return (
    <div className="group flex items-center">
      <button
        type="button"
        onMouseEnter={() => prefetchPlaceDetail(place)}
        onClick={() => onSelect(place)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-slate-100"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-slate-800">{place.name}</span>
          <span className="block truncate text-[12px] text-slate-500">{place.address || place.locality || ""}</span>
        </span>
      </button>
      {onRemove ? (
        <button type="button" aria-label={`Remove ${place.name}`} onClick={onRemove} className="mr-1 hidden h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-200 group-hover:grid">
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{children}</div>
);

/** Idle-state Library sheet: Home/Work, parked car, Favorites, Guides, Recents. */
export function MapsHome({ onSelect }: { onSelect: (p: ClyraPlace) => void }) {
  const [recents, setRecents] = useState<ClyraPlace[]>(() => read(RECENTS_KEY));
  const [saved, setSaved] = useState<ClyraPlace[]>(() => read(SAVED_KEY));
  const [lib, setLib] = useState<Library>(() => readLibrary());
  const [areas, setAreas] = useState<OfflineArea[]>(() => readAreas());
  const [openGuide, setOpenGuide] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setRecents(read(RECENTS_KEY));
      setSaved(read(SAVED_KEY));
      setLib(readLibrary());
      setAreas(readAreas());
    };
    window.addEventListener("clyra-maps-recents", refresh);
    window.addEventListener(LIBRARY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener(OFFLINE_EVENT, refresh);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, refresh);
      window.removeEventListener("clyra-maps-recents", refresh);
      window.removeEventListener(LIBRARY_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const parked = lib.parked;
  const parkedPlace: ClyraPlace | null = parked
    ? { id: "parked-car", name: "Parked car", coordinates: parked.coordinates, address: parked.label, categories: [], sourceLinks: [] }
    : null;
  const empty = !recents.length && !saved.length && !lib.home && !lib.work && !parked && !lib.guides.length && !areas.length;
  if (empty) return null;

  const quick = (icon: React.ReactNode, label: string, place: ClyraPlace | undefined) =>
    place ? (
      <button type="button" onClick={() => onSelect(place)} className="flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 hover:bg-slate-100">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-500 text-white">{icon}</span>
        <span className="text-[11.5px] font-semibold text-slate-700">{label}</span>
      </button>
    ) : null;

  return (
    <div className="pointer-events-auto absolute left-4 top-[68px] z-20 max-h-[calc(100%-150px)] w-[380px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-2 shadow-[0_12px_40px_rgba(15,23,42,.16)]">
      <button type="button" onClick={() => setCollapsed((v) => !v)} className="flex w-full items-center justify-between px-2.5 py-1 text-[13px] font-bold text-slate-800">
        Library
        <ChevronDown className={"h-4 w-4 text-slate-400 transition-transform " + (collapsed ? "-rotate-90" : "")} />
      </button>
      {collapsed ? null : (
        <>
          {lib.home || lib.work || parkedPlace ? (
            <div className="flex">
              {quick(<Home className="h-4 w-4" />, "Home", lib.home)}
              {quick(<Briefcase className="h-4 w-4" />, "Work", lib.work)}
              {quick(<Car className="h-4 w-4" />, "Parked car", parkedPlace ?? undefined)}
            </div>
          ) : null}
          {parked ? (
            <button type="button" onClick={() => setParked(undefined)} className="mb-1 ml-2.5 text-[11.5px] font-semibold text-slate-500 hover:underline">
              Clear parked car
            </button>
          ) : null}
          {saved.length ? (
            <>
              <Label>Favorites</Label>
              {saved.slice(0, 5).map((p) => (
                <Row key={p.id} place={p} icon={<Star className="h-4 w-4 text-amber-500" />} onSelect={onSelect} />
              ))}
            </>
          ) : null}
          {lib.guides.length ? (
            <>
              <Label>Guides</Label>
              {lib.guides.map((g) => (
                <div key={g.id}>
                  <div className="group flex items-center">
                    <button type="button" onClick={() => setOpenGuide(openGuide === g.id ? null : g.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-slate-100">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                        <BookMarked className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-800">{g.name}</span>
                        <span className="block text-[12px] text-slate-500">{g.places.length} {g.places.length === 1 ? "place" : "places"}</span>
                      </span>
                    </button>
                    <button type="button" aria-label={`Delete guide ${g.name}`} onClick={() => deleteGuide(g.id)} className="mr-1 hidden h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-200 group-hover:grid">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {openGuide === g.id ? (
                    <div className="ml-4 border-l border-slate-200 pl-1">
                      {g.places.map((p) => (
                        <Row key={p.id} place={p} icon={<MapPin className="h-4 w-4" />} onSelect={onSelect} onRemove={() => removeFromGuide(g.id, p.id)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
          {areas.length ? (
            <>
              <Label>Offline maps</Label>
              {areas.map((a) => (
                <div key={a.id} className="group flex items-center">
                  <span className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-50 text-sky-600">
                      <DownloadCloud className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-slate-800">{a.name}</span>
                      <span className="block text-[12px] text-slate-500">{a.tiles} tiles · {new Date(a.savedAt).toLocaleDateString()}</span>
                    </span>
                  </span>
                  <button type="button" aria-label={`Remove offline area ${a.name}`} onClick={() => void removeArea(a.id)} className="mr-1 grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-200">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </>
          ) : null}
          {recents.length ? (
            <>
              <Label>Recents</Label>
              {recents.slice(0, 6).map((p) => (
                <Row key={p.id} place={p} icon={p.address ? <Clock className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} onSelect={onSelect} />
              ))}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
