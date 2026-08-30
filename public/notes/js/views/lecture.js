/* Lecture capture.

   The page stays an ordinary editor page; recording adds a small status strip
   and appends timestamped transcript segments. Generating clean notes creates
   a separate child page so the raw transcript is never overwritten. */
import { el, clear, icon, iconButton, modal, toast, confirmDialog } from "../dom.js";
import { api } from "../api.js";
import { state, refreshPages, withError } from "../state.js";
import { formatTime } from "../editor.js";

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export async function openLectureRecorder(app, target = {}) {
  const session = await withError(
    () => api.post("/api/notes/lectures", { pageId: target.pageId || null, title: target.title }),
    "Could not start the lecture",
  );
  if (!session) return;
  await refreshPages();
  app.openPage(session.page.id);
  /* The recorder mounts after the page view has drawn, so the strip sits
     against the page it is transcribing. */
  requestAnimationFrame(() => mountRecorder(app, session));
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

  const startRecognition = () => {
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
    strip.remove();
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
            button.disabled = true;
            button.textContent = "Writing notes…";
            const result = await withError(() => api.post(`/api/notes/lectures/${session.session.id}/notes`, {}), "Could not generate notes");
            button.disabled = false;
            button.textContent = "Generate clean notes";
            if (!result?.page) return;
            entry.close("generated");
            await refreshPages();
            app.openPage(result.page.id);
          } }, "Generate clean notes")
        : null,
    ].filter(Boolean),
  });
}
