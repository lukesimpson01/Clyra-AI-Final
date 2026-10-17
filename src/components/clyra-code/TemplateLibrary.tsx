import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  AppWindow,
  ArrowLeft,
  ArrowUpRight,
  Blocks,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  ExternalLink,
  FileSearch,
  Image as ImageIcon,
  LibraryBig,
  LoaderCircle,
  Map,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { api, type TemplateImportMode, type TemplateImportPlan, type TemplateManifest } from "./api";
import { cn } from "../../lib/utils";

const IMPORT_CHOICES: Array<{ id: TemplateImportMode; title: string; detail: string }> = [
  { id: "clean-derived-project", title: "Create source project", detail: "A separate, editable Clyra project from a pinned upstream checkout." },
  { id: "integrate-existing-project", title: "Add to current project", detail: "Adds an isolated source checkout only. Clyra will not merge files automatically." },
  { id: "isolated-sandbox", title: "Run as reference", detail: "Creates an isolated source project for inspection and later local setup." },
  { id: "dependency-source", title: "Use as dependency source", detail: "Adds the source beside the current project without installing it." },
];

type CategoryMeta = {
  icon: ComponentType<{ className?: string }>;
  accent: string;
  tint: string;
  panel: string;
  label: string;
};

const CATEGORY_STYLES: Record<string, CategoryMeta> = {
  Design: { icon: Palette, accent: "#B45E40", tint: "#F9EAE5", panel: "#F5DDD4", label: "Visual craft" },
  Whiteboard: { icon: Map, accent: "#6B61B8", tint: "#ECEAFA", panel: "#DCD8F4", label: "Spatial thinking" },
  Video: { icon: Clapperboard, accent: "#B64265", tint: "#F9E8EE", panel: "#F4D4DF", label: "Motion and media" },
  "Video & Shorts": { icon: Clapperboard, accent: "#B64265", tint: "#F9E8EE", panel: "#F4D4DF", label: "Motion and media" },
  "AI Images": { icon: ImageIcon, accent: "#8061B7", tint: "#EFEAFA", panel: "#DED3F1", label: "Generative imagery" },
  "AI Assistant": { icon: Sparkles, accent: "#3977C9", tint: "#E7F0FC", panel: "#D2E4F8", label: "Intelligent work" },
  "AI Workflows": { icon: Blocks, accent: "#36866D", tint: "#E4F3EC", panel: "#CDE9DC", label: "Connected work" },
  Productivity: { icon: Blocks, accent: "#36866D", tint: "#E4F3EC", panel: "#CDE9DC", label: "Work flows" },
  "Web app": { icon: AppWindow, accent: "#3977C9", tint: "#E7F0FC", panel: "#D2E4F8", label: "Product foundations" },
  "Code Agents": { icon: FileSearch, accent: "#426F9F", tint: "#E8F0F7", panel: "#D4E2F0", label: "Autonomous building" },
  "Screen Capture": { icon: ImageIcon, accent: "#A2673D", tint: "#F8EDE3", panel: "#F0DCC9", label: "Captured context" },
  Photos: { icon: ImageIcon, accent: "#7D6C43", tint: "#F5F0E2", panel: "#EBE0C4", label: "Image workflows" },
  Maps: { icon: Map, accent: "#3E857F", tint: "#E3F2F0", panel: "#CBE5E1", label: "Location intelligence" },
  Automation: { icon: Blocks, accent: "#5676A6", tint: "#E8EEF8", panel: "#D4E0F2", label: "Automated work" },
  "Developer tool": { icon: FileSearch, accent: "#58737D", tint: "#E7EFF1", panel: "#D4E1E5", label: "Builder tools" },
  Other: { icon: LibraryBig, accent: "#6B6C70", tint: "#EEEDEC", panel: "#E1DFDD", label: "Open source" },
};

