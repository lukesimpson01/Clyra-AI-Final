import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { AgentPointer } from "../components/chat/AgentPointer";
import { ShimmerText } from "../components/chat/assistant";
import { useToolAgent } from "../lib/toolAgentStore";

/*
 * Clyra's Shorts workspace: the Shorts app (apps/shorts/app, with its advanced editor apps/shorts/openfilm), as it is,
 * in Clyra's window. Clyra's server starts it at boot (lib/shorts-app/manager.ts) and says where it is; its AI clipper
 * generates with Clyra's clipper backend (/api/clipper/*), reached through the app's own server.
 *
 * Opening is immediate: the address is asked for once, early (warmShortsApp), and the app's page fades in the moment it
 * has loaded. Nothing is shown while that is quick; only a slow start fades in a quiet line.
 */
export type ShortsEntry = { name: "home" } | { name: "setup"; kind: "would-rather" | "reddit-story" | "fake-text" };

const PATH_OF: Record<string, string> = {
  home: "/dashboard",
  "fake-text": "/create/text-video",
  "reddit-story": "/create/reddit-video",
  "would-rather": "/create/would-you-rather",
};

let address: Promise<string> | null = null;
/** The Shorts app's address, asked for once per page and shared by every Shorts surface. */
export function warmShortsApp(): Promise<string> {
  address ??= fetch("/api/shorts-app/start", { method: "POST" })
    .then(async (r) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.url) throw new Error(body.error || "The Shorts app did not start.");
      return String(body.url);
    })
    .catch((e: unknown) => { address = null; throw e; });
  return address;
}

export function ShortsApp({ entry, onExit }: { entry: ShortsEntry; onExit?: () => void }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => live && setSlow(true), 900);
    warmShortsApp()
      .then((u) => { if (live) setUrl(u); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; window.clearTimeout(timer); };
  }, []);
  const path = PATH_OF[entry.name === "home" ? "home" : entry.kind] ?? "/dashboard";
  /* while Clyra's agent works in this app: the blue field, its pointer, and the app locked until it is done */
  const agent = useToolAgent();
  const working = agent.busy && agent.tool === "shorts";
  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const root = React.useRef<HTMLDivElement | null>(null);
  /* zooming into the app from Task View while it is mid-task resizes its window: the frost arrives blurred again, then settles */
  const [enterKey, setEnterKey] = React.useState(0);
  React.useEffect(() => {
    const el = root.current; if (!el || typeof ResizeObserver === "undefined") return undefined;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => { const next = el.clientWidth; if (Math.abs(next - width) > 120 && working) setEnterKey((k) => k + 1); width = next; });
    watch.observe(el); return () => watch.disconnect();
  }, [working]);
  React.useEffect(() => {
    const el = frame.current; if (!el) return;
    if (working) { el.setAttribute("inert", ""); (document.activeElement as HTMLElement | null)?.blur?.(); } else el.removeAttribute("inert");
  }, [working, url]);

  return (
    <div ref={root} className="relative h-full w-full overflow-hidden bg-white">
      <style>{`.shorts-surface{transition:opacity 360ms cubic-bezier(.22,1,.36,1)}@media(prefers-reduced-motion:reduce){.shorts-surface{transition:none!important}}`}</style>
      {url ? (
        <iframe
          ref={frame}
          title="Shorts"
          src={`${url}${path}`}
          onLoad={() => setLoaded(true)}
          className="shorts-surface h-full w-full border-0"
          style={{ opacity: loaded ? 1 : 0 }}
          allow="autoplay; clipboard-read; clipboard-write; fullscreen; microphone"
        />
      ) : null}
      <AnimatePresence>
        {working ? (
          <motion.div className="clyra-toolagent" key="agent" role="status" aria-live="polite" aria-label="Clyra is working in Shorts" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
            <span className="clyra-bf is-working" aria-hidden />
            <div className="clyra-toolagent__frost" key={enterKey} aria-hidden />
            {agent.cursor ? <AgentPointer x={agent.cursor.x} y={agent.cursor.y} kind={agent.cursor.kind} id={agent.cursor.id} /> : null}
            <div className="clyra-toolagent__pill"><i aria-hidden /><ShimmerText>{agent.label || "Working in Shorts"}</ShimmerText></div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <strong className="text-[15px] font-semibold text-neutral-900">Shorts could not start</strong>
          <span className="max-w-[360px] text-[13px] text-neutral-500">{error}</span>
        </div>
      ) : !loaded && slow ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ animation: "clyra-status-enter 300ms cubic-bezier(.22,1,.36,1) both" }}>
          <span className="text-[13px] text-neutral-400">Opening Shorts…</span>
        </div>
      ) : null}
    </div>
  );
}
