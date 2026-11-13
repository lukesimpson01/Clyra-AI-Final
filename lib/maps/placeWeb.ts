/** Opening hours and ratings found on the open web, for places the map data does not describe.
 *
 * Every figure here is read from a page that actually says it, next to the place's own name, and is returned with
 * the page it came from. Nothing is averaged across sites or filled in: a page that does not clearly state a
 * rating or a week of hours contributes nothing. Order of trust for hours: the place's own site (structured
 * schema.org data first, then its text), then other pages. */
import { weeklyHours } from "./openingHours";

export interface WebPage { url: string; text: string; /** raw HTML, when we fetched the page ourselves (carries schema.org data) */ html?: string }
export interface WebRating { source: string; value: number; count?: number; url: string; via?: string }
export interface WebHours { weekly: Array<{ day: string; text: string }>; source: string; url: string }

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_RE = "(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\\.?";
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** "Bondi Icebergs Club" and "Bondi Icebergs" are the same place on most sites: compare without the generic suffix. */
const core = (name: string) => name.replace(/\b(club|cafe|café|restaurant|bar|pub|hotel|bistro|the|and|&)\b/gi, " ").replace(/\s+/g, " ").trim() || name;
const dayIndex = (s: string) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(s.slice(0, 3).toLowerCase());

function clean(text: string): string {
  return text
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;|–|—|‒/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/[\t ]+/g, " ");
}

