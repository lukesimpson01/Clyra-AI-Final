/**
 * Bot definitions and persistence for Clyra Cowork.
 *
 * A bot is durable: closing Clyra and reopening it must return the same
 * workers, with the same workspace, permissions and history. The definition
 * lives in one JSON registry; everything large (files, artifacts, logs,
 * conversation) lives in the bot's own workspace directory so the registry
 * stays small and cheap to read on every launch.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { botSlug, ensureWorkspace, workspaceRoot } from "./workspace";
import { normalisePermissions, type ToolPermissions } from "./permissions";

export type BotStatus = "idle" | "thinking" | "browsing" | "coding" | "waiting" | "needs_approval" | "done" | "error";

export interface Bot {
  id: string;
  name: string;
  slug: string;
  role: string;
  instructions: string;
  avatar: string;
  permissions: ToolPermissions;
  status: BotStatus;
  statusDetail: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
}

export class BotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotValidationError";
  }
}

const readString = (value: unknown, fallback: string, max: number) => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
};

const STATUSES: BotStatus[] = ["idle", "thinking", "browsing", "coding", "waiting", "needs_approval", "done", "error"];

export function normaliseBot(input: unknown, existing?: Bot): Bot {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = readString(source.name, existing?.name ?? "", 60);
  if (!name) throw new BotValidationError("Give the bot a name.");

  // Throws for a name that cannot be a folder (e.g. ".."), which is exactly
  // when we want to refuse rather than invent a slug.
  const slug = existing?.slug ?? botSlug(name);

  const status = STATUSES.includes(source.status as BotStatus)
    ? (source.status as BotStatus)
    : existing?.status ?? "idle";

  const now = new Date().toISOString();
  return {
    id: existing?.id ?? crypto.randomUUID(),
    name,
    slug,
    role: readString(source.role, existing?.role ?? "Assistant", 80),
    instructions: readString(source.instructions, existing?.instructions ?? "", 8000),
    avatar: readString(source.avatar, existing?.avatar ?? "🤖", 16),
    permissions: source.permissions !== undefined
      ? normalisePermissions(source.permissions)
      : existing?.permissions ?? normalisePermissions(undefined),
    status,
    statusDetail: readString(source.statusDetail, existing?.statusDetail ?? "", 160),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastActiveAt: existing?.lastActiveAt ?? null,
  };
}

export class BotStore {
  private readonly file: string;

  constructor(private readonly root = clyraDataPath(".clyra", "bots")) {
    this.file = path.join(root, "bots.json");
  }

  private async readAll(): Promise<Bot[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A missing or corrupt registry is an empty one: Cowork must still open.
      return [];
    }
  }

  private async writeAll(bots: Bot[]): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(bots, null, 2), "utf8");
    await fs.rename(temporary, this.file);
  }

  async list(): Promise<Bot[]> {
    const bots = await this.readAll();
    return bots.sort((a, b) => (b.lastActiveAt ?? b.updatedAt).localeCompare(a.lastActiveAt ?? a.updatedAt));
  }

  async get(id: string): Promise<Bot | null> {
    return (await this.readAll()).find((bot) => bot.id === id) ?? null;
  }

  async create(input: unknown): Promise<Bot> {
    const bots = await this.readAll();
    const bot = normaliseBot(input);
    // Slugs are the workspace directory name, so they must be unique or two
    // bots would share a workspace and see each other's private files.
    if (bots.some((existing) => existing.slug === bot.slug)) {
      throw new BotValidationError(`A bot using the folder name "${bot.slug}" already exists.`);
    }
    await ensureWorkspace(bot.slug);
    await this.writeAll([...bots, bot]);
    return bot;
  }

  async update(id: string, input: unknown): Promise<Bot> {
    const bots = await this.readAll();
    const existing = bots.find((bot) => bot.id === id);
    if (!existing) throw new BotValidationError("That bot no longer exists.");
    // The slug is intentionally frozen after creation: renaming the folder
    // would orphan the workspace the bot's files and logs already live in.
    const bot = normaliseBot(input, existing);
    await this.writeAll(bots.map((item) => (item.id === id ? bot : item)));
    return bot;
  }

  async setStatus(id: string, status: BotStatus, detail = ""): Promise<Bot | null> {
    const bots = await this.readAll();
    const existing = bots.find((bot) => bot.id === id);
    if (!existing) return null;
    const updated: Bot = {
      ...existing,
      status,
      statusDetail: detail.slice(0, 160),
      lastActiveAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.writeAll(bots.map((item) => (item.id === id ? updated : item)));
    return updated;
  }

  /** Remove the registry entry. The workspace is left on disk on purpose:
   *  deleting a folder of the user's real work is not something a "remove
   *  bot" click should do silently. */
  async remove(id: string): Promise<{ removed: boolean; workspace: string | null }> {
    const bots = await this.readAll();
    const existing = bots.find((bot) => bot.id === id);
    if (!existing) return { removed: false, workspace: null };
    await this.writeAll(bots.filter((bot) => bot.id !== id));
    return { removed: true, workspace: workspaceRoot(existing.slug) };
  }
}
