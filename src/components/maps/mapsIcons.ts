import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  MapPin,
  Merge,
  RotateCw,
  Signpost,
} from "lucide-react";
import type { NavigationStep } from "../../../lib/maps/types";

export const MANEUVER_ICON: Record<NavigationStep["type"], typeof ArrowUp> = {
  depart: MapPin,
  continue: ArrowUp,
  "turn-left": CornerUpLeft,
  "turn-right": CornerUpRight,
  "slight-left": ArrowUpLeft,
  "slight-right": ArrowUpRight,
  "sharp-left": CornerUpLeft,
  "sharp-right": CornerUpRight,
  merge: Merge,
  fork: Signpost,
  roundabout: RotateCw,
  exit: Signpost,
  arrive: Flag,
};

export const CATEGORY_CHIPS: Array<{ id: string; label: string }> = [
  { id: "food", label: "Food" },
  { id: "coffee", label: "Coffee" },
  { id: "petrol", label: "Petrol" },
  { id: "parking", label: "Parking" },
  { id: "groceries", label: "Groceries" },
  { id: "hotels", label: "Hotels" },
  { id: "attractions", label: "Things to do" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "hospitals", label: "Hospitals" },
  { id: "ev-charging", label: "EV charging" },
  { id: "transport", label: "Transport" },
];

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${m} min`;
}

export function formatArrival(seconds: number): string {
  const arrival = new Date(Date.now() + seconds * 1000);
  return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
