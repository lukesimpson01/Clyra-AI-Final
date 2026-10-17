import { Compass, Download, Eye, Orbit, Layers, LocateFixed, Minus, Plus, Box } from "lucide-react";
import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { Basemap } from "../../maps/MapController";

interface MapControlsProps {
  getMap: () => maplibregl.Map | null;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  onLocate: () => void;
  locating: boolean;
  onLookAround: () => void;
  onDownload: () => void;
  downloadLabel: string | null;
  flying: boolean;
  onFlyover: () => void;
}

const MODES: { id: Basemap; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "driving", label: "Driving" },
  { id: "satellite", label: "Satellite" },
];

const btn =
  "grid h-10 w-10 place-items-center text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200";

/** Apple-style floating control cluster: map mode, 3D, locate, zoom, compass. */
export function MapControls({ getMap, basemap, onBasemap, onLocate, locating, onLookAround, onDownload, downloadLabel, flying, onFlyover }: MapControlsProps) {
  const [open, setOpen] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);

  useEffect(() => {
    const m = getMap();
    if (!m) return;
    const sync = () => {
      setBearing(m.getBearing());
      setPitch(m.getPitch());
    };
    sync();
    m.on("rotate", sync);
    m.on("pitch", sync);
    return () => {
      m.off("rotate", sync);
      m.off("pitch", sync);
    };
  }, [getMap]);

  const card = "overflow-hidden rounded-xl border border-slate-200/80 bg-white/90 shadow-[0_6px_20px_rgba(15,23,42,.14)] backdrop-blur-xl";
  const is3d = pitch > 5;

  return (
    <div className="pointer-events-none absolute right-4 top-4 z-30 flex flex-col items-end gap-2">
      <div className="pointer-events-auto relative">
        <div className={card + " divide-y divide-slate-200/80"}>
          <button type="button" aria-label="Map type" className={btn} onClick={() => setOpen((v) => !v)}>
            <Layers className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            aria-label={is3d ? "Switch to 2D" : "Switch to 3D"}
            className={btn + " text-[11px] font-bold"}
            onClick={() => getMap()?.easeTo({ pitch: is3d ? 0 : 60, duration: 500 })}
          >
            {is3d ? "2D" : <Box className="h-[18px] w-[18px]" />}
          </button>
          <button type="button" aria-label={flying ? "Stop Flyover" : "Start Flyover"} className={btn + (flying ? " bg-blue-50 text-blue-600" : "")} onClick={onFlyover}>
            <Orbit className="h-[18px] w-[18px]" />
          </button>
          <button type="button" aria-label="Look Around" className={btn} onClick={onLookAround}>
            <Eye className="h-[18px] w-[18px]" />
          </button>
          <button type="button" aria-label="Download this area for offline use" title={downloadLabel ?? "Download this area"} className={btn + " text-[10px] font-bold"} onClick={onDownload}>
            {downloadLabel ?? <Download className="h-[18px] w-[18px]" />}
          </button>
          <button type="button" aria-label="Show my location" className={btn} onClick={onLocate}>
            <LocateFixed className={"h-[18px] w-[18px] " + (locating ? "animate-pulse text-blue-500" : "")} />
          </button>
        </div>
        {open ? (
          <div className={card + " absolute right-12 top-0 w-36 p-1"}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onBasemap(m.id);
                  setOpen(false);
                }}
                className={
                  "block w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium " +
                  (basemap === m.id ? "bg-blue-500 text-white" : "text-slate-700 hover:bg-slate-100")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={"pointer-events-auto " + card + " divide-y divide-slate-200/80"}>
        <button type="button" aria-label="Zoom in" className={btn} onClick={() => getMap()?.zoomIn({ duration: 250 })}>
          <Plus className="h-[18px] w-[18px]" />
        </button>
        <button type="button" aria-label="Zoom out" className={btn} onClick={() => getMap()?.zoomOut({ duration: 250 })}>
          <Minus className="h-[18px] w-[18px]" />
        </button>
      </div>

      {Math.abs(bearing) > 0.5 ? (
        <button
          type="button"
          aria-label="Reset north"
          className={"pointer-events-auto grid h-10 w-10 place-items-center rounded-full " + card}
          onClick={() => getMap()?.easeTo({ bearing: 0, pitch: 0, duration: 450 })}
        >
          <Compass className="h-5 w-5 text-slate-700" style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
      ) : null}
    </div>
  );
}
