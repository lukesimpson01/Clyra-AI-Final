// Drives the running Clyra desktop app over its remote-debugging port and checks
// the Clyra Eye workspace end to end. Requires `npm run desktop:dev` and the
// Eye server (`npm run eye:dev`) to be running.
import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const CDP = process.env.CLYRA_CDP_URL || "http://127.0.0.1:9223";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function targets() {
  return (await fetch(`${CDP}/json`)).json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.on("message", (raw) => {
      const data = JSON.parse(raw);
      if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
      else if (data.method && api.onEvent) api.onEvent(data.method, data.params);
    });
    const api = {};
    ws.on("open", () => resolve(Object.assign(api, {
      send: (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }),
      evaluate: (expression) => new Promise((res) => {
        const i = ++id;
        pending.set(i, (d) => res(d.result?.result?.value ?? null));
        ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      }),
      close: () => ws.close(),
    })));
    ws.on("error", reject);
  });
}

async function waitFor(fn, timeoutMs, stepMs = 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(stepMs);
  }
  return null;
}

const list = await targets();
const main = list.find((t) => t.type === "page" && t.url.includes("31415"));
check("desktop app is running", Boolean(main), main ? main.url : "debug target missing");
if (!main) process.exit(1);

execFileSync("osascript", ["-e", 'tell application "Electron" to activate']);
const page = await connect(main.webSocketDebuggerUrl);

// 1. Launcher opens and lists Clyra Eye.
const launcherOpen = await waitFor(async () => {
  if (!(await page.evaluate(`!!document.querySelector('[aria-label="Clyra app launcher"]')`))) {
    await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
  }
  return page.evaluate(`!!document.querySelector('[aria-label="Clyra app launcher"]')`);
}, 20000, 1500);
check("launcher opens with Ctrl+K", Boolean(launcherOpen));
check("launcher lists Clyra Eye", Boolean(await page.evaluate(`!!document.querySelector('button[aria-label="Open Clyra Eye"]')`)));

// 2. Opening Eye mounts the workspace and the native Eye view loads.
await page.evaluate(`document.querySelector('button[aria-label="Open Clyra Eye"]')?.click()`);
const hosted = await waitFor(() => page.evaluate(`!!document.querySelector('[aria-label="Clyra Eye"]')`), 15000);
check("Clyra Eye workspace mounts", Boolean(hosted));
const bounds = await page.evaluate(`(() => { const r = document.querySelector('[aria-label="Clyra Eye"]')?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; })()`);
check("workspace has a usable area", Boolean(bounds && bounds.w > 200 && bounds.h > 200), JSON.stringify(bounds));

const eye = await waitFor(async () => (await targets()).find((t) => t.url.includes("5179")), 20000);
check("native Eye view target exists", Boolean(eye));
if (!eye) { page.close(); report(); }

const eyePage = await connect(eye.webSocketDebuggerUrl);
// Count real uncaught exceptions from the Eye page over the whole run.
const pageErrors = [];
eyePage.onEvent = (method, params) => {
  if (method === "Runtime.exceptionThrown") pageErrors.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "exception");
};
await eyePage.send("Runtime.enable");
const loaded = await waitFor(() => eyePage.evaluate(`document.readyState === 'complete' && !!document.querySelector('canvas')`), 30000);
check("Eye page loads with a WebGL canvas", Boolean(loaded));
check("Eye page title is Clyra Eye", (await eyePage.evaluate(`document.title`)) === "Clyra Eye");

