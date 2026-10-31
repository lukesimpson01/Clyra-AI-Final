// Shorts entry point. One component routes between the welcome page, the
// per-tool setup, the AI Clipper, the library and the editor. Everything it
// opens is a project in the same store, so tools share the same media,
// captions, render and export paths.

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, BarChart3, CircleHelp, Gamepad2, MessageSquareText, Newspaper, PlayCircle, Sparkles, Trophy, X, type LucideIcon } from "lucide-react";
import { shortsApi } from "./api";
import { kindLabel, type ComposerSource } from "./ShortsHome";
import { ShortsHomeDashboard } from "./ShortsHomeDashboard";
import { ShortsClipper } from "./ShortsClipper";
import { CreatorStudio, type CreatorStudioTool } from "./studio/CreatorStudio";
import { ShortsLibrary } from "./ShortsLibrary";
import { ShortsVideoEditor, type EditorSend } from "./ShortsVideoEditor";
import { ShortsSettings } from "./ShortsSettings";
import { ShortsWorkspace } from "./workspace/ShortsWorkspace";
import { FakeTextStoryEditor } from "./faketext/FakeTextStoryEditor";
import { WouldYouRatherEditor } from "./wyr/WouldYouRatherEditor";
import { Field, Segmented, Slider, TextArea, TextInput } from "./workspace/controls";
import type { ShortsKind, TimelineItem } from "../../lib/shorts/schema";
import "./shorts.css";

export type ShortsView =
  | { name: "home" }
  | { name: "setup"; kind: ShortsKind; prompt?: string }
  | { name: "clipper"; source: ComposerSource | null }
  | { name: "studio"; tool: CreatorStudioTool; youtubeUrl?: string }
  | { name: "video-editor"; send?: EditorSend }
  | { name: "settings" }
  | { name: "library" }
  | { name: "editor"; projectId: string };

export type ShortsAppProps = {
  entry?: ShortsView;
  /** When provided, the app shows a close control. The chat workspace uses this to return. */
  onExit?: () => void;
};

// Fake Text Story has its own dedicated editor (Script tab includes AI Writer
// and Import inline) so it skips the generic upfront generation page other
// generator kinds use.
const GENERATOR_KINDS: ShortsKind[] = ["reddit-story", "narrated-story", "quiz", "list", "gameplay-story"];

