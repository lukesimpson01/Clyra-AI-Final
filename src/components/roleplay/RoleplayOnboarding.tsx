import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

const INTERESTS = [
  { id: "Games", title: "Games", detail: "Companions, rivals and quests", tone: "games" },
  { id: "Anime", title: "Anime", detail: "Academies, powers and found family", tone: "anime" },
  { id: "Movies & TV", title: "Film & TV", detail: "Cinematic characters and worlds", tone: "film" },
  { id: "Fantasy", title: "Fantasy", detail: "Kingdoms, legends and journeys", tone: "fantasy" },
  { id: "Historical", title: "Historical", detail: "People shaped by another era", tone: "history" },
  { id: "Original", title: "Original", detail: "A cast made entirely for you", tone: "original" },
] as const;

const SUGGESTIONS = ["Western", "Cyberpunk", "Mystery", "Academy", "Medieval", "Superheroes"];

export function RoleplayOnboarding({
  selected,
  customInterest,
  onToggle,
  onCustomInterestChange,
  onContinue,
  busy,
  error,
}: {
  selected: string[];
  customInterest: string;
  onToggle: (interest: string) => void;
  onCustomInterestChange: (value: string) => void;
  onContinue: () => void;
  busy: boolean;
  error: string;
}) {
  const canContinue = selected.length > 0 || customInterest.trim().length > 0;
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-y-auto bg-[var(--clyra-color-background)]">
      <motion.main
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="rp-onboarding mx-auto flex w-full max-w-[920px] flex-col px-5 py-10 sm:px-8 sm:py-12"
      >
        <p className="text-center text-[12px] font-semibold tracking-[-0.01em] text-[var(--rp-text-secondary)]">Clyra <span className="font-normal text-[var(--rp-text-tertiary)]">Roleplay</span></p>
        <h1 className="mx-auto mt-5 max-w-[580px] text-center text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--rp-text)] sm:text-[40px]">Build your first cast.</h1>
        <p className="mx-auto mt-3 max-w-[540px] text-center text-[14px] leading-[1.55] text-[var(--rp-text-secondary)]">Choose the characters and worlds you want around you. Clyra will prepare a starter library you can edit anytime.</p>

        <motion.section layout aria-label="Character interests" className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {INTERESTS.map(({ id, title, detail, tone }) => {
            const active = selected.includes(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggle(id)}
                aria-pressed={active}
                className={cn(
                  "rp-interest-tile group relative min-h-[138px] overflow-hidden rounded-[17px] border text-left focus-visible:outline-none",
                  active
                    ? "border-[color:var(--rp-accent-border)] shadow-[0_0_0_3px_var(--rp-accent-soft)]"
                    : "border-[var(--rp-border)]",
                )}
              >
                <span className="rp-interest-art" data-tone={tone} aria-hidden><span /><span /><span /></span>
                <span className="absolute inset-x-0 bottom-0 bg-[var(--rp-surface)] px-3.5 py-2.5"><strong className="block text-[13.5px] font-semibold text-[var(--rp-text)]">{title}</strong><span className="mt-0.5 block truncate text-[11px] text-[var(--rp-text-secondary)]">{detail}</span></span>
                {active ? <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--rp-accent)] text-white shadow-sm"><Check className="h-3 w-3" strokeWidth={3} /></span> : null}
              </button>
            );
          })}
        </motion.section>

        <label className="mt-6 block">
          <span className="mb-2 block text-[12px] font-semibold text-[var(--rp-text-secondary)]">Something more specific?</span>
          <textarea rows={2} value={customInterest} onChange={(event) => onCustomInterestChange(event.target.value)} placeholder="Characters from western games, detectives and grounded historical worlds…" className="min-h-[64px] w-full resize-none rounded-[14px] border border-[var(--rp-border)] bg-[var(--rp-surface)] px-3.5 py-3 text-[13px] leading-[1.45] text-[var(--rp-text)] outline-none transition-colors placeholder:text-[var(--rp-text-tertiary)] focus:border-[color:var(--rp-accent-border)] focus:ring-2 focus:ring-[var(--rp-accent-soft)]" />
        </label>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Suggested interests">{SUGGESTIONS.map((suggestion) => <button key={suggestion} type="button" onClick={() => onCustomInterestChange(customInterest ? `${customInterest}, ${suggestion.toLowerCase()}` : suggestion)} className="text-[11.5px] font-medium text-[var(--rp-text-tertiary)] transition-colors hover:text-[var(--rp-accent)]">{suggestion}</button>)}</div>

        {error ? <p role="alert" className="mt-3 text-[12.5px] text-[var(--clyra-color-danger)]">{error}</p> : null}
        <div className="mt-7 flex flex-col items-center gap-3">
          <AnimatePresence mode="wait"><motion.p key={busy ? "busy" : "count"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[11.5px] text-[var(--rp-text-tertiary)]">{busy ? "Creating profiles and starter scenarios…" : `${selected.length} ${selected.length === 1 ? "interest" : "interests"} selected`}</motion.p></AnimatePresence>
          <button type="button" onClick={onContinue} disabled={!canContinue || busy} className="rp-button rp-button-primary min-w-[164px]">
            {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing library</> : <>Build my library <ArrowRight className="h-3.5 w-3.5" /></>}
          </button>
        </div>
      </motion.main>
    </div>
  );
}
