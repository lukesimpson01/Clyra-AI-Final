import { Activity, AppWindow, BatteryCharging, BatteryMedium, Check, ChevronRight, Cpu, Download, Gauge, HardDrive, MemoryStick, Network, PackageSearch, Play, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Upload, Zap } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { EASE_SPRING } from "../../../lib/motion";
import type { ActivitySnapshot, DeviceHealth, DeviceProfile, InternetSpeedTestResult, InternetSpeedTestStage, ScanEvent, ScanSection } from "../shared/types";
import { CapabilityState, HealthHalo, InsightCard, MetricCard, ProcessIcon, ScanCategoryStrip, SectionHeader, Sparkline, SpeedGauge, StatusBadge, StorageBar, SystemCard } from "./SystemCarePrimitives";
import { deviceName, formatBytes, greeting, type CarePage, type Recommendation } from "./systemCareModel";

export type PageProps = {
  profile: DeviceProfile;
  health: DeviceHealth;
  activity: ActivitySnapshot | null;
  histories: { cpu: number[]; memory: number[]; network: number[] };
  recommendations: Recommendation[];
  scanning: boolean;
  scanEvents: Partial<Record<ScanSection, ScanEvent>>;
  lastScanAt: number | null;
  speedResult: InternetSpeedTestResult | null;
  speedTesting: boolean;
  speedStage: InternetSpeedTestStage | null;
  autoRefresh: boolean;
  refreshSeconds: number;
  onNavigate: (page: CarePage) => void;
  onScan: () => void;
  onCancelScan: () => void;
  onAsk: () => void;
  onSpeedTest: () => void;
  onRefresh: () => void;
  onAutoRefresh: (value: boolean) => void;
  onRefreshSeconds: (value: number) => void;
};

