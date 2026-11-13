/* The reading proxy behind the Notes browser panel.

   A page cannot be shown in an iframe if it sends X-Frame-Options or a
   frame-ancestors policy, which is most of the web. Fetching the page here
   and relaying it without those headers is the only way an in-app browser can
   show anything at all.

   That makes this endpoint a URL fetcher driven by the page, so it is fenced:
   http/https only, no credentials forwarded, private and loopback address
   ranges refused so it cannot be pointed at the machine's own services or the
   local network, a response ceiling, and a timeout. Scripts are stripped from
   the relayed HTML — the panel is for reading a page, not for running one
   inside the workspace origin. */
import type express from "express";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36 ClyraNotes/1.0";

/** RFC1918, loopback, link-local, CGNAT and unique-local ranges. */
function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    if (value === "::1" || value === "::") return true;
    if (value.startsWith("fe80") || value.startsWith("fc") || value.startsWith("fd")) return true;
    /* ::ffff:10.0.0.1 and friends are v4 wearing a v6 hat. */
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return false;
  }
  return false;
}

/** Resolves the host and refuses anything that is not a public address. */
async function assertPublicHost(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (isPrivateAddress(bare)) throw new Error("That address is on the local network.");
    return;
  }
  if (/^localhost$/i.test(bare) || bare.endsWith(".localhost") || bare.endsWith(".internal")) {
    throw new Error("That address is on this machine.");
  }
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(bare, { all: true });
  } catch {
    throw new Error(`Could not find ${bare}.`);
  }
  if (!records.length) throw new Error(`Could not find ${bare}.`);
  if (records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("That address resolves to the local network.");
  }
}

function normalizeUrl(raw: string): URL {
  const trimmed = String(raw || "").trim();
  if (!trimmed) throw new Error("No address given.");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That is not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses can be opened here.");
  }
  return url;
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Every link is rewritten to come back through this endpoint, so following
   one stays inside the panel and inside its history, and the panel can read
   where it ended up from the frame's own location.

   Script removal here is belt; the response's `script-src 'none'` policy is
   braces. The policy is what actually guarantees nothing executes — a regex
   over HTML never can — but stripping first means no broken script tags are
   left lying in the markup. */
