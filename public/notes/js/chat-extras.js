/* What makes a chat yours: standing instructions ("Personalize") and agents, which are a name, an emoji and their own
   instructions that a chat can be started with. Both live on this device and are sent with every question as extra
   instructions to the model, so there is nothing to sync and nothing the model can do with them beyond answering in the
   way they ask. */
import { el, modal, toast } from "./dom.js";

const PERSONALIZE_KEY = "clyra-notes:chat-personalize";
const AGENTS_KEY = "clyra-notes:agents";
const read = (key, fallback) => { try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; } };
const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast("Could not save that on this device"); return false; } };

export const getPersonalize = () => String(read(PERSONALIZE_KEY, "") || "");
export const setPersonalize = (text) => write(PERSONALIZE_KEY, String(text || "").slice(0, 2000));

export const listAgents = () => (Array.isArray(read(AGENTS_KEY, [])) ? read(AGENTS_KEY, []) : []).filter((agent) => agent && agent.id && agent.name);
export const getAgent = (id) => listAgents().find((agent) => agent.id === id) || null;
export function saveAgent(agent) {
  const list = listAgents();
  const next = { id: agent.id || `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(agent.name || "").trim().slice(0, 60), emoji: String(agent.emoji || "").trim().slice(0, 12), instructions: String(agent.instructions || "").slice(0, 3000) };
  const at = list.findIndex((entry) => entry.id === next.id);
  if (at >= 0) list[at] = next; else list.push(next);
  write(AGENTS_KEY, list);
  return next;
}
export function deleteAgent(id) { write(AGENTS_KEY, listAgents().filter((agent) => agent.id !== id)); }

/* The text sent to the model: what the person always wants, then what this agent adds. */
export function instructionsFor(agentId) {
  const parts = [];
  const mine = getPersonalize().trim();
  if (mine) parts.push(`About the person and how they want answers:\n${mine}`);
  const agent = agentId ? getAgent(agentId) : null;
  if (agent?.instructions.trim()) parts.push(`You are acting as "${agent.name}". ${agent.instructions.trim()}`);
  return parts.join("\n\n");
}

const PINS_KEY = "clyra-notes:chat-pins";
export const getPins = () => (Array.isArray(read(PINS_KEY, [])) ? read(PINS_KEY, []) : []);
export const isPinned = (id) => getPins().includes(id);
export function togglePin(id) { const pins = getPins(); write(PINS_KEY, pins.includes(id) ? pins.filter((entry) => entry !== id) : [id, ...pins].slice(0, 30)); }

export function openPersonalize(onSaved) {
  const field = el("textarea", { class: "extras-field", rows: "7", placeholder: "For example: I'm studying nursing. Keep answers short, use plain words and give an example.", "aria-label": "How should Clyra answer?" });
  field.value = getPersonalize();
  const save = el("button", { class: "button primary", type: "button" }, "Save");
  const cancel = el("button", { class: "button", type: "button" }, "Cancel");
  const entry = modal({
    title: "Personalize", width: 480,
    body: el("div", { class: "extras-body" },
      el("p", { class: "extras-lead", text: "Tell Clyra how you like answers. This is used in every chat on this device." }), field),
    footer: [cancel, save],
  });
  cancel.addEventListener("click", () => entry.close("cancel"));
  save.addEventListener("click", () => { if (setPersonalize(field.value)) { entry.close("save"); toast("Saved"); onSaved?.(); } });
}

export function openAgentEditor(agent, onSaved) {
  const name = el("input", { class: "extras-input", placeholder: "Name, for example Study coach", "aria-label": "Agent name", maxlength: "60" });
  const emoji = el("input", { class: "extras-input extras-emoji", placeholder: "✨", "aria-label": "Emoji", maxlength: "12" });
  const instructions = el("textarea", { class: "extras-field", rows: "7", placeholder: "What should this agent do? For example: Quiz me on whatever page is open, one question at a time, and tell me why an answer is wrong.", "aria-label": "Instructions" });
  name.value = agent?.name || ""; emoji.value = agent?.emoji || ""; instructions.value = agent?.instructions || "";
  const save = el("button", { class: "button primary", type: "button" }, agent ? "Save" : "Create agent");
  const cancel = el("button", { class: "button", type: "button" }, "Cancel");
  const entry = modal({
    title: agent ? "Edit agent" : "New agent", width: 520,
    body: el("div", { class: "extras-body" }, el("div", { class: "extras-row" }, emoji, name), instructions),
    footer: [cancel, save],
  });
  cancel.addEventListener("click", () => entry.close("cancel"));
  save.addEventListener("click", () => {
    if (!name.value.trim()) { name.focus(); return; }
    const saved = saveAgent({ id: agent?.id, name: name.value, emoji: emoji.value, instructions: instructions.value });
    entry.close("save");
    onSaved?.(saved);
  });
}
