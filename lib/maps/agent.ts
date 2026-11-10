/** Clyra Maps conversational agent. The model decides which typed tools to call;
 * every fact it reports comes from a tool result, and every map change is an
 * action from a fixed list that the client validates. The model never gets
 * renderer access or arbitrary code execution.
 *
 * Loop: model -> tool calls -> tool results -> model … until a plain answer,
 * capped at MAX_STEPS. Identical tool calls in one run are answered from the
 * first result, and cancellation propagates to the model request. */
import type { ClyraPlace, Coordinate, Route, TravelMode } from "./types";
import type { IdentifyResult } from "./identify";
import type { PlaceInfo } from "./placeInfo";
import type { PlaceReviews } from "./reviews";
import { openingState } from "./openingHours";
import { haversineMeters } from "./providers";
import type { TransitItinerary } from "./transit";
import type { EnrichedPlace } from "./placeEnrich";

const MAX_STEPS = 12;

export interface AgentContext {
  center?: Coordinate;
  userLocation?: Coordinate;
  visibleBounds?: [Coordinate, Coordinate];
  selectedPlace?: ClyraPlace;
  selectedPoint?: Coordinate;
  activeRoute?: Route;
  /** The stops of the trip on the map, in order, and its final destination. */
  stops?: ClyraPlace[];
  destination?: ClyraPlace;
  shownPlaces?: ClyraPlace[];
  mode?: TravelMode;
}

export interface WeatherSummary {
  location: string;
  currentC: number;
  condition: string;
  rainChancePercent?: number;
  days: Array<{ date: string; highC: number; lowC: number; rainChancePercent: number; condition: string }>;
}

export interface AgentDeps {
  searchPlaces(query: string, near?: Coordinate): Promise<ClyraPlace[]>;
  searchNearby(center: Coordinate, category: string): Promise<ClyraPlace[]>;
  findAlongRoute(route: Route, category: string): Promise<ClyraPlace[]>;
  route(origin: Coordinate, destination: Coordinate, mode: TravelMode, avoidTolls: boolean, via: Coordinate[]): Promise<Route | null>;
  weather(at: Coordinate): Promise<WeatherSummary | null>;
  identify(at: Coordinate): Promise<IdentifyResult>;
  placeInfo(name: string, at: Coordinate): Promise<PlaceInfo>;
  reviews(osmId: string | undefined): Promise<PlaceReviews | null>;
  webSearch(query: string): Promise<string>;
  /** Photos, weekly hours and ratings from the best available source. */
  enrich(place: ClyraPlace): Promise<EnrichedPlace | null>;
  /** The readable text of a web page (a place's own site, a menu page). */
  readPage(url: string): Promise<string>;
  /** Opening hours and ratings the open web states about a place. */
  webFacts(input: { name: string; locality?: string; website?: string }): Promise<{ hours?: { weekly: Array<{ day: string; text: string }>; source: string; url: string }; ratings: Array<{ source: string; value: number; count?: number; url: string }> }>;
  transit(origin: Coordinate, destination: Coordinate, when?: string, arriveBy?: boolean): Promise<TransitItinerary[]>;
}

export type MapAction =
  | { type: "show_places"; places: ClyraPlace[]; title?: string }
  | { type: "select_place"; place: ClyraPlace }
  | { type: "set_route"; route: Route; destinationName: string; destination?: ClyraPlace; stops?: ClyraPlace[] }
  | { type: "fit_results" }
  | { type: "clear_results" }
  | { type: "zoom"; delta: 1 | -1 }
  | { type: "show_comparison"; rows: ComparisonRow[] }
  | { type: "save_preference"; key: "travel_mode" | "avoid_tolls"; value: string | boolean }
  | { type: "show_transit"; itineraries: TransitItinerary[]; destinationName: string; destination: Coordinate }
  | { type: "map_command"; command: MapCommand }
  | { type: "add_to_guide"; place: ClyraPlace; guide: string }
  | { type: "edit_trip"; op: "add_stop" | "remove_stop" | "clear" | "set_mode"; place?: ClyraPlace; index?: number; mode?: TravelMode }
  | { type: "save_place"; place: ClyraPlace }
  | { type: "set_slot"; slot: "home" | "work"; place: ClyraPlace }
  | { type: "share"; text: string };

export type MapCommand = "satellite" | "default_map" | "driving_map" | "tilt_3d" | "flat_2d" | "flyover" | "stop_flyover" | "start_navigation" | "look_around" | "locate_me" | "offline_download";

export interface ComparisonRow {
  name: string;
  distanceKm?: number;
  openNow: string;
  hours?: string;
  phone: boolean;
  website: boolean;
  reviews: string;
}

export type AgentEvent =
  | { type: "status"; label: string }
  | { type: "tool"; name: string; ok: boolean; summary: string; /** what was done, in words: "Searched for “oysters”" */ label?: string }
  | { type: "actions"; actions: MapAction[] }
  | { type: "final"; reply: string }
  | { type: "error"; message: string };

