/**
 * Real app icons for the template library.
 *
 * Each app's own icon is fetched once (its site's touch icon, then its favicon, then the
 * owner's GitHub avatar), validated as an image and stored on disk, so after the first
 * look the library shows the same crisp icons offline. Nothing is hot-linked by the UI.
 */
import type { Application } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../../runtime-paths";
import { TEMPLATE_LIBRARY } from "./registry";

/** Official site for each app, used to find its real icon. Apps without a site fall back to the GitHub avatar. */
const SITE: Record<string, string> = {
  librechat: "librechat.ai", "vercel-chatbot": "vercel.com", openhands: "openhands.dev", "bolt-diy": "bolt.new",
  "code-server": "coder.com", gitea: "gitea.com", hoppscotch: "hoppscotch.io", nocodb: "nocodb.com",
  "uptime-kuma": "uptime.kuma.pet", appflowy: "appflowy.io", plane: "plane.so", wekan: "wekan.github.io",
  onlyoffice: "onlyoffice.com", "cal-diy": "cal.com", penpot: "penpot.app", minipaint: "viliusle.github.io",
  opencut: "opencut.app", cap: "cap.so", medusa: "medusajs.com", twenty: "twenty.com", chatwoot: "chatwoot.com",
  invoiceninja: "invoiceninja.com", formbricks: "formbricks.com", stoat: "stoat.chat", pixelfed: "pixelfed.org",
  peertube: "joinpeertube.org", mastodon: "joinmastodon.org", navidrome: "navidrome.org", "saas-starter": "nextjs.org",
  astrofy: "astro.build", "medusa-dtc": "medusajs.com", ghost: "ghost.org", docusaurus: "docusaurus.io",
  activepieces: "activepieces.com", umami: "umami.is", actual: "actualbudget.org", metabase: "metabase.com",
  excalidraw: "excalidraw.com", facilmap: "facilmap.org", "photon-selfhost": "komoot.com", browseros: "browseros.com",
  karakeep: "karakeep.app", coolify: "coolify.io", appwrite: "appwrite.io", jellyfin: "jellyfin.org",
  libretranslate: "libretranslate.com", openfilm: "openfilm.dev", svgedit: "svgedit.netlify.app", kdenlive: "kdenlive.org",
  natron: "natrongithub.github.io", krita: "krita.org", perplexica: "perplexity.ai",
};

const DIRECTORY = clyraDataPath(".clyra", "library-icons-v2");
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/webp": "webp", "image/gif": "gif" };
const inFlight = new Map<string, Promise<{ file: string; type: string } | null>>();

async function fetchImage(url: string, minBytes: number): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 Clyra" } });
    if (!response.ok) return null;
    const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!EXTENSION[type]) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length >= minBytes && bytes.length < 1_500_000 ? { bytes, type } : null;
  } catch { return null; }
}

/** Width in pixels where cheap to read (PNG header); other bitmaps count as sharp, ICO as small. */
function pixelWidth(bytes: Buffer, type: string): number {
  if (type === "image/png" && bytes.length > 24) return bytes.readUInt32BE(16);
  if (type === "image/x-icon" || type === "image/vnd.microsoft.icon") return 32;
  return 256;
}

async function resolveIcon(id: string): Promise<{ file: string; type: string } | null> {
  const entry = TEMPLATE_LIBRARY.find((item) => item.id === id);
  if (!entry) return null;
  for (const [ext, type] of Object.entries(EXTENSION).map(([mime, extension]) => [extension, mime] as const)) {
    const file = path.join(DIRECTORY, `${id}.${ext}`);
    if (await fs.stat(file).then(() => true).catch(() => false)) return { file, type };
  }
  const site = SITE[id];
  const owner = entry.repositoryUrl.replace("https://github.com/", "").split("/")[0];
  const candidates: Array<[string, number]> = [];
  if (site) {
    candidates.push([`https://${site}/apple-touch-icon.png`, 1500], [`https://www.google.com/s2/favicons?domain=${site}&sz=256`, 900], [`https://icon.horse/icon/${site}`, 900]);
  }
  candidates.push([`https://github.com/${owner}.png?size=256`, 900]);
  // Prefer the sharpest candidate: vectors, then the first bitmap at least 120px wide, else the largest found.
  let best: { bytes: Buffer; type: string; score: number } | null = null;
  for (const [url, minBytes] of candidates) {
    const image = await fetchImage(url, minBytes);
    if (!image) continue;
    const score = image.type === "image/svg+xml" ? 10_000 : pixelWidth(image.bytes, image.type);
    if (!best || score > best.score) best = { ...image, score };
    if (score >= 120) break;
  }
  if (best) {
    const file = path.join(DIRECTORY, `${id}.${EXTENSION[best.type]}`);
    await fs.mkdir(DIRECTORY, { recursive: true });
    await fs.writeFile(file, best.bytes);
    return { file, type: best.type };
  }
  return null;
}

export function registerLibraryIconRoute(app: Application): void {
  app.get("/api/clyra-code/library/icon/:id", async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-z0-9-]{1,80}$/.test(id)) { res.status(400).end(); return; }
    let job = inFlight.get(id);
    if (!job) { job = resolveIcon(id).finally(() => inFlight.delete(id)); inFlight.set(id, job); }
    const icon = await job;
    if (!icon) { res.status(404).set("Cache-Control", "no-store").end(); return; }
    res.set({ "Content-Type": icon.type, "Cache-Control": "public, max-age=2592000, immutable", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    res.sendFile(icon.file);
  });
}
