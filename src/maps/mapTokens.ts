/**
 * Cartographic design tokens for Clyra's standard (Explore) map.
 *
 * Single source of truth for the Apple-Maps-inspired light palette, line
 * widths, zoom thresholds, label scale and camera motion. The MapLibre style
 * (styles/clyra-explore-light.ts) and the runtime renderer both read from
 * here so a colour is never duplicated across the application.
 */

export const MAP_COLORS = Object.freeze({
  land: "#F4F4F1",
  landUrban: "#F1F1EE",

  water: "#A9DDF4",
  waterCasing: "#9BD3EC",

  park: "#DDEFCF",
  reserve: "#D4EBC5",
  forest: "#CBE5BA",
  grassland: "#E4F0D8",
  scrub: "#E7EEDD",

  building: "#E6E4DF",
  buildingRoof: "#ECE9E3",

  roadLocalFill: "#FFFFFF",
  roadLocalCasing: "#D9D9D5",
  roadSecondaryFill: "#FFFFFF",
  roadSecondaryCasing: "#CCCCC6",
  roadPrimaryFill: "#FDFCFA",
  roadPrimaryCasing: "#C0C0B9",
  trunkFill: "#FDF6E1",
  trunkCasing: "#DED1A2",
  motorwayFill: "#F8D96B",
  motorwayCasing: "#E0BD4E",
  serviceFill: "#FFFFFF",
  pathFill: "#E8E8E3",

  rail: "#B8BEC4",

  labelPrimary: "#1C1C1C",
  labelSecondary: "#666666",
  labelTertiary: "#929292",
  labelWater: "#3E87B3",
  labelPark: "#4E8A57",

  route: "#1E6FFF",
  routeCasing: "#1756D1",
  routeAlternative: "#8FB8E8",

  halo: "#FFFFFF",
});

/** Line width reference stops (px) across zoom — kept as documentation. */
export const MAP_WIDTHS = Object.freeze({
  motorway: [2, 6, 10, 15],
  trunk: [1.5, 4, 7, 12],
  primary: [1.2, 3.4, 6, 10],
  secondary: [1, 2.6, 4.5, 8],
  tertiary: [0.8, 2, 3.4, 6],
  minor: [0.6, 1.4, 2.4, 4.5],
  service: [0.4, 1, 1.8, 3],
  path: [0.4, 0.9, 1.4, 2],
});

export const MAP_ZOOM = Object.freeze({
  motorway: 4,
  trunk: 6,
  primary: 7,
  secondary: 9,
  tertiary: 11,
  minor: 13,
  service: 15,
  path: 13,
  building: 15,
  building3d: 16,
  poi: 14,
  transit: 11,
});

export const MAP_ANIMATION = Object.freeze({
  duration: 320,
  screenSpeed: 1.1,
  maxDuration: 2600,
  easing: [0.16, 1, 0.3, 1] as [number, number, number, number],
});

/** Target zoom for a search result, keyed by place class. */
export function targetZoomForClass(placeClass: string): number {
  switch (placeClass) {
    case "country": return 5;
    case "state":
    case "region": return 7;
    case "city": return 11;
    case "town": return 12;
    case "suburb":
    case "quarter":
    case "neighbourhood": return 13.5;
    case "street":
    case "address": return 15.5;
    case "poi": return 16.5;
    default: return 13;
  }
}
