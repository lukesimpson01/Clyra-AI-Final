export type LngLat = [number, number];
export type Bounds = [LngLat, LngLat];

export type PlaceCategory =
  | "country" | "region" | "city" | "suburb" | "neighbourhood" | "postcode"
  | "street" | "address" | "building" | "business" | "attraction" | "airport"
  | "station" | "transit" | "hospital" | "school" | "university" | "park"
  | "beach" | "restaurant" | "cafe" | "hotel" | "fuel" | "charger" | "shopping"
  | "parking" | "place";

/** Provider-neutral place data. UI and AI code never receive raw Photon fields. */
export interface Place {
  id: string;
  source: string;
  name: string;
  displayName: string;
  category: PlaceCategory;
  coordinates: LngLat;
  boundingBox?: Bounds;
  country?: string;
  region?: string;
  locality?: string;
  postcode?: string;
  address?: string;
  importance?: number;
  distanceM?: number;
  metadata: Record<string, string | number | boolean | null | undefined>;
}

export type TravelMode = "driving" | "walking" | "cycling" | "transit" | "accessible";

export interface RouteStep {
  instruction: string;
  maneuverType: string;
  modifier?: string;
  distanceM: number;
  durationS: number;
  name?: string;
}

export interface Route {
  id: string;
  mode: TravelMode;
  distanceM: number;
  durationS: number;
  geometry: GeoJSON.LineString;
  bbox: Bounds;
  steps: RouteStep[];
  waypoints: LngLat[];
  provider: string;
  alternatives: Route[];
  warnings: string[];
  fetchedAt: number;
}

export type LayerStatus = "idle" | "loading" | "live" | "delayed" | "unavailable" | "error";
export type LiveLayerId = "aircraft" | "earthquakes" | "satellites" | "fires" | "weather" | "cameras";

export interface LayerMeta {
  id: LiveLayerId;
  label: string;
  source: string;
  status: LayerStatus;
  updatedAt?: number;
  detail: string;
}

export interface LiveEntity {
  id: string;
  type: string;
  source: string;
  coordinates: LngLat;
  heading?: number;
  speed?: number;
  altitude?: number;
  timestamp: number;
  freshness: "live" | "delayed" | "historical";
  properties: Record<string, string | number | boolean | null | undefined>;
}

export interface MapSceneContext {
  viewport: Bounds;
  center: LngLat;
  zoom: number;
  bearing: number;
  pitch: number;
  visiblePlaces: Array<Pick<Place, "id" | "name" | "category" | "coordinates">>;
  selectedPlace: Place | null;
  currentRoute: Pick<Route, "id" | "mode" | "distanceM" | "durationS" | "waypoints"> | null;
  activeLayers: LayerMeta[];
  trackedEntities: Array<Pick<LiveEntity, "id" | "type" | "coordinates" | "timestamp">>;
  currentLocation: LngLat | null;
  searchResults: Array<Pick<Place, "id" | "name" | "category" | "coordinates">>;
  navigationState: "exploring" | "directions" | "navigating";
}
