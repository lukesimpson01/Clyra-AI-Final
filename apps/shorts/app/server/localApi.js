import { request as httpRequest } from 'node:http';
import Busboy from 'busboy';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { startAdvancedStudio, listAdvancedProjects, advancedPoster, advancedPreview, warmAdvancedStudio } from './advancedStudio.js';
import { recordingIssue } from '../../openfilm/packages/openfilm/src/recording-identity.mjs';

/* the advanced editor starts with this server, so opening it from the app is immediate */
if (!process.env.VITEST && process.env.NODE_ENV !== 'test') warmAdvancedStudio();

const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };

async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    /* a choice video's option pictures come along (small JPEG data URLs) */
    if (data.length > 24_000_000) throw new Error('Request is too large.');
  }
  return JSON.parse(data || '{}');
}

function makeStory({ topic, tone, count }) {
  const subject = String(topic || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 120);
  if (!subject) throw new Error('Add a topic for the story.');
  const style = ['Funny', 'Suspense', 'Sweet', 'Casual'].includes(tone) ? tone : 'Funny';
  const number = Math.max(4, Math.min(16, Number(count) || 8));
  const lines = {
    Funny: [
      `I have a question about ${subject}.`, 'Should I be worried?',
      'Only if you believe my very confident plan.', 'That is exactly what worries me.',
      'Step one: act like this was intentional.', 'And step two?',
      'I was hoping you had a step two.', 'I am putting this in the group chat.',
      'Wait. I can explain.', 'You have five seconds.',
      'Actually, the ending is kind of amazing.', 'Now I need to see it.'
    ],
    Suspense: [
      `Something strange happened with ${subject}.`, 'What do you mean?',
      'I thought I was the only one who noticed.', 'Noticed what?',
      'The same detail showed up twice.', 'Where are you right now?',
      'I am looking at it again.', 'Do not go any closer.',
      'I just got another message.', 'Who sent it?',
      'That is the part I cannot explain.', 'Send me a screenshot. Now.'
    ],
    Sweet: [
      `I have been thinking about ${subject}.`, 'Good thinking or bad thinking?',
      'The kind that made me smile all morning.', 'Okay, now I am curious.',
      'I wanted to tell you first.', 'I am listening.',
      'It reminded me how lucky I am to know you.', 'That is unfairly sweet.',
      'Can I show you something later?', 'Only if I get to bring snacks.',
      'Deal. It is a date.', 'I was hoping you would say that.'
    ],
    Casual: [
      `Hey, can we talk about ${subject}?`, 'Sure. What is up?',
      'I have an idea and wanted your honest take.', 'Tell me.',
      'What if we try it this weekend?', 'That could actually work.',
      'I can sort out the details.', 'I can help with the first part.',
      'Perfect. I will send you a plan.', 'Sounds good to me.',
      'Thanks for hearing me out.', 'Always.'
    ],
  }[style];
  const extra = ['There is one more thing.', 'Go on.', 'I will send you the details.', 'Okay, I am in.'];
  const selected = [...lines, ...extra].slice(0, number);
  return { engine: 'local-story-writer', modelConnected: false, messages: selected.map((text, index) => ({ side: index % 2 ? 'right' : 'left', text })) };
}

function makeChoiceScript({ prompt, count }) {
  const subject = String(prompt || '').trim().replace(/[\r\n]+/g, ' ').slice(0, 120);
  if (!subject) throw new Error('Describe the choice video first.');
  const number = Math.max(3, Math.min(12, Number(count) || 8));
  const pairs = [
    [`Get unlimited access to ${subject}`, `Get one perfect day with ${subject}`],
    [`Be famous for ${subject}`, `Keep ${subject} completely private`],
    [`Experience ${subject} a year early`, `Share ${subject} with everyone you know`],
    [`Have a million fans of ${subject}`, `Be the best in the world at ${subject}`],
    [`Never give up ${subject}`, `Try something new every week`],
    [`Know the future of ${subject}`, `Change the past of ${subject}`],
    [`Make ${subject} free for everyone`, `Own the only version of ${subject}`],
    [`Spend a month exploring ${subject}`, `Understand ${subject} instantly`],
    [`Teach your friends about ${subject}`, `Learn from the world's top expert`],
    [`Win a contest about ${subject}`, `Create your own contest`],
    [`Get the most surprising ${subject} story`, `Get the funniest ${subject} story`],
    [`Start over with ${subject}`, `See where ${subject} goes next`],
  ];
  return { ok: true, engine: 'local-choice-draft', modelConnected: false, script: { rounds: pairs.slice(0, number).map(([left, right], index) => ({ left: left.slice(0, 90), right: right.slice(0, 90), leftPercent: 35 + (index * 17 % 40) })) } };
}

