import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";
import type { ResearchImage } from "../../../lib/chat-agent/rich-search";
import type { ContentBlock } from "../../lib/contentBlocks";
import "./chat-research-results.css";

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; } };

function Lightbox({ image, onClose }: { image: ResearchImage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="clyra-research-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="clyra-research-lightbox__panel" role="dialog" aria-modal="true" aria-label={"Image preview: " + image.title}>
        <button type="button" className="clyra-research-lightbox__close" aria-label="Close image" onClick={onClose}><X size={18} /></button>
        <img src={image.imageUrl} alt={image.title} />
        <div className="clyra-research-lightbox__footer">
          <span className="clyra-research-lightbox__title">{image.title}</span>
          <span className="clyra-research-lightbox__credit">{[image.creator, image.licence].filter(Boolean).join(" · ") || "Wikimedia Commons"}</span>
          <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Source and licence <ExternalLink size={13} aria-hidden /></a>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A picture that fades in once it has loaded (a soft skeleton until then), and opens full size on click. */
function Picture({ image, className, onOpen, children }: { image: ResearchImage; className: string; onOpen: (image: ResearchImage) => void; children?: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <button type="button" className={`${className} clyra-inline-pic${loaded ? " is-loaded" : ""}`} title={image.title} onClick={() => onOpen(image)}>
      <img src={image.thumbnailUrl} alt={image.title} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      {children}
    </button>
  );
}

const Caption = ({ image }: { image: ResearchImage }) => (
  <span className="clyra-inline-pic__caption"><b>{image.title}</b><i>{hostOf(image.sourceUrl)}</i></span>
);

/** One block of an answer that is not text: a single image, a carousel, a grid, or an image beside its description. */
export function InlineImageBlock({ block }: { block: Exclude<ContentBlock, { type: "text" }> }) {
  const [open, setOpen] = useState<ResearchImage | null>(null);
  let body: React.ReactNode = null;
  if (block.type === "image") {
    body = (
      <figure className="clyra-inline-figure">
        <Picture image={block.image} className="clyra-inline-single" onOpen={setOpen} />
        <figcaption><b>{block.image.title}</b><span>{hostOf(block.image.sourceUrl)}</span></figcaption>
      </figure>
    );
  } else if (block.type === "carousel") {
    body = (
      <div className="clyra-inline-carousel" role="list" aria-label="Images">
        {block.images.map((image) => <Picture key={image.id} image={image} className="clyra-inline-tile" onOpen={setOpen}><Caption image={image} /></Picture>)}
      </div>
    );
  } else if (block.type === "image_grid") {
    body = (
      <div className="clyra-inline-grid" data-count={block.images.length}>
        {block.images.map((image) => <Picture key={image.id} image={image} className="clyra-inline-cell" onOpen={setOpen}><Caption image={image} /></Picture>)}
      </div>
    );
  } else {
    body = (
      <div className="clyra-inline-row">
        <Picture image={block.image} className="clyra-inline-thumb" onOpen={setOpen} />
        <div className="clyra-inline-row__text"><b>{block.title}</b>{block.text ? <p>{block.text}</p> : null}</div>
      </div>
    );
  }
  return (
    <div className="clyra-inline-block" data-kind={block.type}>
      {body}
      {open ? <Lightbox image={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
