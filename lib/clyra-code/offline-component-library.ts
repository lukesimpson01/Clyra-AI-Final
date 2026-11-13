/**
 * Source-owned component library for Clyra Code.
 *
 * Sources are plain `git clone`s of the upstream repositories:
 *   shadcn-ui/ui          -> external/shadcn-library   (MIT)
 *   serafimcloud/21st     -> external/21st-library     (MIT)
 * Browsing renders the real source in sandboxed frames; "Add" copies the real
 * source (and the local files it imports) into the project. No hosted registry,
 * MCP or API key is involved once the repositories are cloned.
 */
import type { Application } from "express";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clyraDataPath } from "../runtime-paths";
import { frameHtml, SHADCN_ROOT, TWENTYFIRST_ROOT } from "./component-frames";

const run = promisify(execFile);
const REPO = process.cwd();
const SHADCN_REPO = path.join(REPO, "external", "shadcn-library");
const TWENTYFIRST_REPO = path.join(REPO, "external", "21st-library");
const SHADCN_UI = path.join(SHADCN_ROOT, "ui");
const SHADCN_EXAMPLES = path.join(SHADCN_ROOT, "examples");
const SHADCN_CHARTS = path.join(SHADCN_ROOT, "charts");
const TWENTYFIRST_UI = path.join(TWENTYFIRST_ROOT, "components", "ui");
const CUSTOM_DEMOS = path.join(REPO, "lib", "clyra-code", "component-demos");
const SAFE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 1_500_000;

export const COMPONENT_CATEGORIES = [
  "Buttons", "Forms & Inputs", "Text", "Navigation & Menus", "Overlays", "Feedback",
  "Data Display", "Charts", "Layout", "Chat & Composer", "Effects & Backgrounds", "Sections",
] as const;
export type ComponentCategory = typeof COMPONENT_CATEGORIES[number];

export type LocalSource = "shadcn" | "21st";
export type LocalComponent = {
  id: string; source: LocalSource; name: string; title: string;
  description: string; category: ComponentCategory; registryId: string;
  docsUrl: string; origin: string; offline: true;
  /** Frame URL of the real, running component. */
  previewUrl: string;
  /** Additional real examples (variants) of the same component. */
  examples: Array<{ name: string; title: string; previewUrl: string }>;
};
export type LocalComponentDetail = {
  item: LocalComponent;
  files: Array<{ path: string; content: string }>;
  dependencies: string[];
  registryDependencies: string[];
  requirements: string[];
  license: string;
};

const pretty = (name: string) => name.split("-").map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(" ");
const nativePath = (root: string, relative: string) => path.resolve(root, ...relative.split("/"));
async function exists(file: string) { try { await fs.access(file); return true; } catch { return false; } }

const CATEGORY_OF: Record<string, ComponentCategory> = {
  button: "Buttons", "button-group": "Buttons", toggle: "Buttons", "toggle-group": "Buttons",
  input: "Forms & Inputs", "input-group": "Forms & Inputs", "input-otp": "Forms & Inputs", textarea: "Forms & Inputs",
  "native-select": "Forms & Inputs", select: "Forms & Inputs", combobox: "Forms & Inputs", checkbox: "Forms & Inputs",
  "radio-group": "Forms & Inputs", switch: "Forms & Inputs", slider: "Forms & Inputs", field: "Forms & Inputs",
  form: "Forms & Inputs", label: "Forms & Inputs", calendar: "Forms & Inputs", multiselect: "Forms & Inputs",
  kbd: "Text", typography: "Text", "text-shimmer": "Text", "text-morph": "Text", tag: "Text",
  "dropdown-menu": "Navigation & Menus", "context-menu": "Navigation & Menus", menubar: "Navigation & Menus",
  "navigation-menu": "Navigation & Menus", breadcrumb: "Navigation & Menus", pagination: "Navigation & Menus",
  tabs: "Navigation & Menus", sidebar: "Navigation & Menus", command: "Navigation & Menus", "pricing-tab": "Navigation & Menus",
  dialog: "Overlays", "alert-dialog": "Overlays", sheet: "Overlays", drawer: "Overlays", popover: "Overlays",
  "hover-card": "Overlays", tooltip: "Overlays",
  alert: "Feedback", sonner: "Feedback", progress: "Feedback", spinner: "Feedback", skeleton: "Feedback",
  empty: "Feedback", badge: "Feedback", marker: "Feedback", banner: "Feedback", "circle-progress": "Feedback",
  table: "Data Display", card: "Data Display", avatar: "Data Display", carousel: "Data Display", item: "Data Display",
  accordion: "Data Display", collapsible: "Data Display", chart: "Charts",
  separator: "Layout", "scroll-area": "Layout", "aspect-ratio": "Layout", resizable: "Layout", direction: "Layout",
  attachment: "Chat & Composer", bubble: "Chat & Composer", message: "Chat & Composer",
  "aurora-background": "Effects & Backgrounds", "shimmer-button": "Buttons", "hero-pill": "Sections", mockup: "Sections",
};

