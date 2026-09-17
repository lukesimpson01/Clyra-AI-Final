import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Activity, AppWindow, ChevronRight, CircleCheck, FolderSearch, HardDrive, ShieldCheck, Sparkles, Trash2 } from "lucide-react";

type CarePage = "Overview" | "Smart Scan" | "Cleanup" | "Storage" | "Duplicates" | "Applications" | "Startup" | "Performance" | "Privacy" | "System" | "Clyra AI";

const pages: Array<{ name: CarePage; icon: typeof Activity }> = [
  { name: "Overview", icon: Activity }, { name: "Smart Scan", icon: Sparkles }, { name: "Cleanup", icon: Trash2 }, { name: "Storage", icon: HardDrive },
  { name: "Duplicates", icon: FolderSearch }, { name: "Applications", icon: AppWindow }, { name: "Startup", icon: Activity }, { name: "Performance", icon: Activity },
  { name: "Privacy", icon: ShieldCheck }, { name: "System", icon: Activity }, { name: "Clyra AI", icon: Sparkles },
];

const results = [
  { title: "Application caches", detail: "Recreated automatically by installed apps", size: "3.8 GB", risk: "Safe" },
  { title: "Temporary files", detail: "Old temporary extraction and diagnostic files", size: "1.4 GB", risk: "Safe" },
  { title: "Old installers", detail: "Downloaded disk images and setup packages", size: "2.1 GB", risk: "Review" },
  { title: "Browser history & sessions", detail: "Personal history — never selected automatically", size: "640 MB", risk: "Review" },
];

function Meter({ value, label, sublabel, color = "bg-[#3977f6]" }: { value: number; label: string; sublabel: string; color?: string }) {
  return <div className="rounded-2xl border border-black/[.07] bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,.035)]">
    <div className="flex items-start justify-between"><div><p className="text-[13px] font-medium text-[#303136]">{label}</p><p className="mt-1 text-[12px] text-[#8c8d93]">{sublabel}</p></div><span className="text-[15px] font-semibold tracking-tight text-[#303136]">{value}%</span></div>
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#ececea]"><motion.div initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: .7, ease: [0.22,1,.36,1] }} className={`h-full rounded-full ${color}`} /></div>
  </div>;
}

