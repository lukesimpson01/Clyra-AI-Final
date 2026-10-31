/**
 * Conversations for Clyra Cowork.
 *
 * A conversation is either a direct thread with one bot or a group with
 * several. Messages live in one JSON file per conversation so a long thread
 * never has to be loaded to render the sidebar, which only needs the last
 * line and a timestamp.
 *
 * Group threads are where the multi-agent behaviour actually shows up: a
 * message addressed to several bots is answered by each of them, and a bot
 * can address another with an @mention inside the thread.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";

export type MessageAuthor = "user" | "bot" | "system";

export interface CoworkMessage {
  id: string;
  author: MessageAuthor;
  /** Set when author is "bot". */
  botId: string | null;
  botName: string | null;
  text: string;
  at: string;
  /** Bot ids this message is directed at, for group threads. */
  addressed: string[];
}

export interface Conversation {
  id: string;
  /** User-visible title. Groups get an editable name; directs use the bot's. */
  title: string;
  botIds: string[];
  isGroup: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  lastMessageAt: string | null;
  /** Cleared when the user opens the thread. */
  unread: number;
}

export class ConversationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationError";
  }
}

export class ConversationStore {
  private readonly indexFile: string;
  private readonly messagesDir: string;

  constructor(private readonly root = clyraDataPath(".clyra", "bots")) {
    this.indexFile = path.join(root, "conversations.json");
    this.messagesDir = path.join(root, "conversations");
  }

  private async readIndex(): Promise<Conversation[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexFile, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeIndex(conversations: Conversation[]) {
    await fs.mkdir(this.root, { recursive: true });
    const temporary = `${this.indexFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(conversations, null, 2), "utf8");
    await fs.rename(temporary, this.indexFile);
  }

  private messageFile(id: string) {
    // The id is generated here (a uuid), never user input, but it still gets
    // basename'd so a crafted id can never walk out of the messages dir.
    return path.join(this.messagesDir, `${path.basename(id)}.json`);
  }

  async list(): Promise<Conversation[]> {
    const conversations = await this.readIndex();
    return conversations.sort((a, b) =>
      (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  async get(id: string): Promise<Conversation | null> {
    return (await this.readIndex()).find((conversation) => conversation.id === id) ?? null;
  }

  async messages(id: string): Promise<CoworkMessage[]> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.messageFile(id), "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async writeMessages(id: string, messages: CoworkMessage[]) {
    await fs.mkdir(this.messagesDir, { recursive: true });
    const target = this.messageFile(id);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(messages, null, 2), "utf8");
    await fs.rename(temporary, target);
  }

  async create(input: { botIds: string[]; title: string; isGroup?: boolean }): Promise<Conversation> {
    const botIds = [...new Set(input.botIds.filter(Boolean))];
    if (!botIds.length) throw new ConversationError("Pick at least one bot to message.");
    const title = String(input.title || "").trim();
    if (!title) throw new ConversationError("A conversation needs a title.");

    const conversations = await this.readIndex();
    const isGroup = input.isGroup ?? botIds.length > 1;

    // Reuse an existing direct thread rather than stacking duplicates in the
    // sidebar — messaging the same bot twice should continue one conversation.
    if (!isGroup) {
      const existing = conversations.find((item) => !item.isGroup && item.botIds[0] === botIds[0]);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: title.slice(0, 80),
      botIds,
      isGroup,
      createdAt: now,
      updatedAt: now,
      lastMessage: "",
      lastMessageAt: null,
      unread: 0,
    };
    await this.writeIndex([...conversations, conversation]);
    return conversation;
  }

  async rename(id: string, title: string): Promise<Conversation> {
    const conversations = await this.readIndex();
    const existing = conversations.find((conversation) => conversation.id === id);
    if (!existing) throw new ConversationError("That conversation no longer exists.");
    const next = { ...existing, title: String(title || "").trim().slice(0, 80) || existing.title, updatedAt: new Date().toISOString() };
    await this.writeIndex(conversations.map((item) => (item.id === id ? next : item)));
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const conversations = await this.readIndex();
    if (!conversations.some((conversation) => conversation.id === id)) return false;
    await this.writeIndex(conversations.filter((conversation) => conversation.id !== id));
    await fs.rm(this.messageFile(id), { force: true });
    return true;
  }

  async markRead(id: string): Promise<void> {
    const conversations = await this.readIndex();
    const existing = conversations.find((conversation) => conversation.id === id);
    if (!existing || existing.unread === 0) return;
    await this.writeIndex(conversations.map((item) => (item.id === id ? { ...item, unread: 0 } : item)));
  }

  /** Append a message and refresh the sidebar preview in one step. */
  async append(id: string, message: Omit<CoworkMessage, "id" | "at">): Promise<CoworkMessage> {
    const conversations = await this.readIndex();
    const existing = conversations.find((conversation) => conversation.id === id);
    if (!existing) throw new ConversationError("That conversation no longer exists.");

    const entry: CoworkMessage = {
      ...message,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      text: String(message.text ?? "").slice(0, 20_000),
    };
    const messages = await this.messages(id);
    await this.writeMessages(id, [...messages, entry]);

    const preview = entry.author === "system"
      ? entry.text
      : entry.author === "bot" && existing.isGroup
        ? `${entry.botName}: ${entry.text}`
        : entry.text;

    await this.writeIndex(conversations.map((item) => item.id === id ? {
      ...item,
      updatedAt: entry.at,
      lastMessage: preview.replace(/\s+/g, " ").slice(0, 120),
      lastMessageAt: entry.at,
      // Only a bot's reply is "unread" — the user has by definition seen
      // their own message and the system notes that follow it.
      unread: entry.author === "bot" ? item.unread + 1 : item.unread,
    } : item));

    return entry;
  }
}
