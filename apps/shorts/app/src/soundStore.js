import { registerImported, registerCustom, unregisterImported, SFX_CATALOG, SFX_LICENSE, sfxById, catalogEntry,applyRecordingMetadata } from "./sfxLibrary.js";
import { getAudioContext } from "./sfxPlayback.js";

/* Imported sounds live in IndexedDB on this machine only. A file imported into a library slot (e.g. "Fah") fills that slot;
   anything that doesn't match a slot becomes a "My sounds" entry. Nothing is uploaded anywhere. */
const DB = "frame-sounds", STORE = "files";
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };
const norm = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[^a-z0-9]+/g, " ").trim();

export async function decodeToMono(blob) {
  const ctx = getAudioContext(), buf = await ctx.decodeAudioData(await blob.arrayBuffer()), mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return { samples: mono, sr: buf.sampleRate, dur: buf.duration };
}
function activate(id, name, decoded) {
  registerImported(id, { ...decoded, name });
  if (!catalogEntry(id)) registerCustom({ id, name, category: "My sounds", tags: ["mine", "imported"], aliases: [], seed: 1, imported: true, samples: decoded.samples, sr: decoded.sr, dur: decoded.dur, ...SFX_LICENSE, license: "Your file", creator: "You", source: "Imported on this device" });
}
export async function loadImportedSounds() {
  let files = [];
  try { const db = await open(); files = await new Promise((res, rej) => { const out = [], r = db.transaction(STORE).objectStore(STORE).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); }; r.onerror = () => rej(r.error); }); } catch { return 0; }
  let n = 0;
  for (const [id, v] of files) { try { activate(id, v.name, await decodeToMono(v.blob)); n++; } catch { /* undecodable file is skipped */ } }
  return n;
}
/** Best library slot for a filename, or null. Matches on shared words, preferring slots whose every word appears. */
export function matchSlot(fileName, slots = SFX_CATALOG.filter((s) => s.group === "brainrot")) {
  const file = ` ${norm(fileName)} `;
  let best = null, bestScore = 0;
  for (const s of slots) {
    const words = norm(s.name).split(" ").filter(Boolean), hit = words.filter((w) => file.includes(` ${w} `) || (w.length > 3 && file.includes(w))).length;
    if (!hit) continue;
    const score = (hit / words.length) * 10 + hit;
    if (hit >= Math.ceil(words.length / 2) && score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}
export async function importSoundFile(file, slotId = null) {
  const decoded = await decodeToMono(file), slot = slotId ? catalogEntry(slotId) : matchSlot(file.name);
  const id = slot ? slot.id : "imp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name = slot ? slot.name : file.name.replace(/\.[^.]+$/, "");
  await tx("readwrite", (s) => s.put({ name, blob: file }, id));
  activate(id, name, decoded);
  return { id, name, slot: !!slot };
}
export async function removeImported(id) { await tx("readwrite", (s) => s.delete(id)); unregisterImported(id); }

/** Bundled / URL sounds (e.g. the Kevin MacLeod tracks) decode on first use. Resolves when samples are ready (or fails quietly). */
const loading = new Map();
export async function loadRecordingMetadata(){const r=await fetch('/api/editor-audio/library');if(!r.ok)return 0;const {recordings}=await r.json();applyRecordingMetadata(recordings);return Object.keys(recordings??{}).length;}
export function ensureLoaded(id) {
  const e = sfxById(id);
  if (!e || e.samples) return Promise.resolve(!!e?.samples);
  if(!e.url&&!e.originalRecording&&!e.take&&e.group!=='brainrot')return Promise.resolve(false);
  if (!loading.has(id)) loading.set(id,(async()=>{
    let url=e.url;
    if(e.originalRecording||e.take||e.group==='brainrot'){
      const response=await fetch('/api/editor-audio/library',{cache:'no-store'});if(!response.ok)throw new Error('The recording library is unavailable.');const {recordings}=await response.json();if(!recordings?.[id])throw new Error(`${e.name}: source recording is missing.`);url=`/api/editor-audio/${encodeURIComponent(id)}`;
    }
    const response=await fetch(url);if(!response.ok)throw new Error('Audio download failed.');const decoded=await decodeToMono(await response.blob());registerImported(id,{...decoded,name:e.name,fromUrl:true,recording:true});return true;
  })().catch(()=>{loading.delete(id);return false;}));
  return loading.get(id);
}
export const isLoading = (id) => loading.has(id) && !sfxById(id)?.samples;
