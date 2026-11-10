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
  priceLevel?: string;
  website?: string;
  phone?: string;
  mapsUrl?: string;
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
  /** A live web search that returns readable pages (the same engine Clyra Chat uses). */
  web?: (query: string) => Promise<Array<{ url: string; excerpt: string }>>;
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

async function osmExtra(osmId: string | undefined): Promise<OsmExtra> {
  const m = osmId?.match(/^(node|way|relation)\/(\d+)$/);
  if (!m) return {};
  const data = await json<Array<{ extratags?: Record<string, string> }>>(
    `https://nominatim.openstreetmap.org/lookup?osm_ids=${m[1][0].toUpperCase()}${m[2]}&format=jsonv2&extratags=1`,
  );
  const t = data?.[0]?.extratags ?? {};
  return {
    wikidata: t.wikidata,
    commons: t.wikimedia_commons,
    image: t.image,
    website: t.website || t["contact:website"],
    hours: t.opening_hours,
    phone: t.phone || t["contact:phone"],
  };
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

/* ── Google Places (optional key): the most current photos, hours and reviews ────────────────────────────── */
const PRICE: Record<string, string> = { PRICE_LEVEL_FREE: "Free", PRICE_LEVEL_INEXPENSIVE: "$", PRICE_LEVEL_MODERATE: "$$", PRICE_LEVEL_EXPENSIVE: "$$$", PRICE_LEVEL_VERY_EXPENSIVE: "$$$$" };

export const googlePlacesEnabled = () => Boolean(process.env.GOOGLE_PLACES_API_KEY);

async function googlePlace(input: EnrichInput): Promise<{ photos: EnrichedPhoto[]; hours?: Array<{ day: string; text: string }>; rating?: EnrichedRating; price?: string; website?: string; phone?: string; url?: string } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  const [lng, lat] = input.coordinates;
  const data = await json<{ places?: any[] }>(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.reviews,places.regularOpeningHours,places.photos,places.priceLevel,places.websiteUri,places.googleMapsUri,places.nationalPhoneNumber",
      },
      body: JSON.stringify({ textQuery: [input.name, input.locality].filter(Boolean).join(" "), locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 250 } }, maxResultCount: 3 }),
    },
    8000,
  );
  const target = norm(input.name);
  const hit = (data?.places ?? []).find((p) => {
    const there: Coordinate = [p.location?.longitude, p.location?.latitude];
    const n = norm(p.displayName?.text ?? "");
    return Number.isFinite(there[0]) && haversineMeters(input.coordinates, there) < 250 && (n.includes(target) || target.includes(n));
  });
  if (!hit) return null;
  return {
    photos: (hit.photos ?? []).slice(0, 8).map((ph: any) => ({
      url: `/api/maps/google-photo?n=${encodeURIComponent(ph.name)}`,
      source: "Google",
      caption: ph.authorAttributions?.[0]?.displayName ? `Photo by ${ph.authorAttributions[0].displayName}` : undefined,
      link: hit.googleMapsUri,
    })),
    hours: Array.isArray(hit.regularOpeningHours?.weekdayDescriptions)
      ? hit.regularOpeningHours.weekdayDescriptions.map((line: string) => { const i = line.indexOf(":"); return { day: line.slice(0, i), text: line.slice(i + 1).trim() }; })
      : undefined,
    rating: typeof hit.rating === "number"
      ? {
          source: "Google",
          value: hit.rating,
          count: hit.userRatingCount,
          url: hit.googleMapsUri,
          reviews: (hit.reviews ?? []).slice(0, 5).map((r: any) => ({ author: r.authorAttribution?.displayName, rating: r.rating, text: r.text?.text ?? r.originalText?.text ?? "", when: r.relativePublishTimeDescription })).filter((r: EnrichedReview) => r.text),
        }
      : undefined,
    price: PRICE[hit.priceLevel],
    website: hit.websiteUri,
    phone: hit.nationalPhoneNumber,
    url: hit.googleMapsUri,
  };
}

