/**
 * Real, sandboxed component previews.
 *
 * Each preview is the actual upstream source: the shadcn/ui example (or a Clyra
 * demo of a 21st component) is bundled with esbuild, styled by a Tailwind build
 * of exactly the classes that bundle uses, and served as a self-contained HTML
 * document for an iframe. Nothing is mocked.
 */
import path from "node:path";
import { existsSync, statSync, promises as fs } from "node:fs";
import { build, type Plugin } from "esbuild";
import { compile } from "@tailwindcss/node";
import { clyraDataPath } from "../runtime-paths";

const REPO = process.cwd();
export const SHADCN_ROOT = path.join(REPO, "external", "shadcn-library", "apps", "v4", "registry", "new-york-v4");
export const TWENTYFIRST_ROOT = path.join(REPO, "external", "21st-library", "apps", "web");
const SHIMS = path.join(REPO, "lib", "clyra-code", "component-shims");
const DEMOS_21ST = path.join(REPO, "lib", "clyra-code", "component-demos", "21st");
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".json", ".css"];

export type FrameTarget = { source: "shadcn" | "21st"; entry: string };

const THEME_CSS = `
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@import "tw-animate-css";
@custom-variant dark (&:is(.dark *));
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-border: var(--border);
  --color-input: var(--input); --color-ring: var(--ring);
  --color-chart-1: var(--chart-1); --color-chart-2: var(--chart-2); --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4); --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar); --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary); --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent); --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border); --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
}
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0); --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.646 0.222 41.116); --chart-2: oklch(0.6 0.118 184.704);
  --chart-3: oklch(0.398 0.07 227.392); --chart-4: oklch(0.828 0.189 84.429); --chart-5: oklch(0.769 0.188 70.08);
  --sidebar: oklch(0.985 0 0); --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0); --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0); --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0); --sidebar-ring: oklch(0.708 0 0);
}
*, ::before, ::after { box-sizing: border-box; border-color: var(--border); outline-color: color-mix(in oklab, var(--ring) 50%, transparent); }
html, body { margin: 0; background: var(--background); color: var(--foreground); font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
button { font: inherit; cursor: pointer; }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 28px; }
#root { width: 100%; max-width: 720px; display: flex; justify-content: center; }
/* Idle previews rest on their settled frame; hovering replays them. */
html.bleed body { display: block; padding: 0; }
html.bleed #root { display: block; max-width: none; }
html.idle *, html.idle *::before, html.idle *::after { animation-play-state: paused !important; }
`;

/** Keyframes and tokens that 21st defines in its own tailwind.config.js. */
const CSS_21ST = `
@theme inline {
  --animate-aurora: aurora 60s linear infinite;
  --animate-shimmer-slide: shimmer-slide var(--speed) ease-in-out infinite alternate;
  --animate-spin-around: spin-around calc(var(--speed) * 2) infinite linear;
  --animate-slide-up-fade: slide-up-fade 0.5s ease-out both;
  @keyframes aurora { from { background-position: 50% 50%, 50% 50%; } to { background-position: 350% 50%, 350% 50%; } }
  @keyframes shimmer-slide { to { transform: translate(calc(100cqw - 100%), 0); } }
  @keyframes spin-around { 0% { transform: translateZ(0) rotate(0); } 15%, 35% { transform: translateZ(0) rotate(90deg); } 65%, 85% { transform: translateZ(0) rotate(270deg); } 100% { transform: translateZ(0) rotate(360deg); } }
  @keyframes slide-up-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
}
:root { --white: #fff; --black: #000; --transparent: transparent; --blue-400: #60a5fa; --blue-500: #3b82f6; --blue-600: #2563eb; --primary-gradient-start: 217 91% 60%; --primary-gradient-end: 263 70% 62%; }
`;

