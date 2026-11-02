/**
 * Clyra's web evidence engine for the chat agent: real search providers, rank fusion, safe page retrieval, passage
 * search and a provenance ledger. Nothing here invents a result: a source exists only because a provider returned it
 * or the person supplied it, and a citation id exists only because that page was actually fetched and read.
 *
 * Providers (all keyless): DuckDuckGo HTML, Wikipedia, and an optional self-hosted SearXNG (CLYRA_SEARXNG_URL).
 * They are diversified and fused with Reciprocal Rank Fusion; a provider that fails is put on a cooldown and the others
 * carry on. Pages are fetched through the SSRF-safe fetcher, so a model-invented URL can never reach a private network.
 */
import { execFile } from "node:child_process";
import TurndownService from "turndown";
import { safeFetchUserUrl, UnsafeUrlError } from "../security/safe-fetch";

export type SearchCategory = "general" | "news" | "docs";
export type SearchHit = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  host: string;
  providers: string[];
  publishedAt?: string;
  score: number;
};
export type ProviderHealth = { name: string; ok: boolean; failures: number; cooldownUntil: number; lastMs: number | null; lastError?: string };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const health = new Map<string, ProviderHealth>();
const healthOf = (name: string): ProviderHealth => {
  let entry = health.get(name);
  if (!entry) { entry = { name, ok: true, failures: 0, cooldownUntil: 0, lastMs: null }; health.set(name, entry); }
  return entry;
};
export const providerHealth = () => [...health.values()];

const decodeEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (all, e: string) => {
    if (e[0] === "#") { const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(code) ? String.fromCodePoint(code) : all; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[e.toLowerCase()] ?? all;
  });
const plain = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const TRACKING = /^(utm_|fbclid|gclid|mc_|ref$|ref_|igshid|yclid|_hs)/i;
/** One address per page: no tracking parameters, fragment, "www." or trailing slash. */
export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
    url.hostname = url.hostname.replace(/^www\./i, "");
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return url; } };

type RawHit = { url: string; title: string; snippet: string; publishedAt?: string };

async function ddgHtml(query: string, signal?: AbortSignal): Promise<RawHit[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  const html = await response.text();
  if (/anomaly|captcha|unusual traffic/i.test(html.slice(0, 4000)) && !/result__a/.test(html)) throw new Error("DuckDuckGo asked for a challenge");
  const hits: RawHit[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/i).slice(1);
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let href = decodeEntities(link[1]);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = `https:${href}`;
    if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js|bing\.com\/aclick/i.test(href)) continue;
    const snippet = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    hits.push({ url: href, title: plain(link[2]), snippet: plain(snippet) });
  }
  return hits;
}

async function wikipedia(query: string, signal?: AbortSignal): Promise<RawHit[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "user-agent": "Clyra/1.0 (chat research)" }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
  const data = (await response.json()) as { query?: { search?: Array<{ title: string; snippet: string; timestamp?: string }> } };
  return (data.query?.search ?? []).map((item) => ({
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    title: `${item.title} - Wikipedia`,
    snippet: plain(item.snippet),
    publishedAt: item.timestamp,
  }));
}