const PageTop = ({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) => <div className="sc2-page-top"><div><h1>{title}</h1>{detail ? <p>{detail}</p> : null}</div>{action}</div>;
const actionable = (items: Recommendation[]) => items.filter(item => item.id !== "balanced");
const deviceWord = (profile: DeviceProfile) => profile.platform === "macos" ? "Mac" : "PC";
const healthSentence = (health: DeviceHealth, profile: DeviceProfile) => health.score >= 95 ? "Everything looks great" : health.score >= 75 ? `Your ${deviceWord(profile)} looks good` : health.score >= 50 ? `Your ${deviceWord(profile)} needs some attention` : "Important issues need attention";

function OverviewPage(props: PageProps) {
  const volume = props.profile.storage.find(item => item.systemVolume) || props.profile.storage[0];
  const memoryUsed = props.activity?.memory.usedBytes ?? (props.profile.memory.totalBytes - props.profile.memory.availableBytes);
  const findings = actionable(props.recommendations);
  return <>
    <PageTop title={greeting()} detail={`${deviceName(props.profile)} • ${props.profile.os.name} ${props.profile.os.version}${props.lastScanAt ? " • Scanned just now" : ""}`} action={<div className="sc2-actions"><Button variant="secondary" size="lg" onClick={props.onAsk} icon={<Sparkles className="h-4 w-4"/>}>Ask Clyra</Button><Button variant="primary" size="lg" className="sc2-primary-button" onClick={props.scanning ? props.onCancelScan : props.onScan} icon={props.scanning ? undefined : <Play className="h-3.5 w-3.5 fill-current"/>}>{props.scanning ? "Cancel scan" : "Run Smart Care"}</Button></div>}/>
    <SystemCard className={`sc2-health-hero ${props.scanning ? "is-scanning" : ""}`}>
      <div className="sc2-health-copy"><span>System Health</span><h2>{healthSentence(props.health, props.profile)}</h2><p>{findings.length ? `${findings.length} ${findings.length === 1 ? "thing" : "things"} worth a look` : "Nothing needs your attention right now"}</p><button type="button" onClick={() => props.onNavigate("smart-care")}>Open Smart Care <ChevronRight size={15}/></button><small><ShieldCheck size={13}/> Calculated locally</small></div>
      <HealthHalo health={props.health} scanning={props.scanning}/>
      <div className="sc2-health-findings">{findings.length ? <><strong>Worth a look</strong>{findings.slice(0, 3).map(item => <button key={item.id} type="button" onClick={() => props.onNavigate(item.target)}><span/><span>{item.title}</span><ChevronRight size={14}/></button>)}</> : <div className="sc2-all-clear"><Check/><strong>All clear</strong><small>Measured areas look healthy.</small></div>}</div>
    </SystemCard>
    <div className="sc2-module-grid">
      <SystemCard interactive onClick={() => props.onNavigate("cleanup")} className="sc2-module"><span className="sc2-icon is-blue"><Trash2 size={18}/></span><div><strong>Cleanup</strong><b>Not measured</b><small>Deep scan required</small></div><ChevronRight size={16}/></SystemCard>
      <SystemCard interactive onClick={() => props.onNavigate("performance")} className="sc2-module"><span className="sc2-icon is-blue"><Gauge size={18}/></span><div><strong>Performance</strong><b>{props.activity ? `${Math.round(props.activity.cpu.loadPercent)}% CPU` : "Unavailable"}</b><small>{formatBytes(props.activity?.memory.availableBytes ?? props.profile.memory.availableBytes)} available</small></div><ChevronRight size={16}/></SystemCard>
      <SystemCard interactive onClick={() => props.onNavigate("security")} className="sc2-module"><span className="sc2-icon"><ShieldCheck size={18}/></span><div><strong>Security</strong><b>Not inspected</b><small>Provider unavailable</small></div><ChevronRight size={16}/></SystemCard>
      <SystemCard interactive onClick={() => props.onNavigate("storage")} className="sc2-module"><span className="sc2-icon is-blue"><HardDrive size={18}/></span><div><strong>Storage</strong><b>{formatBytes(volume?.freeBytes, true)} free</b><small>{volume?.totalBytes ? `${Math.round(volume.freeBytes / volume.totalBytes * 100)}% available` : "Unavailable"}</small></div><ChevronRight size={16}/></SystemCard>
    </div>
    <SectionHeader title="Right now" action={<button className="sc2-link" type="button" onClick={() => props.onNavigate("activity")}>Open Activity <ChevronRight size={14}/></button>}/>
    <div className="sc2-metrics-grid"><MetricCard icon={Cpu} title="CPU" value={props.activity ? `${Math.round(props.activity.cpu.loadPercent)}%` : "Unavailable"} detail={`${props.profile.cpu.logicalCores} logical cores`} values={props.histories.cpu}/><MetricCard icon={MemoryStick} title="Memory" value={`${formatBytes(memoryUsed, true)} / ${formatBytes(props.profile.memory.totalBytes, true)}`} detail={props.profile.memory.pressure == null ? "Pressure unavailable" : `${Math.round(props.profile.memory.pressure)}% pressure`} values={props.histories.memory} tone="purple"/><MetricCard icon={Network} title="Network" value={props.activity?.network.downloadBytesPerSecond == null ? "Observing" : `${formatBytes(props.activity.network.downloadBytesPerSecond, true)}/s`} detail="Download now" values={props.histories.network} tone="green"/><MetricCard icon={BatteryMedium} title="Battery" value={props.profile.battery?.present ? `${props.profile.battery.percentage}%` : "Not present"} detail={props.profile.battery?.charging ? "Charging" : props.profile.battery?.present ? "On battery" : "Desktop"} tone="amber"/></div>
  </>;
}

const SCAN_ORDER: Array<[ScanSection, string]> = [["DEVICE_PROFILE", "System"], ["STORAGE", "Storage"], ["MEMORY", "Memory"], ["BATTERY", "Battery"], ["ACTIVITY", "Performance"], ["SYSTEM_HEALTH", "Health"]];

function SmartCareExperience({ props }: { props: PageProps }) {
  const reduced = useReducedMotion();
  const completed = Math.max(0, ...Object.values(props.scanEvents).map(event => event?.completedJobs || 0));
  const total = Math.max(1, ...Object.values(props.scanEvents).map(event => event?.totalJobs || 0), SCAN_ORDER.length);
  const progress = completed / total;
  const active = SCAN_ORDER.find(([section]) => props.scanEvents[section]?.state === "running") || SCAN_ORDER.find(([section]) => !props.scanEvents[section] || props.scanEvents[section]?.state === "queued");
  const findings = actionable(props.recommendations);
  const complete = Boolean(props.lastScanAt && !props.scanning);
  return <div className="sc2-smart-experience">
    <div className="sc2-smart-light" aria-hidden="true"/>
    <HealthHalo health={props.health} scanning={props.scanning} progress={progress} caption={props.scanning ? "" : complete ? props.health.label : "Ready"}/>
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={props.scanning ? `scan-${active?.[1]}` : complete ? "complete" : "ready"} className="sc2-smart-status" initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduced ? 0 : .25, ease: EASE_SPRING }}>
        <h2>{props.scanning ? "Looking things over…" : complete ? healthSentence(props.health, props.profile) : "Ready"}</h2>
        <p>{props.scanning ? active?.[1] || "System" : complete ? findings.length ? `${findings.length} ${findings.length === 1 ? "thing" : "things"} to review` : "You're all set" : "A read-only check of this computer"}</p>
      </motion.div>
    </AnimatePresence>
    <ScanCategoryStrip events={props.scanEvents} scanning={props.scanning} complete={complete}/>
    <Button variant="primary" size="lg" className={`sc2-primary-button ${props.scanning ? "is-scanning" : ""}`} onClick={props.scanning ? props.onCancelScan : props.onScan}>{props.scanning ? "Cancel scan" : complete ? "Scan again" : "Scan"}</Button>
    {complete ? <details className="sc2-scan-details"><summary>Scan details</summary><div>{SCAN_ORDER.map(([section, label]) => <span key={section}><b>{label}</b>{props.scanEvents[section]?.state === "unsupported" ? "Unavailable" : props.scanEvents[section]?.state === "ready" ? "Complete" : "Not checked"}</span>)}</div></details> : null}
  </div>;
}

