/**
 * SSRF-resistant fetch for user-supplied URLs (Study Pal source import, and
 * anywhere else Clyra fetches an address a user typed in).
 *
 * A hostname allowlist/blocklist alone is not enough: an attacker-controlled
 * DNS name can resolve to a private/loopback address (DNS rebinding), and a
 * remote server can redirect to one after the first check passes. This
 * resolves and validates the actual IP before every hop, not just the
 * original hostname string.
 */
import dns from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {}

function isPrivateOrReservedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped IPv6 — validate the embedded IPv4 address too.
      const mapped = lower.replace("::ffff:", "");
      if (net.isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }
  return true; // not a parseable IP — treat as unsafe rather than guess
}

async function assertHostResolvesToPublicIp(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new UnsafeUrlError("Private or reserved network addresses cannot be imported as sources.");
    }
    return;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (records.length === 0) {
    throw new UnsafeUrlError("The source hostname did not resolve to any address.");
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new UnsafeUrlError("This source resolves to a private or reserved network address.");
    }
  }
}

const OBVIOUS_LOCAL_SUFFIXES = [".local", ".localhost", ".internal"];

/**
 * Fetch a user-supplied URL, resolving and validating the DNS-resolved IP
 * (not just the hostname string) before the request and before following
 * each redirect hop.
 */
export async function safeFetchUserUrl(
  inputUrl: string,
  init: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Response> {
  let current = new URL(inputUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!/^https?:$/.test(current.protocol)) {
      throw new UnsafeUrlError("Only HTTP and HTTPS sources are supported.");
    }
    const host = current.hostname.toLowerCase();
    if (host === "localhost" || OBVIOUS_LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      throw new UnsafeUrlError("Private network addresses cannot be imported as sources.");
    }
    await assertHostResolvesToPublicIp(host);

    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 12_000),
      headers: init.headers,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response; // redirect with no target — surface as-is
      current = new URL(location, current);
      continue;
    }
    return response;
  }
  throw new UnsafeUrlError("Too many redirects while fetching this source.");
}
