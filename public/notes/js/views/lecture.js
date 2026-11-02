/* Lecture capture.

   The page stays an ordinary editor page; recording adds a small status strip
   and appends timestamped transcript segments. Generating clean notes creates
   a separate child page so the raw transcript is never overwritten. */
import { el, clear, icon, iconButton, modal, toast, confirmDialog, append, menu } from "../dom.js";
import { api } from "../api.js";
import { state, refreshPages, withError } from "../state.js";
import { formatTime } from "../editor.js";
import { withProgress } from "./generation.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
/* Inside the desktop app lectures use Flow's own local speech engine (the same one as the dictation hotkey):
   accurate, offline, and nothing leaves the machine. The browser's Web Speech API is only the fallback. */
const desktopSpeech = () => window.clyraDesktop?.speech || null;

const RATE = 16_000;
/* Raw audio is what speech recognition wants: call-style processing softens the first syllables. */
const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };

/** Records the microphone at 16 kHz and cuts it into phrases at natural pauses. */
async function startPhraseCapture({ onPhrase, onLevel }) {
  let deviceId = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const builtIn = devices.find((d) => d.kind === "audioinput" && d.deviceId && !/^(default|communications)$/.test(d.deviceId)
      && /built-?in|macbook|imac|studio display/i.test(d.label) && !/airpods|bluetooth|headset|beats/i.test(d.label));
    deviceId = builtIn?.deviceId || null;
  } catch { /* use the default input */ }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...RAW, deviceId: { exact: deviceId } } : RAW, video: false })
    .catch(() => navigator.mediaDevices.getUserMedia({ audio: RAW, video: false }));
  let ctx;
  try { ctx = new AudioContext({ sampleRate: RATE }); } catch { ctx = new AudioContext(); }
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain(); mute.gain.value = 0;
  const ratio = ctx.sampleRate / RATE;

  const FRAME_S = 2048 / ctx.sampleRate;
  let floor = 0.006;
  let chunks = [];           // Int16Array frames of the phrase in progress (with pre-roll)
  let preroll = [];          // the last few quiet frames, so a phrase never starts clipped
  let speaking = false, silence = 0, voiced = 0, phraseStart = 0, clock = 0;

  const toPcm = (input) => {
    const length = Math.floor(input.length / ratio);
    const out = new Int16Array(length);
    for (let i = 0; i < length; i++) {
      const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let sum = 0; for (let k = from; k < to; k++) sum += input[k];
      const v = Math.max(-1, Math.min(1, sum / (to - from)));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  };
  const flush = () => {
    if (voiced >= 0.6) {
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const pcm = new Int16Array(total);
      let offset = 0; for (const c of chunks) { pcm.set(c, offset); offset += c.length; }
      onPhrase(pcm, phraseStart);
    }
    chunks = []; speaking = false; silence = 0; voiced = 0;
  };

  node.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    onLevel?.(Math.max(0, Math.min(1, (rms - 0.006) / 0.08)));
    const frame = toPcm(input);
    const loud = rms > Math.max(0.012, floor * 2.6);
    if (!loud) floor = floor * 0.97 + rms * 0.03;
    clock += FRAME_S;
    if (!speaking) {
      preroll.push(frame); if (preroll.length > 3) preroll.shift();
      if (loud) { speaking = true; phraseStart = Math.max(0, clock - FRAME_S * preroll.length); chunks = [...preroll]; preroll = []; voiced = FRAME_S; silence = 0; }
      return;
    }
    chunks.push(frame);
    if (loud) { voiced += FRAME_S; silence = 0; } else silence += FRAME_S;
    const length = chunks.length * FRAME_S;
    /* A pause ends the phrase; a long run without one is cut so captions keep flowing. */
    if ((silence >= 0.75 && length >= 1.4) || length >= 22) flush();
  };
  source.connect(node); node.connect(mute); mute.connect(ctx.destination);

  return {
    pause: () => { flush(); ctx.suspend().catch(() => {}); },
    resume: () => ctx.resume().catch(() => {}),
    stop: () => {
      flush();
      try { node.onaudioprocess = null; node.disconnect(); source.disconnect(); mute.disconnect(); } catch { /* gone */ }
      stream.getTracks().forEach((track) => track.stop());
      ctx.close().catch(() => {});
    },
  };
}

/* Meeting and lecture notes start here: one simple box to drop a recording into. Drop it, or browse, or record live. The work carries
   on if the box is closed, and the note opens when it is ready. */
