import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft, ArrowRight, Braces, Calculator, Check, ChevronRight, Clock3,
  Copy, Diff, FileCode2, FileSearch, FileText, Hash, KeyRound,
  Library, Loader2, Palette, Pin, Plus, Regex, Search, Table2, Trash2,
  Upload, Wand2, LayoutGrid, Minus,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { LAUNCHER_CATALOGUE, MIN_LAUNCHER_TOOLS, PINNED_LAUNCHER_TOOLS, useLauncherTools } from "../../lib/launcher-tools";

type Category = "Featured" | "Productivity" | "Developer" | "Research" | "Files" | "Media" | "Study" | "Business" | "Utilities" | "Installed" | "Recently Used";
type RuntimeKind = "json" | "csv" | "hash" | "regex" | "diff" | "markdown" | "metadata" | "unit" | "cron" | "color" | "base64" | "url";

type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  category: Category;
  runtime: RuntimeKind;
  permissions: string[];
  generated?: boolean;
};

const CATEGORIES: Category[] = ["Featured", "Productivity", "Developer", "Research", "Files", "Media", "Study", "Business", "Utilities", "Installed", "Recently Used"];
const BUILT_INS: ToolDefinition[] = [
  { id: "json-viewer", name: "JSON Viewer", description: "Validate, format and inspect structured JSON data.", category: "Developer", runtime: "json", permissions: ["Clipboard"] },
  { id: "csv-chart", name: "CSV Chart Studio", description: "Turn a CSV dataset into clean, export-ready charts.", category: "Business", runtime: "csv", permissions: ["Files", "Downloads"] },
  { id: "hash-utility", name: "Encryption & Hash", description: "Create SHA-256 hashes locally without uploading text.", category: "Utilities", runtime: "hash", permissions: ["Local processing"] },
  { id: "regex-playground", name: "Regex Playground", description: "Test regular expressions with live match inspection.", category: "Developer", runtime: "regex", permissions: ["Local processing"] },
  { id: "diff-checker", name: "Diff Checker", description: "Compare two passages or files line by line.", category: "Developer", runtime: "diff", permissions: ["Files"] },
  { id: "markdown-preview", name: "Markdown Preview", description: "Write Markdown and preview its document structure.", category: "Productivity", runtime: "markdown", permissions: ["Clipboard", "Downloads"] },
  { id: "metadata-inspector", name: "Metadata Inspector", description: "Inspect file name, type, size and last-modified data.", category: "Files", runtime: "metadata", permissions: ["Files"] },
  { id: "unit-converter", name: "Calculator & Units", description: "Convert common measurements with transparent formulas.", category: "Utilities", runtime: "unit", permissions: ["Local processing"] },
  { id: "cron-builder", name: "Cron Builder", description: "Understand and assemble common cron schedules.", category: "Developer", runtime: "cron", permissions: ["Local processing"] },
  { id: "colour-picker", name: "Colour Inspector", description: "Convert HEX colours to RGB and inspect contrast-ready values.", category: "Media", runtime: "color", permissions: ["Clipboard"] },
  { id: "base64", name: "Base64 Utility", description: "Encode or decode Base64 entirely on-device.", category: "Utilities", runtime: "base64", permissions: ["Local processing", "Clipboard"] },
  { id: "url-inspector", name: "URL Inspector", description: "Break URLs into origin, path, query and hash fields.", category: "Research", runtime: "url", permissions: ["Clipboard"] },
];

const DEFAULT_INPUT: Partial<Record<RuntimeKind, string>> = {
  json: '{"project":"Clyra","status":"ready","tools":12}',
  csv: "Month,Revenue\nJan,18\nFeb,31\nMar,26\nApr,44",
  hash: "Clyra private note",
  regex: "Clyra builds calm tools for Luke Simpson.",
  diff: "Status: ready\nTests: pending\n---\nStatus: ready\nTests: passed",
  markdown: "# Project brief\n\nA calm, native tool that stays inside Clyra.\n\n- Fast local processing\n- Consistent interface\n- Export-ready output",
  unit: "100",
  cron: "0 9 * * 1-5",
  color: "#3977F6",
  base64: "Clyra",
  url: "https://example.com/path?query=1#details",
};

