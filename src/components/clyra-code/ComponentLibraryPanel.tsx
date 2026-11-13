import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Check, CircleAlert, Copy, ExternalLink, Play, Plus, RotateCw, Search, X } from "lucide-react";
import { api, type ComponentCatalogItem, type ComponentDetails } from "./api";
import { cn } from "../../lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
export const COMPONENT_PANEL_WIDTH = 420;
const SOURCE_LABEL = { shadcn: "shadcn/ui", "21st": "21st.dev" } as const;

const frameCache = new Map<string, Promise<string>>();
/** Frame documents are fetched once and handed to the sandbox as srcdoc. */
function loadFrame(src: string) {
  let existing = frameCache.get(src);
  if (!existing) {
    existing = fetch(src).then((response) => { if (!response.ok) throw new Error("preview"); return response.text(); });
    frameCache.set(src, existing);
    existing.catch(() => frameCache.delete(src));
  }
  return existing;
}

/** The real component, running in a sandboxed frame and scaled to fit its box. */
function LivePreview({ src, active = false, interactive = false, frameWidth = 480, frameHeight = 360, className, replayKey = 0 }: {
  src: string; active?: boolean; interactive?: boolean; frameWidth?: number; frameHeight?: number; className?: string; replayKey?: number;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [scale, setScale] = useState(0.4);
  const [near, setNear] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    if (!near) return;
    let live = true;
    void loadFrame(src).then((html) => { if (live) setDoc(html); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [near, src]);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setScale(element.clientWidth / frameWidth || 0.4);
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    const watch = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "320px 0px" });
    watch.observe(element);
    return () => { resize.disconnect(); watch.disconnect(); };
  }, [frameWidth]);
  useEffect(() => { setLoaded(false); setFailed(false); setDoc(null); }, [src]);
  const post = useCallback((type: "clyra-play" | "clyra-idle") => frame.current?.contentWindow?.postMessage({ type }, "*"), []);
  useEffect(() => { if (loaded) post(active ? "clyra-play" : "clyra-idle"); }, [active, loaded, post]);
  useEffect(() => { if (loaded && replayKey) post("clyra-play"); }, [replayKey, loaded, post]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "clyra-frame-ready") setLoaded(true);
      if (event.data?.type === "clyra-frame-error") setFailed(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <div ref={box} className={cn("relative isolate overflow-hidden bg-[#FAFAF9]", className)} style={{ aspectRatio: `${frameWidth} / ${frameHeight}` }}>
      <div aria-hidden className="absolute inset-0 -z-10 [background-image:radial-gradient(rgba(55,53,47,0.09)_1px,transparent_1px)] [background-size:14px_14px]" />
      {near && doc && !failed ? (
        <iframe
          ref={frame}
          srcDoc={doc}
          title="Live component preview"
          sandbox="allow-scripts"
          tabIndex={interactive ? 0 : -1}
          aria-hidden={interactive ? undefined : true}
          style={{ width: frameWidth, height: frameHeight, transform: `scale(${scale})`, transformOrigin: "0 0", opacity: loaded ? 1 : 0, transition: "opacity 320ms ease" }}
          className={cn("absolute left-0 top-0 border-0 bg-transparent", interactive ? "" : "pointer-events-none")}
        />
      ) : null}
      {!loaded && !failed ? <div aria-hidden className="cc-shimmer absolute inset-0" /> : null}
      {failed ? <div className="absolute inset-0 flex items-center justify-center text-[11.5px] text-[#A19E99]">Preview unavailable</div> : null}
    </div>
  );
}

function AddButton({ state, onClick, large = false }: { state: "idle" | "busy" | "added"; onClick: () => void; large?: boolean }) {
  const added = state === "added";
  return (
    <motion.button
      type="button"
      onClick={(event) => { event.stopPropagation(); if (state === "idle") onClick(); }}
      whileTap={state === "idle" ? { scale: 0.96 } : undefined}
      aria-label={added ? "Added" : "Add to project"}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#3977F6]/40",
        large ? "h-[34px] px-4 text-[13px]" : "h-[28px] px-3 text-[12px]",
        added ? "bg-[#3977F6]/[0.09] text-[#3977F6]" : "bg-[#3977F6] text-white hover:bg-[#2F6BE6]",
        state === "busy" && "opacity-70",
      )}
    >
      {state === "busy" ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
        : added ? <Check className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden />}
      {added ? "Added" : "Add"}
    </motion.button>
  );
}

