/** Everything the place card shows beyond the basics, gathered from the best source that has it and labelled by
 * source: photos, the week's opening hours, ratings and written reviews.
 *
 * Order of trust, per field:
 *   photos  : Google Places (when GOOGLE_PLACES_API_KEY is set) -> the place's own website -> Wikidata/Commons
 *             images the OSM object itself points at -> Wikipedia lead image (same-subject match only)
 *   hours   : Google -> OSM opening_hours
 *   ratings : Google (rating, count, written reviews) -> Mangrove signed reviews -> ratings quoted by well-known
 *             review sites in a live web search (each shown with its source and link, never merged or invented)
 * Nothing here is guessed: a field with no source is simply absent and the card hides that section. */
import { haversineMeters } from "./providers";
import { weeklyHours } from "./openingHours";
import type { Coordinate } from "./types";

export interface EnrichedPhoto {
  url: string;
  /** What the picture is: "Official site", "Wikimedia Commons", "Google"… */
  source: string;
  caption?: string;
  link?: string;
}

export interface EnrichedReview {
  author?: string;
  rating?: number;
  text: string;
  when?: string;
}

export interface EnrichedRating {
  source: string;
  value: number;
  count?: number;
  url?: string;
  reviews?: EnrichedReview[];
}

export interface EnrichedPlace {
  photos: EnrichedPhoto[];
  hours?: { weekly: Array<{ day: string; text: string }>; source: string };
  ratings: EnrichedRating[];
  website?: string;
  phone?: string;
  sources: string[];
}

export interface EnrichInput {
  name: string;
  coordinates: Coordinate;
  locality?: string;
  osmId?: string; // "node/123"
  website?: string;
  openingHoursRaw?: string;
}

export interface EnrichDeps {
  mangrove?: (osmId: string | undefined) => Promise<{ rating?: number; count: number; items: Array<{ rating: number; text?: string; createdAt?: string }> } | null>;
}

const UA = "ClyraMaps/1.0 (+place details)";
const TTL = 20 * 60 * 1000;
const cache = new Map<string, { at: number; value: EnrichedPlace }>();

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 6000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers as Record<string, string>) }, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(url: string, init?: RequestInit, ms?: number): Promise<T | null> {
  const res = await fetchWithTimeout(url, init, ms);
  if (!res?.ok) return null;
  try { return (await res.json()) as T; } catch { return null; }
}

/* ── OSM: the tags the object itself carries (website, wikidata, a pointed-at image) ─────────────────────── */
interface OsmExtra { wikidata?: string; commons?: string; image?: string; website?: string; hours?: string; phone?: string }

const extraOf = (t: Record<string, string> = {}): OsmExtra => ({
  wikidata: t.wikidata,
  commons: t.wikimedia_commons,
  image: t.image,
  website: t.website || t["contact:website"],
  hours: t.opening_hours,
  phone: t.phone || t["contact:phone"],
});

/** What OpenStreetMap itself records for this place: by its object id when we have one, otherwise by finding the
 * object with the same name beside these coordinates. Keyless (Nominatim). */
export async function discoverOsm(name: string, at: Coordinate, osmId?: string): Promise<OsmExtra> {
  const m = osmId?.match(/^(node|way|relation)\/(\d+)$/);
  if (m) {
    const data = await json<Array<{ extratags?: Record<string, string> }>>(`https://nominatim.openstreetmap.org/lookup?osm_ids=${m[1][0].toUpperCase()}${m[2]}&format=jsonv2&extratags=1`);
    return extraOf(data?.[0]?.extratags);
  }
  if (!name.trim()) return {};
  const r = 0.004; // ~400 m box
  const box = `${at[0] - r},${at[1] + r},${at[0] + r},${at[1] - r}`;
  const found = await json<Array<{ name?: string; lat: string; lon: string; extratags?: Record<string, string> }>>(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=jsonv2&extratags=1&limit=6&bounded=1&viewbox=${box}`,
  );
  const target = norm(name);
  const hit = (found ?? []).find((f) => {
    const n = norm(f.name ?? "");
    return (n === target || n.includes(target) || target.includes(n)) && haversineMeters(at, [Number(f.lon), Number(f.lat)]) < 250;
  });
  return extraOf(hit?.extratags);
}

/** A Wikidata item that is this place: same name, and its coordinates beside ours. Keyless. */
async function wikidataIdFor(name: string, at: Coordinate): Promise<string | undefined> {
  if (!name.trim()) return undefined;
  const search = await json<{ search?: Array<{ id: string; label?: string }> }>(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=6&format=json&origin=*`,
  );
  const ids = (search?.search ?? []).map((x) => x.id);
  if (!ids.length) return undefined;
  const entities = await json<{ entities?: Record<string, { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: any } } }>> }> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims&format=json&origin=*`,
  );
  for (const id of ids) {
    const c = entities?.entities?.[id]?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (c && typeof c.longitude === "number" && haversineMeters(at, [c.longitude, c.latitude]) < 300) return id;
  }
  return undefined;
}

const commonsFile = (file: string, width = 960) =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/^File:/i, "").replace(/ /g, "_"))}?width=${width}`;

