import type { SourceScreenshot } from "../../../lib/clyra-code/library/registry";

/**
 * Collect real upstream screenshots cited by a repository's README.
 * This never fabricates a screen: missing or blocked sources remain missing.
 * The GitHub REST README endpoint supplies the correct default-branch URL,
 * so relative assets resolve against the real source documentation.
 */
const cache = new Map<string, Promise<SourceScreenshot[]>>();
const imageFile = /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i;
const exclude = /badge|shield|build.status|coverage|sponsor|twitter|discord|license|logo|icon|button|download|npm|stars|workflow|banner|hero.banner/i;

function score(shot: SourceScreenshot): number {
  const name = (shot.alt + " " + shot.url).toLowerCase();
  let total = 0;
  if (/welcome|home.?screen|home.?page|new.chat|new.conversation|composer|getting.started/.test(name)) total += 120;
  if (/main.interface|overview|dashboard|workspace|screenshot|editor|preview/.test(name)) total += 70;
  if (/conversation|chat|code|terminal|timeline|canvas|workflow/.test(name)) total += 45;
  if (/settings|mobile|preferences|installation/.test(name)) total -= 20;
  if (/\.gif(?:[?#]|$)/.test(name)) total -= 10;
  return total;
}

export function discoverOfficialScreenshots(repositoryUrl: string): Promise<SourceScreenshot[]> {
  const repo = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repositoryUrl);
  if (!repo) return Promise.resolve([]);
  const key = repo[1] + "/" + repo[2];
  const cached = cache.get(key);
  if (cached) return cached;
  const result = (async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      let response: Response;
      try {
        response = await fetch("https://api.github.com/repos/" + key + "/readme", {
          signal: controller.signal,
          headers: { Accept: "application/vnd.github+json" },
        });
      } finally { window.clearTimeout(timeout); }
      if (!response.ok) return [];
      const readme = await response.json() as { content?: string; download_url?: string; encoding?: string };
      if (readme.encoding !== "base64" || !readme.content || !readme.download_url) return [];
      const markdown = new TextDecoder().decode(Uint8Array.from(atob(readme.content.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
      const candidates: Array<{ alt: string; src: string; order: number }> = [];
      // Markdown image tags and linked preview thumbnails.
      for (const match of markdown.matchAll(/!\[([^\]]*)\]\((<?[^\s)]+>)(?:\s+["'][^"']*["'])?\)/g)) {
        candidates.push({ alt: match[1], src: match[2].replace(/^<|>$/g, ""), order: match.index ?? 0 });
      }
      // HTML img tags, often used for user-attachment screenshots in READMEs.
      for (const match of markdown.matchAll(/<img\b[^>]*>/gi)) {
        const tag = match[0];
        const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
        if (!src) continue;
        const alt = /\balt\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "";
        candidates.push({ alt, src, order: match.index ?? 0 });
      }
      const seen = new Set<string>();
      return candidates.map(({ alt, src, order }) => {
        let url = "";
        try { url = new URL(src.replace(/&amp;/g, "&"), readme.download_url).href; } catch { /* skip */ }
        return { url, alt: alt || "Upstream interface screenshot", capturedAt: "", provenance: "Upstream README: " + repositoryUrl + " (not a Clyra runtime capture)", order };
      }).filter((shot) => {
        if (!shot.url.startsWith("https://")) return false;
        if (!/^(?:raw\.githubusercontent\.com|github\.com|user-images\.githubusercontent\.com|github\.githubassets\.com|[a-z0-9.-]+)$/i.test(new URL(shot.url).hostname)) return false;
        if (!imageFile.test(shot.url) && !/github\.com\/user-attachments\/assets\//.test(shot.url)) return false;
        if (exclude.test(shot.alt + " " + shot.url)) return false;
        if (seen.has(shot.url)) return false;
        seen.add(shot.url);
        return true;
      }).sort((a, b) => score(b) - score(a) || a.order - b.order).slice(0, 12).map(({ order: _order, ...shot }) => shot);
    } catch { return []; }
  })();
  cache.set(key, result);
  return result;
}
