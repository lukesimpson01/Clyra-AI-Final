// Contextual inspector. What it shows depends on the selection and the tool:
// the selected item's fields, the project's settings, the background, captions
// or export. Each control writes one schema field through the workspace edit
// path, so every change is undoable and saved.

import { useState } from "react";
import { ArrowBigUp, Copy, Download, MessageCircle, Scissors, Trash2 } from "lucide-react";
import { SHORTS_VOICES } from "../../../lib/shorts/voices";
import { applyPace, setBackground } from "../../../lib/shorts/ops";
import { SHORTS_ASPECTS, SHORTS_FPS_OPTIONS, SHORTS_RESOLUTIONS, type ShortsBackground, type ShortsProject, type TimelineItem } from "../../../lib/shorts/schema";
import type { JobSnapshot } from "../api";
import { CaptionStudio } from "./CaptionStudio";
import { AudioPanel } from "./AudioPanel";
import { JobPanel } from "./JobPanel";
import { Field, Segmented, Slider, TextArea, TextInput, Toggle } from "./controls";
import { formatClock } from "../format";
import { relativeTime } from "../ShortsHome";

export type InspectorTab = "item" | "captions" | "audio" | "background" | "export";

export type InspectorProps = {
  project: ShortsProject;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  selectedItem: TimelineItem | null;
  timeMs: number;
  onPatchItem: (id: string, patch: Partial<TimelineItem>, label: string) => void;
  onDeleteSelected: () => void;
  onDuplicate: () => void;
  onSplit: () => void;
  onProjectEdit: (next: ShortsProject, label: string, mergeKey?: string) => void;
  onTranscribe: (model: "tiny" | "base" | "small") => void;
  onExport: (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high" }) => void;
  onCutExport: (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high"; copyStreams: boolean }) => void;
  job: JobSnapshot | null;
  onCancelJob: () => void;
  rippleDelete: boolean;
  onRippleChange: (value: boolean) => void;
  onProjectRefresh: () => void;
};

const TAB_LABELS: Record<InspectorTab, string> = { item: "Edit", captions: "Captions", audio: "Music & SFX", background: "Background", export: "Export" };

export function Inspector(props: InspectorProps) {
  const { project, tab, onTab } = props;
  const isCut = project.kind === "cut-crop";
  const tabs: InspectorTab[] = isCut ? ["background", "export"] : ["item", "captions", "audio", "background", "export"];
  const active = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div style={{ padding: "12px 14px 24px" }}>
      <div className="sh-segmented" role="tablist" aria-label="Inspector" style={{ display: "flex", width: "100%", flexWrap: "wrap" }}>
        {tabs.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={active === value} onClick={() => onTab(value)} style={{ flex: 1, whiteSpace: "nowrap" }}>
            {isCut && value === "background" ? "Cut & crop" : TAB_LABELS[value]}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        {active === "item" ? <ItemPanel {...props} /> : null}
        {active === "captions" ? <CaptionStudio project={project} onProjectEdit={props.onProjectEdit} onTranscribe={props.onTranscribe} job={props.job} onCancelJob={props.onCancelJob} /> : null}
        {active === "audio" ? <AudioPanel project={project} timeMs={props.timeMs} onProjectEdit={props.onProjectEdit} /> : null}
        {active === "background" && !isCut ? <BackgroundPanel project={project} onProjectEdit={props.onProjectEdit} /> : null}
        {active === "background" && isCut ? <CutSettingsPanel project={project} onProjectEdit={props.onProjectEdit} /> : null}
        {active === "export" ? <ExportPanel {...props} /> : null}
      </div>
    </div>
  );
}

function ItemPanel(props: InspectorProps) {
  const { project, selectedItem, onPatchItem, onDeleteSelected, onDuplicate, onSplit, rippleDelete, onRippleChange } = props;
  if (!selectedItem) return <ProjectPanel {...props} />;
  const id = selectedItem.id;
  const patch = (value: Partial<TimelineItem>, label: string) => onPatchItem(id, value, label);
  return (
    <div>
      <div className="sh-section-title">{labelForType(selectedItem.type)}</div>
      {selectedItem.type === "message" ? (
        <>
          <Field label="Sender"><TextInput value={selectedItem.sender} onChange={(value) => patch({ sender: value.slice(0, 40) }, "Edit sender")} /></Field>
          <Field label="Message"><TextArea value={selectedItem.text} onChange={(value) => patch({ text: value.slice(0, 280), typingMs: 900 + Math.min(1700, value.length * 32) }, "Edit message")} /></Field>
          <div className="sh-row" style={{ gap: 10 }}>
            <Field label="Side">
              <Segmented value={selectedItem.side} options={[["left", "Them"], ["right", "Me"]]} onChange={(value) => patch({ side: value as "left" | "right" }, "Change side")} />
            </Field>
            <Field label="Reaction">
              <TextInput value={selectedItem.reaction ?? ""} onChange={(value) => patch({ reaction: value.slice(0, 4) || undefined }, "Set reaction")} placeholder="None" />
            </Field>
          </div>
          {selectedItem.side === "right" ? (
            <Field label="Receipt">
              <Segmented value={selectedItem.receipt ?? "none"} options={[["none", "None"], ["delivered", "Delivered"], ["read", "Read"]]} onChange={(value) => patch({ receipt: value as "none" | "delivered" | "read" }, "Set receipt")} />
            </Field>
          ) : null}
        </>
      ) : null}
      {selectedItem.type === "choice" ? (
        <>
          <Field label="Question"><TextArea value={selectedItem.question} onChange={(value) => patch({ question: value.slice(0, 160) }, "Edit question")} /></Field>
          <div className="sh-wyr-split" style={{ marginBottom: 14 }}>
            <div className="sh-wyr-half sh-wyr-half--a" style={{ flex: Math.max(18, selectedItem.leftPercent) }}>
              <span className="sh-wyr-percent">{selectedItem.leftPercent}%</span>
              <input className="sh-wyr-option-input" value={selectedItem.left} onChange={(event) => patch({ left: event.target.value.slice(0, 90) }, "Edit option A")} aria-label="Option A" placeholder="Option A" />
            </div>
            <div className="sh-wyr-or">OR</div>
            <div className="sh-wyr-half sh-wyr-half--b" style={{ flex: Math.max(18, 100 - selectedItem.leftPercent) }}>
              <span className="sh-wyr-percent">{100 - selectedItem.leftPercent}%</span>
              <input className="sh-wyr-option-input" value={selectedItem.right} onChange={(event) => patch({ right: event.target.value.slice(0, 90) }, "Edit option B")} aria-label="Option B" placeholder="Option B" />
            </div>
          </div>
          <Field label={`Simulated split: ${selectedItem.leftPercent}% / ${100 - selectedItem.leftPercent}%`} hint="Generated percentages are simulated, not audience data. They are labelled that way on screen.">
            <Slider min={5} max={95} value={selectedItem.leftPercent} onChange={(value) => patch({ leftPercent: value }, "Set split")} />
          </Field>
          <Field label={`Countdown: ${selectedItem.countdownSeconds}s`}>
            <Slider min={3} max={15} value={selectedItem.countdownSeconds} onChange={(value) => patch({ countdownSeconds: value }, "Set countdown")} />
          </Field>
        </>
      ) : null}
      {selectedItem.type === "quiz" ? (
        <>
          <Field label="Question"><TextArea value={selectedItem.question} onChange={(value) => patch({ question: value.slice(0, 180) }, "Edit question")} /></Field>
          {selectedItem.answers.map((answer, index) => (
            <div key={index} className="sh-row" style={{ gap: 8, marginTop: 8 }}>
              <input type="radio" name={`correct-${id}`} aria-label={`Answer ${index + 1} is correct`} checked={selectedItem.correctIndex === index} onChange={() => patch({ correctIndex: index }, "Mark correct answer")} />
              <TextInput value={answer} onChange={(value) => patch({ answers: selectedItem.answers.map((item, position) => (position === index ? value.slice(0, 90) : item)) }, "Edit answer")} />
            </div>
          ))}
          <div className="sh-row" style={{ marginTop: 10, gap: 8 }}>
            <button type="button" className="sh-btn sh-btn--sm" disabled={selectedItem.answers.length >= 4} onClick={() => patch({ answers: [...selectedItem.answers, "New answer"] }, "Add answer")}>Add answer</button>
            <button type="button" className="sh-btn sh-btn--sm" disabled={selectedItem.answers.length <= 2} onClick={() => patch({ answers: selectedItem.answers.slice(0, -1), correctIndex: Math.min(selectedItem.correctIndex, selectedItem.answers.length - 2) }, "Remove answer")}>Remove last</button>
          </div>
          <Field label="Explanation"><TextArea value={selectedItem.explanation} onChange={(value) => patch({ explanation: value.slice(0, 240) }, "Edit explanation")} /></Field>
          <p className="sh-hint">Check every answer yourself. Generated quiz content can be wrong.</p>
        </>
      ) : null}
      {selectedItem.type === "list-item" ? (
        <>
          <Field label="Title"><TextInput value={selectedItem.title} onChange={(value) => patch({ title: value.slice(0, 100) }, "Edit title")} /></Field>
          <Field label="Detail"><TextArea value={selectedItem.body} onChange={(value) => patch({ body: value.slice(0, 240) }, "Edit detail")} /></Field>
        </>
      ) : null}
      {selectedItem.type === "story" ? (
        <>
          <div className="sh-reddit-card">
            <div className="sh-reddit-card-top">
              <span className="sh-reddit-avatar">{(selectedItem.author[0] || "u").toUpperCase()}</span>
              <input className="sh-reddit-author-input" value={selectedItem.author} onChange={(event) => patch({ author: event.target.value.slice(0, 40) }, "Edit author")} aria-label="Author" placeholder="u/anonymous" />
            </div>
            <textarea className="sh-reddit-title-input" rows={2} value={selectedItem.title} onChange={(event) => patch({ title: event.target.value.slice(0, 120) }, "Edit post title")} aria-label="Post title" placeholder="Post title" />
            <div className="sh-reddit-stats">
              <span><ArrowBigUp size={14} strokeWidth={2.2} /> {selectedItem.upvotes}</span>
              <span><MessageCircle size={13} strokeWidth={2} /> {selectedItem.comments}</span>
            </div>
          </div>
          <div className="sh-row" style={{ gap: 10, marginTop: 10 }}>
            <Field label="Upvotes"><TextInput value={String(selectedItem.upvotes)} onChange={(value) => patch({ upvotes: Math.max(0, Number(value.replace(/\D/g, "")) || 0) }, "Edit upvotes")} /></Field>
            <Field label="Comments"><TextInput value={String(selectedItem.comments)} onChange={(value) => patch({ comments: Math.max(0, Number(value.replace(/\D/g, "")) || 0) }, "Edit comments")} /></Field>
          </div>
          <Field label="Story"><TextArea value={selectedItem.body} onChange={(value) => patch({ body: value.slice(0, 2000) }, "Edit story")} rows={6} /></Field>
        </>
      ) : null}
      {selectedItem.type === "title" ? (
        <>
          <Field label="Title"><TextInput value={selectedItem.text} onChange={(value) => patch({ text: value.slice(0, 120) }, "Edit title")} /></Field>
          <Field label="Subtitle"><TextInput value={selectedItem.subtitle ?? ""} onChange={(value) => patch({ subtitle: value.slice(0, 120) }, "Edit subtitle")} placeholder="Optional" /></Field>
        </>
      ) : null}
      {selectedItem.type === "narration" ? (
        <Field label="Narration"><TextArea value={selectedItem.text} onChange={(value) => patch({ text: value.slice(0, 320) }, "Edit narration")} /></Field>
      ) : null}

      <div className="sh-divider" />
      <div className="sh-row" style={{ gap: 10 }}>
        <Field label="Starts">
          <TextInput value={formatClock(selectedItem.startMs)} readOnly onChange={() => undefined} />
        </Field>
        <Field label="Length">
          <TextInput value={formatClock(selectedItem.durationMs)} readOnly onChange={() => undefined} />
        </Field>
      </div>
      <p className="sh-hint">Drag blocks on the timeline to move them, or drag a block's right edge to change its length. Arrow keys nudge the selection.</p>
      <div className="sh-row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
        <button type="button" className="sh-btn sh-btn--sm" onClick={onDuplicate}><Copy size={13} strokeWidth={1.6} /> Duplicate</button>
        <button type="button" className="sh-btn sh-btn--sm" onClick={onSplit} disabled={!["narration", "title", "list-item"].includes(selectedItem.type)} title="Split at the playhead"><Scissors size={13} strokeWidth={1.6} /> Split</button>
        <button type="button" className="sh-btn sh-btn--sm sh-btn--danger" onClick={onDeleteSelected}><Trash2 size={13} strokeWidth={1.6} /> Delete</button>
      </div>
      <div className="sh-row" style={{ marginTop: 14 }}>
        <span className="sh-muted" style={{ fontSize: 12.5 }}>Close the gap when deleting (ripple)</span>
        <Toggle checked={rippleDelete} onChange={onRippleChange} label="Ripple delete" />
      </div>
      <p className="sh-hint">{project.items.length} items in this project.</p>
    </div>
  );
}

function ProjectPanel({ project, onProjectEdit, rippleDelete, onRippleChange, timeMs }: InspectorProps) {
  const isStory = project.kind !== "ai-clip" && project.kind !== "cut-crop" && project.kind !== "caption-video" && project.kind !== "gameplay-story";
  return (
    <div>
      <div className="sh-section-title">Project</div>
      <Field label="Aspect ratio">
        <Segmented
          value={project.aspect}
          options={SHORTS_ASPECTS.map((aspect) => [aspect, aspect] as [string, string])}
          onChange={(value) => onProjectEdit({ ...project, aspect: value as ShortsProject["aspect"] }, "Change aspect ratio")}
        />
      </Field>
      {isStory ? (
        <Field label="Message style" hint="Chat themes use this look. Other templates ignore it.">
          <Segmented
            value={project.template.style}
            options={[["imessage", "iMessage"], ["whatsapp", "WhatsApp"], ["dusk", "Dusk"]]}
            onChange={(value) => onProjectEdit({ ...project, template: { ...project.template, style: value } }, "Change message style")}
          />
        </Field>
      ) : null}
      <Field label="Timing pace" hint="Scales every generated timing together. Undo restores the previous pace.">
        <Segmented
          value={project.template.pace}
          options={[["slow", "Slow"], ["natural", "Natural"], ["fast", "Fast"], ["custom", "Custom"]]}
          onChange={(value) => onProjectEdit(applyPace(project, value as "slow" | "natural" | "fast" | "custom"), "Change pace")}
        />
        {project.template.pace === "custom" ? (
          <div style={{ marginTop: 10 }}>
            <Slider min={0.4} max={2.5} step={0.05} value={project.template.paceCustom} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => onProjectEdit(applyPace(project, "custom", value), "Set custom pace", "pace-custom")} />
          </div>
        ) : null}
      </Field>
      <Field label="Narration" hint="Narration needs a real voice. If none is configured, export runs without narration and says so.">
        <div className="sh-row">
          <span className="sh-muted" style={{ fontSize: 13 }}>{project.narration.enabled ? "On" : "Off"}</span>
          <Toggle checked={project.narration.enabled} onChange={(value) => onProjectEdit({ ...project, narration: { ...project.narration, enabled: value, voice: project.narration.voice || SHORTS_VOICES[0] } }, value ? "Turn narration on" : "Turn narration off")} label="Narration" />
        </div>
        {project.narration.enabled ? (
          <select className="sh-select" style={{ marginTop: 10 }} value={project.narration.voice || SHORTS_VOICES[0]} onChange={(event) => onProjectEdit({ ...project, narration: { ...project.narration, voice: event.target.value } }, "Change voice")} aria-label="Narration voice">
            {SHORTS_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
          </select>
        ) : null}
      </Field>
      <Field label="Project length" hint="Leave on automatic to fit the timeline. Set a length to hold the last frame longer.">
        <div className="sh-row">
          <span className="sh-muted" style={{ fontSize: 13 }}>{project.durationMs ? `${Math.round(project.durationMs / 1000)}s fixed` : "Automatic"}</span>
          <button type="button" className="sh-btn sh-btn--sm" onClick={() => onProjectEdit({ ...project, durationMs: project.durationMs ? null : Math.max(3000, timeMs + 3000) }, project.durationMs ? "Use automatic length" : "Fix project length")}>{project.durationMs ? "Use automatic" : "Fix length"}</button>
        </div>
      </Field>
      <div className="sh-row" style={{ marginTop: 14 }}>
        <span className="sh-muted" style={{ fontSize: 12.5 }}>Close the gap when deleting (ripple)</span>
        <Toggle checked={rippleDelete} onChange={onRippleChange} label="Ripple delete" />
      </div>
      <div className="sh-notice" style={{ marginTop: 18 }}>
        Select a block on the timeline to edit its text and timing.
      </div>
    </div>
  );
}

function BackgroundPanel({ project, onProjectEdit }: { project: ShortsProject; onProjectEdit: (next: ShortsProject, label: string, key?: string) => void }) {
  const background = project.background;
  const hasSource = Boolean(project.source?.file);
  const kind = background.type;
  const setKind = (value: "solid" | "gradient" | "video") => {
    if (value === kind) return;
    if (value === "solid") onProjectEdit(setBackground(project, { type: "solid", color: "#0f1116" }), "Set solid background");
    if (value === "gradient") onProjectEdit(setBackground(project, { type: "gradient", from: "#0f1116", to: "#1b2030", angle: 160 }), "Set gradient background");
    if (value === "video" && hasSource) onProjectEdit(setBackground(project, { type: "video", file: project.source!.file!, trimStartMs: 0, speed: 1, dim: 0.25, zoom: 1, offsetX: 0, offsetY: 0, blurPx: 0, muted: false }), "Set video background");
  };
  const video = background.type === "video" ? background : null;
  const patchVideo = (patch: Partial<Extract<ShortsBackground, { type: "video" }>>, label: string) => {
    if (!video) return;
    onProjectEdit(setBackground(project, { ...video, ...patch }), label, `bg-${Object.keys(patch).join(",")}`);
  };
  return (
    <div>
      <div className="sh-section-title">Background</div>
      <Field label="Type">
        <Segmented value={kind} options={[["solid", "Solid"], ["gradient", "Gradient"], ["video", "Video"]]} onChange={(value) => setKind(value as "solid" | "gradient" | "video")} />
      </Field>
      {!hasSource && kind !== "video" ? <p className="sh-hint">Add a video from the left panel to use it as a background.</p> : null}
      {background.type === "solid" ? (
        <Field label="Colour">
          <input type="color" aria-label="Background colour" value={background.color} onChange={(event) => onProjectEdit(setBackground(project, { type: "solid", color: event.target.value }), "Change background colour", "bg-solid")} style={{ width: 56, height: 36, border: 0, background: "none" }} />
        </Field>
      ) : null}
      {background.type === "gradient" ? (
        <>
          <Field label="From"><input type="color" aria-label="Gradient start colour" value={background.from} onChange={(event) => onProjectEdit(setBackground(project, { ...background, from: event.target.value }), "Change gradient", "bg-grad-from")} style={{ width: 56, height: 36, border: 0, background: "none" }} /></Field>
          <Field label="To"><input type="color" aria-label="Gradient end colour" value={background.to} onChange={(event) => onProjectEdit(setBackground(project, { ...background, to: event.target.value }), "Change gradient", "bg-grad-to")} style={{ width: 56, height: 36, border: 0, background: "none" }} /></Field>
          <Field label={`Angle: ${background.angle}°`}><Slider min={0} max={360} value={background.angle} onChange={(value) => onProjectEdit(setBackground(project, { ...background, angle: value }), "Change gradient angle", "bg-grad-angle")} /></Field>
        </>
      ) : null}
      {video ? (
        <>
          <Field label={`Start in source: ${(video.trimStartMs / 1000).toFixed(1)}s`}>
            <Slider min={0} max={Math.max(0, (project.source?.durationMs ?? 0) - 500)} step={100} value={video.trimStartMs} format={(value) => `${(value / 1000).toFixed(1)}s`} onChange={(value) => patchVideo({ trimStartMs: value }, "Set video start")} />
          </Field>
          <Field label={`Speed: ${video.speed.toFixed(2)}×`}><Slider min={0.25} max={4} step={0.05} value={video.speed} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => patchVideo({ speed: value }, "Set video speed")} /></Field>
          <Field label={`Dim: ${Math.round(video.dim * 100)}%`} hint="Dimming keeps captions and text legible over busy footage."><Slider min={0} max={0.9} step={0.05} value={video.dim} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => patchVideo({ dim: value }, "Set dimming")} /></Field>
          <Field label={`Zoom: ${video.zoom.toFixed(2)}×`}><Slider min={1} max={3} step={0.05} value={video.zoom} format={(value) => `${value.toFixed(2)}×`} onChange={(value) => patchVideo({ zoom: value }, "Set zoom")} /></Field>
          <Field label={`Horizontal framing: ${video.offsetX}%`}><Slider min={-50} max={50} value={video.offsetX} format={(value) => `${value}%`} onChange={(value) => patchVideo({ offsetX: value }, "Set horizontal framing")} /></Field>
          <Field label={`Vertical framing: ${video.offsetY}%`}><Slider min={-50} max={50} value={video.offsetY} format={(value) => `${value}%`} onChange={(value) => patchVideo({ offsetY: value }, "Set vertical framing")} /></Field>
          <Field label={`Blur: ${video.blurPx}px`}><Slider min={0} max={40} value={video.blurPx} format={(value) => `${value}px`} onChange={(value) => patchVideo({ blurPx: value }, "Set blur")} /></Field>
          <p className="sh-hint">Footage shorter than the timeline loops to fill it. Loop seams are not hidden.</p>
        </>
      ) : null}
    </div>
  );
}

