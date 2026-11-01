import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* The advanced editor is the Studio in ../openfilm, with FRAME's tools built into it. This starts it (or finds it
   already running) on a project folder of ours and hands back the address the browser opens. */
const here = dirname(fileURLToPath(import.meta.url));
export const STUDIO_BIN = process.env.FRAME_OPENFILM_BIN || join(here, '..', '..', 'openfilm', 'packages', 'openfilm', 'bin', 'openfilm.mjs');
const PROJECTS = join(here, '..', 'frame-projects');
const safe = (name) => String(name || 'FRAME project').replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'FRAME project';

/* the editor's AI chat (the desktop app's own, apps/desktop/web/chat-host.mjs), beside the editor: started once, on the
   Studio home `openfilm open` uses */
const CHAT_HOST = join(dirname(STUDIO_BIN), '..', '..', '..', 'apps', 'desktop', 'web', 'chat-host.mjs');
let chatHost = null;
async function startChatHost() {
  if (chatHost || !existsSync(CHAT_HOST)) return;
  const up = await fetch('http://127.0.0.1:4851/ipc/desktop%3Ahello', { method: 'POST', body: '{}', signal: AbortSignal.timeout(800) }).then((r) => r.ok).catch(() => false);
  if (up) return;
  chatHost = spawn(process.execPath, [CHAT_HOST], { env: { ...process.env, OPENFILM_HOME: process.env.OPENFILM_HOME || join(homedir(), '.openfilm') }, stdio: 'ignore' });
  chatHost.on('exit', () => { chatHost = null; });
  for (const signal of ['SIGINT', 'SIGTERM', 'exit']) process.once(signal, () => chatHost?.kill());
}

/* Studio's own client, loaded once into this server: opening a project is then one request to the running Studio,
   with no new process and no headless-browser check each time (the CLI path took 2.5–5 s per open) */
let studioClient = null;
const loadStudioClient = () => (studioClient ??= import(pathToFileURL(join(dirname(STUDIO_BIN), '..', 'studio', 'client.mjs')).href));

/* A finished AI clip opened in the editor: fetched from Clyra's clipper (the file it made), kept in the project and laid
   on its Video line, so the person polishes the clip itself. */
async function bringClip(folder, clip) {
  const file = String(clip).split(/[\\/]/).pop();
  if (!/^[\w .()-]+\.mp4$/i.test(file)) throw new Error('Which clip? A clipper output name is required.');
  const base = process.env.CLYRA_SERVER;
  if (!base) throw new Error('Clips come from Clyra: open Shorts from Clyra to edit a clip.');
  const answer = await fetch(new URL(`/api/clipper/download/${encodeURIComponent(file)}`, base), { headers: { authorization: `Bearer ${process.env.CLYRA_BRIDGE_TOKEN || ''}` } });
  if (!answer.ok) throw new Error(`The clip could not be fetched (${answer.status}).`);
  await mkdir(join(folder, 'assets'), { recursive: true });
  await writeFile(join(folder, 'assets', file), Buffer.from(await answer.arrayBuffer()));
  const id = file.replace(/\.mp4$/i, '').replace(/[^\w-]+/g, '-');
  await writeFile(join(folder, 'film.html'), `<meta name="viewport" content="width=1080, height=1920">\n\n<section>\n  <video id="${id}" src="assets/${file}"></video>\n</section>\n`);
}

async function projectFolder(name) {
  const folder = join(PROJECTS, safe(name));
  await mkdir(folder, { recursive: true });
  /* a new project opens vertical: 1080 × 1920, what short videos are */
  if (!existsSync(join(folder, 'film.html'))) await writeFile(join(folder, 'film.html'), '<meta name="viewport" content="width=1080, height=1920">\n');
  return folder;
}

export async function startAdvancedStudio({ name, clip } = {}) {
  void startChatHost().catch(() => {});
  if (!existsSync(STUDIO_BIN)) throw new Error('The advanced editor is not installed next to FRAME (expected ../openfilm). Run `pnpm install` there first.');
  const folder = await projectFolder(name);
  if (clip) await bringClip(folder, clip);
  try {
    const { openInStudio } = await loadStudioClient();
    const { url } = await openInStudio(folder, { fallback: 0, now: false, say: () => {} });
    return { url, folder };
  } catch {
    return startWithCli(folder);
  }
}

/** Starts Studio warm in the background, so the first open is quick too. */
export function warmAdvancedStudio() {
  if (!existsSync(STUDIO_BIN)) return;
  void startChatHost().catch(() => {});
  void loadStudioClient().then(({ ensureStudio }) => ensureStudio?.(() => {})).catch(() => {});
}

/* the command-line route, kept for a Studio the client cannot reach */
function startWithCli(folder) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STUDIO_BIN, 'open', folder], { env: { ...process.env, OPENFILM_NO_BROWSER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('The editor did not start in time.')); }, 60000);
    const look = (chunk) => {
      out += chunk;
      const hit = /(http:\/\/(?:127\.0\.0\.1|localhost):\d+\/open\?key=\S+)/.exec(out);
      if (hit) { clearTimeout(timer); resolve({ url: hit[1], folder }); }
    };
    child.stdout.on('data', look); child.stderr.on('data', look);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => { clearTimeout(timer); if (!/open\?key=/.test(out)) reject(new Error(`The editor stopped (${code}): ${out.trim().slice(-300)}`)); });
  });
}

/** The advanced editor's projects (folders under frame-projects/), newest first. */
export async function listAdvancedProjects() {
  const names = await readdir(PROJECTS).catch(() => []);
  const out = [];
  for (const name of names) {
    const st = await stat(join(PROJECTS, name)).catch(() => null);
    if (!st?.isDirectory()) continue;
    const timing = JSON.parse(await readFile(join(PROJECTS, name, '.film', 'cache', 'film-duration.json'), 'utf8').catch(() => '{}') || '{}');
    out.push({ name, modified: st.mtimeMs, poster: existsSync(join(PROJECTS, name, '.film', 'cache', 'film-poster.jpg')), duration: Number(timing.duration) || null, preview: !!(await advancedPreview(name)) });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/** The video a project's card plays on hover: the longest-running video the film is made from (its largest file in
 *  assets/), or null for a film with no footage. */
export async function advancedPreview(name) {
  if (!name || /[\\/]|\.\./.test(name)) return null;
  const dir = join(PROJECTS, name, 'assets');
  let best = null;
  for (const file of await readdir(dir).catch(() => [])) {
    if (!/\.(mp4|m4v|mov|webm)$/i.test(file)) continue;
    const st = await stat(join(dir, file)).catch(() => null);
    if (st?.isFile() && (!best || st.size > best.size)) best = { path: join(dir, file), size: st.size, mimeType: /\.webm$/i.test(file) ? 'video/webm' : /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4' };
  }
  return best;
}

/** A project's card picture: the poster the editor drew of its film (the editor's projects list shows the same). */
export async function advancedPoster(name) {
  if (!name || /[\\/]|\.\./.test(name)) return null;
  return readFile(join(PROJECTS, name, '.film', 'cache', 'film-poster.jpg')).catch(() => null);
}
