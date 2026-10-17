import { useEffect, useRef, useState } from "react";
import { Loader2, Play, Upload } from "lucide-react";
import type { ShortsBackground, ShortsProject } from "../../../lib/shorts/schema";
import { shortsApi, uploadVideoFile, type GameplayLibraryClip } from "../api";

type Props = {
  project: ShortsProject;
  onUpdate: (updater: (prev: ShortsProject) => ShortsProject) => void;
  onProjectReload: (project: ShortsProject) => void;
};

const CATEGORY_LABELS: Record<string, string> = { minecraft: "Minecraft Parkour", subway: "Subway-style", gta: "Driving" };

export function GameplayTab({ project, onUpdate, onProjectReload }: Props) {
  const [clips, setClips] = useState<GameplayLibraryClip[] | null>(null);
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    shortsApi.listGameplayLibrary().then(({ clips: list }) => alive && setClips(list)).catch(() => alive && setClips([]));
    return () => { alive = false; };
  }, []);

  const hasVideo = project.background.type === "video";
  const currentFile = hasVideo ? (project.background as Extract<ShortsBackground, { type: "video" }>).file : null;

  const pickClip = async (clip: GameplayLibraryClip) => {
    setBusy(true);
    setError(null);
    try {
      const { project: updated } = await shortsApi.attachGameplayClip(project.id, clip.id);
      onProjectReload(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That clip could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setError(null);
    setUploadProgress(0);
    try {
      const uploaded = await uploadVideoFile(file, (fraction) => setUploadProgress(fraction));
      setUploadProgress(null);
      setBusy(true);
      const { project: updated } = await shortsApi.attachUpload(project.id, uploaded.uploadId, file.name, true);
      onProjectReload(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploadProgress(null);
      setBusy(false);
    }
  };

  const categories = ["all", ...Array.from(new Set((clips ?? []).map((clip) => clip.category)))];
  const visibleClips = (clips ?? []).filter((clip) => category === "all" || clip.category === category);

  const patchBackground = (patch: Partial<Extract<ShortsBackground, { type: "video" }>>) => {
    onUpdate((prev) => (prev.background.type === "video" ? { ...prev, background: { ...prev.background, ...patch } } : prev));
  };

  const background = hasVideo ? (project.background as Extract<ShortsBackground, { type: "video" }>) : null;

  return (
    <>
      <div className="ft-panel-header"><span className="ft-panel-title">Choose Background</span></div>
      <div className="ft-panel-body">
        {error ? <div className="ft-notice error">{error}</div> : null}

        <div className="ft-section">
          <div className="ft-field-label">Upload</div>
          <button type="button" className="ft-upload-drop" style={{ width: "100%" }} onClick={() => fileInput.current?.click()} disabled={busy || uploadProgress !== null}>
            {uploadProgress !== null ? <><Loader2 size={16} style={{ animation: "ft-spin 1s linear infinite" }} /> Uploading… {Math.round(uploadProgress * 100)}%</> : <><Upload size={18} strokeWidth={1.8} style={{ marginBottom: 6 }} /><div>Click to upload a background video</div></>}
          </button>
          <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/webm" style={{ display: "none" }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onUpload(file); event.target.value = ""; }} />
        </div>

        <div className="ft-divider" />

        <div className="ft-section">
          <div className="ft-row-between" style={{ marginBottom: 10 }}>
            <span className="ft-field-label" style={{ marginBottom: 0 }}>Choose from library</span>
            <div className="ft-pill-group">
              {categories.map((value) => (
                <button key={value} type="button" className={`ft-pill${category === value ? " active" : ""}`} onClick={() => setCategory(value)}>
                  {value === "all" ? "All" : CATEGORY_LABELS[value] || value}
                </button>
              ))}
            </div>
          </div>
          {clips === null ? <p className="ft-empty">Loading…</p> : null}
          {clips && clips.length === 0 ? (
            <p className="ft-empty" style={{ padding: "16px 0" }}>
              No bundled gameplay clips found. Run <code>tools/prepare-fake-text-gameplay.sh</code> to download the no-copyright gameplay library, or upload your own video above.
            </p>
          ) : null}
          <div className="ft-library-grid">
            {visibleClips.map((clip) => (
              <button key={clip.id} type="button" className={`ft-library-card${currentFile === `assets/gameplay-${clip.id}.mp4` ? " selected" : ""}`} onClick={() => void pickClip(clip)} disabled={busy}>
                <div className="ft-library-thumb">
                  {clip.posterUrl ? <img src={clip.posterUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Play size={20} strokeWidth={1.8} />}
                </div>
                <div className="ft-library-name">{clip.label}</div>
              </button>
            ))}
          </div>
        </div>

        {background ? (
          <>
            <div className="ft-divider" />
            <div className="ft-control-grid ft-section">
              <SliderField label="Scale" value={Math.round(background.zoom * 100)} min={100} max={200} unit="%" onChange={(value) => patchBackground({ zoom: value / 100 })} />
              <SliderField label="Playback speed" value={Math.round(background.speed * 100)} min={50} max={200} unit="%" onChange={(value) => patchBackground({ speed: value / 100 })} />
              <SliderField label="Horizontal position" value={background.offsetX} min={-50} max={50} unit="%" onChange={(value) => patchBackground({ offsetX: value })} />
              <SliderField label="Vertical position" value={background.offsetY} min={-50} max={50} unit="%" onChange={(value) => patchBackground({ offsetY: value })} />
              <SliderField label="Darken" value={Math.round(background.dim * 100)} min={0} max={90} unit="%" onChange={(value) => patchBackground({ dim: value / 100 })} />
              <SliderField label="Blur" value={background.blurPx} min={0} max={40} unit="px" onChange={(value) => patchBackground({ blurPx: value })} />
              <SliderField label="Start point" value={Math.round(background.trimStartMs / 1000)} min={0} max={30} unit="s" onChange={(value) => patchBackground({ trimStartMs: value * 1000 })} />
            </div>
            <div className="ft-switch-row">
              <span style={{ fontSize: 13.5 }}>Mute original gameplay audio</span>
              <button type="button" className={`ft-switch${background.muted ? " on" : ""}`} onClick={() => patchBackground({ muted: !background.muted })} aria-pressed={background.muted}>
                <span className="ft-switch-knob" />
              </button>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--ft-ink-3)", marginTop: 4 }}>Footage loops automatically to fill the story's length.</p>
          </>
        ) : null}
      </div>
    </>
  );
}

function SliderField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="ft-field-label">{label}</div>
      <div className="ft-slider-row">
        <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="ft-slider-value">{value}{unit}</span>
      </div>
    </div>
  );
}
