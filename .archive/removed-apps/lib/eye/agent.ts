/** Clyra Eye's assistant: answers questions about what is happening on Earth from Clyra Eye's own live data tools
 * (aircraft, ships, satellites, earthquakes, fires, weather, cyclones, launches, infrastructure, situation briefs)
 * plus web news, and shows each answer on the globe. Every fact comes from a tool result; the model never gets
 * renderer access, and the only thing it can change on screen is the globe's view, which the client validates. */

const MAX_STEPS = 8;

/** Tools the assistant may not use: plate-reader cameras track individual people's movements, and the rest are
 * plumbing for other hosts (panels, links, a one-off event pack). */
const EXCLUDED_TOOLS = new Set(["find_alpr_cameras", "panel_request", "show_in_gods_eye_view", "get_bhote_koshi_flood"]);

export interface EyeView {
  camera: { lat: number; lon: number; altitude_m?: number; heading_deg?: number; pitch_deg?: number };
  layers?: string[];
  style?: string | null;
  map?: string | null;
  follow?: { kind: string; id: string; cockpit?: boolean } | null;
}

export type EyeAgentEvent =
  | { type: "status"; label: string }
  | { type: "tool"; name: string; ok: boolean; summary: string }
  | { type: "view"; view: EyeView; label?: string }
  | { type: "final"; reply: string }
  | { type: "error"; message: string };

export interface EyeToolSpec { name: string; title?: string; description?: string; inputSchema?: Record<string, unknown> }

export interface EyeAgentDeps {
  listTools(): Promise<EyeToolSpec[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; data: Record<string, unknown> | null; isError: boolean }>;
  webSearch(query: string): Promise<string>;
}

