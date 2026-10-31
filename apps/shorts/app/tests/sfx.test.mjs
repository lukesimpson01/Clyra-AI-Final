import test from 'node:test';
import assert from 'node:assert/strict';
import { SFX_CATALOG, SFX_COUNT, SFX_CATEGORIES, renderSfx, searchSfx, sfxSuggestions, waveformPeaks, toWav, sfxById, registerImported, unregisterImported, isPlayable, soundDuration } from '../src/sfxLibrary.js';
import { MUSIC_CATALOG, searchMusic } from '../src/musicLibrary.js';
import { matchSlot } from '../src/soundStore.js';

const playable = SFX_CATALOG, slots = SFX_CATALOG.filter((s) => s.group === 'brainrot');

test('the requested lists are present: 30 normal effects and 14 brainrot sounds, in two groups', () => {
  assert.equal(SFX_COUNT, 44); assert.equal(SFX_CATALOG.filter((s) => s.group === 'normal').length, 30); assert.equal(slots.length, 14);
  for (const name of ['Camera Shutter', 'Razor Slash', 'Vine Boom', 'Zoom In / Out', 'Metal Clang', 'Cinematic Boom', 'Sparkle', 'Typewriter']) assert.ok(SFX_CATALOG.some((s) => s.name === name), name);
  for (const name of ['Rizz Sound Effect', 'Fah', 'Fah 2', 'Emotional Damage Meme', 'Discord Leave Noise']) assert.ok(slots.some((s) => s.name === name), name);
  assert.equal(new Set(SFX_CATALOG.map((s) => s.id)).size, SFX_CATALOG.length);
  for (const s of SFX_CATALOG) { assert.ok(s.license && s.source && s.verified, s.id); assert.ok(SFX_CATEGORIES.includes(s.category), s.id); }
});
test('brainrot sounds are playable ORIGINAL sound-alikes (no third-party audio shipped) and keep their source link', () => {
  for (const s of slots) { assert.ok(isPlayable(s), s.id); assert.equal(s.original, true); assert.ok(renderSfx(s).length > 1000, s.id); assert.ok(s.sourceUrl.startsWith('https://www.myinstants.com/')); assert.ok(/original/i.test(s.source)); }
});
test('every effect (normal and brainrot) is finite, audible and not clipping', () => {
  for (const s of playable) {
    const a = renderSfx(s); let peak = 0, energy = 0;
    for (const v of a) { assert.ok(Number.isFinite(v), s.id); peak = Math.max(peak, Math.abs(v)); energy += v * v; }
    assert.ok(peak > 0.5 && peak <= 1, `${s.id} peak ${peak}`); assert.ok(energy / a.length > 1e-4, `${s.id} too quiet`);
  }
});
test('importing your own file replaces the original take, and removing it restores the take', () => {
  const before = renderSfx(sfxById('fah')).length;
  registerImported('fah', { samples: new Float32Array(4410).fill(0.2), sr: 44100, dur: 0.1, name: 'Fah' });
  const e = sfxById('fah'); assert.equal(e.replaced, true); assert.ok(Math.abs(soundDuration(e) - 0.1) < 1e-6); assert.equal(renderSfx(e).length, 4410);
  unregisterImported('fah'); assert.equal(sfxById('fah').replaced, undefined); assert.equal(renderSfx(sfxById('fah')).length, before);
});
test('custom imports are searchable under My sounds but music stays out of Sound FX', async () => {
  const { registerCustom, allSfx } = await import('../src/sfxLibrary.js');
  registerCustom({ id: 'imp-test', name: 'My Test Sound', category: 'My sounds', tags: [], aliases: [], samples: new Float32Array(100), sr: 8000, dur: 0.0125, imported: true });
  assert.ok(searchSfx('', { category: 'My sounds' }).some((s) => s.id === 'imp-test'));
  assert.ok(allSfx().every((s) => !s.music), 'music tracks are not listed as sound effects');
  unregisterImported('imp-test');
});
test('filenames match the right slot', () => {
  assert.equal(matchSlot('fah-2.mp3')?.id, 'fah-2'); assert.equal(matchSlot('Fah.wav')?.id, 'fah');
  assert.equal(matchSlot('emotional-damage-meme.mp3')?.id, 'emotional-damage-meme'); assert.equal(matchSlot('discord leave noise.mp3')?.id, 'discord-leave-noise');
  assert.equal(matchSlot('random-song.mp3'), null);
});
test('search finds razor, boom, and ignores unplayable slots in aliases', () => {
  assert.equal(searchSfx('razor')[0].id, 'razor-slash');
  const boom = searchSfx('boom').map((s) => s.id); assert.ok(boom.includes('vine-boom') && boom.includes('cinematic-boom'));
  assert.ok(searchSfx('fah').some((s) => s.id === 'fah'));
  assert.deepEqual(searchSfx('zzzzqq'), []);
  assert.ok(sfxSuggestions('wh').length > 0 && searchSfx('', { category: 'Brainrot' }).length === 14);
});
test('peaks and wav encoding', () => {
  const a = renderSfx(playable[2]); assert.equal(waveformPeaks(a, 20).length, 20); assert.equal(String.fromCharCode(...toWav(a).slice(0, 4)), 'RIFF');
});
test('music: 6 bundled Kevin MacLeod tracks (credit) + 12 playable FRAME takes + 14 originals = 32, all addable', async () => {
  const { BROWSE_CATALOG, ALL_MUSIC, MACLEOD_CREDIT } = await import('../src/musicLibrary.js');
  const bundled = BROWSE_CATALOG.filter((m) => m.bundled), takes = BROWSE_CATALOG.filter((m) => m.take);
  assert.equal(bundled.length, 6); assert.equal(takes.length, 12); assert.equal(MUSIC_CATALOG.length, 14); assert.equal(ALL_MUSIC.length, 32);
  for (const m of bundled) { assert.ok(m.url.startsWith('/media/music/') && m.dur > 30 && /CC BY 4.0/.test(m.license)); assert.ok(m.attribution.includes('creativecommons.org/licenses/by/4.0') && /Kevin MacLeod/.test(m.attribution)); }
  for (const s of takes) { assert.ok(/^https:\/\//.test(s.sourceUrl)); assert.ok(!sfxById(s.id).needsFile, s.id); assert.ok(isPlayable(sfxById(s.id)) && s.dur > 20, s.id); assert.ok(/not the original recording/.test(s.source)); }
  assert.ok(ALL_MUSIC.every((m) => !m.needsFile), 'every track is playable and addable');
  assert.ok(MACLEOD_CREDIT('X').startsWith('X Kevin MacLeod'));
});
test('music: FRAME originals render, and search covers sections, titles and artists', () => {
  for (const t2 of MUSIC_CATALOG.slice(0, 3)) { const a = t2.render(16000); let pk = 0; for (const v of a) { assert.ok(Number.isFinite(v)); pk = Math.max(pk, Math.abs(v)); } assert.ok(pk > 0.5 && pk <= 1, t2.id); }
  assert.ok(searchMusic('sneaky').some((m) => m.title === 'Sneaky Snitch')); assert.ok(searchMusic('', 'cinematic').length === 5 && searchMusic('', 'cinematic').every((m) => m.section === 'cinematic'));
  assert.ok(searchMusic('kanye').length === 1 && searchMusic('lofi').length >= 2);
});
test('an unloaded URL sound renders nothing instead of throwing', async () => {
  const { renderSfx: r, sfxById: byId } = await import('../src/sfxLibrary.js');
  await import('../src/musicLibrary.js');
  const e = byId('mx-sneaky-snitch'); assert.ok(e.url && !e.samples);
  assert.equal(r(e), null);
});