function SmartCarePage(props: PageProps) {
  const findings = actionable(props.recommendations);
  return <><PageTop title="Smart Care" detail="Keep your computer running at its best." action={<Button variant="secondary" size="lg" onClick={props.onAsk} icon={<Sparkles className="h-4 w-4"/>}>Ask Clyra</Button>}/><SystemCard className="sc2-smart-hero"><SmartCareExperience props={props}/></SystemCard>{props.lastScanAt ? <><SectionHeader title={findings.length ? "Worth a look" : "All clear"}/>{findings.length ? <div className="sc2-insight-grid">{findings.map(item => <InsightCard key={item.id} recommendation={item} onOpen={() => props.onNavigate(item.target)}/>)}</div> : <SystemCard className="sc2-good-state"><span><Check/></span><div><h3>You're all set</h3><p>Nothing measured needs your attention right now.</p></div></SystemCard>}</> : null}</>;
}

function StoragePage(props: PageProps) {
  const volume = props.profile.storage.find(v => v.systemVolume) || props.profile.storage[0];
  const usedPercent = volume?.totalBytes ? Math.round(volume.usedBytes / volume.totalBytes * 100) : 0;
  const freePercent = 100 - usedPercent;
  const status = freePercent < 10 ? "Storage is running low" : freePercent < 20 ? "Storage is worth watching" : "Storage has comfortable room";
  return <><PageTop title="Storage" detail="Capacity, volumes, and what is worth reviewing."/><SystemCard className="sc2-storage-hero"><div className="sc2-storage-copy"><span>{volume?.name || "System volume"}</span><h2>{status}</h2><strong>{formatBytes(volume?.freeBytes)} <small>free</small></strong><StorageBar used={volume?.usedBytes} total={volume?.totalBytes}/><footer><b>{formatBytes(volume?.usedBytes)} used</b><span>{freePercent}% available</span></footer></div><div className="sc2-storage-ring" style={{ "--sc-storage": `${usedPercent * 3.6}deg` } as React.CSSProperties}><div><strong>{usedPercent}%</strong><small>used</small></div></div></SystemCard><SectionHeader title="Volumes" detail={`${props.profile.storage.length} connected`}/><div className="sc2-volume-list">{props.profile.storage.map(item => { const percent = item.totalBytes ? Math.round(item.usedBytes / item.totalBytes * 100) : 0; return <SystemCard key={item.id} className="sc2-volume-row"><span className="sc2-volume-icon"><HardDrive/></span><div><strong>{item.name}</strong><small>{[item.filesystem !== "unknown" ? item.filesystem.toUpperCase() : null, item.mediaType && item.mediaType !== "unknown" ? item.mediaType.toUpperCase() : null, item.internal ? "Internal" : "External"].filter(Boolean).join(" • ") || "Storage volume"}</small><StorageBar used={item.usedBytes} total={item.totalBytes}/></div><div><strong>{formatBytes(item.freeBytes, true)} free</strong><small>{percent}% used</small></div></SystemCard>; })}</div><SectionHeader title="What’s taking space"/><CapabilityState title="Category details need a deep scan" detail="Clyra is showing verified volume capacity now. File categories will appear after the native index can measure them accurately."/></>;
}

function CleanupPage() {
  const categories = [["System junk", "Generated files"], ["Application caches", "Recreated by apps"], ["Browser caches", "Passwords stay protected"], ["Logs", "Inactive diagnostics"], ["Trash", "Review required"], ["Downloads", "Personal • review first"], ["Large files", "Personal • review first"], ["Duplicates", "Hash verification required"]];
  return <><PageTop title="Cleanup" detail="Find space without touching personal files."/><div className="sc2-category-grid">{categories.map(([name, detail]) => <SystemCard key={name} className="sc2-category"><span className="sc2-icon"><PackageSearch size={18}/></span><div><strong>{name}</strong><small>{detail}</small></div><span className="sc2-category-state">—</span></SystemCard>)}</div><CapabilityState title="Cleanup scan unavailable" detail="No files are selected until the native scanner can classify and revalidate them safely."/></>;
}

function PerformancePage(props: PageProps) {
  const top = props.activity?.processes.slice(0, 5) || [];
  return <><PageTop title="Performance" detail="What is affecting responsiveness right now." action={<Button variant="secondary" onClick={props.onRefresh} icon={<RefreshCw className="h-4 w-4"/>}>Refresh</Button>}/><div className="sc2-metrics-grid sc2-metrics-grid--three"><MetricCard icon={Cpu} title="CPU" value={props.activity ? `${props.activity.cpu.loadPercent}%` : "Unavailable"} detail={`${props.profile.cpu.logicalCores} logical cores`} values={props.histories.cpu}/><MetricCard icon={MemoryStick} title="Memory available" value={formatBytes(props.activity?.memory.availableBytes ?? props.profile.memory.availableBytes)} detail={props.profile.memory.pressure == null ? "Pressure unavailable" : `${props.profile.memory.pressure}% pressure`} values={props.histories.memory} tone="purple"/><MetricCard icon={Zap} title="GPU & thermals" value="Unavailable" detail="Provider not connected" tone="amber"/></div><SectionHeader title="Top consumers" action={<button className="sc2-link" type="button" onClick={() => props.onNavigate("activity")}>See all activity <ChevronRight size={14}/></button>}/><SystemCard className="sc2-list-card">{top.length ? top.map(item => <div className="sc2-process-brief" key={item.id}><ProcessIcon process={item}/><div><strong>{item.name}</strong><small>{item.processCount} process{item.processCount === 1 ? "" : "es"}</small></div><b>{item.cpuPercent == null ? "CPU —" : `${item.cpuPercent}% CPU`}</b><b>{formatBytes(item.memoryBytes)}</b></div>) : <CapabilityState title="Activity unavailable" detail="Open the desktop app to observe running processes."/>}</SystemCard></>;
}

function NetworkPage(props: PageProps) {
  return <><PageTop title="Network" detail="Connection activity and an on-demand speed test."/><SystemCard className={`sc2-speed-test ${props.speedTesting ? "is-testing" : props.speedResult ? "is-complete" : ""}`}><div className="sc2-speed-heading"><div><span>Internet speed</span><h2>{props.speedTesting ? props.speedStage === "latency" ? "Checking response time" : props.speedStage === "upload" ? "Measuring upload" : "Measuring download" : props.speedResult ? "Test complete" : "Ready to test"}</h2></div><Button variant="primary" size="lg" className={`sc2-primary-button ${props.speedTesting ? "is-scanning" : ""}`} onClick={props.onSpeedTest} disabled={props.speedTesting}>{props.speedTesting ? "Testing…" : props.speedResult ? "Test again" : "Start test"}</Button></div><SpeedGauge result={props.speedResult} testing={props.speedTesting} stage={props.speedStage}/></SystemCard><div className="sc2-network-live"><SystemCard><Download/><div><span>Download now</span><strong>{props.activity?.network.downloadBytesPerSecond == null ? "Observing" : `${formatBytes(props.activity.network.downloadBytesPerSecond, true)}/s`}</strong></div></SystemCard><SystemCard><Upload/><div><span>Upload now</span><strong>{props.activity?.network.uploadBytesPerSecond == null ? "Observing" : `${formatBytes(props.activity.network.uploadBytesPerSecond, true)}/s`}</strong></div></SystemCard><p><ShieldCheck/> Generated test data only • Cloudflare</p></div></>;
}

function ApplicationsPage(props: PageProps) {
  const reduced = useReducedMotion();
  const apps = props.activity?.processes.slice(0, 12) || [];
  return <><PageTop title="Applications" detail="Apps active on this computer."/><SectionHeader title="Active now" detail={`${apps.length} process groups`}/><SystemCard className="sc2-app-grid">{apps.map((app, index) => <motion.div key={app.id} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : Math.min(index, 8) * .025 }}><ProcessIcon process={app} size="large"/><strong>{app.name}</strong><small>{formatBytes(app.memoryBytes)} • {app.processCount} process{app.processCount === 1 ? "" : "es"}</small><span className="sc2-app-activity">{app.cpuPercent == null ? "Running" : `${app.cpuPercent}% CPU`}</span></motion.div>)}</SystemCard><CapabilityState title="Installed apps unavailable" detail="Uninstall, updates, sizes, and leftovers need a verified platform inventory."/></>;
}

