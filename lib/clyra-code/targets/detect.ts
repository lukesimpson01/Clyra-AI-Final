/**
 * Project target detection. Classifies a workspace as one or more ProjectTargets
 * from real project files. It reads the root and one level of children, so a
 * multi-package repository is seen without walking node_modules or build output.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type ProjectTarget = "web" | "electron" | "ios-native" | "swift-package" | "backend" | "generic";

export type DetectedTarget = {
  target: ProjectTarget;
  /** Path relative to the detected root. "." means the root itself. */
  location: string;
  /** Files or config keys that justified this classification. */
  evidence: string[];
};

export type PackageManifestSummary = {
  dependencies: string[];
  main?: string;
  scripts: string[];
};

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "DerivedData", ".build", "Pods", "coverage", "projects"]);

const WEB_DEPS = ["react", "vue", "svelte", "next", "vite", "astro", "@sveltejs/kit", "nuxt"];
const BACKEND_DEPS = ["express", "fastify", "koa", "hono", "@nestjs/core"];

/**
 * Pure classifier. `entries` are the file and directory names of one directory.
 * Returns null when the directory holds no recognisable target.
 */
export function classifyDirectory(
  location: string,
  entries: string[],
  manifest?: PackageManifestSummary,
): DetectedTarget | null {
  const names = new Set(entries);
  const xcodeProjects = entries.filter((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"));

  // Swift package and iOS detection come first: an Xcode app often has a Package.swift beside it.
  if (xcodeProjects.length > 0 || names.has("project.yml") || names.has("Project.swift")) {
    const evidence = [...xcodeProjects, ...(names.has("project.yml") ? ["project.yml"] : []), ...(names.has("Project.swift") ? ["Project.swift"] : [])];
    if (names.has("Package.swift")) evidence.push("Package.swift");
    return { target: "ios-native", location, evidence };
  }

  if (names.has("Package.swift")) {
    return { target: "swift-package", location, evidence: ["Package.swift"] };
  }

  if (manifest) {
    const deps = new Set(manifest.dependencies);
    if (deps.has("electron") || (manifest.main ?? "").includes("electron")) {
      return { target: "electron", location, evidence: ["package.json: electron"] };
    }
    const web = WEB_DEPS.filter((dep) => deps.has(dep));
    if (web.length > 0) {
      return { target: "web", location, evidence: web.map((dep) => `package.json: ${dep}`) };
    }
    const backend = BACKEND_DEPS.filter((dep) => deps.has(dep));
    if (backend.length > 0) {
      return { target: "backend", location, evidence: backend.map((dep) => `package.json: ${dep}`) };
    }
    if (manifest.scripts.length > 0) {
      return { target: "generic", location, evidence: ["package.json"] };
    }
  }

  // Dependency-free static sites (e.g. OpenDesign prototypes) preview in the
  // browser like any web target; index.html wins, any HTML file is an entry.
  const htmlEntries = entries
    .filter((name) => name.toLowerCase().endsWith(".html"))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  if (htmlEntries.length > 0) {
    return { target: "web", location, evidence: [`static HTML: ${htmlEntries[0]}`] };
  }

  return null;
}

async function readManifest(dir: string): Promise<PackageManifestSummary | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      main?: string;
      scripts?: Record<string, string>;
    };
    return {
      dependencies: [...Object.keys(raw.dependencies ?? {}), ...Object.keys(raw.devDependencies ?? {})],
      main: raw.main,
      scripts: Object.keys(raw.scripts ?? {}),
    };
  } catch {
    return undefined;
  }
}

async function listEntries(dir: string): Promise<string[]> {
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    return dirents.filter((d) => !IGNORED_DIRS.has(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
}

/** Detects targets at the root and in its immediate child directories. */
export async function detectProjectTargets(root: string): Promise<DetectedTarget[]> {
  const found: DetectedTarget[] = [];

  const rootEntries = await listEntries(root);
  const rootTarget = classifyDirectory(".", rootEntries, await readManifest(root));
  if (rootTarget) found.push(rootTarget);

  const childDirs: string[] = [];
  for (const entry of rootEntries) {
    if (entry.startsWith(".")) continue;
    const full = path.join(root, entry);
    try {
      if ((await fs.stat(full)).isDirectory()) childDirs.push(entry);
    } catch {
      // A vanished entry is not a target.
    }
  }

  for (const child of childDirs) {
    const dir = path.join(root, child);
    const target = classifyDirectory(child, await listEntries(dir), await readManifest(dir));
    if (target) found.push(target);
  }

  return found;
}

/** The primary target is the one at the root when present, otherwise the first detected. */
export function primaryTarget(targets: DetectedTarget[]): DetectedTarget | undefined {
  return targets.find((t) => t.location === ".") ?? targets[0];
}