async function makeLocalSpeech(body, directory) {
  const spoken = String(body.text || '').trim().slice(0, 600);
  if (!spoken) throw new Error('Enter text for the voice preview.');
  const voiceName = String(body.voice || '').toLowerCase();
  const voice = /chloe|abigail|laura|lucy|evelyn|madison|meera|marisol|anaya/.test(voiceName) ? 'Samantha'
    : /ryan|aiden|aaron|andy|archer|brian|dylan|ethan|gavin|gordon|max|walter/.test(voiceName) ? 'Daniel' : 'Karen';
  const input = join(directory, 'speech.txt'), aiff = join(directory, 'speech.aiff'), output = join(directory, 'speech.wav');
  await writeFile(input, spoken);
  await run('say', ['-v', voice, '-o', aiff, '-f', input], directory);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', output], directory);
  const details = await stat(output);
  return { path: output, size: details.size, type: 'audio/wav', name: 'voice-preview.wav' };
}

function run(binary, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors = (errors + chunk.toString()).slice(-7000); });
    child.on('error', error => reject(new Error(`${binary} is unavailable: ${error.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error((errors.split('\n').filter(Boolean).at(-1) || `${binary} exited with code ${code}`).slice(0, 500))));
  });
}

async function receiveFiles(req, directory, requireFile = true) {
  return new Promise((resolve, reject) => {
    const fields = {}, files = [], writes = [];
    let failure = null;
    const parser = Busboy({ headers: req.headers, limits: { files: 64, fileSize: 1024 ** 3, fields: 24, fieldSize: 1_000_000 } });
    parser.on('field', (name, value) => { fields[name] = value.slice(0, 1_000_000); });
    parser.on('file', (name, stream, info) => {
      const suffix = extname(info.filename || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10) || '.bin';
      const path = join(directory, `input-${files.length}${suffix}`);
      files.push({ path, filename: info.filename, mimeType: info.mimeType, fieldName: name });
      const output = createWriteStream(path);
      stream.on('limit', () => { failure = new Error('Files must be under 1 GB each.'); });
      writes.push(pipeline(stream, output));
    });
    parser.on('error', reject);
    parser.on('close', async () => {
      try { await Promise.all(writes); if (failure) throw failure; if (requireFile && !files.length) throw new Error('Add a media file first.'); resolve({ fields, files }); }
      catch (error) { reject(error); }
    });
    req.pipe(parser);
  });
}

const formatSize = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [1080, 1080], '4:5': [1080, 1350] };

async function processMedia(fields, files, directory) {
  const tool = fields.tool, input = files[0].path;
  const videoInput = files[0].mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(files[0].filename || '');
  const outputExt = tool === 'MP3 Converter' || tool === 'Audio Balancer' || tool === 'Volume Booster' && !videoInput ? 'mp3' : tool === 'Video to GIF' ? 'gif' : 'mp4';
  const output = join(directory, `result.${outputExt}`), args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const [targetWidth, targetHeight] = formatSize[fields.format] || formatSize['9:16'];
  const level = Math.max(25, Math.min(200, Number(fields.level) || 100));
  switch (tool) {
    case 'Audio Balancer': args.push('-i', input, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output); break;
    case 'Video Compressor': args.push('-i', input, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', { small: '35', balanced: '30', high: '25' }[fields.quality] || '30', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output); break;
    case 'MP3 Converter': args.push('-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output); break;
    case 'Video Trimmer': {
      const start = Math.max(0, Number(fields.start) || 0), end = Number(fields.end);
      if (!Number.isFinite(end) || end <= start) throw new Error('Choose an end time after the start time.');
      args.push('-ss', String(start), '-i', input, '-t', String(end - start), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output); break;
    }
    case 'Aspect Ratio Converter': {
      /* fit keeps the whole picture with bars; fill crops to the frame's centre */
      const frame = fields.fit === 'fill' ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}` : `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`;
      args.push('-i', input, '-vf', frame, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output); break;
    }
    case 'Video to GIF': {
      const from = Math.max(0, Number(fields.start) || 0), length = Math.max(1, Math.min(15, Number(fields.length) || 15)), width = [360, 480, 640].includes(Number(fields.width)) ? Number(fields.width) : 480;
      args.push('-ss', String(from), '-t', String(length), '-i', input, '-vf', `fps=12,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', output); break;
    }
    case 'Video Speed Changer': args.push('-i', input, '-filter:v', `setpts=${(100 / level).toFixed(4)}*PTS`, '-filter:a', level < 50 ? `atempo=0.5,atempo=${(level / 50).toFixed(4)}` : `atempo=${(level / 100).toFixed(4)}`, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output); break;
    case 'Volume Booster': args.push('-i', input, '-af', `volume=${(level / 100).toFixed(2)}`, ...(outputExt === 'mp3' ? ['-vn', '-c:a', 'libmp3lame'] : ['-c:v', 'copy', '-c:a', 'aac']), output); break;
    case 'Video Merger': {
      if (files.length < 2) throw new Error('Select at least two videos to merge.');
      const list = join(directory, 'concat.txt');
      await writeFile(list, files.map(file => `file '${file.path.replaceAll("'", "'\\''")}'`).join('\n'));
      args.push('-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', output); break;
    }
    case 'MP4 Converter': args.push('-i', input, '-c:v', 'libx264', '-preset', 'veryfast', ...(fields.fps === '60' ? ['-r', '60'] : []), '-c:a', 'aac', output); break;
    case 'Video Reverser': args.push('-i', input, '-vf', 'reverse', '-an', '-c:v', 'libx264', '-preset', 'veryfast', output); break;
    case 'Mute Video': args.push('-i', input, '-c:v', 'copy', '-an', output); break;
    default: throw new Error('This tool is not available for local processing.');
  }
  await run('ffmpeg', args, directory);
  const details = await stat(output);
  if (!details.size) throw new Error('The output file was empty.');
  return { path: output, name: `${basename(files[0].filename || 'video', extname(files[0].filename || 'video'))}-${tool.toLowerCase().replace(/[^a-z]+/g, '-')}.${outputExt}`, size: details.size, type: outputExt === 'mp3' ? 'audio/mpeg' : outputExt === 'gif' ? 'image/gif' : 'video/mp4' };
}

async function downloadMedia({ url, platform }, directory) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:') throw new Error('Use a secure public video link.');
  const youtube = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(parsed.hostname);
  const tiktok = ['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(parsed.hostname);
  if (platform === 'YouTube' && !youtube || platform === 'TikTok' && !tiktok) throw new Error(`Paste a valid ${platform} link.`);
  await run('python3', ['-m', 'yt_dlp', '--no-playlist', '--max-downloads', '1', '--max-filesize', '1G', '--socket-timeout', '20', '--merge-output-format', 'mp4', '--remux-video', 'mp4', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best', '--restrict-filenames', '-o', join(directory, '%(title).80B.%(ext)s'), parsed.toString()], directory);
  const names = (await readdir(directory)).filter(name => name.endsWith('.mp4'));
  if (!names.length) throw new Error('No MP4 was available from this link.');
  const path = join(directory, names[0]), details = await stat(path);
  return { path, name: names[0], size: details.size, type: 'video/mp4' };
}

async function sendFile(res, file) {
  res.writeHead(200, { 'content-type': file.type, 'content-length': file.size, 'content-disposition': `attachment; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`, 'x-download-name': file.name.replace(/[^a-zA-Z0-9._-]/g, '_'), 'cache-control': 'no-store' });
  await pipeline(createReadStream(file.path), res);
}

const storyRenders = new Map();
const wyrRenders = new Map();
const redditRenders = new Map();
const validThemes = new Set(['ios-light', 'ios-dark', 'whatsapp-light', 'whatsapp-dark']);
const clamp = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;

function prepareWyrSpec(raw) {
  if (!Array.isArray(raw.questions) || !raw.questions.length || raw.questions.length > 20) throw new Error('Add 1 to 20 questions before exporting.');
  const questions = raw.questions.map((item, index) => ({
    id: index + 1,
    a: String(item.a || '').trim().slice(0, 180),
    b: String(item.b || '').trim().slice(0, 180),
    percent: Math.round(clamp(item.percent, 0, 100, 50)),
    label: item.label !== false,
    ...(/^data:image\/(png|jpeg|webp);base64,/.test(String(item.imageA || '')) && String(item.imageA).length < 3_000_000 ? { imageA: item.imageA } : {}),
    ...(/^data:image\/(png|jpeg|webp);base64,/.test(String(item.imageB || '')) && String(item.imageB).length < 3_000_000 ? { imageB: item.imageB } : {}),
  }));
  if (questions.some(item => !item.a || !item.b)) throw new Error('Fill in both options for every question.');
  const timing = {
    countdown: clamp(raw.timing?.countdown, 2, 8, 3),
    results: clamp(raw.timing?.results, 1, 6, 2.4),
    gap: clamp(raw.timing?.gap, .2, 2, .55),
  };
  return { questions, timing, durationMs: Math.ceil(questions.length * (2.45 + timing.countdown + timing.results + timing.gap) * 1000) };
}

function prepareStorySpec(raw, files, id) {
  if (!raw || !Array.isArray(raw.messages) || raw.messages.length > 60) throw new Error('Add up to 60 story messages.');
  const fileIndex = new Map(files.map((file, index) => [file.fieldName, index]));
  const messages = raw.messages.map((message, index) => ({
    id: String(message.id || `render-${index}`).slice(0, 90),
    side: message.side === 'right' ? 'right' : 'left',
    text: String(message.text || '').slice(0, 500),
    imageName: String(message.imageName || '').slice(0, 100),
    imageUrl: fileIndex.has(`image-${index}`) ? `/api/story/render/${id}/media/${fileIndex.get(`image-${index}`)}` : '',
  }));
  if (!messages.some(message => message.text.trim() || message.imageUrl)) throw new Error('Add a message before exporting.');
  const libraryVideo = String(raw.videoUrl || '');
  const videoUrl = fileIndex.has('video')
    ? `/api/story/render/${id}/media/${fileIndex.get('video')}`
    : /^\/media\/fake-text-gameplay\/[a-z0-9-]+\.mp4$/.test(libraryVideo) ? libraryVideo : '';
  const source = raw.background || {};
  return {
    name: String(raw.name || 'Unknown').slice(0, 35),
    theme: validThemes.has(raw.theme) ? raw.theme : 'ios-dark',
    messages,
    videoUrl,
    posterUrl: /^\/media\/fake-text-gameplay\/[a-z0-9-]+\.jpg$/.test(String(raw.posterUrl || '')) ? raw.posterUrl : '',
    background: {
      zoom: clamp(source.zoom, 100, 200, 100),
      speed: clamp(source.speed, 50, 200, 100),
      offsetX: clamp(source.offsetX, -50, 50, 0),
      offsetY: clamp(source.offsetY, -50, 50, 0),
      dim: clamp(source.dim, 0, 90, 0),
      blur: clamp(source.blur, 0, 40, 0),
      trim: clamp(source.trim, 0, 30, 0),
      muted: true,
    },
  };
}

async function runStoryRender(job) {
  let browser;
  try {
    job.state = 'rendering';
    job.message = 'Opening the live preview';
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
    const page = await browser.newPage({ viewport: { width: 256, height: 454 }, deviceScaleFactor: 1 });
    await page.goto(`${job.origin}/?frameTextRender=${encodeURIComponent(job.id)}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__frameTextReady === true, undefined, { timeout: 60_000 });
    const total = Math.max(1, Math.ceil(job.durationMs / 1000 * 60));
    const output = join(job.directory, 'story-60fps.mp4');
    const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-i', 'pipe:0', '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: ['pipe', 'ignore', 'pipe'] });
    let diagnostics = '';
    encoder.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
    const encoded = new Promise((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('close', code => code === 0 ? resolve() : reject(new Error(diagnostics.trim().split('\n').at(-1) || `FFmpeg exited with ${code}`)));
    });
    encoded.catch(() => undefined);
    try {
      for (let frame = 0; frame < total; frame++) {
        const timeMs = Math.round(frame * 1000 / 60);
        await page.evaluate(value => window.__frameSetTextTime(value), timeMs);
        const png = await page.locator('.csp-render-root .phone').screenshot({ type: 'png', animations: 'disabled', timeout: 20_000 });
        await new Promise((resolve, reject) => encoder.stdin.write(png, error => error ? reject(error) : resolve()));
        job.progress = Math.round((frame + 1) / total * 100);
        job.message = `Rendering frame ${frame + 1} of ${total}`;
      }
      encoder.stdin.end();
      await encoded;
    } catch (error) {
      encoder.kill('SIGTERM');
      throw error;
    }
    const details = await stat(output);
    if (!details.size) throw new Error('The MP4 export was empty.');
    job.result = { path: output, size: details.size, name: 'fake-text-story-60fps.mp4', type: 'video/mp4' };
    job.state = 'complete';
    job.progress = 100;
    job.message = 'Your 60 fps MP4 is ready';
  } catch (error) {
    job.state = 'error';
    job.message = error.message;
  } finally {
    await browser?.close().catch(() => undefined);
    setTimeout(() => { storyRenders.delete(job.id); void rm(job.directory, { recursive: true, force: true }); }, 60 * 60 * 1000).unref();
  }
}

