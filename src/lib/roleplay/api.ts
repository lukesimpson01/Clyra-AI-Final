import type {
  RoleplayCharacter,
  RoleplayChat,
  RoleplayMemory,
  RoleplayPersona,
} from "./types";

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
  return data as T;
}

export const roleplayApi = {
  listCharacters: () => fetch("/api/roleplay/characters").then((r) => json<{ characters?: RoleplayCharacter[] }>(r)).then((d) => d.characters ?? []),
  createOnboardingLibrary: (interests: string[]) =>
    fetch("/api/roleplay/onboarding-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interests }) })
      .then((r) => json<{ characters?: RoleplayCharacter[] }>(r)).then((d) => d.characters ?? []),
  getCharacter: (id: string) => fetch(`/api/roleplay/characters/${id}`).then((r) => json<{ character: RoleplayCharacter }>(r)).then((d) => d.character),
  createCharacter: (body: Partial<RoleplayCharacter>) =>
    fetch("/api/roleplay/characters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => json<{ character: RoleplayCharacter }>(r)).then((d) => d.character),
  updateCharacter: (id: string, body: Partial<RoleplayCharacter>) =>
    fetch(`/api/roleplay/characters/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => json<{ character: RoleplayCharacter }>(r)).then((d) => d.character),
  deleteCharacter: (id: string) => fetch(`/api/roleplay/characters/${id}`, { method: "DELETE" }).then((r) => json(r)),
  touchCharacter: (id: string) => fetch(`/api/roleplay/characters/${id}/touch`, { method: "POST" }).then((r) => json(r)).catch(() => {}),

  generateCharacter: (query: string, options?: { webResearch?: boolean; mode?: "character" | "world" }) =>
    fetch("/api/roleplay/characters/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, webResearch: options?.webResearch, mode: options?.mode }) })
      .then((r) => json<{ character: RoleplayCharacter; avatarSearchQuery: string }>(r)),

  uploadAvatar: (characterId: string, dataUrl: string) =>
    fetch(`/api/roleplay/characters/${characterId}/avatar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: dataUrl }) })
      .then((r) => json<{ character: RoleplayCharacter }>(r)).then((d) => d.character),
  removeAvatar: (characterId: string) =>
    fetch(`/api/roleplay/characters/${characterId}/avatar`, { method: "DELETE" })
      .then((r) => json<{ character: RoleplayCharacter }>(r)).then((d) => d.character),

  listAllChats: () =>
    fetch("/api/roleplay/chats").then((r) => json<{ chats?: RoleplayChat[] }>(r)).then((d) => d.chats ?? []),

  searchAvatars: (query: string) =>
    fetch(`/api/roleplay/avatar-search?query=${encodeURIComponent(query)}`)
      .then((r) => json<{ ok: boolean; results: Array<{ thumbnailUrl: string; fullUrl: string; sourceUrl: string; title: string; attribution: string }> }>(r))
      .then((d) => d.results ?? []),

  listPersonas: () => fetch("/api/roleplay/personas").then((r) => json<{ personas?: RoleplayPersona[] }>(r)).then((d) => d.personas ?? []),
  createPersona: (body: Partial<RoleplayPersona>) =>
    fetch("/api/roleplay/personas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => json<{ persona: RoleplayPersona }>(r)).then((d) => d.persona),
  updatePersona: (id: string, body: Partial<RoleplayPersona>) =>
    fetch(`/api/roleplay/personas/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => json<{ persona: RoleplayPersona }>(r)).then((d) => d.persona),
  deletePersona: (id: string) => fetch(`/api/roleplay/personas/${id}`, { method: "DELETE" }).then((r) => json(r)),

  listChats: (characterId: string) =>
    fetch(`/api/roleplay/characters/${characterId}/chats`).then((r) => json<{ chats?: RoleplayChat[] }>(r)).then((d) => d.chats ?? []),
  listRecentChats: (limit = 12) =>
    fetch(`/api/roleplay/chats/recent?limit=${limit}`).then((r) => json<{ chats?: RoleplayChat[] }>(r)).then((d) => d.chats ?? []),
  createChat: (characterId: string, personaId: string) =>
    fetch(`/api/roleplay/characters/${characterId}/chats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaId }) })
      .then((r) => json<{ chat: RoleplayChat }>(r)).then((d) => d.chat),
  getChat: (chatId: string) => fetch(`/api/roleplay/chats/${chatId}`).then((r) => json<{ chat: RoleplayChat }>(r)).then((d) => d.chat),
  saveChat: (chat: RoleplayChat) =>
    fetch(`/api/roleplay/chats/${chat.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(chat) })
      .then((r) => json<{ chat: RoleplayChat }>(r)).then((d) => d.chat),
  deleteChat: (chatId: string) => fetch(`/api/roleplay/chats/${chatId}`, { method: "DELETE" }).then((r) => json(r)),

  listMemories: (characterId: string) =>
    fetch(`/api/roleplay/characters/${characterId}/memories`).then((r) => json<{ memories?: RoleplayMemory[] }>(r)).then((d) => d.memories ?? []),
  addMemory: (characterId: string, text: string, chatId: string | null, pinned = false) =>
    fetch(`/api/roleplay/characters/${characterId}/memories`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, chatId, pinned }) })
      .then((r) => json<{ memory: RoleplayMemory }>(r)).then((d) => d.memory),
  updateMemory: (characterId: string, memoryId: string, body: Partial<RoleplayMemory>) =>
    fetch(`/api/roleplay/characters/${characterId}/memories/${memoryId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => json<{ memory: RoleplayMemory }>(r)).then((d) => d.memory),
  deleteMemory: (characterId: string, memoryId: string) =>
    fetch(`/api/roleplay/characters/${characterId}/memories/${memoryId}`, { method: "DELETE" }).then((r) => json(r)),
  extractMemories: (characterId: string, transcript: string, chatId: string | null) =>
    fetch(`/api/roleplay/characters/${characterId}/memories/extract`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript, chatId }) })
      .then((r) => json<{ memories?: RoleplayMemory[] }>(r)).then((d) => d.memories ?? []),
};