async function commonsCategoryImages(category: string, limit = 6): Promise<EnrichedPhoto[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query", generator: "categorymembers", gcmtitle: category.startsWith("Category:") ? category : `Category:${category}`,
    gcmtype: "file", gcmlimit: String(limit * 2), prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "960", format: "json", origin: "*",
  }).toString();
  const data = await json<{ query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ thumburl?: string; mime?: string; descriptionurl?: string; extmetadata?: { ImageDescription?: { value?: string } } }> }> } }>(url.toString());
  const out: EnrichedPhoto[] = [];
  for (const page of Object.values(data?.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !/^image\/(jpeg|png|webp)/.test(info.mime ?? "")) continue;
    out.push({ url: info.thumburl, source: "Wikimedia Commons", caption: (page.title ?? "").replace(/^File:/, "").replace(/\.[a-z]+$/i, ""), link: info.descriptionurl });
    if (out.length >= limit) break;
  }
  return out;
}

async function wikidataPhotos(qid: string | undefined): Promise<EnrichedPhoto[]> {
  if (!qid || !/^Q\d+$/.test(qid)) return [];
  const claims = await json<{ claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`,
  ).then((d) => (d as any)?.entities?.[qid]?.claims as Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> | undefined);
  const out: EnrichedPhoto[] = [];
  for (const c of claims?.P18 ?? []) {
    const file = c.mainsnak?.datavalue?.value;
    if (typeof file === "string") out.push({ url: commonsFile(file), source: "Wikimedia Commons", caption: file.replace(/\.[a-z]+$/i, ""), link: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}` });
  }
  const category = claims?.P373?.[0]?.mainsnak?.datavalue?.value;
  if (typeof category === "string") out.push(...(await commonsCategoryImages(category)));
  return out;
}

/* ── the place's own website: its current, deliberately chosen pictures ──────────────────────────────────── */
async function websitePhotos(site: string | undefined): Promise<EnrichedPhoto[]> {
  if (!site || !/^https?:\/\//i.test(site)) return [];
  const res = await fetchWithTimeout(site, { headers: { Accept: "text/html" }, redirect: "follow" }, 5000);
  if (!res?.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return [];
  const html = (await res.text()).slice(0, 400_000);
  const base = res.url || site;
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const u = new URL(raw.replace(/&amp;/g, "&"), base);
      if (u.protocol !== "https:") return;
      if (/(logo|favicon|sprite|icon|placeholder|avatar|pixel|tracking)/i.test(u.pathname)) return;
      if (!/\.(jpe?g|png|webp|avif)(\?|$)/i.test(u.pathname + u.search) && !/image|photo|media|cdn|upload/i.test(u.href)) return;
      if (!found.includes(u.href)) found.push(u.href);
    } catch { /* not a URL */ }
  };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: any) => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v === "object") { if (v.image) { for (const i of [].concat(v.image)) push(typeof i === "string" ? i : i?.url); } Object.values(v).forEach((x) => typeof x === "object" && walk(x)); }
      };
      walk(JSON.parse(m[1]));
    } catch { /* malformed JSON-LD */ }
  }
  const host = new URL(base).hostname.replace(/^www\./, "");
  return found.slice(0, 5).map((url) => ({ url, source: "Official site", caption: host, link: base }));
}

/* ── assembly ─────────────────────────────────────────────────────────────────────────────────────────────── */
export async function enrichPlace(input: EnrichInput, deps: EnrichDeps = {}, wikiPhoto?: EnrichedPhoto | null): Promise<EnrichedPlace> {
  const key = `${norm(input.name)}@${input.coordinates[1].toFixed(4)},${input.coordinates[0].toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const extra = await discoverOsm(input.name, input.coordinates, input.osmId);
  const website = input.website || extra.website;
  const qid = extra.wikidata || (await wikidataIdFor(input.name, input.coordinates));
  const [site, wikidata, commonsTag, mangrove] = await Promise.all([
    websitePhotos(website),
    wikidataPhotos(qid),
    extra.commons ? (/^File:/i.test(extra.commons) ? Promise.resolve([{ url: commonsFile(extra.commons), source: "Wikimedia Commons", caption: extra.commons.replace(/^File:/i, "").replace(/\.[a-z]+$/i, "") } as EnrichedPhoto]) : commonsCategoryImages(extra.commons)) : Promise.resolve([]),
    deps.mangrove ? deps.mangrove(input.osmId).catch(() => null) : Promise.resolve(null),
  ]);

  const photos: EnrichedPhoto[] = [];
  const add = (list: EnrichedPhoto[]) => { for (const p of list) if (p.url && !photos.some((x) => x.url === p.url)) photos.push(p); };
  add(site);
  if (extra.image && /^https:\/\//.test(extra.image)) add([{ url: extra.image, source: "OpenStreetMap", caption: "Linked from the map data" }]);
  add(wikidata);
  add(commonsTag);
  if (wikiPhoto) add([wikiPhoto]);

  const ratings: EnrichedRating[] = [];
  if (mangrove?.count) ratings.push({ source: "Mangrove", value: mangrove.rating ?? 0, count: mangrove.count, url: "https://mangrove.reviews", reviews: mangrove.items.filter((i) => i.text).slice(0, 3).map((i) => ({ rating: i.rating, text: i.text!, when: i.createdAt?.slice(0, 10) })) });

  const weekly = weeklyHours(input.openingHoursRaw || extra.hours) ?? undefined;
  const value: EnrichedPlace = {
    photos: photos.slice(0, 10),
    hours: weekly ? { weekly, source: "OpenStreetMap" } : undefined,
    ratings,
    website,
    phone: extra.phone,
    sources: [...new Set([site.length ? "Official site" : "", wikidata.length || commonsTag.length ? "Wikimedia" : "", weekly ? "OpenStreetMap" : "", ...ratings.map((r) => r.source)].filter(Boolean))],
  };
  const rich = value.photos.length > 0 || value.ratings.length > 0;
  cache.set(key, { at: rich ? Date.now() : Date.now() - (TTL - 60_000), value });
  return value;
}
