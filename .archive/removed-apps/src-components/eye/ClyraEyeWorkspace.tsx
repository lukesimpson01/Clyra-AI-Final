import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUp, Check, CloudRain, Flame, Globe2, LocateFixed, Minus, Plane, Plus, Rocket, Satellite, Ship, Sparkles, Square, Tornado, Waves, X } from "lucide-react";
import { getElectronDesktop } from "../../lib/electron-runtime";
import { resolveDeviceLocation } from "../../hooks/useDeviceLocation";
import { ShiningText } from "../ui/shining-text";
import { MarkdownMessageContent } from "../MarkdownMessageContent";
import { assistantBubbleInnerStyle, chatBubbleStyle, userBubbleInnerStyle } from "../chat/ClyraComposerShell";

/**
 * Clyra Eye: the God's Eye View globe (apps/clyra-eye) in its embed mode — the planet alone, on a light backdrop —
 * with Clyra's own light interface around it: live layer chips, globe controls, and an assistant that answers
 * questions about what is happening on Earth from Eye's live data and the news, then shows each answer on the globe.
 */

const EYE_ORIGIN = "http://localhost:5179";
const SHELL_EASE = [0.32, 0.72, 0, 1] as const;

type EyeCamera = { lat: number; lon: number; altitude_m?: number };
type EyeView = { camera: EyeCamera & { heading_deg?: number; pitch_deg?: number }; layers?: string[]; follow?: { kind: string; id: string; cockpit?: boolean } | null; style?: string | null; map?: string | null };
type Step = { kind: "tool"; name: string; ok: boolean; summary: string } | { kind: "view"; label: string };
type Turn = { id: string; role: "user" | "assistant"; text?: string; steps?: Step[]; pending?: boolean; error?: string; stopped?: boolean };

const LAYERS: Array<{ id: string; label: string; icon: typeof Plane }> = [
  { id: "flights", label: "Flights", icon: Plane },
  { id: "satellites", label: "Satellites", icon: Satellite },
  { id: "ais-live-vessels", label: "Ships", icon: Ship },
  { id: "earthquakes", label: "Earthquakes", icon: Waves },
  { id: "local-firms", label: "Fires", icon: Flame },
  { id: "weather-radar", label: "Rain", icon: CloudRain },
  { id: "weather-cyclones", label: "Storms", icon: Tornado },
  { id: "rocket-launches", label: "Launches", icon: Rocket },
];

const STARTERS = [
  "What's happening near me right now?",
  "Any big earthquakes today?",
  "Where is the ISS right now?",
  "Show flights over London",
  "Brief me on today's news in Ukraine",
  "Are there wildfires in California?",
  "Storms in the Pacific this week",
];

const TOOL_LABELS: Record<string, string> = {
  aircraft_in_area: "Scanned the sky", find_aircraft: "Found the aircraft", get_aircraft_track: "Traced the flight", get_aircraft_info: "Looked up the aircraft",
  vessels_in_area: "Scanned shipping", find_vessel: "Found the vessel", get_vessel_track: "Traced the vessel", next_satellite_pass: "Predicted the pass",
  satellites_overhead: "Checked satellites overhead", get_earthquakes: "Checked earthquakes", get_active_fires: "Checked active fires", get_fire_perimeters: "Mapped fire perimeters",
  get_cyclones: "Tracked storms", get_weather_map: "Read the weather", get_recent_launches: "Checked launches", get_traffic_flow: "Read traffic",
  situation_brief: "Built a situation brief", military_awareness: "Reviewed military activity", find_infrastructure: "Found infrastructure",
  find_submarine_cables: "Found submarine cables", get_recent_imagery: "Found satellite imagery", find_cctv_cameras: "Found public cameras",
  get_terrain_height: "Measured terrain", find_military_installations: "Found installations", get_map_features: "Read map features",
  web_search: "Searched the news", show_on_globe: "Moved the globe",
};

function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now.toISOString().slice(11, 19);
}