const ICONS: Record<RuntimeKind, typeof Braces> = {
  json: Braces, csv: Table2, hash: Hash, regex: Regex, diff: Diff, markdown: FileText,
  metadata: FileSearch, unit: Calculator, cron: Clock3, color: Palette, base64: KeyRound, url: FileCode2,
};

function readSet(key: string, fallback: string[]) {
  try { const value = JSON.parse(localStorage.getItem(key) || "null"); return new Set<string>(Array.isArray(value) ? value : fallback); } catch { return new Set(fallback); }
}

function readGenerated(): ToolDefinition[] {
  try { const value = JSON.parse(localStorage.getItem("clyra-generated-tools") || "[]"); return Array.isArray(value) ? value : []; } catch { return []; }
}

function persistSet(key: string, value: Set<string>) { try { localStorage.setItem(key, JSON.stringify([...value])); } catch { /* best effort */ } }

function generatorRuntime(prompt: string): RuntimeKind {
  const value = prompt.toLowerCase();
  if (/csv|chart|graph|spreadsheet/.test(value)) return "csv";
  if (/regex|regular expression/.test(value)) return "regex";
  if (/diff|compare/.test(value)) return "diff";
  if (/hash|encrypt|sha/.test(value)) return "hash";
  if (/markdown|md preview/.test(value)) return "markdown";
  if (/cron|schedule/.test(value)) return "cron";
  if (/color|colour|hex|rgb/.test(value)) return "color";
  if (/base64|encode|decode/.test(value)) return "base64";
  if (/url|link/.test(value)) return "url";
  if (/unit|convert|calculator/.test(value)) return "unit";
  if (/file|metadata/.test(value)) return "metadata";
  return "json";
}

