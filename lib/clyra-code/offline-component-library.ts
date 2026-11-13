/**
 * Offline, source-owned component catalogue for Clyra Code.
 * Sources: shadcn-ui/ui (MIT) and 21st-dev/agent-elements (MIT).
 * This is NOT the hosted 21st.dev marketplace: no private/paid data is copied.
 * Reading, browsing and installing never call a component registry or MCP.
 */
import type { Application } from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clyraDataPath } from "../runtime-paths";

const run = promisify(execFile);
const REPO = process.cwd();
const SHADCN = path.join(REPO, "external", "shadcn-ui", "apps", "v4", "registry", "new-york-v4", "ui");
const ELEMENTS = path.join(REPO, "external", "21st-agent-elements", "public", "r");
const SOURCE_REPOS = ["external/shadcn-ui", "external/21st-agent-elements"];
const SAFE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_FILES = 100;
const MAX_TOTAL_BYTES = 1_500_000;

export type LocalSource = "shadcn" | "21st";
export type LocalComponent = {
  id: string; source: LocalSource; name: string; title: string;
  description: string; category: string; registryId: string;
  docsUrl: string; origin: string; offline: true;
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

let cloneInFlight: Promise<void> | undefined;
/** Try to hydrate gitlinks on first browse; after cloning, all catalog and source reads are offline. */
export async function ensureLocalComponentSources(): Promise<void> {
  if (await exists(path.join(SHADCN, "button.tsx")) && await exists(path.join(ELEMENTS, "index.json"))) return;
  if (!cloneInFlight) {
    cloneInFlight = run("git", ["submodule", "update", "--init", "--depth", "1", "--", ...SOURCE_REPOS], {
      cwd: REPO, timeout: 180_000, maxBuffer: 512 * 1024,
    }).then(() => undefined).finally(() => { cloneInFlight = undefined; });
  }
  await cloneInFlight;
}

export async function localSourceStatus() {
  return [
    {
      id: "shadcn" as const, available: await exists(path.join(SHADCN, "button.tsx")),
      detail: "shadcn/ui · official MIT source · local Git submodule",
    },
    {
      id: "21st" as const, available: await exists(path.join(ELEMENTS, "index.json")),
      detail: "21st.dev Agent Elements · 26 open-source components · local Git submodule",
    },
  ];
}

function catalogItem(source: LocalSource, name: string): LocalComponent {
  return source === "shadcn"
    ? { id: "shadcn:" + name, source, name, registryId: name, title: pretty(name),
        description: "Editable shadcn/ui component from the official local source.",
        category: "UI component", docsUrl: "https://ui.shadcn.com/docs/components/" + name,
        origin: "shadcn-ui/ui", offline: true }
    : { id: "21st:" + name, source, name, registryId: name, title: pretty(name),
        description: "Agent Elements component from the official 21st.dev open-source registry.",
        category: "Agent UI", docsUrl: "https://agent-elements.21st.dev/docs/" + name,
        origin: "21st-dev/agent-elements", offline: true };
}

export async function listLocalComponents(): Promise<LocalComponent[]> {
  const result: LocalComponent[] = [];
  if (await exists(SHADCN)) {
    const files = await fs.readdir(SHADCN).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".tsx") || file.startsWith("_")) continue;
      const name = file.slice(0, -4);
      if (SAFE.test(name)) result.push(catalogItem("shadcn", name));
    }
  }
  if (await exists(path.join(ELEMENTS, "index.json"))) {
    const index = JSON.parse(await fs.readFile(path.join(ELEMENTS, "index.json"), "utf8")) as {
      items?: Array<{ name?: string }>;
    };
    for (const { name } of index.items ?? []) {
      if (name && SAFE.test(name) && await exists(path.join(ELEMENTS, name + ".json"))) {
        result.push(catalogItem("21st", name));
      }
    }
  }
  return result.sort((a, b) => a.title.localeCompare(b.title));
}

function verify(source: string, name: string): asserts source is LocalSource {
  if (!["shadcn", "21st"].includes(source) || !SAFE.test(name)) {
    throw new Error("Unknown component.");
  }
}

type RegistryPackage = {
  name: string; files?: Array<{ path: string; content: string }>;
  dependencies?: string[]; devDependencies?: string[];
  registryDependencies?: string[]; css?: unknown;
};

function local21stDependency(value: string): string | null {
  // A registry URL is metadata only. Never fetch it. Resolve only checked-in JSON.
  try {
    const name = decodeURIComponent(new URL(value).pathname.split("/").pop() ?? "").replace(/\.json$/, "");
    return SAFE.test(name) ? name : null;
  } catch {
    return SAFE.test(value) ? value : null;
  }
}