function EyeCapsule({ text, onText, onSubmit, busy, placeholder, onFocus, autoFocus, leading }: {
  text: string; onText: (value: string) => void; onSubmit: () => void; busy: boolean; placeholder: string;
  onFocus?: () => void; autoFocus?: boolean; leading?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(120, Math.max(24, el.scrollHeight))}px`;
  }, [text]);
  useEffect(() => { if (autoFocus) requestAnimationFrame(() => ref.current?.focus()); }, [autoFocus]);
  const canSend = Boolean(text.trim()) && !busy;
  return (
    <motion.div layoutId="eye-capsule" transition={{ layout: { duration: 0.5, ease: SHELL_EASE } }} className="maps-capsule" onClick={() => ref.current?.focus()}>
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-[3px] h-[15px] w-[15px] shrink-0 text-[#1E6FFF]" aria-hidden />
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSend) onSubmit();
            }
          }}
          className="min-w-0 flex-1 resize-none bg-transparent text-[14.5px] leading-[1.55] tracking-[-0.01em] text-[#15171C] outline-none placeholder:text-[#9a9ca3]"
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {leading}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Send"
          disabled={!canSend}
          onClick={(event) => { event.stopPropagation(); if (canSend) onSubmit(); }}
          className={"grid h-[32px] w-[32px] shrink-0 place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-[240ms] active:scale-95 " + (canSend ? "bg-[#1E6FFF] text-white shadow-[0_2px_10px_-2px_rgba(30,111,255,0.55)] hover:bg-[#1a63e6]" : "bg-[#EDEEF1] text-[#AFB3BB]")}
        >
          <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
    </motion.div>
  );
}

export function ClyraEyeWorkspace({ suspended = false }: { suspended?: boolean }) {
  const desktop = getElectronDesktop();
  const eye = desktop?.eye;
  const reduced = useReducedMotion();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [serverReady, setServerReady] = useState(!eye);
  const [globeReady, setGlobeReady] = useState(false);
  const [home, setHome] = useState<EyeCamera | null>(null);
  const [place, setPlace] = useState<{ name?: string; country?: string } | null>(null);
  const [startCamera, setStartCamera] = useState<EyeCamera | null>(null);
  const cameraRef = useRef<EyeCamera | null>(null);
  const [layers, setLayers] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const clock = useUtcClock();

  // The desktop app starts the Eye server itself; wait until it answers.
  useEffect(() => {
    if (!eye) return;
    let cancelled = false;
    let ready = false;
    const check = () => eye.status().then((result) => { if (!cancelled && result.reachable) { ready = true; setServerReady(true); } }).catch(() => {});
    void check();
    const timer = window.setInterval(() => { if (!ready) void check(); }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
    // The desktop bridge is fixed for the life of the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open over the user (Clyra's own location lookup), from high enough to see the whole planet.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => { if (!cancelled) setStartCamera((camera) => camera ?? { lat: 20, lon: 0, altitude_m: 20_000_000 }); }, 1500);
    void resolveDeviceLocation().then((location) => {
      if (cancelled || !location) return;
      const here = { lat: location.lat, lon: location.lon };
      setHome(here);
      setStartCamera((camera) => camera ?? { ...here, altitude_m: 18_000_000 });
      // Reverse-geocode so the composer's suggestions can name the country and
      // locality instead of a bare coordinate pair.
      void fetch("/api/research/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: here.lat, lon: here.lon }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: { ok?: boolean; name?: string; country?: string } | null) => {
          if (!cancelled && data?.ok) setPlace({ name: data.name, country: data.country });
        })
        .catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  // Suggestions are tuned to the user's current location or country once it is
  // known, so the first thing offered is always about where they are.
  const starters = useMemo(() => {
    const locality = place?.name;
    const country = place?.country;
    if (!locality && !country) return STARTERS;
    const label = [locality, country].filter(Boolean).join(", ");
    const region = country || locality || "";
    return [
      `What's happening near ${label} right now?`,
      `Any earthquakes near ${label} today?`,
      `Show flights over ${label}`,
      `Are there wildfires near ${label}?`,
      "Where is the ISS right now?",
      `Storms near ${label} this week`,
      `Brief me on today's news in ${region}`,
    ];
  }, [place]);

  const src = useMemo(() => {
    if (!startCamera) return null;
    return `${EYE_ORIGIN}/?embed=1&theme=light#v=2&lat=${startCamera.lat.toFixed(4)}&lon=${startCamera.lon.toFixed(4)}&alt=${startCamera.altitude_m ?? 18_000_000}&heading=0&pitch=-90&roll=0&style=normal&bloom=0&sc=0&map=esri-imagery`;
  }, [startCamera]);

  const post = useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(message, EYE_ORIGIN);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== EYE_ORIGIN || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: string; camera?: EyeCamera; layers?: string[] };
      if (data?.type === "gev:ready") setGlobeReady(true);
      if (data?.type === "clyra:camera" && data.camera) cameraRef.current = data.camera;
      if ((data?.type === "clyra:camera" || data?.type === "clyra:layers") && Array.isArray(data.layers)) setLayers(data.layers);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const showView = useCallback((view: EyeView) => {
    post({ type: "gev:view", id: `v${Date.now()}`, view: { style: null, map: null, follow: null, ...view, layers: view.layers ?? layers } });
    if (view.layers) setLayers(view.layers);
  }, [layers, post]);

  const toggleLayer = (id: string) => {
    const enabled = !layers.includes(id);
    setLayers((current) => (enabled ? [...current, id] : current.filter((layer) => layer !== id)));
    post({ type: "clyra:layer", layerId: id, enabled });
  };

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [turns, busy, reduced]);

  const ask = async (question: string) => {
    const value = question.trim();
    if (!value || busy) return;
    setOpen(true);
    setText("");
    const history = turns.filter((turn) => turn.text).slice(-6).map((turn) => ({ role: turn.role, content: turn.text || "" }));
    const assistantId = `a${Date.now()}`;
    setTurns((current) => [...current, { id: `u${Date.now()}`, role: "user", text: value }, { id: assistantId, role: "assistant", steps: [], pending: true }]);
    setBusy(true);
    setStatus("Thinking");
    const controller = new AbortController();
    abortRef.current = controller;
    const update = (patch: (turn: Turn) => Turn) => setTurns((current) => current.map((turn) => (turn.id === assistantId ? patch(turn) : turn)));
    try {
      const response = await fetch("/api/eye/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: value, context: { camera: cameraRef.current, layers, userLocation: home, history } }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`Clyra Eye's assistant is unavailable (${response.status}).`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { type: string; label?: string; name?: string; ok?: boolean; summary?: string; view?: EyeView; reply?: string; message?: string };
          try { event = JSON.parse(line); } catch { continue; }
          if (event.type === "status" && event.label) setStatus(event.label);
          else if (event.type === "tool" && event.name) {
            const step: Step = { kind: "tool", name: event.name, ok: Boolean(event.ok), summary: event.summary || "" };
            update((turn) => ({ ...turn, steps: [...(turn.steps || []), step] }));
          } else if (event.type === "view" && event.view?.camera) {
            showView(event.view);
            const label = event.label;
            if (label) update((turn) => ({ ...turn, steps: [...(turn.steps || []), { kind: "view", label }] }));
          } else if (event.type === "final") update((turn) => ({ ...turn, pending: false, text: event.reply || "" }));
          else if (event.type === "error") update((turn) => ({ ...turn, pending: false, error: event.message || "Something went wrong." }));
        }
      }
      update((turn) => (turn.pending ? { ...turn, pending: false } : turn));
    } catch (error) {
      if (controller.signal.aborted) update((turn) => ({ ...turn, pending: false, stopped: true }));
      else update((turn) => ({ ...turn, pending: false, error: error instanceof Error ? error.message : "Something went wrong." }));
    } finally {
      setBusy(false);
      setStatus("");
      abortRef.current = null;
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#eef1f5]" aria-label="Clyra Eye">
      {serverReady && src ? (
        <iframe
          ref={frameRef}
          src={src}
          title="Clyra Eye globe"
          className="absolute inset-0 h-full w-full border-0"
          // Hidden (not just transparent) while another app is in front, so the browser stops drawing the globe.
          style={{ opacity: globeReady ? 1 : 0, transition: "opacity 600ms cubic-bezier(.22,1,.36,1)", visibility: suspended ? "hidden" : "visible" }}
          allow="geolocation; fullscreen"
        />
      ) : null}

      {/* Loading: an opaque, focused start — only the loading UI shows until the
          globe is ready, so no chips, controls or composer peek through. */}
      <AnimatePresence>
        {!globeReady ? (
          <motion.div key="loading" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.5 } }} className="absolute inset-0 z-30 grid place-items-center bg-[#eef1f5]">
            <div className="flex flex-col items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-white shadow-[0_8px_24px_-10px_rgba(16,18,24,0.25),inset_0_0_0_1px_rgba(16,18,24,0.06)]" aria-hidden>
                <Globe2 className="h-6 w-6 text-[#1E6FFF]" strokeWidth={1.6} />
              </span>
              <ShiningText text={serverReady ? "Bringing the planet into view…" : "Starting Clyra Eye…"} className="text-[13px]" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {globeReady ? (
        <>
      {/* Top bar: name, live clock, layer chips. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-3">
        <div className="pointer-events-auto flex w-full max-w-[1040px] items-center gap-2">
          <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 shadow-[0_4px_14px_-6px_rgba(16,18,24,0.22),inset_0_0_0_1px_rgba(16,18,24,0.06)] backdrop-blur">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#1E6FFF]"><Globe2 className="h-3 w-3 text-white" strokeWidth={2.2} /></span>
            <span className="text-[13px] font-semibold tracking-[-0.01em] text-[#15171C]">Clyra Eye</span>
            <span className="text-[12px] tabular-nums text-[#6b7079]">{clock} UTC</span>
          </div>
          <div className="flex min-w-0 flex-1 justify-center gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]">
            {LAYERS.map((layer) => {
              const on = layers.includes(layer.id);
              const Icon = layer.icon;
              return (
                <button
                  key={layer.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLayer(layer.id)}
                  className={"flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium backdrop-blur transition-[background-color,color,box-shadow] duration-150 active:scale-[0.97] " + (on ? "bg-[#1E6FFF] text-white shadow-[0_4px_14px_-6px_rgba(30,111,255,0.6)]" : "bg-white/90 text-[#3b3e45] shadow-[0_4px_14px_-6px_rgba(16,18,24,0.22),inset_0_0_0_1px_rgba(16,18,24,0.06)] hover:text-[#15171C]")}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {layer.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Globe controls. */}
      <div className={"absolute bottom-28 z-20 flex flex-col gap-1.5 transition-[right] duration-500 " + (open ? "right-[428px]" : "right-4")} style={{ transitionTimingFunction: "cubic-bezier(.32,.72,0,1)" }}>
        {[
          { label: "Zoom in", icon: Plus, run: () => post({ type: "clyra:zoom", direction: "in" }) },
          { label: "Zoom out", icon: Minus, run: () => post({ type: "clyra:zoom", direction: "out" }) },
          { label: "Go to my location", icon: LocateFixed, run: () => { if (home) showView({ camera: { ...home, altitude_m: 60_000, pitch_deg: -90 } }); } },
        ].map((control) => (
          <button key={control.label} type="button" aria-label={control.label} title={control.label} onClick={control.run}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[#3b3e45] shadow-[0_4px_14px_-6px_rgba(16,18,24,0.25),inset_0_0_0_1px_rgba(16,18,24,0.06)] backdrop-blur transition-colors hover:text-[#15171C] active:scale-95">
            <control.icon className="h-4 w-4" strokeWidth={2} />
          </button>
        ))}
      </div>

      {/* Assistant. */}
      <LayoutGroup id="eye-assistant">
        <AnimatePresence initial={false}>
          {open ? (
            <motion.section
              key="panel"
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, x: 18, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
              transition={{ duration: 0.42, ease: SHELL_EASE }}
              aria-label="Ask Clyra Eye"
              className="absolute bottom-4 right-4 top-[60px] z-30 flex w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_1px_1px_rgba(16,18,24,0.03),0_12px_28px_-10px_rgba(16,18,24,0.16),0_32px_64px_-32px_rgba(16,18,24,0.28),inset_0_0_0_1px_rgba(16,18,24,0.06)]"
            >
              <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3.5">
                <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#15171C]">Ask Clyra Eye</h2>
                <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-full text-[#6b7079] transition-colors hover:bg-black/5 hover:text-[#15171C]">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3">
                {turns.length === 0 ? (
                  <motion.div initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: SHELL_EASE, delay: 0.08 }} className="pt-6">
                    <p className="text-[19px] font-semibold tracking-[-0.025em] text-[#15171C]">What's happening on Earth?</p>
                    <p className="mt-1 text-[13px] leading-[1.5] text-[#6b7079]">Live flights, ships, satellites, earthquakes, fires, storms and the news — asked in plain words, shown on the globe.</p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {starters.map((starter, i) => (
                        <motion.button key={starter} type="button" initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: SHELL_EASE, delay: 0.12 + i * 0.025 }} onClick={() => void ask(starter)} className="rounded-full bg-[#f3f4f6] px-3 py-1.5 text-[12.5px] font-medium text-[#3b3e45] transition-colors hover:bg-[#e9eaee] hover:text-[#15171C]">{starter}</motion.button>
                      ))}
                    </div>
                  </motion.div>
                ) : null}
                {turns.map((turn) =>
                  turn.role === "user" ? (
                    <motion.div key={turn.id} initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: SHELL_EASE }} style={chatBubbleStyle("user")}>
                      <div style={userBubbleInnerStyle}>{turn.text}</div>
                    </motion.div>
                  ) : (
                    <div key={turn.id} style={chatBubbleStyle("assistant")}>
                      <div style={{ ...assistantBubbleInnerStyle, maxWidth: "100%" }} className="w-full">
                      {turn.steps?.length || turn.pending ? (
                        <ol className="maps-steps mb-2.5">
                          {(turn.steps || []).map((step, index) => (
                            <motion.li key={index} initial={reduced ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: SHELL_EASE }} className="maps-step" data-state={step.kind === "view" ? "map" : step.ok ? "ok" : "error"}>
                              <span className="maps-step-node" aria-hidden>{step.kind === "view" ? <Globe2 className="h-2.5 w-2.5" /> : step.ok ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : "!"}</span>
                              <span className="min-w-0">
                                {step.kind === "view" ? step.label : TOOL_LABELS[step.name] || "Checked live data"}
                                {step.kind === "tool" && step.summary ? <span className="text-[#9a9ca3]"> · {step.summary}</span> : null}
                              </span>
                            </motion.li>
                          ))}
                          {turn.pending ? (
                            <li className="maps-step" data-state="running">
                              <span className="maps-step-node" aria-hidden />
                              <ShiningText text={status ? `${status}…` : "Thinking…"} className="text-[12.5px]" />
                            </li>
                          ) : null}
                        </ol>
                      ) : turn.pending ? (
                        <ShiningText text={status ? `${status}…` : "Thinking…"} className="text-[13px]" />
                      ) : null}
                      {turn.text ? (
                        <div className="markdown-body overflow-x-auto" style={{ animation: reduced ? undefined : "clyraReplyIn .9s cubic-bezier(.32,.72,0,1) both" }}>
                          <MarkdownMessageContent content={turn.text} suppressCodeBlocks />
                        </div>
                      ) : null}
                      {turn.error ? <p className="text-[#b45309]">{turn.error}</p> : null}
                      {turn.stopped ? <p className="text-[12px] text-[#6b7079]">Stopped.</p> : null}
                      </div>
                    </div>
                  ),
                )}
              </div>
              <div className="shrink-0 px-3 pb-3 pt-1">
                <EyeCapsule
                  text={text}
                  onText={setText}
                  onSubmit={() => void ask(text)}
                  busy={busy}
                  autoFocus
                  placeholder={busy ? "Clyra Eye is working…" : "Ask a follow-up…"}
                  leading={busy ? (
                    <button type="button" onClick={() => abortRef.current?.abort()} className="flex h-[28px] items-center gap-1.5 rounded-full bg-[#f3f4f6] px-3 text-[12px] font-medium text-[#3b3e45] transition-colors hover:bg-[#e9eaee]">
                      <Square className="h-2.5 w-2.5" fill="currentColor" strokeWidth={0} /> Stop
                    </button>
                  ) : null}
                />
              </div>
            </motion.section>
          ) : (
            <motion.div
              key="bar"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: 0.45, ease: SHELL_EASE }}
              className="absolute bottom-4 left-1/2 z-30 w-[min(540px,calc(100vw-32px))] -translate-x-1/2"
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
            >
              <AnimatePresence>
                {focused && !text.trim() ? (
                  <motion.div key="starters" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 4, transition: { duration: 0.14 } }} transition={{ duration: 0.3, ease: SHELL_EASE }} className="mb-2 flex flex-wrap justify-center gap-1.5">
                    {starters.slice(0, 4).map((starter) => (
                      <button key={starter} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void ask(starter)} className="rounded-full bg-white/95 px-3 py-1.5 text-[12.5px] font-medium text-[#3b3e45] shadow-[0_4px_14px_-6px_rgba(16,18,24,0.25),inset_0_0_0_1px_rgba(16,18,24,0.06)] backdrop-blur transition-colors hover:text-[#15171C]">{starter}</button>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <EyeCapsule text={text} onText={setText} onSubmit={() => void ask(text)} busy={busy} placeholder="Ask anything about what's happening on Earth…" onFocus={() => setFocused(true)} />
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
        </>
      ) : null}
    </div>
  );
}
