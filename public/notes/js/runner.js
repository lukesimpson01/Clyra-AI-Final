/* Running a code block.
 *
 * Two surfaces, chosen by language:
 *
 *   • a terminal drawer that slides up from the bottom of the window and runs
 *     the snippet in a real shell over the same /api/terminal socket the chat's
 *     Run drawer and the Vibe Coder terminal use (lib/terminal-ws.ts);
 *   • a GUI panel that rises into the middle of the window for anything that
 *     draws itself — HTML, SVG, or an HTML/CSS/JS trio — carrying the Vibe
 *     Coder's preview chrome and its full-screen affordance.
 *
 * The language table mirrors src/lib/runnableLanguages.ts.  It is duplicated
 * rather than imported because Notes is served as plain ES modules with no
 * bundler and cannot reach into src/; the two are small, closed, and change
 * together.
 */

import { el, icon, iconButton, toast } from "./dom.js";

/* ------------------------------------------------------------ languages */

const RUNNERS = {
  python: { name: "Python", ext: "py", command: (p) => `python3 ${p}` },
  python3: { name: "Python", ext: "py", command: (p) => `python3 ${p}` },
  py: { name: "Python", ext: "py", command: (p) => `python3 ${p}` },
  javascript: { name: "JavaScript", ext: "js", command: (p) => `node ${p}` },
  js: { name: "JavaScript", ext: "js", command: (p) => `node ${p}` },
  mjs: { name: "JavaScript", ext: "mjs", command: (p) => `node ${p}` },
  typescript: { name: "TypeScript", ext: "ts", command: (p) => `npx --yes tsx ${p}` },
  ts: { name: "TypeScript", ext: "ts", command: (p) => `npx --yes tsx ${p}` },
  bash: { name: "Bash", ext: "sh", command: (p) => `bash ${p}` },
  sh: { name: "Shell", ext: "sh", command: (p) => `bash ${p}` },
  shell: { name: "Shell", ext: "sh", command: (p) => `bash ${p}` },
  zsh: { name: "Zsh", ext: "sh", command: (p) => `zsh ${p}` },
  ruby: { name: "Ruby", ext: "rb", command: (p) => `ruby ${p}` },
  rb: { name: "Ruby", ext: "rb", command: (p) => `ruby ${p}` },
  go: { name: "Go", ext: "go", command: (p) => `go run ${p}` },
  php: { name: "PHP", ext: "php", command: (p) => `php ${p}` },
  r: { name: "R", ext: "R", command: (p) => `Rscript ${p}` },
  sql: { name: "SQL", ext: "sql", command: (p) => `sqlite3 :memory: < ${p}` },
};

/** Languages that draw their own interface rather than printing to a stream. */
const PREVIEWABLE = new Set(["html", "svg", "css"]);

export const isRunnable = (language) => Boolean(RUNNERS[String(language || "").toLowerCase()]);
export const isPreviewable = (language) => PREVIEWABLE.has(String(language || "").toLowerCase());

/** True for any code block that has something to do beyond being read. */
export const isExecutable = (language) => isRunnable(language) || isPreviewable(language);

export const runnerLabel = (language) => {
  const key = String(language || "").toLowerCase();
  if (PREVIEWABLE.has(key)) return "Preview";
  return RUNNERS[key] ? `Run ${RUNNERS[key].name}` : "Run";
};

/**
 * Asks the server to write the snippet to a scratch file, and returns the one
 * short command that runs it.
 *
 * The write is deliberately NOT done through the terminal. A PTY echoes
 * everything sent to it, so piping the snippet in — as a heredoc, or as a
 * single base64 line — made the user watch their own code (or a screenful of
 * base64) scroll past before any output appeared. Writing server-side means
 * the drawer shows `python3 /tmp/clyra-notes-….py` and then the program's
 * output, which is what the person actually wants to read.
 */
async function buildRunCommand(language, code) {
  const info = RUNNERS[String(language).toLowerCase()];
  if (!info) return null;
  const response = await fetch("/api/notes/run-file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language, code }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Could not prepare the file");
  return `${info.command(payload.path)}\n`;
}

