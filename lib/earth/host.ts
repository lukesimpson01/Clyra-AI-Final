/**
 * Clyra Earth host lifecycle.
 *
 * Clyra Earth is the vendored God's Eye View application served on its own
 * loopback port (see tools/earth-server.mjs for why it is a separate document
 * rather than a route inside Clyra's own Vite app). This module owns starting
 * it lazily — the workspace is heavy, so it boots on first use rather than on
 * every Clyra launch — and reporting its address to the renderer.
 */

export interface EarthHostStatus {
  /** True once the document is being served and can be framed. */
  ok: boolean;
  /** Loopback URL the renderer should frame, when running. */
  url: string | null;
  /** "dev" runs God's Eye View's Vite server; "static" serves its build. */
  mode: "dev" | "static" | null;
  /** Why the host is unavailable, when it is. */
  reason?: string;
}

interface EarthServerHandle {
  port: number;
  mode: "dev" | "static";
  close: () => void | Promise<void>;
}

let handle: EarthServerHandle | null = null;
let starting: Promise<EarthServerHandle | null> | null = null;
let lastFailure: string | null = null;

function earthModule() {
  // Resolve from Clyra's resource root rather than this module. In a bundled
  // production server this module lives in dist/, so a relative dynamic import
  // incorrectly looked two directories above the installed application.
  return import(pathToFileURL(clyraResourcePath("tools", "earth-server.mjs")).href);
}

/** Start the Clyra Earth host if it is not already running. */
export async function ensureEarthHost(): Promise<EarthHostStatus> {
  if (handle) {
    return { ok: true, url: `http://127.0.0.1:${handle.port}`, mode: handle.mode };
  }
  if (!starting) {
    starting = (async () => {
      const { startEarthServer } = await earthModule();
      return (await startEarthServer({
        clyraPort: Number(process.env.PORT) || 3000,
        // The bundled production document starts in milliseconds; a cold Vite
        // development server has to transform hundreds of Cesium modules on
        // the first Earth visit and leaves people staring at a loader. Keep a
        // source-server escape hatch for Earth development, but make the
        // product path use the already-built host whenever it exists.
        preferBuild: process.env.CLYRA_EARTH_DEV_SERVER !== "1",
      })) as EarthServerHandle | null;
    })().catch((error: unknown) => {
      lastFailure = error instanceof Error ? error.message : String(error);
      console.error("[earth] host failed to start:", lastFailure);
      return null;
    });
  }

  const started = await starting;
  starting = null;
  if (!started) {
    return {
      ok: false,
      url: null,
      mode: null,
      reason:
        lastFailure ??
        "Clyra Earth is not installed. Run `npm run earth:setup` to fetch and build it.",
    };
  }

  handle = started;
  console.log(`[earth] Clyra Earth (${started.mode}) on http://127.0.0.1:${started.port}`);
  return { ok: true, url: `http://127.0.0.1:${started.port}`, mode: started.mode };
}

/** Report the host's address without starting it. */
export function earthHostStatus(): EarthHostStatus {
  if (handle) {
    return { ok: true, url: `http://127.0.0.1:${handle.port}`, mode: handle.mode };
  }
  return { ok: false, url: null, mode: null, reason: lastFailure ?? "not started" };
}

/** Stop the Clyra Earth host as part of Clyra's shutdown sequence. */
export async function stopEarthHost(): Promise<void> {
  const current = handle;
  handle = null;
  if (!current) return;
  try {
    await current.close();
  } catch {
    /* best effort — the process is going away anyway */
  }
}
import { pathToFileURL } from "node:url";
import { clyraResourcePath } from "../runtime-paths";