function generatedName(prompt: string, runtime: RuntimeKind) {
  const quoted = prompt.match(/[“"]([^”"]+)[”"]/i)?.[1];
  if (quoted && quoted.length < 42) return quoted;
  return ({ csv: "Clean Chart Maker", regex: "Pattern Lab", diff: "Smart Compare", hash: "Private Hash", markdown: "Document Preview", cron: "Schedule Builder", color: "Colour Workbench", base64: "Encoder Utility", url: "Link Inspector", unit: "Quick Converter", metadata: "File Inspector", json: "Structured Data Tool" } as Record<RuntimeKind, string>)[runtime];
}

function MarkdownPreview({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-[13px] leading-6 text-[var(--clyra-color-label-secondary)]">
      {source.split("\n").map((line, index) => {
        if (line.startsWith("### ")) return <h3 key={index} className="pt-2 text-[15px] font-semibold text-[var(--clyra-color-label)]">{line.slice(4)}</h3>;
        if (line.startsWith("## ")) return <h2 key={index} className="pt-2 text-[18px] font-semibold tracking-[-.02em] text-[var(--clyra-color-label)]">{line.slice(3)}</h2>;
        if (line.startsWith("# ")) return <h1 key={index} className="pt-1 text-[22px] font-semibold tracking-[-.03em] text-[var(--clyra-color-label)]">{line.slice(2)}</h1>;
        if (/^[-*] /.test(line)) return <div key={index} className="flex gap-2"><span aria-hidden="true">•</span><span>{line.slice(2)}</span></div>;
        if (/^\d+\. /.test(line)) return <div key={index} className="pl-1">{line}</div>;
        if (/^`.*`$/.test(line.trim())) return <code key={index} className="block rounded-[8px] bg-[var(--clyra-color-surface-muted)] px-2 py-1 font-mono text-[12px]">{line.trim().slice(1, -1)}</code>;
        if (!line.trim()) return <div key={index} className="h-1" />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function ToolRuntime({ tool, onBack }: { tool: ToolDefinition; onBack: () => void }) {
  const [input, setInput] = useState(DEFAULT_INPUT[tool.runtime] ?? "");
  const [secondary, setSecondary] = useState(tool.runtime === "regex" ? "\\b[A-Z][a-z]+\\b" : "");
  const [output, setOutput] = useState("");
  const [fileInfo, setFileInfo] = useState<{ name: string; type: string; size: string; modified: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    try {
      if (tool.runtime === "json") setOutput(JSON.stringify(JSON.parse(input), null, 2));
      else if (tool.runtime === "hash") { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)); setOutput([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")); }
      else if (tool.runtime === "regex") { const regex = new RegExp(secondary, "g"); setOutput([...input.matchAll(regex)].map((match, index) => `${index + 1}. ${match[0]} · index ${match.index}`).join("\n") || "No matches"); }
      else if (tool.runtime === "diff") { const [left = "", right = ""] = input.split("\n---\n"); const a = left.split("\n"), b = right.split("\n"); setOutput([...a.filter((line) => !b.includes(line)).map((line) => `− ${line}`), ...b.filter((line) => !a.includes(line)).map((line) => `+ ${line}`)].join("\n") || "No differences"); }
      else if (tool.runtime === "unit") { const value = Number(input); if (!Number.isFinite(value)) throw new Error("Enter a number in centimetres."); setOutput(`${value} cm = ${(value / 2.54).toFixed(3)} in\nFormula: centimetres ÷ 2.54`); }
      else if (tool.runtime === "cron") { const descriptions: Record<string, string> = { "* * * * *": "Every minute", "0 * * * *": "At the start of every hour", "0 9 * * 1-5": "At 9:00 AM, Monday through Friday", "0 0 * * 0": "Every Sunday at midnight" }; setOutput(descriptions[input.trim()] || "Five fields: minute · hour · day of month · month · day of week"); }
      else if (tool.runtime === "color") { const hex = input.trim().replace("#", ""); if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error("Enter a six-digit HEX colour."); const number = Number.parseInt(hex, 16); setOutput(`rgb(${number >> 16}, ${(number >> 8) & 255}, ${number & 255})\n#${hex.toUpperCase()}`); }
      else if (tool.runtime === "base64") { try { setOutput(atob(input)); } catch { setOutput(btoa(unescape(encodeURIComponent(input)))); } }
      else if (tool.runtime === "url") { const url = new URL(input); setOutput(`Origin: ${url.origin}\nPath: ${url.pathname}\nQuery: ${url.search || "—"}\nHash: ${url.hash || "—"}`); }
      else if (tool.runtime === "markdown") setOutput(input);
      else if (tool.runtime === "csv") setOutput("chart");
      else if (tool.runtime === "metadata") setOutput(fileInfo ? JSON.stringify(fileInfo, null, 2) : "Choose a file to inspect.");
    } catch (error) { setOutput(error instanceof Error ? error.message : "The tool could not process that input."); }
  };

  const chart = useMemo(() => {
    if (tool.runtime !== "csv") return [];
    const rows = input.trim().split(/\r?\n/).slice(1).map((row) => row.split(","));
    return rows.map(([label, raw]) => ({ label, value: Number(raw) })).filter((item) => item.label && Number.isFinite(item.value));
  }, [input, tool.runtime]);
  const max = Math.max(1, ...chart.map((item) => item.value));
  const Icon = ICONS[tool.runtime];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--clyra-color-background)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--clyra-color-border)] px-4"><button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-[var(--clyra-color-label-secondary)] hover:bg-[var(--clyra-color-surface-muted)]"><ArrowLeft className="h-4 w-4" /></button><span className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-secondary)]"><Icon className="h-4 w-4" /></span><div><strong className="block text-[13.5px] font-semibold text-[var(--clyra-color-label)]">{tool.name}</strong><span className="block text-[10.5px] text-[var(--clyra-color-label-tertiary)]">Runs inside Clyra · {tool.permissions.join(" · ")}</span></div></header>
      <main className="mx-auto grid min-h-0 w-full max-w-[1080px] flex-1 gap-5 overflow-y-auto p-6 md:grid-cols-2">
        <section><label className="mb-2 block text-[12px] font-semibold text-[var(--clyra-color-label-secondary)]">Input</label>{tool.runtime === "metadata" ? <label className="grid min-h-[260px] cursor-pointer place-items-center rounded-[18px] border border-dashed border-[var(--clyra-color-border-strong)] bg-[var(--clyra-color-surface)] text-center"><input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const info = { name: file.name, type: file.type || "Unknown", size: `${(file.size / 1024).toFixed(1)} KB`, modified: new Date(file.lastModified).toLocaleString() }; setFileInfo(info); setOutput(JSON.stringify(info, null, 2)); }} /><span><Upload className="mx-auto h-5 w-5 text-[var(--clyra-color-label-tertiary)]" /><strong className="mt-2 block text-[13px] text-[var(--clyra-color-label)]">Choose a file</strong><small className="mt-1 block text-[11px] text-[var(--clyra-color-label-tertiary)]">Metadata is read locally</small></span></label> : <><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder={tool.runtime === "diff" ? "First version\n---\nSecond version" : tool.runtime === "unit" ? "Centimetres" : tool.runtime === "color" ? "#3977F6" : tool.runtime === "url" ? "https://example.com/path?query=1" : "Enter input…"} className="min-h-[260px] w-full resize-y rounded-[18px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-4 font-mono text-[12.5px] leading-5 text-[var(--clyra-color-label)] outline-none focus:border-[var(--clyra-color-accent)]/40" />{tool.runtime === "regex" ? <input value={secondary} onChange={(event) => setSecondary(event.target.value)} aria-label="Regular expression" className="mt-2 h-10 w-full rounded-[12px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] px-3 font-mono text-[12px] outline-none" /> : null}<button type="button" onClick={() => void run()} className="mt-3 rounded-full bg-[var(--clyra-color-label)] px-4 py-2 text-[12px] font-semibold text-white active:scale-[.98]">Run tool</button></>}</section>
        <section><div className="mb-2 flex items-center justify-between"><label className="text-[12px] font-semibold text-[var(--clyra-color-label-secondary)]">Result</label><button type="button" onClick={() => { void navigator.clipboard.writeText(output); setCopied(true); window.setTimeout(() => setCopied(false), 900); }} className="flex items-center gap-1 text-[11px] text-[var(--clyra-color-label-tertiary)] hover:text-[var(--clyra-color-label)]">{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? "Copied" : "Copy"}</button></div><div className="min-h-[320px] rounded-[18px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-4">{tool.runtime === "csv" && chart.length ? <svg viewBox="0 0 440 250" className="h-auto w-full" role="img" aria-label="CSV bar chart">{chart.map((item, index) => { const width = 360 / Math.max(1, chart.length); const height = item.value / max * 170; return <g key={`${item.label}-${index}`}><rect x={48 + index * width} y={205 - height} width={Math.max(12, width - 12)} height={height} rx="5" fill="var(--clyra-color-accent)" opacity=".82" /><text x={48 + index * width + (width - 12) / 2} y="225" textAnchor="middle" fontSize="10" fill="currentColor" opacity=".55">{item.label}</text><text x={48 + index * width + (width - 12) / 2} y={195 - height} textAnchor="middle" fontSize="10" fill="currentColor" opacity=".75">{item.value}</text></g>; })}</svg> : tool.runtime === "markdown" && output ? <MarkdownPreview source={output} /> : tool.runtime === "color" && /^#[0-9a-f]{6}$/i.test(input.trim()) ? <><div className="h-36 rounded-[14px]" style={{ background: input.trim() }} /><pre className="mt-4 whitespace-pre-wrap text-[12px] text-[var(--clyra-color-label-secondary)]">{output || "Run the tool to convert this colour."}</pre></> : <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-[var(--clyra-color-label-secondary)]">{output || "Your result will appear here without leaving Clyra."}</pre>}</div></section>
      </main>
    </div>
  );
}

