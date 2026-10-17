// Caption Studio. Word timings come from transcription (or are corrected by the
// user); the style controls change how those timings are drawn. The preview and
// the export both read the same style, so what is shown here is what renders.

import { useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Star, Trash2, Wand2 } from "lucide-react";
import { shortsApi } from "../api";
import { CAPTION_PRESET_BUILTINS, mergePresets } from "../../../lib/shorts/caption-presets";
import { captionPages, estimateWordTimings } from "../../../lib/shorts/templates";
import { normaliseCaptionStyle, type CaptionPreset, type CaptionStyle, type CaptionWord, type ShortsProject } from "../../../lib/shorts/schema";
import { setCaptionStyle, setCaptionWords } from "../../../lib/shorts/ops";
import type { JobSnapshot } from "../api";
import { JobPanel } from "./JobPanel";
import { Field, Segmented, Slider, Toggle } from "./controls";

const FONTS = ["Inter", "Helvetica Neue", "Arial Black", "Georgia", "Menlo", "Impact", "Avenir Next", "system-ui"];
const ANIMATIONS: Array<[CaptionStyle["animation"], string]> = [
  ["none", "None"], ["fade", "Fade"], ["pop", "Pop"], ["scale", "Scale"], ["bounce", "Bounce"], ["slide", "Slide"],
  ["highlight", "Highlight"], ["karaoke", "Karaoke fill"], ["type-on", "Type on"], ["pulse", "Pulse"],
];

export type CaptionStudioProps = {
  project: ShortsProject;
  onProjectEdit: (next: ShortsProject, label: string, key?: string) => void;
  onTranscribe: (model: "tiny" | "base" | "small") => void;
  job: JobSnapshot | null;
  onCancelJob: () => void;
};

