/** Clyra Maps Library: Home/Work, parked car and Guides, kept on this device.
 * Favorites and Recents live in their own keys (see PlaceDetailSheet/MapsHome). */
import type { ClyraPlace, Coordinate } from "../../lib/maps/types";

const KEY = "clyra.mapsLibrary";
export const LIBRARY_EVENT = "clyra-maps-library";

export interface Guide {
  id: string;
  name: string;
  places: ClyraPlace[];
}

export interface ParkedCar {
  coordinates: Coordinate;
  at: number;
  note?: string;
  label?: string;
}

export interface Library {
  home?: ClyraPlace;
  work?: ClyraPlace;
  parked?: ParkedCar;
  guides: Guide[];
}

export function readLibrary(): Library {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Library>;
    return { home: v.home, work: v.work, parked: v.parked, guides: Array.isArray(v.guides) ? v.guides : [] };
  } catch {
    return { guides: [] };
  }
}

function write(next: Library) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: changes last for this session's UI only.
  }
  window.dispatchEvent(new Event(LIBRARY_EVENT));
}

export function setSlot(slot: "home" | "work", place: ClyraPlace | undefined) {
  write({ ...readLibrary(), [slot]: place });
}

export function setParked(parked: ParkedCar | undefined) {
  write({ ...readLibrary(), parked });
}

export function createGuide(name: string, first?: ClyraPlace): Guide {
  const lib = readLibrary();
  const guide: Guide = { id: `guide-${Date.now().toString(36)}`, name: name.trim() || "New Guide", places: first ? [first] : [] };
  write({ ...lib, guides: [...lib.guides, guide] });
  return guide;
}

export function addToGuide(guideId: string, place: ClyraPlace) {
  const lib = readLibrary();
  write({
    ...lib,
    guides: lib.guides.map((g) => (g.id === guideId && !g.places.some((p) => p.id === place.id) ? { ...g, places: [...g.places, place] } : g)),
  });
}

export function removeFromGuide(guideId: string, placeId: string) {
  const lib = readLibrary();
  write({ ...lib, guides: lib.guides.map((g) => (g.id === guideId ? { ...g, places: g.places.filter((p) => p.id !== placeId) } : g)) });
}

export function deleteGuide(guideId: string) {
  const lib = readLibrary();
  write({ ...lib, guides: lib.guides.filter((g) => g.id !== guideId) });
}