/* ------------------------------------------------------ lazy xterm load */

let xtermReady = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") return resolve();
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const node = document.createElement("script");
    node.src = src;
    node.addEventListener("load", () => { node.dataset.loaded = "1"; resolve(); }, { once: true });
    node.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.append(node);
  });
}

/* xterm is 280KB, and most notes never run anything — it loads on the first
   Run press and is reused for the rest of the session. */
function ensureXterm() {
  if (xtermReady) return xtermReady;
  xtermReady = (async () => {
    if (!document.querySelector('link[data-xterm]')) {
      const link = el("link", { rel: "stylesheet", href: "/notes/vendor/xterm.css" });
      link.dataset.xterm = "1";
      document.head.append(link);
    }
    await loadScript("/notes/vendor/xterm.js");
    await loadScript("/notes/vendor/addon-fit.js");
    if (!window.Terminal) throw new Error("Terminal failed to load.");
    return { Terminal: window.Terminal, FitAddon: window.FitAddon?.FitAddon };
  })().catch((error) => {
    // A failed load must not poison the module for the rest of the session.
    xtermReady = null;
    throw error;
  });
  return xtermReady;
}

/* The Vibe Coder terminal's palette, verbatim (see TerminalPanel.tsx): both
   shells are the same product surface and must not read as two different
   terminals. Light, because every other Clyra surface is. */
const TERM_THEME = {
  background: "#FFFFFF",
  foreground: "#282B2F",
  cursor: "#3977F6",
  cursorAccent: "#FFFFFF",
  selectionBackground: "rgba(57,119,246,0.16)",
  black: "#3F4347",
  red: "#C24949",
  green: "#268A50",
  yellow: "#B87918",
  blue: "#3977F6",
  magenta: "#9A5CC9",
  cyan: "#1F8A9A",
  white: "#B7B9BD",
  brightBlack: "#96989D",
  brightRed: "#E07B7B",
  brightGreen: "#4FAE74",
  brightYellow: "#D9A04C",
  brightBlue: "#7CA6F8",
  brightMagenta: "#BC8FDF",
  brightCyan: "#57B6C4",
  brightWhite: "#FFFFFF",
};

/* ------------------------------------------------------- terminal drawer */

/* One drawer for the whole app. Reopening it reuses the same shell and the
   same scrollback, exactly like the chat's Run drawer — so a second Run
   appends to the session rather than starting a fresh, empty terminal. */
const term = {
  root: null,
  mount: null,
  status: null,
  xterm: null,
  fit: null,
  socket: null,
  connecting: null,
  observer: null,
  height: 320,
};

function terminalStatus(text, tone = "idle") {
  if (!term.status) return;
  term.status.textContent = text;
  term.status.dataset.tone = tone;
}

function buildDrawer() {
  if (term.root) {
    term.root.removeAttribute("aria-hidden");
    requestAnimationFrame(() => term.root?.classList.add("open"));
    fitTerminal();
    return term.root;
  }
  term.mount = el("div", { class: "code-terminal-mount" });
  term.status = el("span", { class: "code-terminal-status" });
  /* Notes owns one shared run shell. Its header borrows Vibe Coder's panel
     spacing and palette, without implying that this page has terminal tabs
     or separate terminal sessions to manage. */
  term.root = el("section", {
    class: "code-terminal",
    role: "dialog",
    "aria-label": "Terminal",
    style: { height: `${term.height}px` },
  },
    el("div", { class: "code-terminal-resize", onpointerdown: startTerminalResize, "aria-hidden": "true" }),
    el("header", { class: "code-terminal-head" },
      el("span", { class: "code-terminal-title" },
        icon("terminal", 14),
        el("span", { text: "Terminal" }),
      ),
      term.status,
      iconButton("close", "Close terminal", closeTerminal, { size: 16, className: "code-terminal-close" }),
    ),
    term.mount,
  );
  document.body.append(term.root);
  // The drawer animates from its own translated state; a frame between insert
  // and class flip is what makes the transition run rather than snap.
  requestAnimationFrame(() => term.root.classList.add("open"));
  return term.root;
}

