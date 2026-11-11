import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AppWindow,
  Blocks,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  FileSearch,
  Image as ImageIcon,
  LoaderCircle,
  Map as MapIcon,
  Palette,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { api, type TemplateImportMode, type TemplateImportPlan, type TemplateManifest } from "./api";
import { cn } from "../../lib/utils";
import { useNativeOcclusion } from "../../lib/nativeOcclusion";
import { FEATURED_APP_IDS } from "../../lib/clyra-code/library/featured-apps";

const EASE = [0.22, 1, 0.36, 1] as const;

const IMPORT_CHOICES: Array<{ id: TemplateImportMode; title: string; detail: string }> = [
  { id: "clean-derived-project", title: "Create source project", detail: "A separate, editable Clyra project from a pinned upstream checkout." },
  { id: "integrate-existing-project", title: "Add to current project", detail: "Adds an isolated source checkout only. Clyra will not merge files automatically." },
  { id: "isolated-sandbox", title: "Run as reference", detail: "Creates an isolated source project for inspection and later local setup." },
  { id: "dependency-source", title: "Use as dependency source", detail: "Adds the source beside the current project without installing it." },
];

/* ───────────────────────── category styling ───────────────────────── */

type CategoryMeta = {
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
  accent: string;
  tint: string;
  panel: string;
};

/* One quiet set of neutrals, as in Notes: a category is told apart by its glyph and name, not by a colour wash. */
const PALETTE = [
  { accent: "#5F5E59", tint: "#F7F6F5", panel: "#EFEEEB" },
];

function hashOf(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

function iconFor(category: string): CategoryMeta["icon"] {
  const c = category.toLowerCase();
  if (/video|short|clip|media/.test(c)) return Clapperboard;
  if (/design/.test(c)) return Palette;
  if (/image|photo|creator/.test(c)) return ImageIcon;
  if (/map|location/.test(c)) return MapIcon;
  if (/\bai\b|assistant|knowledge/.test(c)) return Sparkles;
  if (/code|developer|tool|database|monitor|analytic/.test(c)) return FileSearch;
  if (/app|web|commerce|form|billing|crm|email|message|schedul|landing/.test(c)) return AppWindow;
  return Blocks;
}

const META_CACHE = new globalThis.Map<string, CategoryMeta>();
function categoryMeta(category: string): CategoryMeta {
  const cached = META_CACHE.get(category);
  if (cached) return cached;
  const meta: CategoryMeta = { ...PALETTE[hashOf(category) % PALETTE.length], icon: iconFor(category) };
  META_CACHE.set(category, meta);
  return meta;
}

function coverCapabilities(entry: TemplateManifest) {
  const description = entry.description.trim().toLowerCase().replace(/\.$/, "");
  return [...entry.capabilitiesVerified, ...entry.capabilitiesPlanned]
    .filter((cap) => cap.trim().toLowerCase().replace(/\.$/, "") !== description)
    .slice(0, 3);
}

function statusLabel(entry: TemplateManifest) {
  const labels: Record<TemplateManifest["status"], string> = {
    "unverified": "Verification pending",
    "runnable-now": "Runnable now",
    "requires-setup": "Requires setup",
    "integration-sdk": "Integration / SDK",
    "reference-only": "Reference only",
    "unavailable": "Unavailable",
  };
  return labels[entry.status];
}

function modeLabel(entry: TemplateManifest) {
  return entry.mode.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCommit(commit: string) {
  return commit.slice(0, 12);
}

function repoSlug(entry: TemplateManifest) {
  return entry.repositoryUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
}

/* ───────────────────────── installed registry ───────────────────────── */

type InstallRecord = { projectId: string; at: number };
const STORAGE_KEY = "clyra-library-installed-v1";

function readInstalled(): Record<string, InstallRecord> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, InstallRecord>) : {};
  } catch {
    return {};
  }
}

function writeInstalled(value: Record<string, InstallRecord>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private mode: the installed list just won't persist */
  }
}

type InstallPhase = "verifying" | "downloading" | "finishing";

/* ───────────────────────── visual pieces (App Store) ───────────────────────── */

const BLUE = "#3977F6";

/**
 * Round-robin the distinct landing-page industries for the unfiltered gallery.
 * Avoid 8 near-identical SaaS screenshots dominating Discover while retaining
 * stable ordering within a selected category and preserving all 75 templates.
 */
function interleaveLandingIndustries(entries: TemplateManifest[]): TemplateManifest[] {
  const buckets = new Map<string, TemplateManifest[]>();
  for (const entry of entries) {
    const key = entry.landingPageType || "Other";
    const bucket = buckets.get(key) ?? [];
    bucket.push(entry);
    buckets.set(key, bucket);
  }
  const ordered: TemplateManifest[] = [];
  let more = true;
  while (more) {
    more = false;
    for (const bucket of buckets.values()) {
      const next = bucket.shift();
      if (next) {
        ordered.push(next);
        more = true;
      }
    }
  }
  return ordered;
}

function subtitleOf(entry: TemplateManifest) {
  return entry.landingPageType || (entry.alternativeTo.length ? `Like ${entry.alternativeTo.slice(0, 2).join(" & ")}` : entry.category);
}

function coverBackground(entry: TemplateManifest) {
  const meta = categoryMeta(entry.category);
  return meta.tint;
}

/** A soft, colour-washed backdrop made from the app's own icon (cheap: a tiny image, upscaled and blurred once). */
function IconWash({ entry, opacity = 0.5 }: { entry: TemplateManifest; opacity?: number }) {
  const [failed, setFailed] = useState(true);
  if (failed) return null;
  return (
    <img src={`https://github.com/${repoSlug(entry).split("/")[0]}.png?size=40`} alt="" aria-hidden loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
      className="pointer-events-none absolute left-1/2 top-1/2 h-[140%] w-[140%] -translate-x-1/2 -translate-y-1/2 object-cover blur-[34px] saturate-[1.35]" style={{ opacity }} />
  );
}

/**
 * Cover art: an authorised capture when the catalogue has one; otherwise an App Store style card built from the
 * app's own icon on a colour wash — crisp at any size, never a cropped social-preview image.
 */
function SourceVisual({ entry, className = "", iconSize = 64 }: { entry: TemplateManifest; className?: string; iconSize?: number }) {
  const sourceCapture = entry.sourceScreenshots[0];
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  if (sourceCapture && state !== "failed") {
    return (
      <div className={cn("relative isolate overflow-hidden bg-[#F7F6F5]", className)}>
        <img src={sourceCapture.url} alt={sourceCapture.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setState("ready")} onError={() => setState("failed")}
          className={cn("absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]", state === "ready" ? "opacity-100" : "opacity-0")} />
        {state === "loading" ? <div className="cc-lib-shimmer absolute inset-0" aria-hidden /> : null}
      </div>
    );
  }
  return (
    <div className={cn("relative isolate flex flex-col items-center justify-center overflow-hidden bg-[#F7F6F5] p-5 text-center", className)}
      role="img" aria-label={`No verified screenshot captured yet for ${entry.name}`}>
      <ImageIcon className="mb-3 h-5 w-5 text-[#A19E99]" strokeWidth={1.5} aria-hidden />
      <span className="text-[12.5px] font-medium text-[#5F5E59]">Preview not captured</span>
      <span className="mt-1 max-w-[220px] text-[11px] leading-[1.5] text-[#8A8884]">A real screenshot will appear after the source is launch-tested.</span>
    </div>
  );
}

