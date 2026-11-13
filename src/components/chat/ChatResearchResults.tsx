import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, Github, Images, Star, X } from "lucide-react";
import type { AgentStepView } from "../../lib/chatAgentClient";
import type { ResearchImage, ResearchRepository } from "../../../lib/chat-agent/rich-search";
import "./chat-research-results.css";

const shortCount = (n: number) => n >= 1000
  ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
  : String(n);

/** Live provider results, not fabricated Markdown cards. Rendered with the answer's real tool run. */
export function ChatResearchResults({ steps }: { steps: AgentStepView[] }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ResearchImage | null>(null);
  const { images, repositories } = useMemo(() => {
    const images: ResearchImage[] = [];
    const repositories: ResearchRepository[] = [];
    const seenImages = new Set<string>();
    const seenRepos = new Set<string>();
    for (const step of steps) {
      if (step.state !== "done") continue;
      for (const image of step.images || []) {
        if (!seenImages.has(image.sourceUrl)) { seenImages.add(image.sourceUrl); images.push(image); }
      }
      for (const repo of step.repositories || []) {
        if (!seenRepos.has(repo.fullName.toLowerCase())) { seenRepos.add(repo.fullName.toLowerCase()); repositories.push(repo); }
      }
    }
    return { images: images.slice(0, 16), repositories: repositories.slice(0, 12) };
  }, [steps]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected]);

  if (!images.length && !repositories.length) return null;
  return (
    <div className="clyra-research-results">
      {images.length ? (
        <section className="clyra-research-section" aria-label="Real image search results">
          <div className="clyra-research-section__heading">
            <Images aria-hidden size={16} strokeWidth={1.7} />
            <span>Images</span>
            <span className="clyra-research-section__count">{images.length}</span>
          </div>
          <div className="clyra-research-image-grid">
            {images.slice(0, expanded ? images.length : 5).map((image, index) => (
              <button className={"clyra-research-image" + (index === 0 ? " clyra-research-image--hero" : "")} key={image.sourceUrl} type="button" title={image.title} onClick={() => setSelected(image)}>
                <img src={image.thumbnailUrl} alt={image.title} loading="lazy" referrerPolicy="no-referrer" />
                <span className="clyra-research-image__caption">{image.title}</span>
              </button>
            ))}
          </div>
          {images.length > 5 ? (
            <button type="button" className="clyra-research-more" onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Show fewer" : "View all images"} <ChevronDown size={13} aria-hidden className={expanded ? "is-rotated" : ""} />
            </button>
          ) : null}
          <p className="clyra-research-attribution">Image previews from Openverse and Wikimedia Commons. Open each image for source and licence.</p>
        </section>
      ) : null}
      {repositories.length ? (
        <section className="clyra-research-section" aria-label="Verified GitHub repositories">
          <div className="clyra-research-section__heading">
            <Github aria-hidden size={16} strokeWidth={1.7} />
            <span>GitHub repositories</span>
            <span className="clyra-research-section__count">{repositories.length}</span>
          </div>
          <div className="clyra-research-repos">
            {repositories.map((repo) => (
              <a className="clyra-research-repo" href={repo.url} target="_blank" rel="noopener noreferrer" key={repo.fullName} aria-label={"Open " + repo.fullName + " on GitHub"}>
                <span className="clyra-research-repo__top">
                  {repo.ownerAvatar ? <img src={repo.ownerAvatar} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Github size={20} aria-hidden />}
                  <span className="clyra-research-repo__title">{repo.fullName}</span>
                  <ExternalLink size={14} className="clyra-research-repo__external" aria-hidden />
                </span>
                {repo.description ? <span className="clyra-research-repo__description">{repo.description}</span> : null}
                <span className="clyra-research-repo__metadata">
                  <span><Star size={12} aria-hidden /> {shortCount(repo.stars)}</span>
                  {repo.language ? <span className="clyra-research-repo__language">{repo.language}</span> : null}
                  {repo.licence ? <span>{repo.licence}</span> : <span>Licence not verified</span>}
                </span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {selected ? createPortal(
        <div className="clyra-research-lightbox" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="clyra-research-lightbox__panel" role="dialog" aria-modal="true" aria-label={"Image preview: " + selected.title}>
            <button type="button" className="clyra-research-lightbox__close" aria-label="Close image" onClick={() => setSelected(null)}><X size={18} /></button>
            <img src={selected.imageUrl} alt={selected.title} />
            <div className="clyra-research-lightbox__footer">
              <span className="clyra-research-lightbox__title">{selected.title}</span>
              <span className="clyra-research-lightbox__credit">{[selected.creator, selected.licence].filter(Boolean).join(" · ") || "Wikimedia Commons"}</span>
              <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Source and licence <ExternalLink size={13} aria-hidden /></a>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