function entrySource(demoPath: string, bleed: boolean) {
  return `
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as Demo from ${JSON.stringify(demoPath)};

const Pick = (Demo as any).default ?? Object.values(Demo as any).find((value) => typeof value === "function");
class Guard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { parent.postMessage({ type: "clyra-frame-error", message: String((error as Error)?.message || error) }, "*"); }
  render() { return this.state.failed ? null : this.props.children; }
}
function App() {
  const [run, setRun] = React.useState(0);
  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "clyra-play") { document.documentElement.classList.remove("idle"); setRun((value) => value + 1); }
      if (event.data?.type === "clyra-idle") document.documentElement.classList.add("idle");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return <Guard key={run}>{Pick ? React.createElement(Pick as React.ComponentType) : null}</Guard>;
}
createRoot(document.getElementById("root")!).render(<App />);
window.setTimeout(() => document.documentElement.classList.add("idle"), 1100);
${bleed ? 'document.documentElement.classList.add("bleed");' : ""}
parent.postMessage({ type: "clyra-frame-ready" }, "*");
`;
}

async function firstExisting(base: string): Promise<string | null> {
  const stat = await fs.stat(base).catch(() => null);
  if (stat?.isFile()) return base;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (await fs.stat(candidate).then((value) => value.isFile()).catch(() => false)) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(base, "index" + extension);
    if (await fs.stat(candidate).then((value) => value.isFile()).catch(() => false)) return candidate;
  }
  return null;
}

function aliasPlugin(source: FrameTarget["source"]): Plugin {
  const fixed: Record<string, string> = {
    cn: path.join(SHIMS, "cn.ts"),
    "next/link": path.join(SHIMS, "next-link.tsx"),
    "next/image": path.join(SHIMS, "next-image.tsx"),
    "next/form": path.join(SHIMS, "next-form.tsx"),
    "next/font/google": path.join(SHIMS, "next-font.ts"),
    "next/navigation": path.join(SHIMS, "next-navigation.ts"),
    "@/hooks/use-media-query": path.join(SHIMS, "use-media-query.ts"),
    "@/hooks/use-copy-to-clipboard": path.join(SHIMS, "use-copy-to-clipboard.ts"),
    "@/lib/utils": path.join(SHIMS, "cn.ts"),
  };
  return {
    name: "clyra-component-alias",
    setup(builder) {
      builder.onResolve({ filter: /^(cn|next\/[a-z/]+|@\/.+)$/ }, async (args) => {
        if (fixed[args.path]) return { path: fixed[args.path] };
        if (source === "21st" && args.path.startsWith("@/registry/new-york-v4/ui/")) {
          const own = path.join(TWENTYFIRST_ROOT, "components", "ui", args.path.slice("@/registry/new-york-v4/ui/".length));
          const ownFile = await firstExisting(own);
          if (ownFile) return { path: ownFile };
        }
        if (args.path.startsWith("@/registry/new-york-v4/")) {
          const found = await firstExisting(path.join(SHADCN_ROOT, args.path.slice("@/registry/new-york-v4/".length)));
          return found ? { path: found } : undefined;
        }
        if (args.path.startsWith("@/") && source === "21st") {
          const found = await firstExisting(path.join(TWENTYFIRST_ROOT, args.path.slice(2)));
          return found ? { path: found } : undefined;
        }
        if (args.path.startsWith("@/")) {
          const found = await firstExisting(path.join(SHADCN_ROOT, args.path.slice(2)));
          return found ? { path: found } : undefined;
        }
        return undefined;
      });
    },
  };
}

const DEMOS_SHADCN = path.join(REPO, "lib", "clyra-code", "component-demos", "shadcn");
const isBlock = (entry: string) => entry.startsWith("block-");
/** Page-sized blocks render edge to edge instead of centred. */
export const frameIsBleed = (target: FrameTarget) => target.source === "shadcn" && isBlock(target.entry);
export function demoPathFor(target: FrameTarget): string {
  if (target.source === "21st") {
    const own = path.join(DEMOS_21ST, target.entry + ".tsx");
    // 21st's primitives share shadcn's API, so shadcn's own demo exercises 21st's file.
    return existsSync(own) ? own : path.join(SHADCN_ROOT, "examples", target.entry + "-demo.tsx");
  }
  if (isBlock(target.entry)) return path.join(SHADCN_ROOT, "blocks", target.entry.slice("block-".length), "page.tsx");
  for (const root of [path.join(SHADCN_ROOT, "examples"), path.join(SHADCN_ROOT, "charts"), DEMOS_SHADCN]) {
    const candidate = path.join(root, target.entry + ".tsx");
    if (existsSync(candidate)) return candidate;
  }
  return path.join(SHADCN_ROOT, "examples", target.entry + ".tsx");
}

