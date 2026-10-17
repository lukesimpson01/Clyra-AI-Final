/** Open reviews from Mangrove (mangrove.reviews). Mangrove publishes signed
 * reviews; this adapter verifies each review's ES256 signature before using it
 * and only keeps reviews whose OSM identity matches the selected object. The
 * public feed cannot be filtered by place (the `subject` parameter is ignored by
 * the API), so coverage is whatever matching reviews appear in the feed. Most
 * places will correctly have none. Ratings are Mangrove's 0-100 scale, shown as
 * stars (÷20). Nothing is invented: no matching signed review means no rating. */
import { createPublicKey, verify } from "node:crypto";

export interface PlaceReview {
  id: string;
  rating: number; // 0–5 stars
  text?: string;
  createdAt?: string;
  source: "Mangrove";
  sourceUrl: string;
}

export interface PlaceReviews {
  rating?: number;
  count: number;
  items: PlaceReview[];
}

const UA = "ClyraMaps/1.0 (open reviews lookup)";
const FEED_LIMIT = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
let feedCache: { at: number; reviews: Array<{ jwt: string; kid: string }> } | null = null;

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function decodePayload(jwt: string): Record<string, any> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(b64urlToBuffer(parts[1]).toString("utf8"));
  } catch {
    return null;
  }
}

/** Mangrove sends the PEM with its line breaks stripped; re-wrap it to 64 columns. */
function pemFrom(kid: string): string {
  const body = kid.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END PUBLIC KEY-----\n`;
}

/** Checks the JWS signature against the public key Mangrove embeds in the review's `kid`. */
function signatureValid(jwt: string, kid: string): boolean {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return false;
  try {
    const key = createPublicKey(pemFrom(kid));
    return verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, b64urlToBuffer(s));
  } catch {
    return false;
  }
}

async function feed(): Promise<Array<{ jwt: string; kid: string }>> {
  if (feedCache && Date.now() - feedCache.at < CACHE_TTL_MS) return feedCache.reviews;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.mangrove.reviews/reviews?limit=${FEED_LIMIT}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return feedCache?.reviews ?? [];
    const data = (await res.json()) as { reviews?: Array<{ jwt?: string; kid?: string }> };
    const reviews = (data.reviews ?? []).filter((r): r is { jwt: string; kid: string } => typeof r.jwt === "string" && typeof r.kid === "string");
    feedCache = { at: Date.now(), reviews };
    return reviews;
  } catch {
    return feedCache?.reviews ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/** `osmId` is in Overpass form, e.g. "way/681504477" or "node/123". */
export async function findOpenReviews(osmId: string | undefined): Promise<PlaceReviews | null> {
  if (!osmId) return null;
  const items: PlaceReview[] = [];
  for (const r of await feed()) {
    const payload = decodePayload(r.jwt);
    if (!payload || payload.metadata?.osm_id !== osmId) continue;
    if (!signatureValid(r.jwt, r.kid)) continue;
    const rating = Number(payload.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 100) continue;
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    items.push({
      id: sub.slice(0, 80) || `mangrove-${items.length}`,
      rating: Math.round((rating / 20) * 10) / 10,
      text: typeof payload.opinion === "string" && payload.opinion.trim() ? payload.opinion.trim().slice(0, 600) : undefined,
      createdAt: Number.isFinite(payload.iat) ? new Date(payload.iat * 1000).toISOString() : undefined,
      source: "Mangrove",
      sourceUrl: "https://mangrove.reviews",
    });
  }
  if (!items.length) return null;
  const rating = Math.round((items.reduce((s, i) => s + i.rating, 0) / items.length) * 10) / 10;
  return { rating, count: items.length, items };
}