/** App icon: the owner's avatar in a continuous-corner squircle, falling back to the category glyph. */
function AppIcon({ entry, size = 44, round = false, lifted = false }: { entry: TemplateManifest; size?: number; round?: boolean; lifted?: boolean }) {
  const meta = categoryMeta(entry.category);
  const Icon = meta.icon;
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden", round ? "rounded-full" : size >= 100 ? "rounded-[22px]" : "rounded-[10px]", lifted ? "shadow-[0_0_0_1px_rgba(55,53,47,0.09),0_2px_8px_rgba(15,15,15,0.06)]" : "shadow-[0_1px_2px_rgba(0,0,0,0.10),inset_0_0_0_0.5px_rgba(0,0,0,0.10)]")}
      style={{ width: size, height: size, background: meta.tint, color: meta.accent }}
    >
      <Icon className="h-[46%] w-[46%]" />
      {failed ? null : <img src={`https://github.com/${repoSlug(entry).split("/")[0]}.png?size=${Math.min(460, Math.max(96, size * 2))}`} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} className={cn("absolute inset-0 h-full w-full bg-white object-cover transition-opacity duration-300", loaded ? "opacity-100" : "opacity-0")} />}
    </span>
  );
}

/**
 * The App Store download ring. Waiting: a grey track with a spinning arc. Downloading: a blue arc fills around a
 * stop square. Finishing: the arc closes, then the button morphs back into a pill that reads Open.
 */
