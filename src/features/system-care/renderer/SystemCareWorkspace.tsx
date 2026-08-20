import { Activity, AppWindow, BatteryMedium, ChevronRight, Gauge, Globe2, HardDrive, History, Laptop, MemoryStick, MessageCircle, RotateCcw, Settings, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { getElectronDesktop } from "../../../lib/electron-runtime";
import { EASE_SPRING } from "../../../lib/motion";
import { calculateDeviceHealth } from "../shared/intelligence";
import type { ActivitySnapshot, DeviceProfile, InternetSpeedTestResult, InternetSpeedTestStage, ScanEvent, ScanSection } from "../shared/types";
import { SystemCarePage } from "./SystemCarePages";
import { deviceName, recommendations as buildRecommendations, type CarePage } from "./systemCareModel";
import { SYSTEM_CARE_ACTIVITY_FIXTURE, SYSTEM_CARE_VISUAL_FIXTURE } from "./visualFixture";
import "./system-care.css";

const NAV: Array<{ id: CarePage; label: string; icon: typeof Gauge }> = [
  { id: "overview", label: "Overview", icon: Gauge }, { id: "smart-care", label: "Smart Care", icon: Sparkles }, { id: "cleanup", label: "Cleanup", icon: Trash2 }, { id: "storage", label: "Storage", icon: HardDrive }, { id: "performance", label: "Performance", icon: MemoryStick }, { id: "network", label: "Network", icon: Globe2 }, { id: "applications", label: "Applications", icon: AppWindow }, { id: "security", label: "Security", icon: ShieldCheck }, { id: "battery", label: "Battery", icon: BatteryMedium }, { id: "activity", label: "Activity", icon: Activity }, { id: "history", label: "History", icon: History }, { id: "settings", label: "Settings", icon: Settings },
];

function loadBool(key: string, fallback: boolean) { try { const value = localStorage.getItem(key); return value == null ? fallback : value === "true"; } catch { return fallback; } }
function loadNumber(key: string, fallback: number) { try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; } }

