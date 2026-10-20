import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Clyra Flow inside the chat composer. The composer keeps its shape; this layer fades in over the whole card
 * (its buttons soften away beneath it) and becomes the dictation surface: live words, thinking, edits, final text.
 * With text selected in the composer it switches to an "editing selection" layout: speech either replaces the
 * selection or, when it sounds like an instruction, is applied to it by the AI.
 */
export interface FlowSession {
  phase: string;
  partial?: string;
  level?: number;
  detail?: string;
  diff?: Array<{ type: "same" | "del" | "add"; text: string }> | null;
  finalText?: string;
  selectedText?: string;
  edit?: "rewrite" | "replace" | null;
}

const CSS = `
@property --a { syntax: '<angle>'; inherits: true; initial-value: 0deg; }
.fcv { position: absolute; inset: 0; z-index: 30; display: flex; flex-direction: column; border-radius: inherit; overflow: hidden; isolation: isolate; text-align: left;
  background: radial-gradient(120% 90% at 50% 0%, #ffffff 0%, #f7faff 62%, #f1f6ff 100%);
  animation: fcvIn .45s cubic-bezier(.16,1,.3,1) backwards; }
@keyframes fcvIn { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
/* the whole composer outline lights up with the voice, and circles in blue while thinking */
.fcv::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; z-index: 5; box-shadow: inset 0 0 0 1px rgba(var(--ring, 15,23,42), calc(.07 + var(--lvl, 0) * .34)); transition: box-shadow .18s ease; }
/* done: the dictation layer lets go and the text glides up into the draft beneath it */
.fcv-closing { pointer-events: none; animation: fcvOut 1s cubic-bezier(.4,0,.2,1) forwards !important; }
.fcv-closing .fcv-doc, .fcv-closing .fcv-live { opacity: 0 !important; transition: opacity .12s ease !important; }
.fcv-closing .fcv-sel, .fcv-closing .fcv-end, .fcv-closing .fcv-cancel { opacity: 0; transition: opacity .28s ease; }
@keyframes fcvOut { 0%, 30% { opacity: 1; } 100% { opacity: 0; } }
.clyra-flow-land { animation: fcvLand .4s .72s cubic-bezier(.16,1,.3,1) both; }
@keyframes fcvLand { from { opacity: 0; transform: translateY(6px); filter: blur(2px); } to { opacity: 1; transform: none; filter: blur(0); } }
/* selection: one slim line above the row (what you selected and what Flow will do with it) */
.fcv-sel { display: flex; align-items: center; gap: 9px; margin: 10px 12px 0; padding: 0 12px 0 10px; height: 30px; flex: 0 0 30px; border-radius: 15px; background: rgba(0,82,251,.06); box-shadow: inset 0 0 0 1px rgba(0,82,251,.09); animation: fcvRise .5s .08s cubic-bezier(.16,1,.3,1) backwards; transition: opacity .5s ease; }
.fcv-sel.dim { opacity: .6; }
.fcv-tag { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; font-size: 10.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: #0052fb; }
.fcv-tag svg { width: 12px; height: 12px; }
.fcv-quote { font-size: 13px; color: #5b6472; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
@keyframes fcvRise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
/* the row: [cancel] [live words / waveform / edits] [stop / loader] — the same arrangement as the floating pill */
.fcv-row { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; gap: 12px; padding: 0 14px; }
.fcv-mid { position: relative; flex: 1; align-self: stretch; margin: 8px 0; min-width: 0; overflow: hidden; }
.fcv-layer { position: absolute; inset: 0; transition: opacity .35s ease; }
.fcv-live { display: flex; flex-direction: column; justify-content: center; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 10px); mask-image: linear-gradient(to bottom, transparent 0, #000 10px); }
.fcv-live.fcv-tall { justify-content: flex-end; }
.fcv-doc { display: flex; flex-direction: column; overflow-y: auto; scrollbar-width: none; overscroll-behavior: contain; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%); mask-image: linear-gradient(to bottom, transparent 0, #000 6px, #000 calc(100% - 6px), transparent 100%); }
.fcv-flow { font-size: 15.5px; line-height: 21px; letter-spacing: -.012em; font-weight: 480; color: #0b1220; word-break: break-word; }
.fcv-docflow { margin-block: auto; flex: 0 0 auto; }
.fcv-doc::-webkit-scrollbar { display: none; }
.fcv-hint { display: flex; align-items: center; font-size: 14.5px; line-height: 20px; color: #9aa3b2; letter-spacing: -.01em; }
.fcv-w { position: relative; isolation: isolate; display: inline-block; white-space: pre; transition: color .5s ease, opacity .5s ease, text-decoration-color .5s ease, transform .6s cubic-bezier(.16,1,.3,1); }
.fcv-in { animation: fcvWord .38s cubic-bezier(.16,1,.3,1) both; }
@keyframes fcvWord { from { opacity: 0; transform: translateY(7px) scale(.96); } to { opacity: 1; transform: none; } }
.fcv-in::after { content: ""; position: absolute; left: 50%; top: 50%; width: 120%; aspect-ratio: 1; min-width: 30px; border-radius: 50%; pointer-events: none; z-index: -1; opacity: 0;
  background: radial-gradient(closest-side, rgba(0,82,251,.26), rgba(0,82,251,.10) 55%, rgba(0,82,251,0) 100%); transform: translate(-50%, -50%) scale(.2);
  animation: fcvRipple .95s cubic-bezier(.2,.7,.2,1) both; animation-delay: inherit; }
@keyframes fcvRipple { 0% { transform: translate(-50%, -50%) scale(.2); opacity: .9; } 100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; } }
.fcv-bump { animation: fcvBump .55s cubic-bezier(.3,.7,.2,1); }
@keyframes fcvBump { 0% { transform: none; } 35% { transform: translateY(-2px) scale(1.03); color: #0052fb; } 100% { transform: none; } }
.fcv-think .fcv-w { color: #64748b; animation: fcvWave 1.5s ease-in-out infinite; animation-delay: calc(var(--i, 0) * 55ms); }
@keyframes fcvWave { 0%, 100% { color: #64748b; opacity: .75; } 40% { color: #0052fb; opacity: 1; } 70% { color: #64748b; opacity: .9; } }
.fcv-w.fcv-del { text-decoration: line-through; text-decoration-thickness: 1.8px; text-decoration-color: transparent; }
.fcv-armed .fcv-w.fcv-del { color: #dc2626; text-decoration-color: #dc2626; transition-delay: var(--d, 0ms); }
.fcv-w.fcv-add { color: #0052fb; font-weight: 600; opacity: 0; transform: translateY(5px); }
.fcv-armed .fcv-w.fcv-add { opacity: 1; transform: none; transition-delay: var(--d, 0ms); }
/* cancel · waveform / status · stop-or-loader */
.fcv-cancel { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: rgba(15,23,42,.055); color: #5b6678; transition: background .18s ease, transform .18s cubic-bezier(.16,1,.3,1); }
.fcv-cancel:hover { background: rgba(15,23,42,.11); color: #0b1220; } .fcv-cancel:active { transform: scale(.9); }
.fcv-meter { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 3px; transition: opacity .3s ease; }
.fcv-bar { display: block; width: 3px; height: 4px; flex: 0 0 3px; border-radius: 999px; background: linear-gradient(180deg, #5b92ff, #0052fb); transition: height .09s linear; }
.fcv-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 560; letter-spacing: -.005em; transition: opacity .3s ease; color: #6b7280; }
.fcv-shimmer { background: linear-gradient(110deg, #64748b 34%, #0052fb 46%, #8fb4ff 50%, #0052fb 54%, #64748b 66%); background-size: 260% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: fcvShimmer 1.6s linear infinite; }
@keyframes fcvShimmer { from { background-position: 130% 0; } to { background-position: -130% 0; } }
.fcv-end { position: relative; width: 34px; height: 34px; flex: 0 0 34px; display: grid; place-items: center; }
.fcv-glyph { position: absolute; transition: opacity .25s ease, transform .4s cubic-bezier(.16,1,.3,1); }
.fcv-glyph.off { opacity: 0; transform: scale(.6); pointer-events: none; }
/* stop: a plain filled circle with a square, like Flow's own */
.fcv-stop { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(180deg, #2a6bff, #0048e6); display: grid; place-items: center; color: #fff; transition: transform .18s cubic-bezier(.16,1,.3,1), filter .18s ease; }
.fcv-stop:hover { filter: brightness(1.08); } .fcv-stop:active { transform: scale(.92); }
.fcv-stop i { display: block; width: 11px; height: 11px; border-radius: 3px; background: currentColor; }
/* "thinking": the listening waveform keeps moving, as a small travelling wave */
.fcv-spin { display: flex; align-items: center; justify-content: center; gap: 3px; height: 24px; }
.fcv-spin i { display: block; width: 3px; height: 5px; border-radius: 999px; background: linear-gradient(180deg, #5b92ff, #0052fb); animation: fcvPulse 1.05s ease-in-out infinite; animation-delay: calc(var(--i) * .11s); }
@keyframes fcvPulse { 0%, 100% { height: 5px; opacity: .45; } 45% { height: 18px; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .fcv, .fcv-in, .fcv-in::after, .fcv-bump, .fcv-spin i, .fcv-shimmer, .fcv-think .fcv-w { animation: none !important; } }
`;