function Card({ item, state, onOpen, onAdd }: { item: ComponentCatalogItem; state: "idle" | "busy" | "added"; onOpen: () => void; onAdd: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group min-w-0"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
    >
      <button
        type="button" onClick={onOpen} aria-label={"Open " + item.title}
        className="relative block w-full overflow-hidden rounded-[14px] text-left outline-none ring-1 ring-inset ring-black/[0.07] transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(20,24,32,0.35)] focus-visible:ring-2 focus-visible:ring-[#3977F6]/50"
      >
        <LivePreview src={item.previewUrl} active={hover} />
        <span className={cn("pointer-events-none absolute right-2 top-2 inline-flex h-[22px] items-center gap-1 rounded-full bg-white/90 px-2 text-[10.5px] font-medium text-[#5F5E59] shadow-sm backdrop-blur transition-opacity duration-200", hover ? "opacity-100" : "opacity-0")}>
          <Play className="h-2.5 w-2.5 fill-current" aria-hidden /> Live
        </span>
      </button>
      <div className="mt-2 flex items-center gap-2 px-0.5">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none">
          <span className="block truncate text-[13px] font-semibold tracking-[-0.01em] text-[#2C2C2B] group-hover:text-[#3977F6]">{item.title}</span>
          <span className="block truncate text-[11.5px] text-[#8A8884]">{item.category}</span>
        </button>
        <AddButton state={state} onClick={onAdd} />
      </div>
    </div>
  );
}

