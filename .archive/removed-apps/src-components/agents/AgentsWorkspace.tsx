/**
 * Clyra Agents — Rakazo (https://github.com/elie222/rakazo, Apache-2.0) running locally, presented in a Grok-style
 * skin. Electron owns the stack (electron/agents/agents-manager.mjs): this view starts it, shows honest progress while
 * the engine boots or the images download, then embeds Rakazo's own web app in a native view with the theme layer
 * below. Rakazo's model calls go through Clyra's relay, so agents run on the same model as the rest of Clyra.
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ElectronWebContentsSurface } from "../ElectronWebContentsSurface";
import { getElectronDesktop, isElectronRuntime, type AgentsStackState } from "../../lib/electron-runtime";

/** Grok-style theme over Rakazo's semantic tokens: pure surfaces, ink pills, hairline borders, a raised capsule
 *  composer and San Francisco type. Both of Rakazo's themes are covered so it follows the system appearance. */
const GROK_THEME_SOURCE = `
/* Clyra's mark in place of the original logo: the eyed orb, in Clyra blue. */
.rounded-full.bg-accent:has(> span.bg-card + span.bg-card:last-child) {
  background: radial-gradient(120% 120% at 30% 20%, #7aa7ff 0%, #3a78f2 45%, #2357d6 100%) !important;
  box-shadow: 0 10px 28px rgba(46, 104, 230, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.35);
}
.rounded-full.bg-accent:has(> span.bg-card + span.bg-card:last-child) > span { background: #ffffff !important; }

:root, [data-theme="dark"] {
  --background: #000000; --dialog: #0e0e0f; --foreground: #f4f4f5;
  --card: #121213; --card-foreground: #f4f4f5; --popover: #161617; --popover-foreground: #f4f4f5;
  --primary: #ffffff; --primary-foreground: #000000;
  --secondary: #1b1b1c; --secondary-foreground: #f4f4f5;
  --chat-user: #1d1d1f; --chat-user-foreground: #f4f4f5;
  --muted: #141415; --muted-foreground: #8d8d92;
  --accent: #1b1b1c; --accent-foreground: #f4f4f5;
  --border: rgba(255,255,255,0.085); --input: rgba(255,255,255,0.12); --ring: rgba(255,255,255,0.32);
  --sidebar: #090909; --sidebar-foreground: #e9e9eb; --sidebar-border: rgba(255,255,255,0.06);
  --sidebar-accent: #19191a; --sidebar-accent-foreground: #ffffff;
  --scrollbar: #262628; --scrollbar-hover: #36363a; --radius: 1rem;
}
[data-theme="light"] {
  --background: #ffffff; --dialog: #ffffff; --foreground: #0d0d0d;
  --card: #ffffff; --card-foreground: #0d0d0d; --popover: #ffffff; --popover-foreground: #0d0d0d;
  --primary: #0d0d0d; --primary-foreground: #ffffff;
  --secondary: #f4f4f4; --secondary-foreground: #0d0d0d;
  --chat-user: #f2f2f2; --chat-user-foreground: #0d0d0d;
  --muted: #f4f4f4; --muted-foreground: #6b6b70;
  --accent: #f0f0f0; --accent-foreground: #0d0d0d;
  --border: rgba(0,0,0,0.08); --input: rgba(0,0,0,0.1); --ring: rgba(0,0,0,0.28);
  --sidebar: #fafafa; --sidebar-foreground: #0d0d0d; --sidebar-border: rgba(0,0,0,0.06);
  --sidebar-accent: #eeeeee; --sidebar-accent-foreground: #0d0d0d;
  --scrollbar: #d4d4d6; --scrollbar-hover: #b4b4b8; --radius: 1rem;
}
html, body, #root {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif !important;
  -webkit-font-smoothing: antialiased; letter-spacing: -0.006em;
}
/* The composer: Grok's raised capsule. */
div[class*="rounded-[26px]"]:has(textarea) {
  border-radius: 28px !important; background: var(--card) !important; border-color: var(--border) !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05), 0 10px 32px rgba(0,0,0,0.07);
  transition: box-shadow 200ms ease, border-color 200ms ease;
}
div[class*="rounded-[26px]"]:has(textarea):focus-within { box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 14px 40px rgba(0,0,0,0.1); }
[data-theme="dark"] div[class*="rounded-[26px]"]:has(textarea),
:root:not([data-theme="light"]) div[class*="rounded-[26px]"]:has(textarea) { background: #121213 !important; box-shadow: 0 0 0 1px rgba(255,255,255,0.05), 0 12px 44px rgba(0,0,0,0.55); }
textarea { font-size: 16px !important; line-height: 1.5 !important; }
/* Grok's conversation: replies are plain text in a centred reading column; only your messages sit in bubbles. */
[data-testid="transcript"] { padding-inline: max(20px, calc((100% - 780px) / 2)) !important; }
[data-testid="message-bubble-frame"]:has([data-testid="message-bot-bubble"]) { max-width: 100% !important; }
[data-testid="message-bot-bubble"] { background: transparent !important; padding: 2px 0 !important; border-radius: 0 !important; font-size: 16px !important; line-height: 1.62 !important; }
[data-message-id]:has([data-testid="message-bot-bubble"]) > time { display: none !important; }
div[class*="rounded-[26px]"]:has(textarea) { max-width: 780px; width: 100%; margin-inline: auto; }
/* Pills everywhere a button is a primary or secondary action, as in Grok. */
button[data-slot="button"], a[data-slot="button"] { border-radius: 9999px !important; }
/* Calmer motion for the conversation and lists. */
* { transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1); }
`;


