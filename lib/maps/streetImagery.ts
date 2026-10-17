/** Open street-level imagery near a point: Panoramax (STAC API, verified against
 * live responses) and KartaView (community imagery). Each provider validates
 * every field it uses and drops anything malformed, so a provider change can
 * only remove imagery, never show a wrong picture. */
import type { Coordinate } from "./types";
import { haversineMeters } from "./providers";

export interface StreetImage {
  id: string;
  provider: "Panoramax" | "KartaView";
  url: string;
  thumbnailUrl?: string;
  coordinates: Coordinate;
  distanceMeters: number;
  takenAt?: string;
  heading?: number;
  license?: string;
  sourcePage?: string;
}

const UA = "ClyraMaps/1.0 (street imagery lookup)";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; images: StreetImage[] }>();

function isHttps(u: unknown): u is string {
  return typeof u === "string" && /^https:\/\//.test(u);
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init?.headers as Record<string, string>) }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function panoramax(c: Coordinate): Promise<StreetImage[]> {
  const r = 0.0015; // ~165 m box
  const bbox = [c[0] - r, c[1] - r, c[0] + r, c[1] + r].map((n) => n.toFixed(6)).join(",");
  const data = (await getJson(`https://api.panoramax.xyz/api/search?limit=8&bbox=${bbox}`)) as
    | { features?: Array<Record<string, any>> }
    | null;
  const out: StreetImage[] = [];
  for (const f of data?.features ?? []) {
    const coords = f?.geometry?.coordinates;
    const hd = f?.assets?.hd?.href;
    const sd = f?.assets?.sd?.href;
    const thumb = f?.assets?.thumb?.href;
    const image = isHttps(sd) ? sd : isHttps(hd) ? hd : null;
    if (!image || !Array.isArray(coords) || coords.length < 2 || !coords.every(Number.isFinite)) continue;
    const at: Coordinate = [coords[0], coords[1]];
    out.push({
      id: `panoramax-${f.id}`,
      provider: "Panoramax",
      url: image,
      thumbnailUrl: isHttps(thumb) ? thumb : undefined,
      coordinates: at,
      distanceMeters: haversineMeters(c, at),
      takenAt: typeof f?.properties?.datetime === "string" ? f.properties.datetime : undefined,
      heading: Number.isFinite(f?.properties?.["view:azimuth"]) ? f.properties["view:azimuth"] : undefined,
      license: "CC BY-SA 4.0",
      sourcePage: isHttps(f?.links?.find?.((l: any) => l.rel === "self")?.href)
        ? f.links.find((l: any) => l.rel === "self").href
        : undefined,
    });
  }
  return out;
}

/** KartaView's list endpoint takes a form POST. Live responses returned HTTP 400
 * during development, so this adapter returns nothing unless every field it needs
 * validates; it will not guess at a different response shape. */
async function kartaview(c: Coordinate): Promise<StreetImage[]> {
  const body = new URLSearchParams({ lat: String(c[1]), lng: String(c[0]), radius: "150", join: "user", itemsPerPage: "6", page: "1" });
  const data = (await getJson("https://api.openstreetcam.org/1.0/list/nearby-photos/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  })) as { currentPageItems?: Array<Record<string, any>> } | null;
  const out: StreetImage[] = [];
  for (const it of data?.currentPageItems ?? []) {
    const lat = Number(it?.lat);
    const lng = Number(it?.lng);
    const url = it?.fileurlProc ?? it?.fileurlLTh;
    if (!isHttps(url) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const at: Coordinate = [lng, lat];
    out.push({
      id: `kartaview-${it.id ?? `${lat},${lng}`}`,
      provider: "KartaView",
      url,
      thumbnailUrl: isHttps(it?.fileurlLTh) ? it.fileurlLTh : undefined,
      coordinates: at,
      distanceMeters: haversineMeters(c, at),
      takenAt: typeof it?.shot_date === "string" ? it.shot_date : undefined,
      heading: Number.isFinite(Number(it?.heading)) ? Number(it.heading) : undefined,
      license: "CC BY-SA",
      sourcePage: `https://kartaview.org/details/${it.sequence_id ?? ""}/${it.sequence_index ?? ""}`,
    });
  }
  return out;
}

/** Closest imagery first. Imagery more than ~120 m from the point is dropped:
 * a photo of the next block is not "street imagery here". */
export async function findStreetImagery(c: Coordinate): Promise<StreetImage[]> {
  const key = `${c[1].toFixed(4)},${c[0].toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.images;
  const [pano, kv] = await Promise.all([panoramax(c), kartaview(c)]);
  const images = [...pano, ...kv].filter((i) => i.distanceMeters <= 120).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 12);
  cache.set(key, { at: Date.now(), images });
  return images;
}
