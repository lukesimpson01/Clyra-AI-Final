import type { Application } from "express";
import { randomUUID } from "node:crypto";
import { runWebSearchResearch } from "../research/research-handlers";
import { recordApiUsage, usageFromOpenAi } from "../api-usage-ledger.mjs";
import {
  addMemory,
  createOnboardingLibrary,
  deleteCharacter,
  deleteChat,
  deletePersona,
  ensureDefaultPersona,
  getCharacter,
  getChat,
  listChatsForCharacter,
  listCharacters,
  listMemories,
  listRecentChats,
  listPersonas,
  newCharacterId,
  saveCharacter,
  saveChat,
  saveMemories,
  savePersona,
  saveCharacterAvatar,
  readCharacterAvatar,
  deleteCharacterAvatar,
  safeId,
  type ResponseStyle,
  type RoleplayCharacter,
  type RoleplayMessage,
} from "./roleplay-store";

/**
 * AI Roleplay backend: character library, web-search-grounded character
 * generation, avatar image search, personas, chat-session persistence, and
 * memory extraction. The actual per-turn chat completion is NOT proxied
 * through a dedicated route here - the frontend assembles the system prompt
 * (character + outfit + style + persona + memories + recent turns) client-side
 * from data these routes expose, then streams it through the existing
 * /api/deepseek/chat endpoint, exactly like the main Chat tool's
 * streamOpenAI() does. That keeps one chat-calling convention for the whole
 * app instead of a second bespoke one here.
 */