/** Fetches one Google photo's bytes for the proxy route, so the API key never reaches the browser. */
export async function googlePhotoBytes(photoName: string, width = 960): Promise<{ body: ArrayBuffer; type: string } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(photoName)) return null;
  const res = await fetchWithTimeout(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${width}&key=${key}`, {}, 10000);
  if (!res?.ok) return null;
  return { body: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "image/jpeg" };
}

/* ── ratings quoted by review sites, from a live search ─────────────────────────────────────────────────── */
export const REVIEW_HOSTS = /(tripadvisor|yelp|facebook|foursquare|opentable|zomato|restaurantguru|wanderlog|trustpilot|booking\.com|google\.[a-z.]+\/maps|maps\.google)/i;

export function ratingFromText(text: string, name: string): { value: number; count?: number } | null {
  const first = norm(name).split(" ").slice(0, 2).join(" ");
  if (!first || !norm(text).includes(first)) return null;
  const compact = text.match(/\b([1-5]\.\d)\s*\(\s*([\d,]{2,7})\s*\)/);
  if (compact) return { value: Number(compact[1]), count: Number(compact[2].replace(/,/g, "")) };
  const value = text.match(/(?:rated|rating|score|scored|reviews?|stars?)\D{0,24}([1-5](?:\.\d)?)\s*(?:\/\s*5|out of 5|stars?)?/i) ?? text.match(/\b([1-5](?:\.\d)?)\s*(?:\/\s*5|out of 5|stars)\b/i);
  if (!value) return null;
  const v = Number(value[1]);
  if (!(v >= 1 && v <= 5)) return null;
  const count = text.match(/\b(\d[\d,]{1,6})\s*(?:reviews|ratings|votes)\b/i);
  return { value: v, count: count ? Number(count[1].replace(/,/g, "")) : undefined };
}

async function webRatings(input: EnrichInput, deps: EnrichDeps): Promise<EnrichedRating[]> {
  if (!deps.web) return [];
  const pages = await deps.web(`${input.name} ${input.locality ?? ""} reviews rating`).catch(() => []);
  const out: EnrichedRating[] = [];
  for (const page of pages) {
    let host = "";
    try { host = new URL(page.url).hostname.replace(/^www\./, ""); } catch { continue; }
    if (!REVIEW_HOSTS.test(page.url)) continue;
    const found = ratingFromText(page.excerpt, input.name);
    if (found && !out.some((r) => r.source === host)) out.push({ source: host, value: found.value, count: found.count, url: page.url });
  }
  return out.slice(0, 3);
}

/* ── Yelp Fusion and Foursquare Places (each optional, enabled by its own free API key) ───────────────────── */
interface Partner { rating?: EnrichedRating; photos: EnrichedPhoto[]; hours?: Array<{ day: string; text: string }> }
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hhmm = (v: string) => { const h = Number(v.slice(0, 2)); const m = v.slice(2, 4); return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`; };

async function yelpPlace(input: EnrichInput): Promise<Partner | null> {
  const key = process.env.YELP_API_KEY;
  if (!key) return null;
  const [lng, lat] = input.coordinates;
  const auth = { Authorization: `Bearer ${key}` };
  const search = await json<{ businesses?: any[] }>(`https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(input.name)}&latitude=${lat}&longitude=${lng}&limit=3&sort_by=distance`, { headers: auth }, 7000);
  const target = norm(input.name);
  const hit = (search?.businesses ?? []).find((b) => { const n = norm(b.name ?? ""); return (n.includes(target) || target.includes(n)) && b.coordinates && haversineMeters(input.coordinates, [b.coordinates.longitude, b.coordinates.latitude]) < 250; });
  if (!hit) return null;
  const [detail, reviews] = await Promise.all([
    json<any>(`https://api.yelp.com/v3/businesses/${hit.id}`, { headers: auth }, 7000),
    json<{ reviews?: any[] }>(`https://api.yelp.com/v3/businesses/${hit.id}/reviews?limit=3&sort_by=yelp_sort`, { headers: auth }, 7000),
  ]);
  const week: Array<string[]> = [[], [], [], [], [], [], []];
  for (const o of detail?.hours?.[0]?.open ?? []) week[o.day]?.push(`${hhmm(o.start)} – ${hhmm(o.end)}`);
  return {
    rating: { source: "Yelp", value: hit.rating, count: hit.review_count, url: hit.url?.split("?")[0], reviews: (reviews?.reviews ?? []).map((r) => ({ author: r.user?.name, rating: r.rating, text: r.text, when: r.time_created?.slice(0, 10) })) },
    photos: (detail?.photos ?? []).slice(0, 6).map((u: string) => ({ url: u, source: "Yelp", link: hit.url?.split("?")[0] })),
    hours: detail?.hours?.[0] ? DAY_NAMES.map((day, i) => ({ day, text: week[i].length ? week[i].join(", ") : "Closed" })) : undefined,
  };
}

