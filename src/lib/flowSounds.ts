/**
 * Soft, layered UI sounds for Clyra Flow dictation (same family as the floating pill): synthesised with
 * WebAudio, no assets. Rising = on, falling = off, a bright triad = done.
 */
let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;

function ensure(): AudioContext | null {
  try {
    if (ctx) { if (ctx.state === "suspended") void ctx.resume(); return ctx; }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const master = ctx.createGain(); master.gain.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200; lp.Q.value = 0.4;
    const dry = ctx.createGain(); const wet = ctx.createGain(); wet.gain.value = 0.26;
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 0.55);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    conv.buffer = ir;
    lp.connect(dry); dry.connect(master); lp.connect(conv); conv.connect(wet); wet.connect(master); master.connect(ctx.destination);
    bus = lp;
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}

function note(freq: number, at: number, dur: number, { gain = 0.14, glide = 0, harm = 0.22, attack = 0.012 } = {}) {
  const c = ensure();
  if (!c || !bus) return;
  const t0 = c.currentTime + 0.005 + at;
  for (const [mult, g] of [[1, gain], [2, gain * harm]] as const) {
    const osc = c.createOscillator(); const amp = c.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(freq * mult, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide * mult, t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0); amp.gain.exponentialRampToValueAtTime(g, t0 + attack); amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp); amp.connect(bus); osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
}

export type FlowSound = "start" | "stop" | "done" | "cancel" | "error";
export function playFlowSound(kind: FlowSound) {
  try {
    if (kind === "start") { note(523.25, 0, 0.16, { gain: 0.12 }); note(783.99, 0.075, 0.26, { gain: 0.13 }); }
    else if (kind === "stop") { note(659.25, 0, 0.13, { gain: 0.11 }); note(493.88, 0.07, 0.22, { gain: 0.11 }); }
    else if (kind === "done") { note(659.25, 0, 0.18, { gain: 0.11 }); note(830.61, 0.08, 0.2, { gain: 0.11 }); note(1046.5, 0.16, 0.42, { gain: 0.12 }); }
    else if (kind === "cancel") note(440, 0, 0.2, { gain: 0.1, glide: 261.63 });
    else note(196, 0, 0.22, { gain: 0.13, harm: 0.1 }), note(155.56, 0.16, 0.34, { gain: 0.13, harm: 0.1 });
  } catch { /* audio is best-effort */ }
}
