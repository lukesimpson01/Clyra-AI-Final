import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Blocks, Check, CircleAlert, Component, Search, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { api, type ComponentCatalogItem } from "./api";

type SourceFilter = "all" | "shadcn" | "21st";
type SourceStatus = { id: "shadcn" | "21st"; available: boolean; detail: string };

/**
 * Compact visual sample for registry items without an upstream thumbnail.
 * It's a representative example, NOT a claim to render upstream source;
 * the docs link always opens the upstream's actual component documentation.
 */
function VisualSample({ item }: { item: ComponentCatalogItem }) {
  if (item.previewUrl) {
    return <img src={item.previewUrl} alt={item.title + " component preview"} loading="lazy"
      className="h-full w-full object-cover object-top" referrerPolicy="no-referrer" />;
  }
  const name = item.name.toLowerCase();
  const common = "text-[10px] text-[#4d4f54]";
  if (/^(button|button-group)$/.test(name)) return <div className="flex items-center gap-2"><span className="rounded-[7px] bg-[#202126] px-3 py-1.5 text-[10px] text-white">Button</span><span className="rounded-[7px] px-3 py-1.5 text-[10px] text-[#35363a] shadow-[inset_0_0_0_1px_#e7e7e8]">Secondary</span></div>;
  if (/^(input|textarea|input-group|field)$/.test(name)) return <div className="flex w-[86%] flex-col gap-1.5"><span className="text-[9px] text-[#777]">Email address</span><div className="rounded-lg px-2.5 py-2 text-[10px] text-[#a0a0a0] shadow-[inset_0_0_0_1px_#e7e7e8]">name@example.com</div></div>;
  if (/^(switch|checkbox|radio-group|toggle)$/.test(name)) return <div className="flex items-center gap-3"><div className="relative h-[18px] w-[33px] rounded-full bg-[#3977F6]"><span className="absolute right-[2px] top-[2px] h-[14px] w-[14px] rounded-full bg-white"/></div><span className={common}>Enabled</span></div>;
  if (/^(tabs|navigation-menu|menubar)$/.test(name)) return <div className="flex gap-4 text-[10px]"><span className="border-b-[1.5px] border-[#222] pb-1 text-[#222]">Overview</span><span className="text-[#a1a1a4]">Settings</span><span className="text-[#a1a1a4]">Activity</span></div>;
  if (/^(badge|status)$/.test(name)) return <div className="flex items-center gap-2"><span className="rounded-full bg-[#e9f2ff] px-2.5 py-1 text-[9px] text-[#3977F6]">Active</span><span className="rounded-full bg-[#f4f4f4] px-2.5 py-1 text-[9px] text-[#555]">Draft</span></div>;
  if (/^(card|hover-card)$/.test(name)) return <div className="w-[76%] rounded-xl bg-white p-3 shadow-[0_2px_13px_#0000000d,inset_0_0_0_1px_#e8e8e8]"><div className="text-[11px] text-[#222]">Project overview</div><div className="mt-1 text-[9px] text-[#aaa]">Your workspace at a glance</div><div className="mt-3 h-1.5 w-2/3 rounded bg-[#e9e9e9]"/></div>;
  if (/^(accordion|collapsible)$/.test(name)) return <div className="w-[82%] text-[10px] text-[#333]"><div className="flex justify-between py-1.5"><span>How does it work?</span><span>⌄</span></div><div className="h-px bg-[#ededed]" /><div className="flex justify-between py-1.5"><span>Getting started</span><span>⌄</span></div></div>;
  if (/^(table|data-table)$/.test(name)) return <div className="w-[88%] text-[9px] text-[#555]"><div className="flex justify-between border-b border-[#e8e8e8] pb-1.5"><span>Name</span><span>Status</span></div><div className="flex justify-between py-1.5"><span>Dashboard</span><span>Ready</span></div><div className="flex justify-between border-t border-[#efefef] py-1.5"><span>Settings</span><span>Draft</span></div></div>;
  if (/^(dialog|alert-dialog|drawer|sheet|popover)$/.test(name)) return <div className="w-[72%] rounded-xl bg-white p-3 shadow-[0_3px_18px_#00000015]"><div className="text-[10px] font-medium text-[#272727]">Confirm changes</div><div className="mt-1.5 h-1.5 w-[80%] rounded bg-[#ededed]"/><div className="mt-2.5 flex justify-end"><div className="rounded-md bg-[#252525] px-2 py-1 text-[9px] text-white">Continue</div></div></div>;
  if (/^(skeleton|progress|slider)$/.test(name)) return <div className="w-[72%] space-y-2"><div className="h-2 w-[85%] rounded-full bg-[#ededed]"/><div className="h-2 w-[58%] rounded-full bg-[#3977F6]/30"/></div>;
  return <div className="flex flex-col items-center gap-2 text-[#9a9ba0]"><Component className="h-[23px] w-[23px]" strokeWidth={1.25}/><span className="max-w-[150px] truncate text-[10px]">{item.title}</span></div>;
}