function SecurityPage() {
  return <><PageTop title="Security" detail="Clear protection status without scareware."/><SystemCard className="sc2-security-overview"><div className="sc2-icon"><ShieldCheck size={28}/></div><div><span>Not inspected</span><h2>Protection status unavailable</h2><p>Security providers are not connected yet.</p></div></SystemCard><div className="sc2-security-rows">{["System updates", "Firewall", "Disk encryption", "Startup items", "App permissions"].map(item => <div key={item}><span>{item}</span><b>—</b></div>)}</div></>;
}

function BatteryPage(props: PageProps) {
  const battery = props.profile.battery;
  return <><PageTop title="Battery" detail="Charge, condition, and power state."/>{battery?.present ? <SystemCard className="sc2-battery-hero"><div className="sc2-battery-shape"><motion.span initial={{ width: 0 }} animate={{ width: `${battery.percentage}%` }}/></div><div><span>Current charge</span><h2>{battery.percentage}%</h2><p>{battery.charging ? "Charging" : "On battery"}</p></div></SystemCard> : <CapabilityState title="No battery detected" detail="This appears to be a desktop, or battery data is unavailable."/>}<div className="sc2-fact-rows"><div><span>Power</span><strong>{battery?.present ? (battery.charging ? "Charging" : "On battery") : "Not present"}</strong></div><div><span>Health</span><strong>{battery?.healthPercent == null ? "Unavailable" : `${battery.healthPercent}%`}</strong></div><div><span>Cycles</span><strong>{battery?.cycleCount == null ? "Unavailable" : battery.cycleCount}</strong></div><div><span>Temperature</span><strong>Unavailable</strong></div></div></>;
}

