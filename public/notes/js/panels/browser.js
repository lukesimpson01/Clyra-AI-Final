/* The browser panel.

   Pages are fetched through /api/notes/browse rather than framed directly:
   most of the web refuses to be embedded, and the proxy is what makes the
   panel able to show anything. Scripts are stripped server-side, so this is a
   reader — links and history work, web apps do not.

   The tab strip is the workspace's own tab strip, scaled down: same shape,
   same open and close travel, same close affordance. */
import { el, clear, icon, iconButton, append, toast } from "../dom.js";

const TABS_KEY = "clyra-notes:browser-tabs";
const HOME = "https://en.wikipedia.org/wiki/Special:Random";

const START_LINKS = [
  { label: "Wikipedia", url: "https://en.wikipedia.org" },
  { label: "BBC Bitesize", url: "https://www.bbc.co.uk/bitesize" },
  { label: "Khan Academy", url: "https://www.khanacademy.org" },
  { label: "arXiv", url: "https://arxiv.org" },
  { label: "Britannica", url: "https://www.britannica.com" },
];

const proxied = (url) => `/api/notes/browse?url=${encodeURIComponent(url)}`;

const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url || "New tab"; }
};

const readTabs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) || "[]");
    return Array.isArray(saved) && saved.length ? saved : null;
  } catch { return null; }
};