export default function ToolLibraryWorkspace() {
  const { ids: wheelIds, add: addToWheel, remove: removeFromWheel, reset: resetWheel } = useLauncherTools();
  const onWheel = wheelIds;
  const [category, setCategory] = useState<Category>("Featured");
  const [search, setSearch] = useState("");
  const [installed, setInstalled] = useState(() => readSet("clyra-installed-tools", ["json-viewer", "unit-converter"]));
  const [recent, setRecent] = useState(() => readSet("clyra-recent-tools", []));
  const [pinned, setPinned] = useState(() => readSet("clyra-pinned-tools", []));
  const [generated, setGenerated] = useState<ToolDefinition[]>(readGenerated);
  const [active, setActive] = useState<ToolDefinition | null>(null);
  const [selected, setSelected] = useState<ToolDefinition | null>(null);
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [generatorStep, setGeneratorStep] = useState<number | null>(null);
  const allTools = useMemo(() => [...generated, ...BUILT_INS], [generated]);
  const visible = useMemo(() => allTools.filter((tool) => {
    if (category === "Installed" && !installed.has(tool.id)) return false;
    if (category === "Recently Used" && !recent.has(tool.id)) return false;
    if (category !== "Featured" && category !== "Installed" && category !== "Recently Used" && tool.category !== category) return false;
    const needle = search.trim().toLowerCase();
    return !needle || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(needle);
  }).sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id))), [allTools, category, installed, pinned, recent, search]);

  const install = (tool: ToolDefinition) => { const next = new Set(installed).add(tool.id); setInstalled(next); persistSet("clyra-installed-tools", next); };
  const uninstall = (tool: ToolDefinition) => { const next = new Set(installed); next.delete(tool.id); setInstalled(next); persistSet("clyra-installed-tools", next); };
  const open = (tool: ToolDefinition) => { install(tool); const next = new Set(recent).add(tool.id); setRecent(next); persistSet("clyra-recent-tools", next); setActive(tool); setSelected(null); };
  const togglePin = (tool: ToolDefinition) => { const next = new Set(pinned); next.has(tool.id) ? next.delete(tool.id) : next.add(tool.id); setPinned(next); persistSet("clyra-pinned-tools", next); };

  const generateTool = async () => {
    if (!generatorPrompt.trim() || generatorStep !== null) return;
    for (let step = 0; step < 5; step += 1) { setGeneratorStep(step); await new Promise((resolve) => window.setTimeout(resolve, 320)); }
    const runtime = generatorRuntime(generatorPrompt);
    const name = generatedName(generatorPrompt, runtime);
    const tool: ToolDefinition = { id: `generated-${Date.now()}`, name, description: generatorPrompt.trim().replace(/^make me (a )?tool that /i, "").replace(/^make (a )?/i, "").slice(0, 140), category: "Utilities", runtime, permissions: runtime === "metadata" ? ["Files"] : ["Local processing"], generated: true };
    const nextGenerated = [tool, ...generated]; setGenerated(nextGenerated); try { localStorage.setItem("clyra-generated-tools", JSON.stringify(nextGenerated)); } catch { /* best effort */ }
    install(tool); setGeneratorStep(null); setGeneratorPrompt(""); setSelected(tool);
  };

  if (active) return <ToolRuntime tool={active} onBack={() => setActive(null)} />;
  const generatorLabels = ["Understanding functionality", "Creating implementation plan", "Building the tool", "Testing and repairing", "Applying Clyra UI polish"];

  return (
    <div className="relative flex h-full min-h-0 bg-[var(--clyra-color-background)] text-[var(--clyra-color-label)]">
      <aside className="hidden w-[210px] shrink-0 border-r border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface-muted)]/70 p-3 md:flex md:flex-col"><div className="flex h-10 items-center gap-2 px-2 text-[14px] font-semibold"><Library className="h-4 w-4" /> Tool Library</div><nav className="mt-3 grid gap-0.5">{CATEGORIES.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={cn("flex h-8 items-center rounded-[8px] px-2.5 text-left text-[12px] font-medium", category === item ? "bg-[var(--clyra-color-surface)] text-[var(--clyra-color-label)] shadow-sm" : "text-[var(--clyra-color-label-secondary)] hover:bg-black/[.035]")}>{item}<span className="ml-auto text-[10px] text-[var(--clyra-color-label-tertiary)]">{item === "Installed" ? installed.size : item === "Recently Used" ? recent.size : ""}</span></button>)}</nav><div className="mt-auto rounded-[12px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-3"><strong className="block text-[11.5px]">Extensions, not separate apps</strong><p className="mt-1 text-[10.5px] leading-[1.45] text-[var(--clyra-color-label-tertiary)]">Every tool shares Clyra's navigation, permissions and local services.</p></div></aside>
      <main className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1120px] px-5 pb-20 pt-10 sm:px-8"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-[var(--clyra-color-label-tertiary)]">Clyra extensions</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-.035em]">Tools for the work between the big tasks.</h1><p className="mt-1.5 max-w-[560px] text-[13px] text-[var(--clyra-color-label-secondary)]">Discover focused capabilities, keep permissions understandable, or create a working tool by describing it.</p></div><label className="flex h-10 min-w-[280px] items-center gap-2 rounded-full border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] px-3"><Search className="h-3.5 w-3.5 text-[var(--clyra-color-label-tertiary)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tools…" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none" /></label></header>

        <section className="mt-8 overflow-hidden rounded-[22px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] shadow-[0_12px_36px_-24px_rgba(15,23,42,.24)]"><div className="grid gap-6 p-5 lg:grid-cols-[1fr_320px]"><div><span className="flex items-center gap-2 text-[12px] font-semibold text-[var(--clyra-color-accent)]"><Wand2 className="h-3.5 w-3.5" /> Create a tool with Clyra</span><h2 className="mt-2 text-[20px] font-semibold tracking-[-.025em]">Describe the capability you are missing.</h2><textarea value={generatorPrompt} onChange={(event) => setGeneratorPrompt(event.target.value)} placeholder="Make me a tool that converts CSV files into clean charts." className="mt-4 min-h-[92px] w-full resize-none rounded-[16px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-background)] p-3.5 text-[13.5px] leading-5 outline-none focus:border-[var(--clyra-color-accent)]/40" /><div className="mt-3 flex items-center justify-between"><p className="text-[10.5px] text-[var(--clyra-color-label-tertiary)]">Clyra plans, builds, tests, polishes and installs the result.</p><button type="button" onClick={() => void generateTool()} disabled={!generatorPrompt.trim() || generatorStep !== null} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--clyra-color-label)] px-4 text-[12px] font-semibold text-white disabled:opacity-35">{generatorStep !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create tool</button></div></div><div className="rounded-[16px] bg-[var(--clyra-color-surface-muted)] p-4"><p className="text-[11px] font-semibold text-[var(--clyra-color-label-secondary)]">Build harness</p><div className="mt-3 grid gap-2">{generatorLabels.map((label, index) => <div key={label} className="flex items-center gap-2 text-[11.5px]"><span className={cn("grid h-4 w-4 place-items-center rounded-full", generatorStep !== null && index < generatorStep ? "bg-[var(--clyra-color-success)] text-white" : generatorStep === index ? "bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)]" : "bg-[var(--clyra-color-surface)] text-[var(--clyra-color-label-tertiary)]")}>{generatorStep !== null && index < generatorStep ? <Check className="h-2.5 w-2.5" /> : index + 1}</span><span className={generatorStep === index ? "font-medium text-[var(--clyra-color-label)]" : "text-[var(--clyra-color-label-secondary)]"}>{label}</span></div>)}</div></div></div></section>

        {/* The wheel and this list are the same data seen from two places, so
            adding here is immediately true on the launcher and vice versa. */}
        <section className="mt-10">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-[19px] font-semibold"><LayoutGrid className="h-4 w-4 text-[var(--clyra-color-label-tertiary)]" /> On your launcher</h2>
              <p className="mt-0.5 text-[11.5px] text-[var(--clyra-color-label-tertiary)]">
                {onWheel.length} of {LAUNCHER_CATALOGUE.length} apps are on the launcher wheel. Press {navigator.platform.toLowerCase().includes("mac") ? "\u2318K" : "Ctrl+K"} to open it.
              </p>
            </div>
            {onWheel.length !== LAUNCHER_CATALOGUE.length ? (
              <button type="button" onClick={resetWheel} className="text-[11px] font-medium text-[var(--clyra-color-label-tertiary)] underline-offset-2 transition-colors hover:text-[var(--clyra-color-label)] hover:underline">Restore all</button>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {LAUNCHER_CATALOGUE.map((app) => {
              const on = wheelIds.includes(app.id);
              const pinned = PINNED_LAUNCHER_TOOLS.includes(app.id);
              const blockedByMinimum = on && !pinned && wheelIds.length <= MIN_LAUNCHER_TOOLS;
              return (
                <div key={app.id} className="flex min-w-0 items-center gap-3 rounded-[14px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--clyra-color-label)]">{app.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-[var(--clyra-color-label-tertiary)]">{app.detail}</span>
                  </span>
                  <button
                    type="button"
                    disabled={pinned || blockedByMinimum}
                    onClick={() => (on ? removeFromWheel(app.id) : addToWheel(app.id))}
                    title={
                      pinned ? "The Marketplace stays on the launcher"
                        : blockedByMinimum ? "Keep at least two tools on the launcher"
                          : on ? `Remove ${app.label} from the launcher` : `Add ${app.label} to the launcher`
                    }
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition-colors duration-150",
                      pinned || blockedByMinimum
                        ? "cursor-not-allowed bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-tertiary)]"
                        : on
                          ? "bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-secondary)] hover:bg-[var(--clyra-color-danger-soft)] hover:text-[var(--clyra-color-danger)]"
                          : "bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)] hover:brightness-95",
                    )}
                  >
                    {on ? <><Minus className="h-3 w-3" strokeWidth={2.4} /> {pinned ? "Always on" : "Remove"}</> : <><Plus className="h-3 w-3" strokeWidth={2.4} /> Add</>}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-10 flex items-center justify-between"><div><h2 className="text-[19px] font-semibold">{category}</h2><p className="mt-0.5 text-[11.5px] text-[var(--clyra-color-label-tertiary)]">{visible.length} focused tools, built to feel native to Clyra</p></div></div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{visible.map((tool) => { const Icon = ICONS[tool.runtime]; const isInstalled = installed.has(tool.id); return <article key={tool.id} className="group rounded-[18px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-4 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-[var(--clyra-color-border-strong)] hover:shadow-[0_14px_30px_-22px_rgba(15,23,42,.3)]"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[var(--clyra-color-surface-muted)] text-[var(--clyra-color-label-secondary)]"><Icon className="h-[18px] w-[18px]" strokeWidth={1.65} /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><h3 className="truncate text-[14px] font-semibold">{tool.name}</h3>{tool.generated ? <span className="rounded-full bg-[var(--clyra-color-accent-soft)] px-1.5 py-0.5 text-[8.5px] font-semibold text-[var(--clyra-color-accent)]">Created by you</span> : null}</div><p className="mt-1 line-clamp-2 min-h-[34px] text-[11.5px] leading-[1.45] text-[var(--clyra-color-label-secondary)]">{tool.description}</p></div><button type="button" onClick={() => togglePin(tool)} aria-label={pinned.has(tool.id) ? "Unpin tool" : "Pin tool"} className={cn("grid h-7 w-7 place-items-center rounded-full text-[var(--clyra-color-label-tertiary)] opacity-0 group-hover:opacity-100", pinned.has(tool.id) && "opacity-100 text-[var(--clyra-color-accent)]")}><Pin className={cn("h-3.5 w-3.5", pinned.has(tool.id) && "fill-current")} /></button></div><div className="mt-4 flex items-center gap-2"><button type="button" onClick={() => setSelected(tool)} className="text-[10.5px] font-medium text-[var(--clyra-color-label-tertiary)] hover:text-[var(--clyra-color-label)]">Preview & permissions</button><button type="button" onClick={() => isInstalled ? open(tool) : install(tool)} className={cn("ml-auto rounded-full px-3 py-1.5 text-[11px] font-semibold", isInstalled ? "bg-[var(--clyra-color-label)] text-white" : "bg-[var(--clyra-color-accent-soft)] text-[var(--clyra-color-accent)]")}>{isInstalled ? "Open" : "Install"}</button></div></article>; })}</div>
      </div></main>

      <AnimatePresence>{selected ? <motion.aside initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: .22, ease: [0.22, 1, .36, 1] }} className="absolute bottom-3 right-3 top-3 z-30 flex w-[calc(100%_-_24px)] max-w-[390px] flex-col rounded-[22px] border border-[var(--clyra-color-border)] bg-[var(--clyra-color-surface)] p-5 shadow-[0_22px_60px_rgba(15,23,42,.16)]"><button type="button" onClick={() => setSelected(null)} className="self-end rounded-full p-2 text-[var(--clyra-color-label-tertiary)] hover:bg-[var(--clyra-color-surface-muted)]"><ArrowRight className="h-4 w-4" /></button>{(() => { const Icon = ICONS[selected.runtime]; return <><span className="mt-3 grid h-14 w-14 place-items-center rounded-[16px] bg-[var(--clyra-color-surface-muted)]"><Icon className="h-6 w-6" /></span><h2 className="mt-4 text-[22px] font-semibold tracking-[-.03em]">{selected.name}</h2><p className="mt-2 text-[13px] leading-5 text-[var(--clyra-color-label-secondary)]">{selected.description}</p><div className="mt-6 rounded-[16px] bg-[var(--clyra-color-surface-muted)] p-4"><strong className="text-[11.5px]">Permissions</strong>{selected.permissions.map((permission) => <p key={permission} className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--clyra-color-label-secondary)]"><Check className="h-3 w-3 text-[var(--clyra-color-success)]" />{permission}</p>)}</div><div className="mt-4 rounded-[16px] border border-[var(--clyra-color-border)] p-4"><div className="flex items-center gap-3"><span className="h-9 w-9 rounded-[10px] bg-[var(--clyra-color-surface-muted)]" /><div className="flex-1"><span className="block h-2 w-24 rounded-full bg-[var(--clyra-color-border-strong)]" /><span className="mt-2 block h-2 w-40 rounded-full bg-[var(--clyra-color-border)]" /></div></div><div className="mt-4 h-24 rounded-[12px] bg-[var(--clyra-color-background)]" /></div><div className="mt-auto flex gap-2">{installed.has(selected.id) ? <button type="button" onClick={() => uninstall(selected)} className="grid h-10 w-10 place-items-center rounded-full text-[var(--clyra-color-danger)] hover:bg-[var(--clyra-color-danger-soft)]"><Trash2 className="h-4 w-4" /></button> : null}<button type="button" onClick={() => open(selected)} className="flex h-10 flex-1 items-center justify-center gap-1 rounded-full bg-[var(--clyra-color-label)] text-[12px] font-semibold text-white">{installed.has(selected.id) ? "Open tool" : "Install and open"}<ChevronRight className="h-3.5 w-3.5" /></button></div></>; })()}</motion.aside> : null}</AnimatePresence>
    </div>
  );
}
