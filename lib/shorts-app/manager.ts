// Runs the Shorts app (apps/shorts/app: its home, its tools, its advanced editor in apps/shorts/openfilm) for Clyra's
// Shorts workspace (src/shorts/ShortsApp.tsx). The app is its own Vite server with its own API (server/localApi.js);
// Clyra starts it the first time Shorts opens and stops it when Clyra stops. Its AI clipper generates with Clyra's
// clipper backend (/api/clipper/*): the app's server passes those requests on to Clyra (CLYRA_SERVER).
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

/* the editor's Tools tab embeds the Shorts tools from this origin (openfilm's frame/FrameRail SHORTS_HOME) */
const PORT = Number(process.env.SHORTS_APP_PORT) || 4173;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP_DIR = path.join(process.cwd(), "apps", "shorts", "app");

let child: ChildProcess | null = null;
/* the app's server calls Clyra's clipper with this bearer (one per launch), as the Clyra Editor calls with its own */
const BRIDGE_TOKEN = crypto.randomBytes(24).toString("hex");
type Req = { path: string; headers: Record<string, unknown> };
/** A request from the Shorts app's server to Clyra (its bearer, its routes only): the clipper, and Clyra's chat model
 *  for the editor's AI (apps/shorts/app/server/localApi.js `/api/editor-ai/chat`). */
export function isShortsBridgeRequest(req: Req): boolean {
  if (!req.path.startsWith("/api/clipper/") && req.path !== "/api/deepseek/chat" && req.path !== "/api/shorts-app/vision") return false;
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length === BRIDGE_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(BRIDGE_TOKEN));
}
let starting: Promise<string> | null = null;
let stopping=false,restart:ReturnType<typeof setTimeout>|null=null,retryMs=1000;

async function answers(): Promise<boolean> {
  try {
    const res = await fetch(`${ORIGIN}/api/advanced/projects`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

/** The Shorts app's address, once it answers; started if it is not running. */
export function startShortsApp(clyraPort: number): Promise<string> {
  stopping=false;
  if (starting) return starting;
  starting = (async () => {
    if (await answers()) return ORIGIN;
    const vite = path.join(APP_DIR, "node_modules", "vite", "bin", "vite.js");
    if (!existsSync(vite)) throw new Error("The Shorts app is not installed: run `npm run shorts:setup` in Clyra's folder.");
    child = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
      cwd: APP_DIR,
      env: { ...process.env, CLYRA_SERVER: `http://127.0.0.1:${clyraPort}`, CLYRA_BRIDGE_TOKEN: BRIDGE_TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let said = "";
    child.stdout?.on("data", (d) => { said = (said + d.toString()).slice(-4000); });
    child.stderr?.on("data", (d) => { said = (said + d.toString()).slice(-4000); });
    child.once("exit", () => { child = null; starting = null;if(!stopping){if(restart)clearTimeout(restart);restart=setTimeout(()=>{restart=null;void startShortsApp(clyraPort).catch(()=>{});},retryMs);restart.unref();retryMs=Math.min(15000,retryMs*2);} });
    for (const end = Date.now() + 60_000; Date.now() < end; await new Promise((r) => setTimeout(r, 400))) {
      if (!child) throw new Error(`The Shorts app stopped while starting: ${said.trim().split("\n").at(-1) ?? ""}`);
      if (await answers()){retryMs=1000;return ORIGIN;}
    }
    throw new Error("The Shorts app did not start within a minute.");
  })().finally(() => { starting = null; });
  return starting;
}

export function stopShortsApp() {
  stopping=true;if(restart)clearTimeout(restart);restart=null;
  child?.kill("SIGTERM");
  child = null;
  starting = null;
}

for (const signal of ["SIGINT", "SIGTERM", "exit"] as const) process.once(signal, stopShortsApp);
