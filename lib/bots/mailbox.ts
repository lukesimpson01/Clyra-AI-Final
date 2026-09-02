/**
 * Agent-to-agent messaging for Clyra Cowork.
 *
 * Bots collaborate by sending each other explicit, structured packets — not
 * by sharing one giant conversation. That is the whole design: pouring every
 * agent's transcript into every other agent's context is what makes
 * multi-agent systems expensive, slow and incoherent. A handoff carries only
 * the task, the context that matters, the files involved and what is needed
 * back.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { canMessage, type ToolPermissions } from "./permissions";
import { resolveInWorkspace, workspaceRoot } from "./workspace";

export type HandoffState = "queued" | "delivered" | "accepted" | "completed" | "rejected";

export interface HandoffPacket {
  id: string;
  fromBotId: string;
  fromBotName: string;
  toBotId: string;
  /** What the receiving bot is being asked to do. */
  task: string;
  /** Only the context the receiver actually needs. */
  context: string;
  /** Workspace-relative paths explicitly shared with the receiver. */
  attachments: string[];
  /** What the sender expects back. */
  expectedResult: string;
  state: HandoffState;
  /** Set when the receiver finishes. */
  result: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set for a parent/child task chain. */
  parentId: string | null;
}

export class MailboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailboxError";
  }
}

/** Extract `@Name` mentions from composed text. */
export function parseMentions(text: string): string[] {
  const found = new Set<string>();
  // Word-boundary anchored so an email address does not read as a mention.
  for (const match of String(text || "").matchAll(/(?:^|[\s(])@([A-Za-z0-9][\w-]{0,47})/g)) {
    found.add(match[1]);
  }
  return [...found];
}

export interface MailboxDeps {
  /** Resolve a mention like "Coder" to a bot, or null. */
  resolveName: (name: string) => Promise<{ id: string; name: string; slug: string } | null>;
}

export class AgentMailbox {
  constructor(private readonly deps: MailboxDeps) {}

  private file(slug: string) {
    return path.join(workspaceRoot(slug), "logs", "mailbox.json");
  }

  private async read(slug: string): Promise<HandoffPacket[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file(slug), "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async write(slug: string, packets: HandoffPacket[]) {
    const target = this.file(slug);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(packets, null, 2), "utf8");
    await fs.rename(temporary, target);
  }

  /**
   * Send a handoff from one bot to another.
   *
   * Attachments are validated against the *sender's* workspace: a bot can
   * only share files it actually owns, which stops a handoff being used as a
   * way to read another bot's private directory by naming a path in it.
   */
  async send(input: {
    from: { id: string; name: string; slug: string; permissions: ToolPermissions };
    toBotId: string;
    toSlug: string;
    task: string;
    context?: string;
    attachments?: string[];
    expectedResult?: string;
    parentId?: string | null;
  }): Promise<HandoffPacket> {
    if (input.from.id === input.toBotId) {
      throw new MailboxError("A bot cannot hand off to itself.");
    }
    if (!canMessage(input.from.permissions, input.toBotId)) {
      throw new MailboxError(`${input.from.name} is not allowed to message that bot.`);
    }
    const task = String(input.task || "").trim();
    if (!task) throw new MailboxError("A handoff needs a task.");

    const attachments: string[] = [];
    for (const candidate of input.attachments ?? []) {
      // Throws if the path escapes the sender's workspace.
      resolveInWorkspace(input.from.slug, candidate);
      attachments.push(candidate);
    }

    const now = new Date().toISOString();
    const packet: HandoffPacket = {
      id: crypto.randomUUID(),
      fromBotId: input.from.id,
      fromBotName: input.from.name,
      toBotId: input.toBotId,
      task: task.slice(0, 4000),
      context: String(input.context || "").slice(0, 8000),
      attachments,
      expectedResult: String(input.expectedResult || "").slice(0, 2000),
      state: "queued",
      result: null,
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId ?? null,
    };

    const inbox = await this.read(input.toSlug);
    await this.write(input.toSlug, [...inbox, packet]);
    return packet;
  }

  async inbox(slug: string, state?: HandoffState): Promise<HandoffPacket[]> {
    const packets = await this.read(slug);
    return state ? packets.filter((packet) => packet.state === state) : packets;
  }

  async setState(slug: string, packetId: string, state: HandoffState, result?: string): Promise<HandoffPacket | null> {
    const packets = await this.read(slug);
    const existing = packets.find((packet) => packet.id === packetId);
    if (!existing) return null;
    const updated: HandoffPacket = {
      ...existing,
      state,
      result: result !== undefined ? String(result).slice(0, 20_000) : existing.result,
      updatedAt: new Date().toISOString(),
    };
    await this.write(slug, packets.map((packet) => (packet.id === packetId ? updated : packet)));
    return updated;
  }

  /**
   * Turn `@Coder do the thing` into real handoffs.
   *
   * Unknown mentions are returned rather than silently dropped, so the UI can
   * tell the user "there is no bot called @Desginer" instead of the message
   * quietly going nowhere.
   */
  async dispatchMentions(input: {
    from: { id: string; name: string; slug: string; permissions: ToolPermissions };
    text: string;
    parentId?: string | null;
  }): Promise<{ sent: HandoffPacket[]; unknown: string[]; refused: { name: string; reason: string }[] }> {
    const sent: HandoffPacket[] = [];
    const unknown: string[] = [];
    const refused: { name: string; reason: string }[] = [];

    for (const mention of parseMentions(input.text)) {
      const target = await this.deps.resolveName(mention);
      if (!target) {
        unknown.push(mention);
        continue;
      }
      if (target.id === input.from.id) continue;
      try {
        sent.push(await this.send({
          from: input.from,
          toBotId: target.id,
          toSlug: target.slug,
          task: input.text,
          expectedResult: "Reply to the requesting bot when done.",
          parentId: input.parentId ?? null,
        }));
      } catch (error) {
        refused.push({ name: mention, reason: error instanceof Error ? error.message : "Refused." });
      }
    }
    return { sent, unknown, refused };
  }
}
