import type { AgentEvent, TodoItem } from "../../lib/chat-agent/events";

export type { AgentEvent, TodoItem };
export type AgentStepView = Extract<AgentEvent, { type: "step" }>;
export type AgentMapPlace = Extract<AgentEvent, { type: "map" }>["place"];
export type ChatAgentRun = { todos: TodoItem[]; steps: AgentStepView[] };

/**
 * Does this turn need tools? Deterministic, so a casual message never pays for an extra model call: research and
 * lookups, comparisons, documents/notes, links, and questions about named things in the outside world go to the
 * agent; everything else stays an ordinary conversation.
 */
export function shouldUseChatAgent(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.startsWith("/")) return false;
  if (/https?:\/\/\S+/i.test(t)) return true;
  // Visual search and GitHub discovery are read-only tools: no slash command required.
  if (/\b(?:github|git repos?|repositories|repository|open.source repos?|repo clone|cloneable projects?)\b/i.test(t)) return true;
  if (/\b(?:find|show|search|look up|compare|research)\b.{0,65}\b(?:images?|photos?|pictures?|screenshots?|photographs?|visual references?)\b/i.test(t)) return true;
  if (/\b(?:images?|photos?|pictures?|screenshots?|visual references?)\b.{0,40}\b(?:of|for|from)\b/i.test(t) && !/\b(?:create|draw|generate|edit|render)\b/i.test(t)) return true;
  if (/\b(?:research|look\s*up|look into|investigate|find out|search (?:for|up)|google|dig into|fact[- ]?check|verify|is it true|latest|newest|current(?:ly)?|today|this (?:week|month|year)|news|price of|how much (?:is|does)|release(?:d)?|compare|versus|\bvs\b|who (?:is|are|was|made|founded|owns)|what(?:'s| is| are) (?:the )?(?:new|latest|best)|what happened|tell me about|source(?:s)?|cite|citations?)\b/i.test(t)) return true;
  if (/\b(?:make|create|write|draft|put together|generate|build)\b[^.?!]{0,40}\b(?:doc(?:ument)?|notes?|note|summary|report|write-?up|brief|one-?pager|study guide|cheat sheet)\b/i.test(t)) return true;
  return false;
}

/** Streams the agent's events. Resolves when the stream ends; rejects only on transport failure. */
export async function streamChatAgent(args: {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}) {
  const response = await fetch("/api/chat/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages: args.messages, model: args.model }),
    signal: args.signal,
  });
  if (!response.ok || !response.body) throw new Error(`Chat API error: ${response.status} ${await response.text().catch(() => "")}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try { args.onEvent(JSON.parse(data) as AgentEvent); } catch { /* ignore a damaged frame */ }
    }
  }
}

/**
 * Does this request need to operate a real website (click, type, log in, buy, book) rather than just read the web?
 * Only then does the chat open the browser on its own; research, lookups and comparisons stay on web search unless
 * the person says to use the browser. Deterministic, so it costs nothing.
 */
export function shouldUseBrowserUse(text: string): boolean {
  const t = text.trim();
  if (t.length < 10 || t.startsWith("/")) return false;
  if (/\b(?:use|open|launch|start|do (?:it|this) (?:in|with))\s+(?:the\s+|a\s+|your\s+|my\s+)?browser\b|\bbrowser use\b|\bin (?:the |a )?browser\b/i.test(t)) return true;
  const hasTarget = /(?:https?:\/\/\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|org|net|io|co|ai|app|dev|gov|edu|au|uk)\b)/i.test(t);
  const interactive = /\badd\b[^.?!]{0,50}\bto (?:the |my |your )?(?:cart|basket|wishlist|bag)\b|\b(?:log ?in|sign ?in|sign ?up|fill (?:out|in)|click|check ?out|book|reserve|subscribe|unsubscribe|submit|upload|download|post (?:on|to)|reply (?:on|to)|buy|purchase|order)\b/i.test(t);
  const navigates = /\b(?:go to|visit|open|navigate to|head to)\s+(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|app|dev|gov|edu|au|uk)\b[^.?!]{0,80}\b(?:and|then)\s+(?:click|search|find|log|sign|fill|add|buy|book|order|download|open|check|tell|read|get|look)/i.test(t);
  return (hasTarget && interactive) || navigates;
}