function fmtTime(h: number, m: number): string {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 || h === 24 ? "am" : "pm"}`;
}

/** "11am - 10pm", "7:00am - 3:30pm", "07:00-15:30", "closed" → display text, or null. */
function parseTimes(raw: string): string | null {
  const t = raw.trim();
  if (/^(closed|off)\b/i.test(t)) return "Closed";
  if (/^(open\s*)?24\s*(hours|hrs|h)\b/i.test(t)) return "Open 24 hours";
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h1 = Number(m[1]); const m1 = Number(m[2] ?? 0);
  let h2 = Number(m[4]); const m2 = Number(m[5] ?? 0);
  const a1 = m[3]?.toLowerCase(); const a2 = (m[6] ?? m[3])?.toLowerCase();
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  if (a2) {
    if (a2 === "pm" && h2 < 12) h2 += 12;
    if (a2 === "am" && h2 === 12) h2 = 0;
    const startSuffix = a1 ?? a2;
    if (startSuffix === "pm" && h1 < 12) h1 += 12;
    if (startSuffix === "am" && h1 === 12) h1 = 0;
    if (!a1 && h1 > h2 && h1 >= 12) h1 -= 12; // "11 - 10pm" style: the start inherits am
  } else if (!(m[2] || m[5])) {
    return null; // bare "9-5" is too ambiguous to trust
  }
  return `${fmtTime(h1, m1)} – ${fmtTime(h2, m2)}`;
}

/** Reads a week of hours out of plain text: "Mon-Fri: 7:00am - 3:30pm", "Monday: 11:00 AM - 10:00 PM", … */
export function parseHoursText(input: string): Array<{ day: string; text: string }> | null {
  const text = clean(input);
  const week: Array<string | undefined> = Array(7).fill(undefined);
  const time = "(?:closed|off|open\\s*24\\s*(?:hours|hrs)|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(?:-|to|until)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)";
  const rule = new RegExp(`\\b(${DAY_RE}(?:\\s*(?:-|to|through)\\s*${DAY_RE})?(?:\\s*(?:,|&|and)\\s*${DAY_RE})*)\\s*[:\\-]?\\s*(${time})`, "gi");
  for (const m of text.matchAll(rule)) {
    const days = new Set<number>();
    const spec = m[1];
    const range = spec.match(new RegExp(`${DAY_RE}\\s*(?:-|to|through)\\s*${DAY_RE}`, "i"));
    if (range) {
      const a = dayIndex(range[1]); const b = dayIndex(range[2]);
      if (a < 0 || b < 0) continue;
      for (let d = a; ; d = (d + 1) % 7) { days.add(d); if (d === b) break; }
      spec.replace(range[0], "").match(new RegExp(DAY_RE, "gi"))?.forEach((x) => days.add(dayIndex(x)));
    } else spec.match(new RegExp(DAY_RE, "gi"))?.forEach((x) => days.add(dayIndex(x)));
    const times = parseTimes(m[m.length - 1].replace(/^[:\-\s]+/, ""));
    if (!times) continue;
    for (const d of days) if (d >= 0 && week[d] === undefined) week[d] = times; // the first statement for a day wins ("Kitchen" lines come later)
  }
  const known = week.filter(Boolean).length;
  if (known < 3) return null;
  return DAYS.map((day, i) => ({ day, text: week[i] ?? "Not listed" }));
}

/** schema.org on the place's own page: openingHoursSpecification or the compact openingHours strings. */
export function hoursFromJsonLd(html: string): Array<{ day: string; text: string }> | null {
  const week: Array<string | undefined> = Array(7).fill(undefined);
  const visit = (v: any) => {
    if (!v) return;
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v !== "object") return;
    const specs = v.openingHoursSpecification;
    if (specs) {
      for (const s of ([] as any[]).concat(specs)) {
        const days = ([] as any[]).concat(s.dayOfWeek ?? []).map((d: string) => dayIndex(String(d).replace(/^.*\//, "")));
        const open = String(s.opens ?? ""); const close = String(s.closes ?? "");
        const t = open && close ? parseTimes(`${open.slice(0, 5)}-${close.slice(0, 5)}`) : null;
        for (const d of days) if (d >= 0 && t && week[d] === undefined) week[d] = t;
      }
    }
    if (v.openingHours) {
      const raw = ([] as string[]).concat(v.openingHours).join("; ");
      const parsed = weeklyHours(raw.replace(/,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su))/g, "; "));
      parsed?.forEach((d, i) => { if (week[i] === undefined && d.text !== "Closed") week[i] = d.text; });
    }
    for (const x of Object.values(v)) if (x && typeof x === "object") visit(x);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1])); } catch { /* malformed JSON-LD */ }
  }
  if (week.filter(Boolean).length < 2) return null;
  return DAYS.map((day, i) => ({ day, text: week[i] ?? "Closed" }));
}

/** The first rating stated within a short stretch after the place's name. Returns null when the name isn't there. */
export function ratingNear(text: string, fullName: string): { value: number; count?: number; via?: string } | null {
  const name = core(fullName);
  const target = norm(name);
  if (!target) return null;
  const lower = clean(text);
  const flat = norm(lower);
  if (!flat.includes(target)) return null;
  // scan windows that start at each mention of the name in the original text
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = name.trim().split(/\s+/).slice(0, 2).map(esc).join("\\s+");
  // a page that is about this one place (its name is in the title) states its rating anywhere; a list page only beside the name
  const aboutThisPlace = norm(lower.slice(0, 400)).includes(target);
  const windows: string[] = aboutThisPlace ? [lower.slice(0, 8000)] : [...lower.matchAll(new RegExp(first, "gi"))].map((at) => lower.slice(at.index!, at.index! + 700));
  for (const win of windows) {
    let m = win.match(/\b([1-5]\.\d)\s*(?:out of 5|\/\s*5)\s*(?:stars?\s*)?(?:from|by|based on|\()?\s*([\d,]{1,7})?\s*(?:reviews?|ratings?|visitors?|votes?)?/i);
    if (m) return { value: Number(m[1]), count: m[2] ? Number(m[2].replace(/,/g, "")) : undefined };
    m = win.match(/\b([1-5]\.\d)\s*\(\s*([\d,]{2,7})\s*\)\s*(?:[·•|-]\s*)?(Google|Facebook|TripAdvisor|Yelp)?/i);
    if (m) return { value: Number(m[1]), count: Number(m[2].replace(/,/g, "")), via: m[3] };
    m = win.match(/(?:rated|rating|score)\D{0,16}([1-5](?:\.\d)?)\s*(?:\/\s*5|out of 5|stars?)/i);
    if (m) return { value: Number(m[1]) };
  }
  return null;
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

export function extractFromPages(pages: WebPage[], name: string, ownSite?: string): { hours?: WebHours; ratings: WebRating[] } {
  const own = ownSite ? hostOf(ownSite) : "";
  let hours: WebHours | undefined;
  const ratings: WebRating[] = [];
  const ordered = [...pages].sort((a, b) => Number(hostOf(b.url) === own) - Number(hostOf(a.url) === own));
  for (const page of ordered) {
    const host = hostOf(page.url);
    const named = norm(clean(page.text)).includes(norm(core(name)));
    if (!hours) {
      const structured = host === own ? hoursFromJsonLd(page.html ?? page.text) : null;
      const textual = host === own || named ? parseHoursText(host === own ? page.text : windowAround(page.text, name, 2500)) : null;
      const weekly = structured ?? textual;
      if (weekly) hours = { weekly, source: host === own ? "Official site" : host, url: page.url };
    }
    if (named && host !== own) {
      const r = ratingNear(page.text, name);
      if (r && (r.count === undefined || r.count >= 10) && !ratings.some((x) => x.source === (r.via ?? host))) ratings.push({ source: r.via ? `${r.via} (via ${host})` : host, value: r.value, count: r.count, url: page.url });
    }
  }
  return { hours, ratings: ratings.slice(0, 3) };
}

function windowAround(text: string, name: string, size: number): string {
  const i = clean(text).toLowerCase().indexOf(name.trim().toLowerCase().split(/\s+/).slice(0, 2).join(" "));
  const t = clean(text);
  return i < 0 ? t.slice(0, size) : t.slice(Math.max(0, i - 200), i + size);
}


const UA = "ClyraMaps/1.0 (+place details)";

async function getHtml(url: string): Promise<{ url: string; html: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: controller.signal });
    if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) return null;
    return { url: res.url || url, html: (await res.text()).slice(0, 500_000) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h\d|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/[\t ]+/g, " ");
}

/** The place's own website: the home page plus up to two of its contact/hours pages, read as raw HTML. */
export async function ownSitePages(website: string | undefined): Promise<WebPage[]> {
  if (!website || !/^https?:\/\//i.test(website)) return [];
  const home = await getHtml(website);
  if (!home) return [];
  const pages: WebPage[] = [{ url: home.url, html: home.html, text: htmlToText(home.html) }];
  const links = new Set<string>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    if (!/(contact|opening|hours|visit|location|find-?us|trading)/i.test(m[1])) continue;
    try { const u = new URL(m[1], home.url); if (u.hostname === new URL(home.url).hostname && u.href !== home.url) links.add(u.href); } catch { /* skip */ }
    if (links.size >= 2) break;
  }
  for (const next of await Promise.all([...links].map(getHtml))) if (next) pages.push({ url: next.url, html: next.html, text: htmlToText(next.html) });
  return pages;
}

export interface WebLookupInput { name: string; locality?: string; website?: string }

/** Hours and ratings for a place from its own site and from what the open web says about it. */
export async function lookupWeb(input: WebLookupInput, search: (query: string) => Promise<WebPage[]>): Promise<{ hours?: WebHours; ratings: WebRating[] }> {
  const [own, found] = await Promise.all([
    ownSitePages(input.website),
    Promise.all([
      search(`${input.name} ${input.locality ?? ""} reviews rating`),
      search(`${input.name} ${input.locality ?? ""} opening hours Google reviews`),
    ]).then((lists) => lists.flat()).catch(() => [] as WebPage[]),
  ]);
  const seen = new Set<string>();
  const unique = found.filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)));
  return extractFromPages([...own, ...unique], input.name, input.website);
}
