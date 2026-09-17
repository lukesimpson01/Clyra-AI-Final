/**
 * Production host for Clyra Earth.
 *
 * Serves the built God's Eye View document plus its provider middleware. Run as
 * a child process with its working directory set to the vendored checkout (see
 * tools/earth-server.mjs for why that matters), so the providers resolve their
 * disk caches and bundled source roots correctly.
 *
 * God's Eye View's providers are Vite plugins only in shape — each one's
 * `configureServer` just registers connect-style middleware — so they mount
 * onto Express unchanged.
 */
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const EARTH_ROOT = process.env.CLYRA_EARTH_ROOT || process.cwd();
const PORT = Number(process.env.CLYRA_EARTH_PORT) || 5176;
const CLYRA_PORT = process.env.PORT || '3000';

/** Origins permitted to frame Clyra Earth — mirrors tools/earth-vite.config.mjs. */
function frameAncestors() {
  const extra = String(process.env.CLYRA_EARTH_FRAME_ANCESTORS || '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const origins = new Set(["'self'", 'file:']);
  for (const port of [CLYRA_PORT, '3000', '5173', '5174']) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  for (const origin of extra) origins.add(origin);
  return [...origins].join(' ');
}

const { default: express } = await import('express');
const { localProviderPlugins } = await import(
  pathToFileURL(path.join(EARTH_ROOT, 'server', 'providers', 'local.js')).href
);

const app = express();
const csp = `frame-ancestors ${frameAncestors()}`;
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', csp);
  next();
});

// Providers first, so /api/* never falls through to the static handler.
const shim = { middlewares: app, config: { root: EARTH_ROOT } };
for (const plugin of localProviderPlugins()) {
  const configure = plugin?.configureServer;
  if (typeof configure === 'function') await configure.call(plugin, shim);
  else if (typeof configure?.handler === 'function') {
    await configure.handler.call(plugin, shim);
  }
}

const distDir = path.join(EARTH_ROOT, 'dist');
app.use(express.static(distDir));
// Single-document app: anything that is not a real file is the shell.
app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));

http.createServer(app).listen(PORT, '127.0.0.1', () => {
  console.log(`Clyra Earth (static) on http://127.0.0.1:${PORT}`);
});
