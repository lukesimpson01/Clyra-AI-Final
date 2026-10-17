import fs from "node:fs/promises";
import path from "node:path";
import { designTemplateLabel, type DesignSystemSummary, type DesignTemplateSummary } from "./directive";

/**
 * Server-side reader for the bundled Clyra Design catalog. The systems and
 * templates are copied from nexu-io/open-design (Apache-2.0). See
 * bundled/NOTICE.md for attribution and the upstream commit.
 *
 * Ids are checked against a strict pattern before they touch the filesystem,
 * so a request can only ever name one of the bundled folders.
 */

const BUNDLED = path.resolve(process.cwd(), "lib/clyra-design/bundled");
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type DesignSystemPackage = DesignSystemSummary & { design: string; tokens: string };
export type DesignTemplatePackage = DesignTemplateSummary & { html: string };

function frontmatterValue(raw: string, key: string): string {
  const block = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const lines = block.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index < 0) return "";
  const inline = lines[index].slice(key.length + 1).trim();
  if (inline && inline !== "|" && inline !== ">") return inline;
  const next = lines.slice(index + 1).find((line) => line.trim());
  return next ? next.trim() : "";
}

export async function listDesignSystems(): Promise<DesignSystemSummary[]> {
  const entries = await fs.readdir(path.join(BUNDLED, "systems"), { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map(async (entry) => {
        const manifest = JSON.parse(
          await fs.readFile(path.join(BUNDLED, "systems", entry.name, "manifest.json"), "utf8"),
        ) as { name?: string; category?: string; description?: string };
        return {
          id: entry.name,
          name: manifest.name || entry.name,
          category: manifest.category || "",
          description: manifest.description || "",
        };
      }),
  );
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readDesignSystem(id: string): Promise<DesignSystemPackage | null> {
  if (!SAFE_ID.test(id)) return null;
  const dir = path.join(BUNDLED, "systems", id);
  try {
    const [summary, design, tokens] = await Promise.all([
      fs.readFile(path.join(dir, "manifest.json"), "utf8").then((raw) => JSON.parse(raw) as { name?: string; category?: string; description?: string }),
      fs.readFile(path.join(dir, "DESIGN.md"), "utf8"),
      fs.readFile(path.join(dir, "tokens.css"), "utf8"),
    ]);
    return {
      id,
      name: summary.name || id,
      category: summary.category || "",
      description: summary.description || "",
      design,
      tokens,
    };
  } catch {
    return null;
  }
}

export async function listDesignTemplates(): Promise<DesignTemplateSummary[]> {
  const entries = await fs.readdir(path.join(BUNDLED, "templates"), { withFileTypes: true }).catch(() => []);
  const rows = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
      .map(async (entry) => {
        const raw = await fs.readFile(path.join(BUNDLED, "templates", entry.name, "SKILL.md"), "utf8").catch(() => "");
        const description = frontmatterValue(raw, "description").replace(/\.\s.*$/, ".");
        return { id: entry.name, name: designTemplateLabel(entry.name), description };
      }),
  );
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export async function readDesignTemplate(id: string): Promise<DesignTemplatePackage | null> {
  if (!SAFE_ID.test(id)) return null;
  const dir = path.join(BUNDLED, "templates", id);
  try {
    const [raw, html] = await Promise.all([
      fs.readFile(path.join(dir, "SKILL.md"), "utf8"),
      fs.readFile(path.join(dir, "example.html"), "utf8"),
    ]);
    const description = frontmatterValue(raw, "description").replace(/\.\s.*$/, ".");
    return { id, name: designTemplateLabel(id), description, html };
  } catch {
    return null;
  }
}
