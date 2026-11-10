/** Real photos and descriptions for a selected place, from keyless public
 * sources (Wikipedia geosearch + summary, Wikimedia Commons geosearch). Every
 * field is optional and only set when a source actually returned it — nothing
 * is invented, so the UI can simply hide sections that have no data. */
import type { Coordinate, PlacePhoto } from "./types";

export interface PlaceInfo {
  summary?: string;
  summaryUrl?: string;
  photos: PlacePhoto[];
}

const TIMEOUT_MS = 6000;
const UA = "ClyraMaps/1.0 (place info lookup)";
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { at: number; info: PlaceInfo }>();

async function getJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface GeoSearchHit {
  title: string;
  dist: number;
  pageid: number;
}

interface WikiSummary {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
  type?: string;
}

interface CommonsPage {
  title?: string;
  imageinfo?: Array<{
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } };
  }>;
}

/** Looks up the nearest Wikipedia article whose title matches the place name,
 * then fetches its plain-text summary. Returns null when nothing matches well. */
async function wikipediaSummary(
  name: string,
  at: Coordinate,
): Promise<{ summary: string; url?: string; image?: PlacePhoto } | null> {
  const geo = new URL("https://en.wikipedia.org/w/api.php");
  geo.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${at[1]}|${at[0]}`,
    gsradius: "300",
    gslimit: "10",
    format: "json",
    origin: "*",
  }).toString();
  const geoData = await getJson<{ query?: { geosearch?: GeoSearchHit[] } }>(geo.toString());
  const hits = geoData?.query?.geosearch ?? [];
  const target = normalise(name);
  // An article about a different thing that merely starts with the same words ("Bondi Beach" vs "Bondi Beach
  // Post Office") must never supply this place's picture: require the same title, or a very close subject.
  const match = hits.find((h) => {
    const t = normalise(h.title);
    if (t === target) return true;
    return h.dist <= 80 && (t.startsWith(`${target} `) === false) && (target.startsWith(`${t} `) === false) && (t.includes(target) || target.includes(t));
  });
  if (!match) return null;

  const summary = await getJson<WikiSummary>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(match.title.replace(/ /g, "_"))}`,
  );
  if (!summary?.extract || summary.type === "disambiguation") return null;
  // The original can be several thousand pixels wide; ask Wikimedia for a 960px rendition of the same picture.
  const thumb = summary.thumbnail?.source?.replace(/\/(\d+)px-/, "/960px-");
  const image = thumb || summary.originalimage?.source;
  return {
    summary: summary.extract,
    url: summary.content_urls?.desktop?.page,
    image: image ? { url: image, attribution: `Wikipedia · ${match.title}` } : undefined,
  };
}

/**
 * Named Wikimedia Commons images. A geographic search alone is not suitable
 * for a place gallery: it often returns an attractive photo from the next
 * block and makes it look as if it depicts the selected venue. Only retain
 * files whose title explicitly names the selected place; nearby imagery is
 * handled separately as clearly-labelled Street Look content.
 */
async function commonsPhotosForPlace(name: string, limit: number): Promise<PlacePhoto[]> {
  const target = normalise(name);
  if (!target) return [];
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `intitle:${name}`,
    gsrnamespace: "6",
    gsrlimit: String(limit * 2),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "960",
    format: "json",
    origin: "*",
  }).toString();
  const data = await getJson<{ query?: { pages?: Record<string, CommonsPage> } }>(url.toString());
  const pages = Object.values(data?.query?.pages ?? {});
  const photos: PlacePhoto[] = [];
  for (const page of pages) {
    // Commons page titles use a File: prefix. Require the actual place name
    // after normalisation, never merely a broad category or locality match.
    if (!normalise(page.title || "").includes(target)) continue;
    const info = page.imageinfo?.[0];
    if (!info?.thumburl) continue;
    const artist = info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "").trim();
    const license = info.extmetadata?.LicenseShortName?.value;
    const attribution = ["Wikimedia Commons", artist, license].filter(Boolean).join(" · ");
    photos.push({ url: info.thumburl, attribution });
  }
  return photos;
}

export async function lookupPlaceInfo(name: string, at: Coordinate): Promise<PlaceInfo> {
  // Rounded to ~10m: repeat selections of the same place (very common — a
  // user reopening a card, or two users looking at the same landmark) are
  // then served from memory instead of re-querying Wikipedia/Commons.
  const key = `${normalise(name)}@${at[1].toFixed(4)},${at[0].toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;

  const [wiki, namedCommons] = await Promise.all([
    name ? wikipediaSummary(name, at) : null,
    name ? commonsPhotosForPlace(name, 8) : Promise.resolve([]),
  ]);
  // The article's own lead image is the most reliable picture of the place,
  // followed only by Commons files that explicitly name it. We intentionally
  // do not pad the gallery with geotagged neighbouring photos.
  const photos = wiki?.image ? [wiki.image] : [];
  for (const p of namedCommons) if (!photos.some((x) => x.url === p.url)) photos.push(p);
  const info: PlaceInfo = {
    summary: wiki?.summary,
    summaryUrl: wiki?.url,
    photos,
  };
  // A lookup that found nothing may just have hit a slow moment at Wikipedia: remember it for a minute, not half an hour.
  const found = Boolean(info.summary || info.photos.length);
  cache.set(key, { at: found ? Date.now() : Date.now() - (CACHE_TTL_MS - 60_000), info });
  return info;
}