export function CaptionStudio({ project, onProjectEdit, onTranscribe, job, onCancelJob }: CaptionStudioProps) {
  const [presets, setPresets] = useState<CaptionPreset[]>(CAPTION_PRESET_BUILTINS);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [model, setModel] = useState<"tiny" | "base" | "small">("base");
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [presetName, setPresetName] = useState("");
  const style = project.captions.style;
  const hasSource = Boolean(project.source?.file);
  const busy = job?.status === "queued" || job?.status === "running";

  useEffect(() => {
    let alive = true;
    shortsApi
      .listPresets()
      .then(({ presets: saved }) => alive && setPresets(mergePresets(saved)))
      .catch((error: Error) => alive && setPresetError(error.message));
    return () => {
      alive = false;
    };
  }, []);

  const savePresets = async (next: CaptionPreset[]) => {
    setPresets(next);
    try {
      await shortsApi.savePresets(next.filter((preset) => !preset.builtin));
      setPresetError(null);
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : "Presets could not be saved");
    }
  };

  const updateStyle = (patch: Partial<CaptionStyle>, label: string, key?: string) => {
    onProjectEdit(setCaptionStyle(project, normaliseCaptionStyle({ ...style, ...patch })), label, key ?? `caption-${Object.keys(patch).join(",")}`);
  };

  const applyPreset = (preset: CaptionPreset) => {
    onProjectEdit(setCaptionStyle(project, normaliseCaptionStyle({ ...preset.style, presetId: preset.id })), `Apply ${preset.name} captions`);
  };

  const saveCurrentAsPreset = () => {
    const name = presetName.trim().slice(0, 60) || `Custom ${presets.filter((preset) => !preset.builtin).length + 1}`;
    const id = `user-${Date.now().toString(36)}`;
    void savePresets([...presets, { id, name, builtin: false, style: normaliseCaptionStyle({ ...style, presetId: id }) }]);
    setPresetName("");
  };

  const pages = useMemo(() => captionPages(project.captions.words, style.wordsPerPage), [project.captions.words, style.wordsPerPage]);

  const replaceAll = () => {
    if (!search) return;
    const words = project.captions.words.map((word) => ({ ...word, text: word.text.split(search).join(replace) }));
    onProjectEdit(setCaptionWords(project, words), "Search and replace captions");
  };

  const editPage = (pageIndex: number, value: string) => {
    const page = pages[pageIndex];
    if (!page) return;
    const replacement = estimateWordTimings(value, page.startMs, page.endMs);
    if (!replacement.length) return;
    const before = project.captions.words.filter((word) => word.startMs < page.startMs || word.startMs >= page.endMs);
    const next: CaptionWord[] = [...before, ...replacement];
    onProjectEdit(setCaptionWords(project, next), "Edit caption text", `caption-page-${pageIndex}`);
  };

  return (
    <div>
      <div className="sh-row" style={{ marginBottom: 6 }}>
        <span className="sh-section-title" style={{ margin: 0 }}>Captions</span>
        <Toggle checked={project.captions.enabled} onChange={(value) => onProjectEdit({ ...project, captions: { ...project.captions, enabled: value } }, value ? "Turn captions on" : "Turn captions off")} label="Captions on" />
      </div>

      <Field label="Word timing" hint={project.captions.words.length ? `${project.captions.words.length} words timed. Edit text below; timing stays with the words.` : "No words yet. Transcription finds each word's start and end from the audio."}>
        <div className="sh-row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-start" }}>
          <select className="sh-select" style={{ width: 130 }} value={model} onChange={(event) => setModel(event.target.value as "tiny" | "base" | "small")} aria-label="Transcription model" disabled={busy}>
            <option value="tiny">Fast (tiny)</option>
            <option value="base">Balanced (base)</option>
            <option value="small">Accurate (small)</option>
          </select>
          <button type="button" className="sh-btn sh-btn--primary sh-btn--sm" disabled={!hasSource || busy} onClick={() => onTranscribe(model)}>
            <Wand2 size={13} strokeWidth={1.6} /> {project.captions.words.length ? "Re-transcribe" : "Generate captions"}
          </button>
        </div>
        {!hasSource ? <p className="sh-hint">Add a video from the left panel first. Captions come from its audio.</p> : null}
      </Field>
      <JobPanel job={job} onCancel={onCancelJob} />

      <div className="sh-divider" />
      <div className="sh-section-title">Presets</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {presets.map((preset) => (
          <button key={preset.id} type="button" className="sh-btn sh-btn--sm" aria-pressed={style.presetId === preset.id} onClick={() => applyPreset(preset)} style={{ borderColor: style.presetId === preset.id ? "var(--sh-blue)" : undefined }}>
            {preset.name}{preset.isDefault ? " ★" : ""}
          </button>
        ))}
      </div>
      <div className="sh-row" style={{ marginTop: 10, gap: 6, flexWrap: "wrap", justifyContent: "flex-start" }}>
        <input className="sh-input" style={{ width: 150, height: 30 }} placeholder="Preset name" value={presetName} onChange={(event) => setPresetName(event.target.value)} aria-label="New preset name" />
        <button type="button" className="sh-btn sh-btn--sm" onClick={saveCurrentAsPreset}>Save as preset</button>
      </div>
      {presets.filter((preset) => !preset.builtin).length ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {presets.filter((preset) => !preset.builtin).map((preset) => (
            <div key={preset.id} className="sh-row" style={{ fontSize: 12.5 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preset.name}</span>
              <span style={{ display: "flex", gap: 2 }}>
                <button type="button" className="sh-icon-btn" aria-label={`Set ${preset.name} as default`} onClick={() => void savePresets(presets.map((item) => ({ ...item, isDefault: item.id === preset.id ? !item.isDefault : false })))}><Star size={14} strokeWidth={1.6} /></button>
                <button type="button" className="sh-icon-btn" aria-label={`Duplicate ${preset.name}`} onClick={() => { const id = `user-${Date.now().toString(36)}`; void savePresets([...presets, { ...preset, id, name: `${preset.name} copy`, isDefault: false }]); }}><Copy size={14} strokeWidth={1.6} /></button>
                <button type="button" className="sh-icon-btn" aria-label={`Rename ${preset.name}`} onClick={() => { const name = window.prompt("Rename preset", preset.name)?.trim(); if (name) void savePresets(presets.map((item) => (item.id === preset.id ? { ...item, name: name.slice(0, 60) } : item))); }}><Pencil size={14} strokeWidth={1.6} /></button>
                <button type="button" className="sh-icon-btn" aria-label={`Delete ${preset.name}`} onClick={() => void savePresets(presets.filter((item) => item.id !== preset.id))}><Trash2 size={14} strokeWidth={1.6} /></button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {presetError ? <p className="sh-error" style={{ marginTop: 8 }}>{presetError}</p> : null}

      <div className="sh-divider" />
      <div className="sh-section-title">Type</div>
      <Field label="Font">
        <select className="sh-select" value={style.font} onChange={(event) => updateStyle({ font: event.target.value }, "Change font")} aria-label="Caption font">
          {FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
      </Field>
      <div className="sh-row" style={{ gap: 10 }}>
        <Field label={`Weight ${style.weight}`}><Slider min={300} max={900} step={100} value={style.weight} onChange={(value) => updateStyle({ weight: value }, "Change weight")} /></Field>
      </div>
      <Field label={`Size ${style.size}`}><Slider min={20} max={120} value={style.size} onChange={(value) => updateStyle({ size: value }, "Change size", "caption-size")} /></Field>
      <Field label={`Line height ${style.lineHeight.toFixed(2)}`}><Slider min={0.8} max={2} step={0.02} value={style.lineHeight} format={(value) => value.toFixed(2)} onChange={(value) => updateStyle({ lineHeight: value }, "Change line height", "caption-lh")} /></Field>
      <Field label={`Letter spacing ${style.letterSpacing}`}><Slider min={-4} max={20} value={style.letterSpacing} onChange={(value) => updateStyle({ letterSpacing: value }, "Change letter spacing", "caption-ls")} /></Field>
      <Field label="Case">
        <Segmented value={style.caseMode} options={[["none", "As typed"], ["upper", "UPPER"], ["lower", "lower"], ["title", "Title"]]} onChange={(value) => updateStyle({ caseMode: value as CaptionStyle["caseMode"] }, "Change case")} />
      </Field>
      <Field label="Alignment">
        <Segmented value={style.align} options={[["left", "Left"], ["center", "Centre"], ["right", "Right"]]} onChange={(value) => updateStyle({ align: value as CaptionStyle["align"] }, "Change alignment")} />
      </Field>

      <div className="sh-divider" />
      <div className="sh-section-title">Position</div>
      <Field label="Placement">
        <Segmented value={style.position} options={[["top", "Top"], ["center", "Centre"], ["bottom", "Bottom"]]} onChange={(value) => updateStyle({ position: value as CaptionStyle["position"] }, "Change placement")} />
      </Field>
      <Field label={`Offset from edge ${style.offsetPercent}%`} hint="Bottom captions stay above the platform controls at 20%. Turn on the safe area to check.">
        <Slider min={0} max={60} value={style.offsetPercent} format={(value) => `${value}%`} onChange={(value) => updateStyle({ offsetPercent: value }, "Change offset", "caption-offset")} />
      </Field>
      <Field label={`Max width ${style.maxWidthPercent}%`}><Slider min={40} max={100} value={style.maxWidthPercent} format={(value) => `${value}%`} onChange={(value) => updateStyle({ maxWidthPercent: value }, "Change width", "caption-width")} /></Field>
      <Field label={`Words per line ${style.wordsPerPage}`}><Slider min={1} max={12} value={style.wordsPerPage} onChange={(value) => updateStyle({ wordsPerPage: value }, "Change words per page")} /></Field>

      <div className="sh-divider" />
      <div className="sh-section-title">Colour and outline</div>
      <div className="sh-row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
        <ColorField label="Text" value={style.color} onChange={(value) => updateStyle({ color: value }, "Change text colour", "caption-color")} />
        <ColorField label="Active word" value={style.activeColor} onChange={(value) => updateStyle({ activeColor: value }, "Change active colour", "caption-active")} />
        <ColorField label="Emphasis" value={style.emphasisColor} onChange={(value) => updateStyle({ emphasisColor: value }, "Change emphasis colour", "caption-emph")} />
      </div>
      <Field label={`Outline ${style.strokeWidth}px`}><Slider min={0} max={12} value={style.strokeWidth} format={(value) => `${value}px`} onChange={(value) => updateStyle({ strokeWidth: value }, "Change outline", "caption-stroke")} /></Field>
      <div className="sh-row" style={{ marginTop: 8 }}>
        <span className="sh-muted" style={{ fontSize: 12.5 }}>Shadow</span>
        <Toggle checked={style.shadow} onChange={(value) => updateStyle({ shadow: value }, "Toggle shadow")} label="Caption shadow" />
      </div>
      <div className="sh-row" style={{ marginTop: 10 }}>
        <span className="sh-muted" style={{ fontSize: 12.5 }}>Background box</span>
        <Toggle checked={style.box.enabled} onChange={(value) => updateStyle({ box: { ...style.box, enabled: value } }, "Toggle caption box")} label="Caption background box" />
      </div>
      {style.box.enabled ? (
        <>
          <div className="sh-row" style={{ gap: 10, marginTop: 8, justifyContent: "flex-start" }}>
            <ColorField label="Box" value={style.box.color} onChange={(value) => updateStyle({ box: { ...style.box, color: value } }, "Change box colour", "caption-box-color")} />
          </div>
          <Field label={`Box opacity ${Math.round(style.box.opacity * 100)}%`}><Slider min={0} max={1} step={0.05} value={style.box.opacity} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => updateStyle({ box: { ...style.box, opacity: value } }, "Change box opacity", "caption-box-opacity")} /></Field>
          <Field label={`Corner radius ${style.box.radius}px`}><Slider min={0} max={80} value={style.box.radius} format={(value) => `${value}px`} onChange={(value) => updateStyle({ box: { ...style.box, radius: value } }, "Change corner radius", "caption-box-radius")} /></Field>
          <Field label={`Padding ${style.box.padding}px`}><Slider min={0} max={60} value={style.box.padding} format={(value) => `${value}px`} onChange={(value) => updateStyle({ box: { ...style.box, padding: value } }, "Change padding", "caption-box-pad")} /></Field>
        </>
      ) : null}

      <div className="sh-divider" />
      <div className="sh-section-title">Word animation</div>
      <Field label="Animation">
        <select className="sh-select" value={style.animation} onChange={(event) => updateStyle({ animation: event.target.value as CaptionStyle["animation"] }, "Change animation")} aria-label="Caption animation">
          {ANIMATIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label={`Duration ${style.animationMs}ms`}><Slider min={40} max={800} step={20} value={style.animationMs} format={(value) => `${value}ms`} onChange={(value) => updateStyle({ animationMs: value }, "Change animation duration", "caption-anim-ms")} /></Field>
      <Field label={`Intensity ${Math.round(style.intensity * 100)}%`}><Slider min={0} max={1} step={0.05} value={style.intensity} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => updateStyle({ intensity: value }, "Change intensity", "caption-intensity")} /></Field>
      <p className="sh-hint">Animations start at each word's timestamp and never run on a timer.</p>

      <div className="sh-divider" />
      <div className="sh-section-title">Transcript</div>
      {project.captions.words.length === 0 ? (
        <p className="sh-hint">Generate captions to edit the transcript here.</p>
      ) : (
        <>
          <div className="sh-row" style={{ gap: 6, justifyContent: "flex-start", flexWrap: "wrap" }}>
            <input className="sh-input" style={{ width: 110, height: 30 }} placeholder="Find" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Find in transcript" />
            <input className="sh-input" style={{ width: 110, height: 30 }} placeholder="Replace" value={replace} onChange={(event) => setReplace(event.target.value)} aria-label="Replace with" />
            <button type="button" className="sh-btn sh-btn--sm" onClick={replaceAll} disabled={!search}>Replace all</button>
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }} className="clyra-scroll">
            {pages.map((page, index) => (
              <div key={`${page.startMs}-${index}`}>
                <div className="sh-muted" style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{Math.floor(page.startMs / 1000)}s</div>
                <textarea className="sh-textarea" rows={2} aria-label={`Caption line ${index + 1}`} value={page.words.map((word) => word.text).join(" ")} onChange={(event) => editPage(index, event.target.value)} style={{ minHeight: 0, fontSize: 13 }} />
              </div>
            ))}
          </div>
        </>
      )}
      <p className="sh-hint" style={{ marginTop: 14 }}>Built-in presets are read-only. Duplicate one to change it.</p>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
      <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} style={{ width: 30, height: 30, border: 0, background: "none", padding: 0 }} />
      <span className="sh-muted">{label}</span>
    </label>
  );
}

