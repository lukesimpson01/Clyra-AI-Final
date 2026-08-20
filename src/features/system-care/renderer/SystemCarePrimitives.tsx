import { Check, ChevronRight, Download, Upload } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, type ComponentType, type ReactNode } from "react";
import { EASE_SPRING } from "../../../lib/motion";
import type { DeviceHealth, InternetSpeedTestResult, InternetSpeedTestStage, ProcessGroup, ScanEvent, ScanSection } from "../shared/types";
import type { Recommendation } from "./systemCareModel";

export function SystemCard({ children, className = "", interactive = false, onClick }: { children: ReactNode; className?: string; interactive?: boolean; onClick?: () => void }) {
  const Component = onClick ? "button" : "section";
  return <Component type={onClick ? "button" : undefined} className={`sc2-card ${interactive ? "is-interactive" : ""} ${className}`} onClick={onClick}>{children}</Component>;
}

export function SectionHeader({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <header className="sc2-section-head"><div>{eyebrow ? <span>{eyebrow}</span> : null}<h2>{title}</h2>{detail ? <p>{detail}</p> : null}</div>{action}</header>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "blue" }) {
  return <span className={`sc2-badge is-${tone}`}>{children}</span>;
}

export function HealthHalo({ health, scanning = false, progress, caption }: { health: DeviceHealth; scanning?: boolean; progress?: number; caption?: string }) {
  const reduced = useReducedMotion();
  const gradientId = useId().replaceAll(":", "");
  const radius = 82;
  const circumference = 2 * Math.PI * radius;
  const measuredProgress = scanning && progress != null ? Math.max(0.03, Math.min(1, progress)) : health.score / 100;
  const offset = circumference * (1 - measuredProgress);
  const tone = health.score >= 90 ? "excellent" : health.score >= 75 ? "good" : health.score >= 50 ? "attention" : "critical";
  return <div className={`sc2-health-halo is-${tone} ${scanning ? "is-scanning" : ""}`} aria-label={scanning ? "Smart Care scan in progress" : `System health ${health.score} out of 100, ${health.label}`}>
    <div className="sc2-halo-light" aria-hidden="true"/>
    <svg viewBox="0 0 210 210" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#79b9ff"/><stop offset=".52" stopColor="#1677ed"/><stop offset="1" stopColor="#54a3f8"/></linearGradient></defs>
      <circle cx="105" cy="105" r={radius} className="sc2-halo-track"/>
      <motion.circle cx="105" cy="105" r={radius} className="sc2-halo-value" stroke={`url(#${gradientId})`} strokeDasharray={circumference} initial={reduced ? false : { strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: reduced ? 0 : .85, ease: EASE_SPRING }}/>
      {scanning ? <circle cx="105" cy="105" r="91" className="sc2-halo-analysis"/> : null}
      {scanning ? <circle cx="105" cy="105" r="64" className="sc2-halo-inner-orbit"/> : null}
    </svg>
    <div className="sc2-halo-centre"><motion.strong key={scanning ? "scan" : health.score} initial={reduced ? false : { opacity: 0, scale: .96, y: 3 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reduced ? 0 : .42, ease: EASE_SPRING }}>{scanning ? "" : health.score}</motion.strong><span>{caption ?? (scanning ? "Scanning" : health.label)}</span></div>
  </div>;
}

export const HealthRing = HealthHalo;

export function StorageBar({ used, total }: { used?: number; total?: number }) {
  const reduced = useReducedMotion();
  const percent = total ? Math.min(100, Math.max(0, (Number(used) / total) * 100)) : 0;
  return <div className="sc2-storage-track" aria-label={`${Math.round(percent)} percent used`}><motion.span initial={reduced ? false : { width: 0 }} animate={{ width: `${percent}%` }} transition={{ duration: reduced ? 0 : .75, ease: EASE_SPRING }}/></div>;
}

