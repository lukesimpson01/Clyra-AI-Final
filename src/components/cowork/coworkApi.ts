/**
 * Thin fetch client for Clyra Cowork's real backend (`lib/bots/routes.ts`).
 *
 * No endpoint here is invented: every path, method and payload shape matches
 * `registerCoworkRoutes` exactly, so this file is the only place the UI needs
 * to change if that surface ever does.
 */
import type { Bot, BotStatus } from "../../../lib/bots/store";
import type { Conversation, CoworkMessage } from "../../../lib/bots/conversations";
import type { CoworkTask } from "../../../lib/bots/tasks";
import type { Capability, ToolPermissions } from "../../../lib/bots/permissions";

export type { Bot, BotStatus, Conversation, CoworkMessage, CoworkTask, Capability, ToolPermissions };

export interface ConversationParticipant {
  id: string;
  name: string;
  avatar: string;
  status: BotStatus;
}

export interface ConversationSummary extends Conversation {
  participants: ConversationParticipant[];
}

class CoworkApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new CoworkApiError(payload?.error || `Request to ${path} failed (${response.status}).`);
  }
  return payload as T;
}

export const coworkApi = {
  listBots: () => request<{ ok: true; bots: Bot[]; capabilities: Capability[] }>("/api/bots"),

  createBot: (input: { name: string; role?: string; instructions?: string; avatar?: string; permissions?: Partial<ToolPermissions> }) =>
    request<{ ok: true; bot: Bot }>("/api/bots", { method: "POST", body: JSON.stringify(input) }),

  updateBot: (id: string, input: Partial<{ name: string; role: string; instructions: string; avatar: string; permissions: Partial<ToolPermissions> }>) =>
    request<{ ok: true; bot: Bot }>(`/api/bots/${id}`, { method: "PUT", body: JSON.stringify(input) }),

  deleteBot: (id: string) =>
    request<{ ok: true; workspace: string | null }>(`/api/bots/${id}`, { method: "DELETE" }),

  listConversations: () =>
    request<{ ok: true; conversations: ConversationSummary[] }>("/api/cowork/conversations"),

  createConversation: (input: { botIds: string[]; title?: string }) =>
    request<{ ok: true; conversation: Conversation }>("/api/cowork/conversations", { method: "POST", body: JSON.stringify(input) }),

  getConversation: (id: string) =>
    request<{ ok: true; conversation: Conversation; messages: CoworkMessage[]; participants: Bot[] }>(`/api/cowork/conversations/${id}`),

  renameConversation: (id: string, title: string) =>
    request<{ ok: true; conversation: Conversation }>(`/api/cowork/conversations/${id}`, { method: "PUT", body: JSON.stringify({ title }) }),

  deleteConversation: (id: string) =>
    request<{ ok: true }>(`/api/cowork/conversations/${id}`, { method: "DELETE" }),

  sendMessage: (id: string, text: string) =>
    request<{ ok: true; messages: CoworkMessage[]; replies: CoworkMessage[]; tasks: CoworkTask[] }>(`/api/cowork/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  listTasks: (filter: { conversationId?: string; botId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.conversationId) params.set("conversationId", filter.conversationId);
    if (filter.botId) params.set("botId", filter.botId);
    const query = params.toString();
    return request<{ ok: true; tasks: CoworkTask[] }>(`/api/cowork/tasks${query ? `?${query}` : ""}`);
  },

  taskOperation: (id: string, operation: "pause" | "stop" | "resume" | "retry" | "approve" | "reject") =>
    request<{ ok: true; task: CoworkTask }>(`/api/cowork/tasks/${id}/${operation}`, { method: "POST" }),
};

export { CoworkApiError };