/** Get genuine checked-in code; never return a mock preview as real source. */
export async function readLocalComponent(source: LocalSource, name: string): Promise<LocalComponentDetail> {
  verify(source, name);
  const item = catalogItem(source, name);
  if (source === "shadcn") {
    const code = await fs.readFile(path.join(SHADCN, name + ".tsx"), "utf8");
    const references = [...code.matchAll(/@\/registry\/new-york-v4\/ui\/([a-z0-9-]+)/g)]
      .map(match => match[1]).filter(value => value !== name);
    const dependencies = [...code.matchAll(/from\s+["']([^./@][^"']*)["']/g)]
      .map(match => match[1]).filter(dep => dep !== "cn" && dep !== "react" && dep !== "react-dom");
    return { item, files: [{ path: "components/ui/" + name + ".tsx", content: code }],
      dependencies: [...new Set(dependencies)], registryDependencies: [...new Set(references)],
      requirements: ["React", "Tailwind CSS", "shadcn-compatible CSS variables"], license: "MIT" };
  }
  const registry = JSON.parse(await fs.readFile(path.join(ELEMENTS, name + ".json"), "utf8")) as RegistryPackage;
  const files = (registry.files ?? []).filter(file => typeof file.content === "string" && typeof file.path === "string");
  if (!files.length) throw new Error("This item has no locally installable source.");
  return { item, files: files.map(file => ({
    path: local21stFilePath(file.path), content: file.content,
  })), dependencies: [...(registry.dependencies ?? []), ...(registry.devDependencies ?? [])],
    registryDependencies: (registry.registryDependencies ?? []).map(local21stDependency).filter((v): v is string => Boolean(v)),
    requirements: ["React 19", "Tailwind CSS v4", "Agent Elements design tokens"], license: "MIT" };
}

function local21stFilePath(sourcePath: string): string {
  const cleaned = sourcePath.replaceAll("\\", "/");
  const prefix = "registry/agent-elements/";
  if (!cleaned.startsWith(prefix)) throw new Error("Unsupported registry file path.");
  const relative = cleaned.slice(prefix.length);
  if (!relative || relative.split("/").some(segment => !segment || segment === "." || segment === "..")
      || !/^[a-zA-Z0-9_./-]+$/.test(relative)) throw new Error("Invalid registry path.");
  return "components/agent-elements/" + relative;
}

