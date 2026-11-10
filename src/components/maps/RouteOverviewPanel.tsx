import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Bike, BusFront, Car, Check, ChevronDown, Clapperboard, Footprints, MapPin, MessageCircle, Navigation2, Plus, Share2, TrainFront, X } from "lucide-react";
import { useState } from "react";
import { openingState } from "../../../lib/maps/openingHours";
import { Highlight } from "./Highlight";
import { CATEGORY_ICONS, MANEUVER_ICON } from "./mapsIcons";
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
  onMoveStop?: (index: number, delta: -1 | 1) => void;
  /** Hands the trip to Clyra: it builds the stops, order and timings. */
  onPlanWithClyra?: () => void;
  fetchSuggestions: (query: string) => Promise<ClyraPlace[]>;
  fetchAlongRoute: (category: string) => Promise<ClyraPlace[]>;
  /** Live navigation: follows the real position and reroutes if you leave the route. */
  onGo: () => void;
  /** A cinematic flight along the route, to preview it. */
  onFly?: () => void;
  /** Steps of the active route for the details list. */
  showSteps?: boolean;
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
  onMoveStop,
  onPlanWithClyra,
  fetchSuggestions,
  fetchAlongRoute,
  onGo,
  onFly,
  onClose,
}: RouteOverviewPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ClyraPlace[]>([]);
  const [alongLabel, setAlongLabel] = useState<string | null>(null);
  const [alongLoading, setAlongLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const isTransit = activeMode === "transit";
  const canStop = !isTransit && Boolean(route) && stops.length < 8;

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

  const hoursPill = (p: ClyraPlace) => {
    const h = openingState(p.openingHours?.raw);
    if (h.state === "open") return <span className="mx-pill" data-tone="ok">Open{h.closesAt ? ` · until ${h.closesAt}` : ""}</span>;
    if (h.state === "open24") return <span className="mx-pill" data-tone="ok">Open 24 hours</span>;
    if (h.state === "closed") return <span className="mx-pill" data-tone="bad">Closed{h.opensAt ? ` · opens ${h.opensAt}` : ""}</span>;
    return null;
  };
  const sub = (p: ClyraPlace) => [p.categories?.[0]?.replace(/_/g, " "), p.address || p.locality].filter(Boolean).join(" · ");

  const fastest = alternatives.length ? alternatives.reduce((a, b) => (b.durationSeconds < a.durationSeconds ? b : a)).id : route?.id;
  /** The road a route spends the most distance on: Apple Maps' "via …" line. */
  const viaRoad = (r: Route) => {
    const byRoad = new Map<string, number>();
    for (const st of r.steps) if (st.roadName) byRoad.set(st.roadName, (byRoad.get(st.roadName) ?? 0) + st.distanceMeters);
    let best = ""; let bestM = 0;
    for (const [name, m] of byRoad) if (m > bestM) { best = name; bestM = m; }
    return best ? `via ${best}` : "";
  };
  const modeWord = activeMode === "walk" ? "Walk" : activeMode === "bike" ? "Cycle" : "Drive";

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Directions"
      className="mx-sheet mx-sheet--auto mx-dir"
    >
      <div className="mx-dir__head">
        <h3>Directions</h3>
        <div className="flex items-center">
          <button type="button" aria-label="Share trip" onClick={() => void share()} className="mx-icon-btn">
            {copied ? <Check size={16} color="#15803d" /> : <Share2 size={16} />}
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="mx-icon-btn"><X size={16} /></button>
        </div>
      </div>

      <div className="mx-scroll">
        <div className="mx-way" role="list" aria-label="Route">
          <div className="mx-way__row" role="listitem">
            <span className="mx-way__pin" data-kind="start" aria-hidden />
            <span className="mx-way__text"><b>My Location</b></span>
            <span className="mx-way__tag">From</span>
          </div>
          {stops.map((st, i) => {
            const Icon = CATEGORY_ICONS[st.categories?.[0] ?? ""] ?? MapPin;
            return (
              <div key={`${st.id}-${i}`} className="mx-way__row mx-in" role="listitem">
                <span className="mx-way__pin" data-kind="stop"><Icon size={11} /></span>
                <span className="mx-way__text">
                  <b>{st.name}</b>
                  <span>{sub(st)}</span>
                  {hoursPill(st) ? <span style={{ marginTop: 3 }}>{hoursPill(st)}</span> : null}
                </span>
                <span className="mx-trip__actions">
                  {onMoveStop ? (
                    <>
                      <button type="button" disabled={i === 0} aria-label={`Move ${st.name} earlier`} onClick={() => onMoveStop(i, -1)} className="mx-icon-btn"><ArrowUp size={14} /></button>
                      <button type="button" disabled={i === stops.length - 1} aria-label={`Move ${st.name} later`} onClick={() => onMoveStop(i, 1)} className="mx-icon-btn"><ArrowDown size={14} /></button>
                    </>
                  ) : null}
                  <button type="button" aria-label={`Remove stop ${st.name}`} onClick={() => onRemoveStop(i)} className="mx-icon-btn"><X size={14} /></button>
                </span>
              </div>
            );
          })}
          <div className="mx-way__row" role="listitem">
            <span className="mx-way__pin" data-kind="end" aria-hidden><MapPin size={11} /></span>
            <span className="mx-way__text"><b>{destinationName}</b></span>
            <span className="mx-way__tag">To</span>
          </div>
        </div>

        <div className="mx-dir__modes" role="group" aria-label="Travel mode">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={activeMode === id} aria-label={label} title={label} onClick={() => onModeChange(id)}>
              <Icon size={18} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {isTransit ? (
          <div className="flex flex-col gap-2 px-4 pb-4">
            <div className="flex items-center gap-2">
              <select
                aria-label="Transit time"
                value={transitWhen.kind}
                onChange={(e) => onTransitWhen({ kind: e.target.value as TransitWhen["kind"], time: transitWhen.time })}
                className="mx-input !w-auto"
              >
                <option value="now">Leave now</option>
                <option value="depart">Depart at</option>
                <option value="arrive">Arrive by</option>
              </select>
              {transitWhen.kind !== "now" ? (
                <input type="datetime-local" aria-label="Transit date and time" value={transitWhen.time ?? ""} onChange={(e) => onTransitWhen({ kind: transitWhen.kind, time: e.target.value })} className="mx-input min-w-0 flex-1" />
              ) : null}
            </div>
            {transit?.loading ? <p className="mx-sub py-6 text-center">Finding transit options…</p> : null}
            {!transit?.loading && !transit?.itineraries.length ? (
              <p className="mx-sub py-6 text-center">No transit options found for this trip. Public transport data may not cover this area; try Walk or Drive.</p>
            ) : null}
            {transit?.itineraries.map((it) => (
              <button key={it.id} type="button" aria-pressed={it.id === transit.selectedId} onClick={() => onSelectItinerary(it.id)} className="mx-alt !w-full !p-3">
                <div className="flex items-baseline justify-between">
                  <b style={{ fontSize: 15 }}>{formatDuration(it.durationSeconds)}</b>
                  <span>{clock(it.startTime)} – {clock(it.endTime)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {it.legs.map((l, i) =>
                    l.mode === "WALK" ? (
                      <span key={i} className="flex items-center gap-0.5 text-[11px] text-[#6b6f76]"><Footprints size={12} />{Math.max(1, Math.round(l.durationSeconds / 60))}</span>
                    ) : (
                      <span key={i} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ background: l.color ?? modeColor(l.mode) }}>
                        {l.mode === "SUBWAY" || l.mode.includes("RAIL") ? <TrainFront size={12} /> : <BusFront size={12} />}
                        {l.routeName ?? l.mode.toLowerCase()}
                      </span>
                    ),
                  )}
                </div>
                {it.id === transit.selectedId ? (
                  <ol className="mt-3 space-y-2 border-l border-[rgba(16,18,24,.12)] pl-3">
                    {it.legs.map((l, i) => (
                      <li key={i} className="text-[12px] text-[#6b6f76]">
                        <span className="font-semibold text-[#0d0d0d]">{clock(l.startTime)} {l.mode === "WALK" ? "Walk" : `${l.routeName ?? l.mode.toLowerCase()}${l.headsign ? ` to ${l.headsign}` : ""}`}</span>
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
            <div className="mx-routes" role="radiogroup" aria-label="Route options">
              {(alternatives.length ? alternatives : [route]).map((alt) => {
                const on = alt.id === route.id;
                return (
                  <button key={alt.id} type="button" role="radio" aria-checked={on} onClick={() => onSelectAlternative(alt)} className="mx-route" data-on={on}>
                    <span className="mx-route__time">{formatDuration(alt.durationSeconds)}</span>
                    <span className="mx-route__meta">
                      {formatDistance(alt.distanceMeters)}{viaRoad(alt) ? ` · ${viaRoad(alt)}` : ""}
                    </span>
                    <span className="mx-route__tags">
                      {alt.id === fastest ? <span className="mx-pill" data-tone="ok">Fastest</span> : null}
                      <span className="mx-route__eta">Arrive {formatArrival(alt.durationSeconds)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {canStop ? (
              <div className="px-4 pb-2">
                {adding ? (
                  <div className="mx-in rounded-2xl p-2" style={{ background: "var(--mx-fill)" }}>
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setAlongLabel(null);
                        if (e.target.value.trim().length >= 2) void fetchSuggestions(e.target.value.trim()).then(setSuggestions);
                        else setSuggestions([]);
                      }}
                      placeholder="Search for a place to add"
                      className="mx-input !bg-white"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {STOP_CATEGORIES.map((c) => (
                        <button key={c.id} type="button" onClick={() => void runAlong(c.id, c.label)} className="mx-pill cursor-pointer !bg-white hover:!bg-[#eceef1]">
                          {c.label} on the way
                        </button>
                      ))}
                    </div>
                    {alongLoading ? <p className="mx-sub px-1 py-2">Looking along your route…</p> : null}
                    {alongLabel && !alongLoading && !suggestions.length ? <p className="mx-sub px-1 py-2">No {alongLabel.toLowerCase()} found along this route.</p> : null}
                    {suggestions.slice(0, 6).map((p) => (
                      <button key={p.id} type="button" className="mx-row !px-2 !py-1.5" onClick={() => { onAddStop(p); setAdding(false); setQuery(""); setSuggestions([]); }}>
                        <span className="mx-row__body">
                          <span className="mx-row__title"><Highlight text={p.name ?? ""} query={query} /></span>
                          <span className="mx-row__meta">{sub(p)}</span>
                        </span>
                        {p.detourSeconds != null ? <span className="mx-pill" data-tone="accent">+{Math.max(1, Math.round(p.detourSeconds / 60))} min</span> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" className="mx-addchip" onClick={() => setAdding(true)}><Plus size={12} /> Add stop</button>
                    {STOP_CATEGORIES.slice(0, 3).map((c) => (
                      <button key={c.id} type="button" className="mx-addchip" onClick={() => { setAdding(true); void runAlong(c.id, c.label); }}>{c.label}</button>
                    ))}
                    {onPlanWithClyra ? <button type="button" onClick={onPlanWithClyra} className="mx-link ml-auto"><MessageCircle size={12} /> Plan with Clyra</button> : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="px-4 pb-3 pt-1">
              <button type="button" className="mx-dir__details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
                Route details
                <ChevronDown size={14} style={{ transform: detailsOpen ? "rotate(180deg)" : "none", transition: "transform .25s cubic-bezier(.22,1,.36,1)" }} />
              </button>
              <AnimatePresence initial={false}>
                {detailsOpen ? (
                  <motion.ol
                    key="steps"
                    className="mx-steplist"
                    style={{ overflow: "hidden" }}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {route.steps.map((st, i) => {
                      const Icon = MANEUVER_ICON[st.type] ?? MANEUVER_ICON.continue;
                      return (
                        <li key={i}>
                          <span className="mx-steplist__icon"><Icon size={14} /></span>
                          <span className="mx-steplist__text">
                            <b>{st.instruction}</b>
                            {st.roadName ? <span>{st.roadName}</span> : null}
                          </span>
                          <span className="mx-steplist__dist">{formatDistance(st.distanceMeters)}</span>
                        </li>
                      );
                    })}
                  </motion.ol>
                ) : null}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <p className="mx-sub px-4 py-8 text-center">Calculating route…</p>
        )}
      </div>

      {route && !isTransit ? (
        <div className="mx-dir__bar">
          <button type="button" className="mx-go" onClick={onGo}>
            <Navigation2 size={16} fill="currentColor" /> Go
            <small>{modeWord} · live location</small>
          </button>
          {onFly ? (
            <button type="button" className="mx-fly" onClick={onFly} title="A cinematic flight along the route">
              <Clapperboard size={16} /> Fly route
            </button>
          ) : null}
        </div>
      ) : null}
    </motion.section>
  );
}