function categoryMeta(category: string): CategoryMeta {
  return CATEGORY_STYLES[category] ?? CATEGORY_STYLES.Other;
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

function statusTone(status: TemplateManifest["status"]) {
  if (status === "runnable-now") return "bg-[#E6F3EC] text-[#317653]";
  if (status === "requires-setup" || status === "unverified") return "bg-[#F9F0DD] text-[#8D672B]";
  if (status === "unavailable") return "bg-[#F8E8E8] text-[#A84F4F]";
  return "bg-[#ECEDEF] text-[#62666B]";
}

/**
 * This deliberately never synthesises a product screenshot. It gives entries with
 * no verified capture a recognisable metadata treatment; real source media is
 * rendered verbatim when it has been authorised or captured locally.
 */
function SourceVisual({ entry, className = "" }: { entry: TemplateManifest; className?: string }) {
  const sourceCapture = entry.sourceScreenshots[0];
  const meta = categoryMeta(entry.category);
  const Icon = meta.icon;

  if (sourceCapture) {
    return (
      <figure className={cn("relative overflow-hidden bg-[#ECEDEA]", className)}>
        <img src={sourceCapture.url} alt={sourceCapture.alt} loading="lazy" className="h-full w-full object-cover" />
        <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2 pt-7 text-[10px] text-white/90">
          {sourceCapture.provenance}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className={cn("relative isolate overflow-hidden", className)} style={{ background: meta.tint }} aria-label={`${entry.name} source profile; no screenshot available`}>
      <div className="absolute -right-7 -top-8 h-36 w-36 rounded-full opacity-60" style={{ background: meta.panel }} />
      <div className="absolute -bottom-10 left-5 h-24 w-24 rounded-full border-[14px] border-white/45" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white/90 shadow-[0_3px_12px_rgba(29,34,38,0.07)]" style={{ color: meta.accent }}><Icon className="h-[18px] w-[18px]" /></span>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em]" style={{ color: meta.accent }}>{meta.label}</p>
          <p className="mt-1 line-clamp-1 text-[13px] font-medium text-[#2D3034]">{entry.alternativeTo.slice(0, 2).join(" · ") || "Open source starting point"}</p>
        </div>
        <span className="absolute bottom-2.5 right-3 text-[9px] font-medium uppercase tracking-[0.1em] text-[#63666A]/70">Source profile</span>
      </div>
    </div>
  );
}

function SourceCard({ entry, onChoose }: { entry: TemplateManifest; onChoose: (entry: TemplateManifest) => void }) {
  const meta = categoryMeta(entry.category);
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onChoose(entry)}
      className="group relative flex min-h-[278px] flex-col overflow-hidden rounded-[16px] border border-black/[0.075] bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,0.018)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-black/[0.14] hover:shadow-[0_14px_28px_rgba(28,31,34,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/40 [content-visibility:auto]"
    >
      <SourceVisual entry={entry} className="h-[115px] shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[10.5px] font-medium" style={{ color: meta.accent }}><Icon className="h-3 w-3 shrink-0" />{entry.category}</span>
          <span className={cn("shrink-0 rounded-full px-2 py-[3px] text-[9.5px] font-medium", statusTone(entry.status))}>{statusLabel(entry)}</span>
        </div>
        <h3 className="mt-2.5 line-clamp-1 text-[15px] font-medium tracking-[-0.015em] text-[#2E3035]">{entry.name}</h3>
        <p className="mt-1 line-clamp-1 text-[11px] text-[#73767B]">Alternative to {entry.alternativeTo.join(" · ")}</p>
        <p className="mt-2 line-clamp-2 text-[11.5px] leading-[1.5] text-[#55585D]">{entry.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-black/[0.06] pt-2.5 text-[10px] text-[#898B90]">
          <span className="line-clamp-1">{modeLabel(entry)} · {entry.licenseSpdxOrReview}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[#3977C9] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Inspect <ArrowUpRight className="h-3 w-3" /></span>
        </div>
      </div>
    </button>
  );
}

/** The top shelf intentionally promotes captures first when the catalogue has
 * them. Until a source has passed Clyra's capture gate, it stays a labelled
 * source profile rather than an imitation screenshot. */
function FeaturedSourceCard({ entry, onChoose, lead = false }: { entry: TemplateManifest; onChoose: (entry: TemplateManifest) => void; lead?: boolean }) {
  const meta = categoryMeta(entry.category);
  const Icon = meta.icon;
  const hasCapture = entry.sourceScreenshots.length > 0;
  return (
    <button
      type="button"
      onClick={() => onChoose(entry)}
      className={cn(
        "group relative min-w-0 overflow-hidden rounded-[18px] border border-black/[0.075] bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,0.018)] transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-black/[0.14] hover:shadow-[0_16px_32px_rgba(28,31,34,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/40",
        lead ? "flex min-h-[300px] flex-col sm:min-h-[336px]" : "flex min-h-[160px] items-stretch",
      )}
    >
      <SourceVisual entry={entry} className={cn("shrink-0", lead ? "h-[176px] sm:h-[202px]" : "w-[42%]")} />
      <div className={cn("flex min-w-0 flex-1 flex-col", lead ? "px-4 pb-4 pt-3.5" : "px-3.5 py-3.5")}>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1 text-[10px] font-medium" style={{ color: meta.accent }}><Icon className="h-3 w-3 shrink-0" />{entry.category}</span>
          <span className="ml-auto shrink-0 rounded-full bg-black/[0.045] px-1.5 py-[2px] text-[8.5px] font-medium uppercase tracking-[0.08em] text-[#6E7176]">{hasCapture ? "Captured" : "Profile"}</span>
        </div>
        <h3 className={cn("line-clamp-1 font-medium tracking-[-0.02em] text-[#2D3034]", lead ? "mt-2 text-[17px]" : "mt-2 text-[14px]")}>{entry.name}</h3>
        <p className={cn("line-clamp-2 leading-[1.48] text-[#686B70]", lead ? "mt-1 text-[11.5px]" : "mt-1 text-[10.5px]")}>{entry.description}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[10px] text-[#85878C]">
          <span className="truncate">{entry.alternativeTo.slice(0, 2).join(" · ")}</span>
          <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-[#3977C9]">Explore <ArrowUpRight className="h-3 w-3" /></span>
        </div>
      </div>
    </button>
  );
}

export function TemplateLibrary({
  open,
  projectId,
  onClose,
  onImported,
  onAskClyra,
}: {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onImported: (projectId: string) => void;
  onAskClyra: (entry: TemplateManifest) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [entries, setEntries] = useState<TemplateManifest[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TemplateManifest | null>(null);
  const [plan, setPlan] = useState<TemplateImportPlan | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mode, setMode] = useState<TemplateImportMode>("clean-derived-project");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ projectId: string; message: string; sourcePath: string } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const selectedChoice = useMemo(() => IMPORT_CHOICES.find((choice) => choice.id === mode) ?? IMPORT_CHOICES[0], [mode]);
  const needsCurrentProject = mode === "integrate-existing-project" || mode === "dependency-source";
  const displayedFilters = categories.slice(0, 6);
  const isMarketplaceHome = !query.trim() && !category;
  const marketplaceShelf = useMemo(() => {
    const ranked = [...entries].sort((a, b) => Number(Boolean(b.sourceScreenshots.length)) - Number(Boolean(a.sourceScreenshots.length)));
    const representedCategories = new Set<string>();
    const selection: TemplateManifest[] = [];
    for (const entry of ranked) {
      if (representedCategories.has(entry.category) && selection.length < 3) continue;
      selection.push(entry);
      representedCategories.add(entry.category);
      if (selection.length === 3) break;
    }
    return selection;
  }, [entries]);

  const load = async (offset = 0, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.templateLibrary({ q: query, category: category || undefined, offset, limit: 18 });
      setEntries((current) => append ? [...current, ...result.entries] : result.entries);
      setCategories(result.categories);
      setTotal(result.total);
      setNextOffset(result.nextOffset);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The source library could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { void load(); }, 120);
    return () => window.clearTimeout(timer);
    // `load` is intentionally recreated from the visible filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, category]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  // The list and detail share the same scrolling region. Reset it on a view
  // change so a source's title and import controls never open halfway down.
  useEffect(() => {
    if (!open) return;
    const reset = () => contentRef.current?.scrollTo({ top: 0 });
    reset();
    // Clicking a card may ask the browser to retain its focused position after
    // React has swapped views. The next frame makes the destination explicit.
    const frame = window.requestAnimationFrame(reset);
    const settle = window.setTimeout(reset, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settle);
    };
  }, [open, selected?.id]);

  const choose = (entry: TemplateManifest) => {
    setSelected(entry);
    setPlan(null);
    setMode(entry.mode === "reference-only" ? "isolated-sandbox" : "clean-derived-project");
    setImportError(null);
    setImportResult(null);
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

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[90] flex overflow-hidden bg-[#FBFBFA]" role="dialog" aria-modal="true" aria-label="Clyra source library">
      <aside className="hidden min-h-0 w-[270px] shrink-0 border-r border-black/[0.07] bg-[#F7F7F5] p-4 md:flex md:flex-col">
        <div className="rounded-[15px] border border-black/[0.055] bg-white p-3.5 shadow-[0_3px_12px_rgba(28,31,34,0.035)]">
          <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#292B30] text-white"><LibraryBig className="h-4 w-4" /></span><div><p className="text-[12.5px] font-medium text-[#2D3034]">Source library</p><p className="text-[10px] text-[#85878C]">Discover with context</p></div></div>
          <p className="mt-3 text-[10.75px] leading-[1.55] text-[#76797E]">Start from public code with its provenance, posture, and next step plainly visible.</p>
        </div>

        <nav aria-label="Source categories" className="cc-scroll mt-5 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          <p className="px-2 text-[9.5px] font-medium uppercase tracking-[0.13em] text-[#9A9CA1]">Browse</p>
          <button type="button" onClick={() => setCategory("")} className={cn("mt-1 flex h-9 w-full items-center rounded-[9px] px-2.5 text-left text-[11.5px] transition-colors", !category ? "bg-[#292B30] font-medium text-white shadow-[0_2px_4px_rgba(0,0,0,0.08)]" : "text-[#5F6267] hover:bg-black/[0.045]")}><LibraryBig className="mr-2 h-3.5 w-3.5" />All sources <span className="ml-auto text-[10px] opacity-65">{total || "68"}</span></button>
          {categories.map((item) => {
            const meta = categoryMeta(item);
            const Icon = meta.icon;
            return <button key={item} type="button" onClick={() => setCategory(item)} className={cn("flex h-9 w-full items-center rounded-[9px] px-2.5 text-left text-[11.5px] transition-colors", category === item ? "bg-white font-medium text-[#2D3034] shadow-[0_2px_7px_rgba(0,0,0,0.045)]" : "text-[#66696E] hover:bg-black/[0.045]")}><Icon className="mr-2 h-3.5 w-3.5" style={{ color: meta.accent }} />{item}</button>;
          })}
        </nav>
        <div className="mt-auto rounded-[12px] border border-[#DCE7F6] bg-[#F2F7FD] p-3"><div className="flex items-center gap-1.5 text-[10.5px] font-medium text-[#3A6795]"><ShieldCheck className="h-3.5 w-3.5" />Build with evidence</div><p className="mt-1.5 text-[10px] leading-[1.5] text-[#66809A]">Clyra shows a capture only when it comes from a local run or authorised source media.</p></div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#FBFBFA]">
        <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-black/[0.07] bg-white/90 px-4 backdrop-blur md:px-5">
          {selected ? (
            <button type="button" onClick={() => setSelected(null)} className="flex h-9 items-center gap-1.5 rounded-[9px] px-2.5 text-[12px] text-[#5D6065] transition-colors hover:bg-black/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/35"><ArrowLeft className="h-3.5 w-3.5" /> Library</button>
          ) : (
            <><div className="flex min-w-0 items-center gap-2 md:hidden"><LibraryBig className="h-[17px] w-[17px] text-[#3977C9]" /><span className="text-[13px] font-medium text-[#292B30]">Library</span></div><label className="relative ml-auto block w-full max-w-[510px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#96999E]" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps, capabilities, or alternatives" className="h-[38px] w-full rounded-[10px] border border-black/[0.09] bg-[#F7F7F6] pl-9 pr-3 text-[12px] text-[#393B40] outline-none placeholder:text-[#A5A7AB] transition-colors focus:border-[#3977F6]/45 focus:bg-white focus:ring-2 focus:ring-[#3977F6]/[0.09]" /></label></>
          )}
          <button type="button" aria-label="Close source library" onClick={onClose} className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#7C7F84] transition-colors hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3977F6]/35"><X className="h-4 w-4" /></button>
        </header>

        {selected ? (
          <div key={`source-detail-${selected.id}`} ref={contentRef} className="cc-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-7 md:py-7">
            <div className="mx-auto grid max-w-[1020px] gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
              <article className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ color: categoryMeta(selected.category).accent, background: categoryMeta(selected.category).tint }}>{selected.category}</span><span className={cn("rounded-full px-2.5 py-1 text-[10px] font-medium", statusTone(selected.status))}>{statusLabel(selected)}</span></div>
                <h2 className="mt-4 text-[27px] font-medium tracking-[-0.04em] text-[#27292E] md:text-[31px]">{selected.name}</h2>
                <p className="mt-1.5 text-[12.5px] text-[#707379]">Alternative to {selected.alternativeTo.join(" · ")} <span className="text-[#A0A2A6]">· independent open-source starting point</span></p>
                <p className="mt-5 max-w-[665px] text-[14px] leading-[1.65] text-[#505359]">{selected.description}</p>

                <section className="mt-6 overflow-hidden rounded-[16px] border border-black/[0.07] bg-white">
                  <SourceVisual entry={selected} className="h-[210px] w-full sm:h-[274px]" />
                  {selected.sourceScreenshots.length ? null : <div className="flex items-start gap-2.5 border-t border-black/[0.06] bg-[#FCFCFB] px-4 py-3 text-[11px] leading-[1.5] text-[#7C7F84]"><ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8E9297]" /><span>No authorised or locally captured screenshot is available yet. This is a source profile, not a fabricated product screenshot; verify and run the source before Clyra presents a visual preview.</span></div>}
                </section>
                {selected.sourceScreenshots.length > 1 ? <div className="mt-3 grid grid-cols-2 gap-3">{selected.sourceScreenshots.slice(1).map((shot) => <figure key={shot.url} className="overflow-hidden rounded-[12px] border border-black/[0.08]"><img src={shot.url} alt={shot.alt} loading="lazy" className="aspect-video w-full object-cover" /><figcaption className="px-2.5 py-2 text-[10px] text-[#85878C]">{shot.provenance}</figcaption></figure>)}</div> : null}

                <section className="mt-7 border-t border-black/[0.07] pt-5"><h3 className="text-[12px] font-medium text-[#35373B]">Truthful compatibility</h3><ul className="mt-3 grid gap-2 text-[11.5px] leading-[1.5] text-[#696C71] sm:grid-cols-2">{selected.compatibility.map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#57936C]" />{item}</li>)}</ul></section>
                <section className="mt-6 border-t border-black/[0.07] pt-5"><h3 className="text-[12px] font-medium text-[#35373B]">Source and attribution</h3><p className="mt-2 max-w-[660px] text-[11.5px] leading-[1.6] text-[#74777C]">{selected.attribution}</p><div className="mt-3 flex flex-wrap gap-2"><a href={selected.repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-black/[0.1] px-2.5 text-[11.5px] text-[#4A4D52] transition-colors hover:bg-black/[0.035]"><ExternalLink className="h-3 w-3" /> View source</a><button type="button" onClick={() => void copyClone()} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-black/[0.1] px-2.5 text-[11.5px] text-[#4A4D52] transition-colors hover:bg-black/[0.035]"><Copy className="h-3 w-3" /> Copy clone command</button><button type="button" onClick={() => { onAskClyra(selected); onClose(); }} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#3977F6]/20 bg-[#F0F6FF] px-2.5 text-[11.5px] text-[#2864B8] transition-colors hover:bg-[#E4F0FF]"><Sparkles className="h-3 w-3" /> Ask Clyra to customise</button></div></section>
              </article>
              <aside className="h-fit rounded-[15px] border border-black/[0.08] bg-white p-4 shadow-[0_10px_26px_rgba(26,30,33,0.05)] lg:sticky lg:top-3">
                <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-[#F1F4F7] text-[#526B7E]"><FileSearch className="h-3.5 w-3.5" /></span><div><p className="text-[12px] font-medium text-[#33353A]">Inspect before import</p><p className="text-[9.75px] text-[#8B8D92]">Clyra pins the revision first</p></div></div>
                <p className="mt-3 text-[10.75px] leading-[1.5] text-[#7F8287]">Source downloads only after explicit confirmation. Files are kept separate until you choose what to use.</p>
                {!plan ? <button type="button" disabled={inspecting} onClick={() => void inspect()} className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] bg-[#292B30] text-[11.5px] font-medium text-white transition-colors hover:bg-[#18191C] disabled:opacity-50">{inspecting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}{inspecting ? "Verifying source…" : "Verify repository"}</button> : <>
                  <div className="mt-4 rounded-[10px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[10.75px] leading-[1.5] text-[#477757]"><span className="font-medium">Resolved {formatCommit(plan.verification.commit)}</span><br />{new Date(plan.verification.verifiedAt).toLocaleString()}</div>
                  <label className="mt-4 block text-[10.5px] font-medium text-[#66696F]">Import mode<select value={mode} onChange={(event) => setMode(event.target.value as TemplateImportMode)} className="mt-1.5 h-9 w-full rounded-[8px] border border-black/[0.1] bg-white px-2 text-[11.5px] text-[#414349] outline-none focus:border-[#3977F6]/45">{IMPORT_CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}</select></label>
                  <p className="mt-2 text-[10.5px] leading-[1.45] text-[#85878C]">{selectedChoice.detail}</p>
                  {needsCurrentProject && !projectId ? <p className="mt-3 flex gap-1.5 text-[10.5px] leading-[1.45] text-[#B36A3E]"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />Open a Clyra project first to use this mode.</p> : null}
                  <button type="button" disabled={importing || (needsCurrentProject && !projectId)} onClick={() => void importSource()} className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] bg-[#292B30] text-[11.5px] font-medium text-white transition-colors hover:bg-[#18191C] disabled:cursor-not-allowed disabled:opacity-45">{importing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}{importing ? "Downloading pinned source…" : "Confirm and download source"}</button>
                </>}
                {importError ? <p role="alert" className="mt-3 text-[10.5px] leading-[1.45] text-[#C04B4B]">{importError}</p> : null}
                {importResult ? <div className="mt-3 rounded-[9px] border border-[#B9DDC6] bg-[#F0F8F3] p-2.5 text-[10.5px] leading-[1.5] text-[#477757]"><span className="font-medium">Source checkout complete</span><br />{importResult.message}<br /><span className="font-mono text-[9.5px]">{importResult.sourcePath}</span></div> : null}
                <div className="mt-4 border-t border-black/[0.07] pt-3"><p className="text-[10.5px] font-medium text-[#65676C]">Before source is runnable</p><ul className="mt-2 space-y-1.5 text-[10px] leading-[1.45] text-[#909297]">{plan?.warnings.slice(0, 3).map((warning) => <li key={warning}>• {warning}</li>) ?? <li>• Verify the source revision, notices, requirements and build commands.</li>}</ul></div>
              </aside>
            </div>
          </div>
        ) : (
          <div key="source-list" ref={contentRef} className="cc-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <div className="mx-auto max-w-[1180px]">
              <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#7D9AB7]">Clyra source marketplace</p><h2 className="text-[23px] font-medium tracking-[-0.035em] text-[#2B2D32]">Build from real starting points</h2><p className="mt-1.5 text-[12px] text-[#7D8085]">{total ? `${total} curated public repositories` : "Curated public repositories"} · provenance, posture, and the honest next step on every listing.</p></div><div className="hidden items-center gap-2 text-[10.5px] text-[#808388] sm:flex"><ShieldCheck className="h-3.5 w-3.5 text-[#5C9870]" /> Provenance before preview</div></div>
              <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:hidden">{[{ id: "", label: "All" }, ...displayedFilters.map((item) => ({ id: item, label: item }))].map((item) => <button key={item.id || "all"} type="button" onClick={() => setCategory(item.id)} className={cn("h-8 shrink-0 rounded-full border px-3 text-[10.5px] font-medium transition-colors", category === item.id ? "border-[#292B30] bg-[#292B30] text-white" : "border-black/[0.1] bg-white text-[#65676A]")}>{item.label}</button>)}</div>
              {loading && !entries.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <div key={index} className="h-[278px] animate-pulse rounded-[16px] border border-black/[0.06] bg-white" />)}</div> : null}
              {error ? <div role="alert" className="rounded-[13px] border border-[#C04B4B]/20 bg-[#FDF3F3] p-4 text-[12px] text-[#A43D3D]">{error}</div> : null}
              {!loading && !error && !entries.length ? <div className="rounded-[14px] border border-dashed border-black/[0.13] bg-white p-8 text-center text-[12px] text-[#818388]">No sources match these filters. Try clearing the search or category.</div> : null}
              {!loading && !error && isMarketplaceHome && marketplaceShelf.length ? <section aria-label="Marketplace shelf" className="mb-8"><div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#909398]">Front shelf</p><h3 className="mt-1 text-[15px] font-medium tracking-[-0.02em] text-[#34363A]">Explore a few well-framed routes</h3></div><span className="hidden max-w-[270px] text-right text-[10.5px] leading-[1.45] text-[#8A8D92] sm:block">Captured previews automatically rise here after a verified local run.</span></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1.33fr)_minmax(0,1fr)]"><FeaturedSourceCard entry={marketplaceShelf[0]} onChoose={choose} lead /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">{marketplaceShelf.slice(1).map((entry) => <FeaturedSourceCard key={entry.id} entry={entry} onChoose={choose} />)}</div></div></section> : null}
              {!loading && !error && entries.length ? <section aria-label="Source catalogue"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-[15px] font-medium tracking-[-0.02em] text-[#34363A]">{isMarketplaceHome ? "Browse every source" : "Matching sources"}</h3><span className="text-[10.5px] text-[#93959A]">{total} listings</span></div><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{entries.map((entry) => <SourceCard key={entry.id} entry={entry} onChoose={choose} />)}</div></section> : null}
              {nextOffset !== null ? <div className="mt-6 text-center"><button type="button" disabled={loading} onClick={() => void load(nextOffset, true)} className="h-9 rounded-[9px] border border-black/[0.1] bg-white px-3.5 text-[11.5px] font-medium text-[#5F6267] transition-colors hover:bg-black/[0.035] disabled:opacity-50">{loading ? "Loading…" : "Show more sources"}</button></div> : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