function startTerminalResize(event) {
  if (!term.root || event.button !== 0) return;
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = term.root.getBoundingClientRect().height;
  term.root.classList.add("resizing");
  const move = (moveEvent) => {
    const height = Math.min(520, Math.max(140, startHeight + startY - moveEvent.clientY));
    term.height = height;
    term.root.style.height = `${height}px`;
    fitTerminal();
  };
  const stop = () => {
    term.root?.classList.remove("resizing");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function fitTerminal() {
  if (!term.fit || !term.xterm) return;
  try {
    term.fit.fit();
    if (term.socket?.readyState === WebSocket.OPEN) {
      term.socket.send(JSON.stringify({ type: "resize", cols: term.xterm.cols, rows: term.xterm.rows }));
    }
  } catch { /* the drawer can be mid-transition and have no stable box yet */ }
}

async function connectTerminal() {
  if (term.socket?.readyState === WebSocket.OPEN) return;
  if (term.connecting) return term.connecting;
  term.connecting = (async () => {
    const { Terminal, FitAddon } = await ensureXterm();
    if (!term.xterm) {
      term.xterm = new Terminal({
        convertEol: false,
        cursorBlink: true,
        // Match the Vibe Coder's insertion cursor instead of xterm's block.
        cursorStyle: "bar",
        cursorWidth: 1,
        fontSize: 12.5,
        fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, monospace',
        theme: TERM_THEME,
        lineHeight: 1.4,
        scrollback: 10_000,
        allowProposedApi: true,
      });
      if (FitAddon) {
        term.fit = new FitAddon();
        term.xterm.loadAddon(term.fit);
      }
      term.xterm.open(term.mount);
      // xterm keeps its input element visually hidden, so focus the actual
      // terminal whenever its visible surface is clicked, like Vibe Coder.
      term.mount.addEventListener("pointerdown", () => term.xterm?.focus());
      term.xterm.onData((data) => {
        if (term.socket?.readyState === WebSocket.OPEN) {
          term.socket.send(JSON.stringify({ type: "input", data }));
        }
      });
      // The drawer is resizable and the window is not fixed; refit on both.
      term.observer = new ResizeObserver(() => fitTerminal());
      term.observer.observe(term.mount);
      window.addEventListener("resize", fitTerminal);
    }
    fitTerminal();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/api/terminal?projectId=notes&tabId=notes-run`,
    );
    term.socket = socket;
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(String(message.data));
        if (payload.type === "data" && payload.data) term.xterm.write(payload.data);
        if (payload.type === "exit") terminalStatus("Session ended", "idle");
      } catch { /* ignore malformed frames */ }
    };
    socket.onclose = () => {
      if (term.socket === socket) term.socket = null;
      terminalStatus("Disconnected", "error");
    };
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Terminal connection failed.")), { once: true });
    });
    fitTerminal();
  })().finally(() => { term.connecting = null; });
  return term.connecting;
}

export function closeTerminal() {
  if (!term.root) return;
  term.root.classList.remove("open");
  term.root.setAttribute("aria-hidden", "true");
  // Keep the one Notes shell alive while it is collapsed. Reopening resumes
  // its scrollback and working directory, exactly like Vibe Coder does, but
  // without exposing terminal-session tabs in Notes.
}

/** Opens the drawer (if needed) and runs one snippet in the shared shell. */
export async function runInTerminal(language, code) {
  if (!isRunnable(language)) {
    toast(`${language} cannot be run here`, "error");
    return;
  }
  buildDrawer();
  terminalStatus("Connecting…", "busy");
  let command;
  try {
    [command] = await Promise.all([buildRunCommand(language, code), connectTerminal()]);
  } catch (error) {
    terminalStatus(String(error?.message || "Terminal unavailable"), "error");
    return;
  }
  // The drawer can be closed while the request is in flight.
  if (!term.socket || term.socket.readyState !== WebSocket.OPEN) return;
  terminalStatus(`Running ${RUNNERS[String(language).toLowerCase()].name}`, "busy");
  term.socket.send(JSON.stringify({ type: "input", data: command }));
  term.xterm.focus();
  // The shell owns the run from here; the label settles rather than pretending
  // to track an exit code the socket does not report per command.
  window.setTimeout(() => terminalStatus("Connected", "ok"), 1200);
}

/* ----------------------------------------------------------- GUI preview */

const preview = {
  root: null, frame: null, escape: null, message: null, address: null,
  url: null, html: null, history: [], index: -1, updateNavigation: null,
};

const localPreviewPath = /^\/notes\/preview\//;

function previewAddressLabel(url) {
  const parsed = new URL(url, window.location.origin);
  // Local previews are part of Notes, so a compact Notes-relative label is
  // clearer than the development host and survives a production deployment.
  if (parsed.origin === window.location.origin && localPreviewPath.test(parsed.pathname)) {
    return `${parsed.pathname.slice(1)}${parsed.search}${parsed.hash}`;
  }
  return parsed.href.replace(/^https?:\/\//, "");
}

function previewDestination(value) {
  const query = String(value || "").trim();
  if (!query) return null;
  if (/^https?:\/\//i.test(query)) return new URL(query).href;
  if (/^localhost(?::\d+)?(?:[/?#].*)?$/i.test(query)) return new URL(`http://${query}`).href;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(query)) return new URL(`https://${query}`).href;
  if (/^(?:\/|\.\/|\.\.\/)/.test(query)) return new URL(query, window.location.origin).href;
  // An address bar should also be useful when the user starts with a search,
  // rather than requiring a separate search UI in a preview.
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function addPreviewLinkBridge(html, sourceUrl) {
  // srcdoc has an opaque origin, so links need this tiny bridge to update the
  // parent address bar/history. It only changes ordinary primary-click links.
  const bridge = `<script>document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank")return;var h=a.getAttribute("href");if(!h||/^(?:#|mailto:|tel:|javascript:)/i.test(h))return;e.preventDefault();parent.postMessage({type:"clyra-notes-preview-link",url:new URL(h,${JSON.stringify(sourceUrl)}).href},"*");},true);</script>`;
  return /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, `${bridge}</body>`) : `${html}${bridge}`;
}

export function closePreview() {
  if (!preview.root) return;
  preview.root.classList.remove("open");
  const root = preview.root;
  window.setTimeout(() => { if (!root.classList.contains("open")) root.remove(); }, 280);
  preview.root = null;
  preview.frame = null;
  preview.address = null;
  preview.url = null;
  preview.html = null;
  preview.history = [];
  preview.index = -1;
  preview.updateNavigation = null;
  if (preview.escape) {
    document.removeEventListener("keydown", preview.escape);
    preview.escape = null;
  }
  if (preview.message) {
    window.removeEventListener("message", preview.message);
    preview.message = null;
  }
}

/**
 * Raises a live preview into the middle of the window.
 *
 * The chrome is the Vibe Coder's preview panel: reload, a centred address
 * pill, open-externally and a full-screen toggle.  The address is real — the
 * snippet is posted to /api/notes/preview and served from /notes/preview/<id>
 * — so the pill names something Open externally genuinely opens.
 *
 * The frame itself renders that same document through `srcdoc`, under a
 * `sandbox` without `allow-same-origin`: the snippet's scripts run in an
 * opaque origin that cannot reach the workspace's storage or API. See the
 * route in lib/notes/routes.ts for why it is not simply navigated to.
 */
export async function openPreview(language, code, title = "Preview") {
  closePreview();

  const address = el("input", {
    class: "code-preview-address", type: "text", value: "Starting preview…",
    "aria-label": "Preview address or web search", autocomplete: "off", spellcheck: "false",
  });
  const frame = el("iframe", {
    class: "code-preview-frame",
    title,
    // Matches the response CSP; the frame attribute is the second lock.
    sandbox: "allow-scripts allow-forms allow-modals allow-popups",
  });
  preview.frame = frame;
  preview.address = address;

  const navButton = (name, label, onClick, disabled = false) =>
    iconButton(name, label, onClick, { size: 14, className: "code-preview-nav", disabled });

  const loadEntry = (entry) => {
    if (!entry || !preview.frame || !preview.address) return;
    preview.url = entry.url;
    preview.html = entry.html;
    preview.address.value = previewAddressLabel(entry.url);
    delete preview.address.dataset.error;
    if (entry.html !== null) {
      frame.removeAttribute("src");
      frame.srcdoc = entry.html;
    } else {
      frame.removeAttribute("srcdoc");
      frame.src = entry.url;
    }
    preview.updateNavigation?.();
  };
  const visit = (url, html = null) => {
    preview.history = preview.history.slice(0, preview.index + 1);
    preview.history.push({ url, html });
    preview.index = preview.history.length - 1;
    loadEntry(preview.history[preview.index]);
  };
  const back = navButton("arrow_left", "Go back", () => {
    if (preview.index > 0) { preview.index -= 1; loadEntry(preview.history[preview.index]); }
  }, true);
  const forward = navButton("arrow_right", "Go forward", () => {
    if (preview.index < preview.history.length - 1) { preview.index += 1; loadEntry(preview.history[preview.index]); }
  }, true);
  preview.updateNavigation = () => {
    back.disabled = preview.index <= 0;
    forward.disabled = preview.index >= preview.history.length - 1;
  };
  const reload = navButton("refresh", "Reload", () => {
    loadEntry(preview.history[preview.index]);
  });
  const external = navButton("share", "Open externally", () => {
    if (preview.url) window.open(preview.url, "_blank", "noopener");
  });
  const copyUrl = navButton("copy", "Copy preview URL", async () => {
    if (!preview.url) return;
    try { await navigator.clipboard.writeText(preview.url); toast("Preview URL copied"); }
    catch { toast("Could not copy the preview URL", "error"); }
  });

  address.addEventListener("focus", () => window.setTimeout(() => address.select(), 0));
  address.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const destination = previewDestination(address.value);
    if (destination) visit(destination);
    else if (preview.url) address.value = previewAddressLabel(preview.url);
  });

  const setFullscreen = (full) => {
    preview.root.classList.toggle("full", full);
    fullscreen.replaceChildren(icon(full ? "collapse" : "expand", 14));
    fullscreen.setAttribute("aria-label", full ? "Exit full screen" : "Full screen");
  };
  const fullscreen = navButton("expand", "Full screen", () => {
    setFullscreen(!preview.root.classList.contains("full"));
  });

  preview.root = el("div", { class: "code-preview-backdrop", onclick: (event) => {
    if (event.target === preview.root) closePreview();
  } },
    el("section", { class: "code-preview", role: "dialog", "aria-label": title, "aria-modal": "true" },
      el("header", { class: "code-preview-head" },
        back,
        forward,
        reload,
        el("span", { class: "code-preview-url" }, address),
        external,
        copyUrl,
        fullscreen,
        iconButton("close", "Close preview", closePreview, { size: 14, className: "code-preview-nav" }),
      ),
      frame,
    ),
  );
  document.body.append(preview.root);
  requestAnimationFrame(() => preview.root.classList.add("open"));

  preview.escape = (event) => {
    if (event.key !== "Escape") return;
    // Escape leaves full screen first, and only closes from the docked size.
    if (preview.root?.classList.contains("full")) { setFullscreen(false); return; }
    closePreview();
  };
  document.addEventListener("keydown", preview.escape);
  preview.message = (event) => {
    if (event.source !== frame.contentWindow || event.data?.type !== "clyra-notes-preview-link") return;
    const destination = previewDestination(event.data.url);
    if (destination) visit(destination);
  };
  window.addEventListener("message", preview.message);

  try {
    const response = await fetch("/api/notes/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language, code }),
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Preview failed");
    // The dialog can be closed while the request is in flight.
    if (!preview.root) return;
    const url = new URL(payload.url, window.location.origin).href;
    visit(url, addPreviewLinkBridge(payload.html, url));
  } catch (error) {
    if (!preview.root) return;
    address.value = String(error?.message || "Preview failed");
    address.dataset.error = "true";
  }
}

/** The single entry point a code block calls: picks the right surface. */
export function executeBlock(language, code, title) {
  if (isPreviewable(language)) return openPreview(language, code, title || `${language.toUpperCase()} preview`);
  return runInTerminal(language, code);
}