export function ComponentLibraryPanel({
  open, onClose, onReference, referencedIds,
}: {
  open: boolean;
  onClose: () => void;
  onReference: (item: ComponentCatalogItem) => void;
  referencedIds: string[];
}) {
  const reducedMotion = useReducedMotion();
  const [source, setSource] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<ComponentCatalogItem[]>([]);
  const [statuses, setStatuses] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Array<{ source: string; message: string }>>([]);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api.componentLibraryStatus().then(result => {
      if (!cancelled) setStatuses(result.sources);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void api.componentCatalog({ source, q: debouncedQuery })
      .then(result => {
        if (cancelled) return;
        setItems(result.items);
        setErrors(result.errors);
      })
      .catch(error => {
        if (cancelled) return;
        setItems([]);
        setErrors([{ source, message: error instanceof Error ? error.message : "Library could not load." }]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, source, debouncedQuery]);
  const countLabel = useMemo(() => loading ? "Scanning registries…" : items.length + " components", [items.length, loading]);
  const firstError = errors[0];
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[115] flex justify-end" role="presentation">
          <motion.div className="absolute inset-0 bg-black/[0.13]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }} />
          <motion.aside role="dialog" aria-modal="true" aria-label="Component library"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ duration: reducedMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex h-full w-full max-w-[430px] flex-col bg-white shadow-[-12px_0_45px_#00000011]">
            <div className="flex h-[62px] shrink-0 items-center justify-between px-5">
              <div className="flex items-center gap-2.5"><Blocks className="h-[17px] w-[17px] text-[#3977F6]" strokeWidth={1.65} /><h2 className="text-[14px] font-medium text-[#26282b]">Components</h2></div>
              <button onClick={onClose} type="button" title="Close component library" aria-label="Close component library"
                className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#85878d] transition-colors hover:bg-[#f4f4f3] hover:text-[#222]"><X className="h-4 w-4" strokeWidth={1.65}/></button>
            </div>
            <div className="px-5 pb-3">
              <label className="flex h-[38px] items-center gap-2 rounded-[10px] px-2.5 focus-within:bg-[#f7f8f9]">
                <Search className="h-[15px] w-[15px] text-[#a1a2a6]" strokeWidth={1.65}/>
                <input value={query} onChange={event => setQuery(event.target.value)}
                  aria-label="Search components" placeholder="Search components…"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#282a30] outline-none placeholder:text-[#a4a5aa]" />
                {query && <button onClick={() => setQuery("")} type="button" aria-label="Clear search" className="rounded-md p-1 text-[#8d8f94] hover:bg-[#ededed]"><X className="h-3 w-3"/></button>}
              </label>
              <div className="mt-2 flex items-center gap-1">
                {(["all", "shadcn", "21st"] as SourceFilter[]).map(value => {
                  const connected = statuses.find(status => status.id === value);
                  return <button type="button" key={value} onClick={() => setSource(value)}
                    aria-pressed={source === value}
                    className={cn("rounded-lg px-3 py-1.5 text-[11.5px] transition-colors hover:bg-[#f3f3f3]",
                      source === value ? "font-medium text-[#3977F6]" : "text-[#87898e]")}>
                    {value === "all" ? "All" : value === "shadcn" ? "shadcn/ui" : "21st.dev"}
                    {connected && !connected.available ? <span className="ml-1 text-[#b1b1b1]">·</span> : null}
                  </button>;
                })}
              </div>
            </div>
            <div className="flex items-center justify-between px-5 pb-2 text-[10.5px] text-[#9b9da1]">
              <span role="status">{countLabel}</span>
              <span>Click to reference</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
              {firstError && <div className="mb-3 flex gap-2 rounded-xl bg-[#fcf5ef] px-3 py-2.5 text-[11px] text-[#936442]">
                <CircleAlert className="mt-[1px] h-[13px] w-[13px] shrink-0"/>
                <span>{firstError.source}: {firstError.message}</span>
              </div>}
              {source !== "shadcn" && statuses.some(status => status.id === "21st" && !status.available) && (
                <div className="mb-3 px-1 py-2 text-[11px] leading-relaxed text-[#888b92]">
                  21st.dev requires an API key. Add <code className="text-[#575960]">API_KEY_21ST</code> to Clyra's backend environment to enable live search and installation.
                </div>
              )}
              {loading && !items.length && <div className="grid grid-cols-2 gap-2" aria-label="Loading components">
                {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[166px] animate-pulse rounded-xl bg-[#f8f8f8]"/>)}
              </div>}
              {!loading && !items.length && <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 px-8 text-center">
                <Search className="h-[21px] w-[21px] text-[#a6a8af]" strokeWidth={1.5}/>
                <div className="text-[12px] text-[#505258]">No components found</div>
                <div className="text-[11px] leading-relaxed text-[#a0a2a7]">Try a different term or check the registry connection.</div>
              </div>}
              <div className="grid grid-cols-2 gap-x-2 gap-y-3">
                {items.map(item => {
                  const selected = referencedIds.includes("component:" + item.id);
                  return <div key={item.id} className="group min-w-0 rounded-xl p-1.5 transition-colors hover:bg-[#f8f8f8]">
                    <button type="button" className="w-full text-left" onClick={() => onReference(item)} title={"Reference " + item.title}
                      aria-label={"Reference " + item.title + " from " + item.source}>
                      <div className="flex h-[108px] items-center justify-center overflow-hidden rounded-[10px] bg-[#fafafa]">
                        <VisualSample item={item}/>
                      </div>
                      <div className="flex min-w-0 items-center gap-1 pt-2">
                        <span className="flex-1 truncate text-[11.5px] font-medium text-[#323438]">{item.title}</span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[#3977F6]"/> : null}
                      </div>
                    </button>
                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="truncate text-[10px] text-[#a1a3a8]">{item.source === "shadcn" ? "shadcn/ui" : "21st.dev"}</span>
                      {item.docsUrl && <a href={item.docsUrl} target="_blank" rel="noopener noreferrer"
                        aria-label={"Open " + item.title + " documentation"}
                        className="rounded-md p-1 text-[#9b9da3] opacity-75 hover:bg-[#eee] hover:text-[#3977F6]"><ArrowUpRight className="h-3 w-3"/></a>}
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <div className="shrink-0 px-5 py-3 text-[10.5px] leading-relaxed text-[#999ba0]">
              References are passed to the coding agent. The agent installs compatible source through the actual MCP tools.
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
