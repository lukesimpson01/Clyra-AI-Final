import type { LiveLayerId, TravelMode } from "../core/types";

export type MapCommand =
  | { type: "search"; query: string }
  | { type: "route"; destination: string; mode?: TravelMode; avoid?: { tolls?: boolean; motorways?: boolean; ferries?: boolean } }
  | { type: "toggle-layer"; layer: LiveLayerId }
  | { type: "toggle-3d"; value?: boolean }
  | { type: "fly"; destination: string }
  | { type: "overview" }
  | { type: "measure" }
  | { type: "ask-llm"; prompt: string };

const layers: Array<[RegExp, LiveLayerId]> = [
  [/\b(aircraft|planes?|flights?)\b/i, "aircraft"], [/\bearthquakes?\b/i, "earthquakes"], [/\bsatellites?\b/i, "satellites"],
  [/\b(fires?|wildfires?)\b/i, "fires"], [/\b(weather|rain|wind)\b/i, "weather"], [/\b(cameras?|traffic cameras?)\b/i, "cameras"],
];

/** Fast local intent parser. Ambiguous/complex requests are handed to Clyra's LLM with structured scene context. */
export function parseMapCommand(raw: string): MapCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (!text) return { type: "search", query: "" };
  const liveLayer = layers.find(([pattern]) => pattern.test(text))?.[1];
  if (liveLayer && /\b(show|hide|turn on|turn off|toggle)\b/i.test(text)) return { type: "toggle-layer", layer: liveLayer };
  if (/\b(3d|three dimensional)\b/i.test(text) && /\b(show|turn|toggle|enable|disable|switch)\b/i.test(text)) return { type: "toggle-3d", value: /\b(off|disable|2d)\b/i.test(text) ? false : undefined };
  if (/\b(measure|distance between)\b/i.test(text)) return { type: "measure" };
  if (/\b(overview|show entire route|zoom out.*route)\b/i.test(text)) return { type: "overview" };
  const fly = text.match(/^(?:fly|take me|go)\s+(?:to\s+)?(.+)$/i);
  if (fly && !/\b(route|directions|drive|walk|cycle)\b/i.test(text)) return { type: "fly", destination: fly[1].trim() };
  const route = text.match(/(?:directions?|route|navigate|drive|walk|cycle|take me)\s+(?:to\s+)?(.+)/i);
  if (route) {
    const destination = route[1].replace(/\b(avoiding?|avoid)\b.+$/i, "").trim();
    const mode: TravelMode | undefined = /\bwalk|walking\b/i.test(lower) ? "walking" : /\bcycle|cycling|bike\b/i.test(lower) ? "cycling" : /\btransit|train|bus\b/i.test(lower) ? "transit" : "driving";
    return { type: "route", destination, mode, avoid: { tolls: /avoid tolls?/i.test(lower), motorways: /avoid (motorways?|highways?)/i.test(lower), ferries: /avoid ferries/i.test(lower) } };
  }
  // A plain 2+ character phrase is a place/category search. Conversational,
  // constrained prompts keep the full text for the existing LLM to plan.
  if (text.length >= 2 && !/[?]|\b(halfway|plan|quiet|good|fun|best|within|around|what am i)\b/i.test(text)) return { type: "search", query: text };
  return { type: "ask-llm", prompt: text };
}
