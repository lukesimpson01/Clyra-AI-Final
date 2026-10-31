import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

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
 * The sources a search really fetched, as small circular favicons beside the status line. Each new one glides in
 * from the left, staggered 125ms when several arrive together; icons already on screen never replay.
 */
export function SourceStrip({ sources }: { sources: SourceView[] }) {
  const shown = safeSources(sources);
  const seen = useRef<Set<string> | null>(null);
  // the first render's sources are already there (a reopened chat): only later arrivals animate
  if (seen.current === null) seen.current = new Set(shown.map((s) => s.id));
  const fresh = shown.filter((s) => !seen.current!.has(s.id)).map((s) => s.id);
  useEffect(() => { for (const id of fresh) seen.current!.add(id); });
  if (!shown.length) return null;
  return (
    <span className="clyra-web-favicons" aria-label={`${shown.length} search source${shown.length === 1 ? "" : "s"}`}>
      {shown.slice(0, 8).map((source) => {
        const batch = fresh.indexOf(source.id);
        return (
          <a
            key={source.id}
            className="clyra-web-favicon"
            style={batch < 0 ? { animation: "none" } : { animationDelay: `${batch * 125}ms` }}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.host.replace(/^www\./i, "")}
            aria-label={`Open ${source.title || source.host}`}
          >
            <SourceFavicon host={source.host} />
          </a>
        );
      })}
    </span>
  );
}

/**
 * "Sources" under a finished answer: a white pill with the first favicons, the count and a chevron. Opening it
 * slides the real sources out sideways as circles; hovering or focusing one names the site, clicking opens its page.
 */
export function SourcesInline({ sources }: { sources: SourceView[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const list = safeSources(sources);
  const hosts = new Set<string>();
  const stack = list.filter((s) => {
    const host = s.host.replace(/^www\./i, "");
    if (hosts.has(host)) return false;
    hosts.add(host);
    return true;
  }).slice(0, 3);
  if (!list.length) return null;
  return (
    <section className={`clyra-sources-inline${open ? " is-open" : ""}`} aria-label="Referenced sources">
      <button
        type="button"
        className="clyra-sources-inline__trigger"
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? "Hide sources" : "Show sources"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="clyra-sources-inline__logos" aria-hidden>
          {stack.map((source) => <span key={source.id} className="clyra-web-favicon" style={{ animation: "none" }}><SourceFavicon host={source.host} /></span>)}
        </span>
        <span className="clyra-sources-inline__heading">Sources</span>
        <span className="clyra-sources-inline__count">{list.length}</span>
        <ChevronRight className="clyra-sources-inline__chevron" aria-hidden />
      </button>
      <div className="clyra-sources-inline__clip" id={id} inert={!open} aria-hidden={!open}>
        <div className="clyra-sources-inline__links">
          {list.slice(0, 12).map((source, index) => {
            const host = source.host.replace(/^www\./i, "");
            return (
              <span key={source.id} className="clyra-sources-inline__slot" style={{ ["--source-index" as string]: index }}>
                <a className="clyra-sources-inline__link" href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${source.title || host}`}>
                  <span className="clyra-sources-inline__favicon" aria-hidden><SourceFavicon host={source.host} /></span>
                  <span className="clyra-sources-inline__site">{host}</span>
                </a>
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}
