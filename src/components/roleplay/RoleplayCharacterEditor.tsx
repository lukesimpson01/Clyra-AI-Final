import { useRef, useState } from "react";
import { motion } from "motion/react";
import { Check, ChevronDown, Globe2, Image as ImageIcon, Loader2, Trash2, Upload, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { roleplayApi } from "../../lib/roleplay/api";
import type { DialogueFormat, RoleplayCharacter, ResponseStyle } from "../../lib/roleplay/types";
import { DIALOGUE_FORMAT_HINT, DIALOGUE_FORMAT_LABEL, RESPONSE_STYLE_LABEL } from "../../lib/roleplay/types";

const EASE = [0.16, 1, 0.3, 1] as const;
const RESPONSE_STYLES = Object.keys(RESPONSE_STYLE_LABEL) as ResponseStyle[];
const DIALOGUE_FORMATS = Object.keys(DIALOGUE_FORMAT_LABEL) as DialogueFormat[];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-semibold text-[var(--clyra-color-label-secondary)]">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-[var(--clyra-radius-md)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] px-3 py-2 text-[13px] text-[var(--clyra-color-label)] outline-none transition-colors focus:border-[var(--clyra-color-accent)]/50";
const textareaClass = cn(inputClass, "min-h-[64px] resize-y leading-[1.5]");

/**
 * Shared editor for a character draft, used both right after web-search
 * generation (review-before-save) and for manually editing a saved
 * character later. Owns the avatar picker (real Wikimedia image search,
 * source shown per spec).
 */
export function RoleplayCharacterEditor({
  draft,
  sources,
  onChange,
  onSave,
  onCancel,
  saving,
  simple = false,
}: {
  draft: RoleplayCharacter;
  sources?: string[];
  onChange: (next: RoleplayCharacter) => void;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  /** Manual creation starts with the essentials; generated review remains complete. */
  simple?: boolean;
}) {
  const [avatarQuery, setAvatarQuery] = useState(draft.name);
  const [avatarResults, setAvatarResults] = useState<Array<{ thumbnailUrl: string; fullUrl: string; sourceUrl: string; attribution: string }>>([]);
  const [searchingAvatar, setSearchingAvatar] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(!simple);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const set = <K extends keyof RoleplayCharacter>(key: K, value: RoleplayCharacter[K]) => onChange({ ...draft, [key]: value });

  const runAvatarSearch = async () => {
    if (!avatarQuery.trim()) return;
    setSearchingAvatar(true);
    try {
      const results = await roleplayApi.searchAvatars(avatarQuery.trim());
      setAvatarResults(results);
      setAvatarOpen(true);
    } catch {
      setAvatarResults([]);
    } finally {
      setSearchingAvatar(false);
    }
  };

  const fileInput = useRef<HTMLInputElement | null>(null);

  // An unsaved draft has no id yet, so its portrait cannot be filed against a
  // character on disk. Hold it inline until the character is saved; the editor
  // sends the same data URL up with the rest of the draft.
  const applyUpload = (file: File) => {
    setUploadError(null);
    const reader = new FileReader();
    reader.onerror = () => setUploadError("That file could not be read.");
    reader.onload = async () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      if (!draft.id) {
        onChange({ ...draft, avatarUrl: dataUrl, avatarSourceUrl: "" });
        return;
      }
      setUploading(true);
      try {
        const saved = await roleplayApi.uploadAvatar(draft.id, dataUrl);
        onChange({ ...draft, avatarUrl: saved.avatarUrl, avatarSourceUrl: "" });
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : "That image could not be saved.");
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const clearPortrait = async () => {
    onChange({ ...draft, avatarUrl: "", avatarSourceUrl: "" });
    if (draft.id) await roleplayApi.removeAvatar(draft.id).catch(() => {});
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }} className="mx-auto flex w-full max-w-[720px] flex-col gap-5 pb-10">
      <div className="flex items-center gap-4">
        <button type="button" onClick={runAvatarSearch} className="group relative grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-[var(--clyra-radius-lg)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface-muted)]">
          {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="h-6 w-6 text-[var(--clyra-color-label-tertiary)]" />}
          <span className="absolute inset-0 grid place-items-center bg-black/40 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
            {searchingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find image"}
          </span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Character name" className={cn(inputClass, "text-[15px] font-semibold")} />
          <input value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="One-line hook shown on their card" className={inputClass} />
          <div className="mt-0.5 flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => { const file = event.target.files?.[0]; if (file) applyUpload(file); event.target.value = ""; }}
            />
            {/* Upload comes first: image search only finds public figures, so
                every original character depends on this path. */}
            <button type="button" onClick={() => fileInput.current?.click()} className="flex h-7 items-center gap-1.5 rounded-[var(--clyra-radius-sm)] px-2 text-[11.5px] font-medium text-[var(--clyra-color-label-secondary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Upload portrait
            </button>
            <button type="button" onClick={runAvatarSearch} className="flex h-7 items-center gap-1.5 rounded-[var(--clyra-radius-sm)] px-2 text-[11.5px] font-medium text-[var(--clyra-color-label-secondary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]">
              <Globe2 className="h-3.5 w-3.5" />
              Search the web
            </button>
            {draft.avatarUrl ? (
              <button type="button" onClick={() => void clearPortrait()} aria-label="Remove portrait" className="grid h-7 w-7 place-items-center rounded-[var(--clyra-radius-sm)] text-[var(--clyra-color-label-tertiary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {uploadError ? <p className="text-[11px] text-[var(--clyra-color-danger)]">{uploadError}</p> : null}
        </div>
      </div>

      {avatarOpen ? (
        <div className="rounded-[var(--clyra-radius-md)] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-3">
          <div className="mb-2 flex items-center gap-2">
            <input value={avatarQuery} onChange={(e) => setAvatarQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAvatarSearch()} className={cn(inputClass, "flex-1")} placeholder="Search a public image…" />
            <button type="button" onClick={runAvatarSearch} className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--clyra-radius-md)] bg-[var(--clyra-color-accent)] text-white">
              {searchingAvatar ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
            </button>
            <button type="button" onClick={() => setAvatarOpen(false)} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--clyra-radius-md)] text-[var(--clyra-color-label-tertiary)] hover:bg-[var(--clyra-color-surface-muted)]"><X className="h-4 w-4" /></button>
          </div>
          {avatarResults.length ? (
            <div className="grid grid-cols-6 gap-2">
              {avatarResults.map((result) => (
                <button
                  key={result.fullUrl}
                  type="button"
                  title={result.attribution}
                  onClick={() => { onChange({ ...draft, avatarUrl: result.fullUrl, avatarSourceUrl: result.sourceUrl }); setAvatarOpen(false); }}
                  className="group relative aspect-square overflow-hidden rounded-[var(--clyra-radius-sm)] border border-[var(--clyra-color-border)]"
                >
                  <img src={result.thumbnailUrl} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-[12px] text-[var(--clyra-color-label-tertiary)]">{searchingAvatar ? "Searching…" : "No public images found — try a different search."}</p>
          )}
        </div>
      ) : null}

      {sources && sources.length ? (
        <p className="text-[11px] text-[var(--clyra-color-label-tertiary)]">
          Grounded in {sources.length} web source{sources.length === 1 ? "" : "s"}: {sources.slice(0, 3).map((s) => { try { return new URL(s).hostname.replace(/^www\./, ""); } catch { return s; } }).join(", ")}{sources.length > 3 ? "…" : ""}
        </p>
      ) : null}

      <Field label="Personality"><textarea value={draft.personality} onChange={(e) => set("personality", e.target.value)} className={textareaClass} /></Field>
      <Field label="Scenario"><textarea value={draft.scenario} onChange={(e) => set("scenario", e.target.value)} className={textareaClass} /></Field>
      <Field label="Greeting (their opening message)"><textarea value={draft.greeting} onChange={(e) => set("greeting", e.target.value)} className={textareaClass} /></Field>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline gap-2">
          <span className="text-[11.5px] font-semibold text-[var(--clyra-color-label-secondary)]">Looks and outfit</span>
          <span className="text-[11px] font-normal text-[var(--clyra-color-label-tertiary)]">Optional — skip and they'll pick something that fits</span>
        </span>
        <textarea
          value={draft.outfit}
          onChange={(e) => set("outfit", e.target.value)}
          placeholder="Head to toe: hair, build, what they're wearing right now…"
          className={textareaClass}
        />
        <span className="text-[11px] leading-[1.45] text-[var(--clyra-color-label-tertiary)]">
          Each story tracks this separately from here, and updates it when the story changes what they're wearing.
        </span>
      </label>

      <Field label="Response style">
        <div className="flex flex-wrap gap-1.5">
          {RESPONSE_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => set("responseStyle", style)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                draft.responseStyle === style
                  ? "border-[var(--clyra-color-accent)] bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)]"
                  : "border-[var(--clyra-color-border)] text-[var(--clyra-color-label-secondary)] hover:bg-[var(--clyra-color-surface-muted)]",
              )}
            >
              {RESPONSE_STYLE_LABEL[style]}
            </button>
          ))}
        </div>
        {draft.responseStyle === "custom" ? (
          <textarea value={draft.customResponseStyle} onChange={(e) => set("customResponseStyle", e.target.value)} placeholder="Describe the exact style you want…" className={cn(textareaClass, "mt-2")} />
        ) : null}
      </Field>

      {/* Style is how they write; format is the shape of each line. Two people
          can both want "cinematic" and disagree completely about whether every
          turn should open with a head-to-toe outfit. */}
      <Field label="Message format">
        <div className="flex flex-col gap-1">
          {DIALOGUE_FORMATS.map((format) => {
            const active = draft.dialogueFormat === format;
            return (
              <button
                key={format}
                type="button"
                onClick={() => set("dialogueFormat", format)}
                aria-pressed={active}
                className={cn(
                  "flex items-start gap-2.5 rounded-[var(--clyra-radius-md)] border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-[var(--clyra-color-accent)] bg-[var(--clyra-color-accent-soft)]"
                    : "border-[var(--clyra-color-border)] hover:bg-[var(--clyra-color-surface-muted)]",
                )}
              >
                <span className={cn("mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border", active ? "border-[var(--clyra-color-accent)] bg-[var(--clyra-color-accent)]" : "border-[var(--clyra-color-border-strong)]")}>
                  {active ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[12.5px] font-medium", active ? "text-[var(--clyra-color-accent)]" : "text-[var(--clyra-color-label)]")}>{DIALOGUE_FORMAT_LABEL[format]}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-[var(--clyra-color-label-tertiary)]">{DIALOGUE_FORMAT_HINT[format]}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      {simple && !showDetails ? (
        <button type="button" onClick={() => setShowDetails(true)} className="inline-flex h-8 w-fit items-center gap-1 rounded-[9px] px-2 text-[12px] font-medium text-[var(--clyra-color-label-secondary)] transition-colors hover:bg-[var(--clyra-color-surface-muted)] hover:text-[var(--clyra-color-label)]">More character details <ChevronDown className="h-3.5 w-3.5" /></button>
      ) : null}

      {showDetails ? <div className="flex flex-col gap-5 border-t border-[var(--clyra-color-border)] pt-5">
        {simple ? <p className="text-[12px] text-[var(--clyra-color-label-secondary)]">Optional details help make longer stories feel more specific and consistent.</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Age"><input value={draft.age} onChange={(e) => set("age", e.target.value)} className={inputClass} /></Field>
          <Field label="Tags (comma-separated)">
            <input value={draft.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} className={inputClass} />
          </Field>
        </div>
        <Field label="Speech patterns"><textarea value={draft.speechPatterns} onChange={(e) => set("speechPatterns", e.target.value)} className={textareaClass} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Likes"><textarea value={draft.likes} onChange={(e) => set("likes", e.target.value)} className={textareaClass} /></Field>
          <Field label="Dislikes"><textarea value={draft.dislikes} onChange={(e) => set("dislikes", e.target.value)} className={textareaClass} /></Field>
        </div>
        <Field label="Relationships"><textarea value={draft.relationships} onChange={(e) => set("relationships", e.target.value)} className={textareaClass} /></Field>
        <Field label="Roleplay rules"><textarea value={draft.roleplayRules} onChange={(e) => set("roleplayRules", e.target.value)} className={textareaClass} /></Field>
      </div> : null}

      <div className="mt-2 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-[13px] font-medium text-[var(--clyra-color-label-secondary)] hover:bg-[var(--clyra-color-surface-muted)]">Cancel</button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
          className="flex items-center gap-1.5 rounded-full bg-[var(--clyra-color-accent)] px-5 py-2 text-[13px] font-semibold text-white transition-transform active:scale-[var(--clyra-press-scale)] disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save character
        </button>
      </div>
    </motion.div>
  );
}