const DESCRIPTIONS: Record<string, string> = {
  accordion: "Vertically stacked sections that expand to reveal content.",
  alert: "A callout that draws attention to important information.",
  "alert-dialog": "A modal that interrupts the user and needs a response.",
  "aspect-ratio": "Keeps content at a fixed width-to-height ratio.",
  attachment: "File chips with progress, state and actions for composers.",
  avatar: "An image with a fallback for representing a person.",
  badge: "A small label for status, counts and categories.",
  breadcrumb: "Shows the path to the current page.",
  bubble: "Chat bubbles in several tones for conversations.",
  button: "Buttons in every variant and size, with icons and loading states.",
  "button-group": "Joins related buttons into one control.",
  calendar: "A date picker calendar with ranges and presets.",
  card: "A surface with header, content and footer.",
  carousel: "A swipeable, keyboard-friendly carousel.",
  chart: "Chart primitives themed from your colour tokens.",
  checkbox: "A checkbox with indeterminate and disabled states.",
  collapsible: "An element that expands and collapses.",
  combobox: "A searchable select with keyboard navigation.",
  command: "A command palette with fuzzy search.",
  "context-menu": "A menu opened by right-click.",
  dialog: "A modal window layered over the page.",
  drawer: "A drag-to-dismiss panel that slides from the edge.",
  "dropdown-menu": "A menu opened from a trigger, with submenus and shortcuts.",
  empty: "An empty-state with icon, title and actions.",
  field: "Accessible form fields with labels, hints and errors.",
  form: "Form wiring for react-hook-form with validation.",
  "hover-card": "A preview card shown when hovering a link.",
  input: "A text input in every state.",
  "input-group": "Inputs with leading and trailing addons.",
  "input-otp": "A one-time-code input with auto-advance.",
  item: "A flexible list row with media, title and actions.",
  kbd: "Keyboard key caps for shortcuts.",
  label: "An accessible label for form controls.",
  marker: "Inline timeline markers for chat and activity.",
  menubar: "A desktop-style menu bar.",
  message: "Chat messages with avatar, header and footer.",
  "native-select": "A styled native select element.",
  "navigation-menu": "A site navigation with flyout content.",
  pagination: "Page navigation with previous and next.",
  popover: "A floating panel anchored to a trigger.",
  progress: "A progress bar for tasks and uploads.",
  "radio-group": "A set of radio options.",
  resizable: "Draggable resizable panels.",
  "scroll-area": "Custom scrollbars that follow your theme.",
  select: "A styled select with groups and scrolling.",
  separator: "A visual divider.",
  sheet: "A side panel that slides over the page.",
  sidebar: "A composable, collapsible application sidebar.",
  skeleton: "A shimmering placeholder while content loads.",
  slider: "A range slider.",
  sonner: "Toast notifications.",
  spinner: "An animated loading indicator.",
  switch: "A toggle switch.",
  table: "A responsive data table.",
  tabs: "Layered content sections, one visible at a time.",
  textarea: "A multi-line text input.",
  toggle: "A two-state pressable button.",
  "toggle-group": "A set of toggles for single or multiple choice.",
  tooltip: "A small hint shown on hover or focus.",
  typography: "Headings, paragraphs, lists and quotes.",
  "aurora-background": "A slow drifting aurora gradient for hero sections.",
  banner: "A dismissible announcement banner.",
  "circle-progress": "A compact circular progress indicator.",
  mockup: "A browser and device frame for screenshots.",
  multiselect: "A searchable multi-value select with tags.",
  "hero-pill": "An announcement pill for hero sections.",
  "pricing-tab": "An animated billing-period switcher.",
  "shimmer-button": "A button with a travelling shimmer border.",
  tag: "A hash-tag chip.",
  "text-morph": "Characters morph from one word to the next.",
  "text-shimmer": "Text with a travelling shimmer, for loading states.",
};

