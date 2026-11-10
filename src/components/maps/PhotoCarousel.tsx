import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface CarouselPhoto {
  url: string;
  /** Where the picture comes from ("Official site", "Google"…): shown under it, so the source is never hidden. */
  source: string;
  caption?: string;
  link?: string;
}

/** The same carousel Clyra Notes uses for template previews: cards that peek in from both sides and snap to the
 * centre, the active one in full colour and its neighbours quiet, a caption under each, arrows at the ends and a
 * row of dots that stretch to show where you are. */
export function PhotoCarousel({ photos, alt, onFail }: { photos: CarouselPhoto[]; alt: string; onFail?: (url: string) => void }) {
  const track = useRef<HTMLDivElement | null>(null);
  const figures = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
    track.current?.scrollTo({ left: 0 });
  }, [photos[0]?.url, photos.length]);

  const go = (next: number, move = true) => {
    const i = Math.max(0, Math.min(photos.length - 1, next));
    setActive(i);
    if (move) figures.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const centre = el.getBoundingClientRect().left + el.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    figures.current.forEach((f, i) => {
      if (!f) return;
      const box = f.getBoundingClientRect();
      const d = Math.abs(box.left + box.width / 2 - centre);
      if (d < best) { best = d; nearest = i; }
    });
    setActive(nearest);
  };

  return (
    <div className="mx-gallery" aria-label={`${alt} photos`}>
      <div
        ref={track}
        className="mx-gallery__track"
        role="region"
        tabIndex={0}
        aria-label="Photo carousel"
        onScroll={onScroll}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { e.preventDefault(); go(active + 1); }
          if (e.key === "ArrowLeft") { e.preventDefault(); go(active - 1); }
        }}
      >
        {photos.map((p, i) => (
          <figure key={p.url} ref={(el) => { figures.current[i] = el; }} className={"mx-gallery__shot" + (i === active ? " is-active" : "")}>
            <img src={p.url} alt={i === active ? alt : ""} loading={i < 3 ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => onFail?.(p.url)} />
            <figcaption>
              <strong>{p.source}</strong>
              {p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer">{p.caption || "View source"}</a> : <span>{p.caption || ""}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
      {photos.length > 1 ? (
        <>
          <button type="button" className="mx-gallery__arrow mx-gallery__prev" aria-label="Previous photo" hidden={active === 0} onClick={() => go(active - 1)}><ChevronLeft size={16} /></button>
          <button type="button" className="mx-gallery__arrow mx-gallery__next" aria-label="Next photo" hidden={active === photos.length - 1} onClick={() => go(active + 1)}><ChevronRight size={16} /></button>
          <div className="mx-gallery__dots" role="tablist" aria-label="Photo position">
            {photos.map((p, i) => (
              <button key={p.url} type="button" role="tab" aria-selected={i === active} aria-label={`Photo ${i + 1} of ${photos.length}`} className={"mx-gallery__dot" + (i === active ? " is-active" : "")} onClick={() => go(i)} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
