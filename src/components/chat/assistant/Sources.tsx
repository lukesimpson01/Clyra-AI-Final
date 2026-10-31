import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AI_DURATION, AI_EASE } from "./motion";

export type SourceView = {
  id: string;
  url: string;
  host: string;
  title?: string;
};

/** Only real web addresses become links: anything else (javascript:, data:…) is dropped. */
export const safeSources = (sources: SourceView[]) =>
  sources.filter((source) => {
    try {
      const { protocol } = new URL(source.url);
      return protocol === "https:" || protocol === "http:";
    } catch {
      return false;
    }
  });

/** The publisher's favicon (its own colours: it is the source's, not Clyra's), else its first letter. */
export function SourceFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  const label = host.replace(/^www\./i, "");
  if (failed || !label) {
    return <span className="clyra-ai-source-favicon__fallback" aria-hidden>{(label || "?").slice(0, 1).toUpperCase()}</span>;
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${label}`)}&sz=64`}
      alt=""
      width={18}
      height={18}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The sources a search really fetched, as they arrive: each new one slides in from the right (240ms); several
 * arriving together are staggered 35ms. Keys are the sources' ids, so icons already on screen never replay.
 */
export function SourceStrip({ sources }: { sources: SourceView[] }) {
  const reduced = useReducedMotion();
  const shown = safeSources(sources);
  const seen = useRef<Set<string> | null>(null);
  // the first render's sources are already there (a reopened chat): only later arrivals animate
  if (seen.current === null) seen.current = new Set(shown.map((s) => s.id));
  const fresh = shown.filter((s) => !seen.current!.has(s.id)).map((s) => s.id);
  useEffect(() => { for (const id of fresh) seen.current!.add(id); });
  if (!shown.length) return null;
  return (
    <div className="clyra-ai-source-row" aria-label={`${shown.length} search source${shown.length === 1 ? "" : "s"}`}>
      <AnimatePresence initial={false}>
        {shown.map((source) => {
          const batch = fresh.indexOf(source.id);
          return (
            <motion.a
              key={source.id}
              layout="position"
              className="clyra-ai-source-favicon"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              title={source.host.replace(/^www\./i, "")}
              aria-label={`Open ${source.title || source.host}`}
              initial={reduced || batch < 0 ? false : { opacity: 0, x: 10, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: reduced ? 0 : AI_DURATION.source, ease: AI_EASE, delay: reduced || batch < 0 ? 0 : batch * AI_DURATION.sourceStagger }}
            >
              <SourceFavicon host={source.host} />
            </motion.a>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function readablePath(url: string) {
  try {
    const { pathname, hostname } = new URL(url);
    const path = decodeURIComponent(pathname).replace(/\/$/, "");
    return path.length > 1 ? `${hostname.replace(/^www\./i, "")}${path.length > 48 ? `${path.slice(0, 47)}…` : path}` : hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** The sources' real titles and addresses, one 46px row each. */
export function SourceList({ sources }: { sources: SourceView[] }) {
  return (
    <ul className="clyra-ai-source-list">
      {safeSources(sources).map((source) => (
        <li key={source.id}>
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="clyra-ai-source-item">
            <span className="clyra-ai-source-favicon" aria-hidden><SourceFavicon host={source.host} /></span>
            <span className="clyra-ai-source-item__meta">
              <span className="clyra-ai-source-item__title">{source.title || source.host.replace(/^www\./i, "")}</span>
              <span className="clyra-ai-source-item__host">{readablePath(source.url)}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Up to five distinct favicons, overlapping 4px, for the footer's collapsed row. */
export function SourceStack({ sources, max = 5 }: { sources: SourceView[]; max?: number }) {
  const hosts = new Set<string>();
  const shown = safeSources(sources).filter((s) => {
    const host = s.host.replace(/^www\./i, "");
    if (hosts.has(host)) return false;
    hosts.add(host);
    return true;
  }).slice(0, max);
  return (
    <span className="clyra-ai-source-stack" aria-hidden>
      {shown.map((source) => (
        <span key={source.id} className="clyra-ai-source-favicon"><SourceFavicon host={source.host} /></span>
      ))}
    </span>
  );
}
