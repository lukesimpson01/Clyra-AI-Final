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
test('every named meme slot retains exact-source identity and does not fabricate copyrighted audio', () => {
  for (const s of slots) {
    assert.equal(s.originalRecording, true, s.id);
    assert.equal(s.original, true, s.id);
    assert.equal(renderSfx(s), null, `${s.id}: original recording must not be substituted by procedural audio`);
    assert.ok(['verified', 'unresolved'].includes(s.recordingStatus), s.id);
    if (s.recordingStatus === 'verified') assert.ok(/^https:\/\//.test(s.sourceUrl), s.id);
  }
});
test('all 44 named sound slots accept uploaded samples without clipping, without changing original recordings', () => {
  for (const s of playable) {
    assert.equal(renderSfx(s), null, `Do not silently replace ${s.id} with an invented recording`);
    const samples = Float32Array.from({length:4410},(_,i)=>Math.sin(2*Math.PI*440*i/44100)*0.75);
    registerImported(s.id,{samples,sr:44100,dur:0.1,name:s.name});
    try {
      const a=renderSfx(sfxById(s.id)); let peak=0,energy=0;
      for (const v of a){assert.ok(Number.isFinite(v),s.id);peak=Math.max(peak,Math.abs(v));energy+=v*v;}
      assert.ok(peak > 0.5 && peak <= 1,`${s.id} peak ${peak}`);
      assert.ok(energy/a.length>1e-4,`${s.id} too quiet`);
    } finally {unregisterImported(s.id);}
  }
});
test('replacing and removing a source recording does not leave a fabricated copy behind', () => {
  assert.equal(renderSfx(sfxById('fah')),null);
  registerImported('fah',{samples:new Float32Array(4410).fill(0.2),sr:44100,dur:0.1,name:'Fah'});
  const e=sfxById('fah');assert.equal(e.replaced,true);assert.ok(Math.abs(soundDuration(e)-0.1)<1e-6);
  assert.equal(renderSfx(e).length,4410);
  unregisterImported('fah');assert.equal(sfxById('fah').replaced,undefined);
  assert.equal(renderSfx(sfxById('fah')),null);
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
test('waveform peaks and WAV export reflect decoded user-owned audio', () => {
  const a=Float32Array.from({length:6000},(_,i)=>0.7*Math.sin(2*Math.PI*250*i/44100));
  assert.equal(waveformPeaks(a,20).length,20);
  assert.equal(String.fromCharCode(...toWav(a).slice(0,4)),'RIFF');
});
test('music catalog keeps attributed CC BY tracks, protected original-recording slots and playable original compositions', async () => {
  const { BROWSE_CATALOG, ALL_MUSIC, MACLEOD_CREDIT }=await import('../src/musicLibrary.js');
  const bundled=BROWSE_CATALOG.filter(m=>m.bundled),takes=BROWSE_CATALOG.filter(m=>m.take);
  assert.equal(bundled.length,6);assert.equal(takes.length,12);
  assert.equal(MUSIC_CATALOG.length,14);assert.equal(ALL_MUSIC.length,18);
  for(const m of bundled){assert.ok(m.url.startsWith('/assets/media/music/') && m.dur>30 && /CC BY 4.0/.test(m.license));assert.ok(m.attribution.includes('creativecommons.org/licenses/by/4.0') && m.attribution.includes('Kevin MacLeod'));}
  for(const s of takes){assert.ok(/^https:\/\//.test(s.sourceUrl));assert.equal(renderSfx(sfxById(s.id)),null,`${s.id} must load original licensed recording`);}
  for(const m of MUSIC_CATALOG)assert.equal(typeof m.render,'function',m.id);
  assert.ok(MACLEOD_CREDIT('X').startsWith('X Kevin MacLeod'));
});
test('procedural original music renders and music search respects the separate licensed catalog', () => {
  for(const t2 of MUSIC_CATALOG.slice(0,3)){const a=t2.render(16000);let pk=0;for(const v of a){assert.ok(Number.isFinite(v));pk=Math.max(pk,Math.abs(v));}assert.ok(pk>0.5&&pk<=1,t2.id);}
  assert.ok(searchMusic('sneaky').some(m=>m.title==='Sneaky Snitch'));
  assert.equal(searchMusic('', 'cinematic').length,5);
  assert.ok(searchMusic('', 'cinematic').every(m=>m.section==='cinematic'));
  assert.equal(searchMusic('kanye').length,1);
  assert.ok(MUSIC_CATALOG.filter(m=>m.mood==='Lo-fi').length>=2);
});
test('an unloaded URL sound renders nothing instead of throwing', async () => {
  const { renderSfx: r, sfxById: byId } = await import('../src/sfxLibrary.js');
  await import('../src/musicLibrary.js');
  const e = byId('mx-sneaky-snitch'); assert.ok(e.url && !e.samples);
  assert.equal(r(e), null);
});
