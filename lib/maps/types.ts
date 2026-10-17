/** Shared place/route/navigation model for Clyra Maps. Every provider
 * (Photon, Overpass, Nominatim, OSRM) normalizes into these shapes so the UI
 * and the AI agent never see fragmented per-provider data. */

export type Coordinate = [number, number]; // [lon, lat]

export interface SourceLink {
  provider: string;
  url?: string;
}

export interface PlacePhoto {
  url: string;
  attribution?: string;
}

export interface PlaceReview {
  author?: string;
  rating?: number;
  text: string;
  date?: string;
  source: string;
  sourceUrl?: string;
}

export interface OpeningHours {
  raw?: string;
  /** Human summary derived from `raw` OSM opening_hours syntax, e.g. "Open now, closes 10 PM" */
  summary?: string;
}

export interface ClyraPlace {
  id: string;
  name: string;
  coordinates: Coordinate;

  address?: string;
  locality?: string;
  region?: string;
  country?: string;

  categories: string[];

  phone?: string;
  website?: string;

  openingHours?: OpeningHours;
  currentlyOpen?: boolean;

  rating?: number;
  reviewCount?: number;
  reviews?: PlaceReview[];

  priceLevel?: number;
  photos?: PlacePhoto[];
  amenities?: string[];
  accessibility?: string[];

  /** Straight-line distance in metres from the query/viewport centre, when known. */
  distanceMeters?: number;
  /** Estimated one-way travel time in seconds from context, when known. */
  travelTimeSeconds?: number;
  /** For along-route search: extra time this stop adds versus not stopping. */
  detourSeconds?: number;

  sourceLinks: SourceLink[];
}

export type TravelMode = "drive" | "walk" | "bike" | "transit";

export interface NavigationStep {
  instruction: string;
  type:
    | "depart"
    | "continue"
    | "turn-left"
    | "turn-right"
    | "slight-left"
    | "slight-right"
    | "sharp-left"
    | "sharp-right"
    | "merge"
    | "fork"
    | "roundabout"
    | "exit"
    | "arrive";
  roadName?: string;
  distanceMeters: number;
  durationSeconds: number;
  coordinate: Coordinate;
  headingBefore: number;
  headingAfter: number;
  geometryStartIndex: number;
  geometryEndIndex: number;
}

export interface Route {
  id: string;
  provider: string;
  mode: TravelMode;
  geometry: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
  steps: NavigationStep[];
  /** Cumulative distance in metres at each geometry vertex — precomputed for interpolation. */
  cumulativeDistances: number[];
}

export interface RouteOptions {
  mode: TravelMode;
  avoidTolls?: boolean;
  avoidHighways?: boolean;
  waypoints?: Coordinate[];
}

export interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
  options: RouteOptions;
}

export interface RoutingProvider {
  name: string;
  route(request: RouteRequest): Promise<Route>;
  alternatives?(request: RouteRequest): Promise<Route[]>;
}