export function Sparkline({ values, tone = "blue" }: { values: number[]; tone?: "blue" | "green" | "amber" | "purple" }) {
  const points = values.length > 1 ? values.map((value, index) => `${(index / (values.length - 1)) * 100},${34 - Math.min(32, Math.max(2, value / Math.max(1, ...values) * 30))}`).join(" ") : "0,30 100,30";
  return <svg className={`sc2-sparkline is-${tone}`} viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline points={points}/></svg>;
}

export function MetricCard({ icon: Icon, title, value, detail, values = [], tone = "blue" }: { icon: ComponentType<{ size?: number }>; title: string; value: string; detail: string; values?: number[]; tone?: "blue" | "green" | "amber" | "purple" }) {
  return <SystemCard className="sc2-metric-card"><div className={`sc2-icon is-${tone}`}><Icon size={18}/></div><div className="sc2-metric-copy"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>{values.length ? <Sparkline values={values} tone={tone}/> : <span className="sc2-unavailable">Unavailable</span>}</SystemCard>;
}

export function InsightCard({ recommendation, onOpen }: { recommendation: Recommendation; onOpen: () => void }) {
  return <button className={`sc2-insight is-${recommendation.impact.toLowerCase()}`} type="button" onClick={onOpen}><span className="sc2-impact"/><div><span>{recommendation.target === "activity" ? "Activity" : recommendation.target === "storage" ? "Storage" : "System"}</span><strong>{recommendation.title}</strong><small>{recommendation.detail}</small><b>{recommendation.target === "activity" ? "See activity" : recommendation.target === "storage" ? "Review storage" : "View details"} <ChevronRight size={14}/></b></div></button>;
}

export const RecommendationRow = InsightCard;

export function ProcessIcon({ process, size = "normal" }: { process: Pick<ProcessGroup, "name" | "iconDataUrl">; size?: "small" | "normal" | "large" }) {
  return <span className={`sc2-app-symbol is-${size}`} aria-hidden="true">{process.iconDataUrl ? <img src={process.iconDataUrl} alt=""/> : <b>{process.name.slice(0, 1).toUpperCase()}</b>}</span>;
}

export function LoadingRing({ label = "Working" }: { label?: string }) {
  return <span className="sc2-loading-ring" role="status" aria-label={label}><i/><i/></span>;
}

export function CapabilityState({ title, detail }: { title: string; detail: string }) {
  return <div className="sc2-capability"><span aria-hidden="true">—</span><div><strong>{title}</strong><p>{detail}</p></div></div>;
}

const SCAN_GROUPS: Array<{ label: string; sections: ScanSection[] }> = [
  { label: "System", sections: ["DEVICE_PROFILE", "SYSTEM_HEALTH"] },
  { label: "Storage", sections: ["STORAGE"] },
  { label: "Memory", sections: ["MEMORY"] },
  { label: "Performance", sections: ["ACTIVITY"] },
  { label: "Battery", sections: ["BATTERY"] },
];

export function ScanCategoryStrip({ events, complete }: { events: Partial<Record<ScanSection, ScanEvent>>; scanning: boolean; complete: boolean }) {
  const states = SCAN_GROUPS.map(group => {
    const values = group.sections.map(section => events[section]?.state);
    const ready = values.some(state => state === "ready");
    const active = values.some(state => state === "running");
    const unsupported = values.length > 0 && values.every(state => state === "unsupported");
    return { ...group, state: active ? "active" : ready || (complete && group.label === "System") ? "ready" : unsupported ? "unsupported" : "queued" };
  });
  return <div className="sc2-scan-categories" aria-label="Scan categories">{states.map(item => <div key={item.label} className={`is-${item.state}`}><span>{item.state === "ready" ? <Check size={12}/> : item.state === "unsupported" ? "—" : null}</span><b>{item.label}</b></div>)}</div>;
}