const CATEGORIES = ["food", "coffee", "petrol", "parking", "groceries", "hotels", "attractions", "pharmacy", "hospitals", "ev-charging", "transport", "atm", "bank", "park", "toilets", "school"];

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_places",
      description: "Search real place names and addresses (OpenStreetMap). Use for named places, businesses and addresses. Results are shown on the map and numbered result_1, result_2 ….",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_nearby",
      description: "Find real places of a category around the user's current view centre (OpenStreetMap).",
      parameters: { type: "object", properties: { category: { type: "string", enum: CATEGORIES } }, required: ["category"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_along_route",
      description: "Find places of a category beside the active route, ranked by detour. Requires an active route.",
      parameters: { type: "object", properties: { category: { type: "string", enum: CATEGORIES } }, required: ["category"] },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_point",
      description: "Identify what is at a map point: a place, an address, or nothing recognised. Defaults to the currently selected point.",
      parameters: { type: "object", properties: { lat: { type: "number" }, lng: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "inspect_place",
      description: "Get full real details for a place: address, opening hours and whether open now, phone, website, description, reviews. ref is result_N or 'selected'.",
      parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_route",
      description: "Calculate a real route from the user's location to a result or the selected place, through optional stops in the order given, and draw it on the map. ref is result_N or 'selected'; via lists intermediate stops (result_N). To add or remove a stop, call again with the complete updated list. Toll avoidance is NOT enforced by the current routing provider; the result says so.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          via: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["drive", "walk", "bike"] },
          avoid_tolls: { type: "boolean" },
        },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan_trip",
      description: "Plan a multi-stop trip in one call. stops lists every place to visit, each as a search phrase ('Bondi Beach', 'a coffee shop in Surry Hills') or a result_N reference. The last item is the final destination. Each is resolved to a real place, optionally reordered to the shortest sensible order (optimize), routed from the user's location, drawn on the map and shown in the trip panel with opening hours. Use this for itineraries, day plans and errands; use get_route for a single destination.",
      parameters: {
        type: "object",
        properties: {
          stops: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["drive", "walk", "bike"] },
          optimize: { type: "boolean" },
          keep_last: { type: "boolean", description: "Keep the last stop as the final destination when optimizing (default true)." },
        },
        required: ["stops"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_result",
      description: "Select a result on the map so its details panel opens. ref is result_N.",
      parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "map_control",
      description: "Map actions: zoom, fit/clear results, switch the map style (satellite, default, driving), tilt to 3D or back to 2D, start/stop a Flyover tour, start navigation on the active route, open Look Around street imagery, centre on the user's location, or download the visible area for offline use.",
      parameters: {
        type: "object",
        properties: { action: { type: "string", enum: ["zoom_in", "zoom_out", "fit_results", "clear_results", "satellite", "default_map", "driving_map", "tilt_3d", "flat_2d", "flyover", "stop_flyover", "start_navigation", "look_around", "locate_me", "offline_download"] } },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transit",
      description: "Plan a public-transport trip (bus, train, metro, tram, ferry) from the user's location to a result or the selected place, using real timetables. Shows the options in the directions panel. when is an ISO time (optional); arrive_by makes it an arrival time.",
      parameters: { type: "object", properties: { ref: { type: "string" }, when: { type: "string" }, arrive_by: { type: "boolean" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_guide",
      description: "Add a place to one of the user's Guides (creates the guide if it doesn't exist). Use when the user asks to save a place to a list or guide.",
      parameters: { type: "object", properties: { ref: { type: "string" }, guide: { type: "string" } }, required: ["ref", "guide"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Current weather and the next days' forecast at a result, the selected place, or the user's location. ref is result_N, 'selected' or 'here'.",
      parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_places",
      description: "Compare up to 4 results side by side: distance, opening state, hours, phone, website, reviews. refs are result_N values.",
      parameters: { type: "object", properties: { refs: { type: "array", items: { type: "string" } } }, required: ["refs"] },
    },
  },
  {
    type: "function",
    function: {
      name: "save_preference",
      description: "Remember a travel preference for future routes when the user asks you to (e.g. prefer toll-free routes, a travel mode).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", enum: ["travel_mode", "avoid_tolls"] },
          value: { type: "string" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_place",
      description: "Research a place on the live web: its menu (and whether a specific dish or drink is served, with prices), reviews and what people say, opening times, booking, or anything else the map data lacks. Pass ref (result_N or 'selected') or a place name in query, the topic, and item when the user asks about a specific dish, product or service. Report only what the pages say and say which source it came from.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          query: { type: "string" },
          topic: { type: "string", enum: ["menu", "reviews", "hours", "prices", "booking", "general"] },
          item: { type: "string" },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_website",
      description: "Open a place's own website (or any URL) and read it: opening hours, menu, services, prices, contact and booking details. ref is result_N or 'selected'; or pass url.",
      parameters: { type: "object", properties: { ref: { type: "string" }, url: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "place_reviews",
      description: "Look up what people say about a place: star ratings and review counts from review sites, plus open reviews. ref is result_N or 'selected'.",
      parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "check_hours",
      description: "Check whether several places are open now (or when they open/close), from map data, their own sites and the web. Use for 'what's open late', 'is X open', and before building a plan around opening times. refs are result_N values.",
      parameters: { type: "object", properties: { refs: { type: "array", items: { type: "string" } } }, required: ["refs"] },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_trip",
      description: "Change the trip already on the map: add a stop (ref), remove a stop (index, 1-based), clear the route, or switch travel mode. Use plan_trip instead to build a whole new trip.",
      parameters: {
        type: "object",
        properties: { op: { type: "string", enum: ["add_stop", "remove_stop", "clear", "set_mode"] }, ref: { type: "string" }, index: { type: "number" }, mode: { type: "string", enum: ["drive", "walk", "bike", "transit"] } },
        required: ["op"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "travel_times",
      description: "Work out how long it takes (and how far) to get to several places, from the user's location or from another place. refs are result_N values; from is 'here' or a result_N.",
      parameters: { type: "object", properties: { refs: { type: "array", items: { type: "string" } }, from: { type: "string" }, mode: { type: "string", enum: ["drive", "walk", "bike"] } }, required: ["refs"] },
    },
  },
  {
    type: "function",
    function: {
      name: "save_place",
      description: "Save a place to the user's favourites. ref is result_N or 'selected'.",
      parameters: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_home_or_work",
      description: "Set a place as the user's Home or Work, for quick directions later.",
      parameters: { type: "object", properties: { ref: { type: "string" }, slot: { type: "string", enum: ["home", "work"] } }, required: ["ref", "slot"] },
    },
  },
  {
    type: "function",
    function: {
      name: "share_trip",
      description: "Put a shareable link to a place, or to the current trip, on the user's clipboard.",
      parameters: { type: "object", properties: { ref: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the current public web for information the map data cannot answer (events, closures, news). Cite it as web information, not map data.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
];

interface ToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

async function callModel(messages: ToolMessage[], signal: AbortSignal, tools: typeof TOOLS): Promise<{ content: string | null; toolCalls: NonNullable<ToolMessage["tool_calls"]> } | { error: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.MY_LLM_API_KEY;
  if (!apiKey) return { error: "Clyra AI isn't configured on this server yet (no model API key)." };
  const base = String(process.env.MY_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.MY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
        temperature: 0.2,
        max_tokens: 1500,
        messages,
        tools,
        tool_choice: "auto",
      }),
      signal,
    });
    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: NonNullable<ToolMessage["tool_calls"]> } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      // Provider text (request ids, policy codes) is logged, not shown to the user.
      console.warn("[maps.agent] model request failed", res.status, payload?.error?.message);
      return { error: /risk|policy|safety/i.test(payload?.error?.message ?? "") ? "The model declined that request. Try rephrasing it." : "The model is unavailable right now. Please try again." };
    }
    const msg = payload.choices?.[0]?.message;
    return { content: msg?.content ?? null, toolCalls: msg?.tool_calls ?? [] };
  } catch (err) {
    if (signal.aborted) throw err;
    return { error: "The model request failed. Please try again." };
  }
}

function describePlace(p: ClyraPlace, ref: string) {
  return {
    ref,
    name: p.name,
    category: p.categories?.[0],
    address: [p.address, p.locality].filter(Boolean).join(", ") || undefined,
    distanceMeters: p.distanceMeters != null ? Math.round(p.distanceMeters) : undefined,
    detourMinutes: p.detourSeconds != null ? Math.round(p.detourSeconds / 60) : undefined,
    openingHours: p.openingHours?.raw,
  };
}

export async function runMapsAgent(
  message: string,
  context: AgentContext,
  deps: AgentDeps,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const registry = new Map<string, ClyraPlace>();
  const actions: MapAction[] = [];
  const seenCalls = new Map<string, string>();
  let nextRef = 1;

  const register = (places: ClyraPlace[]) =>
    places.map((p) => {
      const ref = `result_${nextRef}`;
      nextRef += 1;
      registry.set(ref, p);
      return describePlace(p, ref);
    });
  // Places already on the map keep their references, so "the second one" works across turns.
  for (const p of context.shownPlaces ?? []) register([p]);

  const resolve = (ref: string | undefined): ClyraPlace | undefined => {
    if (!ref) return undefined;
    if (ref === "selected") return context.selectedPlace;
    return registry.get(ref);
  };

  const run = async (name: string, args: Record<string, any>): Promise<unknown> => {
    switch (name) {
      case "search_places": {
        const places = await deps.searchPlaces(String(args.query || ""), context.center);
        actions.push({ type: "show_places", places, title: `Results for “${args.query}”` });
        return { results: register(places) };
      }
      case "search_nearby": {
        const center = context.center;
        if (!center) return { error: "No map centre available." };
        const places = await deps.searchNearby(center, String(args.category));
        actions.push({ type: "show_places", places, title: String(args.category) });
        return { results: register(places) };
      }
      case "search_along_route": {
        if (!context.activeRoute) return { error: "There is no active route." };
        const places = await deps.findAlongRoute(context.activeRoute, String(args.category));
        actions.push({ type: "show_places", places, title: `${args.category} along your route` });
        return { results: register(places) };
      }
      case "identify_point": {
        const at: Coordinate | undefined =
          Number.isFinite(args.lat) && Number.isFinite(args.lng) ? [Number(args.lng), Number(args.lat)] : context.selectedPoint;
        if (!at) return { error: "No point selected." };
        const r = await deps.identify(at);
        return { kind: r.kind, place: r.place && describePlace(r.place, "identified"), address: r.address, nearby: register(r.nearby), sources: r.sources };
      }
      case "inspect_place": {
        const place = resolve(args.ref);
        if (!place) return { error: `Unknown reference ${args.ref}.` };
        const [info, reviews, enriched] = await Promise.all([
          deps.placeInfo(place.id.startsWith("pin-") ? "" : place.name ?? "", place.coordinates),
          deps.reviews(place.id.startsWith("osm-") ? place.id.replace(/^osm-/, "").replace("-", "/") : undefined),
          deps.enrich(place).catch(() => null),
        ]);
        const hours = openingState(place.openingHours?.raw);
        return {
          name: place.name,
          category: place.categories,
          address: place.address,
          phone: place.phone,
          website: place.website,
          openingHours: place.openingHours?.raw,
          openNow: hours.state === "unknown" ? "unknown (hours not parseable)" : hours,
          weeklyHours: enriched?.hours?.weekly?.map((d) => `${d.day}: ${d.text}`),
          ratings: enriched?.ratings?.length ? enriched.ratings.map((r) => ({ source: r.source, rating: r.value, count: r.count })) : reviews ? { rating: reviews.rating, count: reviews.count } : "no ratings found",
          priceLevel: enriched?.priceLevel,
          website: place.website ?? enriched?.website,
          description: info.summary,
          photoCount: Math.max(info.photos.length, enriched?.photos.length ?? 0),
          sources: ["OpenStreetMap", info.summary ? "Wikipedia" : null, enriched?.sources.length ? enriched.sources.join(", ") : null, reviews ? "Mangrove" : null].filter(Boolean),
        };
      }
      case "get_route": {
        const place = resolve(args.ref);
        if (!place) return { error: `Unknown reference ${args.ref}.` };
        const origin = context.userLocation ?? context.center;
        if (!origin) return { error: "No start location available." };
        const mode: TravelMode = (args.mode as TravelMode) || context.mode || "drive";
        const via = (Array.isArray(args.via) ? args.via : []).map((ref: string) => resolve(ref)?.coordinates).filter(Boolean) as Coordinate[];
        const route = await deps.route(origin, place.coordinates, mode, Boolean(args.avoid_tolls), via);
        if (!route) return { error: "No route could be calculated right now." };
        actions.push({ type: "set_route", route, destinationName: place.name ?? "Destination" });
        return {
          destination: place.name,
          stops: via.length,
          durationMinutes: Math.round(route.durationSeconds / 60),
          distanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
          tollAvoidance: args.avoid_tolls ? "requested, but not enforced by the current routing provider" : "not requested",
        };
      }
      case "plan_trip": {
        const origin = context.userLocation ?? context.center;
        if (!origin) return { error: "No start location available." };
        const wanted: string[] = (Array.isArray(args.stops) ? args.stops : []).map((x: unknown) => String(x)).filter(Boolean).slice(0, 9);
        if (wanted.length < 1) return { error: "Give at least one stop." };
        const resolved: ClyraPlace[] = [];
        const missing: string[] = [];
        for (const w of wanted) {
          const known = resolve(w);
          if (known) { resolved.push(known); continue; }
          const found = (await deps.searchPlaces(w, context.center))[0];
          if (found) { register([found]); resolved.push(found); } else missing.push(w);
        }
        if (!resolved.length) return { error: "None of those places could be found.", missing };
        let ordered = resolved;
        if (args.optimize && resolved.length > 2) {
          const keepLast = args.keep_last !== false;
          const last = keepLast ? resolved[resolved.length - 1] : undefined;
          const pool = keepLast ? resolved.slice(0, -1) : [...resolved];
          const out: ClyraPlace[] = [];
          let at: Coordinate = origin;
          while (pool.length) {
            let best = 0;
            for (let i = 1; i < pool.length; i += 1) if (haversineMeters(at, pool[i].coordinates) < haversineMeters(at, pool[best].coordinates)) best = i;
            const [next] = pool.splice(best, 1);
            out.push(next);
            at = next.coordinates;
          }
          ordered = last ? [...out, last] : out;
        }
        const destination = ordered[ordered.length - 1];
        const via = ordered.slice(0, -1);
        const mode: TravelMode = (args.mode as TravelMode) || context.mode || "drive";
        const route = await deps.route(origin, destination.coordinates, mode, false, via.map((p) => p.coordinates));
        if (!route) return { error: "No route could be calculated for these stops.", missing };
        actions.push({ type: "set_route", route, destinationName: destination.name ?? "Destination", destination, stops: via });
        return {
          mode,
          totalMinutes: Math.round(route.durationSeconds / 60),
          totalKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
          order: ordered.map((p, i) => ({
            n: i + 1,
            name: p.name,
            category: p.categories?.[0],
            address: [p.address, p.locality].filter(Boolean).join(", ") || undefined,
            openNow: (() => { const h = openingState(p.openingHours?.raw); return h.state === "unknown" ? "unknown" : h.state === "open" ? `open until ${h.closesAt}` : h.state === "open24" ? "open 24 hours" : "closed"; })(),
          })),
          unresolved: missing.length ? missing : undefined,
        };
      }
      case "get_transit": {
        const dest = resolve(args.ref) ?? context.selectedPlace ?? null;
        const origin = context.userLocation ?? context.center;
        if (!dest || !origin) return { error: "Need a destination and a starting location." };
        const itineraries = await deps.transit(origin, dest.coordinates, typeof args.when === "string" ? args.when : undefined, Boolean(args.arrive_by));
        if (!itineraries.length) return { error: "No public transport options were found for this trip. Transit data may not cover the area; walking or driving may be better." };
        actions.push({ type: "show_transit", itineraries, destinationName: dest.name ?? "Destination", destination: dest.coordinates });
        return {
          source: "Transitous open transit data",
          options: itineraries.map((it) => ({
            minutes: Math.round(it.durationSeconds / 60),
            departs: it.startTime,
            arrives: it.endTime,
            transfers: it.transfers,
            walkMinutes: Math.round(it.walkSeconds / 60),
            legs: it.legs.filter((l) => l.mode !== "WALK").map((l) => `${l.mode} ${l.routeName ?? ""} ${l.from.name} → ${l.to.name}`.trim()),
          })),
        };
      }
      case "add_to_guide": {
        const place = resolve(args.ref) ?? context.selectedPlace ?? null;
        const guide = String(args.guide ?? "").trim();
        if (!place || !guide) return { error: "Need a place and a guide name." };
        actions.push({ type: "add_to_guide", place, guide });
        return { added: place.name, guide };
      }
      case "get_weather": {
        const at = args.ref === "here" ? context.userLocation ?? context.center : resolve(args.ref)?.coordinates ?? context.selectedPoint;
        if (!at) return { error: "No location to check weather for." };
        const w = await deps.weather(at);
        return w ? { source: "Clyra weather provider", ...w } : { error: "Weather is unavailable right now." };
      }
      case "compare_places": {
        const picked = (Array.isArray(args.refs) ? args.refs : []).map((r: string) => resolve(r)).filter(Boolean) as ClyraPlace[];
        if (picked.length < 2) return { error: "Pick at least two results to compare." };
        const from = context.userLocation ?? context.center;
        const rows: ComparisonRow[] = [];
        for (const p of picked.slice(0, 4)) {
          const h = openingState(p.openingHours?.raw);
          rows.push({
            name: p.name ?? "Place",
            distanceKm: from ? Math.round((haversineMeters(from, p.coordinates) / 1000) * 10) / 10 : undefined,
            openNow: h.state === "open" ? `Open until ${h.closesAt}` : h.state === "open24" ? "Open 24 hours" : h.state === "closed" ? "Closed" : "Hours unknown",
            hours: p.openingHours?.raw,
            phone: Boolean(p.phone),
            website: Boolean(p.website),
            reviews: "no open reviews",
          });
        }
        actions.push({ type: "show_comparison", rows });
        return { rows };
      }
      case "save_preference": {
        const key = args.key === "avoid_tolls" ? "avoid_tolls" : "travel_mode";
        const value = key === "avoid_tolls" ? /^(true|yes)$/i.test(String(args.value)) : String(args.value);
        actions.push({ type: "save_preference", key, value });
        return { saved: key, value };
      }
      case "select_result": {
        const place = resolve(args.ref);
        if (!place) return { error: `Unknown reference ${args.ref}.` };
        actions.push({ type: "select_place", place });
        return { selected: place.name };
      }
      case "map_control": {
        const a = String(args.action);
        if (a === "zoom_in") actions.push({ type: "zoom", delta: 1 });
        else if (a === "zoom_out") actions.push({ type: "zoom", delta: -1 });
        else if (a === "fit_results") actions.push({ type: "fit_results" });
        else if (a === "clear_results") actions.push({ type: "clear_results" });
        else if (["satellite", "default_map", "driving_map", "tilt_3d", "flat_2d", "flyover", "stop_flyover", "look_around", "locate_me", "offline_download"].includes(a)) actions.push({ type: "map_command", command: a as MapCommand });
        else if (a === "start_navigation") {
          if (!context.activeRoute) return { error: "There is no active route to navigate. Calculate a route first." };
          actions.push({ type: "map_command", command: "start_navigation" });
        } else return { error: "Unsupported map action." };
        return { done: a };
      }
      case "research_place": {
        const place = resolve(args.ref);
        const name = place?.name || String(args.query || "").trim();
        if (!name) return { error: "Say which place to research." };
        const where = [place?.locality, place?.region].filter(Boolean).join(" ");
        const topic = String(args.topic || "general");
        const item = String(args.item || "").trim();
        const q = [name, where, topic === "general" ? "" : topic, item].filter(Boolean).join(" ");
        const text = await deps.webSearch(q);
        return { place: name, topic, item: item || undefined, webResults: text.slice(0, 6000), note: "Live web pages, not map data. Quote only what they say; if the item or price isn't on the pages, say so." };
      }
      case "read_website": {
        const place = resolve(args.ref);
        let url = String(args.url || "").trim() || place?.website || "";
        if (!url && place) url = (await deps.enrich(place).catch(() => null))?.website ?? "";
        if (!/^https?:\/\//i.test(url)) return { error: place ? `${place.name} has no website on record. Try research_place.` : "Give a place or a URL." };
        const text = await deps.readPage(url);
        if (!text.trim()) return { error: "That page couldn't be read (it may block automated readers). Try research_place." };
        return { url, host: new URL(url).hostname.replace(/^www\./, ""), text: text.slice(0, 5500), note: "Text of the page. Quote only what it says." };
      }
      case "place_reviews": {
        const place = resolve(args.ref);
        if (!place) return { error: `Unknown reference ${args.ref}.` };
        const osm = place.id.startsWith("osm-") ? place.id.replace(/^osm-/, "").replace("-", "/") : undefined;
        const [facts, open] = await Promise.all([
          deps.webFacts({ name: place.name, locality: place.locality, website: place.website }).catch(() => null),
          deps.reviews(osm).catch(() => null),
        ]);
        const ratings = [...(facts?.ratings ?? []).map((r) => ({ source: r.source, rating: r.value, count: r.count, url: r.url })), ...(open ? [{ source: "Mangrove open reviews", rating: open.rating, count: open.count }] : [])];
        if (!ratings.length) return { place: place.name, ratings: [], note: "No ratings could be found for this place. Say so; do not guess." };
        return { place: place.name, ratings, note: "Each rating is quoted from the page named. Do not average them." };
      }
      case "check_hours": {
        const places = (Array.isArray(args.refs) ? args.refs : []).map((r: string) => resolve(r)).filter(Boolean).slice(0, 8) as ClyraPlace[];
        if (!places.length) return { error: "Give at least one place." };
        const today = new Date().toLocaleDateString("en-US", { weekday: "long" });
        const rows = await Promise.all(places.map(async (p) => {
          const own = openingState(p.openingHours?.raw);
          if (own.state === "open") return { name: p.name, status: `open until ${own.closesAt}`, source: "map data" };
          if (own.state === "open24") return { name: p.name, status: "open 24 hours", source: "map data" };
          if (own.state === "closed") return { name: p.name, status: `closed${own.opensAt ? `, opens ${own.opensAt}${own.opensOn ? ` ${own.opensOn}` : ""}` : ""}`, source: "map data" };
          const facts = await deps.webFacts({ name: p.name, locality: p.locality, website: p.website }).catch(() => null);
          const row = facts?.hours?.weekly.find((d) => d.day === today);
          return row ? { name: p.name, status: `today ${row.text}`, source: facts!.hours!.source } : { name: p.name, status: "hours not found", source: "none" };
        }));
        return { rows, note: "Times are local to the place. Say when hours could not be found." };
      }
      case "edit_trip": {
        const op = String(args.op);
        if (op === "clear") { actions.push({ type: "edit_trip", op: "clear" }); return { done: "cleared the route" }; }
        if (op === "set_mode") {
          const mode = String(args.mode || "") as TravelMode;
          if (!["drive", "walk", "bike", "transit"].includes(mode)) return { error: "Say which mode: drive, walk, bike or transit." };
          if (!context.activeRoute && !context.destination) return { error: "There is no trip on the map yet." };
          actions.push({ type: "edit_trip", op: "set_mode", mode });
          return { done: `switched to ${mode}` };
        }
        if (!context.activeRoute && !context.destination) return { error: "There is no trip on the map. Use plan_trip or get_route first." };
        if (op === "add_stop") {
          const place = resolve(args.ref);
          if (!place) return { error: `Unknown reference ${args.ref}.` };
          actions.push({ type: "edit_trip", op: "add_stop", place });
          return { done: `added ${place.name} as a stop` };
        }
        if (op === "remove_stop") {
          const index = Math.round(Number(args.index)) - 1;
          const stop = context.stops?.[index];
          if (!stop) return { error: `There is no stop number ${args.index}. The trip has ${context.stops?.length ?? 0} stops.` };
          actions.push({ type: "edit_trip", op: "remove_stop", index });
          return { done: `removed ${stop.name}` };
        }
        return { error: "Unsupported edit." };
      }
      case "travel_times": {
        const places = (Array.isArray(args.refs) ? args.refs : []).map((r: string) => resolve(r)).filter(Boolean).slice(0, 5) as ClyraPlace[];
        const from = args.from && args.from !== "here" ? resolve(args.from)?.coordinates : context.userLocation ?? context.center;
        if (!from) return { error: "No starting point available." };
        const mode: TravelMode = (args.mode as TravelMode) || context.mode || "drive";
        const rows = await Promise.all(places.map(async (p) => {
          const r = await deps.route(from, p.coordinates, mode, false, []).catch(() => null);
          return r ? { name: p.name, minutes: Math.round(r.durationSeconds / 60), km: Math.round((r.distanceMeters / 1000) * 10) / 10 } : { name: p.name, error: "no route" };
        }));
        return { mode, rows };
      }
      case "save_place": {
        const place = resolve(args.ref) ?? context.selectedPlace;
        if (!place) return { error: "Say which place." };
        actions.push({ type: "save_place", place });
        return { saved: place.name };
      }
      case "set_home_or_work": {
        const place = resolve(args.ref) ?? context.selectedPlace;
        const slot = args.slot === "work" ? "work" : "home";
        if (!place) return { error: "Say which place." };
        actions.push({ type: "set_slot", slot, place });
        return { set: slot, place: place.name };
      }
      case "share_trip": {
        const place = resolve(args.ref) ?? context.destination ?? context.selectedPlace;
        const origin = context.userLocation ?? context.center;
        const pts = [origin, ...(context.stops ?? []).map((s) => s.coordinates), place?.coordinates].filter(Boolean) as Coordinate[];
        const text = pts.length >= 2 && context.activeRoute
          ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${pts.map((c) => `${c[1].toFixed(5)},${c[0].toFixed(5)}`).join(";")}`
          : place ? `https://www.openstreetmap.org/?mlat=${place.coordinates[1]}&mlon=${place.coordinates[0]}#map=17/${place.coordinates[1]}/${place.coordinates[0]}` : "";
        if (!text) return { error: "Nothing to share yet." };
        actions.push({ type: "share", text });
        return { copied: true, link: text };
      }
      case "web_search":
        return { webResults: (await deps.webSearch(String(args.query || ""))).slice(0, 4000), note: "Web information, not map data." };
      default:
        return { error: `Unknown tool ${name}.` };
    }
  };

  const system = [
    "You are Clyra Maps, a geographic assistant inside a map app.",
    "Use tools for every place, route, distance, time, opening-hours or review fact. Never invent places, ratings, hours, prices or times.",
    "If a tool returns nothing or an error, say so plainly and suggest one concrete next step.",
    "Keep answers short. Name places in plain words (never print result_N or other internal references). When the user says 'the second one', use the result numbered 2 in the list you showed them.",
    "Say when information comes from web search rather than map data. If hours are unknown, say you couldn't verify them.",
    context.selectedPlace ? `The user has selected: ${context.selectedPlace.name ?? "a dropped pin"}.` : "",
    context.selectedPoint && !context.selectedPlace ? "The user has a point selected on the map (use identify_point or 'selected')." : "",
    context.activeRoute ? "A route is active; route-based search is available." : "",
    "You can also plan transit trips, change the map style, tilt to 3D, run a Flyover tour, start navigation, open Look Around, and add places to Guides. Do these when the user asks.",
    "You can help with anything about the world on the map: explain a place's history or what it is (inspect_place, web_search), plan a day out or an itinerary (search several categories, show the picks with show/compare, then route between them with via stops), find things along a journey, check weather for a trip, and answer travel questions. For anything current — events, news, closures, prices, opening of new places — use web_search. Chain as many tools as the request needs, then act on the map so the user can see the answer, not only read it.",
    "You can read a place's own website (read_website), check ratings (place_reviews), check what is open (check_hours), change the trip on the map (edit_trip), compare travel times (travel_times), save places, set Home/Work and share links. Use them whenever they answer the question, and chain several: for 'somewhere good and open now' search, check_hours, place_reviews, then recommend with the reason.",
    "When the user asks whether a place has a particular dish, drink, product or price, or wants menu, review or booking details, call research_place (topic and item) and answer from the pages; never guess a menu. For recommendations, search several candidates, inspect the best, then explain why each fits.",
    "For an itinerary, day out or several errands, call plan_trip once with every stop; then use inspect_place on stops the user asks about and mention opening hours that would clash with the plan. Offer to add, remove or reorder stops (plan_trip again with the full list).",
    "To go somewhere ('show me Paris', 'take me to the Eiffel Tower'), search for it and select the best result so the map flies there.",
  ]
    .filter(Boolean)
    .join("\n");

  // Only offer the point tool when there is a point to identify.
  const offeredTools = context.selectedPoint ? TOOLS : TOOLS.filter((t) => t.function.name !== "identify_point");

  // Results already on the map must be visible to the model, or "the first two" can't resolve.
  const onMap = [...registry.entries()]
    .map(([ref, p]) => `${ref}: ${p.name ?? "unnamed"}${p.categories?.[0] ? ` (${p.categories[0]})` : ""}${typeof p.distanceMeters === "number" ? `, ${Math.round(p.distanceMeters)} m away` : ""}`)
    .join("\n");
  const systemWithResults = onMap ? `${system}\nResults currently on the map (use these refs):\n${onMap}` : system;

  const messages: ToolMessage[] = [
    { role: "system", content: systemWithResults },
    { role: "user", content: message },
  ];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal.aborted) return;
    emit({ type: "status", label: step === 0 ? "Thinking…" : "Checking the results…" });
    const turn = await callModel(messages, signal, offeredTools);
    if (signal.aborted) return;
    if ("error" in turn) {
      emit({ type: "error", message: turn.error });
      return;
    }
    if (!turn.toolCalls.length) {
      if (actions.length) emit({ type: "actions", actions: actions.splice(0) });
      emit({ type: "final", reply: cleanReply(turn.content, registry) });
      return;
    }

    messages.push({ role: "assistant", content: turn.content ?? null, tool_calls: turn.toolCalls });
    for (const call of turn.toolCalls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const key = `${call.function.name}:${JSON.stringify(args)}`;
      let result: unknown;
      let ok = true;
      if (seenCalls.has(key)) {
        result = { note: "Already answered earlier in this request.", result: seenCalls.get(key) };
      } else {
        emit({ type: "status", label: describeCall(call.function.name, args, registry, context, false) });
        try {
          result = await run(call.function.name, args);
          ok = !(result && typeof result === "object" && "error" in (result as object));
        } catch (err) {
          if (signal.aborted) return;
          result = { error: "That lookup failed. The map data provider may be unavailable." };
          ok = false;
        }
        seenCalls.set(key, JSON.stringify(result));
      }
      emit({ type: "tool", name: call.function.name, ok, summary: summarise(result), label: describeCall(call.function.name, args, registry, context, true) });
      // Map changes go out as soon as the tool that produced them finishes, so
      // pins appear while the model is still working rather than at the end.
      if (actions.length) emit({ type: "actions", actions: actions.splice(0) });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  if (actions.length) emit({ type: "actions", actions: actions.splice(0) });
  emit({ type: "final", reply: "I reached my step limit before finishing. Try a narrower question." });
}

/** Internal result references are replaced with the place's name, so the user
 * never sees "result_5" even if the model echoes one. */
function cleanReply(content: string | null, registry: Map<string, ClyraPlace>): string {
  const text = (content || "").trim() || "Done.";
  return text.replace(/\bresult_(\d+)\b/g, (match) => registry.get(match)?.name ?? match);
}

function labelFor(name: string): string {
  switch (name) {
    case "search_places":
    case "search_nearby":
    case "search_along_route":
      return "Searching places…";
    case "inspect_place":
      return "Checking place details…";
    case "get_route":
    case "plan_trip":
      return "Planning the route…";
    case "identify_point":
      return "Identifying the point…";
    case "web_search":
      return "Searching the web…";
    case "research_place":
      return "Researching the place…";
    default:
      return "Working…";
  }
}

function summarise(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  if (typeof r.error === "string") return r.error;
  if (Array.isArray(r.webResults) || typeof r.webResults === "string") return "web sources read";
  if (Array.isArray(r.results)) return `${r.results.length} result${r.results.length === 1 ? "" : "s"}`;
  if (typeof r.currentC === "number") return `${r.currentC}°C, ${r.condition ?? ""}`.replace(/, $/, "");
  if (Array.isArray(r.rows)) return `${r.rows.length} places`;
  if (typeof r.saved === "string") return `saved ${r.saved}`;
  if (typeof r.name === "string") return r.name;
  if (typeof r.durationMinutes === "number") return `${r.durationMinutes} min`;
  if (typeof r.totalMinutes === "number") return `${Array.isArray(r.order) ? r.order.length : ""} stops · ${r.totalMinutes} min`.trim();
  return "done";
}

/** What a tool call is doing, in words the user can follow. `done` gives the past tense for the finished log. */
function describeCall(name: string, args: Record<string, any>, registry: Map<string, ClyraPlace>, context: AgentContext, done: boolean): string {
  const nameOf = (ref?: string) => (ref === "selected" ? context.selectedPlace?.name : ref ? registry.get(ref)?.name : undefined);
  const q = (v: unknown) => `“${String(v ?? "").slice(0, 60)}”`;
  const place = nameOf(args.ref) ?? (typeof args.query === "string" ? args.query : undefined) ?? "the place";
  const host = (u: unknown) => { try { return new URL(String(u)).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const v = (doing: string, did: string) => (done ? did : `${doing}…`);
  const stopsCount = Array.isArray(args.stops) ? args.stops.length : "";
  switch (name) {
    case "search_places": return v(`Searching for ${q(args.query)}`, `Searched for ${q(args.query)}`);
    case "search_nearby": return v(`Looking for ${args.category} nearby`, `Looked for ${args.category} nearby`);
    case "search_along_route": return v(`Looking for ${args.category} along your route`, `Looked for ${args.category} along your route`);
    case "inspect_place": return v(`Checking details for ${place}`, `Checked details for ${place}`);
    case "research_place": return args.item
      ? v(`Checking ${place} for ${q(args.item)}`, `Checked ${place} for ${q(args.item)}`)
      : v(`Researching ${args.topic ?? "details"} at ${place}`, `Researched ${args.topic ?? "details"} at ${place}`);
    case "read_website": {
      const target = host(args.url) || (nameOf(args.ref) ? `${nameOf(args.ref)}’s website` : "the website");
      return v(`Reading ${target}`, `Read ${target}`);
    }
    case "place_reviews": return v(`Looking at reviews for ${place}`, `Looked at reviews for ${place}`);
    case "check_hours": {
      const n = Array.isArray(args.refs) && args.refs.length > 1 ? ` for ${args.refs.length} places` : "";
      return v(`Checking opening hours${n}`, `Checked opening hours${n}`);
    }
    case "get_route": return v(`Finding a route to ${place}`, `Found a route to ${place}`);
    case "plan_trip": return v(`Planning a ${stopsCount} stop trip`, `Planned a ${stopsCount} stop trip`);
    case "edit_trip": {
      const op = String(args.op);
      return op === "add_stop" ? v(`Adding ${place} to your trip`, `Added ${place} to your trip`)
        : op === "remove_stop" ? v("Removing a stop", "Removed a stop")
        : op === "set_mode" ? v(`Switching to ${args.mode}`, `Switched to ${args.mode}`)
        : v("Clearing the route", "Cleared the route");
    }
    case "travel_times": return v("Working out travel times", "Worked out travel times");
    case "get_transit": return v(`Planning public transport to ${place}`, `Planned public transport to ${place}`);
    case "add_to_guide": return v(`Saving ${place} to “${args.guide}”`, `Saved ${place} to “${args.guide}”`);
    case "save_place": return v(`Saving ${place}`, `Saved ${place}`);
    case "set_home_or_work": return v(`Setting ${place} as ${args.slot}`, `Set ${place} as ${args.slot}`);
    case "share_trip": return v("Copying a share link", "Copied a share link");
    case "get_weather": return v(`Checking the weather${args.ref === "here" ? "" : ` at ${place}`}`, `Checked the weather${args.ref === "here" ? "" : ` at ${place}`}`);
    case "compare_places": return v("Comparing places", "Compared places");
    case "web_search": return v(`Searching the web for ${q(args.query)}`, `Searched the web for ${q(args.query)}`);
    case "identify_point": return v("Identifying the point", "Identified the point");
    case "select_result": return v(`Opening ${place}`, `Opened ${place}`);
    case "map_control": return v("Updating the map", "Updated the map");
    case "save_preference": return v("Saving a preference", "Saved a preference");
    default: return v("Working", "Done");
  }
}