async function runWyrRender(job) {
  let browser;
  try {
    job.state = 'rendering';
    job.message = 'Opening the live preview';
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
    const page = await browser.newPage({ viewport: { width: 720, height: 1280 }, deviceScaleFactor: 1 });
    await page.goto(`${job.origin}/?frameWyrRender=${encodeURIComponent(job.id)}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__frameWyrReady === true, undefined, { timeout: 60_000 });
    const total = Math.max(1, Math.ceil(job.spec.durationMs / 1000 * 60));
    const output = join(job.directory, 'would-you-rather-60fps.mp4');
    const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: ['pipe', 'ignore', 'pipe'] });
    let diagnostics = '';
    encoder.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
    const encoded = new Promise((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('close', code => code === 0 ? resolve() : reject(new Error(diagnostics.trim().split('\n').at(-1) || `FFmpeg exited with ${code}`)));
    });
    encoded.catch(() => undefined);
    try {
      for (let frame = 0; frame < total; frame++) {
        await page.evaluate(value => window.__frameSetWyrTime(value), frame / 60);
        const png = await page.locator('#frame-wyr-canvas').screenshot({ type: 'png', animations: 'disabled', timeout: 20_000 });
        await new Promise((resolve, reject) => encoder.stdin.write(png, error => error ? reject(error) : resolve()));
        job.progress = Math.round((frame + 1) / total * 100);
        job.message = `Rendering frame ${frame + 1} of ${total}`;
      }
      encoder.stdin.end();
      await encoded;
    } catch (error) {
      encoder.kill('SIGTERM');
      throw error;
    }
    const details = await stat(output);
    if (!details.size) throw new Error('The MP4 export was empty.');
    job.result = { path: output, size: details.size, name: 'would-you-rather-60fps.mp4', type: 'video/mp4' };
    job.state = 'complete';
    job.progress = 100;
    job.message = 'Your 60 fps MP4 is ready';
  } catch (error) {
    job.state = 'error';
    job.message = error.message;
  } finally {
    await browser?.close().catch(() => undefined);
    setTimeout(() => { wyrRenders.delete(job.id); void rm(job.directory, { recursive: true, force: true }); }, 60 * 60 * 1000).unref();
  }
}

function prepareRedditSpec(raw, files, id) {
  if (!raw || !Array.isArray(raw.posts) || !raw.posts.length || raw.posts.length > 20) throw new Error('Add between 1 and 20 posts.');
  const fileIndex = new Map(files.map((file, index) => [file.fieldName, index]));
  const media = (field) => (fileIndex.has(field) ? `/api/reddit/render/${id}/media/${fileIndex.get(field)}` : '');
  const posts = raw.posts.map((post, index) => ({
    id: String(post.id || `post-${index}`).slice(0, 90),
    author: String(post.author || '').slice(0, 60),
    title: String(post.title || '').slice(0, 300),
    body: String(post.body || '').slice(0, 4000),
    votes: String(post.votes ?? '').slice(0, 12),
    comments: String(post.comments ?? '').slice(0, 12),
    imageUrl: media(`image-${index}`),
    avatarUrl: media(`avatar-${index}`),
  }));
  if (!posts.some((post) => post.body.trim())) throw new Error('Please write a script before generating a video');
  const libraryVideo = String(raw.videoUrl || '');
  return {
    posts,
    dark: !!raw.dark,
    videoUrl: /^\/media\/fake-text-gameplay\/[a-z0-9-]+\.mp4$/.test(libraryVideo) ? libraryVideo : '',
    posterUrl: /^\/media\/fake-text-gameplay\/[a-z0-9-]+\.jpg$/.test(String(raw.posterUrl || '')) ? raw.posterUrl : '',
    durationMs: posts.length * 5000,
  };
}

async function runRedditRender(job) {
  let browser;
  try {
    job.state = 'rendering';
    job.message = 'Opening the live preview';
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
    /* the preview is laid out at 256 px wide; drawn at 720 × 1280 (a device scale), so text stays sharp */
    const page = await browser.newPage({ viewport: { width: 256, height: 455 }, deviceScaleFactor: 720 / 256 });
    await page.goto(`${job.origin}/?frameRedditRender=${encodeURIComponent(job.id)}`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.__frameRedditReady === true, undefined, { timeout: 60_000 });
    const total = Math.max(1, Math.ceil(job.spec.durationMs / 1000 * 60));
    const output = join(job.directory, 'reddit-story-60fps.mp4');
    const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '60', '-i', 'pipe:0', '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { stdio: ['pipe', 'ignore', 'pipe'] });
    let diagnostics = '';
    encoder.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk.toString()).slice(-3000); });
    const encoded = new Promise((resolve, reject) => {
      encoder.on('error', reject);
      encoder.on('close', (code) => (code === 0 ? resolve() : reject(new Error(diagnostics.trim().split('\n').at(-1) || `FFmpeg exited with ${code}`))));
    });
    encoded.catch(() => undefined);
    try {
      for (let frame = 0; frame < total; frame++) {
        await page.evaluate((value) => window.__frameSetRedditTime(value), frame / 60);
        const png = await page.locator('.rlp-phone').screenshot({ type: 'png', animations: 'disabled', timeout: 20_000 });
        await new Promise((resolve, reject) => encoder.stdin.write(png, (error) => (error ? reject(error) : resolve())));
        job.progress = Math.round((frame + 1) / total * 100);
        job.message = `Rendering frame ${frame + 1} of ${total}`;
      }
      encoder.stdin.end();
      await encoded;
    } catch (error) {
      encoder.kill('SIGTERM');
      throw error;
    }
    const details = await stat(output);
    if (!details.size) throw new Error('The MP4 export was empty.');
    job.result = { path: output, size: details.size, name: 'reddit-story-60fps.mp4', type: 'video/mp4' };
    job.state = 'complete';
    job.progress = 100;
    job.message = 'Your 60 fps MP4 is ready';
  } catch (error) {
    job.state = 'error';
    job.message = error.message;
  } finally {
    await browser?.close().catch(() => undefined);
    setTimeout(() => { redditRenders.delete(job.id); void rm(job.directory, { recursive: true, force: true }); }, 60 * 60 * 1000).unref();
  }
}

async function sendStoryMedia(req, res, file) {
  const size = (await stat(file.path)).size;
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (start >= size || end < start) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
  res.writeHead(match ? 206 : 200, { 'content-type': file.mimeType || 'application/octet-stream', 'accept-ranges': 'bytes', 'content-length': end - start + 1, ...(match ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}), 'cache-control': 'no-store' });
  await pipeline(createReadStream(file.path, { start, end }), res);
}

/* Clyra's clipper backend (when Shorts runs inside Clyra: CLYRA_SERVER, and the bearer Clyra gave this launch): the AI
   clipper's uploads, its generation (an event stream) and its finished clips, passed straight through */
/* the advanced editor (Studio, on its own local port) calls the clipper and the editor AI from its page */
const STUDIO_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
function cors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!STUDIO_ORIGIN.test(origin)) return false;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  return true;
}
function toClyra(req, res, pathname) {
  const base = process.env.CLYRA_SERVER;
  if (!base) return json(res, 503, { error: 'The AI clipper generates with Clyra: open Shorts from Clyra to generate clips.' });
  const target = new URL(pathname + (new URL(req.originalUrl || req.url || '/', 'http://localhost').search), base);
  const headers = { ...req.headers, host: target.host, authorization: `Bearer ${process.env.CLYRA_BRIDGE_TOKEN || ''}` };
  delete headers.cookie; delete headers.origin; delete headers.referer;
  const upstream = httpRequest(target, { method: req.method, headers }, (answer) => {
    const out = { ...answer.headers };
    for (const h of ['access-control-allow-origin', 'access-control-allow-headers', 'access-control-allow-methods', 'vary']) { const v = res.getHeader(h); if (v) out[h] = v; }
    res.writeHead(answer.statusCode || 502, out);
    answer.pipe(res);
  });
  upstream.on('error', (error) => { if (!res.headersSent) json(res, 502, { error: `Clyra's clipper is not answering: ${error.message}` }); else res.end(); });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

export async function localApi(req, res, next) {
  const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
  if(pathname.startsWith('/api/editor-audio/')){
    cors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    const root=fileURLToPath(new URL('../../../../shorts-library/',import.meta.url));
    const library=await readFile(join(root,'recordings.json'),'utf8').then(JSON.parse).catch(()=>({}));
    if(pathname==='/api/editor-audio/library')return json(res,200,{recordings:library});
    const id=decodeURIComponent(pathname.slice('/api/editor-audio/'.length)),entry=library[id];
    if(!entry)return json(res,404,{error:'The original recording has not been downloaded.'});
    const issue=recordingIssue(id,entry);if(issue)return json(res,409,{error:issue});
    const path=resolve(root,entry.file);if(!path.startsWith(resolve(root)+sep))return json(res,400,{error:'Invalid recording path.'});
    const details=await stat(path).catch(()=>null);if(!details)return json(res,404,{error:'Recording file is missing.'});
    return sendFile(res,{path,name:`${id}.mp3`,size:details.size,type:'audio/mpeg'});
  }
  if (pathname.startsWith('/api/clipper/') || pathname === '/api/editor-ai/chat' || pathname === '/api/editor-ai/vision') {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    /* the editor's AI talks to Clyra's own chat model (Clyra holds the key; nothing is configured here) */
    return toClyra(req, res, pathname === '/api/editor-ai/chat' ? '/api/deepseek/chat' : pathname === '/api/editor-ai/vision' ? '/api/shorts-app/vision' : pathname);
  }
  if (pathname.endsWith('/advanced/projects') && req.method === 'GET') return json(res, 200, { projects: await listAdvancedProjects() });
  if (pathname.endsWith('/advanced/poster') && req.method === 'GET') {
    const jpeg = await advancedPoster(new URL(req.originalUrl || req.url || '/', 'http://localhost').searchParams.get('name'));
    if (!jpeg) return json(res, 404, { error: 'no poster yet' });
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=30', 'content-length': jpeg.length });
    return res.end(jpeg);
  }
  if (pathname.endsWith('/advanced/preview') && req.method === 'GET') {
    const file = await advancedPreview(new URL(req.originalUrl || req.url || '/', 'http://localhost').searchParams.get('name'));
    if (!file) return json(res, 404, { error: 'no footage in this project' });
    return sendStoryMedia(req, res, file);
  }
  if (pathname.endsWith('/advanced/start') && req.method === 'POST') {
    try { return json(res, 200, await startAdvancedStudio(await readJson(req))); }
    catch (error) { return json(res, 500, { error: error.message }); }
  }
  if (pathname.endsWith('/creator/tts') && req.method === 'POST') {
    const directory = await mkdtemp(join(tmpdir(), 'frame-tts-'));
    try { await sendFile(res, await makeLocalSpeech(await readJson(req), directory)); }
    catch (error) { if (!res.headersSent) json(res, 422, { error: error.message }); else res.destroy(error); }
    finally { await rm(directory, { recursive: true, force: true }); }
    return;
  }
  if (pathname.endsWith('/shorts/ai/generate') && req.method === 'POST') {
    try {
      const body = await readJson(req);
      if (body.kind !== 'would-rather') throw new Error('This local draft supports Would You Rather only.');
      return json(res, 200, makeChoiceScript(body));
    } catch (error) { return json(res, 400, { ok: false, error: error.message }); }
  }
  if (pathname.endsWith('/wyr/render') && req.method === 'POST') {
    let directory;
    try {
      const spec = prepareWyrSpec(await readJson(req));
      directory = await mkdtemp(join(tmpdir(), 'frame-wyr-'));
      const id = randomUUID();
      const job = { id, directory, spec, origin: `http://127.0.0.1:${req.socket.localPort}`, state: 'queued', progress: 0, message: 'Preparing preview', result: null };
      wyrRenders.set(id, job);
      json(res, 202, { id, state: job.state });
      void runWyrRender(job);
    } catch (error) {
      if (directory) await rm(directory, { recursive: true, force: true });
      json(res, 400, { error: error.message });
    }
    return;
  }
  const wyrMatch = pathname.match(/\/wyr\/render\/([0-9a-f-]+)\/(spec|status|result)$/);
  if (wyrMatch && req.method === 'GET') {
    const job = wyrRenders.get(wyrMatch[1]);
    if (!job) return json(res, 404, { error: 'Render job not found or expired.' });
    if (wyrMatch[2] === 'spec') return json(res, 200, job.spec);
    if (wyrMatch[2] === 'status') return json(res, 200, { state: job.state, progress: job.progress, message: job.message, resultUrl: job.result ? `/api/wyr/render/${job.id}/result` : null });
    if (!job.result) return json(res, 409, { error: 'The MP4 is not ready yet.' });
    try { await sendFile(res, job.result); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
    return;
  }
  if (pathname.endsWith('/reddit/render') && req.method === 'POST') {
    const directory = await mkdtemp(join(tmpdir(), 'frame-reddit-'));
    try {
      const { fields, files } = await receiveFiles(req, directory, false);
      const id = randomUUID();
      const spec = prepareRedditSpec(JSON.parse(fields.spec || '{}'), files, id);
      const job = { id, directory, files, spec, origin: `http://127.0.0.1:${req.socket.localPort}`, state: 'queued', progress: 0, message: 'Preparing preview', result: null };
      redditRenders.set(id, job);
      json(res, 202, { id, state: job.state });
      void runRedditRender(job);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      json(res, 400, { error: error.message });
    }
    return;
  }
  const redditMatch = pathname.match(/\/reddit\/render\/([0-9a-f-]+)(?:\/(spec|status|result|view|media\/\d+))?$/);
  if (redditMatch && req.method === 'GET') {
    const job = redditRenders.get(redditMatch[1]);
    if (!job) return json(res, 404, { error: 'Render job not found or expired.' });
    const part = redditMatch[2];
    if (part === 'spec') return json(res, 200, job.spec);
    if (part === 'status') return json(res, 200, { state: job.state, progress: job.progress, message: job.message, resultUrl: job.result ? `/api/reddit/render/${job.id}/result` : null, viewUrl: job.result ? `/api/reddit/render/${job.id}/view` : null });
    if (part === 'result' || part === 'view') {
      if (!job.result) return json(res, 409, { error: 'The MP4 is not ready yet.' });
      try { if (part === 'result') await sendFile(res, job.result); else await sendStoryMedia(req, res, { path: job.result.path, mimeType: 'video/mp4' }); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
      return;
    }
    if (part?.startsWith('media/')) {
      const file = job.files[Number(part.slice(6))];
      if (!file) return json(res, 404, { error: 'Media was not found.' });
      try { await sendStoryMedia(req, res, file); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
      return;
    }
    return json(res, 404, { error: 'Unknown render resource.' });
  }
  if (pathname.endsWith('/story/render') && req.method === 'POST') {
    const directory = await mkdtemp(join(tmpdir(), 'frame-story-'));
    try {
      const { fields, files } = await receiveFiles(req, directory, false);
      const raw = JSON.parse(fields.spec || '{}');
      const id = randomUUID();
      const spec = prepareStorySpec(raw, files, id);
      const durationMs = clamp(raw.durationMs, 1000, 120_000, 1000);
      const job = { id, directory, files, spec, durationMs, origin: `http://127.0.0.1:${req.socket.localPort}`, state: 'queued', progress: 0, message: 'Preparing preview', result: null };
      storyRenders.set(id, job);
      json(res, 202, { id, state: job.state });
      void runStoryRender(job);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      json(res, 400, { error: error.message });
    }
    return;
  }
  const storyMatch = pathname.match(/\/story\/render\/([0-9a-f-]+)(?:\/(spec|status|result|view|media\/\d+))?$/);
  if (storyMatch && req.method === 'GET') {
    const job = storyRenders.get(storyMatch[1]);
    if (!job) return json(res, 404, { error: 'Render job not found or expired.' });
    const part = storyMatch[2];
    if (part === 'spec') return json(res, 200, job.spec);
    if (part === 'status') return json(res, 200, { state: job.state, progress: job.progress, message: job.message, resultUrl: job.result ? `/api/story/render/${job.id}/result` : null, viewUrl: job.result ? `/api/story/render/${job.id}/view` : null });
    if (part === 'result') {
      if (!job.result) return json(res, 409, { error: 'The MP4 is not ready yet.' });
      try { await sendFile(res, job.result); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
      return;
    }
    if (part === 'view') {
      if (!job.result) return json(res, 409, { error: 'The MP4 is not ready yet.' });
      try { await sendStoryMedia(req, res, { path: job.result.path, mimeType: 'video/mp4' }); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
      return;
    }
    if (part?.startsWith('media/')) {
      const file = job.files[Number(part.slice(6))];
      if (!file) return json(res, 404, { error: 'Media was not found.' });
      try { await sendStoryMedia(req, res, file); } catch (error) { if (!res.headersSent) json(res, 500, { error: error.message }); }
      return;
    }
    return json(res, 404, { error: 'Unknown render resource.' });
  }
  if (pathname.endsWith('/story/ai-writer') && req.method === 'POST') {
    try { return json(res, 200, makeStory(await readJson(req))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (pathname.endsWith('/media/process') && req.method === 'POST') {
    const directory = await mkdtemp(join(tmpdir(), 'frame-process-'));
    try { const { fields, files } = await receiveFiles(req, directory); await sendFile(res, await processMedia(fields, files, directory)); }
    catch (error) { if (!res.headersSent) json(res, 422, { error: error.message }); else res.destroy(error); }
    finally { await rm(directory, { recursive: true, force: true }); }
    return;
  }
  if (pathname.endsWith('/media/download') && req.method === 'POST') {
    const directory = await mkdtemp(join(tmpdir(), 'frame-download-'));
    try { await sendFile(res, await downloadMedia(await readJson(req), directory)); }
    catch (error) { if (!res.headersSent) json(res, 422, { error: error.message }); else res.destroy(error); }
    finally { await rm(directory, { recursive: true, force: true }); }
    return;
  }
  next();
}