/** One live word. It is born with its entrance animation (decided once, at mount) and gives a small bump when new words land next to it. */
function LiveWord({ word, index, fresh, delay, bump }: { word: string; index: number; fresh: boolean; delay: number; bump: boolean }) {
  const [born] = useState(fresh);
  const [bumping, setBumping] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (!bump) return;
    setBumping(true);
    window.setTimeout(() => { if (alive.current) setBumping(false); }, 640);
  }, [bump]);
  return <span className={`fcv-w ${born ? "fcv-in" : ""} ${bumping ? "fcv-bump" : ""}`} style={{ ["--i" as any]: index, animationDelay: born ? `${delay}ms` : undefined }}>{word + " "}</span>;
}

/** The final text, printed word by word with the same entrance as the live words (fast: about a second in total). */
function PrintedText({ text }: { text: string }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const [count, setCount] = useState(0);
  useEffect(() => { setCount(0); }, [text]);
  useEffect(() => {
    if (count >= words.length) return undefined;
    const base = Math.max(16, Math.min(46, 1100 / Math.max(1, words.length)));
    const step = Math.max(1, Math.ceil((words.length - count) / 14));
    const id = window.setTimeout(() => setCount((n) => Math.min(words.length, n + step)), count === 0 ? 60 : base);
    return () => window.clearTimeout(id);
  }, [count, words.length]);
  // The whole text is laid out from the first frame (words not yet printed are invisible placeholders), so the block never
  // grows or shifts: it stays exactly centred while the words ease in.
  return <>{words.map((word, i) => (i < count
    ? <LiveWord key={i} word={word} index={i} fresh delay={0} bump={false} />
    : <span key={i} className="fcv-w" style={{ visibility: "hidden" }}>{word + " "}</span>))}</>;
}

