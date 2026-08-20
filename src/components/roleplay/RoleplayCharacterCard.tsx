import { useState } from "react";
import { ArrowRight, Globe2, Heart } from "lucide-react";
import { cn } from "../../lib/utils";
import type { RoleplayCharacter } from "../../lib/roleplay/types";
import { characterInitials, characterWorld, monogramTone } from "../../lib/roleplay/helpers";

/**
 * Shared portrait fill for a character - a real avatar image when one
 * exists, otherwise a calm monogram tile (never a generic person glyph).
 * Reused by the card grid, the shelves, and the chat header so the same
 * character reads identically everywhere it appears.
 */
export function RoleplayPortrait({
  character,
  className,
  imgClassName,
  initialsClassName = "text-[26px]",
}: {
  character: Pick<RoleplayCharacter, "name" | "avatarUrl">;
  className?: string;
  /** Extra classes applied directly to the <img>, e.g. a group-hover scale - kept as
   * a prop instead of an arbitrary descendant selector so the hover rule stays simple CSS. */
  imgClassName?: string;
  /** Monogram font size - callers size this to match how large the portrait renders. */
  initialsClassName?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const tone = monogramTone(character.name || "?");

  if (!character.avatarUrl) {
    // A generic head-and-shoulders glyph makes every character without a
    // picture look like the same unfinished placeholder. Their own initials in
    // their own colour at least say which character this is.
    return (
      <div className={cn("rp-neutral-portrait grid place-items-center", className)} style={{ background: tone.bg, color: tone.fg }} role="img" aria-label={`${character.name} portrait`}>
        <span className={cn("rp-neutral-portrait__initials", initialsClassName)} aria-hidden>{characterInitials(character.name)}</span>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: tone.bg }}>
      <img
        src={character.avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-[opacity,transform] duration-[180ms] [transition-timing-function:var(--rp-ease)]",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}

export function RoleplayCharacterCard({
  character,
  onOpen,
  onToggleFavorite,
  className,
}: {
  character: RoleplayCharacter;
  onOpen: () => void;
  onToggleFavorite: () => void;
  className?: string;
}) {
  const hook = character.tagline || character.personality;
  const showRemembers = Boolean(character.lastUsedAt);

  return (
    <article
      className={cn(
        "clyra-rp-card group relative flex flex-col overflow-hidden rounded-[16px] border border-[var(--rp-border)] bg-[var(--rp-surface)] text-left outline-none transition-[transform,box-shadow,border-color] duration-[200ms] [transition-timing-function:var(--rp-ease)] hover:-translate-y-0.5 hover:border-[var(--rp-border-strong)] hover:shadow-[var(--rp-shadow-card)] focus-within:ring-2 focus-within:ring-[var(--rp-accent-soft)] active:translate-y-0",
        className,
      )}
    >
      <button type="button" onClick={onOpen} aria-label={`Chat with ${character.name}`} className="absolute inset-0 z-10 cursor-pointer rounded-[16px]" />
      <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden">
        <RoleplayPortrait character={character} className="absolute inset-0 h-full w-full" imgClassName="group-hover:scale-[1.018]" />

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          aria-label={character.favorite ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "absolute right-2 top-2 z-20 grid h-7 w-7 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-opacity duration-200 hover:bg-black/50",
            character.favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <Heart className={cn("h-3.5 w-3.5", character.favorite && "fill-current")} />
        </button>

        <span
          className={cn(
            "absolute bottom-2 right-2 flex translate-y-1 items-center gap-1 rounded-full bg-[var(--clyra-color-label)]/90 px-2.5 py-1 text-[10.5px] font-semibold text-white opacity-0 backdrop-blur-sm transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100",
          )}
        >
          Chat <ArrowRight className="h-3 w-3" />
        </span>
      </div>

      <div className="flex min-h-[112px] flex-1 flex-col gap-0.5 px-3 pb-2.5 pt-2.5">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-[var(--clyra-color-label)]">{character.name}</p>
        <p className="truncate text-[11.5px] font-medium text-[var(--clyra-color-label-tertiary)]">{characterWorld(character)}</p>
        <p className="mt-1 line-clamp-2 min-h-[32px] text-[11.5px] leading-[1.4] text-[var(--clyra-color-label-secondary)]">{hook || "Open this character to begin a new story."}</p>
        <p className="mt-auto flex h-4 items-center gap-1.5 pt-1 text-[10px] font-medium text-[var(--clyra-color-label-tertiary)]">
          {showRemembers ? <><span className="h-1.5 w-1.5 rounded-full bg-[var(--rp-accent)]" /> Story in progress</> : character.generationSources.length ? <><Globe2 className="h-2.5 w-2.5" /> Web grounded</> : <span>Original character</span>}
        </p>
      </div>
    </article>
  );
}