export interface EyeAgentContext {
  /** Where the globe is looking now. */
  camera?: { lat: number; lon: number; altitude_m?: number };
  /** Layers currently shown. */
  layers?: string[];
  /** The user's own location, when known. */
  userLocation?: { lat: number; lon: number };
  /** Earlier turns of this conversation, oldest first. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface ToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

const LOCAL_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Search the current web for news and anything the live data tools cannot answer (what is happening and why, news reports, context). Say that the information comes from the web.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_on_globe",
      description: "Point the globe somewhere and choose what it shows. Use for 'show me', 'take me to', 'zoom to', or to frame an answer that has no view of its own. altitude_m is the camera height (about 2,000,000 for a country, 300,000 for a region, 30,000 for a city). layers are ids such as flights, military, satellites, ais-live-vessels, earthquakes, local-firms, fire-perimeters, weather-radar, weather-satellite, weather-lightning, weather-cyclones, wind, rocket-launches, traffic, transit, telegeography-submarine-cables, military-installations. follow tracks one aircraft (kind 'aircraft' or 'military_aircraft', id = ICAO24 hex) or satellite (kind 'satellite', id = NORAD id); following an aircraft flies to it and rides in its cockpit, rotating around it while its HUD shows the live data.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
          altitude_m: { type: "number" },
          layers: { type: "array", items: { type: "string" } },
          follow_kind: { type: "string", enum: ["aircraft", "military_aircraft", "satellite"] },
          follow_id: { type: "string" },
          label: { type: "string" },
        },
        required: ["lat", "lon"],
      },
    },
  },
];

async function callModel(messages: ToolMessage[], tools: unknown[], signal: AbortSignal) {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.MY_LLM_API_KEY;
  if (!apiKey) return { error: "Clyra AI isn't configured on this server yet (no model API key)." } as const;
  const base = String(process.env.MY_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.MY_LLM_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.3, max_tokens: 1400 }),
    signal,
  });
  if (!response.ok) return { error: `The model request failed (${response.status}).` } as const;
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolMessage["tool_calls"] } }> };
  const message = data.choices?.[0]?.message;
  return { content: message?.content ?? null, toolCalls: message?.tool_calls ?? [] } as const;
}

const STATUS: Record<string, string> = {
  aircraft_in_area: "Scanning the sky", find_aircraft: "Finding the aircraft", get_aircraft_track: "Tracing the flight",
  get_aircraft_info: "Looking up the aircraft", vessels_in_area: "Scanning shipping", find_vessel: "Finding the vessel",
  get_vessel_track: "Tracing the vessel", next_satellite_pass: "Predicting the pass", satellites_overhead: "Checking satellites overhead",
  get_earthquakes: "Checking earthquakes", get_active_fires: "Checking active fires", get_fire_perimeters: "Mapping fire perimeters",
  get_cyclones: "Tracking cyclones", get_weather_map: "Reading the weather", get_recent_launches: "Checking launches",
  get_traffic_flow: "Reading traffic", situation_brief: "Building a situation brief", military_awareness: "Reviewing military activity",
  find_infrastructure: "Finding infrastructure", find_submarine_cables: "Finding submarine cables", get_recent_imagery: "Finding satellite imagery",
  find_cctv_cameras: "Finding public cameras", get_terrain_height: "Measuring terrain", find_military_installations: "Finding installations",
  get_map_features: "Reading map features", web_search: "Searching the news", show_on_globe: "Moving the globe",
};

export async function runEyeAgent(message: string, context: EyeAgentContext, deps: EyeAgentDeps, emit: (event: EyeAgentEvent) => void, signal: AbortSignal) {
  emit({ type: "status", label: "Thinking" });
  let eyeTools: EyeToolSpec[] = [];
  try {
    eyeTools = (await deps.listTools()).filter((tool) => !EXCLUDED_TOOLS.has(tool.name));
  } catch {
    eyeTools = [];
  }
  const tools = [
    ...eyeTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: [tool.title, tool.description].filter(Boolean).join(". ").slice(0, 900),
        parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
      },
    })),
    ...LOCAL_TOOLS,
  ];
  const known = new Set(tools.map((tool) => tool.function.name));

  const where = context.camera ? `The globe is looking at ${context.camera.lat.toFixed(2)}, ${context.camera.lon.toFixed(2)}${context.camera.altitude_m ? ` from ${Math.round(context.camera.altitude_m / 1000)} km up` : ""}.` : "";
  const home = context.userLocation ? `The user is at ${context.userLocation.lat.toFixed(3)}, ${context.userLocation.lon.toFixed(3)} ("here", "near me").` : "";
  const system = [
    "You are Clyra Eye, a calm, precise assistant for a live 3D globe — like a briefing from an analyst who can see the whole planet.",
    "Answer from the live tools: aircraft, ships, satellites, earthquakes, fires, weather, cyclones, launches, traffic, infrastructure and situation briefs. Use web_search for news, context and anything the tools don't cover, and say when something comes from the web.",
    "Never invent numbers, positions, callsigns or events. If a tool returns nothing or fails, say so plainly and suggest a next step.",
    "Always show the answer on the globe: tool results usually include a view that is shown automatically; otherwise call show_on_globe. For 'what's happening' questions, prefer situation_brief for the area plus a web_search for news.",
    "For a specific flight or aircraft (flight number, callsign, tail/registration or ICAO24 hex), call find_aircraft first, then get_aircraft_info and get_aircraft_track — find_aircraft's view flies to the aircraft and rides in its cockpit, rotating around it while its HUD shows the live data. For a ship use find_vessel (its view flies to it); for a satellite use satellites_overhead or next_satellite_pass and follow its NORAD id.",
    "Areas take a place name when possible (e.g. {\"place\":\"Taiwan\"}). Keep replies short and scannable: a one-line headline, then a few bullet points with the key facts. Use plain names, local units, and UTC times written naturally.",
    where,
    home,
  ].filter(Boolean).join("\n");

  const messages: ToolMessage[] = [
    { role: "system", content: system },
    ...(context.history || []).slice(-8).map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) })),
    { role: "user", content: message },
  ];
  const cache = new Map<string, string>();

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (signal.aborted) return;
    const result = await callModel(messages, tools, signal).catch((error) => ({ error: error instanceof Error ? error.message : "The model request failed." }) as const);
    if ("error" in result) {
      emit({ type: "error", message: String(result.error) });
      return;
    }
    if (!result.toolCalls.length) {
      emit({ type: "final", reply: (result.content || "").trim() || "I couldn't find anything to report." });
      return;
    }
    messages.push({ role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      if (signal.aborted) return;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      emit({ type: "status", label: STATUS[name] || "Working" });
      const key = `${name}:${JSON.stringify(args)}`;
      let output = cache.get(key);
      if (output === undefined) {
        output = await runTool(name, args, known, deps, emit).catch((error) => JSON.stringify({ error: error instanceof Error ? error.message : "Tool failed." }));
        cache.set(key, output);
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: output.slice(0, 12000) });
    }
  }
  emit({ type: "final", reply: "That needed more steps than I can take in one go — try asking a narrower question." });
}

async function runTool(name: string, args: Record<string, unknown>, known: Set<string>, deps: EyeAgentDeps, emit: (event: EyeAgentEvent) => void): Promise<string> {
  if (!known.has(name)) return JSON.stringify({ error: `Unknown tool ${name}.` });
  if (name === "web_search") {
    const text = await deps.webSearch(String(args.query || ""));
    emit({ type: "tool", name, ok: Boolean(text), summary: String(args.query || "") });
    return JSON.stringify({ webResults: text.slice(0, 6000), note: "Web information, not live sensor data." });
  }
  if (name === "show_on_globe") {
    const lat = Number(args.lat), lon = Number(args.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return JSON.stringify({ error: "lat and lon are required." });
    const view: EyeView = {
      camera: { lat, lon, altitude_m: Number.isFinite(Number(args.altitude_m)) ? Number(args.altitude_m) : 800_000, pitch_deg: -90 },
      layers: Array.isArray(args.layers) ? args.layers.map(String) : undefined,
      follow:
        args.follow_kind && args.follow_id
          ? {
              kind: String(args.follow_kind),
              id: String(args.follow_id),
              ...(args.follow_kind === "aircraft" || args.follow_kind === "military_aircraft" ? { cockpit: true } : {}),
            }
          : null,
    };
    emit({ type: "view", view, label: typeof args.label === "string" ? args.label : undefined });
    emit({ type: "tool", name, ok: true, summary: typeof args.label === "string" ? args.label : "" });
    return JSON.stringify({ shown: true });
  }
  const result = await deps.callTool(name, args);
  const view = result.data && typeof result.data === "object" ? (result.data as { view?: EyeView }).view : undefined;
  if (view?.camera) emit({ type: "view", view });
  emit({ type: "tool", name, ok: !result.isError, summary: result.text.split("\n")[0].slice(0, 140) });
  // The model sees the summary and the rows, not the view plumbing.
  const data = result.data ? { ...result.data } : null;
  if (data) delete (data as { view?: unknown }).view;
  return JSON.stringify({ summary: result.text.slice(0, 1500), data });
}

/** Talks to the running Clyra Eye app's tool server (local only). */
export function createEyeToolClient(baseUrl: string) {
  let toolsCache: { at: number; tools: EyeToolSpec[] } | null = null;
  let nextId = 1;
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Clyra Eye's data service answered ${response.status}.`);
    const payload = (await response.json()) as { result?: Record<string, unknown>; error?: { message?: string } };
    if (payload.error) throw new Error(payload.error.message || "Clyra Eye's data service failed.");
    return payload.result || {};
  };
  return {
    async listTools() {
      if (toolsCache && Date.now() - toolsCache.at < 10 * 60_000) return toolsCache.tools;
      const result = await rpc("tools/list", {});
      const tools = (Array.isArray(result.tools) ? result.tools : []) as EyeToolSpec[];
      toolsCache = { at: Date.now(), tools };
      return tools;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      const result = await rpc("tools/call", { name, arguments: args }) as { content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
      return {
        text: (result.content || []).map((part) => part.text || "").join("\n").trim(),
        data: result.structuredContent ?? null,
        isError: Boolean(result.isError),
      };
    },
  };
}
