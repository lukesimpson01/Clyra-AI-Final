import { useState } from "react";
import type { WebCitationView } from "../../../lib/research/research-grounding";

/**
 * The exact "Searching the web" treatment from Clyra Chat's own
 * `ChatThinkingLabel` (src/App.tsx) — a globe icon plus the shimmering
 * label, with the live query shown underneath. Reuses Chat's own CSS
 * classes (`.clyra-thinking-status--search`, `.clyra-search-progress`,
 * `.clyra-search-step`, defined globally in src/index.css) rather than
 * inventing a second search animation for Cowork.
 */
export function ClyraSearchActivity({ query }: { query?: string }) {
  return (
    <div
      className="clyra-thinking-status clyra-thinking-status--search"
      style={{ animation: "clyraThinkIn .55s cubic-bezier(.32,.72,0,1) both" }}
      aria-live="polite"
    >
      <div className="clyra-thinking-status__line">
        <span style={{ display: "flex", alignItems: "center", color: "#9DA1A9", flexShrink: 0 }} aria-hidden>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
            <circle cx={12} cy={12} r={8.6} />
            <path d="M3.4 12h17.2M12 3.4c2.4 2.5 3.7 5.4 3.7 8.6S14.4 18.1 12 20.6c-2.4-2.5-3.7-5.4-3.7-8.6S9.6 5.9 12 3.4z" />
          </svg>
        </span>
        <span className="clyra-thinking-wave clyra-thinking-wave--shimmer min-w-0 truncate">Searching the web</span>
      </div>
      {query?.trim() ? (
        <div className="clyra-search-progress" aria-label="Web search progress">
          <div className="clyra-search-step clyra-search-step--query">
            <span className="clyra-search-step__icon" aria-hidden>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
                <circle cx={12} cy={12} r={8.6} />
                <path d="M3.4 12h17.2M12 3.4c2.4 2.5 3.7 5.4 3.7 8.6S14.4 18.1 12 20.6c-2.4-2.5-3.7-5.4-3.7-8.6S9.6 5.9 12 3.4z" />
              </svg>
            </span>
            <span className="clyra-search-step__label">{query.trim()}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Site favicons are useful but optional — ported from App.tsx's SiteMark so
 * a source chip always has a stable, readable mark even offline. */
export function ClyraSiteMark({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  const label = host.replace(/^www\./i, "");
  if (failed) return <span className="clyra-site-mark__fallback" aria-hidden>{label.slice(0, 1).toUpperCase()}</span>;
  return <img src={`https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${host}`)}&sz=64`} alt="" onError={() => setFailed(true)} />;
}

/** The numbered sources behind a grounded answer. Each row maps one `[S#]`
 * marker to a page that was really fetched, with its title and retrieval time. */
export function ClyraSearchCitations({ citations }: { citations: WebCitationView[] }) {
  if (!citations.length) return null;
  return (
    <section aria-label="Sources" style={{ marginTop: 14, borderTop: "1px solid #E7E4DE", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#6B6F76", letterSpacing: "0.01em" }}>Sources</p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {citations.map((citation) => (
          <li key={citation.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", minWidth: 0 }}>
            <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums", color: "#9DA1A9", minWidth: 22, paddingTop: 2 }}>{citation.id}</span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <a href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.url} style={{ fontSize: 13, color: "#15171c", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {citation.title}
              </a>
              <span style={{ fontSize: 11.5, color: "#9DA1A9", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 13, height: 13, display: "inline-flex" }}><ClyraSiteMark host={citation.host} /></span>
                {citation.host}
                <span aria-hidden>·</span>
                <time dateTime={citation.retrievedAt}>retrieved {new Date(citation.retrievedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