async function searxng(query: string, category: SearchCategory, timeRange: string | null, signal?: AbortSignal): Promise<RawHit[]> {
  const base = (process.env.CLYRA_SEARXNG_URL || "").replace(/\/$/, "");
  if (!base) return [];
  const params = new URLSearchParams({ q: query, format: "json", categories: category === "news" ? "news" : "general" });
  if (timeRange) params.set("time_range", timeRange);
  const response = await fetch(`${base}/search?${params}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
  const data = (await response.json()) as { results?: Array<{ url: string; title: string; content?: string; publishedDate?: string }> };
  return (data.results ?? []).map((item) => ({ url: item.url, title: item.title, snippet: item.content ?? "", publishedAt: item.publishedDate }));
}

type Provider = { name: string; configured: () => boolean; run: (query: string, category: SearchCategory, timeRange: string | null, signal?: AbortSignal) => Promise<RawHit[]> };
const PROVIDERS: Provider[] = [
  { name: "searxng", configured: () => Boolean(process.env.CLYRA_SEARXNG_URL), run: (q, c, t, s) => searxng(q, c, t, s) },
  { name: "duckduckgo", configured: () => true, run: (q, _c, _t, s) => ddgHtml(q, s) },
  { name: "wikipedia", configured: () => true, run: (q, _c, _t, s) => wikipedia(q, s) },
];

export type SearchOptions = {
  queries: string[];
  category?: SearchCategory;
  timeRange?: "day" | "week" | "month" | "year" | null;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxResults?: number;
  signal?: AbortSignal;
};

/** Which fields a provider honoured: filters nobody supports are reported, never silently assumed to have worked. */
export type SearchOutcome = { hits: SearchHit[]; providersUsed: string[]; providersFailed: Array<{ name: string; error: string }>; unsupported: string[] };

export class EvidenceLedger {
  discovered = new Map<string, SearchHit>(); // by canonical url
  byId = new Map<string, SearchHit>();
  sources = new Map<string, Source>(); // S1.. by id
  sourceByUrl = new Map<string, string>();
  inaccessible: Array<{ url: string; reason: string }> = [];
  queries: string[] = [];
  userUrls = new Set<string>();
  private hitCounter = 0;
  private sourceCounter = 0;

  allowUserUrls(text: string) {
    for (const match of text.matchAll(/https?:\/\/[^\s)<>"']+/gi)) this.userUrls.add(canonicalUrl(match[0].replace(/[.,;:!?]+$/, "")));
  }
  /** A URL may be fetched only if the person typed it, a search returned it, or an opened page linked to it. */
  isAuthorised(url: string) {
    const key = canonicalUrl(url);
    return this.userUrls.has(key) || this.discovered.has(key) || this.linked.has(key);
  }
  linked = new Set<string>();
  nextHitId() { this.hitCounter += 1; return `r${this.hitCounter}`; }
  nextSourceId() { this.sourceCounter += 1; return `S${this.sourceCounter}`; }
  summary() {
    return {
      discovered: this.discovered.size,
      opened: this.sources.size,
      inaccessible: this.inaccessible.length,
      queries: this.queries,
      sources: [...this.sources.values()].map((s) => ({ id: s.id, url: s.finalUrl, title: s.title, host: s.host, fetchedAt: s.fetchedAt, publishedAt: s.publishedAt })),
    };
  }
}

/** Reciprocal Rank Fusion: providers' scores are not comparable, their rankings are. */
export function fuseRankings(rankings: Array<{ provider: string; hits: RawHit[] }>, k = 60): Array<RawHit & { providers: string[]; score: number }> {
  const merged = new Map<string, RawHit & { providers: string[]; score: number }>();
  for (const { provider, hits } of rankings) {
    hits.forEach((hit, index) => {
      const key = canonicalUrl(hit.url);
      const entry = merged.get(key) ?? { ...hit, url: hit.url, providers: [], score: 0 };
      entry.score += 1 / (k + index + 1);
      if (!entry.providers.includes(provider)) entry.providers.push(provider);
      if (!entry.snippet && hit.snippet) entry.snippet = hit.snippet;
      if (!entry.publishedAt && hit.publishedAt) entry.publishedAt = hit.publishedAt;
      merged.set(key, entry);
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score);
}

const tokenize = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 1);

export async function webSearch(ledger: EvidenceLedger, options: SearchOptions): Promise<SearchOutcome> {
  const queries = [...new Set(options.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 4);
  const category = options.category ?? "general";
  const maxResults = Math.min(Math.max(options.maxResults ?? 8, 1), 15);
  const unsupported: string[] = [];
  if (options.timeRange && !process.env.CLYRA_SEARXNG_URL) unsupported.push("time_range (only a configured SearXNG supports it; results are not date-filtered)");
  const active = PROVIDERS.filter((p) => p.configured() && healthOf(p.name).cooldownUntil <= Date.now());
  const failed: Array<{ name: string; error: string }> = [];
  const used = new Set<string>();
  const rankings: Array<{ provider: string; hits: RawHit[] }> = [];
  await Promise.all(
    queries.flatMap((query) => {
      ledger.queries.push(query);
      return active
        // Wikipedia only helps encyclopedic lookups, never news.
        .filter((p) => !(p.name === "wikipedia" && category === "news"))
        .map(async (provider) => {
          const state = healthOf(provider.name);
          const started = Date.now();
          try {
            const hits = await provider.run(query, category, options.timeRange ?? null, options.signal);
            state.ok = true; state.failures = 0; state.lastMs = Date.now() - started; state.cooldownUntil = 0;
            used.add(provider.name);
            rankings.push({ provider: provider.name, hits });
          } catch (error) {
            state.ok = false; state.failures += 1; state.lastMs = Date.now() - started;
            state.lastError = error instanceof Error ? error.message : String(error);
            state.cooldownUntil = Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** state.failures);
            failed.push({ name: provider.name, error: state.lastError });
          }
        });
    }),
  );
  const allowed = (options.allowedDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""));
  const blocked = (options.blockedDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""));
  const fused = fuseRankings(rankings).filter((hit) => {
    const host = hostOf(hit.url).toLowerCase();
    if (blocked.some((d) => host === d || host.endsWith(`.${d}`))) return false;
    return !allowed.length || allowed.some((d) => host === d || host.endsWith(`.${d}`));
  });
  // at most two results per site so one publisher cannot stand in for several independent sources
  const perHost = new Map<string, number>();
  const hits: SearchHit[] = [];
  for (const raw of fused) {
    const host = hostOf(raw.url);
    if ((perHost.get(host) ?? 0) >= 2) continue;
    perHost.set(host, (perHost.get(host) ?? 0) + 1);
    const key = canonicalUrl(raw.url);
    let hit = ledger.discovered.get(key);
    if (!hit) {
      hit = { id: ledger.nextHitId(), url: raw.url, title: raw.title, snippet: raw.snippet, host, providers: raw.providers, publishedAt: raw.publishedAt, score: raw.score };
      ledger.discovered.set(key, hit);
      ledger.byId.set(hit.id, hit);
    }
    hits.push(hit);
    if (hits.length >= maxResults) break;
  }
  return { hits, providersUsed: [...used], providersFailed: failed, unsupported };
}

export type Passage = { index: number; heading: string; text: string; start: number; end: number };
export type Source = {
  id: string;
  requestedUrl: string;
  finalUrl: string;
  host: string;
  title: string;
  status: number;
  contentType: string;
  fetchedAt: string;
  publishedAt?: string;
  method: "html" | "text" | "pdf";
  text: string;
  passages: Passage[];
  links: Array<{ url: string; text: string }>;
  truncated: boolean;
  hash: string;
};

const MAX_BYTES = 3_000_000;
const MAX_TEXT = 90_000;
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "svg", "iframe", "form", "button", "nav", "footer", "aside"]);

function metaContent(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const a = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"));
    const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${name}["']`, "i"));
    const found = (a ?? b)?.[1];
    if (found) return decodeEntities(found);
  }
  return undefined;
}

