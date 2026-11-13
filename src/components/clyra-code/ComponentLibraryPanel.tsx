import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft, Blocks, Check, CircleAlert,
  Code2, ExternalLink, Search, X,
} from "lucide-react";
import { api, type ComponentCatalogItem, type ComponentDetails } from "./api";
import { cn } from "../../lib/utils";
import { ComponentPreview } from "./ComponentPreview";

type SourceFilter = "all" | "shadcn" | "21st";
type LocalStatus = { id: "shadcn" | "21st"; available: boolean; detail: string };
const EASE = [0.22, 1, 0.36, 1] as const;
const SOURCE_NAMES = { shadcn: "shadcn/ui", "21st": "21st · Agent Elements" };

const CATEGORY_NAMES = [
  "Inputs & Controls", "Overlays & Menus", "Navigation",
  "Data & Feedback", "AI & Chat", "Agent Tools", "Layout & Content",
] as const;
function categoryOf(item: ComponentCatalogItem): string {
  const name = item.name;
  if (/button|input|form|field|textarea|select|checkbox|switch|radio|toggle|picker|otp|label/.test(name)) return "Inputs & Controls";
  if (/dialog|drawer|sheet|popover|tooltip|menu|command|alert/.test(name)) return "Overlays & Menus";
  if (/sidebar|tabs|breadcrumb|navigation|pagination|resizable|scroll-area/.test(name)) return "Navigation";
  if (/chart|table|calendar|progress|slider|skeleton|spinner|badge|toast/.test(name)) return "Data & Feedback";
  if (/agent-chat|message|markdown|shimmer|question|thinking|input-bar/.test(name)) return "AI & Chat";
  if (item.source === "21st" && /tool|subagent/.test(name)) return "Agent Tools";
  return "Layout & Content";
}

const GROUPS = [
  { label: "All components", id: "all" as const },
  { label: "shadcn/ui", id: "shadcn" as const },
  { label: "21st · Agent Elements", id: "21st" as const },
];