const SPEED_MARKS = [0, 5, 10, 50, 100, 250, 500, 750, 1000];
function point(angle: number, radius: number) { const radians = angle * Math.PI / 180; return { x: 200 + radius * Math.cos(radians), y: 174 + radius * Math.sin(radians) }; }
function speedAngle(speed: number) {
  const safe = Math.max(0, Math.min(1000, speed));
  const upper = SPEED_MARKS.findIndex(mark => mark >= safe);
  if (upper <= 0) return 135;
  const lower = upper - 1;
  const span = SPEED_MARKS[upper] - SPEED_MARKS[lower] || 1;
  return 135 + ((lower + (safe - SPEED_MARKS[lower]) / span) / (SPEED_MARKS.length - 1)) * 270;
}

export function SpeedGauge({ result, testing, stage }: { result: InternetSpeedTestResult | null; testing: boolean; stage: InternetSpeedTestStage | null }) {
  const reduced = useReducedMotion();
  const gradientId = useId().replaceAll(":", "");
  const speed = result?.downloadMbps ?? 0;
  const angle = speedAngle(speed);
  const needle = point(angle, 93);
  return <div className={`sc2-speed-gauge ${testing ? "is-testing" : ""}`}>
    <svg viewBox="0 0 400 300" role="img" aria-label={testing ? "Internet speed test in progress" : result ? `${result.downloadMbps} megabits per second download` : "Internet speed test ready"}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#9acbff"/><stop offset=".5" stopColor="#1677ed"/><stop offset="1" stopColor="#0f63c7"/></linearGradient></defs>
      <path d="M97.5 276.5 A145 145 0 0 1 200 29 A145 145 0 0 1 302.5 276.5" className="sc2-gauge-track"/>
      <motion.path d="M97.5 276.5 A145 145 0 0 1 200 29 A145 145 0 0 1 302.5 276.5" className="sc2-gauge-value" stroke={`url(#${gradientId})`} pathLength="1" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: testing ? .72 : result ? Math.max(.03, (angle - 135) / 270) : .03 }} transition={{ duration: reduced ? 0 : .8, ease: EASE_SPRING }}/>
      {SPEED_MARKS.map((mark, index) => { const p = point(135 + (index / (SPEED_MARKS.length - 1)) * 270, 113); return <text key={mark} x={p.x} y={p.y} className="sc2-gauge-mark">{mark}</text>; })}
      {!testing && result ? <motion.line x1="200" y1="174" initial={reduced ? false : { x2: 200, y2: 174 }} animate={{ x2: needle.x, y2: needle.y }} transition={{ duration: reduced ? 0 : .75, ease: EASE_SPRING }} className="sc2-gauge-needle"/> : null}
      <circle cx="200" cy="174" r="7" className="sc2-gauge-pin"/>
    </svg>
    <div className="sc2-gauge-reading"><AnimatePresence mode="wait" initial={false}>{testing ? <motion.div key="testing" className="sc2-gauge-loading" initial={reduced ? false : { opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={reduced ? undefined : { opacity: 0, scale: .96 }}><LoadingRing label="Internet speed test in progress"/><strong>{stage === "latency" ? "Ping" : stage === "upload" ? "Upload" : "Download"}</strong></motion.div> : <motion.div key={result?.testedAt || "ready"} className="sc2-gauge-number" initial={reduced ? false : { opacity: 0, scale: .9, y: 7 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: reduced ? 0 : .48, ease: EASE_SPRING }}><strong>{result ? result.downloadMbps.toFixed(1) : "—"}</strong><span><Download size={14}/> Mbps</span><small>{result ? "Download" : "Ready"}</small></motion.div>}</AnimatePresence></div>
    <AnimatePresence>{result && !testing ? <motion.div key={result.testedAt} className="sc2-speed-results" initial={reduced ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : .2, duration: reduced ? 0 : .35 }}><div><Upload/><span>Upload</span><strong>{result.uploadMbps.toFixed(1)} Mbps</strong></div><div><span className="sc2-latency-dot"/><span>Latency</span><strong>{result.latencyMs.toFixed(0)} ms</strong></div></motion.div> : null}</AnimatePresence>
  </div>;
}