export function extractReadable(html: string, baseUrl: string) {
  const title = decodeEntities(metaContent(html, ["og:title", "twitter:title"]) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const publishedAt = metaContent(html, ["article:published_time", "datePublished", "og:published_time", "date", "pubdate"]) ?? html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1];
  const links: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      const key = canonicalUrl(url.toString());
      const text = plain(match[2]);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      links.push({ url: url.toString(), text: text.slice(0, 140) });
      if (links.length >= 80) break;
    } catch { /* not a link we can use */ }
  }
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");
  const article = stripped.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? stripped.match(/<main\b[\s\S]*?<\/main>/i)?.[0];
  const body = stripped.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? stripped;
  const region = article && plain(article).length > 600 ? article : body;
  const text = turndown.turndown(region).replace(/\n{3,}/g, "\n\n").trim();
  return { title, publishedAt, links, text };
}

export function splitPassages(text: string): Passage[] {
  const passages: Passage[] = [];
  let heading = "";
  let offset = 0;
  for (const block of text.split(/\n{2,}/)) {
    const start = text.indexOf(block, offset);
    offset = start + block.length;
    const trimmed = block.trim();
    if (!trimmed) continue;
    const h = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (h) { heading = h[1].trim(); continue; }
    // long blocks are cut at sentence ends so a passage stays quotable
    const parts = trimmed.length > 900 ? trimmed.match(/[\s\S]{1,800}(?:[.!?]\s|$)/g) ?? [trimmed] : [trimmed];
    let cursor = start;
    for (const part of parts) {
      const clean = part.trim();
      if (clean.length < 20) { cursor += part.length; continue; }
      passages.push({ index: passages.length, heading, text: clean, start: cursor, end: cursor + part.length });
      cursor += part.length;
    }
  }
  return passages;
}

