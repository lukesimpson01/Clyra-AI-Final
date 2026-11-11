/**
 * Read-only, provider-backed visual and GitHub lookups for the Chat agent.
 * All returned cards must come from successful upstream responses, never model-invented URLs.
 * Wikimedia Commons thumbnails expose their original file page and licence; GitHub
 * cards are sourced from GitHub's repository API. No API key or paid service required.
 */
export type ResearchImage = {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  creator?: string;
  licence?: string;
};
export type ResearchRepository = {
  fullName: string;
  url: string;
  description: string;
  stars: number;
  language?: string;
  licence?: string;
  updatedAt?: string;
  ownerAvatar?: string;
};
export type RepositoryInspection = { repository: ResearchRepository; readme: string; files: string[] };

const validHttps = (raw: unknown, domain: string) => {
  try {
    const parsed = new URL(String(raw));
    return parsed.protocol === "https:" && (parsed.hostname === domain || parsed.hostname.endsWith("." + domain)) ? parsed.href : "";
  } catch { return ""; }
};
const validPublicHttps = (raw: unknown) => {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return "";
    return url.href;
  } catch { return ""; }
};
const clean = (raw: unknown, limit = 180) =>
  String(raw ?? "").replace(/<[^>]+>/g, " ").replace(/&(?:amp|nbsp|quot|lt|gt);/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
const bounded = (value: number | undefined, maximum: number) =>
  Math.min(maximum, Math.max(1, Number.isFinite(value) ? Math.floor(Number(value)) : maximum));

export function parseCommonsImages(data: unknown, maxResults = 8): ResearchImage[] {
  const pages = (data as { query?: { pages?: unknown[] } } | null)?.query?.pages;
  if (!Array.isArray(pages)) return [];
  const images: ResearchImage[] = [];
  for (const page of pages) {
    if (!page || typeof page !== "object") continue;
    const p = page as Record<string, any>;
    const info = Array.isArray(p.imageinfo) ? p.imageinfo[0] : null;
    if (!info || !/^image\/(?:jpeg|png|webp)$/i.test(String(info.mime || ""))) continue;
    const imageUrl = validHttps(info.url, "upload.wikimedia.org");
    const thumbnailUrl = validHttps(info.thumburl, "upload.wikimedia.org") || imageUrl;
    const sourceUrl = validHttps(info.descriptionurl, "commons.wikimedia.org");
    if (!imageUrl || !thumbnailUrl || !sourceUrl) continue;
    const metadata = info.extmetadata || {};
    const title = clean(metadata.ObjectName?.value || p.title, 120).replace(/^File:/i, "");
    if (!title) continue;
    if (images.some((image) => image.sourceUrl === sourceUrl)) continue;
    images.push({
      id: String(p.pageid || images.length + 1),
      title,
      imageUrl,
      thumbnailUrl,
      sourceUrl,
      creator: clean(metadata.Artist?.value, 100) || undefined,
      licence: clean(metadata.LicenseShortName?.value || metadata.UsageTerms?.value, 75) || undefined,
    });
    if (images.length >= bounded(maxResults, 10)) break;
  }
  return images;
}

export function parseOpenverseImages(data: unknown, maxResults = 8): ResearchImage[] {
  const results = (data as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const images: ResearchImage[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, any>;
    if (item.mature === true || item.unstable__sensitivity?.is_sensitive === true) continue;
    const imageUrl = validPublicHttps(item.url);
    const sourceUrl = validPublicHttps(item.foreign_landing_url);
    const directThumbnail = validPublicHttps(item.thumbnail);
    const id = String(item.id || "");
    const proxyThumbnail = /^[0-9a-f-]{36}$/i.test(id) ? "https://api.openverse.org/v1/images/" + id + "/thumb/" : "";
    const thumbnailUrl = proxyThumbnail || directThumbnail;
    const title = clean(item.title, 120);
    if (!imageUrl || !sourceUrl || !thumbnailUrl || !title) continue;
    const licence = clean([item.license, item.license_version].filter(Boolean).join(" "), 75);
    images.push({ id, title, imageUrl, thumbnailUrl, sourceUrl, creator: clean(item.creator, 100) || undefined, licence: licence || undefined });
    if (images.length >= bounded(maxResults, 10)) break;
  }
  return images;
}

export function parseGitHubRepositories(data: unknown, maxResults = 6): ResearchRepository[] {
  const items = (data as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, any>;
    const fullName = String(entry.full_name || "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return [];
    const url = validHttps(entry.html_url, "github.com");
    if (!url) return [];
    return [{
      fullName,
      url,
      description: clean(entry.description, 260),
      stars: Math.max(0, Math.floor(Number(entry.stargazers_count) || 0)),
      language: clean(entry.language, 35) || undefined,
      licence: clean(entry.license?.spdx_id === "NOASSERTION" ? "" : entry.license?.spdx_id, 45) || undefined,
      updatedAt: /^\d{4}-\d\d-\d\d/.test(String(entry.updated_at)) ? String(entry.updated_at) : undefined,
      ownerAvatar: validHttps(entry.owner?.avatar_url, "avatars.githubusercontent.com") || undefined,
    }];
  }).slice(0, bounded(maxResults, 10));
}

type Fetcher = typeof fetch;
async function requestJson(url: string, signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<any> {
  const response = await fetcher(url, {
    headers: { "User-Agent": "Clyra-Chat/1.0 (research)", "Accept": "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(11000)]) : AbortSignal.timeout(11000),
  });
  if (!response.ok) throw new Error(response.status === 429 || response.status === 403
    ? "The public search service is rate limited. Please retry shortly."
    : "Research provider returned HTTP " + response.status);
  return response.json();
}

export async function searchResearchImages(
  query: string,
  options: { signal?: AbortSignal; maxResults?: number; fetcher?: Fetcher } = {},
): Promise<ResearchImage[]> {
  const phrase = query.trim().slice(0, 160);
  if (!phrase) throw new Error("An image-search query is required.");
  const size = bounded(options.maxResults, 8);
  const params = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: phrase, gsrnamespace: "6",
    gsrlimit: String(Math.min(20, size * 2)), prop: "imageinfo",
    iiprop: "url|mime|extmetadata", iiurlwidth: "920", format: "json", formatversion: "2",
  });
  // Openverse has a wider catalogue of openly licensed photographs. Commons is
  // a separate fallback, so a rate limit or one provider's sparse coverage
  // never silently turns into model-invented thumbnails.
  let openverse: ResearchImage[] = [];
  try {
    const search = new URLSearchParams({ q: phrase, page_size: String(size), mature: "false" });
    const payload = await requestJson("https://api.openverse.org/v1/images/?" + search, options.signal, options.fetcher);
    openverse = parseOpenverseImages(payload, size);
  } catch (error) {
    if (options.signal?.aborted) throw error;
  }
  if (openverse.length >= size) return openverse;
  try {
    const payload = await requestJson("https://commons.wikimedia.org/w/api.php?" + params, options.signal, options.fetcher);
    const seen = new Set(openverse.map((image) => image.sourceUrl));
    return [...openverse, ...parseCommonsImages(payload, size).filter((image) => !seen.has(image.sourceUrl))].slice(0, size);
  } catch (error) {
    if (options.signal?.aborted || !openverse.length) throw error;
    return openverse;
  }
}

export async function searchGitHubRepositories(
  query: string,
  options: { signal?: AbortSignal; maxResults?: number; fetcher?: Fetcher } = {},
): Promise<ResearchRepository[]> {
  const phrase = query.trim().slice(0, 160);
  if (!phrase) throw new Error("A GitHub repository-search query is required.");
  const size = bounded(options.maxResults, 6);
  const params = new URLSearchParams({ q: phrase, per_page: String(size) });
  const payload = await requestJson("https://api.github.com/search/repositories?" + params, options.signal, options.fetcher);
  return parseGitHubRepositories(payload, size);
}

export async function inspectGitHubRepository(
  fullName: string,
  options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<RepositoryInspection> {
  const name = fullName.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(name) || name.split("/").some((part) => part === "." || part === "..")) throw new Error("Use a GitHub owner/repository name.");
  const url = "https://api.github.com/repos/" + name.split("/").map(encodeURIComponent).join("/");
  const payload = await requestJson(url, options.signal, options.fetcher);
  const repository = parseGitHubRepositories({ items: [payload] }, 1)[0];
  if (!repository) throw new Error("The repository could not be verified.");
  const [readmeResult, treeResult] = await Promise.allSettled([
    requestJson(url + "/readme", options.signal, options.fetcher),
    requestJson(url + "/contents", options.signal, options.fetcher),
  ]);
  const readmeInfo = readmeResult.status === "fulfilled" ? readmeResult.value : null;
  const encoded = typeof readmeInfo?.content === "string" && readmeInfo.encoding === "base64"
    ? readmeInfo.content.replace(/\s+/g, "") : "";
  const readme = encoded ? Buffer.from(encoded, "base64").toString("utf8").slice(0, 8500) : "";
  const tree = treeResult.status === "fulfilled" && Array.isArray(treeResult.value) ? treeResult.value : [];
  const files = tree.map((item: { name?: string }) => clean(item.name, 90)).filter(Boolean).slice(0, 35);
  return { repository, readme, files };
}

/** Strictly read-only helpers may run automatically without a slash command. */
export function inferRichSearchIntent(text: string): { images: boolean; github: boolean; repository?: string } {
  const t = text.trim();
  const match = t.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:[/?#\s]|$)/i);
  const repository = match ? match[1] + "/" + match[2].replace(/\.git$/i, "") : undefined;
  const visualResearch = /\b(?:research|look up|compare|find out|tell me about|recommend)\b/i.test(t)
    && /\b(?:cars?|vehicles?|hotels?|beaches?|destinations?|landmarks?|monuments?|architecture|buildings?|animals?|birds?|plants?|flowers?|fashion|outfits?|clothes|sneakers?|shoes|paintings?|sculptures?|museums?|smartphones?|cameras?)\b/i.test(t);
  const images = (/\b(?:images?|photos?|pictures?|screenshots?|photographs?|gallery|visual references?|what .{0,50} looks? like|show me .{0,30}(?:picture|photo))\b/i.test(t) || visualResearch)
    && !/\b(?:generate|draw|create|edit|render|design|make)\s+(?:me\s+|an?\s+)?(?:image|picture|photo|art)\b/i.test(t);
  const github = !repository && /\b(?:github|git repositories|repositories|repos?|open.source projects?|cloneable projects?)\b/i.test(t)
    && /\b(?:find|show|list|search|recommend|best|top|compare|alternative|clone|discover|look|research)\b/i.test(t);
  return { images, github, repository };
}