export function ShortsApp({ entry, onExit }: ShortsAppProps) {
  const [view, setView] = useState<ShortsView>(entry ?? { name: "home" });
  const [error, setError] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const openEditor = (projectId: string) => setView({ name: "editor", projectId });

  const createBlank = async (kind: ShortsKind, aspect: "9:16" | "4:5" | "1:1" | "16:9" = "9:16") => {
    if (busyTool) return;
    setError(null);
    setBusyTool(kind);
    try {
      const { project } = await shortsApi.createProject({ kind, aspect, title: kind === "cut-crop" ? "Cut and crop" : undefined, captionsEnabled: kind === "caption-video" });
      openEditor(project.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project could not be created.");
    } finally {
      setBusyTool(null);
    }
  };

  const onCreate = (kind: ShortsKind, prompt?: string) => {
    if (kind === "ai-clip") return setView({ name: "studio", tool: "clipper" });
    if (kind === "fake-text") return setView({ name: "studio", tool: "text" });
    if (kind === "would-rather") return setView({ name: "studio", tool: "wyr" });
    if (kind === "caption-video" || kind === "cut-crop") return void createBlank(kind);
    if (GENERATOR_KINDS.includes(kind)) return setView({ name: "setup", kind, prompt });
    void createBlank(kind);
  };

  if (view.name === "home") {
    // The dashboard owns its full page (sidebar, search, everything) per its
    // own spec — no generic header on top of it. Its own top-right row gets
    // the close control when Shorts is opened as an overlay from Chat.
    return (
      <div className="shorts-root" style={{ height: "100%", minHeight: 0, position: "relative", overflow: "hidden" }}>
        {error ? <div className="sh-notice" role="alert" style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 5, color: "var(--sh-danger)" }}>{error}</div> : null}
        <ShortsHomeDashboard
          onStartClipper={(source) => setView({ name: "studio", tool: "clipper", youtubeUrl: source?.kind === "youtube" ? source.source.url : undefined })}
          onCreate={onCreate}
          onOpenProject={openEditor}
          onOpenLibrary={() => setView({ name: "library" })}
          onOpenVideoEditor={() => setView({ name: "video-editor" })}
          onOpenSettings={() => setView({ name: "settings" })}
          userName="Luke"
          onClose={onExit}
          busyTool={busyTool}
        />
      </div>
    );
  }

  return (
    <div className="shorts-root" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {view.name !== "editor" && view.name !== "video-editor" && view.name !== "clipper" && view.name !== "studio" ? (
        <header className="sh-app-topbar">
          <div className="sh-app-brand">
            <img src="/media/shorts-studio-v2/shorts-studio-v2-001.png" alt="" />
            <span>Creator Studio</span>
            <span className="sh-app-crumb">/</span>
            <span className="sh-app-current">{view.name === "library" ? "Projects" : view.name === "settings" ? "Settings" : view.name === "setup" ? kindLabel(view.kind) : "Studio"}</span>
          </div>
          <div className="sh-app-actions">
            {view.name !== "library" ? <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={() => setView({ name: "library" })}>Library</button> : null}
            {view.name !== "settings" ? <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={() => setView({ name: "settings" })}>Settings</button> : null}
            <button type="button" className="sh-btn sh-btn--ghost sh-btn--sm" onClick={() => setView({ name: "home" })}><ArrowLeft size={13} strokeWidth={1.6} /> Shorts home</button>
            {onExit ? <button type="button" className="sh-icon-btn" onClick={onExit} aria-label="Close Shorts"><X size={16} strokeWidth={1.6} /></button> : null}
          </div>
        </header>
      ) : null}

      {error ? <div className="sh-notice" role="alert" style={{ margin: "12px 20px 0", color: "var(--sh-danger)" }}>{error}</div> : null}

      <div key={view.name === "editor" ? `${view.name}-${view.projectId}` : view.name} style={{ flex: 1, minHeight: 0, overflow: view.name === "editor" || view.name === "video-editor" || view.name === "studio" ? "hidden" : "auto" }} className={view.name === "editor" || view.name === "video-editor" || view.name === "studio" ? undefined : "clyra-scroll sh-route-enter"}>
        {view.name === "setup" ? <SetupView kind={view.kind} initialPrompt={view.prompt} onBack={() => setView({ name: "home" })} onCreated={openEditor} onBlank={() => void createBlank(view.kind)} /> : null}
        {view.name === "clipper" ? <ShortsClipper source={view.source} onBack={() => setView({ name: "home" })} onOpenProject={openEditor} /> : null}
        {view.name === "studio" ? <CreatorStudio tool={view.tool} youtubeUrl={view.youtubeUrl} onOpenProject={openEditor} onOpenEditor={(send) => setView({ name: "video-editor", send })} onExit={() => setView({ name: "home" })} /> : null}
        {view.name === "video-editor" ? <ShortsVideoEditor send={view.send} onBack={() => setView({ name: "home" })} /> : null}
        {view.name === "settings" ? <ShortsSettings onBack={() => setView({ name: "home" })} onOpenLibrary={() => setView({ name: "library" })} onOpenVideoEditor={() => setView({ name: "video-editor" })} /> : null}
        {view.name === "library" ? <ShortsLibrary onBack={() => setView({ name: "home" })} onOpenProject={openEditor} onCreate={(kind) => onCreate(kind)} onEditExport={(send) => setView({ name: "video-editor", send })} /> : null}
        {view.name === "editor" ? <EditorRouter projectId={view.projectId} onBack={() => setView({ name: "home" })} onOpenLibrary={() => setView({ name: "library" })} /> : null}
      </div>
    </div>
  );
}

