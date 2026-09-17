/**
 * Clyra Earth host server.
 *
 * Clyra Earth is the God's Eye View application (vendor/gods-eye-view, MIT)
 * running as Clyra's geospatial intelligence workspace. It is served on its own
 * loopback port rather than merged into Clyra's Vite/Express app, and that is a
 * deliberate architectural choice:
 *
 *   - God's Eye View hardcodes absolute `/api/...` and `/models/...` URLs in
 *     dozens of modules. Mounting it under a `/earth/` base would mean patching
 *     the upstream tree everywhere and re-patching on every upstream update.
 *   - Its Vite config carries its own plugin stack (vite-plugin-cesium, the
 *     `gev:template` HTML plugin, ~20 provider middlewares). Merging that with
 *     Clyra's React/Tailwind config risks breaking both.
 *   - Its global stylesheet is written for a full-page tactical HUD. A separate
 *     document keeps it from leaking into Clyra's chat UI and vice versa.
 *
 * It runs as a CHILD PROCESS with its working directory set to the vendored
 * checkout, which is load-bearing rather than incidental: vite-plugin-cesium
 * resolves Cesium's runtime assets from `node_modules/cesium/Build` *relative
 * to process.cwd()*, and several providers write their disk caches to
 * `path.join(process.cwd(), '.gev-cache')`. Hosting it in Clyra's own process
 * silently served Cesium's stylesheet as a 404-fallback HTML document — the
 * globe canvas then never got sized — and scattered cache directories into
 * Clyra's root. A child process in the right directory removes that whole class
 * of bug and matches how upstream's own `npm run dev` behaves.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const EARTH_ROOT = path.resolve(here, '..', 'vendor', 'gods-eye-view');

/** Default loopback port for the Clyra Earth document. */
export const DEFAULT_EARTH_PORT = 5176;

/** How long to wait for the dev server to answer before giving up. */
const READY_TIMEOUT_MS = 90_000;

/** True when the vendored God's Eye View checkout is present and installed. */
export function earthSourceAvailable() {
  return (
    fs.existsSync(path.join(EARTH_ROOT, 'package.json')) &&
    fs.existsSync(path.join(EARTH_ROOT, 'node_modules', 'vite'))
  );
}

/** True when a production build of Clyra Earth exists. */
export function earthBuildAvailable() {
  return fs.existsSync(path.join(EARTH_ROOT, 'dist', 'index.html'));
}

/** Find a free loopback port, preferring `preferred` when it is available. */
function freePort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    // Do not hand the caller an occupied port. Previously this returned zero,
    // only for the caller to replace it with `preferred` again; Vite could
    // then move to a different port while the readiness probe attached to an
    // unrelated local server. That made Earth intermittently frame the wrong
    // page or appear to be permanently loading.
    probe.once('error', () => {
      probe.listen(0, '127.0.0.1');
    });
    probe.once('listening', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : preferred;
      probe.close(() => resolve(port));
    });
    probe.listen(preferred, '127.0.0.1');
  });
}

/** Resolve once the server answers on `port`, or reject on timeout/exit. */
function waitForReady(port, child, timeoutMs = READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    child.once('exit', (code) =>
      finish(reject, new Error(`Clyra Earth host exited before it was ready (code ${code})`)),
    );

    const poll = async () => {
      if (settled) return;
      if (Date.now() > deadline) {
        finish(reject, new Error('Clyra Earth host did not become ready in time'));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          signal: AbortSignal.timeout(4000),
        });
        if (response.ok) {
          await response.body?.cancel().catch(() => {});
          finish(resolve, undefined);
          return;
        }
      } catch {
        /* not up yet */
      }
      setTimeout(poll, 400);
    };
    setTimeout(poll, 300);
  });
}

/**
 * Start Clyra Earth's Vite dev server as a child process.
 *
 * Uses Clyra's external config shim (tools/earth-vite.config.mjs), which
 * defers to upstream's config and only relaxes the framing policy.
 */
async function startDevServer({ port, clyraPort }) {
  const resolvedPort = await freePort(port);
  const child = spawn(
    process.execPath,
    [
      path.join(EARTH_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config',
      path.join(here, 'earth-vite.config.mjs'),
      '--port',
      String(resolvedPort),
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: EARTH_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(clyraPort),
        CLYRA_EARTH_PORT: String(resolvedPort),
      },
    },
  );

  // Surface the child's output under a clear prefix rather than losing it.
  const relay = (stream, level) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) console[level](`[earth] ${line.trimEnd()}`);
      }
    });
  };
  relay(child.stdout, 'log');
  relay(child.stderr, 'warn');

  await waitForReady(resolvedPort, child);

  return {
    port: resolvedPort,
    mode: 'dev',
    close: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        // Don't let a wedged child hold up Clyra's shutdown.
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
          resolve();
        }, 4000).unref?.();
      }),
  };
}

/**
 * Serve a production build plus God's Eye View's provider middleware.
 *
 * Also a child process, for the same cwd reasons as dev: the providers resolve
 * their disk caches and bundled source roots against process.cwd().
 */
async function startStaticServer({ port, clyraPort }) {
  const resolvedPort = await freePort(port);
  const child = spawn(
    process.execPath,
    [path.join(here, 'earth-static-server.mjs')],
    {
      cwd: EARTH_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: String(clyraPort),
        CLYRA_EARTH_PORT: String(resolvedPort),
        CLYRA_EARTH_ROOT: EARTH_ROOT,
      },
    },
  );
  const relay = (stream, level) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line.trim()) console[level](`[earth] ${line.trimEnd()}`);
      }
    });
  };
  relay(child.stdout, 'log');
  relay(child.stderr, 'warn');

  await waitForReady(resolvedPort, child, 30_000);

  return {
    port: resolvedPort,
    mode: 'static',
    close: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
          resolve();
        }, 4000).unref?.();
      }),
  };
}

/**
 * Start the Clyra Earth host.
 *
 * Returns null when the vendored checkout is missing or its dependencies are
 * not installed, so a Clyra checkout without `vendor/gods-eye-view` still boots
 * — the workspace then renders its own "not installed" surface instead.
 */
export async function startEarthServer({
  port = Number(process.env.EARTH_PORT) || DEFAULT_EARTH_PORT,
  clyraPort = Number(process.env.PORT) || 3000,
  preferBuild = process.env.NODE_ENV === 'production',
} = {}) {
  if (!earthSourceAvailable()) {
    if (!earthBuildAvailable()) return null;
    return startStaticServer({ port, clyraPort });
  }
  if (preferBuild && earthBuildAvailable()) {
    return startStaticServer({ port, clyraPort });
  }
  return startDevServer({ port, clyraPort });
}