export function openLectureRecorder(app, target = {}) {
  let entry;
  let hint = "auto";
  const body = el("div", { class: "rec-box" });
  const file = el("input", { type: "file", accept: "audio/*,video/*,.m4a,.mp3,.wav,.aiff,.aac,.ogg,.flac,.webm,.mp4,.mov", style: { display: "none" } });
  file.addEventListener("change", () => { if (file.files?.[0]) transcribeFile(file.files[0]); });
  const KINDS = [["auto", "Detect"], ["meeting", "Meeting"], ["lecture", "Lecture"], ["brainstorm", "Brainstorm"], ["voice_memo", "Memo"]];
  const cloud = () => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 48 48"); svg.setAttribute("width", "44"); svg.setAttribute("height", "44"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M15 32a8 8 0 0 1-1.4-15.9A11 11 0 0 1 34.8 14 9 9 0 0 1 35 32M24 38V22m0 0-6 6m6-6 6 6"); svg.append(path); return svg; };

  const paintChoices = () => {
    clear(body);
    const zone = el("div", { class: "rec-zone", tabindex: "0", role: "button", "aria-label": "Drop a recording here or browse" },
      el("div", { class: "rec-zone-icon" }, cloud()),
      el("div", { class: "rec-zone-title", text: "Drop a recording here" }),
      el("div", { class: "rec-zone-sub" }, "or ", el("span", { class: "rec-browse", text: "browse files" })),
      el("div", { class: "rec-zone-fine", text: "Audio or video, up to 380 MB" }));
    zone.addEventListener("click", () => file.click());
    zone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); file.click(); } });
    zone.addEventListener("dragenter", (event) => { event.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragover", (event) => { event.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", (event) => { if (!zone.contains(event.relatedTarget)) zone.classList.remove("over"); });
    zone.addEventListener("drop", (event) => { event.preventDefault(); zone.classList.remove("over"); const dropped = event.dataTransfer?.files?.[0]; if (dropped) transcribeFile(dropped); });
    const kinds = el("div", { class: "rec-kinds", role: "group", "aria-label": "What is it?" }, KINDS.map(([id, label]) =>
      el("button", { class: `rec-kind${id === hint ? " on" : ""}`, type: "button", onclick: (event) => { hint = id; kinds.querySelectorAll(".rec-kind").forEach((node) => node.classList.toggle("on", node === event.currentTarget)); } }, label)));
    append(body, zone,
      el("div", { class: "rec-foot" }, kinds, el("button", { class: "rec-live", type: "button", onclick: () => { entry.close("record"); startLiveLecture(app, target); } }, icon("mic", 15), "Record live")),
      file);
  };
  paintChoices();
  entry = modal({ title: "Meeting and lecture notes", width: 540, body, footer: [] });

  /* upload, then follow the job until the note exists */
  async function transcribeFile(source) {
    if (source.size > 380 * 1024 * 1024) { toast("That recording is over 380 MB", "error"); return; }
    const bar = el("i"); const stage = el("div", { class: "rec-stage", text: "Uploading" }); const heard = el("div", { class: "rec-heard" });
    clear(body);
    append(body, el("div", { class: "rec-zone working" }, el("div", { class: "rec-file" }, icon("mic", 16), el("span", { text: source.name })), stage, el("div", { class: "rec-bar" }, bar), heard,
      el("div", { class: "rec-zone-fine", text: "You can close this. The note opens when it is ready." })));
    const label = { converting: "Reading the audio", transcribing: "Transcribing", analysing: "Working out what was said", writing: "Writing your note", done: "Done" };
    const fail = (message) => {
      if (!body.isConnected) { toast(message, "error"); return; }
      clear(body);
      append(body, el("div", { class: "rec-zone" }, el("div", { class: "rec-error", text: message }), el("button", { class: "rec-kind", type: "button", onclick: () => paintChoices() }, "Try again")));
    };
    try {
      const response = await fetch(`/api/notes/lectures/transcribe?name=${encodeURIComponent(source.name)}&hint=${encodeURIComponent(hint)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: source });
      const started = await response.json().catch(() => ({}));
      if (!response.ok || started.error) { fail(started.error || "The upload failed."); return; }
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        const job = await api.get(`/api/notes/lectures/jobs/${started.id}`).catch(() => null);
        if (!job || (job.error && !job.status)) { fail(job?.error || "Lost track of that recording."); return; }
        if (body.isConnected) {
          stage.textContent = label[job.stage] || "Working";
          bar.style.transform = `scaleX(${Math.max(0.04, job.progress || 0)})`;
          if (job.text) heard.textContent = `\u201C${job.text.slice(-120)}\u201D`;
        }
        if (job.status === "failed") { fail(job.failure || "That recording could not be transcribed."); return; }
        if (job.status === "done") {
          entry.close("done");
          await refreshPages();
          app.openPage(String(job.result?.notePageId || job.result?.pageId));
          toast(job.result?.notePageId ? "Your note is ready" : "Transcript saved (AI is not set up, so it was not written up)");
          return;
        }
      }
    } catch (error) { fail(error?.message || "The upload failed."); }
  }
}

async function startLiveLecture(app, target = {}) {
  const session = await withError(
    () => api.post("/api/notes/lectures", { pageId: target.pageId || null, title: target.title }),
    "Could not start the lecture",
  );
  if (!session) return;
  await refreshPages();
  app.openPage(session.page.id);
  /* The recorder mounts once the lecture page's own view has drawn (opening a page is asynchronous), so the strip
     sits against the page it is transcribing rather than the view that was on screen before. */
  const pageId = String(session.page.id);
  const startedWaiting = Date.now();
  const whenReady = () => {
    const view = app.currentView;
    const ready = view?.editor && String(view.pageId ?? "") === pageId;
    if (ready || Date.now() - startedWaiting > 3000) mountRecorder(app, session);
    else setTimeout(whenReady, 50);
  };
  requestAnimationFrame(whenReady);
}

function mountRecorder(app, session) {
  const surface = document.querySelector(".surface");
  if (!surface) return;
  const existing = surface.querySelector(".lecture-strip");
  existing?.remove();

  let startedAt = Date.now();
  let elapsedBefore = 0;
  let status = "recording";
  let recognition = null;
  let segmentBase = 0;

  const timeLabel = el("span", { class: "lecture-time", text: "0:00" });
  const caption = el("div", { class: "lecture-caption", "aria-live": "polite" });
  const levelBar = el("span", { class: "lecture-level" }, el("span", { class: "lecture-level-fill" }));
  const strip = el("div", { class: "lecture-strip", role: "status" },
    el("span", { class: "lecture-dot" }),
    el("span", { class: "lecture-label", text: "Recording" }),
    timeLabel,
    levelBar,
    el("div", { class: "lecture-actions" },
      iconButton("pause", "Pause recording", () => togglePause()),
      iconButton("stop", "Stop and save", () => stop()),
    ));
  strip.append(caption);
  surface.append(strip);

  const elapsed = () => elapsedBefore + (status === "recording" ? (Date.now() - startedAt) / 1000 : 0);
  const tick = setInterval(() => { timeLabel.textContent = formatTime(elapsed()); }, 500);

  const appendSegment = async (text, start) => {
    if (!text.trim()) return;
    await api.post(`/api/notes/lectures/${session.session.id}/segments`, { start, end: elapsed(), text: text.trim() }).catch(() => {});
    appendToPage(text.trim(), start);
  };

  /* Segments land in a transcript block on the page so the student can see
     the capture happening in the document they will keep. */
  const appendToPage = (text, start) => {
    const editor = app.currentView?.editor;
    if (!editor) return;
    let block = editor.flat().map((entry) => entry.block).find((candidate) => candidate.type === "transcript");
    if (!block) {
      block = { id: `b${Date.now().toString(36)}t`, type: "transcript", text: [], props: { segments: [] }, children: [] };
      editor.blocks.push(block);
    }
    block.props = { ...block.props, segments: [...(block.props.segments || []), { start, text }] };
    block.__dirty = true;
    editor.render();
    editor.commit("transcript", true);
  };

  /* Phrases are transcribed one at a time, in order, so the transcript never reshuffles. */
  let capture = null;
  let queue = Promise.resolve();
  let pendingPhrases = 0;
  const paintCaption = (text, busy) => {
    caption.classList.toggle("busy", Boolean(busy));
    if (text !== undefined) caption.textContent = text;
  };
  const startLocal = async () => {
    const speech = desktopSpeech();
    void speech.warm();
    capture = await startPhraseCapture({
      onLevel: (level) => { levelBar.firstChild.style.transform = `scaleX(${0.06 + level * 0.94})`; },
      onPhrase: (pcm, start) => {
        pendingPhrases += 1;
        paintCaption(undefined, true);
        queue = queue.then(async () => {
          const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
          const result = await speech.transcribe(bytes, RATE).catch((error) => ({ ok: false, error: error?.message }));
          pendingPhrases -= 1;
          if (result?.ok && result.text?.trim()) {
            paintCaption(result.text.trim(), pendingPhrases > 0);
            await appendSegment(result.text, start);
          } else paintCaption(undefined, pendingPhrases > 0);
        });
      },
    }).catch((error) => {
      toast(error?.name === "NotAllowedError" ? "Microphone access was refused. Allow it for Clyra in System Settings." : "Could not open the microphone.", "error");
      stop({ silent: true });
      return null;
    });
    if (capture) strip.querySelector(".lecture-label").textContent = "Recording";
  };

  const startRecognition = () => {
    if (desktopSpeech()) {
      if (capture) capture.resume(); else void startLocal();
      return;
    }
    if (!Recognition) {
      strip.querySelector(".lecture-label").textContent = "Recording (no live transcription)";
      levelBar.hidden = true;
      toast("This browser cannot transcribe live. You can paste a transcript when you stop.", "error");
      return;
    }
    recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-GB";
    let segmentStart = elapsed();
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal) continue;
        appendSegment(result[0].transcript, segmentStart);
        segmentStart = elapsed();
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast("Microphone access was refused. Allow it in your browser settings, then start again.", "error");
        stop({ silent: true });
        return;
      }
      if (event.error === "no-speech") return;
      toast(`Transcription stopped: ${event.error}`, "error");
    };
    /* Chrome ends recognition on silence; restarting keeps a long lecture in
       one continuous capture. */
    recognition.onend = () => { if (status === "recording") { try { recognition.start(); } catch { /* already starting */ } } };
    try { recognition.start(); } catch { toast("Could not start transcription.", "error"); }
  };

  const togglePause = () => {
    if (status === "recording") {
      elapsedBefore = elapsed();
      status = "paused";
      recognition?.stop();
      capture?.pause();
      strip.classList.add("paused");
      strip.querySelector(".lecture-label").textContent = "Paused";
      api.post(`/api/notes/lectures/${session.session.id}/status`, { status: "paused" }).catch(() => {});
    } else {
      startedAt = Date.now();
      status = "recording";
      strip.classList.remove("paused");
      strip.querySelector(".lecture-label").textContent = "Recording";
      startRecognition();
      api.post(`/api/notes/lectures/${session.session.id}/status`, { status: "recording" }).catch(() => {});
    }
  };

  const stop = async ({ silent = false } = {}) => {
    status = "ended";
    clearInterval(tick);
    recognition?.stop();
    recognition = null;
    capture?.stop();
    capture = null;
    strip.classList.add("leaving");
    /* Let the last phrases finish transcribing before the lecture is read back. */
    if (pendingPhrases) { strip.querySelector(".lecture-label").textContent = "Finishing transcript"; }
    await queue.catch(() => {});
    setTimeout(() => strip.remove(), 200);
    await api.post(`/api/notes/lectures/${session.session.id}/status`, { status: "ended" }).catch(() => {});
    const lecture = await withError(() => api.get(`/api/notes/lectures/${session.session.id}`), "Could not load the lecture");
    if (silent) return;
    finishDialog(app, session, lecture);
  };

  startRecognition();
}

function finishDialog(app, session, lecture) {
  const captured = (lecture?.segments || []).length;
  const pasteField = el("textarea", { class: "textarea", placeholder: "Paste a transcript here if live transcription was unavailable…", style: { minHeight: "120px" } });
  let entry;
  entry = modal({
    title: "Lecture finished",
    width: 540,
    body: el("div", {},
      el("p", { class: "view-lead", text: captured
        ? `${captured} transcript segment${captured === 1 ? "" : "s"} captured. The raw transcript stays on this page.`
        : "No speech was transcribed. You can paste a transcript below." }),
      captured ? null : el("label", { class: "field" }, pasteField)),
    footer: [
      el("button", { class: "button", type: "button", onclick: () => entry.close("later") }, "Keep transcript only"),
      state.aiConfigured
        ? el("button", { class: "button primary", type: "button", onclick: async (event) => {
            const button = event.currentTarget;
            if (!captured && pasteField.value.trim()) {
              await api.post(`/api/notes/lectures/${session.session.id}/segments`, { start: 0, text: pasteField.value.trim() }).catch(() => {});
            } else if (!captured) {
              toast("Paste a transcript first", "error");
              return;
            }
            const footer = entry.node.querySelector(".modal-footer");
            if (footer) footer.hidden = true;
            const result = await withProgress(entry.node.querySelector(".modal-body"), {
              title: "Writing your lecture notes",
              art: "doc",
              stages: ["Reading the transcript", "Tidying the wording", "Laying out your notes", "Adding definitions and questions"],
              run: async (loader) => {
                loader.advance(1);
                const response = await api.post(`/api/notes/lectures/${session.session.id}/notes`, {});
                if (response?.error) throw new Error(response.error);
                loader.advance(3);
                return response;
              },
            }).catch(() => null);
            if (!result?.page) { entry.close("failed"); return; }
            entry.close("generated");
            await refreshPages();
            app.openPage(result.page.id);
          } }, "Generate clean notes")
        : null,
    ].filter(Boolean),
  });
}