function translateShadcn(code: string): string {
  return code
    .replace(/(["'])@\/registry\/new-york-v4\/ui\//g, "$1@/components/ui/")
    .replace(/(["'])cn\1/g, "$1@/lib/utils$1");
}
function translate21st(code: string): string {
  return code.replace(/(["'])@\/registry\/agent-elements\//g, "$1@/components/agent-elements/");
}
function importedPackages(code: string): string[] {
  const sources = [...code.matchAll(/(?:from\s*|import\s*|require\()\s*["']([^"']+)["']/g)].map(m => m[1]);
  return [...new Set(sources.filter(s => !s.startsWith(".") && !s.startsWith("@/") &&
    !s.startsWith("node:") && !["react", "react-dom", "react/jsx-runtime"].includes(s))
    .map(s => s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]))];
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
  const queue: Array<{ source: LocalSource; name: string }> = [{ source, name }];
  const seen = new Set<string>();
  const files = new Map<string, string>();
  const required = new Set<string>();
  while (queue.length) {
    const next = queue.shift()!;
    const key = next.source + ":" + next.name;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_FILES) throw new Error("Component dependency graph exceeds the safety limit.");
    const component = await readLocalComponent(next.source, next.name);
    component.registryDependencies.forEach(dep => queue.push({ source: next.source, name: dep }));
    for (const file of component.files) {
      const translated = next.source === "shadcn" ? translateShadcn(file.content) : translate21st(file.content);
      const targetPath = baseDir + file.path;
      const portable = translated.replace(/(["'])@\/(components\/(?:ui|agent-elements)\/[a-zA-Z0-9_/-]+|lib\/utils)\1/g,
        (_all, quote: string, target: string) => {
          const relative = path.posix.relative(path.posix.dirname(targetPath), baseDir + target);
          return quote + (relative.startsWith(".") ? relative : "./" + relative) + quote;
        });
      files.set(targetPath, portable);
      importedPackages(portable).forEach(dep => required.add(dep));
    }
  }
  if ([...files.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0) > MAX_TOTAL_BYTES) {
    throw new Error("Component source exceeds the maximum install size.");
  }
  const utilsRelative = baseDir + "lib/utils.ts";
  const hasCnHelper = [...files.values()].some(code => /from ["'](?:\.\.\/)+lib\/utils["']/.test(code));
  if (hasCnHelper && !await exists(nativePath(project, utilsRelative))) {
    files.set(utilsRelative, 'import { clsx, type ClassValue } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n');
    required.add("clsx"); required.add("tailwind-merge");
  }
  // Preserve source attribution when copying files under MIT.
  const licenseSource = source === "shadcn"
    ? path.join(REPO, "external", "shadcn-ui", "LICENSE.md")
    : path.join(REPO, "external", "21st-agent-elements", "LICENSE");
  const licensePath = baseDir + (source === "shadcn"
    ? "components/ui/LICENSE.shadcn.md" : "components/agent-elements/LICENSE.21st.txt");
  if (!await exists(nativePath(project, licensePath)) && await exists(licenseSource)) {
    files.set(licensePath, await fs.readFile(licenseSource, "utf8"));
  }
  // Agent Elements uses local CSS tokens. Copy the real upstream stylesheet and
  // import it once into a recognised project CSS entrypoint, never a remote URL.
  let stylesheetPatch: { file: string; before: string; after: string } | null = null;
  let stylesheetNeedsImport = false;
  if (source === "21st") {
    const agentStyle = path.join(REPO, "external", "21st-agent-elements", "lib", "agent-ui", "agent-ui.css");
    const styleRelative = baseDir + "components/agent-elements/agent-ui.css";
    if (await exists(agentStyle)) files.set(styleRelative, await fs.readFile(agentStyle, "utf8"));
    const candidates = ["src/index.css", "src/globals.css", "app/globals.css", "styles/globals.css", "index.css", "globals.css"];
    const cssEntry = (await Promise.all(candidates.map(async file => await exists(nativePath(project, file)) ? file : null)))
      .find((entry): entry is string => Boolean(entry));
    if (cssEntry && await exists(agentStyle)) {
      const destination = nativePath(project, cssEntry);
      const before = await fs.readFile(destination, "utf8");
      const relative = path.posix.relative(path.posix.dirname(cssEntry), styleRelative);
      const importPath = relative.startsWith(".") ? relative : "./" + relative;
      const declaration = '@import "' + importPath + '";';
      if (!before.includes(declaration)) stylesheetPatch = { file: destination, before, after: declaration + "\n" + before };
    } else if (await exists(agentStyle)) stylesheetNeedsImport = true;
  }
  const newDependencies = [...required].filter(dep => !(dep in depRecord));
  // Identical shared registry dependencies are already installed and may be reused.
  // Different user-authored files are never silently overwritten.
  for (const [relative, content] of files) {
    const destination = nativePath(project, relative);
    if (!destination.startsWith(project + path.sep)) throw new Error("Unsafe component file path.");
    if (await exists(destination)) {
      if (await fs.readFile(destination, "utf8") === content) files.delete(relative);
      else throw new Error("A different file already exists at " + relative + ". No files were changed.");
    }
  }
  // Roll back only newly created component files if a later write fails.
  const written: string[] = [];
  try {
    for (const [relative, content] of files) {
      const destination = nativePath(project, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, { encoding: "utf8", flag: "wx" });
      written.push(destination);
    }
    if (stylesheetPatch) await fs.writeFile(stylesheetPatch.file, stylesheetPatch.after, "utf8");
  } catch (error) {
    await Promise.all(written.map(file => fs.unlink(file).catch(() => undefined)));
    if (stylesheetPatch) await fs.writeFile(stylesheetPatch.file, stylesheetPatch.before, "utf8").catch(() => undefined);
    throw error;
  }
  return { ok: true, installed: [...seen], files: [...files.keys()],
    dependenciesToInstall: newDependencies,
    note: (newDependencies.length ? "Source installed. Install the listed npm dependencies before building." :
      "Local component source installed. Run your project's validation and preview.") +
      (stylesheetNeedsImport ? " Import components/agent-elements/agent-ui.css into your main CSS file." : "") };
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
export function registerComponentLibraryRoutes(app: Application): void {
  app.get("/api/clyra-code/components/status", async (_req, res) => {
    res.json({ sources: await localSourceStatus(),
      offline: true, setup: "npm run setup:component-sources" });
  });
  app.get("/api/clyra-code/components", async (req, res) => {
    const source = String(req.query.source || "all");
    if (!["all", "shadcn", "21st"].includes(source)) { res.status(400).json({ error: "Invalid source." }); return; }
    const query = String(req.query.q || "").slice(0, 100).trim().toLowerCase();
    let setupError = "";
    try { await ensureLocalComponentSources(); } catch (error) { setupError = problem(error); }
    try {
      const available = await localSourceStatus();
      const items = (await listLocalComponents()).filter(item => (source === "all" || item.source === source)
        && (!query || [item.name, item.title, item.description, item.category].some(v => v.toLowerCase().includes(query))));
      const errors = available.filter(status => !status.available).map(status => ({
        source: status.id, message: "Local source not available. Run npm run setup:component-sources. " + setupError,
      }));
      res.json({ items, errors, offline: true, total: items.length });
    } catch (error) { res.status(500).json({ error: problem(error) }); }
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