/** Fake Text Story gets its own dedicated editor; every other kind keeps the generic unified workspace. One cheap kind lookup, then the right editor mounts and owns its own loading. */
function EditorRouter({ projectId, onBack, onOpenLibrary }: { projectId: string; onBack: () => void; onOpenLibrary: () => void }) {
  const [kind, setKind] = useState<ShortsKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setKind(null);
    shortsApi.getProject(projectId).then(({ project }) => alive && setKind(project.kind)).catch((cause) => alive && setError(cause instanceof Error ? cause.message : "This project could not be opened."));
    return () => { alive = false; };
  }, [projectId]);
  if (error) return <div className="sh-notice" style={{ margin: 20, color: "var(--sh-danger)" }}>{error}</div>;
  if (!kind) return null;
  if (kind === "fake-text") return <FakeTextStoryEditor projectId={projectId} onBack={onBack} onOpenLibrary={onOpenLibrary} />;
  if (kind === "would-rather") return <WouldYouRatherEditor projectId={projectId} onBack={onBack} onOpenLibrary={onOpenLibrary} />;
  return <ShortsWorkspace projectId={projectId} onBack={onBack} onOpenLibrary={onOpenLibrary} />;
}

const TOOL_HINTS: Record<ShortsKind, string> = {
  "ai-clip": "",
  "fake-text": "Two or more people, a clear premise, and an ending. The script is written as a chat you can edit line by line.",
  "would-rather": "Each round has two options. The percentages are simulated and labelled as such.",
  "reddit-story": "First-person story. The post reveals word by word.",
  "narrated-story": "Scenes in order. Narration needs a configured voice to export.",
  quiz: "Two to four answers per question. Check every fact before you publish.",
  list: "Ranked items that count down to number one.",
  "gameplay-story": "Writes the story text. You add the gameplay footage in the editor.",
  "caption-video": "",
  "cut-crop": "",
};

const TOOL_ICON: Partial<Record<ShortsKind, LucideIcon>> = {
  "would-rather": CircleHelp,
  "reddit-story": Newspaper,
  "narrated-story": PlayCircle,
  quiz: Trophy,
  list: BarChart3,
  "gameplay-story": Gamepad2,
  "fake-text": MessageSquareText,
};

