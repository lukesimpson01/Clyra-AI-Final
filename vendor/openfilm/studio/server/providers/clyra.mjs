// @ts-check
/**
 * Clyra, the app this editor lives in: its local Whisper speech-to-text (word-timed), its Creator voices and its own
 * model for subtitle translation. Nothing leaves the computer except what Clyra itself sends to the model the person
 * set up there. The editor is started by Clyra with `CLYRA_EDITOR_KEY` (a token minted for this run) and
 * `OPENFILM_CLYRA_URL` (where Clyra's server listens), so this provider is connected without the person pasting a key.
 */
import { call, landing, needed, round, serviceUrl, speechUpload, text, translatedLines, translationAsk, wavSeconds, mp3Seconds } from './common.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

const NAME = 'Clyra';
const MODELS = {
  asr: [{ id: 'base', name: 'Whisper base' }, { id: 'small', name: 'Whisper small (more accurate)' }, { id: 'tiny', name: 'Whisper tiny (fastest)' }],
  tts: [{ id: 'creator', name: 'Clyra Creator voices' }],
  translate: [{ id: 'clyra', name: 'Clyra model' }],
};
/** The voices Clyra's Creator service accepts (lib/shorts/voices.ts), as a fallback when Clyra cannot list them. */
const VOICES = ['Max', 'Ryan', 'Aiden', 'Aaron', 'Abigail', 'Anaya', 'Andy', 'Archer', 'Brian', 'Chloe', 'Dylan', 'Emmanuel', 'Ethan', 'Evelyn', 'Gavin', 'Gordon', 'Ivan', 'Laura', 'Lucy', 'Madison', 'Marisol', 'Meera', 'Walter'];
const MAX_TEXT = 600;

/** @type {Provider} */
export default {
  id: 'clyra',
  name: NAME,
  env: 'CLYRA_EDITOR_KEY',
  keysUrl: 'https://clyra.local/',
  billingUrl: 'https://clyra.local/',
  verbs: ['voice', 'tts', 'asr', 'translate'],
  models: MODELS,
  async run(verb, args, ctx) {
    const base = serviceUrl('CLYRA', 'http://127.0.0.1:3000');
    const send = (/** @type {string} */ path, /** @type {RequestInit} */ init) =>
      call(NAME, `${base}/api/openfilm/bridge${path}`, { method: 'POST', ...init, headers: { authorization: `Bearer ${ctx.key}`, ...init.headers } }, ctx);

    if (verb === 'voice') {
      const limit = Math.max(1, Math.min(100, Math.round(Number(args.limit) || 30)));
      let names = VOICES;
      try {
        const res = await fetch(`${base}/api/openfilm/bridge/voices`, { headers: { authorization: `Bearer ${ctx.key}` }, signal: ctx.signal });
        const body = /** @type {any} */ (await res.json());
        if (res.ok && Array.isArray(body?.voices) && body.voices.length) names = body.voices.map(String);
      } catch { /* the built-in list stands */ }
      const voices = names.slice(0, limit).map((name) => ({ voiceId: name, name, language: 'en', gender: null, description: null }));
      return { files: [], index: [], receipt: { provider: 'clyra', voices } };
    }

    if (verb === 'tts') {
      const voice = needed(args, 'voice');
      const said = needed(args, 'text');
      if (said.length > MAX_TEXT) throw new Error(`Clyra's voices speak ${MAX_TEXT} characters at a time and this line has ${said.length}: split it into shorter lines.`);
      const res = await send('/tts', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: said, voice }) });
      const type = res.headers.get('content-type') ?? '';
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = /mpeg|mp3/.test(type) ? 'mp3' : 'wav';
      const path = landing('audio/vo', args.out, ext);
      const header = Number(res.headers.get('x-clyra-tts-duration'));
      const measured = ext === 'wav' ? wavSeconds(bytes) : mp3Seconds(bytes);
      const dur = Number.isFinite(header) && header > 0 ? round(header / 1000) : measured;
      return {
        files: [{ path, bytes }],
        index: [{ src: path, kind: 'audio', ...(dur !== null ? { dur } : {}), text: said, voice, from: { mode: 'synth', text: said, voice, provider: 'clyra', model: 'creator' } }],
        receipt: { provider: 'clyra', model: 'creator', src: path, dur, voice, notes: ['Clyra gives no word timings: subtitles spread the text over the line'] },
        cost: { note: 'made on this computer by Clyra' },
      };
    }

    if (verb === 'asr') {
      const src = needed(args, 'src');
      const upload = await speechUpload(src, ctx);
      const model = ctx.model && MODELS.asr.some((m) => m.id === ctx.model) ? ctx.model : 'base';
      ctx.say('Clyra is transcribing with Whisper');
      const res = await send(`/asr?model=${encodeURIComponent(model)}`, { headers: { 'content-type': 'application/octet-stream' }, body: upload.blob });
      const body = /** @type {any} */ (await res.json());
      const words = (Array.isArray(body?.words) ? body.words : [])
        .filter((/** @type {any} */ w) => Number.isFinite(w?.start) && text(w.text))
        .map((/** @type {any} */ w) => ({ token: text(w.text), start: w.start, end: Number.isFinite(w.end) ? w.end : w.start }));
      const said = text(body?.text) || words.map((/** @type {any} */ w) => w.token).join(' ');
      return {
        files: [],
        index: [{ src, ...(Number.isFinite(body?.duration) ? { dur: round(body.duration) } : {}), text: said, words, transcribed: true }],
        receipt: { provider: 'clyra', model, src, text: said, words: words.length, ...(body?.language ? { language: body.language } : {}) },
        cost: { note: 'transcribed on this computer by Clyra' },
      };
    }

    if (verb === 'translate') {
      const ask = translationAsk(args.lines, args.language);
      const res = await send('/translate', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system: ask.system, user: ask.user }) });
      const body = /** @type {any} */ (await res.json());
      return { files: [], index: [], receipt: { provider: 'clyra', model: 'clyra', language: text(args.language), lines: translatedLines(String(body?.text ?? ''), ask.count) }, cost: { note: 'translated by Clyra\'s model' } };
    }

    throw new Error(`${NAME} does not do ${verb}.`);
  },
};