/** Presents the app as part of Clyra: the product name in every visible string (text, labels, tooltips, tab title)
 *  reads "Clyra" instead of the upstream name, including text that renders later. Inputs and code are left alone. */
export const AGENTS_BRAND_SCRIPT = `(() => {
  if (window.__clyraAgentsBrand) return; window.__clyraAgentsBrand = true;
  const NAME = /Rakazo/g, LOWER = /rakazo/g, TEST = /rakazo/i;
  const swap = (value) => value.replace(NAME, "Clyra").replace(LOWER, "clyra");
  const skip = (node) => { const host = node.parentElement; return !host || host.closest("textarea, input, code, pre, [contenteditable=true], script, style"); };
  const fixText = (node) => { if (TEST.test(node.nodeValue) && !skip(node)) node.nodeValue = swap(node.nodeValue); };
  const fixAttrs = (root) => {
    if (!root.querySelectorAll) return;
    root.querySelectorAll("[aria-label], [title], [placeholder], img[alt]").forEach((el) => {
      for (const name of ["aria-label", "title", "placeholder", "alt"]) { const value = el.getAttribute(name); if (value && TEST.test(value)) el.setAttribute(name, swap(value)); }
    });
  };
  const walk = (root) => { const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node; while ((node = it.nextNode())) fixText(node); fixAttrs(root); };
  const fixTitle = () => { if (TEST.test(document.title)) document.title = swap(document.title); };
  walk(document.body); fixTitle();
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") fixText(mutation.target);
      else if (mutation.type === "attributes") fixAttrs(mutation.target.parentNode || document);
      else for (const node of mutation.addedNodes) { if (node.nodeType === 3) fixText(node); else if (node.nodeType === 1) walk(node); }
    }
    fixTitle();
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "title", "placeholder", "alt"] });
})();`;

/** Injected sheets sort before the page's own, so every token override is marked important to win cleanly. */
export const AGENTS_GROK_CSS = GROK_THEME_SOURCE.replace(/(--[a-z-]+:\s*[^;!]+);/g, "$1 !important;");

