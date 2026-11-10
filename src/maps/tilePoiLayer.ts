import type maplibregl from "maplibre-gl";

/**
 * The map's own places, drawn quietly: a thin grey glyph and a small grey name for each, with no coloured badge and
 * no card behind it. They replace the base style's coloured POI badges so that the only colour on the map is what the
 * user asked for: a route, a result, themselves.
 *
 * Categories come from the vector tiles' own `class` / `subclass`, so every kind of place the tiles carry has a glyph.
 */
const GLYPH = "#6b6f76";

const ICONS: Record<string, string> = {
  food: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7",
  cafe: "M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2",
  bar: "M8 22h8M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5Z",
  petrol: "M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0v-7a2 2 0 0 0-.6-1.4L18 5M14 21V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v16M2 21h13M3 9h11",
  ev: "M13 2 3 14h9l-1 8 10-12h-9z",
  shopping: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0",
  groceries: "M8 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 22a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6L22 7H5.1",
  health: "M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2z",
  money: "M3 21h18M5 21V10M9 21V10M15 21V10M19 21V10M12 3 2 8h20Z",
  hotel: "M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M12 4v6M2 18h20",
  parking: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM9 17V7h4a3 3 0 0 1 0 6H9",
  transit: "M8 6v6M16 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3M9 18h5M7 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0M14 18a2 2 0 1 0 4 0 2 2 0 0 0-4 0",
  park: "m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17ZM12 22v-3",
  culture: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  education: "M21.4 10.9a1 1 0 0 0 0-1.8L12.8 5.2a2 2 0 0 0-1.6 0L2.6 9.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0ZM22 10v6M6 12.5V16a6 3 0 0 0 12 0v-3.5",
  toilets: "M12 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM6 8h12M12 8v6M9 21l3-7 3 7",
  fitness: "M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11",
  worship: "M12 2v6M9 5h6M5 22V12l7-4 7 4v10ZM10 22v-5h4v5",
  post: "M22 7l-10 6L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  generic: "M12 12m-2.5 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0",
};

/** tile `subclass` → glyph (checked first), then tile `class` → glyph. Anything else gets the quiet dot. */
const BY_SUBCLASS: Record<string, string> = {
  supermarket: "groceries", grocery: "groceries", convenience: "groceries", greengrocer: "groceries", butcher: "groceries", deli: "groceries", marketplace: "groceries",
  bakery: "food", ice_cream: "food", confectionery: "food", pastry: "food",
  mall: "shopping", department_store: "shopping", clothes: "shopping", shoes: "shopping", jewelry: "shopping", gift: "shopping", books: "shopping", electronics: "shopping",
  florist: "shopping", furniture: "shopping", hardware: "shopping", sports: "shopping", toys: "shopping", variety_store: "shopping", cosmetics: "shopping", optician: "shopping", hairdresser: "shopping",
  pharmacy: "health", chemist: "health", doctors: "health", dentist: "health", clinic: "health", hospital: "health", veterinary: "health",
  atm: "money", bank: "money",
  charging_station: "ev",
  hotel: "hotel", hostel: "hotel", motel: "hotel", guest_house: "hotel", apartments: "hotel", camp_site: "hotel", caravan_site: "hotel",
  bus_stop: "transit", bus_station: "transit", station: "transit", halt: "transit", tram_stop: "transit", subway: "transit", ferry_terminal: "transit",
  museum: "culture", gallery: "culture", artwork: "culture", attraction: "culture", viewpoint: "culture", zoo: "culture", aquarium: "culture", theme_park: "culture", theatre: "culture", cinema: "culture", monument: "culture", castle: "culture",
  park: "park", playground: "park", garden: "park", dog_park: "park", nature_reserve: "park",
  school: "education", kindergarten: "education", college: "education", university: "education", library: "education",
  toilets: "toilets", fitness_centre: "fitness", gym: "fitness", sports_centre: "fitness", swimming_pool: "fitness", pitch: "fitness", stadium: "fitness",
  place_of_worship: "worship", post_office: "post", post_box: "post",
};
const BY_CLASS: Record<string, string> = {
  restaurant: "food", fast_food: "food", food_court: "food", cafe: "cafe", bar: "bar", pub: "bar", biergarten: "bar", nightclub: "bar", alcohol_shop: "bar",
  fuel: "petrol", shop: "shopping", clothing_store: "shopping", grocery: "groceries", pharmacy: "health", hospital: "health", doctors: "health", dentist: "health",
  bank: "money", atm: "money", lodging: "hotel", parking: "parking", bus: "transit", railway: "transit", ferry_terminal: "transit",
  park: "park", playground: "park", attraction: "culture", museum: "culture", theatre: "culture", cinema: "culture", art_gallery: "culture", zoo: "culture",
  school: "education", college: "education", library: "education", toilets: "toilets", fitness_centre: "fitness", stadium: "fitness", swimming: "fitness",
  place_of_worship: "worship", post: "post", charging_station: "ev",
};

function expr(): maplibregl.ExpressionSpecification {
  const sub: unknown[] = ["match", ["get", "subclass"]];
  for (const [k, v] of Object.entries(BY_SUBCLASS)) sub.push(k, `clyra-poi-${v}`);
  const cls: unknown[] = ["match", ["get", "class"]];
  for (const [k, v] of Object.entries(BY_CLASS)) cls.push(k, `clyra-poi-${v}`);
  cls.push("clyra-poi-generic");
  sub.push(cls);
  return sub as maplibregl.ExpressionSpecification;
}

function addGlyph(map: maplibregl.Map, key: string, path: string) {
  const name = `clyra-poi-${key}`;
  if (map.hasImage(name)) return;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="${GLYPH}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
  const img = new Image(48, 48);
  img.onload = () => {
    if (map.hasImage(name)) return;
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, 48, 48);
    try { map.addImage(name, ctx.getImageData(0, 0, 48, 48), { pixelRatio: 2 }); } catch { /* style swapped meanwhile */ }
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const TILE_POI_LAYER = "clyra-tile-poi";

/** Hides the base style's coloured POI badges and draws the quiet grey set in their place. */
export function installTilePoiLayer(map: maplibregl.Map, beforeId?: string) {
  if (!map.getSource("openmaptiles")) return; // satellite and other styles carry no place tiles
  for (const layer of map.getStyle()?.layers ?? []) {
    if (/^poi/i.test(layer.id) && map.getLayoutProperty(layer.id, "visibility") !== "none") map.setLayoutProperty(layer.id, "visibility", "none");
  }
  for (const [key, path] of Object.entries(ICONS)) addGlyph(map, key, path);
  if (map.getLayer(TILE_POI_LAYER)) return;
  map.addLayer(
    {
      id: TILE_POI_LAYER,
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "poi",
      minzoom: 14.2,
      filter: ["has", "name"],
      layout: {
        "icon-image": expr(),
        "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.7, 18, 0.95],
        "icon-allow-overlap": false,
        "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 11.5],
        "text-anchor": "top",
        "text-offset": [0, 0.85],
        "text-max-width": 7,
        "text-optional": true,
        "symbol-sort-key": ["coalesce", ["get", "rank"], 50],
      },
      paint: {
        "icon-opacity": 0.92,
        "text-color": "#6b6f76",
        "text-halo-color": "rgba(255,255,255,0.92)",
        "text-halo-width": 1.3,
      },
    },
    beforeId && map.getLayer(beforeId) ? beforeId : undefined,
  );
}