function CutSettingsPanel({ project, onProjectEdit }: { project: ShortsProject; onProjectEdit: (next: ShortsProject, label: string, key?: string) => void }) {
  const source = project.source;
  if (!source) return <p className="sh-notice">Add a source video from the left panel first.</p>;
  const video = project.background.type === "video" ? project.background : null;
  const inMs = video?.trimStartMs ?? 0;
  const outMs = Math.min(source.durationMs, inMs + (project.durationMs ?? source.durationMs - inMs));
  const setRange = (nextIn: number, nextOut: number) => {
    const start = Math.max(0, Math.min(nextIn, nextOut - 500));
    const end = Math.min(source.durationMs, Math.max(nextOut, start + 500));
    onProjectEdit({ ...project, durationMs: end - start, background: { type: "video", file: source.file!, trimStartMs: start, speed: 1, dim: 0, zoom: 1, offsetX: 0, offsetY: 0, blurPx: 0, muted: false } }, "Set cut range", "cut-range");
  };
  return (
    <div>
      <div className="sh-section-title">Range</div>
      <Field label={`In: ${formatClock(inMs)}`}><Slider min={0} max={source.durationMs} step={100} value={inMs} format={(value) => formatClock(value)} onChange={(value) => setRange(value, outMs)} /></Field>
      <Field label={`Out: ${formatClock(outMs)}`}><Slider min={0} max={source.durationMs} step={100} value={outMs} format={(value) => formatClock(value)} onChange={(value) => setRange(inMs, value)} /></Field>
      <p className="sh-hint">Length: {formatClock(outMs - inMs)} of {formatClock(source.durationMs)}.</p>
      <div className="sh-section-title" style={{ marginTop: 16 }}>Crop</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {[
          ["Full frame", null],
          ["9:16 centre", { x: centreX(source, 9 / 16), y: 0, w: centreW(source, 9 / 16), h: 1 }],
          ["1:1 centre", { x: centreX(source, 1), y: 0, w: centreW(source, 1), h: 1 }],
          ["4:5 centre", { x: centreX(source, 4 / 5), y: 0, w: centreW(source, 4 / 5), h: 1 }],
          ["16:9 band", { x: 0, y: (1 - (source.width * 9) / 16 / source.height) / 2, w: 1, h: Math.min(1, (source.width * 9) / 16 / source.height) }],
        ].map(([label, crop]) => (
          <button key={label as string} type="button" className="sh-btn sh-btn--sm" aria-pressed={JSON.stringify(project.crop) === JSON.stringify(crop)} onClick={() => onProjectEdit({ ...project, crop: crop as ShortsProject["crop"] }, "Set crop", "crop-preset")}>{label as string}</button>
        ))}
      </div>
      <p className="sh-hint">Crops are applied to the source frame before scaling to the output size.</p>
    </div>
  );
}

