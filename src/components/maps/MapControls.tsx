import { Box, Check, Compass, Download, Locate, LocateFixed, Minus, Orbit, PersonStanding, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type maplibregl from "maplibre-gl";
import type { Basemap } from "../../maps/MapController";
import { lonLatToTile } from "../../maps/offline";

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
  /** Pixels reserved at the right edge (e.g. while the AI panel is open). */
  rightInset?: number;
  /** Pixels taken by the left sidebar, so the Layers tile sits beside it. */
  leftInset?: number;
}

const MODES: { id: Basemap; label: string }[] = [
  { id: "explore", label: "Default" },
  { id: "driving", label: "Driving" },
  { id: "satellite", label: "Satellite" },
];

const card = "mx-ctrl-group";
const btn = "mx-ctrl";

/** Esri satellite tile covering the map centre, used as the Layers thumbnail. */
function thumbUrl(center: [number, number]) {
  const [x, y] = lonLatToTile(center[0], center[1], 12);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/${y}/${x}`;
}

/** Google-style controls: tools top-right, Layers tile bottom-left, locate/zoom/Look Around bottom-right. */
export function MapControls({ getMap, basemap, onBasemap, onLocate, locating, onLookAround, onDownload, downloadLabel, flying, onFlyover, rightInset = 16, leftInset = 0 }: MapControlsProps) {
  const [menu, setMenu] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [center, setCenter] = useState<[number, number]>([0, 0]);

  useEffect(() => {
    const m = getMap();
    if (!m) return;
    const sync = () => {
      setBearing(m.getBearing());
      setPitch(m.getPitch());
    };
    const moved = () => {
      const c = m.getCenter();
      setCenter([c.lng, c.lat]);
    };
    sync();
    moved();
    m.on("rotate", sync);
    m.on("pitch", sync);
    m.on("moveend", moved);
    return () => {
      m.off("rotate", sync);
      m.off("pitch", sync);
      m.off("moveend", moved);
    };
  }, [getMap]);

  const is3d = pitch > 5;
  const showCompass = Math.abs(bearing) > 0.5 || is3d;

  return (
    <>
      {/* Tools — top right */}
      <div style={{ right: rightInset }} className="pointer-events-none absolute top-4 z-30 flex flex-col items-end gap-2 transition-[right] duration-300 ease-out">
        <div className={"pointer-events-auto " + card}>
          <button type="button" aria-label={is3d ? "Switch to 2D" : "Switch to 3D"} title={is3d ? "2D" : "3D"} className={btn + " text-[11px] font-bold"} onClick={() => getMap()?.easeTo({ pitch: is3d ? 0 : 60, duration: 600 })}>
            {is3d ? "2D" : <Box className="h-[18px] w-[18px]" />}
          </button>
          <button type="button" aria-label={flying ? "Stop Flyover" : "Start Flyover"} data-on={flying} title="Flyover" className={btn} onClick={onFlyover}>
            <Orbit className="h-[18px] w-[18px]" />
          </button>
          <button type="button" aria-label="Download this area for offline use" title={downloadLabel ?? "Save area offline"} className={btn + " text-[10px] font-bold"} onClick={onDownload}>
            {downloadLabel ?? <Download className="h-[18px] w-[18px]" />}
          </button>
        </div>
        {showCompass ? (
          <button type="button" aria-label="Reset north" title="Reset north" className="pointer-events-auto mx-ctrl mx-ctrl--solo !rounded-full" onClick={() => getMap()?.easeTo({ bearing: 0, pitch: 0, duration: 500 })}>
            <Compass className="h-5 w-5" style={{ transform: `rotate(${-bearing}deg)` }} />
          </button>
        ) : null}
      </div>

      {/* Layers tile — bottom left */}
      <div style={{ left: leftInset + 16 }} className="pointer-events-none absolute bottom-[68px] z-30 transition-[left] duration-300 ease-out">
        {menu ? (
          <div className="pointer-events-auto mx-pop mb-2 flex gap-1.5 p-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onBasemap(m.id);
                  setMenu(false);
                }}
                className={"relative w-[72px] rounded-lg p-1 text-center text-[11.5px] font-semibold outline-none transition-colors " + (basemap === m.id ? "bg-[#0066ff]/10 text-[#0052cc]" : "text-[#6b6f76] hover:bg-[#f3f4f6]")}
              >
                <span
                  className="mb-1 block h-12 w-full rounded-md bg-cover bg-center"
                  style={{ backgroundImage: m.id === "satellite" ? `url(${thumbUrl(center)})` : undefined, backgroundColor: m.id === "driving" ? "#fde7a8" : "#e9efe6" }}
                />
                {m.label}
                {basemap === m.id ? <Check className="absolute right-2 top-2 h-3.5 w-3.5 rounded-full bg-white p-0.5 text-[#0052cc]" /> : null}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Map layers"
          onClick={() => setMenu((v) => !v)}
          className="pointer-events-auto relative block h-[54px] w-[54px] overflow-hidden rounded-[14px] bg-cover bg-center shadow-[0_0_0_2px_#fff,0_4px_14px_-4px_rgba(16,18,24,.4)] outline-none transition-transform active:scale-95"
          style={{ backgroundImage: `url(${thumbUrl(center)})` }}
        >
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 text-[11px] font-semibold text-white">Layers</span>
        </button>
      </div>

      {/* Look Around, locate, zoom — bottom right */}
      <div style={{ right: rightInset }} className="pointer-events-none absolute bottom-[68px] z-30 flex flex-col items-end gap-2 transition-[right] duration-300 ease-out">
        <button type="button" aria-label="Look Around" title="Look Around" className="pointer-events-auto mx-ctrl mx-ctrl--solo" onClick={onLookAround}>
          <PersonStanding />
        </button>
        <button type="button" aria-label="Show my location" title="Your location" className="pointer-events-auto mx-ctrl mx-ctrl--solo" onClick={onLocate}>
          {locating ? <Locate className="h-5 w-5 animate-pulse text-[#0066ff]" /> : <LocateFixed className="h-5 w-5" />}
        </button>
        <div className={"pointer-events-auto " + card}>
          <button type="button" aria-label="Zoom in" className={btn} onClick={() => getMap()?.zoomIn({ duration: 250 })}>
            <Plus className="h-[18px] w-[18px]" />
          </button>
          <button type="button" aria-label="Zoom out" className={btn} onClick={() => getMap()?.zoomOut({ duration: 250 })}>
            <Minus className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </>
  );
}