function GetButton({ label, loading, onClick, disabled = false }: {
  label: string; loading?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <motion.button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}
    disabled={loading || disabled} whileTap={loading ? undefined : { scale: 0.97 }}
    className="inline-flex h-[30px] min-w-[64px] items-center justify-center gap-1.5 rounded-full bg-[#F0F0F5] px-3 text-[12.5px] font-semibold text-[#3977F6] transition-colors hover:bg-[#E6E9F4] disabled:cursor-not-allowed disabled:opacity-55">
    {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3977F6]/20 border-t-[#3977F6]" /> : label}
  </motion.button>;
}

function SourceCard({ item, onOpen, onGet, onReference, busy, installed, referenced }: {
  item: ComponentCatalogItem; onOpen: () => void; onGet: () => void;
  onReference: () => void; busy: boolean; installed: boolean; referenced: boolean;
}) {
  return <div className="group min-w-0">
    <button type="button" onClick={onOpen}
      className="block w-full rounded-[15px] text-left outline-none transition-transform duration-200 group-hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#3977F6]/40"
      aria-label={"View " + item.title + " source and details"}>
      <ComponentPreview item={item} compact/>
    </button>
    <div className="mt-3 flex items-center gap-2.5 px-0.5">
      <span className="flex h-[37px] w-[37px] shrink-0 items-center justify-center rounded-[11px] bg-[#F2F4FA] text-[#3977F6]">
        {item.source === "21st" ? <Code2 className="h-[18px] w-[18px]" strokeWidth={1.6}/> : <Blocks className="h-[18px] w-[18px]" strokeWidth={1.6}/>}
      </span>
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="block w-full truncate text-left text-[13px] font-semibold tracking-[-0.01em] text-[#1D1D1F] hover:text-[#3977F6]">{item.title}</button>
        <div className="truncate text-[11.5px] text-[#8A8C93]">{SOURCE_NAMES[item.source]}</div>
      </div>
      <GetButton label={installed ? "Added" : "Get"} loading={busy} disabled={installed} onClick={onGet}/>
    </div>
    <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
      <span className="min-w-0 truncate text-[10px] text-[#a0a2a8]">{categoryOf(item)}</span>
      <button type="button" onClick={onReference} aria-label={"Reference " + item.title + " in chat"}
        className="shrink-0 rounded-lg px-2 py-1 text-[11px] text-[#3977F6] transition-colors hover:bg-[#3977F6]/[0.055]">
        {referenced ? "✓ Referenced" : "+ Reference"}
      </button>
    </div>
  </div>;
}

export function ComponentLibraryPanel({
  open, onClose, onReference, referencedIds, projectId,
}: {
  open: boolean;
  onClose: () => void;
  onReference: (item: ComponentCatalogItem) => void;
  referencedIds: string[];
  projectId?: string | null;
}) {
  const reducedMotion = useReducedMotion();
  const [source, setSource] = useState<SourceFilter>("all");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ComponentCatalogItem[]>([]);
  const [statuses, setStatuses] = useState<LocalStatus[]>([]);
  const [active, setActive] = useState<ComponentCatalogItem | null>(null);
  const [detail, setDetail] = useState<ComponentDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") active ? setActive(null) : onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose, open]);
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    void api.componentLibraryStatus().then(result => { if (mounted) setStatuses(result.sources); });
    return () => { mounted = false; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void api.componentCatalog({ source, q: query.trim() })
        .then(result => {
          if (controller.signal.aborted) return;
          setItems(result.items);
          setError(result.errors.map(e => e.message).join(" "));
        })
        .catch(e => { if (!controller.signal.aborted) { setItems([]); setError(e instanceof Error ? e.message : "Local catalogue unavailable."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, source, query]);
  useEffect(() => {
    if (!active) { setDetail(null); return; }
    let mounted = true;
    setDetail(null); setDetailLoading(true); setError("");
    void api.componentDetails(active.source, active.name)
      .then(data => { if (mounted) setDetail(data); })
      .catch(e => { if (mounted) setError(e instanceof Error ? e.message : "Could not read source."); })
      .finally(() => { if (mounted) setDetailLoading(false); });
    return () => { mounted = false; };
  }, [active]);
  const visibleItems = useMemo(
    () => category ? items.filter(item => categoryOf(item) === category) : items,
    [category, items],
  );
  const grouped = useMemo(() => {
    const groups = new Map<string, ComponentCatalogItem[]>();
    for (const item of visibleItems) groups.set(item.source, [...(groups.get(item.source) ?? []), item]);
    return [...groups.entries()];
  }, [visibleItems]);
  const install = async (item: ComponentCatalogItem) => {
    setNotice(""); setError("");
    if (!projectId) { setError("Open or create a project before adding components."); return; }
    setBusy(item.id);
    try {
      const result = await api.installComponent(projectId, item.source, item.name);
      setInstalled(prev => new Set([...prev, item.id]));
      onReference(item);
      setNotice(result.note + (result.dependenciesToInstall.length ?
        " Packages: " + result.dependenciesToInstall.join(", ") : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Component installation failed.");
    } finally { setBusy(null); }
  };
  const reference = (item: ComponentCatalogItem) => {
    onReference(item);
    setNotice(item.title + " added to your prompt references.");
  };
  const missing = statuses.filter(s => !s.available);
  return (
    <AnimatePresence>
      {open ? <div className="fixed inset-0 z-[115] flex min-h-0 overflow-hidden bg-white" role="presentation">
        <motion.aside role="dialog" aria-modal="true" aria-label="Clyra component library"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.4, ease: EASE }}
          className="relative flex h-full w-full min-w-0 flex-row bg-white">
          <aside className="hidden min-h-0 w-[232px] shrink-0 flex-col border-r border-black/[0.07] bg-[#F6F6F8]/95 px-2.5 pb-4 pt-3.5 md:flex" aria-label="Component navigation">
            <label className="relative mb-3 block px-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8E8E93]" />
              <input value={query} onChange={event => { setQuery(event.target.value); setActive(null); }}
                placeholder="Search" aria-label="Search component library"
                className="h-[30px] w-full rounded-[8px] border-0 bg-black/[0.055] pl-8 pr-3 text-[13px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus:bg-white focus:ring-2 focus:ring-[#007AFF]/20"/>
            </label>
            <nav className="cc-scroll min-h-0 flex-1 space-y-px overflow-y-auto pr-0.5" aria-label="Component categories">
              {GROUPS.map(group => <button type="button" key={group.id}
                onClick={() => { setSource(group.id); setCategory(""); setActive(null); }}
                aria-current={source === group.id && !category ? "page" : undefined}
                className={cn("flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition-colors",
                  source === group.id && !category ? "bg-black/[0.075] font-medium text-[#1D1D1F]" : "text-[#46484e] hover:bg-black/[0.04]")}>
                {group.id === "21st" ? <Code2 className="h-4 w-4 shrink-0 text-[#007AFF]"/> : <Blocks className="h-4 w-4 shrink-0 text-[#007AFF]"/>}
                <span className="truncate">{group.label}</span>
              </button>)}
              <p className="px-2 pb-1 pt-5 text-[11px] font-semibold text-[#8E8E93]">Categories</p>
              {CATEGORY_NAMES.map(name => {
                const count = items.filter(item => categoryOf(item) === name).length;
                return <button type="button" key={name} onClick={() => { setCategory(category === name ? "" : name); setActive(null); }}
                  className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12.5px] transition-colors",
                    category === name ? "bg-black/[0.075] font-medium text-[#1D1D1F]" : "text-[#555860] hover:bg-black/[0.04]")}>
                  <Blocks className="h-3.5 w-3.5 shrink-0 text-[#007AFF]"/>
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="text-[10px] tabular-nums text-[#9c9da4]">{count}</span>
                </button>;
              })}
            </nav>
            <p className="px-2 pt-3 text-[10.5px] leading-relaxed text-[#92949c]">
              Official, locally checked-out source. No hosted MCP or component API.
            </p>
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex h-[60px] shrink-0 items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              {active ? <button onClick={() => setActive(null)} className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#777] hover:bg-[#F4F4F5]" aria-label="Back to components"><ArrowLeft className="h-4 w-4"/></button> : <Blocks className="h-[18px] w-[18px] text-[#3977F6]" strokeWidth={1.6}/>}
              <span className="text-[14px] font-medium text-[#24262B]">{active ? "Component details" : category || "Components"}</span>
              {!active && <span className="text-[11px] text-[#999BA2]">Local library</span>}
            </div>
            <button onClick={onClose} aria-label="Close component library"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#777] hover:bg-[#F4F4F5]"><X className="h-4 w-4"/></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {active ? <div className="mx-auto max-w-[1100px] px-5 pb-12 sm:px-8">
              <div className="mt-3 grid gap-6 sm:grid-cols-[1.05fr_1fr]">
                <ComponentPreview item={active}/>
                <div className="flex flex-col justify-center">
                  <span className="text-[11px] font-medium text-[#8D8F95]">{SOURCE_NAMES[active.source]} · MIT</span>
                  <h2 className="mt-1.5 text-[27px] font-semibold tracking-[-0.03em] text-[#1D1D1F]">{active.title}</h2>
                  <p className="mt-2 text-[13px] leading-[1.6] text-[#77797F]">{active.description}</p>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <GetButton label={installed.has(active.id) ? "Added" : "Get"} loading={busy === active.id}
                      disabled={installed.has(active.id)} onClick={() => void install(active)} />
                    <button type="button" onClick={() => reference(active)}
                      className="rounded-full px-3 py-1.5 text-[12.5px] font-medium text-[#3977F6] hover:bg-[#3977F6]/[0.06]">
                      {referencedIds.includes("component:" + active.id) ? "Referenced" : "Reference in chat"}
                    </button>
                  </div>
                </div>
              </div>
              <section className="mt-9 border-t border-black/[0.07] pt-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[18px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Source code</h3>
                  <span className="text-[11px] text-[#8C8F97]">Official files · bundled locally</span>
                </div>
                {detailLoading ? <div className="mt-4 h-[180px] animate-pulse rounded-[13px] bg-[#F7F7F8]" /> : null}
                {detail?.files.map(file => <div key={file.path} className="mt-3 overflow-hidden rounded-[13px] border border-black/[0.07]">
                  <div className="flex items-center justify-between bg-[#F9F9FA] px-4 py-2.5 text-[11.5px] text-[#62656C]">
                    <span className="truncate">{file.path}</span>
                    <button type="button" className="ml-2 shrink-0 text-[#3977F6] hover:underline" onClick={() => navigator.clipboard.writeText(file.content)}>Copy</button>
                  </div>
                  <pre className="max-h-[310px] overflow-auto px-4 py-3 text-[11px] leading-[1.7] text-[#363A44]"><code>{file.content}</code></pre>
                </div>)}
              </section>
              {detail ? <section className="mt-7 border-t border-black/[0.07] pt-5">
                <h3 className="text-[18px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">Requirements</h3>
                <p className="mt-2 text-[12.5px] leading-[1.7] text-[#77797F]">
                  {detail.requirements.join(" · ")}. Installation copies real source files into your project. Some projects need additional npm packages.
                </p>
                <p className="mt-2 text-[11.5px] text-[#93959B]">Packages: {detail.dependencies.join(", ") || "None declared"}</p>
                <a href={active.docsUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3977F6]">
                  Official documentation <ExternalLink className="h-3.5 w-3.5"/>
                </a>
              </section> : null}
            </div> : <div className="mx-auto max-w-[1100px] px-5 pb-12 sm:px-8">
              <div className="pt-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#3977F6]">The Clyra Library</div>
                <h1 className="mt-1 text-[29px] font-semibold tracking-[-0.035em] text-[#1D1D1F]">Build with components.</h1>
                <p className="mt-1 text-[13px] text-[#86868B]">Browse the official open-source libraries. Add editable code directly to your project.</p>
              </div>
              <label className="mt-6 flex h-[42px] items-center gap-2.5 rounded-[11px] bg-[#F6F6F8] px-3.5 focus-within:ring-2 focus-within:ring-[#3977F6]/20">
                <Search className="h-4 w-4 shrink-0 text-[#9A9CA4]"/>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search components"
                  aria-label="Search gallery components" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#24262A] outline-none placeholder:text-[#A2A4AB]"/>
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-3.5 w-3.5 text-[#92949B]"/></button>}
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {GROUPS.map(group => <button key={group.id} type="button" onClick={() => { setSource(group.id); setCategory(""); }} aria-pressed={source === group.id && !category}
                  className={cn("rounded-full px-3.5 py-1.5 text-[12px] transition-colors", source === group.id
                    ? "bg-[#EAF1FF] font-medium text-[#3977F6]" : "text-[#777A82] hover:bg-[#F4F5F6]")}>{group.label}</button>)}
              </div>
              <div className="mt-6 flex items-center justify-between text-[11.5px] text-[#999BA1]">
                <span role="status">{loading ? "Reading local sources…" : visibleItems.length + " components"}</span>
                <span className="inline-flex items-center gap-1"><Check className="h-3 w-3"/> Offline after setup</span>
              </div>
              {loading ? <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">{Array.from({length:6},(_,i)=><div key={i} className="aspect-[13/10] animate-pulse rounded-[14px] bg-[#F5F5F7]"/>)}</div> : null}
              {!loading && !visibleItems.length ? <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center text-[12px] text-[#8C8F96]">
                <Search className="h-5 w-5"/><span>No components found in the local sources.</span>
              </div> : null}
              {grouped.map(([group, components]) => <section key={group} className="mt-6 border-t border-black/[0.07] pt-5">
                <div className="mb-4 flex items-baseline justify-between gap-2">
                  <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">{SOURCE_NAMES[group as "shadcn" | "21st"]}</h2>
                  <span className="text-[11px] text-[#999BA1]">{components.length} components</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 xl:grid-cols-4">
                  {components.map(item => <SourceCard key={item.id} item={item} onOpen={() => setActive(item)}
                    onGet={() => void install(item)} onReference={() => reference(item)}
                    referenced={referencedIds.includes("component:" + item.id)}
                    busy={busy === item.id} installed={installed.has(item.id)}/>)}
                </div>
              </section>)}
              <p className="mt-9 text-[11px] leading-relaxed text-[#999BA1]">
                shadcn/ui is bundled from shadcn-ui/ui. 21st is the public Agent Elements library, not the full hosted 21st.dev marketplace.
                The visual examples are illustrative, not screenshots of rendered upstream code. Open a component to inspect its real local source.
              </p>
            </div>}
          </div>
          {(error || notice || missing.length > 0) ? <div role="status" className="shrink-0 border-t border-black/[0.06] px-5 py-3 text-[11.5px] leading-[1.5] sm:px-8">
            {error && <p className="flex items-start gap-2 text-[#A16140]"><CircleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0"/>{error}</p>}
            {notice && <p className="flex items-start gap-2 text-[#407752]"><Check className="mt-[1px] h-3.5 w-3.5 shrink-0"/>{notice}</p>}
            {missing.length ? <p className="mt-1 text-[#777A80]">Set up local sources with <code className="text-[#50525A]">npm run setup:component-sources</code>. No API key required.</p> : null}
          </div> : null}
          </div>
        </motion.aside>
      </div> : null}
    </AnimatePresence>
  );
}