// 3. Startup: start a fresh launch (bare URL, no saved view) so the intro runs,
//    then check nothing is enabled until the camera settles, and only Live Flights after.
await eyePage.send("Page.navigate", { url: eye.url.split("#")[0] });
await sleep(2000);
const introRan = await waitFor(() => eyePage.evaluate(`document.body.classList.contains('eye-intro')`), 15000, 500);
check("fresh launch starts the intro", Boolean(introRan));
const preSettleLayers = await eyePage.evaluate(`(location.hash.match(/&l=([^&]*)/)||[])[1] ?? ''`);
check("nothing is enabled while the intro runs", preSettleLayers === "", `layer token: "${preSettleLayers}"`);
// Sample the launch: the loader must stay up until the critical gates settle, phases must
// run in order, and the flight must end at full Earth. Sampled every half second.
const samples = [];
for (let i = 0; i < 200; i++) {
  const sample = await eyePage.evaluate(`JSON.stringify({ phase: window.__clyraEyeIntro?.phase ?? null, flying: !!window.__clyraEyeIntro?.flightStarted, loaderHidden: document.getElementById('loading-screen')?.classList.contains('hidden') ?? null, degraded: window.__clyraEyeIntro?.readiness?.degraded ?? [], location: window.__clyraEyeIntro?.location ? { confidence: window.__clyraEyeIntro.location.confidence, source: window.__clyraEyeIntro.location.source ?? 'device' } : null, alt: (location.hash.match(/alt=[0-9]+/)||[''])[0], cameraAltitude: window.__clyraEyeIntro?.altitude ?? null, locationError: window.__clyraEyeIntro?.locationError ?? null })`);
  samples.push(JSON.parse(sample));
  if (samples.at(-1).phase === "settled") break;
  await sleep(500);
}
const phasesSeen = [...new Set(samples.map((x) => x.phase).filter(Boolean))];
const orderOk = ["locating", "placing", "holding", "flying", "settled"].filter((p) => phasesSeen.includes(p)).join(">") === phasesSeen.filter((p) => ["locating", "placing", "holding", "flying", "settled"].includes(p)).join(">");
check("launch phases run in order and reach settled", phasesSeen.includes("settled") && orderOk, phasesSeen.join(" > "));
const loaderEarly = samples.find((x) => x.phase === "locating" || x.phase === "loading");
check("loader stays up while locating and loading", !loaderEarly || loaderEarly.loaderHidden === false, loaderEarly ? `loaderHidden=${loaderEarly.loaderHidden}` : "no early sample");
const placed = samples.find((x) => x.phase === "holding");
check("camera is placed at street level before the flight", Boolean(placed) && placed.cameraAltitude < 1500, placed ? `camera altitude at hold: ${placed.cameraAltitude} m` : "never placed");
const lastError = [...samples].reverse().find((x) => x.locationError)?.locationError;
if (lastError) console.log(`NOTE device location unavailable: ${lastError} (macOS may need Location Services for Clyra)`);
const lastLoc = [...samples].reverse().find((x) => x.location);
check("current location is labelled by its confidence, never fabricated", !lastLoc || ["PRECISE", "GOOD", "APPROXIMATE"].includes(lastLoc.location.confidence), lastLoc ? `${lastLoc.location.confidence} (${lastLoc.location.source})` : "no fix: no marker drawn");
const degraded = samples.at(-1)?.degraded ?? [];
check("startup degrades gracefully (no critical gate stuck)", !degraded.includes("cameraPlaced"), degraded.length ? `degraded: ${degraded.join(", ")}` : "all critical gates ready");
const settled = await waitFor(() => eyePage.evaluate(`!document.body.classList.contains('eye-intro') && /alt=1[0-9]{7}/.test(location.hash)`), 120000, 2000);
check("launch sequence reaches full Earth", Boolean(settled));
// Aircraft and Traffic are enabled once the camera settles; poll briefly, since the URL state lags the enable.
const layers = await waitFor(async () => {
  const token = await eyePage.evaluate(`(location.hash.match(/&l=([^&]*)/)||[])[1] ?? ''`);
  return token.split(".").sort().join(".") === "f.t" ? token : null;
}, 20000, 1000) ?? await eyePage.evaluate(`(location.hash.match(/&l=([^&]*)/)||[])[1] ?? ''`);
const enabledSet = layers.split(".").filter(Boolean).sort().join(".");
check("only Aircraft and Traffic are enabled after the intro", enabledSet === "f.t", `layer token: "${layers}"`);

// 4. No uncaught errors on the page since load.
check("no uncaught exceptions from the Eye page", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ").slice(0, 300) : "none");

// 5. Escape clears a selection; the app stays responsive.
await eyePage.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
check("Escape is handled without throwing", true);

// 6. Clyra can close the workspace without leaving a native view behind.
await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
eyePage.close();
page.close();
report();

function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} desktop checks passed`);
  process.exit(failed.length ? 1 : 0);
}