function ActivityPage(props: PageProps) {
  const [sort, setSort] = useState<"cpu" | "memory" | "name">("cpu");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => (props.activity?.processes || []).filter(item => item.name.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "memory" ? b.memoryBytes-a.memoryBytes : (b.cpuPercent||0)-(a.cpuPercent||0)), [props.activity, query, sort]);
  const memoryTotal = props.activity?.memory.totalBytes || props.profile.memory.totalBytes;
  return <><PageTop title="Activity" detail="Live components and every visible process group." action={<Button variant="secondary" onClick={props.onRefresh} icon={<RefreshCw className="h-4 w-4"/>}>Refresh</Button>}/><div className="sc2-activity-summary"><SystemCard><header><Cpu/><span>CPU</span><strong>{props.activity ? `${props.activity.cpu.loadPercent}%` : "—"}</strong></header><Sparkline values={props.histories.cpu}/><small>{props.profile.cpu.logicalCores} logical cores</small></SystemCard><SystemCard><header><MemoryStick/><span>Memory</span><strong>{formatBytes(props.activity?.memory.usedBytes, true)}</strong></header><Sparkline values={props.histories.memory} tone="purple"/><small>{formatBytes(props.activity?.memory.availableBytes, true)} available</small></SystemCard><SystemCard><header><Network/><span>Network</span><strong>{props.activity?.network.downloadBytesPerSecond == null ? "Observing" : `${formatBytes(props.activity.network.downloadBytesPerSecond,true)}/s`}</strong></header><Sparkline values={props.histories.network} tone="green"/><small>{props.activity?.network.uploadBytesPerSecond == null ? "Upload observing" : `${formatBytes(props.activity.network.uploadBytesPerSecond,true)}/s up`}</small></SystemCard></div><div className="sc2-component-strip"><div><HardDrive/><span>Disk read</span><strong>{props.activity?.disk.readBytesPerSecond == null ? "—" : `${formatBytes(props.activity.disk.readBytesPerSecond,true)}/s`}</strong></div><div><HardDrive/><span>Disk write</span><strong>{props.activity?.disk.writeBytesPerSecond == null ? "—" : `${formatBytes(props.activity.disk.writeBytesPerSecond,true)}/s`}</strong></div><div><Zap/><span>GPU</span><strong>{props.activity?.gpu.loadPercent == null ? "—" : `${props.activity.gpu.loadPercent}%`}</strong></div><div><BatteryCharging/><span>Energy</span><strong>{props.profile.battery?.charging ? "Charging" : props.profile.battery?.present ? "Battery" : "—"}</strong></div></div><div className="sc2-table-toolbar"><label><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter processes"/></label><div className="sc2-segmented"><button type="button" className={sort === "cpu" ? "is-active" : ""} onClick={() => setSort("cpu")}>CPU</button><button type="button" className={sort === "memory" ? "is-active" : ""} onClick={() => setSort("memory")}>Memory</button><button type="button" className={sort === "name" ? "is-active" : ""} onClick={() => setSort("name")}>Name</button></div><span>{rows.length} groups</span></div><div className="sc2-table-wrap"><table><thead><tr><th onClick={() => setSort("name")}>Application</th><th>Processes</th><th onClick={() => setSort("cpu")}>CPU</th><th onClick={() => setSort("memory")}>Memory</th><th>Status</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><ProcessIcon process={row}/><span><strong>{row.name}</strong><small>{row.executable ? "Verified local process" : "Process group"}</small></span></td><td>{row.processCount}</td><td><span className="sc2-cell-meter"><i style={{ width: `${Math.min(100, row.cpuPercent || 0)}%` }}/><b>{row.cpuPercent == null ? "—" : `${row.cpuPercent}%`}</b></span></td><td><span className="sc2-cell-meter is-memory"><i style={{ width: `${Math.min(100, memoryTotal ? row.memoryBytes / memoryTotal * 100 : 0)}%` }}/><b>{formatBytes(row.memoryBytes)}</b></span></td><td><StatusBadge tone="good">Running</StatusBadge></td></tr>)}</tbody></table></div></>;
}

