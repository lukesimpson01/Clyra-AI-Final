import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft, Blocks, Check, CircleAlert,
  Code2, ExternalLink, Search, X,
} from "lucide-react";
import { api, type ComponentCatalogItem, type ComponentDetails } from "./api";
import { cn } from "../../lib/utils";

type SourceFilter = "all" | "shadcn" | "21st";
type LocalStatus = { id: "shadcn" | "21st"; available: boolean; detail: string };
const EASE = [0.22, 1, 0.36, 1] as const;
const SOURCE_NAMES = { shadcn: "shadcn/ui", "21st": "21st · Agent Elements" };

const GROUPS = [
  { label: "All components", id: "all" as const },
  { label: "shadcn/ui", id: "shadcn" as const },
  { label: "21st · Agent Elements", id: "21st" as const },
];

function ComponentArt({ item, compact = false }: { item: ComponentCatalogItem; compact?: boolean }) {
  // Editorial source artwork, not a claim to display a rendered upstream component.
  const is21st = item.source === "21st";
  return (
    <div className={cn(
      "relative isolate flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[14px]",
      is21st ? "bg-[#EAF1FC]" : "bg-[#F3F4F6]",
    )}>
      <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/60 blur-3xl" />
      <div className={cn(
        "relative flex w-[76%] flex-col gap-2.5 rounded-[14px] border border-black/[0.035] bg-white px-4 shadow-[0_12px_35px_rgba(20,30,55,0.075)]",
        compact ? "py-4" : "py-5",
      )}>
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-[7px] bg-[#3977F6]/[0.10] text-[#3977F6] flex items-center justify-center">
            {is21st ? <Code2 className="h-3.5 w-3.5" strokeWidth={1.7}/> : <Blocks className="h-3.5 w-3.5" strokeWidth={1.7}/>}
          </span>
          <span className="min-w-0 truncate text-[11px] font-medium text-[#27292D]">{item.title}</span>
        </div>
        <div className="h-[5px] w-[88%] rounded-full bg-[#E9EBF0]" />
        <div className="h-[5px] w-[62%] rounded-full bg-[#F0F1F4]" />
        <div className="flex gap-1.5 pt-1">
          <div className="h-5 w-[54px] rounded-[6px] bg-[#3977F6]/85"/>
          <div className="h-5 w-[45px] rounded-[6px] bg-[#F1F2F4]"/>
        </div>
      </div>
      <span className="absolute bottom-2 right-2 rounded-full bg-white/85 px-2 py-0.5 text-[9px] text-[#8A8C92]">
        Source artwork
      </span>
    </div>
  );
}

function GetButton({ label, loading, onClick, disabled = false }: {
  label: string; loading?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <motion.button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}
    disabled={loading || disabled} whileTap={loading ? undefined : { scale: 0.97 }}
    className="inline-flex h-[30px] min-w-[64px] items-center justify-center gap-1.5 rounded-full bg-[#F0F0F5] px-3 text-[12.5px] font-semibold text-[#3977F6] transition-colors hover:bg-[#E6E9F4] disabled:cursor-not-allowed disabled:opacity-55">
    {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3977F6]/20 border-t-[#3977F6]" /> : label}
  </motion.button>;
}

function SourceCard({ item, onOpen, onGet, busy, installed }: {
  item: ComponentCatalogItem; onOpen: () => void; onGet: () => void; busy: boolean; installed: boolean;
}) {
  return <div className="group min-w-0">
    <button type="button" onClick={onOpen}
      className="block w-full rounded-[15px] text-left outline-none transition-transform duration-200 group-hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[#3977F6]/40"
      aria-label={"View " + item.title + " source and details"}>
      <ComponentArt item={item} compact/>
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
  const grouped = useMemo(() => {
    const groups = new Map<string, ComponentCatalogItem[]>();
    for (const item of items) groups.set(item.source, [...(groups.get(item.source) ?? []), item]);
    return [...groups.entries()];
  }, [items]);
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
      {open ? <div className="fixed inset-0 z-[115] flex justify-end" role="presentation">
        <motion.div className="absolute inset-0 bg-black/[0.16]" onClick={onClose}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}/>
        <motion.aside role="dialog" aria-modal="true" aria-label="Clyra component library"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ duration: reducedMotion ? 0 : 0.4, ease: EASE }}
          className="relative flex h-full w-full max-w-[780px] flex-col bg-white shadow-[-16px_0_60px_#00000018]">
          <header className="flex h-[60px] shrink-0 items-center justify-between px-5 sm:px-8">
            <div className="flex items-center gap-3">
              {active ? <button onClick={() => setActive(null)} className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#777] hover:bg-[#F4F4F5]" aria-label="Back to components"><ArrowLeft className="h-4 w-4"/></button> : <Blocks className="h-[18px] w-[18px] text-[#3977F6]" strokeWidth={1.6}/>}
              <span className="text-[14px] font-medium text-[#24262B]">{active ? "Component details" : "Components"}</span>
              {!active && <span className="text-[11px] text-[#999BA2]">Local library</span>}
            </div>
            <button onClick={onClose} aria-label="Close component library"
              className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#777] hover:bg-[#F4F4F5]"><X className="h-4 w-4"/></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {active ? <div className="mx-auto max-w-[710px] px-5 pb-12 sm:px-8">
              <div className="mt-3 grid gap-6 sm:grid-cols-[1.05fr_1fr]">
                <ComponentArt item={active}/>
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
            </div> : <div className="mx-auto max-w-[730px] px-5 pb-12 sm:px-8">
              <div className="pt-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#3977F6]">The Clyra Library</div>
                <h1 className="mt-1 text-[29px] font-semibold tracking-[-0.035em] text-[#1D1D1F]">Build with components.</h1>
                <p className="mt-1 text-[13px] text-[#86868B]">Browse the official open-source libraries. Add editable code directly to your project.</p>
              </div>
              <label className="mt-6 flex h-[42px] items-center gap-2.5 rounded-[11px] bg-[#F6F6F8] px-3.5 focus-within:ring-2 focus-within:ring-[#3977F6]/20">
                <Search className="h-4 w-4 shrink-0 text-[#9A9CA4]"/>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search components"
                  aria-label="Search components" className="min-w-0 flex-1 bg-transparent text-[13px] text-[#24262A] outline-none placeholder:text-[#A2A4AB]"/>
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X className="h-3.5 w-3.5 text-[#92949B]"/></button>}
              </label>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {GROUPS.map(group => <button key={group.id} type="button" onClick={() => setSource(group.id)} aria-pressed={source === group.id}
                  className={cn("rounded-full px-3.5 py-1.5 text-[12px] transition-colors", source === group.id
                    ? "bg-[#EAF1FF] font-medium text-[#3977F6]" : "text-[#777A82] hover:bg-[#F4F5F6]")}>{group.label}</button>)}
              </div>
              <div className="mt-6 flex items-center justify-between text-[11.5px] text-[#999BA1]">
                <span role="status">{loading ? "Reading local sources…" : items.length + " components"}</span>
                <span className="inline-flex items-center gap-1"><Check className="h-3 w-3"/> Offline after setup</span>
              </div>
              {loading ? <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">{Array.from({length:6},(_,i)=><div key={i} className="aspect-[13/10] animate-pulse rounded-[14px] bg-[#F5F5F7]"/>)}</div> : null}
              {!loading && !items.length ? <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 text-center text-[12px] text-[#8C8F96]">
                <Search className="h-5 w-5"/><span>No components found in the local sources.</span>
              </div> : null}
              {grouped.map(([group, components]) => <section key={group} className="mt-6 border-t border-black/[0.07] pt-5">
                <div className="mb-4 flex items-baseline justify-between gap-2">
                  <h2 className="text-[20px] font-semibold tracking-[-0.025em] text-[#1D1D1F]">{SOURCE_NAMES[group as "shadcn" | "21st"]}</h2>
                  <span className="text-[11px] text-[#999BA1]">{components.length} components</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3">
                  {components.map(item => <SourceCard key={item.id} item={item} onOpen={() => setActive(item)}
                    onGet={() => void install(item)} busy={busy === item.id} installed={installed.has(item.id)}/>)}
                </div>
              </section>)}
              <p className="mt-9 text-[11px] leading-relaxed text-[#999BA1]">
                shadcn/ui is bundled from shadcn-ui/ui. 21st is the public Agent Elements library, not the full hosted 21st.dev marketplace.
                Source artwork is editorial; open a component to inspect its real code.
              </p>
            </div>}
          </div>
          {(error || notice || missing.length > 0) ? <div role="status" className="shrink-0 border-t border-black/[0.06] px-5 py-3 text-[11.5px] leading-[1.5] sm:px-8">
            {error && <p className="flex items-start gap-2 text-[#A16140]"><CircleAlert className="mt-[1px] h-3.5 w-3.5 shrink-0"/>{error}</p>}
            {notice && <p className="flex items-start gap-2 text-[#407752]"><Check className="mt-[1px] h-3.5 w-3.5 shrink-0"/>{notice}</p>}
            {missing.length ? <p className="mt-1 text-[#777A80]">Set up local sources with <code className="text-[#50525A]">npm run setup:component-sources</code>. No API key required.</p> : null}
          </div> : null}
        </motion.aside>
      </div> : null}
    </AnimatePresence>
  );
}
