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
  Star,
  X,
} from "lucide-react";
import { api, type TemplateImportMode, type TemplateImportPlan, type TemplateManifest } from "./api";
import { TemplateRatingGlance, TemplateSampleInlineRating, TemplateScreenshotGallery, TemplateFeaturesAndRequirements, TemplateRatingsAndReviews } from "./TemplateDetailsSections";
import { cn } from "../../lib/utils";
import { useNativeOcclusion } from "../../lib/nativeOcclusion";

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

const PALETTE = [
  { accent: "#B45E40", tint: "#F9EAE5", panel: "#F5DDD4" },
  { accent: "#6B61B8", tint: "#ECEAFA", panel: "#DCD8F4" },
  { accent: "#B64265", tint: "#F9E8EE", panel: "#F4D4DF" },
  { accent: "#3977C9", tint: "#E7F0FC", panel: "#D2E4F8" },
  { accent: "#36866D", tint: "#E4F3EC", panel: "#CDE9DC" },
  { accent: "#A2673D", tint: "#F8EDE3", panel: "#F0DCC9" },
  { accent: "#3E857F", tint: "#E3F2F0", panel: "#CBE5E1" },
  { accent: "#8061B7", tint: "#EFEAFA", panel: "#DED3F1" },
  { accent: "#5676A6", tint: "#E8EEF8", panel: "#D4E0F2" },
  { accent: "#7D6C43", tint: "#F5F0E2", panel: "#EBE0C4" },
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
  if (/app|web|commerce|form|billing|crm|email|message|schedul/.test(c)) return AppWindow;
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

const BLUE = "#007AFF";

function subtitleOf(entry: TemplateManifest) {
  return entry.alternativeTo.length ? `Like ${entry.alternativeTo.slice(0, 2).join(" & ")}` : entry.category;
}

function coverBackground(entry: TemplateManifest) {
  const meta = categoryMeta(entry.category);
  return `radial-gradient(120% 95% at 88% 0%, ${meta.panel} 0%, transparent 62%), radial-gradient(90% 80% at 0% 100%, ${meta.tint} 0%, transparent 70%), linear-gradient(165deg, ${meta.tint} 0%, #FBFBFD 100%)`;
}

/** A soft, colour-washed backdrop made from the app's own icon (cheap: a tiny image, upscaled and blurred once). */
function IconWash({ entry, opacity = 0.5 }: { entry: TemplateManifest; opacity?: number }) {
  const [failed, setFailed] = useState(false);
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
      <div className={cn("relative isolate overflow-hidden bg-[#F5F5F7]", className)}>
        <img src={sourceCapture.url} alt={sourceCapture.alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setState("ready")} onError={() => setState("failed")}
          className={cn("absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]", state === "ready" ? "opacity-100" : "opacity-0")} />
        {state === "loading" ? <div className="cc-lib-shimmer absolute inset-0" aria-hidden /> : null}
      </div>
    );
  }
  return (
    <div className={cn("relative isolate overflow-hidden", className)} aria-hidden style={{ background: coverBackground(entry) }}>
      <IconWash entry={entry} opacity={0.42} />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
        <span className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:scale-[1.045]"><AppIcon entry={entry} size={iconSize} lifted /></span>
      </div>
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
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden", round ? "rounded-full" : "cc-squircle", lifted ? "shadow-[0_10px_28px_rgba(0,0,0,0.18),0_2px_6px_rgba(0,0,0,0.10),inset_0_0_0_0.5px_rgba(0,0,0,0.10)]" : "shadow-[0_1px_2px_rgba(0,0,0,0.10),inset_0_0_0_0.5px_rgba(0,0,0,0.10)]")}
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
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#E3E3E8" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={waiting ? "#AEAEB2" : BLUE} strokeWidth={stroke} strokeLinecap="round"
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
        backgroundColor: state === "progress" ? "rgba(240,240,245,0)" : state === "retry" ? "#FCEBEB" : inverted ? "rgba(255,255,255,0.92)" : "#F0F0F5",
      }}
      transition={reduce ? { duration: 0 } : { duration: 0.32, ease: EASE }}
      whileTap={state === "progress" ? undefined : { scale: 0.97 }}
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold tracking-[-0.01em] outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/45", large ? "text-[14px]" : "text-[13px]", state === "retry" ? "text-[#C0392B]" : "text-[#007AFF]", state !== "progress" && "hover:brightness-[0.97]")}
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
      role="button"
      tabIndex={0}
      aria-label={`${entry.name}, ${entry.category}`}
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.035, ease: EASE }}
      onClick={() => onChoose(entry)}
      onKeyDown={activate(() => onChoose(entry))}
      className={cn("group flex shrink-0 cursor-pointer flex-col rounded-[16px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/45 focus-visible:ring-offset-4", wide ? "w-[272px] snap-start sm:w-[296px]" : "w-full")}
    >
      <span className="relative block overflow-hidden rounded-[14px] ring-1 ring-inset ring-black/[0.05] transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_34px_rgba(0,0,0,0.10)] group-active:scale-[0.985]">
        <SourceVisual entry={entry} className="aspect-[16/10] w-full" iconSize={wide ? 66 : 70} />
      </span>
      <span className="mt-3 flex items-center gap-3 px-0.5">
        <AppIcon entry={entry} size={42} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold tracking-[-0.012em] text-[#1D1D1F]">{entry.name}</span>
          <span className="block truncate text-[12.5px] text-[#86868B]">{subtitleOf(entry)}</span>
          <TemplateSampleInlineRating entry={entry} />
        </span>
        <Get entry={entry} install={install} />
      </span>
    </motion.div>
  );
}

