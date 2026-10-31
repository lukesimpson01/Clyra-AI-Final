import { useRef, useState } from "react";
import { Pause, Play, Search } from "lucide-react";
import { SHORTS_VOICES } from "../../../lib/shorts/voices";
import type { ShortsProject } from "../../../lib/shorts/schema";

type Props = { project: ShortsProject; onUpdate: (updater: (prev: ShortsProject) => ShortsProject) => void };

export function AudioTab({ project, onUpdate }: Props) {
  const narration = project.narration;
  const [query, setQuery] = useState("");
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const patch = (value: Partial<ShortsProject["narration"]>) => {
    onUpdate((prev) => ({ ...prev, narration: { ...prev.narration, ...value } }));
  };

  const previewVoice = async (voiceName: string) => {
    if (previewingVoice === voiceName) {
      audioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceName);
    try {
      const response = await fetch("/api/creator/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Would you rather hear this voice?", voice: voiceName }) });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPreviewingVoice((current) => (current === voiceName ? null : current));
      await audio.play();
    } catch {
      setPreviewingVoice(null);
    }
  };

  const matches = SHORTS_VOICES.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <div className="ft-panel-header"><span className="ft-panel-title">Audio &amp; Timing</span></div>
      <div className="ft-panel-body">
        <div className="ft-section">
          <div className="ft-field-label">Narrator voice</div>
          <div className="ft-voice-panel">
            <div className="ft-voice-search-bar">
              <Search size={13} strokeWidth={2} />
              <input placeholder="Search specific voice…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search narrator voice" />
            </div>
            <div className="ft-voice-grid">
              {matches.map((name) => (
                <button key={name} type="button" className={`ft-voice-card${name === narration.voice ? " selected" : ""}`} onClick={() => patch({ voice: name, enabled: true })}>
                  <span className="ft-voice-card-name">{name}</span>
                  <span role="button" tabIndex={-1} className="ft-voice-play" onClick={(event) => { event.stopPropagation(); void previewVoice(name); }} aria-label={`Preview ${name}`}>
                    {previewingVoice === name ? <Pause size={13} strokeWidth={2.2} /> : <Play size={13} strokeWidth={2.2} style={{ marginLeft: 1 }} />}
                  </span>
                </button>
              ))}
              {matches.length === 0 ? <p className="ft-voice-empty">No voices match "{query}"</p> : null}
            </div>
          </div>
          {!narration.voice ? <p style={{ fontSize: 11.5, color: "var(--ft-ink-3)", marginTop: 8 }}>Pick a voice to narrate each question. Without one, export runs silently.</p> : null}
        </div>

        <div className="ft-divider" />

        <div className="ft-control-grid">
          <div>
            <div className="ft-field-label">Speed</div>
            <div className="ft-slider-row">
              <input type="range" min={60} max={160} value={Math.round(narration.speed * 100)} onChange={(event) => patch({ speed: Number(event.target.value) / 100 })} />
              <span className="ft-slider-value">{Math.round(narration.speed * 100)}%</span>
            </div>
          </div>
          <div>
            <div className="ft-field-label">Volume</div>
            <div className="ft-slider-row">
              <input type="range" min={0} max={150} value={Math.round(narration.volume * 100)} onChange={(event) => patch({ volume: Number(event.target.value) / 100 })} />
              <span className="ft-slider-value">{Math.round(narration.volume * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