export default function SystemCareWorkspace({ onAskClyra }: { onAskClyra?: (prompt: string) => void }) {
  const desktop = getElectronDesktop();
  const reduced = useReducedMotion();
  const fixture = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV) && new URLSearchParams(window.location.search).get("systemCareFixture") === "1";
  const [page, setPage] = useState<CarePage>("overview");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scanEvents, setScanEvents] = useState<Partial<Record<ScanSection, ScanEvent>>>({});
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);
  const [speedResult, setSpeedResult] = useState<InternetSpeedTestResult | null>(null);
  const [speedTesting, setSpeedTesting] = useState(false);
  const [speedStage, setSpeedStage] = useState<InternetSpeedTestStage | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [autoRefresh, setAutoRefreshState] = useState(() => loadBool("clyra.systemCare.autoRefresh", true));
  const [refreshSeconds, setRefreshSecondsState] = useState(() => loadNumber("clyra.systemCare.refreshSeconds", 3));
  const [histories, setHistories] = useState({ cpu: [] as number[], memory: [] as number[], network: [] as number[] });
  const previousActivity = useRef<ActivitySnapshot | null>(null);

  const applyActivity = useCallback((next: ActivitySnapshot) => {
    const previous = previousActivity.current;
    const elapsed = previous ? Math.max(.1, (next.collectedAt - previous.collectedAt) / 1000) : 0;
    const download = previous && next.network.receivedBytes != null && previous.network.receivedBytes != null ? Math.max(0, (next.network.receivedBytes - previous.network.receivedBytes) / elapsed) : undefined;
    const upload = previous && next.network.sentBytes != null && previous.network.sentBytes != null ? Math.max(0, (next.network.sentBytes - previous.network.sentBytes) / elapsed) : undefined;
    const enriched = { ...next, network: { ...next.network, downloadBytesPerSecond: download, uploadBytesPerSecond: upload } };
    previousActivity.current = next;
    setActivity(enriched);
    setHistories(current => ({ cpu: [...current.cpu, next.cpu.loadPercent].slice(-28), memory: [...current.memory, next.memory.totalBytes ? (next.memory.usedBytes / next.memory.totalBytes) * 100 : 0].slice(-28), network: [...current.network, (download || 0) / 1024].slice(-28) }));
  }, []);

  const refreshActivity = useCallback(async () => {
    if (fixture) { applyActivity({ ...SYSTEM_CARE_ACTIVITY_FIXTURE, collectedAt: Date.now(), cpu: { ...SYSTEM_CARE_ACTIVITY_FIXTURE.cpu, loadPercent: 12 + Math.round(Math.random() * 11) } }); return; }
    if (!desktop?.systemCare?.activity) return;
    try { const result = await desktop.systemCare.activity(); if (result.ok && result.activity) applyActivity(result.activity); } catch { /* preserve the previous reading */ }
  }, [applyActivity, desktop, fixture]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    if (fixture) { setProfile(SYSTEM_CARE_VISUAL_FIXTURE); applyActivity(SYSTEM_CARE_ACTIVITY_FIXTURE); setLoading(false); return; }
    if (!desktop?.systemCare) { setError("System Care observations are available in the Clyra desktop app."); setLoading(false); return; }
    try { const result = await desktop.systemCare.profile(); if (!result.ok || !result.profile) throw new Error(result.error || "Device profile is unavailable."); setProfile(result.profile); void refreshActivity(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Device profile is unavailable."); }
    finally { setLoading(false); }
  }, [applyActivity, desktop, fixture, refreshActivity]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const timer = window.setInterval(() => void refreshActivity(), Math.max(2, refreshSeconds) * 1000); return () => window.clearInterval(timer); }, [autoRefresh, refreshActivity, refreshSeconds]);
  useEffect(() => desktop?.systemCare?.onScanEvent(event => {
    setScanEvents(current => ({ ...current, [event.section]: event }));
    if (event.profile) setProfile(event.profile);
    if (event.activity) applyActivity(event.activity);
    if (event.completedJobs >= event.totalJobs || event.state === "cancelled" || event.state === "error") { setLastScanAt(Date.now()); setJobId(null); }
  }), [applyActivity, desktop]);
  useEffect(() => desktop?.systemCare?.onSpeedTestStage?.(stage => setSpeedStage(stage)), [desktop]);

  const health = useMemo(() => profile ? calculateDeviceHealth(profile) : null, [profile]);
  const recs = useMemo(() => profile && health ? buildRecommendations(profile, health, activity) : [], [profile, health, activity]);
  const startScan = async () => {
    if (jobId) return;
    setError(null); setScanEvents({}); setPage("smart-care");
    if (fixture) {
      const id = "visual-qa"; setJobId(id);
      const sections: ScanSection[] = ["DEVICE_PROFILE", "STORAGE", "MEMORY", "BATTERY", "ACTIVITY", "SYSTEM_HEALTH"];
      sections.forEach((section, index) => window.setTimeout(() => { setScanEvents(current => ({ ...current, [section]: { jobId: id, section, state: "ready", completedJobs: index + 1, totalJobs: sections.length, message: `${section.toLowerCase().replaceAll("_", " ")} measured` } })); if (index === sections.length - 1) { setLastScanAt(Date.now()); setJobId(null); } }, 340 * (index + 1)));
      return;
    }
    if (!desktop?.systemCare) return;
    try { const result = await desktop.systemCare.smartScan(); if (!result.ok || !result.jobId) throw new Error(result.error || "The scan could not start."); setJobId(result.jobId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The scan could not start."); }
  };
  const cancelScan = async () => { if (desktop?.systemCare && jobId && !fixture) await desktop.systemCare.cancel(jobId); setJobId(null); };
  const runSpeedTest = async () => {
    if (speedTesting) return;
    if (fixture || !desktop?.systemCare?.speedTest) { setError("The internet speed test runs only in the Clyra desktop app."); return; }
    setSpeedTesting(true); setSpeedStage("latency"); setError(null);
    try { const result = await desktop.systemCare.speedTest(); if (!result.ok || !result.result) throw new Error(result.error || "The speed test could not finish."); setSpeedResult(result.result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The speed test could not finish."); }
    finally { setSpeedTesting(false); }
  };
  const setAutoRefresh = (value: boolean) => { setAutoRefreshState(value); localStorage.setItem("clyra.systemCare.autoRefresh", String(value)); };
  const setRefreshSeconds = (value: number) => { setRefreshSecondsState(value); localStorage.setItem("clyra.systemCare.refreshSeconds", String(value)); };
  const ask = (prompt?: string) => { if (prompt && onAskClyra) { onAskClyra(prompt); setAssistantOpen(false); } else setAssistantOpen(true); };

  if (loading) return <div className="sc2-loading"><div className="sc2-skeleton is-large"/><div className="sc2-skeleton"/><p>Loading system status…</p></div>;
  if (!profile || !health) return <div className="sc2-empty"><Laptop/><h1>Clyra System Care</h1><p>{error || "Device information is unavailable."}</p><Button variant="primary" onClick={() => void load()} icon={<RotateCcw className="h-4 w-4"/>}>Try again</Button></div>;

  return <div className="sc2-shell">
    <aside className="sc2-sidebar"><div className="sc2-brand"><span><ShieldCheck/></span><div><strong>Clyra System Care</strong><small>{profile.platform === "macos" ? "This Mac" : "This PC"}</small></div></div><nav aria-label="System Care">{NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={page === id ? "is-active" : ""} onClick={() => setPage(id)}><Icon/><span>{label}</span>{page === id ? <motion.i layoutId="sc2-nav"/> : null}</button>)}</nav><div className="sc2-local"><ShieldCheck/><div><strong>Protected locally</strong><small>System data stays on this device</small></div></div></aside>
    <main className="sc2-main"><div className="sc2-main-inner">{error ? <div className="sc2-error" role="alert">{error}<button type="button" onClick={() => setError(null)}><X size={15}/></button></div> : null}<AnimatePresence mode="wait" initial={false}><motion.div key={page} className="sc2-page" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduced ? 0 : .24, ease: EASE_SPRING }}><SystemCarePage page={page} profile={profile} health={health} activity={activity} histories={histories} recommendations={recs} scanning={Boolean(jobId)} scanEvents={scanEvents} lastScanAt={lastScanAt} speedResult={speedResult} speedTesting={speedTesting} speedStage={speedStage} autoRefresh={autoRefresh} refreshSeconds={refreshSeconds} onNavigate={setPage} onScan={() => void startScan()} onCancelScan={() => void cancelScan()} onAsk={() => ask()} onSpeedTest={() => void runSpeedTest()} onRefresh={() => void refreshActivity()} onAutoRefresh={setAutoRefresh} onRefreshSeconds={setRefreshSeconds}/></motion.div></AnimatePresence></div></main>
    <AnimatePresence>{assistantOpen ? <motion.div className="sc2-inspector-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAssistantOpen(false)}><motion.aside className="sc2-inspector" initial={reduced ? false : { x: 28, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 20, opacity: 0 }} transition={{ duration: reduced ? 0 : .28, ease: EASE_SPRING }} onClick={event => event.stopPropagation()}><header><span><MessageCircle/></span><div><strong>Ask Clyra</strong><small>Context from {deviceName(profile)}</small></div><button type="button" onClick={() => setAssistantOpen(false)} aria-label="Close"><X/></button></header><div className="sc2-assistant-summary"><strong>Clyra already knows</strong><p>{profile.cpu.brand} • {Math.round(activity?.cpu.loadPercent || 0)}% CPU • {Math.round((profile.storage[0]?.freeBytes || 0) / 1024 ** 3)} GB free</p><small>Hostname and private paths are excluded.</small></div><div className="sc2-prompts">{["Why is my computer running slowly?", "What is using my storage?", "How can I improve battery life?", "Explain the busiest processes."].map(prompt => <button key={prompt} type="button" onClick={() => ask(`Using the current sanitized System Care context, ${prompt} Gather additional local facts if needed and do not claim any action happened without backend confirmation.`)}>{prompt}<ChevronRight/></button>)}</div><Button variant="primary" fullWidth onClick={() => ask("Help me understand this device using current sanitized System Care observations. Ask before proposing any action that changes files or settings.")}>Continue in Clyra chat</Button></motion.aside></motion.div> : null}</AnimatePresence>
  </div>;
}