const split = (text: string) => text.split(/\s+/).filter(Boolean);
const excerpt = (text: string) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > 120 ? `${t.slice(0, 117)}…` : t; };

export function FlowComposerOverlay({ flow, onStop, onCancel }: { flow: FlowSession; onStop: () => void; onCancel: () => void }) {
  const phase = flow.phase;
  const live = useMemo(() => split(flow.partial || ""), [flow.partial]);
  // Words are released one at a time (faster when there is a backlog) so a phrase that arrives at once still types in smoothly.
  const [shown, setShown] = useState(0);
  const freshFrom = useRef(0);
  const [armed, setArmed] = useState(false);
  const bars = useRef<HTMLSpanElement[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const docFlowRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef(0);
  levelRef.current = flow.level || 0;

  const hasSelection = Boolean(flow.selectedText?.trim());
  const showDiff = phase === "refining" && Boolean(flow.diff?.length);
  const closing = phase === "closing";
  const flushAll = phase === "processing" || phase === "optimising" || phase === "refining" || phase === "revealing" || phase === "done" || closing;
  useEffect(() => {
    if (flushAll) { setShown(live.length); return undefined; }
    if (shown > live.length) { setShown(live.length); return undefined; }
    if (shown >= live.length) return undefined;
    const backlog = live.length - shown;
    const step = backlog > 12 ? 3 : backlog > 6 ? 2 : 1;
    const id = window.setTimeout(() => setShown((n) => Math.min(live.length, n + step)), Math.max(38, 92 - backlog * 5));
    return () => window.clearTimeout(id);
  }, [shown, live.length, flushAll]);
  useEffect(() => { freshFrom.current = shown; }, [shown]);
  const visibleLive = flushAll ? live : live.slice(0, shown);
  const showFinal = phase === "revealing" || phase === "done" || closing || (phase === "refining" && !flow.diff?.length);
  const thinking = phase === "processing" || phase === "optimising";
  const hasLive = visibleLive.length > 0;
  const listening = phase === "listening" || phase === "arming";
  const busy = thinking || showDiff || phase === "revealing";

  useEffect(() => {
    const el = liveRef.current;
    if (el) el.classList.toggle("fcv-tall", (el.firstElementChild?.scrollHeight || 0) > el.clientHeight + 1);
  }, [flow.partial]);

  useEffect(() => {
    if (!showDiff) { setArmed(false); return; }
    setArmed(false);
    const id = window.setTimeout(() => setArmed(true), 40);
    return () => window.clearTimeout(id);
  }, [showDiff]);

  // Long text drifts down inside the fixed-size card on its own (you can also scroll it by hand).
  useEffect(() => {
    const doc = docRef.current; const flowEl = docFlowRef.current;
    if (!doc || !flowEl || !(showDiff || showFinal) || closing) return undefined;
    doc.scrollTop = 0;
    let raf = 0;
    const id = window.setTimeout(() => {
      const over = flowEl.scrollHeight - doc.clientHeight;
      if (over <= 2) return;
      const duration = Math.min(3400, 700 + over * 34); const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        doc.scrollTop = over * (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        if (t < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, showDiff ? 1600 : 1000);
    return () => { window.clearTimeout(id); cancelAnimationFrame(raf); };
  }, [showDiff, showFinal, closing, flow.finalText]);

  // Cinematic hand-off: a copy of the final text travels from the dictation layer to where the draft text sits,
  // easing through a slight lift, then dissolves as the real draft fades in beneath it.
  useEffect(() => {
    if (!closing) return undefined;
    const src = docFlowRef.current; const root = rootRef.current;
    const ta = root?.parentElement?.querySelector("textarea");
    const text = flow.finalText || "";
    if (!src || !ta || !text) return undefined;
    const from = src.getBoundingClientRect(); const to = ta.getBoundingClientRect(); const cs = getComputedStyle(src); const tcs = getComputedStyle(ta);
    const ghost = document.createElement("div");
    ghost.textContent = text;
    Object.assign(ghost.style, { position: "fixed", left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, margin: "0", zIndex: "2147483000", pointerEvents: "none", fontFamily: cs.fontFamily, fontSize: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, fontWeight: "480", color: "#0b1220", whiteSpace: "pre-wrap", wordBreak: "break-word", willChange: "transform, opacity, filter" });
    document.body.appendChild(ghost);
    const dx = to.left + 4 - from.left; const dy = to.top - from.top;
    const animation = ghost.animate([
      { transform: "translate(0px, 0px) scale(1)", opacity: 1, filter: "blur(0px)", lineHeight: cs.lineHeight, width: `${from.width}px` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 8}px) scale(1.02)`, opacity: 1, filter: "blur(.5px)", offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 1, filter: "blur(0px)", lineHeight: tcs.lineHeight, width: `${Math.max(120, to.width - 8)}px`, offset: 0.8 },
      { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0, filter: "blur(0px)", lineHeight: tcs.lineHeight, width: `${Math.max(120, to.width - 8)}px` },
    ], { duration: 980, easing: "cubic-bezier(.45,.05,.2,1)", fill: "forwards" });
    animation.onfinish = () => ghost.remove();
    return () => ghost.remove();
  }, [closing, flow.finalText]);

  // Waveform and outline glow follow the real microphone level.
  useEffect(() => {
    let raf = 0; let t = 0; let vol = 0.06;
    const tick = () => {
      t += 0.2;
      vol += (Math.max(levelRef.current * 1.35, 0.07) - vol) * 0.2;
      const list = bars.current; const mid = (list.length - 1) / 2;
      list.forEach((bar, i) => {
        if (!bar) return;
        const d = (i - mid) / mid; const bell = Math.exp(-(d * d) * 2.0);
        const w = (Math.sin(t + i * 0.45) + Math.sin(t * 0.7 - i * 0.25) + 2) / 4;
        bar.style.height = `${Math.round(4 + bell * (3 + w * (9 + vol * 24)))}px`;
        bar.style.opacity = String(0.35 + bell * (0.3 + Math.min(0.35, vol * 0.6)));
      });
      const root = rootRef.current;
      if (root) {
        root.style.setProperty("--lvl", phase === "listening" ? Math.min(1, vol * 1.2).toFixed(3) : "0");
        root.style.setProperty("--ring", phase === "listening" ? "0,82,251" : "15,23,42");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const diffNodes = showDiff ? flow.diff!.flatMap((seg, si) => split(seg.text).map((word, wi) => ({ key: `${si}-${wi}`, word, isDel: seg.type === "del", isAdd: seg.type === "add" }))) : [];
  const delCount = diffNodes.filter((n) => n.isDel).length;
  let di = 0; let ai = 0;

  const tag = flow.edit === "rewrite" ? "Rewriting selection" : flow.edit === "replace" ? "Replacing selection" : "Selected text";
  const status = phase === "optimising" ? "Rewriting" : thinking ? (flow.detail || "Thinking") : showDiff ? "Polishing" : "";
  const hint = hasSelection ? "Speak to replace it, or say how to change it — “make it shorter”" : "Listening…";

  return (
    <>
    <div className={`fcv ${thinking || showDiff ? "fcv-thinking" : ""} ${listening ? "fcv-listening" : ""} ${closing ? "fcv-closing" : ""}`} ref={rootRef} role="status" aria-live="polite" aria-label="Dictation">
      <style>{CSS}</style>
      {hasSelection ? (
        <div className={`fcv-sel ${flow.edit && (showDiff || showFinal) ? "dim" : ""}`}>
          <span className="fcv-tag">
            {flow.edit === "rewrite"
              ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" /></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>}
            {tag}
          </span>
          <span className="fcv-quote">{excerpt(flow.selectedText || "")}</span>
        </div>
      ) : null}
      <div className="fcv-row">
        <button type="button" className="fcv-cancel" onClick={onCancel} aria-label="Cancel dictation" title="Cancel (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className="fcv-mid">
        <div className="fcv-layer fcv-hint" style={{ opacity: !hasLive && !showDiff && !showFinal && !thinking && phase !== "error" ? 1 : 0 }}>{hint}</div>
        <div ref={liveRef} className={`fcv-layer fcv-live ${thinking ? "fcv-think" : ""}`} style={{ opacity: hasLive && !showDiff && !showFinal ? 1 : 0 }}>
          <div className="fcv-flow">
            {visibleLive.map((word, i) => (
              <LiveWord
                key={i}
                word={word}
                index={i}
                fresh={i >= freshFrom.current}
                delay={Math.max(0, i - freshFrom.current) * 55}
                bump={freshFrom.current > 0 && freshFrom.current < visibleLive.length && i >= freshFrom.current - 3 && i < freshFrom.current}
              />
            ))}
          </div>
        </div>
        <div ref={docRef} className={`fcv-layer fcv-doc ${armed ? "fcv-armed" : ""} ${showFinal ? "fcv-final" : ""}`} style={{ opacity: showDiff || showFinal ? 1 : 0 }}>
          <div className="fcv-flow fcv-docflow" ref={docFlowRef}>
            {showDiff
              ? diffNodes.map((n) => {
                  const d = n.isDel ? 600 + (di++) * 110 : n.isAdd ? 600 + delCount * 110 + 260 + (ai++) * 140 : 0;
                  return <span key={n.key} className={`fcv-w ${n.isDel ? "fcv-del" : ""} ${n.isAdd ? "fcv-add" : ""}`} style={{ ["--d" as any]: `${d}ms` }}>{n.word + " "}</span>;
                })
              : showFinal ? <PrintedText text={flow.finalText || ""} /> : null}
          </div>
        </div>
        {phase === "error" ? <div className="fcv-layer fcv-flow" style={{ color: "#b42318", fontSize: 14 }}>{flow.detail || "Something went wrong."}</div> : null}
        <div className="fcv-meter" style={{ opacity: listening && !hasLive ? 1 : 0 }} aria-hidden="true">
          {Array.from({ length: 27 }, (_, i) => <i key={i} className="fcv-bar" ref={(el) => { if (el) bars.current[i] = el; }} />)}
        </div>
        <div className={`fcv-status ${status ? "fcv-shimmer" : ""}`} style={{ opacity: status && !hasLive ? 1 : 0 }}>{status}</div>
        </div>

        <div className="fcv-end">
          <button type="button" className={`fcv-stop fcv-glyph ${listening ? "" : "off"}`} onClick={onStop} aria-label="Stop and transcribe"><i /></button>
          <span className={`fcv-spin fcv-glyph ${busy ? "" : "off"}`} aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => <i key={i} style={{ ["--i" as any]: i }} />)}
          </span>
        </div>
      </div>
    </div>
    </>
  );
}