/** BM25 over a document's passages: which paragraphs actually answer the question. */
export function rankPassages(passages: Passage[], query: string, limit = 5): Array<Passage & { score: number }> {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !passages.length) return [];
  const docs = passages.map((p) => tokenize(`${p.heading} ${p.text}`));
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const term of terms) df.set(term, docs.filter((d) => d.includes(term)).length);
  const k1 = 1.4, b = 0.75;
  return passages
    .map((p, i) => {
      let score = 0;
      for (const term of terms) {
        const tf = docs[i].filter((t) => t === term).length;
        if (!tf) continue;
        const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * docs[i].length) / avg)));
      }
      if (query.length > 6 && p.text.toLowerCase().includes(query.toLowerCase())) score += 3;
      return { ...p, score };
    })
    .filter((p) => p.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}

function pdfToText(buffer: Buffer): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile("pdftotext", ["-layout", "-", "-"], { maxBuffer: 20_000_000, timeout: 20_000, encoding: "utf8" }, (error, stdout) => resolve(error ? null : stdout));
    child.stdin?.on("error", () => resolve(null));
    child.stdin?.end(buffer);
  });
}

export type OpenResult = { ok: true; source: Source; reused: boolean } | { ok: false; error: string; url: string };

export async function openPage(ledger: EvidenceLedger, url: string, signal?: AbortSignal): Promise<OpenResult> {
  if (!/^https?:\/\//i.test(url)) return { ok: false, url, error: "Only http(s) addresses can be opened." };
  if (!ledger.isAuthorised(url)) {
    return { ok: false, url, error: "That address did not come from the person, a search result or an opened page, so it was not fetched." };
  }
  const key = canonicalUrl(url);
  const existing = ledger.sourceByUrl.get(key);
  if (existing) return { ok: true, source: ledger.sources.get(existing)!, reused: true };
  try {
    const response = await safeFetchUserUrl(url, { timeoutMs: 15_000, headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5" } });
    if (signal?.aborted) return { ok: false, url, error: "Cancelled." };
    if (!response.ok) {
      ledger.inaccessible.push({ url, reason: `HTTP ${response.status}` });
      return { ok: false, url, error: `The site answered HTTP ${response.status}.` };
    }
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer()).subarray(0, MAX_BYTES);
    let title = "", publishedAt: string | undefined, text = "", links: Array<{ url: string; text: string }> = [], method: Source["method"] = "html";
    if (contentType === "application/pdf" || /^%PDF-/.test(buffer.subarray(0, 5).toString("latin1"))) {
      method = "pdf";
      const extracted = await pdfToText(buffer);
      if (!extracted?.trim()) {
        ledger.inaccessible.push({ url, reason: "PDF text could not be extracted" });
        return { ok: false, url, error: "This PDF's text could not be extracted (pdftotext is unavailable or the file is scanned)." };
      }
      text = extracted.replace(/\f/g, "\n\n").replace(/[ \t]+\n/g, "\n");
      title = text.split("\n").find((l) => l.trim().length > 3)?.trim().slice(0, 140) ?? hostOf(url);
    } else if (/html|xml/.test(contentType) || !contentType) {
      const html = buffer.toString("utf8");
      if (/enable javascript|just a moment|access denied|captcha/i.test(html.slice(0, 1500)) && html.length < 6000) {
        ledger.inaccessible.push({ url, reason: "blocked or needs JavaScript" });
        return { ok: false, url, error: "The site blocked automated reading or needs a full browser." };
      }
      ({ title, publishedAt, links, text } = extractReadable(html, response.url || url));
    } else if (/^text\/|json/.test(contentType)) {
      method = "text";
      text = buffer.toString("utf8");
      title = hostOf(url);
    } else {
      ledger.inaccessible.push({ url, reason: `unsupported type ${contentType}` });
      return { ok: false, url, error: `Unsupported content type: ${contentType}.` };
    }
    const truncated = text.length > MAX_TEXT;
    text = text.slice(0, MAX_TEXT);
    if (text.trim().length < 80) {
      ledger.inaccessible.push({ url, reason: "no readable text" });
      return { ok: false, url, error: "The page had no readable text." };
    }
    const finalUrl = response.url || url;
    const { createHash } = await import("node:crypto");
    const source: Source = {
      id: ledger.nextSourceId(), requestedUrl: url, finalUrl, host: hostOf(finalUrl), title: title || hostOf(finalUrl),
      status: response.status, contentType, fetchedAt: new Date().toISOString(), publishedAt, method, text, passages: splitPassages(text),
      links, truncated, hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
    };
    ledger.sources.set(source.id, source);
    ledger.sourceByUrl.set(key, source.id);
    ledger.sourceByUrl.set(canonicalUrl(finalUrl), source.id);
    for (const link of links) ledger.linked.add(canonicalUrl(link.url));
    return { ok: true, source, reused: false };
  } catch (error) {
    const reason = error instanceof UnsafeUrlError ? error.message : error instanceof Error ? error.message : "fetch failed";
    ledger.inaccessible.push({ url, reason });
    return { ok: false, url, error: reason };
  }
}

export function findInSource(ledger: EvidenceLedger, sourceId: string, patterns: string[], semanticQuery?: string, limit = 5) {
  const source = ledger.sources.get(sourceId);
  if (!source) return { ok: false as const, error: `No opened source ${sourceId}. Open the page first.` };
  const matches: Array<{ passage: Passage; why: string; score: number }> = [];
  for (const pattern of patterns.slice(0, 6)) {
    const needle = pattern.trim().toLowerCase();
    if (!needle) continue;
    for (const passage of source.passages) {
      if (`${passage.heading} ${passage.text}`.toLowerCase().includes(needle)) matches.push({ passage, why: `contains “${pattern}”`, score: 10 });
    }
  }
  if (semanticQuery?.trim()) for (const ranked of rankPassages(source.passages, semanticQuery, limit)) matches.push({ passage: ranked, why: "relevant to the question", score: ranked.score });
  const unique = new Map<number, { passage: Passage; why: string; score: number }>();
  for (const m of matches) { const prior = unique.get(m.passage.index); if (!prior || m.score > prior.score) unique.set(m.passage.index, m); }
  const results = [...unique.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return {
    ok: true as const,
    source: { id: source.id, title: source.title, url: source.finalUrl },
    matches: results.map((m) => ({ passage: m.passage.index, heading: m.passage.heading, text: m.passage.text.slice(0, 900), why: m.why })),
  };
}

/**
 * Citations the answer uses must name a page that was actually read. Unknown [S#] markers are removed and reported;
 * the list returned is exactly the sources the final text cites.
 */
export function validateCitations(text: string, ledger: EvidenceLedger) {
  const cited: string[] = [];
  const invalid: string[] = [];
  const cleaned = text.replace(/\s?\[S(\d+)\]/g, (marker, n: string) => {
    const id = `S${n}`;
    if (ledger.sources.has(id)) { if (!cited.includes(id)) cited.push(id); return marker; }
    invalid.push(id);
    return "";
  });
  return { text: cleaned, cited, invalid };
}

export function sourcesCited(ledger: EvidenceLedger, ids: string[]) {
  return ids.map((id) => ledger.sources.get(id)).filter((s): s is Source => Boolean(s)).map((s) => ({ id: s.id, url: s.finalUrl, host: s.host, title: s.title, retrievedAt: s.fetchedAt }));
}
