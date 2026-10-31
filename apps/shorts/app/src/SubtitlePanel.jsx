import React, { useMemo, useState } from "react";
import { Plus, Trash2, Palette, Type as TypeIcon, AlignVerticalJustifyCenter, Sparkles, LayoutGrid } from "lucide-react";

/* Subtitle menu: Edit lists the cues; Style is split into sections that each fit
   without scrolling. Style edits apply to every subtitle (like Crayo) and are
   remembered so newly added cues inherit them. */
const SECTIONS = [
  ["Presets", LayoutGrid],
  ["Text", TypeIcon],
  ["Position", AlignVerticalJustifyCenter],
  ["Colors", Palette],
  ["Motion", Sparkles],
];
export const SUBTITLE_POSITIONS = { Top: 14, Middle: 50, Bottom: 80 };
const caseModes = [["AA", "upper"], ["aa", "lower"], ["Aa", "title"]];
const fmtT = (n) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toFixed(2).padStart(5, "0")}`;

export default function SubtitlePanel({ onBack, cfg, layers, change, add, time, duration, selected, setSelected, style, setStyle, fileInput, choice, setChoice }) {
  const { StyleThumbnail, captionStyles, lineStyles, fonts, subAnimations, captionPaint } = cfg;
  const [tab, setTab] = useState("Edit");
  const [section, setSection] = useState("Presets");
  const subs = useMemo(() => layers.filter((l) => l.kind === "subtitle").sort((a, b) => a.start - b.start), [layers]);
  const sectionIndex = SECTIONS.findIndex(([name]) => name === section);

  const apply = (patch) => {
    setStyle((old) => ({ ...old, ...patch }));
    change((items) => items.map((item) => (item.kind === "subtitle" ? { ...item, ...patch } : item)));
  };
  const place = (name) => apply({ y: SUBTITLE_POSITIONS[name], x: 50, anchor: name === "Middle" ? "Center" : name });
  const position = Object.entries(SUBTITLE_POSITIONS).find(([, y]) => y === style.y)?.[0] || "Custom";
  const addCue = () => add({ kind: "subtitle", ...style, start: Math.min(time, Math.max(0, duration - 0.5)), duration: Math.max(0.5, Math.min(2, duration - time)), text: "Add text" });
  const patchCue = (id, patch) => change((items) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const colors = [["Appeared", "appearedColor"], ["Active", "activeColor"], ["Emphasis", "emphasisColor"], ["Outline", "outlineColor"]];
  const mode = style.captionMode || "Word";

  if (choice === "ai") {
    return (
      <div className="ae-subtitle-ai">
        <strong>AI subtitles</strong>
        <p>Speech transcription is not connected in this local editor. Upload a video and add captions manually for now.</p>
        <button onClick={() => fileInput.current?.click()}>Upload video</button>
        <button onClick={() => setChoice("manual")}>Use manual subtitles</button>
      </div>
    );
  }

  return (
    <div className="ae-sub">
      <div className="ae-sub-head">
        <button className="ae-subtitle-back" aria-label="Back to subtitle choices" onClick={onBack}>‹ <strong>Subtitles</strong></button>
        <div className="ae-sub-tabs" role="tablist">
          {["Edit", "Style"].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      </div>

      {tab === "Edit" ? (
        <div className="ae-sub-body ae-sub-edit" key="edit">
          <div className="ae-cues">
            {subs.length === 0 && <p className="ae-help">No subtitles yet. Add one at the playhead.</p>}
            {subs.map((cue) => (
              <div key={cue.id} className={"ae-cue" + (selected === cue.id ? " active" : "")} onClick={() => setSelected(cue.id)}>
                <div className="ae-cue-top">
                  <small>{fmtT(cue.start)} – {fmtT(cue.start + cue.duration)}</small>
                  <button aria-label="Delete subtitle" onClick={(e) => { e.stopPropagation(); change((items) => items.filter((i) => i.id !== cue.id)); }}><Trash2 size={14} /></button>
                </div>
                <textarea aria-label="Subtitle text" rows={2} value={cue.text} onChange={(e) => patchCue(cue.id, { text: e.target.value })} />
                <div className="ae-cue-words">
                  {String(cue.text).trim().split(/\s+/).filter(Boolean).map((w, i) => (
                    <span key={i}><i style={{ background: captionPaint[cue.styleId]?.[0] || "#fff" }} />{w}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="ae-subtitle-add" onClick={addCue}><Plus size={14} /> Add subtitle</button>
        </div>
      ) : (
        <div className="ae-sub-style">
          <div className="ae-sub-nav" style={{ "--sub-i": sectionIndex, "--sub-n": SECTIONS.length }} role="tablist" aria-label="Subtitle style sections">
            <i aria-hidden="true" />
            {SECTIONS.map(([name, Icon]) => (
              <button key={name} role="tab" aria-selected={section === name} className={section === name ? "active" : ""} onClick={() => setSection(name)} title={name}>
                <Icon size={15} />
                <span>{name}</span>
              </button>
            ))}
          </div>

          <div className="ae-sub-body" key={section}>
            {section === "Presets" && (
              <>
                <div className="ae-seg" aria-label="Subtitle display mode">
                  {["Word", "Lines"].map((m) => (
                    <button key={m} className={mode === m ? "active" : ""} onClick={() => apply(m === "Lines" ? { captionMode: m, styleId: lineStyles[0], animation: "None", textCase: "none", customColors: false } : { captionMode: m, styleId: captionStyles[0], animation: "Pop", textCase: "title", customColors: false })}>{m}</button>
                  ))}
                </div>
                <div className="ae-styles ae-styles-compact">
                  {(mode === "Lines" ? lineStyles : captionStyles).slice(0, 9).map((id) => (
                    <button key={id} className={style.styleId === id ? "active" : ""} onClick={() => apply(mode === "Lines" ? { styleId: id, customColors: false, textCase: "none", animation: "None" } : { styleId: id, customColors: false })}>
                      <StyleThumbnail mode={mode} id={id} />
                    </button>
                  ))}
                </div>
              </>
            )}

            {section === "Text" && (
              <>
                <label className="ae-sub-field"><span>Font</span>
                  <select value={style.font} onChange={(e) => apply({ font: e.target.value })}>{fonts.map((f) => <option key={f}>{f}</option>)}</select>
                </label>
                <div className="ae-row">
                  <label className="ae-sub-field"><span>Size</span>
                    <input type="number" min="24" max="260" value={style.fontSize} onChange={(e) => apply({ fontSize: Number(e.target.value) })} />
                  </label>
                  <label className="ae-sub-field"><span>Case</span>
                    <div className="ae-seg">{caseModes.map(([label, value]) => <button key={value} className={(style.textCase || "title") === value ? "active" : ""} onClick={() => apply({ textCase: value })}>{label}</button>)}</div>
                  </label>
                </div>
                <label className="ae-sub-field"><span>Outline · {style.outline < 0 ? "Off" : style.outline === 0 ? "Auto" : style.outline}</span>
                  <input type="range" min="-1" max="24" value={style.outline} onChange={(e) => apply({ outline: Number(e.target.value) })} />
                </label>
                <label className="ae-sub-field"><span>Shadow · {style.shadow}</span>
                  <input type="range" min="0" max="35" value={style.shadow} onChange={(e) => apply({ shadow: Number(e.target.value) })} />
                </label>
              </>
            )}

            {section === "Position" && (
              <>
                <div className="ae-sub-field"><span>Vertical position · centered horizontally</span>
                  <div className="ae-pos-grid">
                    {Object.keys(SUBTITLE_POSITIONS).map((name) => (
                      <button key={name} className={position === name ? "active" : ""} onClick={() => place(name)}>
                        <span className={"ae-pos-icon ae-pos-" + name.toLowerCase()} aria-hidden="true"><i /></span>
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="ae-sub-field"><span>Fine tune · {Math.round(style.y)}%</span>
                  <input type="range" min="6" max="94" value={style.y} onChange={(e) => apply({ y: Number(e.target.value), x: 50, anchor: "Free" })} />
                </label>
                <p className="ae-help">Subtitles always stay on the horizontal centre of the frame.</p>
              </>
            )}

            {section === "Colors" && (
              <>
                <div className="ae-sub-colors">
                  {colors.map(([label, key]) => (
                    <label key={key}>
                      <input type="color" value={style[key]} onChange={(e) => apply({ [key]: e.target.value, customColors: true })} />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="ae-switch">
                  <input type="checkbox" checked={!!style.preserveColor} onChange={(e) => apply({ preserveColor: e.target.checked })} />
                  <span>Preserve active color after each word</span>
                </label>
                <button className="ae-ghost" onClick={() => apply({ customColors: false })}>Reset to preset colors</button>
              </>
            )}

            {section === "Motion" && mode === "Lines" && <p className="ae-help">Line styles highlight the spoken word with their own colour. Pop, bounce and other Word animations only apply in Word mode.</p>}
            {section === "Motion" && mode !== "Lines" && (
              <>
                <div className="ae-anim ae-anim-compact">
                  {subAnimations.map((a) => <button key={a} className={style.animation === a ? "active" : ""} onClick={() => apply({ animation: a })}>{a}</button>)}
                </div>
                <label className="ae-sub-field"><span>Speed · {style.animationSpeed.toFixed(2)}s</span>
                  <input type="range" min="0.1" max="1" step="0.05" value={style.animationSpeed} onChange={(e) => apply({ animationSpeed: Number(e.target.value) })} />
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