export function browserPanel(app) {
  /* Each tab owns its own history stack, so Back in one tab cannot walk
     into a page that was opened in another. */
  let tabs = readTabs() || [{ id: `b${Date.now()}`, url: "", history: [], future: [] }];
  let activeId = tabs[0].id;

  const strip = el("div", { class: "wb-tabs" });
  const address = el("input", {
    class: "wb-address", type: "text", spellcheck: "false", autocomplete: "off",
    placeholder: "Search the web or enter an address", "aria-label": "Address and search",
  });
  /* Deliberately not sandboxed: the frame has to stay same-origin so the
     panel can read where a link took it. What makes that safe is the
     response's own policy — the proxy serves every page with script-src
     'none' — rather than an attribute here. */
  const frame = el("iframe", { class: "wb-frame", title: "Web page", referrerpolicy: "no-referrer" });
  const start = el("div", { class: "wb-start" });
  const status = el("div", { class: "wb-status" });

  const active = () => tabs.find((tab) => tab.id === activeId) || tabs[0];

  const persist = () => {
    try {
      localStorage.setItem(TABS_KEY, JSON.stringify(tabs.map((tab) => ({
        id: tab.id, url: tab.url, title: tab.title || "", history: tab.history.slice(-20), future: tab.future.slice(-20),
      }))));
    } catch { /* storage may be unavailable */ }
  };

  const paintStart = () => {
    clear(start);
    append(start,
      el("div", { class: "wb-start-mark" }, icon("embed", 22)),
      el("h3", { class: "wb-start-title", text: "Look something up" }),
      el("p", { class: "wb-start-copy", text: "Search the web or type an address to read a page beside your notes. Results open right here." }),
      el("form", { class: "wb-start-search", onsubmit: (event) => { event.preventDefault(); const field = event.currentTarget.querySelector("input"); if (field.value.trim()) go(field.value); } },
        icon("search", 15),
        el("input", { class: "wb-start-input", type: "search", placeholder: "Search the web or enter an address", "aria-label": "Search the web or enter an address" })),
      el("div", { class: "wb-start-links" }, START_LINKS.map((link) =>
        el("button", { class: "vc-button", type: "button", onclick: () => go(link.url) },
          el("span", { class: "vc-icon" }, icon("bookmark", 14)),
          el("span", { class: "vc-label", text: link.label })))));
  };

  const paintStrip = () => {
    clear(strip);
    for (const tab of tabs) {
      const isActive = tab.id === activeId;
      const node = el("div", {
        class: `wb-tab${isActive ? " active" : ""}`,
        onclick: () => { activeId = tab.id; paint(); },
      },
        el("span", { class: "wb-tab-icon" }, icon(tab.url ? "embed" : "plus", 12)),
        el("span", { class: "wb-tab-label", text: tab.url ? (tab.title || hostOf(tab.url)) : "New tab" }),
        tabs.length > 1
          ? el("button", {
              class: "wb-tab-close", type: "button", "aria-label": "Close tab",
              onclick: (event) => { event.stopPropagation(); closeTab(tab.id); },
            }, icon("close", 10))
          : null);
      strip.append(node);
      /* Settled on the next frame so the tab animates in from nothing,
         exactly like the workspace strip above it. */
      requestAnimationFrame(() => node.classList.add("settled"));
    }
    strip.append(iconButton("plus", "New tab", () => {
      tabs.push({ id: `b${Date.now()}`, url: "", history: [], future: [] });
      activeId = tabs[tabs.length - 1].id;
      persist();
      paint();
    }, { size: 13, className: "wb-tab-new" }));
  };

  const closeTab = (id) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0 || tabs.length === 1) return;
    const node = strip.children[index];
    if (node) node.classList.add("closing");
    tabs.splice(index, 1);
    if (activeId === id) activeId = tabs[Math.max(0, index - 1)].id;
    persist();
    setTimeout(paint, 160);
  };

  const setStatus = (message, kind = "") => {
    clear(status);
    status.className = `wb-status${kind ? ` ${kind}` : ""}`;
    if (!message) return;
    append(status, el("span", { text: message }),
      kind === "error" && active().url
        ? el("button", { class: "text-button", type: "button", onclick: () => window.open(active().url, "_blank", "noopener") },
            icon("share", 12), "Open in a browser")
        : null);
  };

  /* Google, matching the rest of Clyra. Same rule as the desktop resolver:
     whitespace means search before any domain matching is attempted. */
  /* DuckDuckGo's HTML results are server-rendered, so this panel's reader can actually show them (Google's are a script-only app). */
  const searchUrl = (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query).trim())}`;

  const toUrl = (value) => {
    if (/^https?:\/\//i.test(value)) return value;
    if (/\s/.test(value)) return searchUrl(value);
    if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `http://${value}`;
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:[/?#].*)?$/.test(value)) return `http://${value}`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return searchUrl(value);
    if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(value)) return `https://${value}`;
    return searchUrl(value);
  };

  const isSearch = (url) => /^https:\/\/(?:www\.google\.com\/search|html\.duckduckgo\.com\/html\/)\?/.test(url);

  /* A Google results page is a JavaScript application, and this panel is a
     reader that strips scripts — Google serves it nothing but an "enable
     JavaScript" stub, and there is no server-rendered Google to fall back to.
     So a search is handed to the real Chromium view in the desktop app, and
     in the browser-only build it opens a real window. Reading a page you
     navigate to directly still happens here, in the panel. */
  const go = (raw, { record = true } = {}) => {
    const tab = active();
    const value = String(raw || "").trim();
    if (!value) return;
    const url = toUrl(value);

    /* With the real Chromium view hosted in the panel, everything — searches
       included — goes there, because it can actually render Google. */
    if (window.clyraDesktop?.browser?.setSurface) {
      tab.url = url;
      address.value = url;
      address.blur();
      persist();
      paintStrip();
      showPage();
      setLoading(true);
      window.clyraDesktop.browser.navigate(url);
      return;
    }

    /* Web build: the reader cannot render a Google results page, and there is
       no server-rendered Google to fall back to, so a search opens a real
       window rather than silently going somewhere else. */
    if (record && tab.url) { tab.history.push(tab.url); tab.future.length = 0; }
    tab.url = url;
    persist();
    paint();
  };

  const back = () => {
    if (useNative()) { desktopBrowser().action({ type: "back" }); return; }
    const tab = active();
    if (!tab.history.length) return;
    tab.future.push(tab.url);
    tab.url = tab.history.pop();
    persist();
    paint();
  };

  const forward = () => {
    if (useNative()) { desktopBrowser().action({ type: "forward" }); return; }
    const tab = active();
    if (!tab.future.length) return;
    tab.history.push(tab.url);
    tab.url = tab.future.pop();
    persist();
    paint();
  };

  const bar = el("div", { class: "wb-bar" },
    iconButton("arrow_left", "Back", back, { size: 14, className: "wb-nav" }),
    iconButton("arrow_right", "Forward", forward, { size: 14, className: "wb-nav" }),
    iconButton("history", "Reload", () => { if (useNative()) { setLoading(true); desktopBrowser().action({ type: "reload" }); } else paint(); }, { size: 14, className: "wb-nav" }),
    address,
    iconButton("share", "Open in the full browser", () => {
      const tab = active();
      if (!tab.url) return;
      /* Inside the desktop app the real Chromium view can show anything this
         reader cannot — Google, signed-in pages, anything that needs JS. */
      const desktop = window.clyraDesktop?.browser;
      if (desktop?.navigate) { desktop.navigate(tab.url); toast("Opened in Clyra Browser"); return; }
      window.open(tab.url, "_blank", "noopener");
    }, { size: 14, className: "wb-nav" }),
    iconButton("plus", "Save this page as a note", async () => {
      const tab = active();
      if (!tab.url) { toast("Open a page first", "error"); return; }
      const created = await app.createBookmarkNote?.(tab.url, hostOf(tab.url));
      if (created) toast("Saved as a note");
    }, { size: 14, className: "wb-nav" }),
  );

  /* Only text the user is typing holds the address back from following the page. */
  let addressDirty = false;
  address.addEventListener("input", () => { addressDirty = true; });
  address.addEventListener("blur", () => { if (addressDirty && !address.value.trim()) addressDirty = false; });
  address.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addressDirty = false; go(address.value); }
    if (event.key === "Escape") { addressDirty = false; address.value = active().url; address.blur(); }
  });

  /* The real Chromium view's own history drives Back/Forward in the desktop app. */
  let nativeNav = { canGoBack: false, canGoForward: false };
  const syncNav = () => {
    const tab = active();
    const native = useNative();
    bar.querySelectorAll(".wb-nav")[0].disabled = native ? !nativeNav.canGoBack : !tab.history.length;
    bar.querySelectorAll(".wb-nav")[1].disabled = native ? !nativeNav.canGoForward : !tab.future.length;
  };

  /* A hairline that eases across the top of the page while it loads, instead of a status message. */
  const loadLine = el("div", { class: "wb-load", "aria-hidden": "true" });
  const setLoading = (loading) => { loadLine.classList.toggle("on", Boolean(loading)); };

  const showPage = () => {
    const tab = active();
    start.hidden = Boolean(tab.url);
    if (useNative()) {
      frame.hidden = true;
      if (tab.url) {
        showNative();
        /* Seed Back/Forward and the address from the view itself; events only arrive when it changes. */
        desktopBrowser().getState?.().then((result) => applyNativeState(result)).catch(() => {});
      } else { hideNative(); paintStart(); }
    }
  };

  const paint = () => {
    const tab = active();
    paintStrip();
    address.value = tab.url;
    syncNav();
    start.hidden = Boolean(tab.url);
    if (useNative()) {
      /* Desktop: the page lives in the real browser view; the reading proxy is never loaded as well. */
      frame.hidden = true;
      setStatus("");
      showPage();
      if (tab.url && tab.url !== lastNativeUrl) { setLoading(true); desktopBrowser().navigate(tab.url); }
      return;
    }
    frame.hidden = !tab.url;
    if (!tab.url) { setStatus(""); paintStart(); return; }
    setLoading(true);
    frame.src = proxied(tab.url);
  };

  /* Links are rewritten by the proxy to point back at it, so a click
     navigates the frame itself. The address bar and the history stack catch
     up here, by reading where the frame actually ended up. */
  let syncing = false;
  frame.addEventListener("load", () => {
    const tab = active();
    if (!tab.url) return;
    setStatus("");
    setLoading(false);
    let landed = null;
    try {
      const here = new URL(frame.contentWindow.location.href);
      landed = here.pathname === "/api/notes/browse" ? here.searchParams.get("url") : null;
    } catch { landed = null; }
    if (!landed || landed === tab.url || syncing) return;
    syncing = true;
    tab.history.push(tab.url);
    tab.future.length = 0;
    tab.url = landed;
    address.value = landed;
    persist();
    paintStrip();
    syncNav();
    syncing = false;
  });
  frame.addEventListener("error", () => { setLoading(false); setStatus("That page could not be opened here.", "error"); });

  /* ------------------------------------------------- native surface */

  /* Inside the desktop app the panel hosts the real Chromium view rather
     than the reading proxy, so Google and any signed-in page work exactly as
     they do in a browser. The native view is a layer over the window, not a
     DOM node — it has no idea the rail exists — so its bounds are driven from
     this element's rect, and it MUST be hidden whenever the panel is not on
     screen or it paints straight over the workspace. */
  const nativeHost = el("div", { class: "wb-native" });
  const desktopBrowser = () => window.clyraDesktop?.browser || null;
  const useNative = () => Boolean(desktopBrowser()?.setSurface);

  let nativeShown = false;
  let boundsFrame = 0;

  const pushBounds = () => {
    const api = desktopBrowser();
    if (!api?.setSurface || !nativeShown) return;
    const rect = nativeHost.getBoundingClientRect();
    /* A zero rect means the panel has not been laid out yet — during the
       rail's open transition, for instance. Retrying is right; hiding is
       not, because the element is display:none while hidden and so could
       never measure itself back into existence. */
    if (rect.width < 8 || rect.height < 8) { queueBounds(); return; }
    api.setSurface({
      visible: true,
      bounds: {
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
    });
  };

  /* A timer rather than requestAnimationFrame: this view is not always
     compositing — the native browser layer sits on top of it — and a
     throttled rAF simply never fires, which left the layer unpositioned.
     Reading getBoundingClientRect forces layout anyway, so a frame buys
     nothing here. */
  const queueBounds = () => {
    if (boundsFrame) clearTimeout(boundsFrame);
    boundsFrame = setTimeout(() => { boundsFrame = 0; pushBounds(); }, 0);
  };

  const showNative = () => {
    if (!useNative()) return;
    nativeShown = true;
    node.classList.add("native");
    queueBounds();
  };

  const hideNative = () => {
    if (!nativeShown) return;
    nativeShown = false;
    node.classList.remove("native");
    desktopBrowser()?.setSurface?.({ visible: false });
  };

  /* The rail can be resized and the window can be resized; both move the
     panel, and the native layer has to follow or it detaches from the rail. */
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(queueBounds) : null;
  observer?.observe(nativeHost);
  window.addEventListener("resize", queueBounds);
  /* Leaving the page entirely (Notes is its own document) must not leave a
     native browser layer painted over whatever comes next. */
  window.addEventListener("pagehide", hideNative);

  /* Follow the real view: clicking links inside the page updates the address, the tab's title and Back/Forward. */
  let lastNativeUrl = "";
  const applyNativeState = (payload) => {
    const state = payload?.state || payload;
    if (!state || !nativeShown) return;
    nativeNav = { canGoBack: Boolean(state.canGoBack), canGoForward: Boolean(state.canGoForward) };
    setLoading(Boolean(state.loading));
    if (state.url && /^https?:/i.test(state.url)) {
      lastNativeUrl = state.url;
      const tab = active();
      if (tab.url !== state.url || tab.title !== state.title) {
        tab.url = state.url;
        tab.title = state.title || "";
        if (!addressDirty) address.value = state.url;
        persist();
        paintStrip();
      }
    }
    syncNav();
  };
  const offState = desktopBrowser()?.onState?.(applyNativeState);

  const node = el("div", { class: "wb-panel" }, strip, bar,
    el("div", { class: "wb-body" }, loadLine, frame, start, nativeHost), status);
  paint();

  return {
    node,
    focus: () => address.focus(),
    open: (url) => go(url),
    /* Called by the rail when this panel becomes the visible one. */
    show: () => { if (useNative()) { showPage(); paint(); } },
    /* Called by the rail on panel switch, on close, and on teardown. */
    hide: hideNative,
    destroy() {
      hideNative();
      if (boundsFrame) clearTimeout(boundsFrame);
      observer?.disconnect();
      window.removeEventListener("resize", queueBounds);
      window.removeEventListener("pagehide", hideNative);
      offState?.();
    },
    usesNative: useNative,
  };
}
