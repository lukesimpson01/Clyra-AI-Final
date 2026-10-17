import { BookMarked, Briefcase, Car, Home, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { addToGuide, createGuide, readLibrary, setParked, setSlot, LIBRARY_EVENT, type Library } from "../../maps/library";
import type { ClyraPlace } from "../../../lib/maps/types";

/** "Add to…" menu on the place card: Guides, Home, Work and parked car. */
export function PlaceLibraryMenu({ place }: { place: ClyraPlace }) {
  const [open, setOpen] = useState(false);
  const [lib, setLib] = useState<Library>(() => readLibrary());
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setLib(readLibrary());
    window.addEventListener(LIBRARY_EVENT, refresh);
    return () => window.removeEventListener(LIBRARY_EVENT, refresh);
  }, []);
  useEffect(() => setOpen(false), [place.id]);

  const done = (msg: string) => {
    setNote(msg);
    setOpen(false);
    window.setTimeout(() => setNote(null), 2200);
  };
  const item = "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-100";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-200"
      >
        <BookMarked className="h-4 w-4" /> {note ?? "Add to…"}
      </button>
      {open ? (
        <div className="absolute bottom-11 left-0 z-40 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,.2)]">
          <button type="button" className={item} onClick={() => (setSlot("home", place), done("Set as Home"))}>
            <Home className="h-4 w-4" /> Set as Home
          </button>
          <button type="button" className={item} onClick={() => (setSlot("work", place), done("Set as Work"))}>
            <Briefcase className="h-4 w-4" /> Set as Work
          </button>
          <button
            type="button"
            className={item}
            onClick={() => (setParked({ coordinates: place.coordinates, at: Date.now(), label: place.name }), done("Parked car saved"))}
          >
            <Car className="h-4 w-4" /> I parked here
          </button>
          <div className="my-1 border-t border-slate-100" />
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Guides</p>
          {lib.guides.map((g) => (
            <button key={g.id} type="button" className={item} onClick={() => (addToGuide(g.id, place), done(`Added to ${g.name}`))}>
              <BookMarked className="h-4 w-4" /> {g.name}
              <span className="ml-auto text-[11px] text-slate-400">{g.places.length}</span>
            </button>
          ))}
          <form
            className="flex items-center gap-1.5 px-1.5 pb-1 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              createGuide(name, place);
              done(`Added to ${name.trim()}`);
              setName("");
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New guide…" className="min-w-0 flex-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[13px] outline-none" />
            <button type="submit" aria-label="Create guide" className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-white">
              <Plus className="h-4 w-4" />
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