function HistoryPage(props: PageProps) {
  return <><PageTop title="History" detail="Recent local activity."/><SystemCard className="sc2-history-card">{props.lastScanAt ? <div><span className="sc2-history-check"><Check size={15}/></span><div><strong>Smart Care scan</strong><small>{new Date(props.lastScanAt).toLocaleString()} • Read only</small></div></div> : <p>No System Care activity yet.</p>}{props.speedResult ? <div><span className="sc2-history-check"><Network size={15}/></span><div><strong>Speed test</strong><small>{new Date(props.speedResult.testedAt).toLocaleString()} • {props.speedResult.downloadMbps} Mbps</small></div></div> : null}</SystemCard></>;
}

function SettingsPage(props: PageProps) {
  return <><PageTop title="Settings" detail="System Care controls."/><SystemCard className="sc2-settings"><div><span><strong>Live activity</strong><small>Update lightweight observations.</small></span><button className={`sc2-switch ${props.autoRefresh ? "is-on" : ""}`} type="button" role="switch" aria-label="Live activity refresh" aria-checked={props.autoRefresh} onClick={() => props.onAutoRefresh(!props.autoRefresh)}><span/></button></div><div><span><strong>Refresh interval</strong><small>How often live metrics update.</small></span><select value={props.refreshSeconds} onChange={event => props.onRefreshSeconds(Number(event.target.value))} disabled={!props.autoRefresh}><option value={2}>2 seconds</option><option value={3}>3 seconds</option><option value={5}>5 seconds</option></select></div><div><span><strong>AI privacy</strong><small>Sanitized aggregates only.</small></span><StatusBadge tone="good">Protected locally</StatusBadge></div><div><span><strong>Automatic cleanup</strong><small>Off until safe rules are available.</small></span><StatusBadge>Unavailable</StatusBadge></div></SystemCard></>;
}

export function SystemCarePage({ page, ...props }: PageProps & { page: CarePage }) {
  if (page === "overview") return <OverviewPage {...props}/>;
  if (page === "smart-care") return <SmartCarePage {...props}/>;
  if (page === "cleanup") return <CleanupPage/>;
  if (page === "storage") return <StoragePage {...props}/>;
  if (page === "performance") return <PerformancePage {...props}/>;
  if (page === "network") return <NetworkPage {...props}/>;
  if (page === "applications") return <ApplicationsPage {...props}/>;
  if (page === "security") return <SecurityPage/>;
  if (page === "battery") return <BatteryPage {...props}/>;
  if (page === "activity") return <ActivityPage {...props}/>;
  if (page === "history") return <HistoryPage {...props}/>;
  return <SettingsPage {...props}/>;
}