function Mark({ size = 56 }: { size?: number }) {
  // An original monochrome mark for Clyra Agents: a solid orb with an orbit stroke.
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <circle cx="28" cy="28" r="15" fill="currentColor" />
      <ellipse cx="28" cy="28" rx="25" ry="9.5" fill="none" stroke="currentColor" strokeWidth="2.4" transform="rotate(-28 28 28)" opacity="0.9" />
    </svg>
  );
}

const STEPS: Array<{ phase: AgentsStackState["phase"]; label: string }> = [
  { phase: "engine", label: "Engine" },
  { phase: "pulling", label: "Download" },
  { phase: "starting", label: "Start" },
];

export function AgentsWorkspace() {
  const reduce = useReducedMotion();
  const desktop = getElectronDesktop();
  const agents = desktop?.agents;
  const [state, setState] = useState<AgentsStackState>({ phase: agents ? "idle" : "error", message: agents ? null : "Agents run in the Clyra desktop app", detail: null, progress: null, url: "http://127.0.0.1:47660" });

  useEffect(() => {
    if (!agents) return;
    let alive = true;
    const off = agents.onState((next) => { if (alive) setState(next); });
    void agents.status().then((current) => {
      if (!alive) return;
      setState(current);
      if (current.phase !== "ready") void agents.start();
    });
    return () => { alive = false; off?.(); };
    // The desktop bridge is fixed for the life of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.phase === "ready") {
    return (
      <div className="relative h-full w-full bg-white">
        {isElectronRuntime() ? (
          <ElectronWebContentsSurface source={state.url} title="Clyra Agents" surfaceId="clyra-agents" kind="agents" css={AGENTS_GROK_CSS} script={AGENTS_BRAND_SCRIPT} className="h-full w-full" />
        ) : (
          <iframe title="Clyra Agents" src={state.url} className="h-full w-full border-0" />
        )}
      </div>
    );
  }

  const activeIndex = Math.max(0, STEPS.findIndex((step) => step.phase === state.phase));
  const failed = state.phase === "error";
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden bg-[#fbfbfb] px-6 text-center text-[#0d0d0d]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55]" style={{ background: "radial-gradient(60% 45% at 50% 38%, rgba(0,0,0,0.05), transparent 70%)" }} aria-hidden />
      <motion.div initial={reduce ? false : { opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className={failed ? "" : "cc-agents-orbit"}>
        <Mark size={64} />
      </motion.div>
      <h1 className="mt-6 text-[30px] font-semibold tracking-[-0.03em]">Agents</h1>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={`${state.phase}:${state.message}`} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.22 }} className="mt-2 max-w-[420px] text-[15px] text-[#5f5f64]">
          {failed ? state.message ?? "Agents couldn’t start" : state.message ?? "Getting your agents ready…"}
        </motion.p>
      </AnimatePresence>

      {!failed ? (
        <div className="mt-8 w-[min(360px,80vw)]">
          <div className="h-[3px] overflow-hidden rounded-full bg-black/[0.07]">
            {state.phase === "pulling" && state.progress != null ? (
              <motion.div className="h-full rounded-full bg-[#0d0d0d]" animate={{ width: `${Math.round(state.progress * 100)}%` }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} />
            ) : (
              <div className="cc-agents-indeterminate h-full w-1/3 rounded-full bg-[#0d0d0d]" />
            )}
          </div>
          <div className="mt-3 flex justify-between text-[12px] text-[#9a9aa0]">
            {STEPS.map((step, index) => (
              <span key={step.phase} className={index <= activeIndex ? "text-[#0d0d0d]" : undefined}>{step.label}{step.phase === "pulling" && state.phase === "pulling" && state.progress != null ? ` ${Math.round(state.progress * 100)}%` : ""}</span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3">
          {state.detail ? <p className="max-w-[460px] text-[12.5px] leading-[1.5] text-[#8a8a90]">{state.detail}</p> : null}
          {agents ? (
            <button type="button" onClick={() => void agents.start()} className="h-9 rounded-full bg-[#0d0d0d] px-5 text-[14px] font-medium text-white transition-transform active:scale-[0.97]">
              Try again
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