/** A ranked row, the App Store top chart: icon, rank, name and category, Get. */
function RankRow({ entry, rank, onChoose, install, index }: { entry: TemplateManifest; rank?: number; onChoose: (entry: TemplateManifest) => void; install: InstallApi; index: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={rank ? `${rank}. ${entry.name}` : entry.name}
      initial={reduce ? false : { opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 12) * 0.03, ease: EASE }}
      onClick={() => onChoose(entry)}
      onKeyDown={activate(() => onChoose(entry))}
      className="group flex cursor-pointer items-center gap-3 rounded-[12px] px-1.5 outline-none transition-colors duration-150 hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-[#007AFF]/45"
    >
      <span className="py-2.5"><AppIcon entry={entry} size={56} /></span>
      <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b border-black/[0.07] py-2.5 group-last:border-transparent">
        {rank ? <span className="w-5 shrink-0 text-[16px] font-semibold tabular-nums text-[#1D1D1F]">{rank}</span> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium tracking-[-0.012em] text-[#1D1D1F]">{entry.name}</span>
          <span className="block truncate text-[12.5px] text-[#86868B]">{subtitleOf(entry)}</span>
          <TemplateSampleInlineRating entry={entry} />
        </span>
        <span className="flex flex-col items-center gap-1">
          <Get entry={entry} install={install} />
          <span className="text-[9.5px] leading-none text-[#A1A1A6]">{entry.licenseSpdxOrReview && entry.licenseSpdxOrReview.length < 14 ? entry.licenseSpdxOrReview : "Open source"}</span>
        </span>
      </span>
    </motion.div>
  );
}

function SectionHeader({ title, subtitle, onSeeAll, rail }: { title: string; subtitle?: string; onSeeAll?: () => void; rail?: RefObject<HTMLDivElement | null> }) {
  const scrollBy = (dir: number) => rail?.current?.scrollBy({ left: dir * (rail.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <div className="mb-3 flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-[22px] font-bold tracking-[-0.025em] text-[#1D1D1F]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-[13px] text-[#86868B]">{subtitle}</p> : null}
      </div>
      {onSeeAll ? <button type="button" onClick={onSeeAll} className="mb-0.5 rounded-[6px] px-1 text-[13px] font-medium text-[#007AFF] transition-opacity hover:opacity-70">See All</button> : null}
      {rail ? (
        <div className="mb-0.5 hidden gap-1.5 sm:flex">
          <button type="button" aria-label={`Scroll ${title} left`} onClick={() => scrollBy(-1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F0F0F5] text-[#1D1D1F]/70 transition-colors hover:bg-[#E5E5EA]"><ChevronRight className="h-4 w-4 rotate-180" /></button>
          <button type="button" aria-label={`Scroll ${title} right`} onClick={() => scrollBy(1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F0F0F5] text-[#1D1D1F]/70 transition-colors hover:bg-[#E5E5EA]"><ChevronRight className="h-4 w-4" /></button>
        </div>
      ) : null}
    </div>
  );
}

function Shelf({ title, subtitle, entries, onChoose, install, onSeeAll }: { title: string; subtitle?: string; entries: TemplateManifest[]; onChoose: (entry: TemplateManifest) => void; install: InstallApi; onSeeAll?: () => void }) {
  const rail = useRef<HTMLDivElement | null>(null);
  return (
    <section aria-label={title} className="mb-10 border-t border-black/[0.07] pt-5">
      <SectionHeader title={title} subtitle={subtitle} onSeeAll={onSeeAll} rail={rail} />
      <div ref={rail} className="-mx-2 flex snap-x scroll-px-2 gap-5 overflow-x-auto px-2 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.map((entry, index) => <SourceCard key={entry.id} entry={entry} onChoose={onChoose} install={install} index={index} wide />)}
      </div>
    </section>
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
  const friends = related(entry).slice(0, 2);
  return (
    <section aria-label="Featured" className="mb-10" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Featured: ${entry.name}`}
        onClick={() => onChoose(entry)}
        onKeyDown={activate(() => onChoose(entry))}
        className="group relative isolate h-[330px] w-full cursor-pointer overflow-hidden rounded-[20px] text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none ring-1 ring-inset ring-black/[0.05] transition-shadow duration-300 hover:shadow-[0_18px_44px_rgba(0,0,0,0.10)] focus-visible:ring-2 focus-visible:ring-[#007AFF]/45"
      >
        <AnimatePresence initial={false}>
          <motion.div key={`bg-${entry.id}`} className="absolute inset-0 -z-10" style={{ background: coverBackground(entry) }} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, ease: EASE }}>
            <IconWash entry={entry} opacity={0.55} />
            <div className="absolute inset-0 bg-gradient-to-r from-white/70 via-white/25 to-transparent" />
          </motion.div>
        </AnimatePresence>
        <div className="grid h-full sm:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`t-${entry.id}`} className="flex min-w-0 flex-col justify-end p-6 sm:p-8" initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.36, ease: EASE }}>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: meta.accent }}>Featured · {entry.category}</p>
              <h3 className="mt-1.5 line-clamp-2 text-[34px] font-bold leading-[1.06] tracking-[-0.035em] text-[#1D1D1F]">{entry.name}</h3>
              <p className="mt-2 line-clamp-2 max-w-[440px] text-[14.5px] leading-[1.45] text-[#424245]">{entry.description}</p>
              <div className="mt-5 flex items-center gap-3 rounded-[16px] bg-white/70 p-2.5 pr-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] backdrop-blur-xl sm:max-w-[420px]">
                <AppIcon entry={entry} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[#1D1D1F]">{entry.name}</span>
                  <span className="block truncate text-[12px] text-[#6E6E73]">{subtitleOf(entry)}</span>
                  <TemplateSampleInlineRating entry={entry} />
                </span>
                <Get entry={entry} install={install} inverted />
              </div>
            </motion.div>
          </AnimatePresence>
          <div className="relative hidden sm:block" aria-hidden>
            <AnimatePresence initial={false}>
              <motion.div key={`art-${entry.id}`} className="absolute inset-0" initial={reduce ? false : { opacity: 0, scale: 0.985, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: EASE }}>
                {friends[0] ? <span className="absolute left-[8%] top-[18%] rotate-[-10deg] opacity-90 transition-transform duration-700 group-hover:rotate-[-13deg]"><AppIcon entry={friends[0]} size={70} lifted /></span> : null}
                {friends[1] ? <span className="absolute bottom-[14%] right-[10%] rotate-[9deg] opacity-90 transition-transform duration-700 group-hover:rotate-[12deg]"><AppIcon entry={friends[1]} size={62} lifted /></span> : null}
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-4deg] transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:rotate-0 group-hover:scale-[1.04]"><AppIcon entry={entry} size={148} lifted /></span>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-1.5" role="tablist" aria-label="Featured apps">
        {entries.map((item, i) => <button key={item.id} type="button" role="tab" aria-selected={i === index} aria-label={`Show ${item.name}`} onClick={() => setIndex(i)} className={cn("h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-[#1D1D1F]/80" : "w-1.5 bg-black/15 hover:bg-black/30")} />)}
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
  onInstalled,
  existingProjects,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onImported: (projectId: string) => void;
  onAskClyra: (entry: TemplateManifest) => void;
  /** Open an installed app in Clyra Code: select it, start the dev server, and start the setup chat. */
  onOpenInstalled?: (projectId: string, entry: TemplateManifest) => void;
  /** Refresh projects after a Git checkout completes. */
  onInstalled?: (projectId: string) => void;
  /** Persisted project metadata allows recovering installs on a different browser. */
  existingProjects?: Array<{ id: string; name: string; prompt?: string }>;
}) {
  const reduce = useReducedMotion();
  useNativeOcclusion(open);
  const [view, setView] = useState<View>("discover");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
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

  // Project checkouts, not browser localStorage, are the source of truth.
  // Retain a fresh download until the async project-list refresh completes.
  const liveInstalled = useMemo(() => {
    const alive = new Set((existingProjects ?? []).map((project) => project.id));
    const recovered: Record<string, InstallRecord> = {};
    for (const entry of catalogue) {
      const project = existingProjects?.find((candidate) =>
        candidate.prompt?.includes(`source checkout from ${entry.repositoryUrl} at `) &&
        candidate.name.startsWith(entry.name),
      );
      if (project) recovered[entry.id] = { projectId: project.id, at: 0 };
    }
    for (const [id, record] of Object.entries(installedMap)) {
      if (!existingProjects || alive.has(record.projectId) || Date.now() - record.at < 60_000) recovered[id] = record;
    }
    return recovered;
  }, [catalogue, installedMap, existingProjects]);

  const spotlight = useMemo(() => {
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
    const featured = new Set(spotlight.map((entry) => entry.id));
    return shelves.flatMap(([, list]) => list.filter((entry) => !featured.has(entry.id)).slice(0, 1)).slice(0, 9);
  }, [shelves, spotlight]);
  const installedEntries = useMemo(() => catalogue.filter((entry) => liveInstalled[entry.id]), [catalogue, liveInstalled]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.templateLibrary({ q: query, category: category || undefined, offset: 0, limit: 100 });
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
    void api.templateLibrary({ offset: 0, limit: 100 }).then((result) => { setCatalogue(result.entries); setCategories(result.categories); }).catch(() => undefined);
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

  // Reset only on a genuine navigation, not when a project refresh or a
  // template review triggers a rerender. Avoid touching an exiting page's ref.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, selected?.id, view, category]);

  const choose = (entry: TemplateManifest) => {
    setSelected(entry);
    setPlan(null);
    setMode(entry.mode === "reference-only" ? "isolated-sandbox" : "clean-derived-project");
    setImportError(null);
    setImportResult(null);
  };

  /** One-tap install: verify the pinned revision, then download the source into its own project. */
  const get = useCallback(async (entry: TemplateManifest, newProject = false) => {
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
      if (!newProject) {
        setInstalledMap((current) => {
          const next = { ...current, [entry.id]: { projectId: result.project.id, at: Date.now() } };
          writeInstalled(next);
          return next;
        });
        setJustInstalled(entry);
      }
      onInstalled?.(result.project.id);
      if (newProject) onOpenInstalled?.(result.project.id, entry);
    } catch (reason) {
      setInstallErrors((current) => ({ ...current, [entry.id]: reason instanceof Error ? reason.message : "The download failed." }));
    } finally {
      setPhases((current) => { const next = { ...current }; delete next[entry.id]; return next; });
    }
  }, [phases, onInstalled, onOpenInstalled]);

  useEffect(() => {
    if (!justInstalled) return;
    const timer = window.setTimeout(() => setJustInstalled(null), 9000);
    return () => window.clearTimeout(timer);
  }, [justInstalled]);

  const openInstalled = useCallback((entry: TemplateManifest) => {
    const record = liveInstalled[entry.id];
    if (!record) return;
    setJustInstalled(null);
    onOpenInstalled?.(record.projectId, entry);
  }, [liveInstalled, onOpenInstalled]);

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
    await navigator.clipboard?.writeText(`git clone ${selected.repositoryUrl.endsWith(".git") ? selected.repositoryUrl : `${selected.repositoryUrl}.git`}`).catch(() => undefined);
  };

  const goHome = () => { setView("discover"); setCategory(""); setQuery(""); setSelected(null); };
  const goCategory = (name: string) => { setView("discover"); setCategory(name); setSelected(null); };

  if (!open) return null;

  const navButton = (active: boolean) => cn("group relative isolate flex h-[32px] w-full items-center gap-2.5 rounded-[8px] px-2 text-left text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[#007AFF]/40", active ? "font-medium text-[#1D1D1F]" : "text-[#1D1D1F]/85 hover:bg-black/[0.04]");
  const highlight = <motion.span layoutId={reduce ? undefined : "lib-nav-highlight"} aria-hidden transition={{ duration: 0.24, ease: EASE }} className="absolute inset-0 -z-10 rounded-[8px] bg-black/[0.075]" />;
  const glyph = (Icon: CategoryMeta["icon"]) => <Icon className="h-[16px] w-[16px] shrink-0 text-[#007AFF]" />;
  const canGoBack = Boolean(selected || category || query.trim() || view === "installed");
  const goBack = () => { if (selected) setSelected(null); else goHome(); };
  const pageTitle = category || (query.trim() ? "Results" : "Discover");
  const related = (entry: TemplateManifest) => {
    const same = catalogue.filter((item) => item.category === entry.category && item.id !== entry.id);
    return same.length >= 2 ? same : [...same, ...catalogue.filter((item) => item.category !== entry.category)].slice(0, 2);
  };
  const searchField = (
    <label className="relative block w-full">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8E8E93]" />
      <input value={query} onChange={(event) => { setQuery(event.target.value); setView("discover"); setSelected(null); }} placeholder="Search" aria-label="Search the library" className="h-[30px] w-full rounded-[8px] border border-transparent bg-black/[0.055] pl-8 pr-3 text-[13px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] transition-[background-color,border-color,box-shadow] duration-150 focus:border-[#007AFF]/50 focus:bg-white focus:ring-[3px] focus:ring-[#007AFF]/[0.16]" />
    </label>
  );
  const bigShelves = shelves.filter(([, list]) => list.length >= 3);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
      className="absolute inset-0 z-[90] flex min-h-0 overflow-hidden bg-white"
      role="dialog"
      aria-modal="true"
      aria-label="Clyra Library"
    >
      <aside className="hidden min-h-0 w-[232px] shrink-0 flex-col border-r border-black/[0.07] bg-[#F6F6F8]/95 px-2.5 pb-3 pt-3.5 backdrop-blur-xl md:flex">
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
            {installedEntries.length ? <span className="ml-auto rounded-full bg-[#007AFF] px-1.5 text-[10.5px] font-semibold leading-[16px] tabular-nums text-white">{installedEntries.length}</span> : null}
          </button>

          <p className="px-2 pb-1 pt-4 text-[11px] font-semibold text-[#8E8E93]">Categories</p>
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

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-2 bg-white/80 px-3 backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_75%,transparent)] md:px-5">
          <AnimatePresence initial={false}>
            {canGoBack ? (
              <motion.button key="back" type="button" onClick={goBack} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.2, ease: EASE }}
                className="flex h-8 items-center gap-1 rounded-[8px] pl-1.5 pr-2.5 text-[13.5px] font-medium text-[#007AFF] transition-colors hover:bg-[#007AFF]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/35">
                <ChevronRight className="h-[18px] w-[18px] rotate-180" strokeWidth={2.2} />{selected ? (category || (view === "installed" ? "Installed" : "Discover")) : "Discover"}
              </motion.button>
            ) : null}
          </AnimatePresence>
          <div className="min-w-0 flex-1 md:hidden">{selected ? null : searchField}</div>
          <span className="hidden flex-1 md:block" />
          <button type="button" aria-label="Close library" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[#1D1D1F]/60 transition-colors hover:bg-black/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/35"><X className="h-4 w-4" /></button>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {selected ? (
            <motion.div key={`detail-${selected.id}`} ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: EASE }} className="cc-scroll min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-5 pb-10 pt-[68px] md:px-10">
              <div className="mx-auto max-w-[940px]">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                  <AppIcon entry={selected} size={128} lifted />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[30px] font-bold leading-tight tracking-[-0.035em] text-[#1D1D1F] md:text-[34px]">{selected.name}</h2>
                    <p className="mt-0.5 text-[15px] text-[#86868B]">{subtitleOf(selected)}</p>
                    <TemplateRatingGlance entry={selected} />
                    <div className="mt-4 flex flex-wrap items-center gap-2.5">
                      <Get entry={selected} install={install} large />
                      {install.installed(selected.id) ? <button type="button" disabled={Boolean(phases[selected.id])} onClick={() => void get(selected, true)} className="inline-flex h-[32px] items-center rounded-full bg-[#F0F0F5] px-3.5 text-[12.5px] font-medium text-[#007AFF] transition-colors hover:bg-[#E5E5EA] disabled:opacity-45">Open in a new project</button> : null}
                      {install.installed(selected.id) ? <button type="button"
                        onClick={() => document.getElementById("template-ratings-" + selected.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" })}
                        className="inline-flex h-[32px] items-center gap-1.5 rounded-full bg-[#F0F0F5] px-3.5 text-[13px] font-semibold text-[#007AFF] transition-colors hover:bg-[#E5E5EA]"
                        aria-label={"Rate " + selected.name}><Star className="h-3.5 w-3.5" /> Rate</button> : null}
                      <button type="button" onClick={() => { onAskClyra(selected); onClose(); }} className="inline-flex h-[32px] items-center gap-1.5 rounded-full bg-[#F0F0F5] px-3.5 text-[13px] font-semibold text-[#007AFF] transition-colors hover:bg-[#E5E5EA]"><Sparkles className="h-3.5 w-3.5" /> Ask Clyra</button>
                      <a href={selected.repositoryUrl} target="_blank" rel="noreferrer" aria-label="View source on GitHub" title="View source on GitHub" className="flex h-[32px] w-[32px] items-center justify-center rounded-full bg-[#F0F0F5] text-[#007AFF] transition-colors hover:bg-[#E5E5EA]"><ExternalLink className="h-4 w-4" /></a>
                    </div>
                    {phases[selected.id] ? <div role="status" aria-live="polite" aria-label="Preparing Git source checkout" className="mt-4 max-w-[360px]">
                      <div className="flex items-center justify-between gap-3 text-[12px] text-[#55565F]">
                        <span className="font-medium">Preparing</span>
                        <span className="text-[#86868B]">{phases[selected.id] === "verifying" ? "Checking Git source" : phases[selected.id] === "downloading" ? "Cloning repository" : "Finishing checkout"}</span>
                      </div>
                      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-[#E8E8ED]">
                        <motion.div className="h-full w-[36%] rounded-full bg-[#007AFF]" initial={{ x: "-105%" }} animate={{ x: "290%" }} transition={{ duration: 1.35, repeat: Infinity, ease: "easeInOut" }} />
                      </div>
                      <p className="mt-1.5 text-[11px] text-[#86868B]">Downloading the actual Git source. Progress is indeterminate until Git finishes.</p>
                    </div> : null}
                    {install.error(selected.id) ? <p role="alert" className="mt-2 text-[12px] text-[#C0392B]">{install.error(selected.id)}</p> : null}
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
                    <div key={cell.k} className={cn("min-w-[146px] flex-1 px-3 text-center", i && "border-l border-black/[0.08]")}>
                      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#A1A1A6]">{cell.k}</p>
                      <p className="mt-1 break-words text-[15px] font-semibold leading-[1.35] tracking-[-0.015em] text-[#6E6E73]" title={cell.v}>{cell.v}</p>
                      <p className="mt-0.5 truncate text-[11px] text-[#A1A1A6]">{cell.s}</p>
                    </div>
                  ))}
                </div>

                <TemplateScreenshotGallery entry={selected} />

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <p className="max-w-[720px] text-[15px] leading-[1.6] text-[#1D1D1F]/85">{selected.description}</p>
                  {coverCapabilities(selected).length ? <ul className="mt-3 space-y-1.5 text-[14px] text-[#424245]">{coverCapabilities(selected).map((cap) => <li key={cap} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#86868B]" />{cap}</li>)}</ul> : null}
                </section>

                <TemplateFeaturesAndRequirements entry={selected} />

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#1D1D1F]">What happens when you open it</h3>
                  <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                      { t: "Inspect the source", d: "Get checks the upstream repository and resolves a source revision before installation." },
                      { t: "Download safely", d: "After confirmation, Clyra downloads the resolved source into a project. Verification does not execute scripts." },
                      { t: "Set up and run", d: "Open your project when its dependencies are ready. Some sources require API keys, services or native tooling." },
                    ].map((step, i) => (
                      <li key={step.t} className="border-t border-black/[0.09] py-4 pr-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#007AFF] text-[12px] font-semibold text-white">{i + 1}</span>
                        <p className="mt-2.5 text-[14px] font-semibold text-[#1D1D1F]">{step.t}</p>
                        <p className="mt-1 text-[12.5px] leading-[1.5] text-[#6E6E73]">{step.d}</p>
                      </li>
                    ))}
                  </ol>
                  {selected.compatibility.length ? <ul className="mt-4 grid gap-2 text-[13px] leading-[1.5] text-[#424245] sm:grid-cols-2">{selected.compatibility.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />{item}</li>)}</ul> : null}
                </section>

                <TemplateRatingsAndReviews entry={selected} canReview={install.installed(selected.id)} />

                {related(selected).length ? (
                  <section className="mt-8 border-t border-black/[0.08] pt-5">
                    <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#1D1D1F]">You might also like</h3>
                    <div className="mt-2 grid grid-cols-1 gap-x-8 md:grid-cols-2">{related(selected).slice(0, 4).map((entry, index) => <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />)}</div>
                  </section>
                ) : null}

                <section className="mt-8 border-t border-black/[0.08] pt-5">
                  <h3 className="text-[20px] font-bold tracking-[-0.025em] text-[#1D1D1F]">Information</h3>
                  <dl className="mt-3 grid gap-x-8 text-[13px] sm:grid-cols-2">
                    {[
                      ["Source", repoSlug(selected)],
                      ["Category", selected.category],
                      ["License", selected.licenseSpdxOrReview],
                      ["Stack", selected.stack.join(", ") || "See repository"],
                      ["Build footprint", selected.estimatedBuildFootprint || "—"],
                      ["Runs on", selected.supportedTargets.join(", ") || "—"],
                    ].map(([k, v]) => <div key={k} className="border-b border-black/[0.07] py-2.5"><dt className="text-[12px] text-[#86868B]">{k}</dt><dd className="mt-0.5 break-words text-[#1D1D1F]">{v}</dd></div>)}
                  </dl>
                  <p className="mt-3 max-w-[680px] text-[12px] leading-[1.6] text-[#86868B]">{selected.attribution}</p>
                  <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copyClone()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F0F0F5] px-3.5 text-[12px] font-medium text-[#007AFF] transition-colors hover:bg-[#E5E5EA]"><Copy className="h-3 w-3" /> Copy clone command</button></div>
                </section>

                <details className="group mt-7 rounded-[14px] bg-[#F5F5F7]">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-[13px] font-medium text-[#424245] marker:content-none"><ChevronRight className="h-4 w-4 text-[#A1A1A6] transition-transform group-open:rotate-90" />Advanced import options</summary>
                  <div className="border-t border-black/[0.06] px-4 pb-4 pt-3">
                    <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white text-[#526B7E]"><FileSearch className="h-3.5 w-3.5" /></span><p className="text-[12.5px] font-medium text-[#33353A]">Inspect, then choose how to import</p></div>
                    {!plan ? <button type="button" disabled={inspecting} onClick={() => void inspect()} className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:opacity-50">{inspecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}{inspecting ? "Verifying source…" : "Verify repository"}</button> : <>
                      <div className="mt-3 rounded-[10px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[11.5px] leading-[1.5] text-[#477757]"><span className="font-medium">Resolved {formatCommit(plan.verification.commit)}</span><br />{new Date(plan.verification.verifiedAt).toLocaleString()}</div>
                      <label className="mt-3 block max-w-[360px] text-[11.5px] font-medium text-[#66696F]">Import mode<select value={mode} onChange={(event) => setMode(event.target.value as TemplateImportMode)} className="mt-1.5 h-9 w-full rounded-[8px] border border-black/[0.1] bg-white px-2 text-[12px] text-[#414349] outline-none focus:border-[#007AFF]/45">{IMPORT_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}</select></label>
                      <p className="mt-2 text-[11.5px] leading-[1.45] text-[#85878C]">{selectedChoice.detail}</p>
                      {needsCurrentProject && !projectId ? <p className="mt-3 flex gap-1.5 text-[11.5px] leading-[1.45] text-[#B36A3E]"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />Open a Clyra project first to use this mode.</p> : null}
                      <button type="button" disabled={importing || (needsCurrentProject && !projectId)} onClick={() => void importSource()} className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-full bg-[#1D1D1F] px-4 text-[12px] font-medium text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-45">{importing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{importing ? "Downloading pinned source…" : "Confirm and download source"}</button>
                    </>}
                    {importError ? <p role="alert" className="mt-3 text-[11.5px] leading-[1.45] text-[#C04B4B]">{importError}</p> : null}
                    {importResult ? <div className="mt-3 rounded-[9px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[11.5px] leading-[1.5] text-[#477757]"><span className="font-medium">Source checkout complete</span><br />{importResult.message}<br /><span className="font-mono text-[10px]">{importResult.sourcePath}</span></div> : null}
                    <ul className="mt-3 space-y-1.5 text-[11px] leading-[1.45] text-[#909297]">{plan?.warnings.slice(0, 3).map((warning) => <li key={warning}>• {warning}</li>) ?? <li>• Verify the source revision, notices, requirements and build commands.</li>}</ul>
                  </div>
                </details>
              </div>
            </motion.div>
          ) : view === "installed" ? (
            <motion.div key="installed" ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="cc-scroll min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-5 pb-10 pt-[64px] md:px-10">
              <div className="mx-auto max-w-[1120px]">
                <h2 className="text-[34px] font-bold tracking-[-0.04em] text-[#1D1D1F]">Installed</h2>
                <p className="mt-1 text-[14px] text-[#86868B]">Apps you’ve downloaded. Open one to run it live in Clyra Code and start changing it.</p>
                {installedEntries.length ? (
                  <div className="mt-5 grid grid-cols-1 gap-x-8 md:grid-cols-2 xl:grid-cols-3">
                    {installedEntries.map((entry, index) => <RankRow key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />)}
                  </div>
                ) : (
                  <div className="mt-16 flex flex-col items-center text-center">
                    <span className="cc-squircle flex h-16 w-16 items-center justify-center bg-[#F0F0F5] text-[#007AFF]"><Download className="h-7 w-7" /></span>
                    <p className="mt-4 text-[17px] font-semibold text-[#1D1D1F]">Nothing installed yet</p>
                    <p className="mt-1 max-w-[320px] text-[13px] text-[#86868B]">Tap Get on any app in Discover and it will show up here.</p>
                    <button type="button" onClick={goHome} className="mt-4 h-[32px] rounded-full bg-[#007AFF] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#0068DB]">Browse apps</button>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key={`list-${category || "home"}`} ref={contentRef} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="cc-scroll min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-5 pb-10 pt-[64px] md:px-10">
              <div className="mx-auto max-w-[1180px]">
                <div className="mb-5">
                  <h2 className="text-[34px] font-bold tracking-[-0.04em] text-[#1D1D1F]">{pageTitle}</h2>
                  {!isHome ? <p className="mt-1 text-[14px] text-[#86868B]">{category ? `${total} ${total === 1 ? "app" : "apps"}` : `${total} ${total === 1 ? "result" : "results"} for “${query.trim()}”`}</p> : null}
                </div>
                <div className="relative -mt-1 mb-6 md:hidden">
                  <div className="flex gap-2 overflow-x-auto pb-1 pr-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {[{ id: "", label: "All" }, ...categories.map((item) => ({ id: item, label: item }))].map((item) => (
                      <button key={item.id || "all"} type="button" onClick={() => goCategory(item.id)}
                        className={cn("h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-colors duration-200", category === item.id ? "bg-[#1D1D1F] text-white" : "bg-[#F0F0F5] text-[#1D1D1F]/80 hover:bg-[#E5E5EA]")}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                {loading && !entries.length ? <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <div key={index}><div className="cc-lib-shimmer aspect-[16/10] rounded-[14px]" /><div className="mt-3 flex items-center gap-3"><div className="cc-lib-shimmer cc-squircle h-[42px] w-[42px]" /><div className="flex-1 space-y-1.5"><div className="cc-lib-shimmer h-3 w-1/2 rounded" /><div className="cc-lib-shimmer h-2.5 w-1/3 rounded" /></div></div></div>)}</div> : null}
                {error ? <div role="alert" className="rounded-[14px] bg-[#FCEBEB] p-4 text-[13px] text-[#A43D3D]">{error}</div> : null}
                {!loading && !error && !entries.length ? <div className="rounded-[16px] bg-[#F5F5F7] p-10 text-center text-[13px] text-[#86868B]">No apps match. Try another search or category.</div> : null}
                {!error && entries.length && isHome ? (
                  <>
                    <Spotlight entries={spotlight} onChoose={choose} install={install} related={related} />
                    {topPicks.length ? (
                      <section aria-label="Top picks" className="mb-10 border-t border-black/[0.07] pt-5">
                        <SectionHeader title="Top Picks" subtitle="Popular starting points across every category" />
                        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2 xl:grid-cols-3">{topPicks.map((entry, index) => <RankRow key={entry.id} entry={entry} rank={index + 1} onChoose={choose} install={install} index={index} />)}</div>
                      </section>
                    ) : null}
                    {bigShelves.map(([name, list]) => <Shelf key={name} title={name} subtitle={`${list.length} apps`} entries={list} onChoose={choose} install={install} onSeeAll={() => goCategory(name)} />)}
                    <section aria-label="Categories" className="mb-6 border-t border-black/[0.07] pt-5">
                      <SectionHeader title="Categories" subtitle="Every kind of app in the Library" />
                      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
                        {shelves.map(([name, list], index) => {
                          const meta = categoryMeta(name);
                          const Icon = meta.icon;
                          return (
                            <motion.button key={name} type="button" onClick={() => goCategory(name)}
                              initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: Math.min(index, 14) * 0.02, ease: EASE }}
                              className="group flex items-center gap-3 rounded-[10px] px-1.5 text-left outline-none transition-colors hover:bg-black/[0.025] focus-visible:ring-2 focus-visible:ring-[#007AFF]/45">
                              <span className="cc-squircle my-2 flex h-9 w-9 shrink-0 items-center justify-center text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]" style={{ background: `linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.06)), ${meta.accent}` }}><Icon className="h-[18px] w-[18px]" /></span>
                              <span className="flex min-w-0 flex-1 items-center gap-2 self-stretch border-b border-black/[0.07]">
                                <span className="min-w-0 flex-1 truncate text-[14px] text-[#1D1D1F]">{name}</span>
                                <span className="text-[12px] tabular-nums text-[#A1A1A6]">{list.length}</span>
                                <ChevronRight className="h-4 w-4 text-[#C7C7CC] transition-transform group-hover:translate-x-0.5" />
                              </span>
                            </motion.button>
                          );
                        })}
                      </div>
                    </section>
                  </>
                ) : null}
                {!error && entries.length && !isHome ? (
                  <section aria-label="Apps">
                    <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{entries.map((entry, index) => <SourceCard key={entry.id} entry={entry} onChoose={choose} install={install} index={index} />)}</div>
                  </section>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Show source checkout activity even when Get was tapped on a catalogue card. */}
        <AnimatePresence>
          {!selected && Object.values(phases).some(Boolean) ? (
            <motion.div key="library-clone-progress" role="status" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-5 left-1/2 z-30 w-[min(420px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] border border-black/[0.06] bg-white p-3.5 shadow-[0_12px_36px_rgba(0,0,0,0.12)]">
              <div className="flex items-center justify-between text-[12.5px]"><span className="font-medium text-[#1D1D1F]">Preparing</span><span className="text-[#86868B]">Git source checkout</span></div>
              <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-[#E8E8ED]"><motion.div className="h-full w-[35%] rounded-full bg-[#007AFF]" initial={{ x: "-105%" }} animate={{ x: "290%" }} transition={{ duration: 1.35, repeat: Infinity, ease: "easeInOut" }} /></div>
            </motion.div>
          ) : null}
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
                <span className="block truncate text-[13.5px] font-semibold text-[#1D1D1F]">{justInstalled.name} is ready</span>
                <span className="block truncate text-[12px] text-[#86868B]">Open runs it live and Clyra asks what to change.</span>
              </span>
              <button type="button" onClick={() => openInstalled(justInstalled)} className="h-[30px] shrink-0 rounded-full bg-[#007AFF] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#0068DB] active:scale-95">Open</button>
              <button type="button" aria-label="Dismiss" onClick={() => setJustInstalled(null)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8E8E93] transition-colors hover:bg-black/[0.05]"><X className="h-3.5 w-3.5" /></button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </motion.div>
  );
}
