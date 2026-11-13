/* A live picture of any page: the page is rendered by the real PageView out
   of sight, and the markup it produces is kept (and refreshed whenever the page
   changes), so a grid of files shows what is actually in each one. Renders are
   queued three at a time so a large workspace never stalls the interface. */
import { el } from "./dom.js";
import { frozenHtml } from "./dom.js";
import { PageView } from "./page-view.js";

const cache = new Map();
const waiting = [];
let running = 0;

const drain = (app) => {
  while (running < 3 && waiting.length) {
    const job = waiting.shift();
    running += 1;
    render(app, job.id).then(job.resolve, () => job.resolve(null)).finally(() => { running -= 1; drain(app); });
  }
};

async function render(app, id) {
  const host = el("div", { class: "tab-preview-render-host", "aria-hidden": "true" });
  document.body.append(host);
  const view = new PageView(host, id, app, 0);
  try {
    return await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        const scroll = host.querySelector(".page-scroll");
        if (scroll?.querySelector(".page-canvas")) { requestAnimationFrame(() => resolve(frozenHtml(scroll))); return; }
        if (performance.now() - started > 3000) { reject(new Error("timeout")); return; }
        requestAnimationFrame(poll);
      };
      poll();
    });
  } finally { view.destroy?.(); host.remove(); }
}

/* The cache key includes the page's last edit, so a changed page is rendered again. */
export function pagePreview(app, page) {
  const key = `${page.id}:${page.updated_at || ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = new Promise((resolve) => { waiting.push({ id: String(page.id), resolve }); drain(app); });
  for (const stale of cache.keys()) if (stale.startsWith(`${page.id}:`)) cache.delete(stale);
  cache.set(key, promise);
  return promise;
}