function SetupView({ kind, initialPrompt, onBack, onCreated, onBlank }: { kind: ShortsKind; initialPrompt?: string; onBack: () => void; onCreated: (id: string) => void; onBlank: () => void }) {
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [tone, setTone] = useState("engaging");
  const [count, setCount] = useState(kind === "fake-text" ? 8 : kind === "quiz" ? 3 : kind === "list" ? 5 : 5);
  const [pace, setPace] = useState<"slow" | "natural" | "fast">("natural");
  const [countdown, setCountdown] = useState(5);
  const [relationship, setRelationship] = useState("");
  const [ending, setEnding] = useState("");
  const [mode, setMode] = useState("classic");
  const [participants, setParticipants] = useState("");
  const [narrate, setNarrate] = useState(kind === "narrated-story");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noKey, setNoKey] = useState(false);

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt.trim()) {
      setError("Describe the video first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNoKey(false);
    try {
      const generated = await shortsApi.generate({
        kind,
        prompt: prompt.trim(),
        tone,
        count,
        pace,
        countdownSeconds: countdown,
        relationship: relationship.trim() || undefined,
        ending: ending.trim() || undefined,
        mode,
        participants: participants.split(",").map((name) => name.trim()).filter(Boolean).slice(0, 4),
      });
      const { project } = await shortsApi.createProject({
        kind,
        title: generated.title,
        generated: { items: generated.items as TimelineItem[] },
        captionsEnabled: false,
        narration: { enabled: narrate, voice: "", speed: 1, volume: 1 },
        background: kind === "would-rather" || kind === "reddit-story" || kind === "quiz" ? { type: "gradient", from: "#0f1116", to: "#1b2030", angle: 160 } : { type: "gradient", from: "#f3f4f6", to: "#e7e9ee", angle: 180 },
      });
      onCreated(project.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Generation failed";
      setError(message);
      setNoKey(/DeepSeek key/i.test(message));
    } finally {
      setBusy(false);
    }
  };

  const ToolIcon = TOOL_ICON[kind] ?? Sparkles;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "30px 36px 80px" }}>
      <div className="sh-row" style={{ justifyContent: "flex-start", gap: 14, marginBottom: 8 }}>
        <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.6} /></button>
        <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(150deg, var(--sh-blue) 0%, #2f9bff 100%)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0, boxShadow: "0 8px 18px rgba(8,119,249,0.28)" }}>
          <ToolIcon size={19} strokeWidth={1.8} />
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" }}>{kindLabel(kind)}</h1>
      </div>
      <p className="sh-muted" style={{ margin: "0 0 24px 66px", fontSize: 14, lineHeight: 1.5 }}>{TOOL_HINTS[kind]}</p>

      <form onSubmit={generate} className="sh-card" style={{ padding: 26 }}>
        <Field label="What is it about?">
          <TextArea value={prompt} onChange={setPrompt} rows={4} />
        </Field>
        {kind === "fake-text" ? (
          <>
            <Field label="Participants" hint="Comma-separated names. Leave empty to let the script choose.">
              <TextInput value={participants} onChange={setParticipants} placeholder="Maya, Jordan" />
            </Field>
            <Field label="Relationship"><TextInput value={relationship} onChange={setRelationship} placeholder="Roommates, siblings, coworkers" /></Field>
            <Field label="Ending"><TextInput value={ending} onChange={setEnding} placeholder="A twist, a reveal, a happy ending" /></Field>
          </>
        ) : null}
        {kind === "would-rather" ? (
          <Field label="Mode">
            <Segmented value={mode} options={[["classic", "Classic"], ["funny", "Funny"], ["impossible", "Impossible"], ["relationship", "Relationship"], ["gaming", "Gaming"], ["food", "Food"], ["dark-humour", "Dark humour"]]} onChange={setMode} />
          </Field>
        ) : null}
        {kind === "narrated-story" ? (
          <Field label="Narrate" hint="Narration needs a configured voice. Without one, export runs silently and says so.">
            <div className="sh-row" style={{ justifyContent: "flex-start", gap: 10 }}>
              <input type="checkbox" checked={narrate} onChange={(event) => setNarrate(event.target.checked)} aria-label="Narrate the story" />
              <span className="sh-muted" style={{ fontSize: 13 }}>Add narration to each scene</span>
            </div>
          </Field>
        ) : null}
        <div className="sh-row" style={{ gap: 14, alignItems: "flex-start", justifyContent: "flex-start", flexWrap: "wrap" }}>
          <Field label="Tone">
            <select className="sh-select" style={{ width: 170 }} value={tone} onChange={(event) => setTone(event.target.value)} aria-label="Tone">
              {["engaging", "funny", "dramatic", "wholesome", "dark-humor", "educational", "suspenseful"].map((value) => <option key={value} value={value}>{value.replace("-", " ")}</option>)}
            </select>
          </Field>
          <Field label={kind === "quiz" ? "Questions" : kind === "list" ? "Items" : kind === "would-rather" ? "Rounds" : "Length"}>
            <Slider min={kind === "quiz" ? 1 : 2} max={kind === "quiz" ? 6 : 12} value={count} onChange={setCount} />
          </Field>
          {kind === "would-rather" || kind === "quiz" ? (
            <Field label="Countdown">
              <Slider min={3} max={15} value={countdown} format={(value) => `${value}s`} onChange={setCountdown} />
            </Field>
          ) : null}
          <Field label="Pace">
            <Segmented value={pace} options={[["slow", "Slow"], ["natural", "Natural"], ["fast", "Fast"]]} onChange={(value) => setPace(value as typeof pace)} />
          </Field>
        </div>
        {error ? (
          <div style={{ marginTop: 16 }}>
            <p className="sh-error" style={{ margin: 0 }}>{error}</p>
            {noKey ? <p className="sh-hint">You can still write the video by hand. Add a DeepSeek key later to generate scripts.</p> : null}
          </div>
        ) : null}
        <div className="sh-row" style={{ marginTop: 22, justifyContent: "flex-start", gap: 10 }}>
          <button type="submit" className="sh-btn sh-btn--primary" disabled={busy}>
            <Sparkles size={15} strokeWidth={1.6} /> {busy ? "Writing the script…" : "Generate script"}
          </button>
          <button type="button" className="sh-btn" disabled={busy} onClick={onBlank}>Start empty</button>
        </div>
      </form>
    </div>
  );
}
