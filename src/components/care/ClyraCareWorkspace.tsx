import { useCallback, useEffect, useState } from "react";
import { Activity, HardDrive, MemoryStick, RefreshCw, ShieldCheck } from "lucide-react";
import { getElectronDesktop, type CareSnapshot } from "../../lib/electron-runtime";

function Meter({ value, label, sublabel, icon: Icon }: { value: number; label: string; sublabel: string; icon: typeof Activity }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <section className="rounded-2xl border border-black/[.07] bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,.035)]">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-[#3977f6]" /><p className="text-[13px] font-medium text-[#303136]">{label}</p></div><p className="mt-1 truncate text-[12px] text-[#77787d]">{sublabel}</p></div><span className="shrink-0 text-[15px] font-semibold tracking-tight text-[#303136]">{safeValue}%</span></div>
    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#ececea]"><div className="h-full rounded-full bg-[#3977f6] transition-[width] duration-300 ease-out" style={{ width: `${safeValue}%` }} /></div>
  </section>;
}

function formatScanTime(value?: string) {
  if (!value) return "Not scanned yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Just now" : `Updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function ClyraCareWorkspace() {
  const [snapshot, setSnapshot] = useState<CareSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    const desktop = getElectronDesktop();
    if (!desktop?.care) {
      setError("Clyra Care reads local system status in the desktop app. No sample system data is shown in a browser.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await desktop.care.scan();
      if (!result.ok || !result.snapshot) throw new Error(result.error || "Clyra couldn't read local system status.");
      setSnapshot(result.snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clyra couldn't read local system status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void scan(); }, [scan]);

  return <div className="flex h-full min-h-0 bg-[#fbfbfa] font-sans text-[#303136]">
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-black/[.07] bg-[#f7f7f6] px-3 py-4 sm:flex">
      <div className="flex items-center gap-2 px-2 text-[13px] font-semibold tracking-tight"><span className="grid h-5 w-5 place-items-center rounded-md bg-[#3977f6] text-[11px] text-white">C</span>Clyra Care</div>
      <div className="mt-7 rounded-lg bg-black/[.055] px-2 py-2 text-[12.5px] font-medium"><Activity className="mr-2 inline h-3.5 w-3.5" />Overview</div>
      <p className="mt-4 px-2 text-[11px] leading-5 text-[#85868b]">Read-only system status. Clyra never removes files from this screen.</p>
    </aside>
    <main className="min-w-0 flex-1 overflow-auto">
      <header className="sticky top-0 z-10 flex h-[58px] items-center justify-between border-b border-black/[.055] bg-[#fbfbfa]/95 px-5 backdrop-blur sm:px-8"><div><p className="text-[14px] font-semibold">Clyra Care</p><p className="mt-0.5 text-[11px] text-[#999a9f]">Local, read-only system status</p></div><button type="button" onClick={() => void scan()} disabled={loading} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#3977f6] px-3.5 text-[12.5px] font-medium text-white shadow-sm transition-colors hover:bg-[#2868e8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3977f6] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />{loading ? "Refreshing…" : "Refresh"}</button></header>
      <div className="mx-auto max-w-[1120px] p-5 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-[28px] font-semibold tracking-[-.045em]">System status, without the guesswork.</h1><p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#77787d]">Clyra reads drive capacity, memory, CPU load and the operating-system cache folder on this Mac. It does not inspect personal files or perform cleanup.</p></div><span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-700"><ShieldCheck className="h-3.5 w-3.5" />Read-only</span></div>
        {error ? <section role="alert" className="mt-7 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="text-[14px] font-semibold text-amber-950">System status isn’t available here</p><p className="mt-1 text-[12px] leading-5 text-amber-800">{error}</p><button type="button" onClick={() => void scan()} className="mt-4 text-[12px] font-semibold text-[#2868e8] hover:text-[#1557d6]">Try again</button></section> : null}
        {snapshot ? <><p className="mt-6 text-[12px] text-[#85868b]">{formatScanTime(snapshot.scannedAt)}</p><div className="mt-3 grid gap-3 md:grid-cols-3"><Meter value={snapshot.disk?.usedPercent ?? 0} label="System drive" sublabel={snapshot.disk ? `${snapshot.disk.usedLabel} of ${snapshot.disk.totalLabel} used` : "Drive capacity unavailable"} icon={HardDrive} /><Meter value={snapshot.memory.usedPercent} label="Memory" sublabel={`${snapshot.memory.usedLabel} of ${snapshot.memory.totalLabel} in use`} icon={MemoryStick} /><Meter value={snapshot.cpu.loadPercent} label="CPU load" sublabel={`${snapshot.cpu.cores} logical cores · 1 minute average`} icon={Activity} /></div><section className="mt-6 max-w-2xl rounded-2xl border border-black/[.07] bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,.035)]"><p className="text-[13px] font-semibold">Operating-system cache folder</p><p className="mt-1 text-[12px] leading-5 text-[#77787d]">{snapshot.caches.timedOut ? "Cache size wasn’t available within two seconds." : `${snapshot.caches.label} currently allocated to operating-system caches.`}</p><p className="mt-4 border-t border-black/[.055] pt-4 text-[11px] leading-5 text-[#85868b]">Cleanup and personal-file analysis are intentionally unavailable until Clyra can provide item-level review, a reversible action, and a clear permission step.</p></section></> : null}
      </div>
    </main>
  </div>;
}
