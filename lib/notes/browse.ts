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

const proxyPath = (url: string) => `/api/notes/browse?url=${encodeURIComponent(url)}`;

export function registerNotesBrowseRoutes(app: express.Application): void {
  app.get("/api/notes/browse", async (req, res) => {
    let url: URL;
    try {
      url = normalizeUrl(String(req.query.url ?? ""));
      await assertPublicHost(url.hostname);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Bad address" });
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
      res.status(502).json({ error: message });
    } finally {
      clearTimeout(timer);
    }
  });
}
