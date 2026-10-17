import { motion } from "motion/react";
import { Bike, BusFront, Car, Check, Footprints, Navigation2, Plus, Share2, TrainFront, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/Button";
import type { ClyraPlace, Route, TravelMode } from "../../../lib/maps/types";
import type { TransitItinerary } from "../../../lib/maps/transit";
import { formatArrival, formatDistance, formatDuration } from "./mapsIcons";

const MODES: Array<{ id: TravelMode; label: string; icon: typeof Car }> = [
  { id: "drive", label: "Drive", icon: Car },
  { id: "walk", label: "Walk", icon: Footprints },
  { id: "transit", label: "Transit", icon: BusFront },
  { id: "bike", label: "Bike", icon: Bike },
];

const STOP_CATEGORIES = [
  { id: "petrol", label: "Fuel" },
  { id: "coffee", label: "Coffee" },
  { id: "food", label: "Food" },
  { id: "groceries", label: "Groceries" },
  { id: "ev-charging", label: "EV charging" },
];

export interface TransitWhen {
  kind: "now" | "depart" | "arrive";
  /** Local datetime for `datetime-local` inputs (YYYY-MM-DDTHH:mm). */
  time?: string;
}

export interface TransitState {
  itineraries: TransitItinerary[];
  selectedId: string | null;
  loading: boolean;
}

interface RouteOverviewPanelProps {
  destinationName: string;
  route: Route | null;
  alternatives: Route[];
  activeMode: TravelMode;
  transit: TransitState | null;
  transitWhen: TransitWhen;
  onTransitWhen: (when: TransitWhen) => void;
  stops: ClyraPlace[];
  originCoordinates?: [number, number];
  destinationCoordinates?: [number, number];
  onModeChange: (mode: TravelMode) => void;
  onSelectAlternative: (route: Route) => void;
  onSelectItinerary: (id: string) => void;
  onAddStop: (place: ClyraPlace) => void;
  onRemoveStop: (index: number) => void;
  fetchSuggestions: (query: string) => Promise<ClyraPlace[]>;
  fetchAlongRoute: (category: string) => Promise<ClyraPlace[]>;
  onGo: () => void;
  onClose: () => void;
}

const modeColor = (mode: string) =>
  mode === "WALK" ? "#64748b" : mode === "SUBWAY" ? "#7c3aed" : mode.includes("RAIL") ? "#ea580c" : mode === "FERRY" ? "#0891b2" : mode === "TRAM" ? "#16a34a" : "#2563eb";

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Builds an OpenStreetMap directions link a recipient can open anywhere. */
export function directionsShareUrl(mode: TravelMode, stopsLonLat: Array<[number, number]>): string {
  const engine = mode === "walk" ? "fossgis_osrm_foot" : mode === "bike" ? "fossgis_osrm_bike" : "fossgis_osrm_car";
  const pts = stopsLonLat.map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`).join(";");
  return `https://www.openstreetmap.org/directions?engine=${engine}&route=${pts}`;
}

/** Overview card for a calculated route: mode switch, ETA, alternatives, stops
 * along the way, transit itineraries, and sharing. */
export function RouteOverviewPanel({
  destinationName,
  route,
  alternatives,
  activeMode,
  transit,
  transitWhen,
  onTransitWhen,
  stops,
  originCoordinates,
  destinationCoordinates,
  onModeChange,
  onSelectAlternative,
  onSelectItinerary,
  onAddStop,
  onRemoveStop,
  fetchSuggestions,
  fetchAlongRoute,
  onGo,
  onClose,
}: RouteOverviewPanelProps) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ClyraPlace[]>([]);
  const [alongLabel, setAlongLabel] = useState<string | null>(null);
  const [alongLoading, setAlongLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const isTransit = activeMode === "transit";
  const canStop = !isTransit && Boolean(route) && stops.length < 5;

  const runAlong = async (id: string, label: string) => {
    setAlongLabel(label);
    setAlongLoading(true);
    setSuggestions(await fetchAlongRoute(id));
    setAlongLoading(false);
  };

  const share = async () => {
    const selected = transit?.itineraries.find((i) => i.id === transit.selectedId);
    const eta = isTransit && selected ? `Arrive ${clock(selected.endTime)}` : route ? `Arrive ${formatArrival(route.durationSeconds)}` : "";
    const pts = [originCoordinates, ...stops.map((s) => s.coordinates), destinationCoordinates].filter((p): p is [number, number] => Boolean(p));
    const text = `On my way to ${destinationName}. ${eta}${route && !isTransit ? ` (${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)})` : ""}`;
    const url = pts.length >= 2 ? directionsShareUrl(activeMode, pts) : undefined;
    try {
      if (navigator.share) await navigator.share({ title: "Clyra Maps", text, url });
      else {
        await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Share dismissed by the user.
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Directions"
      className="pointer-events-auto absolute bottom-4 left-4 top-[88px] z-30 flex w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-2xl border border-slate-200/90 bg-white/97 shadow-[0_16px_48px_rgba(15,23,42,.16)] backdrop-blur-xl"
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Directions to</p>
          <h3 className="truncate text-[15px] font-bold text-slate-950">{destinationName}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="Share ETA" onClick={() => void share()} className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Share2 className="h-4 w-4" />}
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-4 py-2.5">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onModeChange(id)}
            className={
              "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold transition-colors " +
              (activeMode === id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {isTransit ? (
        <div className="flex flex-col gap-2 px-4 pb-4 pt-1">
          <div className="flex items-center gap-2">
            <select
              aria-label="Transit time"
              value={transitWhen.kind}
              onChange={(e) => onTransitWhen({ kind: e.target.value as TransitWhen["kind"], time: transitWhen.time })}
              className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 outline-none"
            >
              <option value="now">Leave now</option>
              <option value="depart">Depart at</option>
              <option value="arrive">Arrive by</option>
            </select>
            {transitWhen.kind !== "now" ? (
              <input
                type="datetime-local"
                aria-label="Transit date and time"
                value={transitWhen.time ?? ""}
                onChange={(e) => onTransitWhen({ kind: transitWhen.kind, time: e.target.value })}
                className="min-w-0 flex-1 rounded-lg bg-slate-100 px-2 py-1.5 text-[12px] text-slate-700 outline-none"
              />
            ) : null}
          </div>
          {transit?.loading ? <p className="py-6 text-center text-[13px] text-slate-500">Finding transit options…</p> : null}
          {!transit?.loading && !transit?.itineraries.length ? (
            <p className="py-6 text-center text-[13px] text-slate-500">No transit options found for this trip. Public transport data may not cover this area — try Walk or Drive.</p>
          ) : null}
          {transit?.itineraries.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onSelectItinerary(it.id)}
              className={"rounded-xl border p-3 text-left transition-colors " + (it.id === transit.selectedId ? "border-[#3b82f6] bg-[#3b82f6]/5" : "border-slate-200 hover:border-slate-300")}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[15px] font-bold text-slate-950">{formatDuration(it.durationSeconds)}</span>
                <span className="text-[12px] text-slate-500">
                  {clock(it.startTime)} – {clock(it.endTime)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {it.legs.map((l, i) =>
                  l.mode === "WALK" ? (
                    <span key={i} className="flex items-center gap-0.5 text-[11px] text-slate-500">
                      <Footprints className="h-3 w-3" />
                      {Math.max(1, Math.round(l.durationSeconds / 60))}
                    </span>
                  ) : (
                    <span key={i} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: l.color ?? modeColor(l.mode) }}>
                      {l.mode === "SUBWAY" || l.mode.includes("RAIL") ? <TrainFront className="h-3 w-3" /> : <BusFront className="h-3 w-3" />}
                      {l.routeName ?? l.mode.toLowerCase()}
                    </span>
                  ),
                )}
              </div>
              {it.id === transit.selectedId ? (
                <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
                  {it.legs.map((l, i) => (
                    <li key={i} className="text-[12px] text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {clock(l.startTime)} {l.mode === "WALK" ? "Walk" : `${l.routeName ?? l.mode.toLowerCase()}${l.headsign ? ` to ${l.headsign}` : ""}`}
                      </span>
                      <br />
                      {l.mode === "WALK" ? `${Math.max(1, Math.round(l.durationSeconds / 60))} min${l.to.name && l.to.name !== "END" ? ` to ${l.to.name}` : ""}` : `${l.from.name} → ${l.to.name}${l.stops ? ` · ${l.stops} stops` : ""}`}
                    </li>
                  ))}
                </ol>
              ) : null}
            </button>
          ))}
        </div>
      ) : route ? (
        <>
          <div className="flex items-baseline gap-2 px-4 pb-1">
            <span className="text-[26px] font-bold leading-none text-slate-950">{formatDuration(route.durationSeconds)}</span>
            <span className="text-[13px] font-medium text-slate-500">{formatDistance(route.distanceMeters)}</span>
            <span className="ml-auto text-[12px] text-slate-500">Arrive {formatArrival(route.durationSeconds)}</span>
          </div>

          {alternatives.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-2">
              {alternatives.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  onClick={() => onSelectAlternative(alt)}
                  className={"shrink-0 rounded-xl border px-3 py-2 text-left transition-colors " + (alt.id === route.id ? "border-[#3b82f6] bg-[#3b82f6]/5" : "border-slate-200 hover:border-slate-300")}
                >
                  <p className="text-[12.5px] font-bold text-slate-900">{formatDuration(alt.durationSeconds)}</p>
                  <p className="text-[10.5px] text-slate-500">{formatDistance(alt.distanceMeters)}</p>
                </button>
              ))}
            </div>
          ) : null}

          <div className="px-4 pb-2 pt-2">
            {stops.map((s, i) => (
              <div key={`${s.id}-${i}`} className="flex items-center gap-2 py-1">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{s.name}</span>
                <button type="button" aria-label={`Remove stop ${s.name}`} onClick={() => onRemoveStop(i)} className="grid h-6 w-6 place-items-center rounded-full text-slate-400 hover:bg-slate-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {canStop ? (
              adding ? (
                <div className="mt-1 rounded-xl border border-slate-200 p-2">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setAlongLabel(null);
                      if (e.target.value.trim().length >= 2) void fetchSuggestions(e.target.value.trim()).then(setSuggestions);
                      else setSuggestions([]);
                    }}
                    placeholder="Search for a stop"
                    className="w-full rounded-lg bg-slate-100 px-3 py-1.5 text-[13px] outline-none"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {STOP_CATEGORIES.map((c) => (
                      <button key={c.id} type="button" onClick={() => void runAlong(c.id, c.label)} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">
                        {c.label} on the way
                      </button>
                    ))}
                  </div>
                  {alongLoading ? <p className="py-2 text-[12px] text-slate-500">Looking along your route…</p> : null}
                  {alongLabel && !alongLoading && !suggestions.length ? <p className="py-2 text-[12px] text-slate-500">No {alongLabel.toLowerCase()} found along this route.</p> : null}
                  {suggestions.slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onAddStop(p);
                        setAdding(false);
                        setQuery("");
                        setSuggestions([]);
                      }}
                      className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100"
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium text-slate-800">{p.name}</span>
                      {p.detourSeconds != null ? <span className="shrink-0 text-[11px] text-slate-500">+{Math.max(1, Math.round(p.detourSeconds / 60))} min</span> : null}
                    </button>
                  ))}
                </div>
              ) : (
                <button type="button" onClick={() => setAdding(true)} className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#2563eb] hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add stop
                </button>
              )
            ) : null}
          </div>

          <div className="px-4 pb-4 pt-1">
            <Button variant="primary" size="lg" className="w-full rounded-full" onClick={onGo}>
              <Navigation2 className="h-4 w-4" /> GO
            </Button>
          </div>
        </>
      ) : (
        <p className="px-4 py-6 text-center text-[13px] text-slate-500">Calculating route…</p>
      )}
    </motion.div>
  );
}
