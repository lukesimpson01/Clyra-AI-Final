import { useEffect, useRef, useState } from "react";
import { FolderOpen, Loader2, Pause, Play, Search, Trash2 } from "lucide-react";
import type { FakeTextVoices, ShortsProject } from "../../../lib/shorts/schema";
import { SHORTS_VOICES } from "../../../lib/shorts/voices";
import { setMusic } from "../../../lib/shorts/ops";
import { shortsApi, type LibraryTrack } from "../api";

type Props = { project: ShortsProject; onUpdate: (updater: (prev: ShortsProject) => ShortsProject, rebuild?: boolean) => void; onRebuildNow: () => void };

// Voice/typing fields change what gets synthesized or how long a bubble's
// slot is, so they need a real timeline rebuild. Volumes are a playback-time
// multiplier applied only at export/preview, never baked into the cached
// speech or the stored timing, so they only need saving.
const REBUILD_VOICE_FIELDS = new Set<keyof FakeTextVoices>(["contactVoice", "contactSpeed", "userVoice", "userSpeed", "typingIndicatorEnabled", "typingDuration", "typingDurationCustomMs"]);

export function AudioTab({ project, onUpdate, onRebuildNow }: Props) {
  const voices = project.fakeText.voices;
  const patchVoices = (patch: Partial<FakeTextVoices>) => {
    const rebuild = Object.keys(patch).some((key) => REBUILD_VOICE_FIELDS.has(key as keyof FakeTextVoices));
    onUpdate((prev) => ({ ...prev, fakeText: { ...prev.fakeText, voices: { ...prev.fakeText.voices, ...patch } } }), rebuild);
  };
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const previewVoice = async (voiceName: string) => {
    if (previewingVoice === voiceName) {
      audioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }
    setPreviewingVoice(voiceName);
    try {
      const response = await fetch("/api/creator/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hey, this is what I sound like.", voice: voiceName }) });
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

  return (
    <>
      <div className="ft-panel-header"><span className="ft-panel-title">Audio &amp; Timing</span></div>
      <div className="ft-panel-body">
        <VoiceBlock label="Contact voice" voice={voices.contactVoice} speed={voices.contactSpeed} volume={voices.contactVolume} previewingVoice={previewingVoice} onPreview={previewVoice} onChangeVoice={(value) => { patchVoices({ contactVoice: value }); onRebuildNow(); }} onChangeSpeed={(value) => patchVoices({ contactSpeed: value })} onChangeVolume={(value) => patchVoices({ contactVolume: value })} onCommit={onRebuildNow} />
        <VoiceBlock label="User voice" voice={voices.userVoice} speed={voices.userSpeed} volume={voices.userVolume} previewingVoice={previewingVoice} onPreview={previewVoice} onChangeVoice={(value) => { patchVoices({ userVoice: value }); onRebuildNow(); }} onChangeSpeed={(value) => patchVoices({ userSpeed: value })} onChangeVolume={(value) => patchVoices({ userVolume: value })} onCommit={onRebuildNow} />

        <div className="ft-divider" />

        <div className="ft-section">
          <div className="ft-field-label">Typing indicator</div>
          <div className="ft-switch-row">
            <span style={{ fontSize: 13.5 }}>Show typing indicator</span>
            <button type="button" className={`ft-switch${voices.typingIndicatorEnabled ? " on" : ""}`} onClick={() => patchVoices({ typingIndicatorEnabled: !voices.typingIndicatorEnabled })} aria-pressed={voices.typingIndicatorEnabled}>
              <span className="ft-switch-knob" />
            </button>
          </div>
          {voices.typingIndicatorEnabled ? (
            <div className="ft-pill-group" style={{ marginTop: 8 }}>
              {(["auto", "0.5", "1", "2", "custom"] as const).map((value) => (
                <button key={value} type="button" className={`ft-pill${voices.typingDuration === value ? " active" : ""}`} onClick={() => patchVoices({ typingDuration: value })}>
                  {value === "auto" ? "Auto" : value === "custom" ? "Custom" : `${value}s`}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="ft-divider" />

        <div className="ft-section">
          <div className="ft-field-label">Gameplay audio</div>
          <div className="ft-slider-row">
            <input type="range" min={0} max={100} value={Math.round(voices.gameplayAudioVolume * 100)} onChange={(event) => patchVoices({ gameplayAudioVolume: Number(event.target.value) / 100 })} />
            <span className="ft-slider-value">{Math.round(voices.gameplayAudioVolume * 100)}%</span>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--ft-ink-3)", marginTop: 4 }}>Off while the background video is muted (Gameplay Video tab). Default is off so dialogue stays clear.</p>
        </div>

        <div className="ft-divider" />

        <MusicSection project={project} onUpdate={onUpdate} />
      </div>
    </>
  );
}

function VoiceBlock({ label, voice, speed, volume, previewingVoice, onPreview, onChangeVoice, onChangeSpeed, onChangeVolume, onCommit }: {
  label: string; voice: string; speed: number; volume: number; previewingVoice: string | null;
  onPreview: (voice: string) => void; onChangeVoice: (value: string) => void; onChangeSpeed: (value: number) => void; onChangeVolume: (value: number) => void; onCommit: () => void;
}) {
  const [query, setQuery] = useState("");
  const matches = SHORTS_VOICES.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="ft-section">
      <div className="ft-field-label">{label}</div>
      <div className="ft-voice-panel">
        <div className="ft-voice-search-bar">
          <Search size={13} strokeWidth={2} />
          <input placeholder="Search specific voice…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={`Search ${label.toLowerCase()}`} />
        </div>
        <div className="ft-voice-grid">
          {matches.map((name) => (
            <button key={name} type="button" className={`ft-voice-card${name === voice ? " selected" : ""}`} onClick={() => { onChangeVoice(name); }}>
              <span className="ft-voice-card-name">{name}</span>
              <span
                role="button"
                tabIndex={-1}
                className="ft-voice-play"
                onClick={(event) => { event.stopPropagation(); onPreview(name); }}
                aria-label={`Preview ${name}`}
              >
                {previewingVoice === name ? <Pause size={13} strokeWidth={2.2} /> : <Play size={13} strokeWidth={2.2} style={{ marginLeft: 1 }} />}
              </span>
            </button>
          ))}
          {matches.length === 0 ? <p className="ft-voice-empty">No voices match "{query}"</p> : null}
        </div>
      </div>
      <div className="ft-control-grid" style={{ marginTop: 10 }}>
        <div>
          <div className="ft-field-label">Speed</div>
          <div className="ft-slider-row">
            <input type="range" min={60} max={160} value={Math.round(speed * 100)} onChange={(event) => onChangeSpeed(Number(event.target.value) / 100)} onMouseUp={onCommit} onTouchEnd={onCommit} />
            <span className="ft-slider-value">{Math.round(speed * 100)}%</span>
          </div>
        </div>
        <div>
          <div className="ft-field-label">Volume</div>
          <div className="ft-slider-row">
            <input type="range" min={0} max={150} value={Math.round(volume * 100)} onChange={(event) => onChangeVolume(Number(event.target.value) / 100)} />
            <span className="ft-slider-value">{Math.round(volume * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MusicSection({ project, onUpdate }: { project: ShortsProject; onUpdate: (updater: (prev: ShortsProject) => ShortsProject, rebuild?: boolean) => void }) {
  const [tracks, setTracks] = useState<LibraryTrack[] | null>(null);
  const [folder, setFolder] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const selected = project.audio.music;

  useEffect(() => {
    shortsApi.listLibrary("music").then((result) => { setTracks(result.tracks); setFolder(result.folder); }).catch(() => setTracks([]));
  }, []);

  const preview = (file: string) => {
    if (playing === file) { setPlaying(null); return; }
    const audio = new Audio(shortsApi.libraryFileUrl("music", file));
    void audio.play();
    audio.onended = () => setPlaying((current) => (current === file ? null : current));
    setPlaying(file);
  };

  return (
    <div className="ft-section">
      <div className="ft-field-label">Background music</div>
      {selected ? (
        <div style={{ border: "1px solid var(--ft-border)", borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div className="ft-row-between">
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.file.replace(/\.[^.]+$/, "")}</span>
            <button type="button" className="ft-icon-btn" style={{ width: 24, height: 24 }} onClick={() => onUpdate((prev) => setMusic(prev, null), false)} aria-label="Remove music"><Trash2 size={13} strokeWidth={1.8} /></button>
          </div>
          <div className="ft-slider-row" style={{ marginTop: 8 }}>
            <input type="range" min={0} max={150} value={Math.round(selected.volume * 100)} onChange={(event) => onUpdate((prev) => setMusic(prev, { ...selected, volume: Number(event.target.value) / 100 }), false)} />
            <span className="ft-slider-value">{Math.round(selected.volume * 100)}%</span>
          </div>
        </div>
      ) : null}
      {tracks === null ? <p className="ft-empty" style={{ padding: "12px 0" }}><Loader2 size={14} style={{ animation: "ft-spin 1s linear infinite" }} /></p> : null}
      {tracks && tracks.length === 0 ? (
        <div className="ft-notice" style={{ display: "flex", gap: 10 }}>
          <FolderOpen size={15} strokeWidth={1.6} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No music yet. Drop files you have the rights to use into <code style={{ fontSize: 11, wordBreak: "break-all" }}>{folder}</code> — they show up here automatically.</span>
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tracks?.filter((track) => track.file !== selected?.file).map((track) => (
          <div key={track.file} className="ft-row" style={{ padding: "5px 6px" }}>
            <button type="button" className="ft-icon-btn" style={{ width: 24, height: 24 }} onClick={() => preview(track.file)} aria-label="Preview">
              {playing === track.file ? <Pause size={12} strokeWidth={1.8} /> : <Play size={12} strokeWidth={1.8} />}
            </button>
            <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.file.replace(/\.[^.]+$/, "")}</span>
            <button type="button" className="ft-btn ft-btn--sm" onClick={() => onUpdate((prev) => setMusic(prev, { file: track.file, volume: 0.1, startOffsetMs: 0, duckUnderSpeech: true, duckAmount: 0.7 }), false)}>Use</button>
          </div>
        ))}
      </div>
    </div>
  );
}