function centreW(source: NonNullable<ShortsProject["source"]>, targetRatio: number) {
  const sourceRatio = source.width / source.height;
  return Math.min(1, targetRatio / sourceRatio);
}

function centreX(source: NonNullable<ShortsProject["source"]>, targetRatio: number) {
  return (1 - centreW(source, targetRatio)) / 2;
}

function ExportPanel(props: InspectorProps) {
  const { project, job, onExport, onCutExport, onCancelJob } = props;
  const isCut = project.kind === "cut-crop";
  const sourceFps = project.source?.fps ?? 60;
  const availableFps = SHORTS_FPS_OPTIONS.filter((fps) => !project.source || fps <= Math.ceil(sourceFps) || fps <= 30);
  const pendingRender = job && (job.status === "queued" || job.status === "running");
  return (
    <ExportForm
      key={project.id}
      isCut={isCut}
      availableFps={availableFps}
      defaultFps={Math.min(project.settings.fps, availableFps.at(-1) ?? 30)}
      defaultResolution={project.settings.resolution}
      disabled={Boolean(pendingRender)}
      onExport={onExport}
      onCutExport={onCutExport}
      job={job}
      onCancelJob={onCancelJob}
      exportsList={project.exports}
      projectId={project.id}
    />
  );
}

function ExportForm({ isCut, availableFps, defaultFps, defaultResolution, disabled, onExport, onCutExport, job, onCancelJob, exportsList, projectId }: {
  isCut: boolean;
  availableFps: readonly number[];
  defaultFps: number;
  defaultResolution: 720 | 1080;
  disabled: boolean;
  onExport: (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high" }) => void;
  onCutExport: (options: { resolution: 720 | 1080; fps: number; quality: "fast" | "balanced" | "high"; copyStreams: boolean }) => void;
  job: JobSnapshot | null;
  onCancelJob: () => void;
  exportsList: ShortsProject["exports"];
  projectId: string;
}) {
  const [resolution, setResolution] = useState<720 | 1080>(defaultResolution);
  const [fps, setFps] = useState<number>(defaultFps);
  const [quality, setQuality] = useState<"fast" | "balanced" | "high">("balanced");
  const [copyStreams, setCopyStreams] = useState(false);
  return (
    <div>
      <div className="sh-section-title">Export</div>
      <Field label="Resolution" hint={resolution === 1080 ? "1080p. Upscaled if the source is smaller, and the file says so." : "720p, faster to render."}>
        <Segmented value={String(resolution)} options={SHORTS_RESOLUTIONS.map((value) => [String(value), `${value}p`] as [string, string])} onChange={(value) => setResolution(Number(value) as 720 | 1080)} />
      </Field>
      <Field label="Frame rate" hint="Only rates at or below the source frame rate are offered for camera footage.">
        <select className="sh-select" aria-label="Frame rate" value={fps} onChange={(event) => setFps(Number(event.target.value))}>
          {availableFps.map((value) => <option key={value} value={value}>{value} fps</option>)}
        </select>
      </Field>
      <Field label="Quality">
        <Segmented value={quality} options={[["fast", "Fast"], ["balanced", "Balanced"], ["high", "High"]]} onChange={(value) => setQuality(value as "fast" | "balanced" | "high")} />
      </Field>
      {isCut ? (
        <div className="sh-row" style={{ marginTop: 14 }}>
          <span className="sh-muted" style={{ fontSize: 12.5 }}>Copy streams (no re-encode, keyframe cuts)</span>
          <Toggle checked={copyStreams} onChange={setCopyStreams} label="Copy streams" />
        </div>
      ) : null}
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button
          type="button"
          className="sh-btn sh-btn--primary"
          disabled={disabled}
          onClick={() => (isCut ? onCutExport({ resolution, fps, quality, copyStreams }) : onExport({ resolution, fps, quality }))}
        >
          <Download size={15} strokeWidth={1.6} /> Export MP4
        </button>
      </div>
      <JobPanel job={job} onCancel={onCancelJob} />
      {exportsList.length ? (
        <>
          <div className="sh-section-title" style={{ marginTop: 18 }}>Exports</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...exportsList].reverse().map((record) => (
              <div key={record.id} className="sh-card" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.file}</div>
                <div className="sh-muted" style={{ fontSize: 11.5 }}>
                  {record.resolution}p · {record.fps} fps · {formatClock(record.durationMs)} · {(record.bytes / 1_000_000).toFixed(1)} MB · {relativeTime(record.createdAt)}
                </div>
                <a className="sh-btn sh-btn--sm" style={{ alignSelf: "flex-start", textDecoration: "none" }} href={`/api/shorts/projects/${projectId}/exports/${encodeURIComponent(record.file)}?download=1`}>
                  <Download size={13} strokeWidth={1.6} /> Download
                </a>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}


function labelForType(type: TimelineItem["type"]) {
  const labels: Record<TimelineItem["type"], string> = {
    message: "Chat message",
    choice: "Would you rather",
    quiz: "Quiz question",
    "list-item": "List item",
    story: "Story",
    title: "Title card",
    narration: "Narration",
  };
  return labels[type];
}
