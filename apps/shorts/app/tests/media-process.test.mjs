import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processMedia } from '../server/localApi.js';

const exec = promisify(execFile);
let root, source;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'clyra-media-smoke-'));
  source = join(root, 'source.mp4');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=2',
    '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', source]);
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const names = ['Audio Balancer', 'Video Compressor', 'MP3 Converter', 'Video Trimmer',
  'Aspect Ratio Converter', 'Video to GIF', 'Video Speed Changer', 'Volume Booster',
  'Video Merger', 'MP4 Converter', 'Video Reverser', 'Mute Video'];
for (const [index, name] of names.entries()) {
  test(name + ' renders nonempty, probeable media via the actual FFmpeg processor', async () => {
    const directory = await mkdtemp(join(root, 'job-'));
    const inputs = [{ path: source, filename: 'source.mp4', mimeType: 'video/mp4' }];
    if (name === 'Video Merger') inputs.push({ ...inputs[0] });
    const output = await processMedia({
      tool: name, start: '0', end: '1.5', format: '9:16', fit: 'fit',
      level: '125', quality: 'balanced', fps: '30', length: '1', width: '360'
    }, inputs, directory);
    assert.ok((await stat(output.path)).size > 100, name + ' should render bytes');
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output.path]);
    assert.ok(Number(stdout.trim()) > 0, name + ' output should decode');
    if (name === 'Video Merger') assert.ok(Number(stdout.trim()) >= 3.5, 'both source clips must be present');
    if (name === 'Mute Video') {
      const streams = await exec('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', output.path]);
      assert.equal(streams.stdout.trim(), '', 'mute must remove the audio stream');
    }
    await rm(directory, { recursive: true, force: true });
  });
}