export function ClyraCareWorkspace() {
  const [page, setPage] = useState<CarePage>("Overview");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [complete, setComplete] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => setProgress((current) => {
      const next = Math.min(100, current + 8);
      if (next === 100) { window.clearInterval(timer); setScanning(false); setComplete(true); }
      return next;
    }), 240);
    return () => window.clearInterval(timer);
  }, [scanning]);
  const scan = () => { setPage("Smart Scan"); setComplete(false); setProgress(0); setScanning(true); };
  const currentDirectory = useMemo(() => progress < 35 ? "Checking safe temporary storage…" : progress < 70 ? "Reviewing installed applications…" : "Summarising results…", [progress]);
  return <div data-care-motion={reduceMotion ? "reduced" : "full"} className="flex h-full min-h-0 bg-[#fbfbfa] font-sans text-[#303136]">
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-black/[.07] bg-[#f7f7f6] px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2 text-[13px] font-semibold tracking-tight"><span className="grid h-5 w-5 place-items-center rounded-md bg-[#3977f6] text-[11px] text-white">C</span> Clyra Care</div>
      <nav className="grid gap-0.5">{pages.map(({ name, icon: Icon }) => <button key={name} onClick={() => setPage(name)} className={`flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[12.5px] transition-colors ${page === name ? "bg-black/[.055] text-[#303136] font-medium" : "text-[#6f7076] hover:bg-black/[.035]"}`}><Icon className="h-3.5 w-3.5 stroke-[1.7]" />{name}</button>)}</nav>
      <button className="mt-auto flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-[#77787d] hover:bg-black/[.035]"><Activity className="h-3.5 w-3.5" />Settings</button>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto">
      <header className="sticky top-0 z-10 flex h-[58px] items-center justify-between border-b border-black/[.055] bg-[#fbfbfa]/90 px-8 backdrop-blur"><div><p className="text-[14px] font-semibold">{page}</p><p className="mt-0.5 text-[11px] text-[#999a9f]">Local-first system care</p></div><button onClick={scan} disabled={scanning} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#3977f6] px-3.5 text-[12.5px] font-medium text-white shadow-sm transition-transform hover:scale-[1.015] active:scale-[.98] disabled:opacity-60"><Sparkles className="h-3.5 w-3.5" />{scanning ? "Scanning…" : "Smart Scan"}</button></header>
      <div className="mx-auto max-w-[1120px] p-8">
        {page === "Overview" && <>
          <div className="flex items-end justify-between"><div><p className="text-[28px] font-semibold tracking-[-.045em]">Your Mac looks healthy.</p><p className="mt-2 max-w-xl text-[13px] leading-6 text-[#77787d]">Storage is your main opportunity. Clyra only suggests changes with a measurable reason and a clear rollback path.</p></div><span className="hidden rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 sm:inline-flex">No urgent issues</span></div>
          <div className="mt-7 grid gap-3 md:grid-cols-3"><Meter value={68} label="System drive" sublabel="326 GB of 480 GB used" /><Meter value={42} label="Memory" sublabel="6.7 GB of 16 GB in use" color="bg-[#69717e]" /><Meter value={18} label="CPU" sublabel="Normal background activity" color="bg-[#69717e]" /></div>
          <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><section className="rounded-2xl border border-black/[.07] bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,.035)]"><div className="flex items-center justify-between"><div><p className="text-[13px] font-semibold">Reclaimable storage</p><p className="mt-1 text-[12px] text-[#85868b]">Found in the last completed scan</p></div><p className="text-[25px] font-semibold tracking-[-.04em]">7.3 GB</p></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-[#f0f0ee]"><div className="h-full w-[62%] rounded-full bg-[#3977f6]" /></div><div className="mt-3 flex justify-between text-[11px] text-[#929399]"><span>154 GB free now</span><span>Estimated after cleanup: 161.3 GB</span></div></section><section className="rounded-2xl border border-black/[.07] bg-white p-5"><p className="text-[13px] font-semibold">Care status</p><div className="mt-4 space-y-3 text-[12px]">{[["Last scan", "Never"],["Last cleanup", "Never"],["Startup impact", "Low"]].map(([k,v]) => <div key={k} className="flex justify-between"><span className="text-[#87888d]">{k}</span><span className="font-medium">{v}</span></div>)}</div></section></div>
        </>}
        {page === "Smart Scan" && <section className="max-w-2xl"><p className="text-[28px] font-semibold tracking-[-.045em]">Smart Scan</p><p className="mt-2 text-[13px] leading-6 text-[#77787d]">Clyra checks safe cleanup, storage, applications and system health locally. Nothing is removed by a scan.</p>{scanning ? <div className="mt-8 rounded-2xl border border-black/[.07] bg-white p-6"><div className="flex items-center justify-between"><p className="text-[14px] font-medium">Scanning {Math.round(progress * 1834)} files…</p><p className="text-[13px] text-[#3977f6]">{progress}%</p></div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#ededeb]"><motion.div animate={{ width: `${progress}%` }} className="h-full rounded-full bg-[#3977f6]" /></div><p className="mt-4 text-[12px] text-[#898a8f]">{currentDirectory}</p><button onClick={() => setScanning(false)} className="mt-5 text-[12px] font-medium text-[#5d6573] hover:text-[#303136]">Pause scan</button></div> : complete ? <ScanResults onCleanup={() => setPage("Cleanup")} /> : <button onClick={scan} className="mt-7 rounded-lg bg-[#3977f6] px-4 py-2.5 text-[13px] font-medium text-white">Run Smart Scan</button>}</section>}
        {(page === "Cleanup" || (page === "Smart Scan" && complete)) && <ScanResults onCleanup={() => setPage("Cleanup")} />}
        {page !== "Overview" && page !== "Smart Scan" && page !== "Cleanup" && <section className="rounded-2xl border border-dashed border-black/[.13] bg-white/60 px-6 py-14 text-center"><FolderSearch className="mx-auto h-5 w-5 text-[#3977f6]" /><p className="mt-3 text-[14px] font-medium">{page} is ready for a local scan</p><p className="mt-1 text-[12px] text-[#85868b]">Open Smart Scan to collect safe, paginated system results.</p><button onClick={scan} className="mt-5 text-[12px] font-medium text-[#3977f6]">Run Smart Scan <ChevronRight className="inline h-3.5 w-3.5" /></button></section>}
      </div>
    </main>
  </div>;
}

function ScanResults({ onCleanup }: { onCleanup: () => void }) {
  const [approved, setApproved] = useState(false);
  return <section className="mt-7 max-w-3xl"><div className="flex items-end justify-between"><div><p className="text-[22px] font-semibold tracking-[-.035em]">7.3 GB safely reclaimable</p><p className="mt-1 text-[12px] text-[#85868b]">Recommended items are recreatable. Review items stay off by default.</p></div><button onClick={() => setApproved(true)} className="rounded-lg bg-[#3977f6] px-3.5 py-2 text-[12px] font-medium text-white">Preview cleanup</button></div><div className="mt-5 overflow-hidden rounded-2xl border border-black/[.07] bg-white">{results.map((item, i) => <motion.div key={item.title} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .05 }} className="flex items-center gap-3 border-b border-black/[.055] px-4 py-3.5 last:border-0"><span className={`grid h-7 w-7 place-items-center rounded-lg ${item.risk === "Safe" ? "bg-blue-50 text-[#3977f6]" : "bg-amber-50 text-amber-600"}`}><HardDrive className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className="text-[12.5px] font-medium">{item.title}</p><p className="mt-0.5 truncate text-[11px] text-[#8c8d92]">{item.detail}</p></div><div className="text-right"><p className="text-[12.5px] font-medium">{item.size}</p><p className="mt-0.5 text-[10.5px] text-[#8c8d92]">{item.risk}</p></div></motion.div>)}</div><AnimatePresence>{approved && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-[12px] text-[#4b5f87]"><CircleCheck className="h-4 w-4 shrink-0 text-[#3977f6]" />Preview created. Clyra will move selected user files to Trash when feasible; review items require an explicit selection.<button onClick={onCleanup} className="ml-auto shrink-0 font-medium text-[#3977f6]">Review</button></motion.div>}</AnimatePresence></section>;
}
