/**
 * The Clyra ⇄ Clyra Earth message bridge.
 *
 * Clyra frames the God's Eye View document from a different loopback port, so
 * the two sides are cross-origin and can only talk over postMessage. Every
 * message carries an explicit marker and every listener must check both the
 * marker and the sender's origin: the Earth document loads third-party map and
 * imagery tiles, and a framed resource must never be able to drive Clyra.
 */

/** Marker field stamped on every bridge message in both directions. */
export const EARTH_BRIDGE_ORIGIN_MARK = "__clyraEarthBridge";

/** Clyra → Earth. */
export type EarthBridgeMessage =
  /** A natural-language command typed into the Bloub puck. */
  | { kind: "command"; text: string }
  /** Resolve a typed place through the same deterministic Earth geocoder. */
  | { kind: "suggest"; query: string }
  /** Ask the framed document to re-emit its current lifecycle state. */
  | { kind: "ping" }
  /** Apply or drop Clyra's light theme layer over the HUD. */
  | { kind: "theme"; theme: "clyra-light" | "original" }
  /** Begin the quiet opening flight once Clyra has had a moment to settle. */
  | { kind: "startup-location" }
  /** A location resolved by Clyra's trusted top-level document. */
  | {
      kind: "location";
      location: {
        lat: number;
        lon: number;
        accuracyM?: number;
        timestamp: number;
        /** A user-selected place, such as Home, rather than device GPS. */
        label?: string;
        source?: "device" | "saved";
      };
    }
  /** The top-level location request was unavailable or declined. */
  | { kind: "location-error"; text: string }
  /** Control the active map-only Fly Route, or return its existing route to overview. */
  | {
      kind: "route-flight-control";
      action: "pause" | "resume" | "stop" | "overview";
    };

/** Earth → Clyra. */
export type EarthBridgeEvent =
  /** The globe has rendered its wide opening shot and is beginning its flight. */
  | { kind: "staging" }
  /** The Earth document finished booting and is ready for commands. */
  | { kind: "ready" }
  /** A command completed, with whatever the deterministic tools returned. */
  | { kind: "result"; text: string; data?: unknown }
  /** A resolved place suggestion, never an LLM-generated location. */
  | { kind: "suggestion"; query: string; places: Array<{ label: string; detail?: string }> }
  /** Live progress from Clyra's owned route camera. */
  | { kind: "route-progress"; progress: { state: "flying" | "arrived"; traveledM: number; totalM: number; remainingM: number; distanceToManeuverM: number; stepIndex: number; instruction?: string } }
  /** Earth needs Clyra's top-level, permissioned current location. */
  | { kind: "location-request" }
  /** A command failed. */
  | { kind: "error"; text: string };

/** The origin-only target required by Window.postMessage. */
export function earthBridgeOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Read a bridge event from a message, or null when the message is not one.
 *
 * `expectedOrigin` is the Earth host URL Clyra was handed by /api/earth/start.
 * Messages from anywhere else are ignored outright.
 */
export function readEarthEvent(
  event: MessageEvent,
  expectedOrigin: string | null,
): EarthBridgeEvent | null {
  if (!expectedOrigin) return null;
  const origin = earthBridgeOrigin(expectedOrigin);
  if (!origin) return null;
  if (event.origin !== origin) return null;

  const data = event.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return null;
  if (data[EARTH_BRIDGE_ORIGIN_MARK] !== true) return null;
  const kind = data.kind;
  if (kind === "staging") return { kind: "staging" };
  if (kind === "ready") return { kind: "ready" };
  if (kind === "result" && typeof data.text === "string") {
    return { kind: "result", text: data.text, data: data.data };
  }
  if (kind === "suggestion" && typeof data.query === "string") {
    const places = data.places;
    if (!Array.isArray(places) || places.some((place) => !place || typeof place !== "object" || typeof (place as { label?: unknown }).label !== "string")) return null;
    return { kind: "suggestion", query: data.query, places: places as Array<{ label: string; detail?: string }> };
  }
  if (kind === "route-progress") {
    const progress = data.progress as Record<string, unknown> | null;
    if (!progress || (progress.state !== "flying" && progress.state !== "arrived")) return null;
    const numeric = ["traveledM", "totalM", "remainingM", "distanceToManeuverM", "stepIndex"];
    if (numeric.some((key) => !Number.isFinite(Number(progress[key])))) return null;
    return {
      kind: "route-progress",
      progress: {
        state: progress.state,
        traveledM: Math.max(0, Number(progress.traveledM)),
        totalM: Math.max(0, Number(progress.totalM)),
        remainingM: Math.max(0, Number(progress.remainingM)),
        distanceToManeuverM: Math.max(0, Number(progress.distanceToManeuverM)),
        stepIndex: Math.max(0, Math.floor(Number(progress.stepIndex))),
        ...(typeof progress.instruction === "string" && progress.instruction.trim() ? { instruction: progress.instruction.trim() } : {}),
      },
    };
  }
  if (kind === "location-request") return { kind: "location-request" };
  if (kind === "error" && typeof data.text === "string") {
    return { kind: "error", text: data.text };
  }
  return null;
}
