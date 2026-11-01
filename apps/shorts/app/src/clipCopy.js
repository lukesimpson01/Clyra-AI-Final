/* The words that go with a finished clip: a title, a caption and hashtags for TikTok, Reels and Shorts, written from what
   the clip says and which video it came from (the channel becomes a tag: #mrbeast). Clyra's own chat model writes them
   through the same relay the editor's AI uses; when it cannot, the same shape is built from the transcript. */

const STOP = new Set(('a an and are as at be but by for from had has have he her his i if in into is it its just like me my no not of on or our she so that the their them then there they this to was we were what when which who will with you your about all can do did how not out up very been than too one two get got going gonna said say says really because would could').split(' '));
const tag = (text) => String(text || '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
const clean = (text, max) => { const t = String(text || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t; };

/** The spoken words of a clip, as one string. */
export const transcriptOf = (clip) => (Array.isArray(clip.words) && clip.words.length ? clip.words.map((w) => w.word ?? w.text ?? '').join(' ') : String(clip.transcript || clip.caption || '')).replace(/\s+/g, ' ').trim();

/** Words that say what the clip is about: the most repeated that are not filler, longest first among equals. */
function keywords(text, limit = 4) {
  const count = new Map();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []) {
    const word = raw.replace(/'s$/, '');
    if (word.length < 4 || STOP.has(word) || /^\d+$/.test(word)) continue;
    count.set(word, (count.get(word) || 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, limit).map(([w]) => w);
}

/** Hashtags that always fit: the channel, the topic, then the platforms' own. */
function tagsFor({ channel, sourceTitle, text, moment }) {
  const out = [];
  const add = (t) => { const v = tag(t); if (v && v.length > 2 && v.length <= 28 && !out.includes(v)) out.push(v); };
  add(channel);
  for (const w of keywords(`${sourceTitle || ''} ${sourceTitle || ''} ${text}`, 5)) add(w);
  if (moment) add({ funny: 'funny', shocking: 'shocking', reaction: 'reaction', dramatic: 'storytime', angry: 'drama', sad: 'emotional', inspirational: 'motivation', action: 'challenge' }[moment] || '');
  for (const t of ['shorts', 'fyp', 'viral']) add(t);
  return out.slice(0, 9);
}

/** The copy built without the model: the clip's own words, the video's own name. */
export function localCopy({ clip, sourceTitle, channel, moment }) {
  const text = transcriptOf(clip), first = text.split(/(?<=[.!?])\s+/)[0] || text;
  const title = clean(first.length >= 18 ? first.replace(/[.!?]+$/, '') : sourceTitle || 'Watch this', 64);
  const caption = clean(`${first}${channel ? ` — from ${channel}'s “${sourceTitle || 'latest video'}”` : ''}`, 190);
  return { title, caption, hashtags: tagsFor({ channel, sourceTitle, text, moment }), source: 'local' };
}

function parse(content) {
  const body = String(content || '').replace(/```(?:json)?/gi, '');
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/** Title, caption and hashtags for one clip. Never throws: any failure is the local copy. */
export async function writeCopy({ clip, sourceTitle, channel, moment, signal }) {
  const fallback = localCopy({ clip, sourceTitle, channel, moment });
  const text = transcriptOf(clip).slice(0, 1200);
  if (text.split(' ').length < 6) return fallback;
  const system = 'You write the post for a short vertical video on TikTok, Instagram Reels and YouTube Shorts. Reply with JSON only: {"title": string, "caption": string, "hashtags": string[]}. '
    + 'title: at most 60 characters, a specific hook taken from what is actually said in this clip, no clickbait the clip does not deliver. '
    + 'caption: one or two short sentences in a natural creator voice, at most 180 characters, it may end with a question; name the person or channel when it is known; no hashtags inside. '
    + 'hashtags: 8 to 10 without the # sign, no spaces. Lead with the channel or person if known (for example mrbeast), then the specific topic of this clip, then two or three broad ones; no generic spam such as followforfollow.';
  const user = `Video: ${sourceTitle || 'unknown'}\nChannel: ${channel || 'unknown'}\nWhat the clip was picked for: ${moment || 'the best moment'}\nLength: ${clip.clip_duration || ''}\nWhat is said in the clip:\n${text}`;
  try {
    const response = await fetch('/api/editor-ai/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: 'deepseek-v4-pro', stream: false, max_tokens: 400, temperature: 0.7, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!response.ok) return fallback;
    const data = parse((await response.json())?.choices?.[0]?.message?.content);
    if (!data?.title) return fallback;
    const hashtags = (Array.isArray(data.hashtags) ? data.hashtags : String(data.hashtags || '').split(/[\s,]+/)).map(tag).filter((t) => t && t.length <= 28);
    /* the channel or person always leads: it is what the clip is found by */
    const lead = tag(channel);
    const merged = [...new Set([...(lead ? [lead] : []), ...hashtags, ...fallback.hashtags.slice(0, 3)])].slice(0, 10);
    return { title: clean(data.title, 70), caption: clean(data.caption || fallback.caption, 220), hashtags: merged.length >= 4 ? merged : fallback.hashtags, source: 'ai' };
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    return fallback;
  }
}

/** "#mrbeast #buriedalive" */
export const hashtagLine = (copy) => (copy?.hashtags || []).map((t) => `#${t}`).join(' ');