async function foursquarePlace(input: EnrichInput): Promise<Partner | null> {
  const key = process.env.FOURSQUARE_API_KEY;
  if (!key) return null;
  const [lng, lat] = input.coordinates;
  const headers = { Authorization: key, Accept: "application/json" };
  const search = await json<{ results?: any[] }>(`https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(input.name)}&ll=${lat},${lng}&radius=300&limit=3&fields=fsq_id,name,geocodes,rating,stats,hours,photos,tips,link`, { headers }, 7000);
  const target = norm(input.name);
  const hit = (search?.results ?? []).find((p) => { const n = norm(p.name ?? ""); return n.includes(target) || target.includes(n); });
  if (!hit) return null;
  const week: Array<string[]> = [[], [], [], [], [], [], []];
  for (const r of hit.hours?.regular ?? []) week[(r.day + 6) % 7]?.push(`${hhmm(r.open)} – ${hhmm(r.close)}`);
  return {
    rating: typeof hit.rating === "number" ? { source: "Foursquare", value: Math.round((hit.rating / 2) * 10) / 10, count: hit.stats?.total_ratings, url: `https://foursquare.com/v/${hit.fsq_id}`, reviews: (hit.tips ?? []).slice(0, 3).map((t: any) => ({ text: t.text, when: t.created_at?.slice(0, 10) })) } : undefined,
    photos: (hit.photos ?? []).slice(0, 6).map((p: any) => ({ url: `${p.prefix}960x720${p.suffix}`, source: "Foursquare", link: `https://foursquare.com/v/${hit.fsq_id}` })),
    hours: hit.hours?.regular?.length ? DAY_NAMES.map((day, i) => ({ day, text: week[i].length ? week[i].join(", ") : "Closed" })) : undefined,
  };
}

/* ── assembly ─────────────────────────────────────────────────────────────────────────────────────────────── */
export async function enrichPlace(input: EnrichInput, deps: EnrichDeps = {}, wikiPhoto?: EnrichedPhoto | null): Promise<EnrichedPlace> {
  const key = `${norm(input.name)}@${input.coordinates[1].toFixed(4)},${input.coordinates[0].toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  const [extra, google] = await Promise.all([osmExtra(input.osmId), googlePlace(input)]);
  const website = google?.website || input.website || extra.website;
  const [site, wikidata, commonsTag, mangrove, yelp, fsq] = await Promise.all([
    websitePhotos(website),
    wikidataPhotos(extra.wikidata),
    extra.commons ? (/^File:/i.test(extra.commons) ? Promise.resolve([{ url: commonsFile(extra.commons), source: "Wikimedia Commons", caption: extra.commons.replace(/^File:/i, "").replace(/\.[a-z]+$/i, "") } as EnrichedPhoto]) : commonsCategoryImages(extra.commons)) : Promise.resolve([]),
    deps.mangrove ? deps.mangrove(input.osmId).catch(() => null) : Promise.resolve(null),
    google?.rating ? Promise.resolve(null) : yelpPlace(input),
    google?.rating ? Promise.resolve(null) : foursquarePlace(input),
  ]);

  const photos: EnrichedPhoto[] = [];
  const add = (list: EnrichedPhoto[]) => { for (const p of list) if (p.url && !photos.some((x) => x.url === p.url)) photos.push(p); };
  add(google?.photos ?? []);
  add(yelp?.photos ?? []);
  add(fsq?.photos ?? []);
  add(site);
  if (extra.image && /^https:\/\//.test(extra.image)) add([{ url: extra.image, source: "OpenStreetMap", caption: "Linked from the map data" }]);
  add(wikidata);
  add(commonsTag);
  if (wikiPhoto) add([wikiPhoto]);

  const ratings: EnrichedRating[] = [];
  if (google?.rating) ratings.push(google.rating);
  if (mangrove?.count) ratings.push({ source: "Mangrove", value: mangrove.rating ?? 0, count: mangrove.count, url: "https://mangrove.reviews", reviews: mangrove.items.filter((i) => i.text).slice(0, 3).map((i) => ({ rating: i.rating, text: i.text!, when: i.createdAt?.slice(0, 10) })) });
  if (yelp?.rating) ratings.push(yelp.rating);
  if (fsq?.rating) ratings.push(fsq.rating);

  const weekly = google?.hours ?? yelp?.hours ?? fsq?.hours ?? weeklyHours(input.openingHoursRaw || extra.hours) ?? undefined;
  const value: EnrichedPlace = {
    photos: photos.slice(0, 10),
    hours: weekly ? { weekly, source: google?.hours ? "Google" : yelp?.hours ? "Yelp" : fsq?.hours ? "Foursquare" : "OpenStreetMap" } : undefined,
    ratings,
    priceLevel: google?.price,
    website,
    phone: google?.phone || extra.phone,
    mapsUrl: google?.url,
    sources: [...new Set([google ? "Google Places" : "", yelp ? "Yelp" : "", fsq ? "Foursquare" : "", site.length ? "Official site" : "", wikidata.length || commonsTag.length ? "Wikimedia" : "", weekly ? (google?.hours ? "Google" : yelp?.hours ? "Yelp" : fsq?.hours ? "Foursquare" : "OpenStreetMap") : "", ...ratings.map((r) => r.source)].filter(Boolean))],
  };
  const rich = value.photos.length > 0 || value.ratings.length > 0;
  cache.set(key, { at: rich ? Date.now() : Date.now() - (TTL - 60_000), value });
  return value;
}
