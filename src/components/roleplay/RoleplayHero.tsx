import { useRef, useState } from "react";
import { ArrowRight, ChevronDown, Compass, Globe2, Loader2, Plus, User, X } from "lucide-react";
import { cn } from "../../lib/utils";

export type RoleplayMode = "character" | "world";

const SUGGESTIONS: Array<{ label: string; query: string; mode?: RoleplayMode }> = [
  { label: "Original character", query: "An original character who " },
  { label: "Existing character", query: "Create a faithful version of " },
  { label: "Build a world", query: "The world of ", mode: "world" },
];

/** Reads a dropped/selected image client-side and downsizes it to a reasonable avatar - no upload endpoint needed, the result is just a data: URL string like any other avatarUrl. */
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function RoleplayHero({
  query,
  onQueryChange,
  onGenerate,
  generating,
  generateError,
  webResearch,
  onWebResearchChange,
  mode,
  onModeChange,
  avatarDataUrl,
  onAvatarDataUrlChange,
  onManualCreate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onGenerate: () => void;
  generating: boolean;
  generateError: string;
  webResearch: boolean;
  onWebResearchChange: (value: boolean) => void;
  mode: RoleplayMode;
  onModeChange: (value: RoleplayMode) => void;
  avatarDataUrl: string | null;
  onAvatarDataUrlChange: (value: string | null) => void;
  onManualCreate: () => void;
}) {
  const [attachBusy, setAttachBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const placeholder = mode === "world"
    ? "Describe a world…"
    : "Describe someone…";

  const fillSuggestion = (suggestion: (typeof SUGGESTIONS)[number]) => {
    onQueryChange(suggestion.query);
    if (suggestion.mode) onModeChange(suggestion.mode);
    inputRef.current?.focus();
  };

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setAttachBusy(true);
    try {
      onAvatarDataUrlChange(await fileToAvatarDataUrl(file));
    } catch {
      // Silently ignore - attaching a reference image is a nice-to-have, not required to generate.
    } finally {
      setAttachBusy(false);
    }
  };

  const submit = () => {
    if (!query.trim() || generating) return;
    onGenerate();
  };

  return (
    <div className="rp-home-hero relative mx-auto flex w-full max-w-[720px] flex-col items-center px-5 text-center">
      <p className="text-[11px] font-semibold tracking-[0.02em] text-[var(--rp-text-tertiary)]">Clyra Roleplay</p>
      <h1 className="rp-home-title mt-2 text-[var(--clyra-color-label)]">
        Who do you want to meet?
      </h1>
      <p className="mt-2 max-w-[440px] text-[14px] leading-[1.5] text-[var(--clyra-color-label-secondary)]">
        Find someone, create a character, or return to a story.
      </p>

      <div className="mt-6 w-full">
        <div className="rp-home-composer clyra-rp-composer">
            {generating ? (
              <div className="flex min-h-[66px] items-center gap-3 px-5 py-4" role="status" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--rp-accent)]" />
                <div><p className="text-[13.5px] font-semibold text-[var(--rp-text)]">Preparing {mode === "world" ? "your world" : "a roleplay profile"}…</p><p className="mt-0.5 truncate text-[11.5px] text-[var(--rp-text-secondary)]">{query.trim()}</p></div>
              </div>
            ) : (
              <div className="rp-home-composer-row">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleFileSelected(e.target.files?.[0])} />

                <button
                  type="button"
                  onClick={handleAttachClick}
                  disabled={attachBusy}
                  title={avatarDataUrl ? "Reference attached" : "Attach a reference image"}
                  aria-label="Attach reference image"
                  className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--clyra-color-label-tertiary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]"
                >
                  {avatarDataUrl ? (
                    <>
                      <img src={avatarDataUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                      <span
                        role="button"
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); onAvatarDataUrlChange(null); }}
                        aria-label="Remove attached reference"
                        className="absolute -right-0.5 -top-0.5 grid h-4 w-4 place-items-center rounded-full bg-[var(--clyra-color-label)] text-white"
                      >
                        <X className="h-2.5 w-2.5" />
                      </span>
                    </>
                  ) : (
                    <Plus className="h-4 w-4" strokeWidth={1.8} />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onWebResearchChange(!webResearch)}
                  aria-pressed={webResearch}
                  title={webResearch ? "Web research on — grounds this character in real sources" : "Web research off — write a purely original profile"}
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors",
                    webResearch ? "bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)]" : "text-[var(--clyra-color-label-tertiary)] hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]",
                  )}
                >
                  <Globe2 className="h-4 w-4" strokeWidth={1.8} />
                </button>

                <button
                  type="button"
                  onClick={() => onModeChange(mode === "character" ? "world" : "character")}
                  className="rp-home-mode-button flex h-9 shrink-0 items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-medium text-[var(--clyra-color-label-secondary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)]"
                >
                  {mode === "world" ? <Compass className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  <span>{mode === "world" ? "World" : "Character"}</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>

                <div className="rp-home-query relative min-w-0 flex-1">
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
                    aria-label="Describe a character, person, fandom, or world to generate"
                    placeholder={placeholder}
                    className="max-h-[120px] min-h-[24px] w-full resize-none bg-transparent px-2 py-1.5 text-[14.5px] leading-[1.45] text-[var(--clyra-color-label)] outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={submit}
                  disabled={!query.trim()}
                  className="rp-home-create-button flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] bg-[var(--rp-accent)] px-4 text-[13px] font-semibold text-white transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[var(--clyra-press-scale)] disabled:opacity-30"
                >
                  Create
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
        </div>
      </div>

      {generateError ? <p className="mt-2.5 text-[12.5px] text-[var(--clyra-color-danger)]">{generateError}</p> : null}

      <div className="rp-home-suggestions mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <span>Try</span>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => fillSuggestion(s)}
            className="text-[11.5px] font-medium text-[var(--rp-text-secondary)] transition-colors hover:text-[var(--rp-text)]"
          >
            {s.label}
          </button>
        ))}
        <span className="rp-home-suggestion-divider" aria-hidden />
        <button
          type="button"
          onClick={onManualCreate}
          className="text-[11.5px] font-semibold text-[var(--rp-accent)] transition-colors hover:text-[var(--rp-text)]"
        >
          Create manually
        </button>
      </div>
    </div>
  );
}
