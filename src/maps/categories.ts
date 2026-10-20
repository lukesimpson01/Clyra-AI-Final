/** How each category chip maps onto OpenMapTiles `poi` layer classes. */
export interface TileCategoryRule {
  classes: string[];
  subclasses?: string[];
  fallbackName?: string;
}

export const TILE_CATEGORIES: Record<string, TileCategoryRule> = {
  food: { classes: ["restaurant", "fast_food"] },
  coffee: { classes: ["cafe"] },
  petrol: { classes: ["fuel"], subclasses: ["fuel"], fallbackName: "Fuel station" },
  parking: { classes: ["parking"], subclasses: ["parking"], fallbackName: "Parking" },
  groceries: { classes: ["grocery"] },
  hotels: { classes: ["lodging"] },
  attractions: { classes: ["attraction", "museum", "zoo", "theatre", "art_gallery"], subclasses: ["attraction", "museum", "zoo", "theatre", "gallery", "viewpoint", "monument", "castle"] },
  pharmacy: { classes: ["pharmacy"] },
  hospitals: { classes: ["hospital"], subclasses: ["hospital"] },
  "ev-charging": { classes: ["fuel"], subclasses: ["charging_station"], fallbackName: "EV charger" },
  transport: { classes: ["railway", "bus"], subclasses: ["station", "halt", "subway", "tram_stop", "bus_station"] },
};