function InstallRing({ phase, size }: { phase: InstallPhase; size: number }) {
  const [progress, setProgress] = useState(0.03);
  useEffect(() => {
    if (phase === "finishing") { setProgress(1); return; }
    if (phase !== "downloading") return;
    const timer = window.setInterval(() => setProgress((value) => value + (0.93 - value) * 0.045), 90);
    return () => window.clearInterval(timer);
  }, [phase]);
  const stroke = size >= 32 ? 2.6 : 2.3;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  const waiting = phase === "verifying";
  return (
    <span role="progressbar" aria-label={waiting ? "Waiting" : phase === "finishing" ? "Finishing" : "Downloading"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={waiting ? undefined : Math.round(progress * 100)}
      className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className={cn("-rotate-90", waiting && "cc-ring-spin")} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(55,53,47,0.12)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={waiting ? "#A19E99" : BLUE} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={waiting ? circumference * 0.74 : circumference * (1 - progress)}
          style={{ transition: phase === "finishing" ? "stroke-dashoffset 360ms cubic-bezier(0.22,1,0.36,1)" : "stroke-dashoffset 120ms linear, stroke 200ms ease" }} />
      </svg>
      <AnimatePresence>
        {!waiting ? <motion.span key="stop" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="absolute rounded-[2px]" style={{ width: size * 0.26, height: size * 0.26, background: BLUE }} aria-hidden /> : null}
      </AnimatePresence>
    </span>
  );
}

/** Get → waiting → progress → Open: one control that morphs between pill and ring, exactly where it was tapped. */
function GetButton({
  phase, installed, error, onGet, onOpen, large = false, inverted = false,
}: {
  phase?: InstallPhase;
  installed: boolean;
  error?: string;
  onGet: () => void;
  onOpen: () => void;
  large?: boolean;
  inverted?: boolean;
}) {
  const reduce = useReducedMotion();
  const height = large ? 32 : 28;
  const pill = large ? 82 : 66;
  const state = phase ? "progress" : installed ? "open" : error ? "retry" : "get";
  const label = state === "open" ? "Open" : state === "retry" ? "Retry" : "Get";
  return (
    <motion.button
      type="button"
      aria-label={state === "progress" ? "Downloading" : label}
      title={error && state === "retry" ? `${error} Click to retry.` : undefined}
      aria-busy={state === "progress"}
      onClick={(event) => { event.stopPropagation(); if (phase) return; if (installed) onOpen(); else onGet(); }}
      initial={false}
      animate={{
        width: state === "progress" ? height : pill,
        backgroundColor: state === "progress" ? "rgba(240,240,245,0)" : state === "retry" ? "#FCEBEB" : inverted ? "rgba(255,255,255,0.92)" : "rgba(55,53,47,0.06)",
      }}
      transition={reduce ? { duration: 0 } : { duration: 0.32, ease: EASE }}
      whileTap={state === "progress" ? undefined : { scale: 0.97 }}
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45", large ? "text-[14px]" : "text-[13px]", state === "retry" ? "text-[#C0392B]" : "text-[#3977F6]", state !== "progress" && "hover:brightness-[0.97]")}
      style={{ height }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {state === "progress" ? (
          <motion.span key="ring" initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.22, ease: EASE }} className="flex">
            <InstallRing phase={phase!} size={height} />
          </motion.span>
        ) : (
          <motion.span key={label} initial={reduce ? false : { opacity: 0, scale: 0.7, filter: "blur(2px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.24, ease: EASE }}>
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

type InstallApi = {
  phase: (id: string) => InstallPhase | undefined;
  installed: (id: string) => boolean;
  error: (id: string) => string | undefined;
  get: (entry: TemplateManifest) => void;
  open: (entry: TemplateManifest) => void;
};

function activate(handler: () => void) {
  return (event: ReactKeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); handler(); }
  };
}

function Get({ entry, install, large, inverted }: { entry: TemplateManifest; install: InstallApi; large?: boolean; inverted?: boolean }) {
  return <GetButton large={large} inverted={inverted} phase={install.phase(entry.id)} installed={install.installed(entry.id)} error={install.error(entry.id)} onGet={() => install.get(entry)} onOpen={() => install.open(entry)} />;
}

/** App Store app card: artwork on top, the lockup (icon, name, subtitle, Get) underneath. */
function SourceCard({ entry, onChoose, install, index = 0, wide = false }: { entry: TemplateManifest; onChoose: (entry: TemplateManifest) => void; install: InstallApi; index?: number; wide?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.035, ease: EASE }}
      className={cn("group flex min-w-0 shrink-0 flex-col rounded-[12px] text-left", wide ? "w-[272px] snap-start sm:w-[296px]" : "w-full")}
    >
      <button type="button" aria-label={`View ${entry.name} details`} onClick={() => onChoose(entry)}
        className="block min-w-0 w-full cursor-pointer overflow-hidden rounded-[12px] text-left outline-none ring-1 ring-inset ring-[rgba(55,53,47,0.09)] transition-colors duration-150 group-hover:ring-[rgba(55,53,47,0.2)] focus-visible:ring-2 focus-visible:ring-[#3977F6]/45 focus-visible:ring-offset-2">
        <SourceVisual entry={entry} className="aspect-[16/10] w-full" iconSize={wide ? 66 : 70} />
      </button>
      <div className="mt-3 flex min-w-0 items-center gap-3 px-0.5">
        <button type="button" aria-label={`View ${entry.name} details`} onClick={() => onChoose(entry)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45">
          <AppIcon entry={entry} size={42} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold tracking-[-0.012em] text-[#2C2C2B]">{entry.name}</span>
            <span className="block truncate text-[12.5px] text-[#78766F]">{subtitleOf(entry)}</span>
          </span>
        </button>
        <Get entry={entry} install={install} />
      </div>
    </motion.div>
  );
}

/** A ranked row, the App Store top chart: icon, rank, name and category, Get. */
function RankRow({ entry, rank, onChoose, install, index }: { entry: TemplateManifest; rank?: number; onChoose: (entry: TemplateManifest) => void; install: InstallApi; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.03, ease: EASE }}
      className="group flex min-w-0 items-center gap-3 rounded-[12px] border-b border-black/[0.07] px-1.5 transition-colors duration-150 hover:bg-[rgba(55,53,47,0.05)] last:border-transparent"
    >
      <button type="button" aria-label={`View ${entry.name} details`} onClick={() => onChoose(entry)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45">
        <AppIcon entry={entry} size={56} />
        {rank ? <span className="w-5 shrink-0 text-[16px] font-semibold tabular-nums text-[#2C2C2B]">{rank}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium tracking-[-0.012em] text-[#2C2C2B]">{entry.name}</span>
          <span className="block truncate text-[12.5px] text-[#78766F]">{subtitleOf(entry)}</span>
        </span>
      </button>
      <span className="flex shrink-0 flex-col items-center gap-1">
        <Get entry={entry} install={install} />
        <span className="text-[9.5px] leading-none text-[#A19E99]">{entry.licenseSpdxOrReview && entry.licenseSpdxOrReview.length < 14 ? entry.licenseSpdxOrReview : "Open source"}</span>
      </span>
    </motion.div>
  );
}

function SectionHeader({ title, subtitle, onSeeAll, rail }: { title: string; subtitle?: string; onSeeAll?: () => void; rail?: RefObject<HTMLDivElement | null> }) {
  const scrollBy = (dir: number) => rail?.current?.scrollBy({ left: dir * (rail.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <div className="mb-3 flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-[18px] font-semibold tracking-[-0.018em] text-[#2C2C2B]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[13px] text-[#78766F]">{subtitle}</p> : null}
      </div>
      {onSeeAll ? <button type="button" onClick={onSeeAll} className="mb-0.5 rounded-[6px] px-1 text-[13px] font-medium text-[#3977F6] transition-opacity hover:opacity-70">See All</button> : null}
      {rail ? (
        <div className="mb-0.5 hidden gap-1.5 sm:flex">
          <button type="button" aria-label={`Scroll ${title} left`} onClick={() => scrollBy(-1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(55,53,47,0.06)] text-[#2C2C2B]/70 transition-colors hover:bg-[rgba(55,53,47,0.1)]"><ChevronRight className="h-4 w-4 rotate-180" /></button>
          <button type="button" aria-label={`Scroll ${title} right`} onClick={() => scrollBy(1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(55,53,47,0.06)] text-[#2C2C2B]/70 transition-colors hover:bg-[rgba(55,53,47,0.1)]"><ChevronRight className="h-4 w-4" /></button>
        </div>
      ) : null}
    </div>
  );
}

function Shelf({ title, subtitle, entries, onChoose, install, onSeeAll }: { title: string; subtitle?: string; entries: TemplateManifest[]; onChoose: (entry: TemplateManifest) => void; install: InstallApi; onSeeAll?: () => void }) {
  const rail = useRef<HTMLDivElement | null>(null);
  return (
    <section aria-label={title} className="mb-9 border-t border-[rgba(55,53,47,0.09)] pt-5">
      <SectionHeader title={title} subtitle={subtitle} onSeeAll={onSeeAll} rail={rail} />
      <div ref={rail} className="-mx-2 flex snap-x scroll-px-2 gap-5 overflow-x-auto px-2 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry, index) => <SourceCard key={entry.id} entry={entry} onChoose={onChoose} install={install} index={index} wide />)}
      </div>
    </section>
  );
}

/**
 * App Store-style ranked chart directly beneath the editorial Featured hero.
 * Three compact rows per column, with smooth horizontal scrolling and real
 * per-source Get/Details actions. Uncaptured apps use icons, not fake UI art.
 */
function FeaturedApps({
  entries, onChoose, install,
}: {
  entries: TemplateManifest[];
  onChoose: (entry: TemplateManifest) => void;
  install: InstallApi;
}) {
  const rail = useRef<HTMLDivElement | null>(null);
  if (!entries.length) return null;
  return (
    <section aria-label="Featured Apps" className="mb-9 border-t border-black/[0.07] pt-5">
      <SectionHeader title="Featured Apps" subtitle="Our picks · coding agents, video tools and creative software" rail={rail} />
      <div ref={rail} className="-mx-2 grid snap-x grid-flow-col grid-rows-3 auto-cols-[minmax(260px,87%)] gap-x-5 gap-y-1 overflow-x-auto px-2 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:auto-cols-[minmax(280px,48%)] lg:auto-cols-[minmax(295px,32%)]">
        {entries.map((entry, index) => (
          <div key={entry.id} className="min-w-0 snap-start">
            <RankRow entry={entry} onChoose={onChoose} install={install} index={index} />
          </div>
        ))}
      </div>
      <p className="mt-1 px-1 text-[11px] text-[#898780]">Open-source alternatives, not exact commercial clones. Get downloads source; native apps and AI providers may require additional setup.</p>
    </section>
  );
}

/** A template card as in Notes' gallery: a 4:3 preview, the name and a two-line description; the action appears on hover. */
function NoteCard({ entry, onChoose, install, index = 0 }: { entry: TemplateManifest; onChoose: (entry: TemplateManifest) => void; install: InstallApi; index?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.03, ease: EASE }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-[rgba(55,53,47,0.09)] bg-white text-left transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-[rgba(55,53,47,0.24)] hover:shadow-[0_6px_20px_rgba(15,15,15,0.08)]"
    >
      <div className="relative aspect-[4/3] border-b border-[rgba(55,53,47,0.09)] bg-[#F7F6F5]">
        <button type="button" aria-label={`View ${entry.name} details`} onClick={() => onChoose(entry)}
          className="absolute inset-0 block h-full w-full cursor-pointer overflow-hidden text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3977F6]/55">
          <SourceVisual entry={entry} className="absolute inset-0" iconSize={56} />
        </button>
        <span className="absolute bottom-3 right-3 z-10 translate-y-2 opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
          <Get entry={entry} install={install} />
        </span>
      </div>
      <button type="button" aria-label={`View ${entry.name} details`} onClick={() => onChoose(entry)}
        className="flex min-w-0 flex-col gap-[3px] px-3.5 pb-3.5 pt-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3977F6]/55">
        <span className="truncate text-[14px] font-semibold leading-[1.3] text-[#2C2C2B]">{entry.name}</span>
        <span className="line-clamp-2 text-[12.5px] leading-[1.45] text-[#5F5E59]">{entry.description}</span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {entry.stack.slice(0, 3).map((item) => <span key={item} className="rounded-[5px] bg-[rgba(55,53,47,0.06)] px-1.5 py-[1px] text-[11px] text-[#5F5E59]">{item}</span>)}
        </span>
      </button>
    </motion.div>
  );
}

/** The editorial hero, like the App Store's featured story: colour-washed art, the app's icon set large, a lockup. */
function Spotlight({ entries, onChoose, install, related }: { entries: TemplateManifest[]; onChoose: (entry: TemplateManifest) => void; install: InstallApi; related: (entry: TemplateManifest) => TemplateManifest[] }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || reduce || entries.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % entries.length), 7000);
    return () => window.clearInterval(timer);
  }, [paused, reduce, entries.length]);
  const entry = entries[index % Math.max(1, entries.length)];
  if (!entry) return null;
  const meta = categoryMeta(entry.category);
  void related;
  return (
    <section aria-label="Featured" className="mb-9" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div
        className="group relative grid w-full overflow-hidden rounded-[12px] bg-[#F7F6F5] text-left ring-1 ring-inset ring-[rgba(55,53,47,0.09)] transition-colors duration-150 hover:ring-[rgba(55,53,47,0.2)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
      >
        <button type="button" aria-label={`View featured ${entry.name} details`}
          onClick={() => onChoose(entry)}
          className="absolute inset-0 z-[1] cursor-pointer rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3977F6]/55" />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`t-${entry.id}`} className="pointer-events-none relative z-[2] flex min-w-0 flex-col justify-center gap-1 p-6 sm:p-7" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
            <p className="text-[12px] font-medium" style={{ color: meta.accent }}>Featured · {entry.category}</p>
            <h3 className="line-clamp-2 text-[26px] font-semibold leading-[1.12] tracking-[-0.028em] text-[#2C2C2B]">{entry.name}</h3>
            <p className="mt-1 line-clamp-2 max-w-[420px] text-[14px] leading-[1.5] text-[#5F5E59]">{entry.description}</p>
            <div className="mt-4 flex items-center gap-3">
              <AppIcon entry={entry} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-[#2C2C2B]">{entry.name}</span>
                <span className="block truncate text-[12.5px] text-[#78766F]">{subtitleOf(entry)}</span>
              </span>
              <span className="pointer-events-auto"><Get entry={entry} install={install} /></span>
            </div>
          </motion.div>
        </AnimatePresence>
        <div className="pointer-events-none relative hidden min-h-[210px] sm:block" aria-hidden>
          <AnimatePresence initial={false}>
            <motion.div key={`art-${entry.id}`} className="absolute inset-0" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }}>
              <SourceVisual entry={entry} className="h-full w-full" iconSize={72} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-center gap-3">
        <button type="button" aria-label="Previous featured app" disabled={entries.length < 2}
          onClick={() => { setPaused(true); setIndex((current) => (current - 1 + entries.length) % entries.length); }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#78766F] transition-colors hover:bg-black/[0.05] hover:text-[#2C2C2B] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45">
          <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
        </button>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Featured apps">
          {entries.map((item, i) => <button key={item.id} type="button" role="tab" aria-selected={i === index} aria-label={`Show ${item.name}`} onClick={() => { setPaused(true); setIndex(i); }} className={cn("h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-[#2C2C2B]/70" : "w-1.5 bg-[rgba(55,53,47,0.16)] hover:bg-[rgba(55,53,47,0.3)]")} />)}
        </div>
        <button type="button" aria-label="Next featured app" disabled={entries.length < 2}
          onClick={() => { setPaused(true); setIndex((current) => (current + 1) % entries.length); }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#78766F] transition-colors hover:bg-black/[0.05] hover:text-[#2C2C2B] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────── the library ───────────────────────── */

type View = "discover" | "installed";

export function TemplateLibrary({
  open,
  projectId,
  onClose,
  onImported,
  onAskClyra,
  onOpenInstalled,
  existingProjectIds,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onImported: (projectId: string) => void;
  onAskClyra: (entry: TemplateManifest) => void;
  /** Open an installed app in Clyra Code: select it, start the dev server, and start the setup chat. */
  onOpenInstalled?: (projectId: string, entry: TemplateManifest) => void;
  /** Projects that still exist, used to drop installs whose project was deleted. */
  existingProjectIds?: string[];
}) {
  const reduce = useReducedMotion();
  useNativeOcclusion(open);
  const [view, setView] = useState<View>("discover");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [landingKind, setLandingKind] = useState("All");
  const [entries, setEntries] = useState<TemplateManifest[]>([]);
  const [catalogue, setCatalogue] = useState<TemplateManifest[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TemplateManifest | null>(null);
  const [plan, setPlan] = useState<TemplateImportPlan | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mode, setMode] = useState<TemplateImportMode>("clean-derived-project");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ projectId: string; message: string; sourcePath: string } | null>(null);
  const [installedMap, setInstalledMap] = useState<Record<string, InstallRecord>>(() => readInstalled());
  const [phases, setPhases] = useState<Record<string, InstallPhase>>({});
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [justInstalled, setJustInstalled] = useState<TemplateManifest | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const selectedChoice = useMemo(() => IMPORT_CHOICES.find((choice) => choice.id === mode) ?? IMPORT_CHOICES[0], [mode]);
  const needsCurrentProject = mode === "integrate-existing-project" || mode === "dependency-source";
  const filtering = Boolean(query.trim() || category);
  const isHome = view === "discover" && !filtering;

  // Drop installs whose project no longer exists, so "Open" never leads nowhere.
  const liveInstalled = useMemo(() => {
    if (!existingProjectIds || !existingProjectIds.length) return installedMap;
    const alive = new Set(existingProjectIds);
    return Object.fromEntries(Object.entries(installedMap).filter(([, record]) => alive.has(record.projectId)));
  }, [installedMap, existingProjectIds]);

  const spotlight = useMemo(() => {
    // Lead with genuine upstream screenshots when any exist. Showing five
    // identical missing-preview cards as the editorial hero looks broken and
    // implies we reviewed apps we have not actually run.
    const photographed = catalogue.filter((entry) => entry.sourceScreenshots.length > 0);
    if (photographed.length) {
      // Prefer genuine full-app pages over first-run setup forms, then use
      // number of distinct captures as a grounded tie-breaker.
      const actualScreens = (entry: TemplateManifest) => entry.sourceScreenshots
        .filter((shot) => !/setup|first.run|onboarding/i.test(shot.alt)).length;
      const established = photographed.filter((entry) => entry.category !== "Landing Pages")
        .sort((x, y) => actualScreens(y) - actualScreens(x) || x.name.localeCompare(y.name));
      const landing = interleaveLandingIndustries(photographed.filter((entry) => entry.category === "Landing Pages"));
      return [...established.slice(0, 2), ...landing.slice(0, 3)].slice(0, 5);
    }
    // For a brand-new catalogue with no captures, preserve category variety
    // and clearly mark its source-only previews as unavailable.
    const picked: TemplateManifest[] = [];
    const seen = new Set<string>();
    for (const entry of catalogue) {
      if (seen.has(entry.category)) continue;
      seen.add(entry.category);
      picked.push(entry);
      if (picked.length === 5) break;
    }
    return picked;
  }, [catalogue]);
  const shelves = useMemo(() => {
    const groups = new globalThis.Map<string, TemplateManifest[]>();
    for (const entry of catalogue) groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
    return [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  }, [catalogue]);
  const topPicks = useMemo(() => {
    const byId = new globalThis.Map(catalogue.map((entry) => [entry.id, entry]));
    return FEATURED_APP_IDS.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  }, [catalogue]);
  const installedEntries = useMemo(() => catalogue.filter((entry) => liveInstalled[entry.id]), [catalogue, liveInstalled]);
  const landingPreviews = useMemo(() => interleaveLandingIndustries(catalogue.filter((entry) => entry.category === "Landing Pages" && entry.sourceScreenshots.length > 0)), [catalogue]);
  const landingKinds = useMemo(() => [...new Set(entries.filter((entry) => entry.category === "Landing Pages")
    .map((entry) => entry.landingPageType).filter((kind): kind is string => Boolean(kind)))].sort(), [entries]);
  const visibleEntries = useMemo(() => category === "Landing Pages"
    ? landingKind === "All" ? interleaveLandingIndustries(entries) : entries.filter((entry) => entry.landingPageType === landingKind)
    : entries, [category, entries, landingKind]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.templateLibrary({ q: query, category: category || undefined, offset: 0, limit: 250 });
      setEntries(result.entries);
      setCategories(result.categories);
      setTotal(result.total);
      if (!query.trim() && !category) setCatalogue(result.entries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [query, category]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(); }, 120);
    return () => window.clearTimeout(timer);
  }, [open, load]);

  // The full catalogue is needed for the Installed view even when the user opens straight into a filter.
  useEffect(() => {
    if (!open || catalogue.length) return;
    void api.templateLibrary({ offset: 0, limit: 250 }).then((result) => { setCatalogue(result.entries); setCategories(result.categories); }).catch(() => undefined);
  }, [open, catalogue.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (justInstalled) setJustInstalled(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open, justInstalled]);

  useEffect(() => {
    if (!open) return;
    const reset = () => contentRef.current?.scrollTo({ top: 0 });
    reset();
    const frame = window.requestAnimationFrame(reset);
    const settle = window.setTimeout(reset, 80);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [open, selected?.id, view, category]);

  const choose = (entry: TemplateManifest) => {
    setSelected(entry);
    setPlan(null);
    setMode(entry.mode === "reference-only" ? "isolated-sandbox" : "clean-derived-project");
    setImportError(null);
    setImportResult(null);
  };

  /** One-tap install: verify the pinned revision, then download the source into its own project. */
  const get = useCallback(async (entry: TemplateManifest) => {
    if (phases[entry.id]) return;
    setInstallErrors((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    setPhases((current) => ({ ...current, [entry.id]: "verifying" }));
    try {
      await api.templateImportPlan(entry.id);
      setPhases((current) => ({ ...current, [entry.id]: "downloading" }));
      const result = await api.importTemplateSource(entry.id, { mode: entry.mode === "reference-only" ? "isolated-sandbox" : "clean-derived-project", confirmed: true });
      // Let the ring close before the button turns back into a pill that reads Open.
      setPhases((current) => ({ ...current, [entry.id]: "finishing" }));
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      setInstalledMap((current) => {
        const next = { ...current, [entry.id]: { projectId: result.project.id, at: Date.now() } };
        writeInstalled(next);
        return next;
      });
      setJustInstalled(entry);
    } catch (reason) {
      setInstallErrors((current) => ({ ...current, [entry.id]: reason instanceof Error ? reason.message : "The download failed." }));
    } finally {
      setPhases((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    }
  }, [phases]);

  useEffect(() => {
    if (!justInstalled) return;
    const timer = window.setTimeout(() => setJustInstalled(null), 9000);
    return () => window.clearTimeout(timer);
  }, [justInstalled]);

  const openInstalled = useCallback((entry: TemplateManifest) => {
    const record = installedMap[entry.id];
    if (!record) return;
    setJustInstalled(null);
    onOpenInstalled?.(record.projectId, entry);
  }, [installedMap, onOpenInstalled]);

  const install: InstallApi = {
    phase: (id) => phases[id],
    installed: (id) => Boolean(liveInstalled[id]),
    error: (id) => installErrors[id],
    get: (entry) => void get(entry),
    open: openInstalled,
  };

  const inspect = async () => {
    if (!selected || inspecting) return;
    setInspecting(true);
    setImportError(null);
    try {
      setPlan(await api.templateImportPlan(selected.id));
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "The repository could not be verified.");
    } finally {
      setInspecting(false);
    }
  };

  const importSource = async () => {
    if (!selected || !plan || importing || (needsCurrentProject && !projectId)) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await api.importTemplateSource(selected.id, { mode, projectId, confirmed: true });
      setImportResult({ projectId: result.project.id, message: result.message, sourcePath: result.sourcePath });
      onImported(result.project.id);
    } catch (reason) {
      setImportError(reason instanceof Error ? reason.message : "The source checkout could not be imported.");
    } finally {
      setImporting(false);
    }
  };

  const copyClone = async () => {
    if (!selected) return;
    await navigator.clipboard?.writeText(`git clone ${selected.repositoryUrl}.git`).catch(() => undefined);
  };

  const goHome = () => { setView("discover"); setCategory(""); setQuery(""); setLandingKind("All"); setSelected(null); };
  const goCategory = (name: string) => { setView("discover"); setCategory(name); setQuery(""); setLandingKind("All"); setSelected(null); };

  if (!open) return null;

  const navButton = (active: boolean) => cn("group relative isolate flex h-[32px] w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#3977F6]/40", active ? "font-medium text-[#2C2C2B]" : "text-[#2C2C2B]/85 hover:bg-black/[0.04]");
  const highlight = <motion.span layoutId={reduce ? undefined : "lib-nav-highlight"} aria-hidden transition={{ duration: 0.24, ease: EASE }} className="absolute inset-0 -z-10 rounded-[8px] bg-black/[0.075]" />;
  const glyph = (Icon: CategoryMeta["icon"]) => <Icon className="h-[16px] w-[16px] shrink-0 text-[#3977F6]" />;
  const canGoBack = Boolean(selected || category || query.trim() || view === "installed");
  const goBack = () => { if (selected) setSelected(null); else goHome(); };
  const pageTitle = category || (query.trim() ? "Results" : "Discover");
  const related = (entry: TemplateManifest) => {
    const same = catalogue.filter((item) => item.category === entry.category && item.id !== entry.id);
    return same.length >= 2 ? same : [...same, ...catalogue.filter((item) => item.category !== entry.category)].slice(0, 2);
  };
  const searchField = (
    <label className="relative block w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8A8884]" />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setView("discover"); setSelected(null); }} placeholder="Search" aria-label="Search the library" className="h-[30px] w-full rounded-[8px] border border-transparent bg-black/[0.055] pl-8 pr-3 text-[13px] text-[#2C2C2B] outline-none placeholder:text-[#8A8884] transition-[background-color,border-color,box-shadow] duration-150 focus:border-[#3977F6]/50 focus:bg-white focus:ring-[3px] focus:ring-[#3977F6]/[0.16]" />
    </label>
  );
  const bigShelves = shelves.filter(([, list]) => list.length >= 3);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
      className="absolute inset-0 z-[90] flex overflow-hidden bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Clyra Library"
    >
      <aside className="hidden min-h-0 w-[232px] shrink-0 flex-col border-r border-black/[0.07] bg-[#F7F6F5]/95 px-2.5 pb-3 pt-3.5 backdrop-blur-xl md:flex">
        <div className="mb-3 px-1">{searchField}</div>

        <nav aria-label="Library sections" className="cc-scroll min-h-0 flex-1 space-y-px overflow-y-auto pr-0.5">
          <button type="button" onClick={goHome} aria-current={isHome ? "page" : undefined} className={navButton(isHome)}>
            {isHome ? highlight : null}
            {glyph(Sparkles)}
            Discover
          </button>
          <button type="button" onClick={() => { setView("installed"); setSelected(null); setCategory(""); setQuery(""); }} aria-current={view === "installed" ? "page" : undefined} className={navButton(view === "installed")}>
            {view === "installed" ? highlight : null}
            {glyph(Download)}
            Installed
            {installedEntries.length ? <span className="ml-auto rounded-full bg-[#3977F6] px-1.5 text-[10.5px] font-semibold leading-[16px] tabular-nums text-white">{installedEntries.length}</span> : null}
          </button>

          <p className="px-2 pb-1 pt-4 text-[11px] font-semibold text-[#8A8884]">Categories</p>
          {categories.map((item) => {
            const active = view === "discover" && category === item;
            return (
              <button key={item} type="button" onClick={() => goCategory(item)} aria-current={active ? "page" : undefined} className={navButton(active)}>
                {active ? highlight : null}
                {glyph(categoryMeta(item).icon)}
                <span className="min-w-0 flex-1 truncate">{item}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-white">
        <header className="absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-2 bg-white/80 px-3 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_75%,transparent)] md:px-5">
          <AnimatePresence initial={false}>
            {canGoBack ? (
              <motion.button key="back" type="button" onClick={goBack} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.2, ease: EASE }}
                className="flex h-8 items-center gap-1 rounded-[8px] pl-1.5 pr-2.5 text-[13.5px] font-medium text-[#3977F6] transition-colors hover:bg-[#3977F6]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/35">
                <ChevronRight className="h-[18px] w-[18px] rotate-180" strokeWidth={2.2} />{selected ? (category || (view === "installed" ? "Installed" : "Discover")) : "Discover"}
              </motion.button>
            ) : null}
          </AnimatePresence>
          <div className="min-w-0 flex-1 md:hidden">{selected ? null : searchField}</div>
          <span className="hidden flex-1 md:block" />
          <button type="button" aria-label="Close library" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#2C2C2B]/60 transition-colors hover:bg-black/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/35"><X className="h-4 w-4" /></button>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key={`detail-${selected.id}`} ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: EASE }} className="cc-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-[68px] md:px-10">
              <div className="mx-auto max-w-[940px]">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  {selected.category !== "Landing Pages" ? <AppIcon entry={selected} size={128} lifted /> : null}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.028em] text-[#2C2C2B] md:text-[28px]">{selected.name}</h2>
                    <p className="mt-0.5 text-[15px] text-[#78766F]">{subtitleOf(selected)}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2.5">
                      <Get entry={selected} install={install} large />
                      {selected.livePreviewUrl ? (
                        <a href={selected.livePreviewUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex h-[32px] items-center gap-1.5 rounded-full bg-[#3977F6]/[0.07] px-3.5 text-[13px] font-medium text-[#3977F6] transition-colors hover:bg-[#3977F6]/[0.13]">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Live demo
                        </a>
                      ) : null}
                      <button type="button" onClick={() => { onAskClyra(selected); onClose(); }} className="inline-flex h-[32px] items-center gap-1.5 rounded-full bg-[rgba(55,53,47,0.06)] px-3.5 text-[13px] font-semibold text-[#3977F6] transition-colors hover:bg-[rgba(55,53,47,0.1)]"><Sparkles className="h-3.5 w-3.5" /> Ask Clyra</button>
                      <a href={selected.repositoryUrl} target="_blank" rel="noreferrer" aria-label="View source on GitHub" title="View source on GitHub" className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[rgba(55,53,47,0.06)] text-[#3977F6] transition-colors hover:bg-[rgba(55,53,47,0.1)]"><ExternalLink className="h-4 w-4" /></a>
                    </div>
                    {install.error(selected.id) ? <p role="alert" className="mt-2 text-[12px] text-[#C0392B]">{install.error(selected.id)}</p> : null}
                    {selected.requiredSecrets.length ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-[#E5E2DB] bg-[#FAF9F7] px-3 py-2.5" role="note">
                        <CircleAlert className="h-4 w-4 shrink-0 text-[#7F7B72]" aria-hidden />
                        <div className="min-w-[190px] flex-1">
                          <p className="text-[12px] font-medium text-[#393832]">AI provider setup may be required</p>
                          <p className="text-[11px] leading-[1.5] text-[#78766F]">Review upstream configuration. Clyra's model key is never inserted into downloaded source.</p>
                        </div>
                        <button type="button" onClick={() => { onAskClyra(selected); onClose(); }}
                          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-[#3977F6] hover:bg-[#3977F6]/[0.06]">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Review AI setup
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="cc-scroll mt-7 flex overflow-x-auto border-y border-black/[0.08] py-3.5 [scrollbar-width:none]">
                  {[
                    { k: "License", v: selected.licenseSpdxOrReview, s: "Open source" },
                    { k: "Category", v: selected.category, s: modeLabel(selected) },
                    { k: "Runs on", v: selected.supportedTargets[0] || "—", s: selected.supportedTargets.length > 1 ? `+${selected.supportedTargets.length - 1} more` : "Target" },
                    { k: "Stack", v: selected.stack[0] || "—", s: selected.stack[1] || "Primary" },
                    { k: "Status", v: statusLabel(selected), s: "Clyra check" },
                  ].map((cell, i) => (
                    <div key={cell.k} className={cn("min-w-[132px] flex-1 px-4 text-center", i && "border-l border-black/[0.08]")}>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#A19E99]">{cell.k}</p>
                      <p className="mt-1 truncate text-[17px] font-bold tracking-[-0.02em] text-[#5F5E59]" title={cell.v}>{cell.v}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[#A19E99]">{cell.s}</p>
                    </div>
                  ))}
                </div>

                <section className="mt-7">
                  <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#2C2C2B]">Preview</h3>
                  <div className="cc-scroll mt-3 flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
                    <div className="w-[min(640px,88%)] shrink-0 snap-start overflow-hidden rounded-[16px] ring-1 ring-inset ring-black/[0.06]"><SourceVisual entry={selected} className="aspect-[16/10] w-full" iconSize={110} /></div>
                    {selected.sourceScreenshots.slice(1).map((shot) => <figure key={shot.url} className="w-[min(640px,88%)] shrink-0 snap-start overflow-hidden rounded-[16px] ring-1 ring-inset ring-black/[0.06]"><img src={shot.url} alt={shot.alt} loading="lazy" className="aspect-[16/10] w-full object-cover" /></figure>)}
                  </div>
                  {selected.sourceScreenshots.length ? null : <p className="mt-1.5 text-[12px] text-[#78766F]">No verified screenshots yet. Importing source does not guarantee the upstream app can run here.</p>}
                  {selected.captureProvenance ? <p className="mt-1.5 max-w-[690px] text-[11.5px] leading-relaxed text-[#898780]">{selected.captureProvenance}</p> : null}
                </section>

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <p className="max-w-[720px] text-[15px] leading-[1.6] text-[#2C2C2B]/85">{selected.description}</p>
                  {coverCapabilities(selected).length ? <ul className="mt-3 space-y-1.5 text-[14px] text-[#4A4944]">{coverCapabilities(selected).map((cap) => <li key={cap} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#78766F]" />{cap}</li>)}</ul> : null}
                </section>

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#2C2C2B]">What happens when you open it</h3>
                  <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { t: "Downloads the source", d: "Get pulls the pinned revision from GitHub into its own Clyra project." },
                      { t: "Review setup", d: "Open enters Clyra Code. Dependencies, credentials and services may still be needed before a live preview can start." },
                      { t: "Build and customise", d: "Review the upstream licence and choose setup commands before asking Clyra to customise the source." },
                    ].map((step, i) => (
                      <li key={step.t} className="rounded-[14px] bg-[#F7F6F5] p-4">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#3977F6] text-[12px] font-semibold text-white">{i + 1}</span>
                        <p className="mt-2.5 text-[14px] font-semibold text-[#2C2C2B]">{step.t}</p>
                        <p className="mt-1 text-[12.5px] leading-[1.5] text-[#5F5E59]">{step.d}</p>
                      </li>
                    ))}
                  </ol>
                  {selected.compatibility.length ? <ul className="mt-4 grid gap-2 text-[13px] leading-[1.5] text-[#4A4944] sm:grid-cols-2">{selected.compatibility.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />{item}</li>)}</ul> : null}
                </section>

                {related(selected).length ? (
                  <section className="mt-8 border-t border-black/[0.08] pt-5">
                    <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#2C2C2B]">You might also like</h3>
                    <div className="mt-2 grid grid-cols-1 gap-x-8 md:grid-cols-2">{related(selected).slice(0, 4).map((entry, index) => <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />)}</div>
                  </section>
                ) : null}

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#2C2C2B]">Information</h3>
                  <dl className="mt-3 grid gap-x-8 text-[13px] sm:grid-cols-2">
                    {[
                      ["Source", repoSlug(selected)],
                      ["Category", selected.category],
                      ["License", selected.licenseSpdxOrReview],
                      ["Stack", selected.stack.join(", ") || "See repository"],
                      ["Build footprint", selected.estimatedBuildFootprint || "—"],
                      ["Runs on", selected.supportedTargets.join(", ") || "—"],
                    ].map(([k, v]) => <div key={k} className="border-b border-black/[0.07] py-2.5"><dt className="text-[12px] text-[#78766F]">{k}</dt><dd className="mt-0.5 break-words text-[#2C2C2B]">{v}</dd></div>)}
                  </dl>
                  <p className="mt-3 max-w-[680px] text-[12px] leading-[1.6] text-[#78766F]">{selected.attribution}</p>
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copyClone()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[rgba(55,53,47,0.06)] px-3.5 text-[12px] font-medium text-[#3977F6] transition-colors hover:bg-[rgba(55,53,47,0.1)]"><Copy className="h-3 w-3" /> Copy clone command</button></div>
                </section>

                <details className="group mt-7 rounded-[14px] bg-[#F7F6F5]">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium text-[#4A4944] marker:content-none"><ChevronRight className="h-4 w-4 text-[#A19E99] transition-transform group-open:rotate-90" />Advanced import options</summary>
                  <div className="border-t border-black/[0.06] px-4 pb-4 pt-3">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white text-[#526B7E]"><FileSearch className="h-3.5 w-3.5" /></span><p className="text-[12.5px] font-medium text-[#33353A]">Inspect, then choose how to import</p></div>
                    {!plan ? <button type="button" disabled={inspecting} onClick={() => void inspect()} className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#2C2C2B] px-4 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50">{inspecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}{inspecting ? "Verifying source…" : "Verify repository"}</button> : <>
                      <div className="mt-3 rounded-[10px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[11.5px] leading-[1.5] text-[#477757]"><span className="font-medium">Resolved {formatCommit(plan.verification.commit)}</span><br />{new Date(plan.verification.verifiedAt).toLocaleString()}</div>
                      <label className="mt-3 block max-w-[360px] text-[11.5px] font-medium text-[#66696F]">Import mode<select value={mode} onChange={(event) => setMode(event.target.value as TemplateImportMode)} className="mt-1.5 h-9 w-full rounded-[8px] border border-black/[0.1] bg-white px-2 text-[12px] text-[#414349] outline-none focus:border-[#3977F6]/45">{IMPORT_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}</select></label>
                      <p className="mt-2 text-[11.5px] leading-[1.45] text-[#85878C]">{selectedChoice.detail}</p>
                      {needsCurrentProject && !projectId ? <p className="mt-3 flex gap-1.5 text-[11.5px] leading-[1.45] text-[#B36A3E]"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />Open a Clyra project first to use this mode.</p> : null}
                      <button type="button" disabled={importing || (needsCurrentProject && !projectId)} onClick={() => void importSource()} className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#2C2C2B] px-4 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45">{importing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{importing ? "Downloading pinned source…" : "Confirm and download source"}</button>
                    </>}
                    {importError ? <p role="alert" className="mt-3 text-[11.5px] leading-[1.45] text-[#C04B4B]">{importError}</p> : null}
                    {importResult ? <div className="mt-3 rounded-[9px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[11.5px] leading-[1.5] text-[#477757]"><span className="font-medium">Source checkout complete</span><br />{importResult.message}<br /><span className="font-mono text-[10px]">{importResult.sourcePath}</span></div> : null}
                    <ul className="mt-3 space-y-1.5 text-[11px] leading-[1.45] text-[#909297]">{plan?.warnings.slice(0, 3).map((warning) => <li key={warning}>• {warning}</li>) ?? <li>• Verify the source revision, notices, requirements and build commands.</li>}</ul>
                  </div>
                </details>
              </div>
            </motion.div>
          ) : view === "installed" ? (
            <motion.div key="installed" ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="cc-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-[64px] md:px-10">
              <div className="mx-auto max-w-[1120px]">
                <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-[#2C2C2B]">Installed</h2>
                <p className="mt-1 text-[14px] text-[#78766F]">Apps you’ve downloaded. Open one to review its setup in Clyra Code and start changing it.</p>
                {installedEntries.length ? (
                  <div className="mt-5 grid grid-cols-1 gap-x-8 md:grid-cols-2 xl:grid-cols-3">
                    {installedEntries.map((entry, index) => <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />)}
                  </div>
                ) : (
                  <div className="mt-16 flex flex-col items-center text-center">
                    <span className="rounded-[12px] flex h-16 w-16 items-center justify-center bg-[rgba(55,53,47,0.06)] text-[#3977F6]"><Download className="h-7 w-7" /></span>
                    <p className="mt-4 text-[17px] font-semibold text-[#2C2C2B]">Nothing installed yet</p>
                    <p className="mt-1 max-w-[320px] text-[13px] text-[#78766F]">Tap Get on any app in Discover and it will show up here.</p>
                    <button type="button" onClick={goHome} className="mt-4 h-[32px] rounded-full bg-[#3977F6] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#0068DB]">Browse apps</button>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key={`list-${category || "home"}`} ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="cc-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-[64px] md:px-10">
              <div className="mx-auto max-w-[1180px]">
                <div className="mb-5">
                  <h2 className="text-[26px] font-bold tracking-[-0.02em] text-[#2C2C2B]">{pageTitle}</h2>
                  {!isHome ? <p className="mt-1 text-[14px] text-[#78766F]">{category === "Landing Pages" ? `${total} designs across ${landingKinds.length} industries` : category ? `${total} ${total === 1 ? "app" : "apps"}` : `${total} ${total === 1 ? "result" : "results"} for “${query.trim()}”`}</p> : null}
                </div>
                <div className={cn("relative -mt-1 mb-6 md:hidden", category === "Landing Pages" && "hidden")}>
                  <div className="flex gap-2 overflow-x-auto pb-1 pr-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {[{ id: "", label: "All" }, ...categories.map((item) => ({ id: item, label: item }))].map((item) => (
                      <button key={item.id || "all"} type="button" onClick={() => goCategory(item.id)}
                        className={cn("h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-colors duration-200", category === item.id ? "bg-[#2C2C2B] text-white" : "bg-[rgba(55,53,47,0.06)] text-[#2C2C2B]/80 hover:bg-[rgba(55,53,47,0.1)]")}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                {category === "Landing Pages" && landingKinds.length > 0 ? (
                  <div className="mb-7" aria-label="Landing page business types">
                    {landingKind !== "All" ? <div className="mb-2 text-[12px] font-medium text-[#78766F]">{visibleEntries.length} {landingKind} designs</div> : null}
                    <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter landing pages by type">
                      {["All", ...landingKinds].map((kind) => (
                        <button key={kind} type="button" aria-pressed={landingKind === kind}
                          onClick={() => { setLandingKind(kind); contentRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}
                          className={cn("h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/45",
                            landingKind === kind ? "bg-[#2C2C2B] text-white" : "bg-black/[0.045] text-[#5F5E59] hover:bg-black/[0.09]")}>
                          {kind}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {loading && !entries.length ? <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <div key={index}><div className="cc-lib-shimmer aspect-[16/10] rounded-[14px]" /><div className="mt-3 flex items-center gap-3"><div className="cc-lib-shimmer rounded-[12px] h-[42px] w-[42px]" /><div className="flex-1 space-y-1.5"><div className="cc-lib-shimmer h-3 w-1/2 rounded" /><div className="cc-lib-shimmer h-2.5 w-1/3 rounded" /></div></div></div>)}</div> : null}
                {error ? <div role="alert" className="rounded-[14px] bg-[#FCEBEB] p-4 text-[13px] text-[#A43D3D]">{error}</div> : null}
                {!loading && !error && !entries.length ? <div className="rounded-[16px] bg-[#F7F6F5] p-10 text-center text-[13px] text-[#78766F]">No apps match. Try another search or category.</div> : null}
                {!error && entries.length && isHome ? (
                  <>
                    {spotlight.length ? <Spotlight entries={spotlight} onChoose={choose} install={install} related={related} /> : null}
                    <FeaturedApps entries={topPicks} onChoose={choose} install={install} />
                    {landingPreviews.length ? (
                      <section aria-label="Landing Pages" className="mb-9">
                        <SectionHeader title="Landing Pages"
                          subtitle={`${landingPreviews.length} designs · SaaS, apps, agencies and businesses`}
                          onSeeAll={() => goCategory("Landing Pages")} />
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {landingPreviews.slice(0, 8).map((entry, index) => (
                            <NoteCard key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />
                          ))}
                        </div>
                      </section>
                    ) : null}
                    <section aria-label="Templates with previews" className="mb-9">
                      <SectionHeader title="Templates with previews" subtitle="Locally captured previews of existing applications" />
                      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {entries.filter((entry) => entry.category !== "Landing Pages" && entry.sourceScreenshots.length > 0).slice(0, 8).map((entry, index) => (
                          <NoteCard key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />
                        ))}
                      </div>
                    </section>
                    <section aria-label="Source catalogue">
                      <SectionHeader title="Explore source projects" subtitle="Browse the open-source catalogue. Uncaptured sources are shown as lists, not invented screenshots." />
                      {shelves.map(([name, list]) => {
                        const uncaptured = list.filter((entry) => entry.sourceScreenshots.length === 0);
                        if (!uncaptured.length) return null;
                        return (
                          <section key={name} aria-label={name} className="mb-7 border-t border-black/[0.07] pt-5">
                            <SectionHeader title={name} subtitle={`${uncaptured.length} source ${uncaptured.length === 1 ? "project" : "projects"}`}
                              onSeeAll={() => goCategory(name)} />
                            <div className="grid grid-cols-1 gap-x-7 sm:grid-cols-2">
                              {uncaptured.slice(0, 4).map((entry, index) => (
                                <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </section>
                  </>
                ) : null}
                {!error && entries.length && !isHome ? (
                  <section aria-label="Apps">
                    {visibleEntries.some((entry) => entry.sourceScreenshots.length > 0) ? (
                      <div className="mb-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleEntries.filter((entry) => entry.sourceScreenshots.length > 0).map((entry, index) => (
                          <NoteCard key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />
                        ))}
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-x-7 sm:grid-cols-2">
                      {visibleEntries.filter((entry) => entry.sourceScreenshots.length === 0).map((entry, index) => (
                        <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* After a download the button already reads Open; this quiet toast offers the same jump without blocking browsing. */}
        <AnimatePresence>
          {justInstalled ? (
            <motion.div key={`ready-${justInstalled.id}`} role="status" aria-live="polite"
              className="absolute bottom-5 left-1/2 z-30 flex w-[min(440px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-[18px] bg-white/90 p-2.5 pr-3 shadow-[0_18px_50px_rgba(0,0,0,0.18),0_0_0_0.5px_rgba(0,0,0,0.08)] backdrop-blur-xl"
              initial={reduce ? false : { opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.32, ease: EASE }}>
              <span className="relative">
                <AppIcon entry={justInstalled} size={44} />
                <motion.span initial={reduce ? false : { scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.18, duration: 0.26, ease: EASE }} className="absolute -bottom-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#34C759] text-white ring-2 ring-white"><Check className="h-3 w-3" strokeWidth={3.2} /></motion.span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-[#2C2C2B]">{justInstalled.name} source downloaded</span>
                <span className="block truncate text-[12px] text-[#78766F]">Open it in Clyra Code to review the setup requirements.</span>
              </span>
              <button type="button" onClick={() => openInstalled(justInstalled)} className="h-[30px] shrink-0 rounded-full bg-[#3977F6] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#0068DB] active:scale-95">Open</button>
              <button type="button" aria-label="Dismiss" onClick={() => setJustInstalled(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8A8884] transition-colors hover:bg-black/[0.05]"><X className="h-3.5 w-3.5" /></button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </motion.div>
  );
}
