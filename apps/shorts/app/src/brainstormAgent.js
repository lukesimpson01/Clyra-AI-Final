import { gameplay } from './FakeTextWorkspace.jsx';

/* The brainstormer's side of the conversation: what the model is told, what it may answer, and checking that answer before
   anything is shown or made from it. The model is Clyra's own chat model, reached through the same relay the editor's AI
   uses (/api/editor-ai/chat). It answers in one JSON object so a plan can become a real job; it never invents a link. */
export const THEMES = ['ios-dark', 'ios-light', 'whatsapp-dark', 'whatsapp-light'];
export const MOMENTS = ['viral', 'funny', 'shocking', 'reaction', 'dramatic', 'angry', 'sad', 'inspirational', 'action'];
const BACKGROUNDS = ['Subway', 'Minecraft', 'GTA', 'Trackmania'];
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

const SYSTEM = `You are the Brainstormer inside Shorts, a video studio for TikTok, Reels and YouTube Shorts creators. You chat naturally, help find strong short-video ideas, and when asked you plan videos the app can make.

Reply with ONE JSON object and nothing else:
{
 "reply": string,   // what you say: 1-4 short sentences, friendly and specific, no markdown, no emoji
 "ideas": [         // 0-3 ideas, only when they help
  {
   "id": string,    // short kebab-case id, unique in this chat
   "kind": "fake-text" | "clip" | "idea",
   "title": string, // under 60 characters
   "pitch": string, // one sentence: the hook and why it works
   "fakeText": { "contact": string, "theme": "ios-dark"|"ios-light"|"whatsapp-dark"|"whatsapp-light", "background": "Subway"|"Minecraft"|"GTA"|"Trackmania", "dim": number, "messages": [ { "side": "left"|"right", "text": string } ] },
   "clip": { "url": string, "moment": string, "count": number, "length": "short"|"medium"|"long" }
  }
 ],
 "run": [string]    // ids of earlier ideas to make now. ONLY when the user clearly says to go ahead (do it, make it, run the plan, yes go). Otherwise [].
}

Rules:
- "fake-text" ideas include "fakeText" with 10 to 16 messages written like real texting: short, lowercase, no stiff dialogue. Open with a hook in the first two messages, build, and end on a twist or a cliffhanger. "right" is the viewer's side, "left" is the contact. Pick a theme and a gameplay background that suit the mood ("dim" 0 to 40).
- "clip" ideas include "clip" and are ONLY for a link the user gave in this chat: copy it exactly, never invent or guess a link. "moment" is one of ${MOMENTS.join(', ')} or a short plain description of the moment to find. If the user wants clips but gave no link, use kind "idea" and ask for the link in your reply.
- "idea" is plain brainstorming with no "fakeText" or "clip".
- When asked to run something, only put ids you already proposed in "run", and say plainly in "reply" what you are starting.
- Be honest about what the app can make: fake text story videos and AI clips from a link. Do not promise anything else.`;

const slug = (text, n) => String(text || `idea-${n}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `idea-${n}`;
export const linksIn = (text) => (String(text || '').match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, ''));

function parse(content) {
  const body = String(content || '').replace(/```(?:json)?/gi, '');
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/** The model's ideas, made safe to show and to run. `known`: the links the user actually gave. */
function clean(ideas, known, taken) {
  const out = [];
  for (const [n, raw] of (Array.isArray(ideas) ? ideas : []).slice(0, 3).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    let id = slug(raw.id || raw.title, n); while (taken.has(id) || out.some((i) => i.id === id)) id += `-${Math.random().toString(36).slice(2, 4)}`;
    const idea = { id, kind: 'idea', title: String(raw.title || 'Idea').slice(0, 80), pitch: String(raw.pitch || '').slice(0, 280) };
    const ft = raw.fakeText, messages = Array.isArray(ft?.messages) ? ft.messages.filter((m) => m && String(m.text || '').trim()).slice(0, 40).map((m) => ({ side: m.side === 'right' ? 'right' : 'left', text: String(m.text).slice(0, 240) })) : [];
    if (raw.kind === 'fake-text' && messages.length >= 4) {
      const bg = Math.max(0, BACKGROUNDS.indexOf(ft.background)), dim = Math.max(0, Math.min(60, Number(ft.dim) || 0));
      Object.assign(idea, { kind: 'fake-text', fakeText: { contact: String(ft.contact || 'Unknown').slice(0, 30), theme: THEMES.includes(ft.theme) ? ft.theme : 'ios-dark', videoIndex: Math.min(bg, gameplay.length - 1), background: { dim }, messages } });
    } else if (raw.kind === 'clip' && raw.clip && known.includes(String(raw.clip.url || '').replace(/[.,;:!?]+$/, ''))) {
      const url = String(raw.clip.url).replace(/[.,;:!?]+$/, '');
      Object.assign(idea, { kind: 'clip', clip: { url, moment: String(raw.clip.moment || 'viral').slice(0, 200), count: Math.max(1, Math.min(5, Number(raw.clip.count) || 3)), length: ['short', 'medium', 'long'].includes(raw.clip.length) ? raw.clip.length : 'medium' } });
    }
    out.push(idea);
  }
  return out;
}

/** One turn. `history`: [{ role: 'user' | 'assistant', text, raw?, ideas? }]. Resolves { reply, ideas, run, raw }. */
export async function ask(history, signal) {
  const known = [...new Set(history.filter((m) => m.role === 'user').flatMap((m) => linksIn(m.text)))];
  const taken = new Set(history.flatMap((m) => (m.ideas || []).map((i) => i.id)));
  const messages = [{ role: 'system', content: SYSTEM + (known.length ? `\n\nLinks the user has given so far: ${known.join(' ')}` : '\n\nThe user has not given any links yet.') },
    ...history.slice(-14).map((m) => ({ role: m.role, content: m.role === 'assistant' ? (m.raw || JSON.stringify({ reply: m.text, ideas: [], run: [] })) : m.text }))];
  const response = await fetch('/api/editor-ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model: 'deepseek-v4-pro', stream: false, max_tokens: 3600, temperature: 0.85, thinking: { type: 'disabled' }, messages }) });
  if (!response.ok) throw new Error(response.status === 503 ? 'No chat model is connected to Clyra right now. Check its model settings and try again.' : `The brainstormer could not answer (${response.status}).`);
  const content = (await response.json())?.choices?.[0]?.message?.content || '';
  const data = parse(content);
  if (!data) return { reply: content.trim() || 'Sorry, I could not put that together. Try asking again.', ideas: [], run: [], raw: '' };
  const ideas = clean(data.ideas, known, taken);
  const have = new Set([...taken, ...ideas.map((i) => i.id)]);
  const run = (Array.isArray(data.run) ? data.run : []).map(String).filter((id) => have.has(id));
  return { reply: String(data.reply || '').trim() || (ideas.length ? 'Here is what I would make.' : 'Okay.'), ideas, run, raw: JSON.stringify({ reply: data.reply, ideas: ideas.map((i) => ({ id: i.id, kind: i.kind, title: i.title, pitch: i.pitch, ...(i.fakeText ? { fakeText: { contact: i.fakeText.contact, theme: i.fakeText.theme, messages: i.fakeText.messages } } : {}), ...(i.clip ? { clip: i.clip } : {}) })), run }) };
}