function prepareHtml(html: string, finalUrl: string, selfOrigin: string): string {
  const base = new URL(finalUrl);

  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<(iframe|object|embed|frame|frameset)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?(?:content-security-policy|refresh)["']?[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    /* A protocol-relative asset inherits the *document's* scheme, and this
       document is served over http from localhost — which would downgrade
       every stylesheet and image to http and trip the policy below. The
       injected <base> only fixes path-relative URLs, so "//host/…" is
       pinned to https by hand. */
    .replace(/(\s(?:src|href|srcset|data-src)\s*=\s*["'])\/\//gi, "$1https://")
    .replace(/(url\(\s*["']?)\/\//gi, "$1https://");

  /* Anchors are rewritten rather than intercepted: with scripts disabled
     there is nothing to intercept with, and a rewritten href survives
     whatever the page does to its own DOM. */
  out = out.replace(/<a\b([^>]*?)\shref\s*=\s*(["'])(.*?)\2([^>]*)>/gi, (match, before, quote, href, after) => {
    const raw = String(href).trim();
    if (!raw || raw.startsWith("#")) return match;
    if (/^(javascript|data|vbscript|blob):/i.test(raw)) return `<a${before}${after}>`;
    let absolute: string;
    try { absolute = new URL(raw, base).href; } catch { return `<a${before}${after}>`; }
    if (!/^https?:$/i.test(new URL(absolute).protocol)) return `<a${before}${after}>`;
    const cleanBefore = String(before).replace(/\starget\s*=\s*(["']).*?\1/gi, "");
    const cleanAfter = String(after).replace(/\starget\s*=\s*(["']).*?\1/gi, "");
    /* Absolute against the workspace, not the page: the injected <base>
       points at the site being read, so a root-relative proxy link would
       resolve to that site instead of back to us. */
    return `<a${cleanBefore} href="${escapeAttribute(`${selfOrigin}${proxyPath(absolute)}`)}"${cleanAfter}>`;
  });

  const injected =
    `<base href="${escapeAttribute(base.href)}">` +
    `<style>html{-webkit-text-size-adjust:100%}</style>`;

  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
  else out = `${injected}${out}`;
  return out;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
/* What the reading frame shows when a site cannot be fetched. */
function failurePage(url: string, title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#2c2c2b;--muted:#73726c;--line:rgba(55,53,47,.12)}
@media (prefers-color-scheme:dark){:root{--bg:#191a1c;--fg:#ececea;--muted:#9b9a96;--line:rgba(255,255,255,.1)}}
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{max-width:380px;padding:28px;text-align:center}h1{font-size:17px;font-weight:650;margin:0 0 6px}p{margin:0 0 16px;color:var(--muted)}
code{display:block;margin:0 0 18px;font:12px ui-monospace,Menlo,monospace;color:var(--muted);word-break:break-all}
a{display:inline-block;padding:7px 16px;border-radius:999px;border:1px solid var(--line);color:var(--fg);font-weight:600;text-decoration:none}a:hover{background:var(--line)}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p><code>${escapeHtml(url)}</code><a href="${escapeHtml(proxyPath(url))}">Try again</a></main>
<script>addEventListener("online",()=>location.reload())</script></body></html>`;
}

function sendFailurePage(res: express.Response, status: number, url: string, title: string, detail: string): void {
  res.status(status).type("text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'");
  res.send(failurePage(url, title, detail));
}

const proxyPath = (url: string) => `/api/notes/browse?url=${encodeURIComponent(url)}`;

export function registerNotesBrowseRoutes(app: express.Application): void {
  app.get("/api/notes/browse", async (req, res) => {
    let url: URL;
    try {
      url = normalizeUrl(String(req.query.url ?? ""));
      await assertPublicHost(url.hostname);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bad address";
      if (req.accepts(["html", "json"]) === "html") {
        sendFailurePage(res, 400, String(req.query.url ?? ""), /^Could not find/.test(message) ? "Can't find this site" : "This address can't be opened", /^Could not find/.test(message)
          ? "Check the address for a typo, or your internet connection. The page will load by itself when you're back online."
          : message);
        return;
      }
      res.status(400).json({ error: message });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let current = url;
      let response: Response | null = null;
      /* Redirects are followed by hand so every hop is checked against the
         private-address rule, not just the address that was typed. */
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        response = await fetch(current.href, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "accept-language": "en-GB,en;q=0.9",
          },
        });
        const location = response.headers.get("location");
        if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
        current = new URL(location, current);
        if (current.protocol !== "http:" && current.protocol !== "https:") {
          throw new Error("That site redirected somewhere this panel cannot open.");
        }
        await assertPublicHost(current.hostname);
        response = null;
      }
      if (!response) throw new Error("That site redirected too many times.");

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_BYTES) throw new Error("That page is too large to open here.");

      res.status(response.status);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      /* The panel frames this response with a sandbox and no
         allow-same-origin, which gives the frame an opaque origin — and an
         opaque origin is not "same origin", so the app-wide
         X-Frame-Options: SAMEORIGIN would block our own panel. It is
         replaced with a frame-ancestors policy, which is evaluated against
         the real ancestor origin and still lets nobody else embed this. */
      /* The frame is same-origin so that the panel can read where a click
         took it, which means the page's own code must be unable to run. A
         sandbox cannot provide that here — an opaque origin is not "same
         origin", so the app's X-Frame-Options would block our own panel — so
         the guarantee is a policy the browser enforces instead: no scripts,
         no plugins, no nested frames, no form posts, and no way to move the
         document base out from under the rewritten links. */
      /* base-uri names the site being read rather than 'none': the injected
         <base> is what makes the page's own relative assets resolve, and
         with script-src 'none' nothing can replace it at runtime. */
      const origin = new URL(response.url || current.href).origin;
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self' https: data: blob:",
          "img-src https: data: blob:",
          "style-src 'unsafe-inline' https: data:",
          "font-src https: data:",
          "script-src 'none'",
          "object-src 'none'",
          "frame-src 'none'",
          "form-action 'none'",
          `base-uri ${origin}`,
          "frame-ancestors 'self'",
        ].join("; "),
      );
      /* Whatever the origin said about framing is deliberately not relayed;
         nothing else from its header set is either. */
      if (/text\/html/i.test(contentType)) {
        const selfOrigin = `${req.protocol}://${req.get("host") ?? "localhost"}`;
        res.type("text/html; charset=utf-8");
        res.send(prepareHtml(buffer.toString("utf8"), response.url || current.href, selfOrigin));
        return;
      }
      res.type(contentType);
      res.send(buffer);
    } catch (error) {
      const message = error instanceof Error
        ? (error.name === "AbortError" ? "That site took too long to answer." : error.message)
        : "Could not open that page";
      /* A frame asking for a page gets a page back: raw JSON in a reading
         frame is a blank-looking screen with no way forward. */
      if (req.accepts(["html", "json"]) === "html") {
        const code = (error as { cause?: { code?: string } })?.cause?.code || "";
        const offline = ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN"].includes(code);
        sendFailurePage(res, 502, url.href, offline ? "Can't reach this page" : "This page didn't open", offline
          ? "Check your internet connection. The page will load by itself when you're back online."
          : message);
        return;
      }
      res.status(502).json({ error: message });
    } finally {
      clearTimeout(timer);
    }
  });
}