function recordUsage(payload: any, feature: string) {
  const upstream = String(process.env.MY_LLM_BASE_URL || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
  const provider = /deepseek\.com/i.test(upstream) ? "deepseek" : "openai-compatible";
  void recordApiUsage({
    provider,
    model: String(payload?.model || process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"),
    feature,
    usage: usageFromOpenAi(payload),
  }).catch((error) => console.warn("[usage] unable to record provider usage", error instanceof Error ? error.message : error));
}

async function callDeepseekJson(systemPrompt: string, userPrompt: string, feature: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Clyra API is not configured. Add DEEPSEEK_API_KEY to .env or .env.local.");
  const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
      thinking: { type: "disabled" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Clyra chat API returned ${response.status}`);
  const data = await response.json();
  recordUsage(data, feature);
  return String(data?.choices?.[0]?.message?.content || "");
}

function extractJsonObject(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return a JSON object");
  return JSON.parse(match[0]);
}

const RESPONSE_STYLES: ResponseStyle[] = [
  "short", "detailed", "cinematic", "dialogue-heavy", "descriptive",
  "casual", "romantic", "humorous", "serious", "custom",
];

function blankCharacter(id: string, name: string): RoleplayCharacter {
  const now = new Date().toISOString();
  return {
    id, name, tagline: "", tags: [], age: "", personality: "", speechPatterns: "",
    likes: "", dislikes: "", relationships: "", scenario: "", greeting: "",
    roleplayRules: "", outfit: "", responseStyle: "descriptive", customResponseStyle: "",
    dialogueFormat: "name",
    avatarUrl: "", avatarSourceUrl: "", visibility: "private", favorite: false,
    createdAt: now, updatedAt: now, lastUsedAt: null, generationQuery: null, generationSources: [],
  };
}

export function registerRoleplayRoutes(app: Application) {
  // --- Characters ---

  app.get("/api/roleplay/characters", async (_req, res) => {
    // Do not silently fill a new user's library. The welcome flow asks what
    // they are interested in first, then materializes a real starter library.
    res.json({ characters: await listCharacters() });
  });

  app.post("/api/roleplay/onboarding-library", async (req, res) => {
    const interests = Array.isArray((req.body || {}).interests)
      ? (req.body || {}).interests.map(String).map((interest: string) => interest.trim()).filter(Boolean).slice(0, 8)
      : [];
    if (!interests.length) return void res.status(400).json({ error: "Choose at least one kind of character or world." });
    res.json({ characters: await createOnboardingLibrary(interests) });
  });

  app.get("/api/roleplay/characters/:id", async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return void res.status(404).json({ error: "Character not found." });
    res.json({ character });
  });

  app.post("/api/roleplay/characters", async (req, res) => {
    const body = (req.body || {}) as Partial<RoleplayCharacter>;
    const name = String(body.name || "").trim();
    if (!name) return void res.status(400).json({ error: "A character name is required." });
    const id = newCharacterId(name);
    const character: RoleplayCharacter = { ...blankCharacter(id, name), ...body, id, name };
    await saveCharacter(character);
    res.json({ character });
  });

  app.put("/api/roleplay/characters/:id", async (req, res) => {
    const existing = await getCharacter(req.params.id);
    if (!existing) return void res.status(404).json({ error: "Character not found." });
    const body = (req.body || {}) as Partial<RoleplayCharacter>;
    const character: RoleplayCharacter = { ...existing, ...body, id: existing.id, updatedAt: new Date().toISOString() };
    await saveCharacter(character);
    res.json({ character });
  });

  app.delete("/api/roleplay/characters/:id", async (req, res) => {
    await deleteCharacter(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/roleplay/characters/:id/touch", async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return void res.status(404).json({ error: "Character not found." });
    character.lastUsedAt = new Date().toISOString();
    await saveCharacter(character);
    res.json({ ok: true });
  });

  // --- Web-search-grounded character generation ---

  app.post("/api/roleplay/characters/generate", async (req, res) => {
    try {
      const query = String((req.body || {}).query || "").trim();
      if (!query) return void res.status(400).json({ error: "Describe the character, person, or fandom to generate." });
      // Default true to preserve prior behavior for existing callers that
      // don't send this field. Callers can turn it off for purely original
      // characters, where a search round-trip only adds latency.
      const webResearch = (req.body || {}).webResearch !== false;
      const worldMode = String((req.body || {}).mode || "") === "world";

      const research = webResearch ? await runWebSearchResearch({ query, maxResults: 6, fetchTop: 3 }) : null;
      const sources = research && research.ok && "urls" in research ? research.urls || [] : [];
      const excerpts = research && research.ok && "pages" in research
        ? (research.pages || []).map((page: any, i: number) => `### Source ${i + 1}: ${page.url}\n${page.blocked ? "(blocked)" : page.excerpt}`).join("\n\n")
        : "";

      const systemPrompt = `You build roleplay character profiles for an AI-companion app${webResearch ? ", grounded in real research when it's available" : ""}.
Respond ONLY with a raw JSON object (no markdown fences) matching exactly this shape:
{
  "name": "Character's display name",
  "tagline": "One-sentence hook shown on their library card (<= 90 chars)",
  "tags": ["3-6 short lowercase category/fandom tags"],
  "age": "an age or age-range as a short string, or empty string if not applicable",
  "personality": "2-4 sentences describing core personality traits",
  "speechPatterns": "How they talk: vocabulary, tone, verbal tics, formality",
  "likes": "comma-separated likes",
  "dislikes": "comma-separated dislikes",
  "relationships": "key relationships/allies/rivals relevant to roleplay",
  "scenario": "1-2 sentences setting the default roleplay scene/situation",
  "greeting": "The first in-character message they'd send to start a conversation, written in their voice",
  "roleplayRules": "Short bullet-style notes on how to keep them in character and any boundaries",
  "outfit": "A specific, concrete description of their current default appearance/outfit",
  "responseStyle": "one of: short, detailed, cinematic, dialogue-heavy, descriptive, casual, romantic, humorous, serious",
  "avatarSearchQuery": "A short, specific image-search query likely to find a real public photo/art of this character or person"
}
${worldMode ? 'The user wants to enter a WORLD or setting rather than a single named character. Invent a specific, vivid inhabitant who works as the reader\'s entry point into that world (a guide, ruler, rival, or local) and write "scenario" as 2-3 sentences establishing the wider world/setting they live in, not just their personal situation. ' : ""}If this is a known real person, fictional character, or fandom figure and research context is provided below, ground every field in it and do not invent contradicting facts. If research is thin or the character is original/invented, write a coherent original profile from the user's request instead. Never leave "name" empty.`;

      const userPrompt = `User's request: ${query}
${webResearch ? `
Research sources:
${sources.map((u: string, i: number) => `${i + 1}. ${u}`).join("\n") || "(none found)"}

Research excerpts:
${excerpts || "(no page text retrieved - research may be blocked or the character may be original; write a coherent original profile from the request instead)"}` : "\n(Web research skipped for this request - write a coherent original profile.)"}`;

      const raw = await callDeepseekJson(systemPrompt, userPrompt, "roleplay-generate");
      const parsed = extractJsonObject(raw);

      const id = newCharacterId(String(parsed.name || query));
      const character: RoleplayCharacter = {
        ...blankCharacter(id, String(parsed.name || query).slice(0, 80)),
        tagline: String(parsed.tagline || "").slice(0, 140),
        tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 6) : [],
        age: String(parsed.age || ""),
        personality: String(parsed.personality || ""),
        speechPatterns: String(parsed.speechPatterns || ""),
        likes: String(parsed.likes || ""),
        dislikes: String(parsed.dislikes || ""),
        relationships: String(parsed.relationships || ""),
        scenario: String(parsed.scenario || ""),
        greeting: String(parsed.greeting || `*${parsed.name || "The character"} looks up as you approach.*`),
        roleplayRules: String(parsed.roleplayRules || ""),
        outfit: String(parsed.outfit || ""),
        responseStyle: RESPONSE_STYLES.includes(parsed.responseStyle) ? parsed.responseStyle : "descriptive",
        generationQuery: query,
        generationSources: sources.slice(0, 6),
      };

      res.json({ character, avatarSearchQuery: String(parsed.avatarSearchQuery || parsed.name || query) });
    } catch (error) {
      console.error("[roleplay] character generation failed:", error);
      res.status(502).json({ error: error instanceof Error ? error.message : "Character generation failed." });
    }
  });

  // --- Avatar image search (Wikimedia Commons - no API key required) ---

  // --- Character portraits ---
  //
  // Uploading is the path that always works: web search only finds public
  // figures and fictional characters that happen to be on Wikimedia, which
  // leaves every original character without a face.

  app.post("/api/roleplay/characters/:id/avatar", async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return void res.status(404).json({ error: "Character not found." });
    const data = String((req.body || {}).data || "");
    if (!data) return void res.status(400).json({ error: "No image was uploaded." });
    try {
      const avatarUrl = await saveCharacterAvatar(character.id, data);
      const updated = { ...character, avatarUrl, avatarSourceUrl: "", updatedAt: new Date().toISOString() };
      await saveCharacter(updated);
      res.json({ character: updated });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "That image could not be saved." });
    }
  });

  app.delete("/api/roleplay/characters/:id/avatar", async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return void res.status(404).json({ error: "Character not found." });
    await deleteCharacterAvatar(character.id);
    const updated = { ...character, avatarUrl: "", avatarSourceUrl: "", updatedAt: new Date().toISOString() };
    await saveCharacter(updated);
    res.json({ character: updated });
  });

  app.get("/api/roleplay/avatars/:file", async (req, res) => {
    const found = await readCharacterAvatar(req.params.file);
    if (!found) return void res.status(404).end();
    res.type(found.type);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.sendFile(found.path);
  });

  app.get("/api/roleplay/avatar-search", async (req, res) => {
    const query = String(req.query.query || "").trim();
    if (!query) return void res.status(400).json({ error: "A search query is required." });
    try {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
      url.searchParams.set("gsrnamespace", "6");
      url.searchParams.set("gsrlimit", "12");
      url.searchParams.set("prop", "imageinfo");
      url.searchParams.set("iiprop", "url|mime|extmetadata");
      url.searchParams.set("iiurlwidth", "480");
      url.searchParams.set("origin", "*");
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const payload = await response.json() as { query?: { pages?: any[] } };
      const pages = Array.isArray(payload.query?.pages) ? payload.query!.pages! : [];
      const results = pages
        .map((page) => {
          const info = page.imageinfo?.[0];
          if (!info || !/^image\//i.test(String(info.mime || ""))) return null;
          const artist = String(info.extmetadata?.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
          const license = String(info.extmetadata?.LicenseShortName?.value || "").trim();
          return {
            thumbnailUrl: info.thumburl || info.url,
            fullUrl: info.url,
            sourceUrl: info.descriptionurl || info.url,
            title: String(page.title || "").replace(/^File:/, ""),
            attribution: [artist, license].filter(Boolean).join(" · "),
          };
        })
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      res.json({ ok: true, results });
    } catch (error) {
      res.json({ ok: false, results: [], error: "Image search is temporarily unavailable." });
    }
  });

  // --- Personas ---

  app.get("/api/roleplay/personas", async (_req, res) => {
    await ensureDefaultPersona();
    res.json({ personas: await listPersonas() });
  });

  app.post("/api/roleplay/personas", async (req, res) => {
    const body = (req.body || {}) as Partial<RoleplayCharacter>;
    const name = String(body.name || "").trim();
    if (!name) return void res.status(400).json({ error: "A persona name is required." });
    const now = new Date().toISOString();
    const persona = {
      id: randomUUID(), name, appearance: String((req.body || {}).appearance || ""),
      personality: String((req.body || {}).personality || ""), backstory: String((req.body || {}).backstory || ""),
      isDefault: false, createdAt: now, updatedAt: now,
    };
    await savePersona(persona);
    res.json({ persona });
  });

  app.put("/api/roleplay/personas/:id", async (req, res) => {
    const personas = await listPersonas();
    const existing = personas.find((p) => p.id === req.params.id);
    if (!existing) return void res.status(404).json({ error: "Persona not found." });
    const persona = { ...existing, ...req.body, id: existing.id, updatedAt: new Date().toISOString() };
    await savePersona(persona);
    res.json({ persona });
  });

  app.delete("/api/roleplay/personas/:id", async (req, res) => {
    await deletePersona(req.params.id);
    res.json({ ok: true });
  });

  // --- Chats ---

  // Registered before the character-scoped chats route below so "recent"
  // can't be swallowed by an :id param matcher on a different route tree -
  // they're separate paths here, but keeping the specific route first is
  // the safer convention if either ever moves under the other.
  // Every story the user has, newest first — what the history page resumes from.
  app.get("/api/roleplay/chats", async (_req, res) => {
    res.json({ chats: await listRecentChats(Number.MAX_SAFE_INTEGER) });
  });

  app.get("/api/roleplay/chats/recent", async (req, res) => {
    const limit = Math.max(1, Math.min(24, Number(req.query.limit) || 12));
    res.json({ chats: await listRecentChats(limit) });
  });

  app.get("/api/roleplay/characters/:id/chats", async (req, res) => {
    res.json({ chats: await listChatsForCharacter(req.params.id) });
  });

  app.post("/api/roleplay/characters/:id/chats", async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return void res.status(404).json({ error: "Character not found." });
    const personaId = String((req.body || {}).personaId || (await ensureDefaultPersona()).id);
    const now = new Date().toISOString();
    const greetingMessage: RoleplayMessage = {
      id: randomUUID(), role: "assistant", content: character.greeting || `*${character.name} greets you.*`,
      createdAt: now, personaId: null, swipes: [], activeSwipe: 0,
    };
    const chat = {
      id: safeId(randomUUID()), characterId: character.id, title: character.name,
      personaId, messages: [greetingMessage],
      // A new story starts the character in their default outfit; from here it
      // belongs to the story and drifts as the story changes it.
      currentOutfit: character.outfit || "",
      outfitUpdatedAt: null,
      dialogueFormat: null,
      createdAt: now, updatedAt: now,
    };
    await saveChat(chat);
    res.json({ chat });
  });

  app.get("/api/roleplay/chats/:chatId", async (req, res) => {
    const chat = await getChat(req.params.chatId);
    if (!chat) return void res.status(404).json({ error: "Chat not found." });
    res.json({ chat });
  });

  app.put("/api/roleplay/chats/:chatId", async (req, res) => {
    const existing = await getChat(req.params.chatId);
    if (!existing) return void res.status(404).json({ error: "Chat not found." });
    const chat = { ...existing, ...req.body, id: existing.id, characterId: existing.characterId, updatedAt: new Date().toISOString() };
    await saveChat(chat);
    res.json({ chat });
  });

  app.delete("/api/roleplay/chats/:chatId", async (req, res) => {
    await deleteChat(req.params.chatId);
    res.json({ ok: true });
  });

  // --- Memories ---

  app.get("/api/roleplay/characters/:id/memories", async (req, res) => {
    res.json({ memories: await listMemories(req.params.id) });
  });

  app.post("/api/roleplay/characters/:id/memories", async (req, res) => {
    const text = String((req.body || {}).text || "").trim();
    if (!text) return void res.status(400).json({ error: "Memory text is required." });
    const memory = await addMemory(req.params.id, text, (req.body || {}).chatId || null, Boolean((req.body || {}).pinned));
    res.json({ memory });
  });

  app.put("/api/roleplay/characters/:id/memories/:memoryId", async (req, res) => {
    const memories = await listMemories(req.params.id);
    const index = memories.findIndex((m) => m.id === req.params.memoryId);
    if (index === -1) return void res.status(404).json({ error: "Memory not found." });
    memories[index] = { ...memories[index], ...req.body, id: memories[index].id };
    await saveMemories(req.params.id, memories);
    res.json({ memory: memories[index] });
  });

  app.delete("/api/roleplay/characters/:id/memories/:memoryId", async (req, res) => {
    const memories = await listMemories(req.params.id);
    await saveMemories(req.params.id, memories.filter((m) => m.id !== req.params.memoryId));
    res.json({ ok: true });
  });

  /** Summarize a chat's recent turns into a few durable memory candidates. */
  app.post("/api/roleplay/characters/:id/memories/extract", async (req, res) => {
    try {
      const character = await getCharacter(req.params.id);
      if (!character) return void res.status(404).json({ error: "Character not found." });
      const transcript = String((req.body || {}).transcript || "").trim();
      if (!transcript) return void res.json({ memories: [] });

      const systemPrompt = `You extract durable facts worth remembering from a roleplay conversation between a user and the character "${character.name}".
Respond ONLY with a raw JSON array of short strings (no markdown fences), each one a single self-contained fact worth remembering long-term (names, promises, relationship developments, established locations, revealed backstory, outfit/appearance changes, preferences). Skip small talk and anything already obvious from the character's fixed profile. Return at most 5 items. Return [] if nothing durable happened.`;
      const raw = await callDeepseekJson(systemPrompt, transcript, "roleplay-memory-extract");
      const match = raw.match(/\[[\s\S]*\]/);
      const facts: string[] = match ? JSON.parse(match[0]) : [];
      const chatId = (req.body || {}).chatId || null;
      const saved = [];
      for (const fact of facts.slice(0, 5)) {
        if (typeof fact === "string" && fact.trim()) saved.push(await addMemory(character.id, fact.trim(), chatId, false));
      }
      res.json({ memories: saved });
    } catch (error) {
      console.error("[roleplay] memory extraction failed:", error);
      res.json({ memories: [] });
    }
  });
}