function Detail({ item, state, onAdd, onBack, referenced }: { item: ComponentCatalogItem; state: "idle" | "busy" | "added"; onAdd: () => void; onBack: () => void; referenced: boolean }) {
  const [variant, setVariant] = useState(item.previewUrl);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [detail, setDetail] = useState<ComponentDetails | null>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => { setVariant(item.previewUrl); setTab("preview"); }, [item]);
  useEffect(() => {
    let live = true;
    setDetail(null);
    void api.componentDetails(item.source, item.name).then((data) => { if (live) setDetail(data); }).catch(() => undefined);
    return () => { live = false; };
  }, [item]);
  const variants = [{ name: "default", title: "Default", previewUrl: item.previewUrl }, ...item.examples];
  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.32, ease: EASE }} className="absolute inset-0 flex flex-col bg-white">
      <div className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <button type="button" onClick={onBack} aria-label="Back to components" className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#78766F] transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#3977F6]/40"><ArrowLeft className="h-4 w-4" /></button>
        <span className="text-[13px] font-medium text-[#78766F]">{item.category}</span>
      </div>
      <div className="cc-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-8">
        <div className="overflow-hidden rounded-[16px] ring-1 ring-inset ring-black/[0.07]">
          <LivePreview src={variant} interactive frameWidth={560} frameHeight={380} replayKey={replay} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11.5px] text-[#8A8884]">
          <span>Live component · interact with it</span>
          <button type="button" onClick={() => setReplay((value) => value + 1)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-[#3977F6] hover:bg-[#3977F6]/[0.07]"><RotateCw className="h-3 w-3" aria-hidden /> Replay</button>
        </div>
        <div className="mt-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.028em] text-[#2C2C2B]">{item.title}</h2>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#78766F]">{item.description}</p>
          </div>
          <AddButton state={state} onClick={onAdd} large />
        </div>
        {referenced ? <p className="mt-3 rounded-[10px] bg-[#3977F6]/[0.06] px-3 py-2 text-[12px] leading-[1.5] text-[#2F5FC4]">Referenced in your composer. Tell Clyra what to do with it and where to add it.</p> : null}
        {variants.length > 1 ? (
          <section className="mt-6" aria-label="Variants">
            <h3 className="text-[13px] font-semibold text-[#2C2C2B]">Variants</h3>
            <div className="cc-scroll mt-2 flex gap-2.5 overflow-x-auto pb-2 [scrollbar-width:none]">
              {variants.map((entry) => (
                <button key={entry.name} type="button" onClick={() => setVariant(entry.previewUrl)} aria-pressed={variant === entry.previewUrl}
                  className={cn("w-[132px] shrink-0 overflow-hidden rounded-[11px] text-left outline-none ring-1 ring-inset transition-shadow focus-visible:ring-2 focus-visible:ring-[#3977F6]/50", variant === entry.previewUrl ? "ring-2 ring-[#3977F6]" : "ring-black/[0.08] hover:ring-black/[0.2]")}>
                  <LivePreview src={entry.previewUrl} frameWidth={480} frameHeight={360} />
                  <span className="block truncate bg-white px-2 py-1.5 text-[11px] text-[#5F5E59]">{entry.title}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <div className="mt-6 flex items-center gap-1 border-b border-black/[0.07]" role="tablist">
          {(["preview", "code"] as const).map((name) => (
            <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}
              className={cn("-mb-px border-b-2 px-2.5 pb-2 pt-1 text-[12.5px] font-medium transition-colors", tab === name ? "border-[#2C2C2B] text-[#2C2C2B]" : "border-transparent text-[#8A8884] hover:text-[#2C2C2B]")}>
              {name === "preview" ? "About" : "Source"}
            </button>
          ))}
        </div>
        {tab === "preview" ? (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[12.5px]">
            <dt className="text-[#8A8884]">Library</dt><dd className="text-[#2C2C2B]">{SOURCE_LABEL[item.source]} · MIT</dd>
            <dt className="text-[#8A8884]">Packages</dt><dd className="text-[#2C2C2B]">{detail ? (detail.dependencies.join(", ") || "None") : "…"}</dd>
            <dt className="text-[#8A8884]">Files added</dt><dd className="text-[#2C2C2B]">{detail ? detail.files.length : "…"}</dd>
            <dt className="text-[#8A8884]">Origin</dt>
            <dd><a href={item.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#3977F6] hover:underline">{item.origin} <ExternalLink className="h-3 w-3" aria-hidden /></a></dd>
          </dl>
        ) : (
          <div className="mt-3 space-y-3">
            {!detail ? <div className="h-[160px] animate-pulse rounded-[12px] bg-[#F7F6F5]" /> : null}
            {detail?.files.map((file) => (
              <div key={file.path} className="overflow-hidden rounded-[12px] ring-1 ring-inset ring-black/[0.07]">
                <div className="flex items-center justify-between bg-[#F7F6F5] px-3 py-2 text-[11.5px] text-[#5F5E59]">
                  <span className="truncate">{file.path}</span>
                  <button type="button" onClick={() => { void navigator.clipboard?.writeText(file.content); setCopied(file.path); window.setTimeout(() => setCopied(""), 1400); }}
                    className="ml-2 inline-flex shrink-0 items-center gap-1 font-medium text-[#3977F6] hover:underline">{copied === file.path ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied === file.path ? "Copied" : "Copy"}</button>
                </div>
                <pre className="cc-scroll max-h-[300px] overflow-auto px-3 py-2.5 text-[11px] leading-[1.65] text-[#363A44]"><code>{file.content}</code></pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ComponentLibraryPanel({ open, onClose, onReference, referencedIds, projectId, projectName, docked = true }: {
  open: boolean;
  onClose: () => void;
  onReference: (item: ComponentCatalogItem) => void;
  referencedIds: string[];
  projectId?: string | null;
  projectName?: string | null;
  /** Docked beside the rail (pushes the workspace); otherwise it overlays it. */
  docked?: boolean;
}) {
  const reduced = useReducedMotion();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<ComponentCatalogItem[]>([]);
  const [categories, setCategories] = useState<Array<{ name: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<ComponentCatalogItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<{ tone: "ok" | "info" | "error"; text: string } | null>(null);
  const search = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") { if (active) setActive(null); else onClose(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose, open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void api.componentCatalog({ q: query.trim(), category })
        .then((result) => {
          if (controller.signal.aborted) return;
          setItems(result.items);
          if (!query.trim() && !category) setCategories(result.categories);
          setError(result.errors.map((entry) => entry.message).join(" "));
        })
        .catch((reason) => { if (!controller.signal.aborted) { setItems([]); setError(reason instanceof Error ? reason.message : "The component library could not be read."); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 180 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, category]);

  useEffect(() => { if (open && !active) window.setTimeout(() => search.current?.focus({ preventScroll: true }), 380); }, [open, active]);
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 4800); return () => window.clearTimeout(id); }, [toast]);

  const add = useCallback(async (item: ComponentCatalogItem) => {
    setBusy(item.id);
    onReference(item);
    try {
      if (!projectId) throw new Error("NO_PROJECT");
      const result = await api.installComponent(projectId, item.source, item.name);
      setAdded((previous) => new Set(previous).add(item.id));
      setToast({ tone: "ok", text: item.title + " added" + (projectName ? " to " + projectName : "") + ". " + (result.dependenciesToInstall.length ? "Install " + result.dependenciesToInstall.join(", ") + " to finish." : "Tell Clyra where to use it.") });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "";
      if (message === "NO_PROJECT" || /needs a React|require a React|Open or create/.test(message)) {
        setAdded((previous) => new Set(previous).add(item.id));
        setToast({ tone: "info", text: item.title + " is referenced. Say where to add it and Clyra will bring the source in." });
      } else setToast({ tone: "error", text: message || "That component could not be added." });
    } finally { setBusy(null); }
  }, [onReference, projectId, projectName]);

  const stateOf = (item: ComponentCatalogItem): "idle" | "busy" | "added" => busy === item.id ? "busy" : added.has(item.id) ? "added" : "idle";
  const total = useMemo(() => categories.reduce((sum, entry) => sum + entry.count, 0), [categories]);
  const cloning = error && /not cloned/i.test(error) && !items.length;

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="component-panel" role="complementary" aria-label="Component library"
          initial={docked ? { width: 0, opacity: 0.6 } : { x: -16, opacity: 0 }}
          animate={docked ? { width: COMPONENT_PANEL_WIDTH, opacity: 1 } : { x: 0, opacity: 1 }}
          exit={docked ? { width: 0, opacity: 0 } : { x: -16, opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.42, ease: EASE }}
          className={cn("relative z-[60] flex h-full min-h-0 shrink-0 overflow-hidden border-r border-black/[0.08] bg-white", docked ? "" : "absolute inset-y-0 left-0 w-[min(100%,420px)] shadow-[8px_0_32px_-20px_rgba(20,24,32,0.4)]")}
        >
          <div className="relative flex h-full min-h-0 flex-col bg-white" style={{ width: docked ? COMPONENT_PANEL_WIDTH : "100%" }}>
            <header className="shrink-0 px-4 pb-2 pt-3">
              <div className="flex h-8 items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[#2C2C2B]">Components</h2>
                  {total ? <span className="text-[12px] tabular-nums text-[#A19E99]">{total}</span> : null}
                </div>
                <button type="button" onClick={onClose} aria-label="Close components" className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[#78766F] transition-colors hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-[#3977F6]/40"><X className="h-4 w-4" /></button>
              </div>
              <label className="mt-2 flex h-[38px] items-center gap-2 rounded-[12px] bg-[rgba(55,53,47,0.055)] px-3 transition-shadow focus-within:bg-white focus-within:shadow-[0_0_0_2px_rgba(57,119,246,0.3)]">
                <Search className="h-3.5 w-3.5 shrink-0 text-[#8A8884]" aria-hidden />
                <input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search components" aria-label="Search components"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[#2C2C2B] outline-none placeholder:text-[#A19E99]" />
                {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-[#A19E99] hover:text-[#2C2C2B]"><X className="h-3.5 w-3.5" /></button> : null}
              </label>
              <div role="tablist" aria-label="Categories" className="cc-scroll -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {[{ name: "", label: "All", count: total }, ...categories.map((entry) => ({ name: entry.name, label: entry.name, count: entry.count }))].map((entry) => (
                  <button key={entry.name || "all"} type="button" role="tab" aria-selected={category === entry.name} onClick={() => setCategory(entry.name)}
                    className={cn("inline-flex h-[28px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#3977F6]/40",
                      category === entry.name ? "bg-[#2C2C2B] text-white" : "bg-[rgba(55,53,47,0.06)] text-[#5F5E59] hover:bg-[rgba(55,53,47,0.1)]")}>
                    {entry.label}
                    {entry.count ? <span className={cn("text-[10.5px] tabular-nums", category === entry.name ? "text-white/60" : "text-[#A19E99]")}>{entry.count}</span> : null}
                  </button>
                ))}
              </div>
            </header>
            <div className="cc-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-10 pt-2">
              {cloning ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-center">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-[#3977F6]" aria-hidden />
                  <p className="max-w-[280px] text-[12.5px] leading-[1.55] text-[#78766F]">Getting the shadcn/ui and 21st libraries from GitHub. This only happens the first time.</p>
                </div>
              ) : null}
              {loading && !items.length && !cloning ? (
                <div className="grid grid-cols-2 gap-3">{Array.from({ length: 8 }, (_, index) => <div key={index} className="cc-shimmer aspect-[4/3] rounded-[14px]" />)}</div>
              ) : null}
              {!loading && !items.length && !cloning ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 text-center text-[12.5px] text-[#8A8884]"><Search className="h-5 w-5" aria-hidden />No components match “{query}”.</div>
              ) : null}
              {error && !cloning ? <p className="mb-3 flex items-start gap-2 rounded-[10px] bg-[#C0463F]/[0.07] px-3 py-2 text-[12px] leading-[1.5] text-[#A33A34]"><CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}</p> : null}
              {items.length ? (
                <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                  {items.map((item) => <Card key={item.id} item={item} state={stateOf(item)} onOpen={() => setActive(item)} onAdd={() => void add(item)} />)}
                </div>
              ) : null}
            </div>
            <AnimatePresence>
              {active ? <Detail key={active.id} item={active} state={stateOf(active)} onAdd={() => void add(active)} onBack={() => setActive(null)} referenced={referencedIds.includes("component:" + active.id)} /> : null}
            </AnimatePresence>
            <AnimatePresence>
              {toast ? (
                <motion.div role="status" aria-live="polite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.24, ease: EASE }}
                  className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-start gap-2.5 rounded-[14px] bg-[#2C2C2B] px-3.5 py-2.5 text-[12.5px] leading-[1.45] text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
                  {toast.tone === "error" ? <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF9C94]" aria-hidden /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7FB0FF]" aria-hidden />}
                  <span>{toast.text}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