async function buildFrame(target: FrameTarget): Promise<string> {
  const demo = demoPathFor(target);
  const result = await build({
    stdin: { contents: entrySource(demo, frameIsBleed(target)), resolveDir: path.dirname(demo), loader: "tsx", sourcefile: "frame-entry.tsx" },
    bundle: true, write: false, metafile: true, format: "iife", platform: "browser", target: "es2020",
    jsx: "automatic", minify: true, logLevel: "silent",
    define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [path.join(REPO, "node_modules")],
    loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".css": "empty" },
    plugins: [aliasPlugin(target.source)],
  });
  const js = result.outputFiles[0].text;
  const candidates = new Set<string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (input.startsWith("node_modules") || input === "<stdin>") continue;
    const text = await fs.readFile(path.join(REPO, input), "utf8").catch(() => "");
    for (const token of text.split(/[\s"'`]+/)) if (token && token.length < 200) candidates.add(token);
  }
  const compiler = await compile(THEME_CSS + (target.source === "21st" ? CSS_21ST : ""), { base: REPO, onDependency: () => undefined });
  const css = compiler.build([...candidates]);
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>"
    + css.replace(/<\/style/gi, "<\\/style") + "</style></head><body><div id=\"root\"></div><script>"
    + js.replace(/<\/script/gi, "<\\/script") + "</script></body></html>";
}

const cache = new Map<string, Promise<string>>();
let active = 0;
const waiting: Array<() => void> = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try { return await job(); } finally { active -= 1; waiting.shift()?.(); }
}

/** Built frames persist across restarts; a changed renderer or demo rebuilds only what it touches. */
const DISK = clyraDataPath(".clyra", "component-frames");
const RENDERER_VERSION = (() => {
  try { return String(Math.floor(statSync(path.join(REPO, "lib", "clyra-code", "component-frames.ts")).mtimeMs)); } catch { return "0"; }
})();
export const FRAME_VERSION = RENDERER_VERSION;
const diskFile = (target: FrameTarget) => path.join(DISK, `${target.source}__${target.entry}.${RENDERER_VERSION}.html`);

async function fromDisk(target: FrameTarget): Promise<string | null> {
  const file = diskFile(target);
  const [built, demo] = await Promise.all([fs.stat(file).catch(() => null), fs.stat(demoPathFor(target)).catch(() => null)]);
  if (!built || (demo && demo.mtimeMs > built.mtimeMs)) return null;
  return fs.readFile(file, "utf8").catch(() => null);
}

/** Cached in memory and on disk. A failed build is forgotten so it can be retried after a fix. */
export function frameHtml(target: FrameTarget): Promise<string> {
  const key = target.source + "/" + target.entry;
  let existing = cache.get(key);
  if (!existing) {
    existing = fromDisk(target).then(async (stored) => {
      if (stored) return stored;
      const html = await slot(() => buildFrame(target));
      void fs.mkdir(DISK, { recursive: true }).then(() => fs.writeFile(diskFile(target), html, "utf8")).catch(() => undefined);
      return html;
    });
    cache.set(key, existing);
    existing.catch(() => cache.delete(key));
  }
  return existing;
}

let warming = false;
/** Builds every preview in the background (one at a time) so scrolling the library never waits on a build. */
export function warmFrames(targets: FrameTarget[]): void {
  if (warming) return;
  warming = true;
  const queue = [...targets];
  const worker = async () => {
    while (queue.length) {
      const target = queue.shift()!;
      await frameHtml(target).catch(() => undefined);
      // Gentle on the machine: one build at a time with a breather, so the app and the agent stay responsive.
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };
  void worker().finally(() => { warming = false; });
}