function describe(name: string, source: LocalSource, category: ComponentCategory) {
  return DESCRIPTIONS[name] ?? (name.startsWith("chart-")
    ? "A real " + pretty(name.replace(/^chart-/, "")).toLowerCase() + " chart built on the chart primitives."
    : (source === "shadcn" ? "shadcn/ui" : "21st") + " " + category.toLowerCase() + " component.");
}

let cleanupCatalogue: LocalComponent[] | undefined;

const frameUrl = (source: LocalSource, entry: string) => `/api/clyra-code/components/frame/${source}/${entry}`;

async function listDir(directory: string, extension = ".tsx") {
  return (await fs.readdir(directory).catch(() => [] as string[])).filter(file => file.endsWith(extension)).map(file => file.slice(0, -extension.length));
}

async function buildCatalogue(): Promise<LocalComponent[]> {
  const items: LocalComponent[] = [];
  if (await exists(SHADCN_UI)) {
    const ui = (await listDir(SHADCN_UI)).filter(name => !name.startsWith("_") && SAFE.test(name));
    const examples = (await listDir(SHADCN_EXAMPLES)).filter(name => SAFE.test(name));
    const custom = new Set(await listDir(path.join(CUSTOM_DEMOS, "shadcn")));
    const owner = (example: string) => ui.filter(name => example === name || example.startsWith(name + "-")).sort((a, b) => b.length - a.length)[0];
    for (const name of ui) {
      const mine = examples.filter(example => owner(example) === name);
      const demo = custom.has(name) ? name : mine.includes(name + "-demo") ? name + "-demo" : mine[0];
      if (!demo) continue;
      const category = CATEGORY_OF[name] ?? "Layout";
      items.push({
        id: "shadcn:" + name, source: "shadcn", name, registryId: name, title: pretty(name),
        description: describe(name, "shadcn", category), category,
        docsUrl: "https://ui.shadcn.com/docs/components/" + name, origin: "shadcn-ui/ui", offline: true,
        previewUrl: frameUrl("shadcn", demo),
        examples: mine.filter(example => example !== demo).slice(0, 24).map(example => ({
          name: example, title: pretty(example.slice(name.length + 1) || example), previewUrl: frameUrl("shadcn", example),
        })),
      });
    }
    // Typography has examples but no ui file.
    const typography = examples.filter(example => example.startsWith("typography-"));
    if (typography.length) items.push({
      id: "shadcn:typography", source: "shadcn", name: "typography", registryId: "typography", title: "Typography",
      description: describe("typography", "shadcn", "Text"), category: "Text", docsUrl: "https://ui.shadcn.com/docs/components/typography",
      origin: "shadcn-ui/ui", offline: true, previewUrl: frameUrl("shadcn", "typography-demo"),
      examples: typography.filter(example => example !== "typography-demo").map(example => ({
        name: example, title: pretty(example.slice("typography-".length)), previewUrl: frameUrl("shadcn", example),
      })),
    });
    for (const chart of (await listDir(SHADCN_CHARTS)).filter(name => name.startsWith("chart-") && SAFE.test(name))) {
      items.push({
        id: "shadcn:" + chart, source: "shadcn", name: chart, registryId: chart, title: pretty(chart.replace(/^chart-/, "")) + " chart",
        description: describe(chart, "shadcn", "Charts"), category: "Charts",
        docsUrl: "https://ui.shadcn.com/charts", origin: "shadcn-ui/ui", offline: true,
        previewUrl: frameUrl("shadcn", chart), examples: [],
      });
    }
  }
  if (await exists(TWENTYFIRST_UI)) {
    for (const name of await listDir(path.join(CUSTOM_DEMOS, "21st"))) {
      if (!SAFE.test(name) || !await exists(path.join(TWENTYFIRST_UI, name + ".tsx"))) continue;
      const category = CATEGORY_OF[name] ?? "Effects & Backgrounds";
      items.push({
        id: "21st:" + name, source: "21st", name, registryId: name, title: pretty(name),
        description: describe(name, "21st", category), category, docsUrl: "https://21st.dev",
        origin: "serafimcloud/21st", offline: true, previewUrl: frameUrl("21st", name), examples: [],
      });
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

export async function listLocalComponents(): Promise<LocalComponent[]> {
  if (!cleanupCatalogue || !cleanupCatalogue.length) cleanupCatalogue = await buildCatalogue();
  return cleanupCatalogue;
}

let cloneInFlight: Promise<void> | undefined;
/** First browse: plain `git clone --depth 1` of each missing repository. */
export async function ensureLocalComponentSources(): Promise<void> {
  const need: Array<[string, string]> = [];
  if (!existsSync(SHADCN_UI)) need.push(["https://github.com/shadcn-ui/ui.git", SHADCN_REPO]);
  if (!existsSync(TWENTYFIRST_UI)) need.push(["https://github.com/serafimcloud/21st.git", TWENTYFIRST_REPO]);
  if (!need.length) return;
  if (!cloneInFlight) {
    cloneInFlight = (async () => {
      for (const [url, target] of need) {
        if (existsSync(target)) await fs.rm(target, { recursive: true, force: true });
        await run("git", ["clone", "--depth", "1", url, target], { cwd: REPO, timeout: 300_000, maxBuffer: 2 * 1024 * 1024 });
      }
      cleanupCatalogue = undefined;
    })().finally(() => { cloneInFlight = undefined; });
  }
  await cloneInFlight;
}

export async function localSourceStatus() {
  return [
    { id: "shadcn" as const, available: await exists(SHADCN_UI), detail: "shadcn-ui/ui · git clone · MIT" },
    { id: "21st" as const, available: await exists(TWENTYFIRST_UI), detail: "serafimcloud/21st · git clone · MIT" },
  ];
}

function verify(source: string, name: string): asserts source is LocalSource {
  if (!["shadcn", "21st"].includes(source) || !SAFE.test(name)) throw new Error("Unknown component.");
}

const LOCAL_IMPORT = /from\s+(["'])((?:@\/|\.{1,2}\/)[^"']*)\1/g;
const RELATIVE_CACHE_LIMIT = 200;

type SourceFile = { target: string; content: string; origin: string };

function packagesOf(code: string): string[] {
  const sources = [...code.matchAll(/(?:from\s*|import\s*|require\()\s*["']([^"']+)["']/g)].map(m => m[1]);
  return [...new Set(sources.filter(s => !s.startsWith(".") && !s.startsWith("@/") && s !== "cn" && !s.startsWith("node:")
      && !["react", "react-dom", "react/jsx-runtime"].includes(s) && !s.startsWith("next/"))
    .map(s => s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]))];
}

/** Resolves a component to its real files and every local file it imports. */
async function collectSource(source: LocalSource, name: string): Promise<{ files: SourceFile[]; packages: string[]; references: string[] }> {
  const files = new Map<string, SourceFile>();
  const queue: Array<{ file: string; target: string }> = [];
  const root = source === "shadcn" ? SHADCN_ROOT : TWENTYFIRST_ROOT;
  const first = source === "shadcn"
    ? (name.startsWith("chart-") && name !== "chart" ? { file: path.join(SHADCN_CHARTS, name + ".tsx"), target: "components/" + name + ".tsx" }
        : name === "typography" ? { file: path.join(SHADCN_EXAMPLES, "typography-demo.tsx"), target: "components/typography.tsx" }
        : { file: path.join(SHADCN_UI, name + ".tsx"), target: "components/ui/" + name + ".tsx" })
    : { file: path.join(TWENTYFIRST_UI, name + ".tsx"), target: "components/ui/" + name + ".tsx" };
  queue.push(first);
  const references: string[] = [];
  const resolveLocal = async (from: string, specifier: string): Promise<{ file: string; target: string } | null> => {
    let base: string;
    let target: string;
    if (specifier === "cn" || specifier === "@/lib/utils" || specifier === "@/registry/new-york-v4/lib/utils") return null;
    if (specifier.startsWith("@/registry/new-york-v4/")) {
      const rest = specifier.slice("@/registry/new-york-v4/".length);
      base = path.join(SHADCN_ROOT, rest);
      target = rest.replace(/^ui\//, "components/ui/");
    } else if (specifier.startsWith("@/")) {
      base = path.join(root, specifier.slice(2));
      target = specifier.slice(2);
    } else {
      base = path.resolve(path.dirname(from), specifier);
      target = path.relative(root, base).replaceAll(path.sep, "/");
      if (target.startsWith("..")) return null;
      if (source === "shadcn" && target.startsWith("ui/")) target = "components/" + target;
    }
    for (const candidate of [base + ".tsx", base + ".ts", path.join(base, "index.tsx")]) {
      if (await exists(candidate)) return { file: candidate, target: target.replace(/\.(tsx?|jsx?)$/, "") + path.extname(candidate) };
    }
    return null;
  };
  const resolved = new Map<string, Map<string, string>>();
  while (queue.length) {
    const { file, target } = queue.shift()!;
    if (files.has(target)) continue;
    if (files.size >= MAX_FILES) throw new Error("Component dependency graph exceeds the safety limit.");
    const content = await fs.readFile(file, "utf8");
    files.set(target, { target, content, origin: file });
    const mapping = new Map<string, string>();
    resolved.set(target, mapping);
    for (const match of content.matchAll(LOCAL_IMPORT)) {
      const specifier = match[2];
      const dependency = await resolveLocal(file, specifier);
      if (!dependency) continue;
      mapping.set(specifier, dependency.target);
      if (!files.has(dependency.target)) queue.push(dependency);
      const uiMatch = /^components\/ui\/([a-z0-9-]+)\.tsx$/.exec(dependency.target);
      if (uiMatch && uiMatch[1] !== name) references.push(uiMatch[1]);
    }
    if (resolved.size > RELATIVE_CACHE_LIMIT) break;
  }
  // Rewrite every local import to a relative path inside the destination project.
  const out: SourceFile[] = [];
  for (const [target, entry] of files) {
    const mapping = resolved.get(target) ?? new Map<string, string>();
    let content = entry.content.replace(/from\s+(["'])(cn|@\/lib\/utils|@\/registry\/new-york-v4\/lib\/utils)\1/g, (_all, quote: string) => {
      const relative = path.posix.relative(path.posix.dirname(target), "lib/utils");
      return "from " + quote + (relative.startsWith(".") ? relative : "./" + relative) + quote;
    });
    content = content.replace(LOCAL_IMPORT, (all: string, _quote: string, specifier: string) => {
      const destination = mapping.get(specifier);
      if (!destination) return all;
      const bare = destination.replace(/\.(tsx?|jsx?)$/, "");
      const relative = path.posix.relative(path.posix.dirname(target), bare);
      return "from \"" + (relative.startsWith(".") ? relative : "./" + relative) + "\"";
    });
    out.push({ target, content, origin: entry.origin });
  }
  return { files: out, packages: [...new Set(out.flatMap(file => packagesOf(file.content)))], references: [...new Set(references)] };
}

/** Real checked-in code; never a mock. */
export async function readLocalComponent(source: LocalSource, name: string): Promise<LocalComponentDetail> {
  verify(source, name);
  const item = (await listLocalComponents()).find(entry => entry.source === source && entry.name === name);
  if (!item) throw new Error("Unknown component.");
  const collected = await collectSource(source, name);
  return {
    item, files: collected.files.map(file => ({ path: file.target, content: file.content })),
    dependencies: collected.packages, registryDependencies: collected.references,
    requirements: ["React", "Tailwind CSS", "shadcn-compatible CSS variables"], license: "MIT",
  };
}

export async function installLocalComponent(projectId: string, source: LocalSource, name: string) {
  verify(source, name);
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(projectId)) throw new Error("Invalid project ID.");
  const project = path.join(clyraDataPath("projects"), projectId, "files");
  if (!await exists(project)) throw new Error("Open or create a Clyra project before installing components.");
  const pkgPath = path.join(project, "package.json");
  if (!await exists(pkgPath)) throw new Error("This project needs a React package.json before components can be installed.");
  const manifest = JSON.parse(await fs.readFile(pkgPath, "utf8")) as Record<string, unknown>;
  const depRecord = { ...((manifest.dependencies ?? {}) as Record<string, string>),
    ...((manifest.devDependencies ?? {}) as Record<string, string>) };
  if (!("react" in depRecord)) throw new Error("Components require a React project.");
  const baseDir = await exists(path.join(project, "src")) ? "src/" : "";
  const collected = await collectSource(source, name);
  const files = new Map<string, string>();
  for (const file of collected.files) files.set(baseDir + file.target, file.content);
  if ([...files.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0) > MAX_TOTAL_BYTES) {
    throw new Error("Component source exceeds the maximum install size.");
  }
  const required = new Set(collected.packages);
  const utilsRelative = baseDir + "lib/utils.ts";
  const needsCn = [...files.values()].some(code => /from ["'](?:\.\.?\/)+(?:lib\/)?utils["']/.test(code));
  if (needsCn && !files.has(utilsRelative) && !await exists(nativePath(project, utilsRelative))) {
    files.set(utilsRelative, 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n');
    required.add("clsx"); required.add("tailwind-merge");
  }
  const licenseSource = path.join(source === "shadcn" ? SHADCN_REPO : TWENTYFIRST_REPO, source === "shadcn" ? "LICENSE.md" : "LICENSE");
  const licensePath = baseDir + (source === "shadcn" ? "components/LICENSE.shadcn.md" : "components/LICENSE.21st.txt");
  if (!await exists(nativePath(project, licensePath)) && await exists(licenseSource)) {
    files.set(licensePath, await fs.readFile(licenseSource, "utf8"));
  }
  const newDependencies = [...required].filter(dep => !(dep in depRecord));
  // Identical shared files are reused; different user-authored files are never overwritten.
  for (const [relative, content] of files) {
    const destination = nativePath(project, relative);
    if (!destination.startsWith(project + path.sep)) throw new Error("Unsafe component file path.");
    if (await exists(destination)) {
      if (await fs.readFile(destination, "utf8") === content) files.delete(relative);
      else throw new Error("A different file already exists at " + relative + ". No files were changed.");
    }
  }
  const written: string[] = [];
  try {
    for (const [relative, content] of files) {
      const destination = nativePath(project, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, { encoding: "utf8", flag: "wx" });
      written.push(destination);
    }
  } catch (error) {
    await Promise.all(written.map(file => fs.unlink(file).catch(() => undefined)));
    throw error;
  }
  return { ok: true, installed: [source + ":" + name, ...collected.references.map(ref => source + ":" + ref)], files: [...files.keys()],
    dependenciesToInstall: newDependencies,
    note: newDependencies.length ? "Added. Install " + newDependencies.join(", ") + " before building."
      : "Added to your project. Run your preview to see it." };
}

/** Remove only Clyra's previously injected remote component MCP settings. */
export async function removeLegacyComponentMcpConfig(projectPath: string): Promise<void> {
  const configFile = path.join(projectPath, "opencode.json");
  if (!await exists(configFile)) return;
  const config = JSON.parse(await fs.readFile(configFile, "utf8")) as Record<string, unknown>;
  const mcp = config.mcp as Record<string, unknown> | undefined;
  const servers = mcp?.servers as Record<string, unknown> | undefined;
  if (!servers) return;
  let changed = false;
  const shadcn = servers.shadcn as Record<string, unknown> | undefined;
  const command = shadcn?.command;
  if (Array.isArray(command) && command.join(" ") === "npx -y shadcn@latest mcp") {
    delete servers.shadcn; changed = true;
  }
  const twenty = servers["21st"] as Record<string, unknown> | undefined;
  if (twenty?.url === "https://21st.dev/api/mcp") {
    delete servers["21st"]; changed = true;
  }
  if (changed) await fs.writeFile(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function problem(error: unknown) { return error instanceof Error ? error.message : "Component action failed."; }
const FRAME_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, max-age=300",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data: https:; connect-src 'none'; frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
};

export function registerComponentLibraryRoutes(app: Application): void {
  app.get("/api/clyra-code/components/status", async (_req, res) => {
    res.json({ sources: await localSourceStatus(), offline: true, setup: "npm run setup:component-sources" });
  });
  app.get("/api/clyra-code/components", async (req, res) => {
    const source = String(req.query.source || "all");
    if (!["all", "shadcn", "21st"].includes(source)) { res.status(400).json({ error: "Invalid source." }); return; }
    const query = String(req.query.q || "").slice(0, 100).trim().toLowerCase();
    const category = String(req.query.category || "");
    let setupError = "";
    try { await ensureLocalComponentSources(); } catch (error) { setupError = problem(error); }
    try {
      const available = await localSourceStatus();
      const all = await listLocalComponents();
      const items = all.filter(item => (source === "all" || item.source === source)
        && (!category || item.category === category)
        && (!query || [item.name, item.title, item.description, item.category].some(v => v.toLowerCase().includes(query))));
      const errors = available.filter(status => !status.available).map(status => ({
        source: status.id, message: "Source not cloned yet. Run npm run setup:component-sources. " + setupError,
      }));
      const counts: Record<string, number> = {};
      for (const item of all) counts[item.category] = (counts[item.category] ?? 0) + 1;
      res.json({ items, errors, offline: true, total: items.length, categories: COMPONENT_CATEGORIES.filter(name => counts[name]).map(name => ({ name, count: counts[name] })) });
    } catch (error) { res.status(500).json({ error: problem(error) }); }
  });
  app.get("/api/clyra-code/components/frame/:source/:entry", async (req, res) => {
    try {
      const source = req.params.source, entry = req.params.entry;
      if (!["shadcn", "21st"].includes(source) || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(entry)) { res.status(400).send("Unknown preview."); return; }
      res.removeHeader("X-Frame-Options");
      res.set(FRAME_HEADERS).send(await frameHtml({ source: source as LocalSource, entry }));
    } catch (error) { res.status(500).type("text/plain").send("Preview unavailable: " + problem(error)); }
  });
  app.get("/api/clyra-code/components/:source/:name", async (req, res) => {
    try {
      const source = req.params.source, name = req.params.name;
      verify(source, name);
      res.json(await readLocalComponent(source, name));
    } catch (error) { res.status(400).json({ error: problem(error) }); }
  });
  app.post("/api/clyra-code/components/install", async (req, res) => {
    try {
      const source = String(req.body?.source || ""), name = String(req.body?.name || "");
      verify(source, name);
      res.json(await installLocalComponent(String(req.body?.projectId || ""), source, name));
    } catch (error) { res.status(400).json({ error: problem(error) }); }
  });
}
