/**
 * Clyra Maps — vector icons.
 *
 * Small, original SVG symbols for route maneuvers and points of interest.
 * Everything here is a tiny app asset (no map data); POIs are rendered by
 * MapLibre as symbol layers, never as DOM markers.
 */
import type { ManeuverType } from "../../maps/routing";

export function ManeuverIcon({ type, size = 20 }: { type: ManeuverType; size?: number }) {
  const stroke = "#1C1C1C";
  const accent = "#1E6FFF";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "straight":
      return <svg {...common}><path d="M12 4v14" /><path d="M9 6.5 12 4l3 2.5" /></svg>;
    case "right":
      return <svg {...common}><path d="M4 12h12" /><path d="M11.5 7.5 16 12l-4.5 4.5" /></svg>;
    case "left":
      return <svg {...common}><path d="M20 12H8" /><path d="M12.5 7.5 8 12l4.5 4.5" /></svg>;
    case "slight-right":
      return <svg {...common}><path d="M5 12h11" /><path d="M11 8.5 16 12l-4.5 3.5" stroke={accent} /></svg>;
    case "slight-left":
      return <svg {...common}><path d="M19 12H8" /><path d="M13 8.5 8 12l4.5 3.5" stroke={accent} /></svg>;
    case "sharp-right":
      return <svg {...common}><path d="M5 12h10" /><path d="M11 10.5 15 12l-4 3" /></svg>;
    case "sharp-left":
      return <svg {...common}><path d="M19 12H9" /><path d="M13 10.5 9 12l4 3" /></svg>;
    case "uturn":
      return <svg {...common}><path d="M8 7v8a3 3 0 0 0 3 3h5" /><path d="M12.5 16.5 16 14l-3.5-2.5" /></svg>;
    case "roundabout":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M17.5 9.5a5 5 0 1 0-1.5 5" /></svg>;
    case "merge":
      return <svg {...common}><path d="M6 5v14" /><path d="M18 5c-4 3-4 11 0 14" /></svg>;
    case "fork":
      return <svg {...common}><path d="M6 5v14" /><path d="M18 5c-4 3-4 11 0 14" /><path d="M12 19v3" /></svg>;
    case "exit":
      return <svg {...common}><path d="M4 6v12" /><path d="M16 6c-3 2-3 10 0 12" /><path d="M12 12h6" /></svg>;
    case "destination":
      return <svg {...common}><circle cx="12" cy="12" r="8" stroke={accent} /><circle cx="12" cy="12" r="2.5" fill={accent} stroke="none" /></svg>;
    case "depart":
      return <svg {...common}><circle cx="12" cy="12" r="2" /><path d="M12 4v3M12 17v3M4 12h3M17 12h3" /></svg>;
    case "arrive":
      return <svg {...common}><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" stroke={accent} /><circle cx="12" cy="11" r="2" fill={accent} stroke="none" /></svg>;
    default:
      return <svg {...common}><path d="M12 4v14" /><path d="M9 6.5 12 4l3 2.5" /></svg>;
  }
}

/** Compact POI glyphs for the route panel + search results. */
export function PoiIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "#5B5E63", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "restaurant":
    case "cafe":
      return <svg {...props}><path d="M7 3v7a2 2 0 0 0 2 2v9" /><path d="M7 8h0" /><path d="M7 5v1" /></svg>;
    case "shop":
    case "supermarket":
      return <svg {...props}><path d="M4 7h16l-1 13H5L4 7Z" /><path d="M8 10V6a4 4 0 0 1 8 0v4" /></svg>;
    case "hospital":
      return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 8v8M8 12h8" /></svg>;
    case "pharmacy":
      return <svg {...props}><path d="M6 3h12l-1 18H7L6 3Z" /><path d="M12 8v8M8 12h8" /></svg>;
    case "hotel":
      return <svg {...props}><rect x="4" y="8" width="16" height="12" rx="2" /><path d="M7 12h.01M7 16h.01M12 8v4" /></svg>;
    case "school":
    case "university":
      return <svg {...props}><path d="M12 4 2 9l10 5 10-5-10-5Z" /><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /></svg>;
    case "station":
    case "bus":
      return <svg {...props}><rect x="5" y="3" width="14" height="14" rx="2" /><path d="M5 13h14l1 8H4l1-8Z" /></svg>;
    case "ferry":
      return <svg {...props}><path d="M3 14h18l-3-8H6l-3 8Z" /><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01" /></svg>;
    case "airport":
      return <svg {...props}><path d="M4 16 20 4l-4 14-4.5-1.5L8 20l-4-4Z" /></svg>;
    case "parking":
      return <svg {...props}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 16V8h3a2.5 2.5 0 0 1 0 5H9" /></svg>;
    case "fuel":
      return <svg {...props}><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M3 21h14" /><path d="M15 10h2a2 2 0 0 1 2 2v3" /></svg>;
    case "ev":
      return <svg {...props}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M9 7h6" /><path d="M12 10l-2 4h4l-2 4" /></svg>;
    case "park":
      return <svg {...props}><path d="M7 21c0-8 5-9 5-14 0-2-1.5-3-3-3s-3 1-3 3" /></svg>;
    case "beach":
      return <svg {...props}><path d="M3 18c4-2 6-2 9-1s6 0 9-3" /><path d="M6 10c4 0 4-3 8-3" /></svg>;
    case "museum":
    case "landmark":
      return <svg {...props}><rect x="3" y="10" width="18" height="10" rx="1" /><path d="M5 10l7-6 7 6" /><path d="M9 14h.01M12 14h.01M15 14h.01" /></svg>;
    case "sport":
      return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17" /></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="8" /></svg>;
  }
}

/** Map a place class/type to a POI glyph so search results carry an icon. */
export function placeIconKind(placeClass: string, type: string): string {
  const t = (type || "").toLowerCase();
  const c = (placeClass || "").toLowerCase();
  if (/restaurant|cafe|food|bar|pub/.test(t)) return "restaurant";
  if (/hotel|lodging|hostel|motel/.test(t)) return "hotel";
  if (/hospital|clinic/.test(t)) return "hospital";
  if (/pharmac/.test(t)) return "pharmacy";
  if (/school|university|college/.test(t)) return "school";
  if (/shop|supermarket|store|mall|retail/.test(t)) return "shop";
  if (/station|rail|train|tram|subway/.test(t)) return "station";
  if (/bus|transit/.test(t)) return "bus";
  if (/ferry|boat|harbour|harbor/.test(t)) return "ferry";
  if (/airport|aerodrome|terminal/.test(t)) return "airport";
  if (/parking|garage/.test(t)) return "parking";
  if (/fuel|petrol|gas_station|charging|ev/.test(t)) return "fuel";
  if (/park|garden|nature|reserve/.test(t)) return "park";
  if (/beach|coast|shore/.test(t)) return "beach";
  if (/museum|gallery|landmark|monument|attraction|historic/.test(t)) return "museum";
  if (/sport|stadium|fitness|gym|golf/.test(t)) return "sport";
  if (c === "country" || c === "region" || c === "city" || c === "suburb" || c === "street" || c === "address") return "landmark";
  return "landmark";
}
