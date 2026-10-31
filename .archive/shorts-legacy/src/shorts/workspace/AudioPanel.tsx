// Music & SFX. Both lists come straight from the local library folders (see
// lib/shorts/library.ts) — drop a file in with Finder/Explorer and it shows up
// here the next time this panel loads. Nothing is bundled, scraped or
// downloaded; a track is only here because the user put it there.

import { useEffect, useState } from "react";
import { FolderOpen, Music, Pause, Play, Trash2, Zap } from "lucide-react";
import { shortsApi, type LibraryTrack } from "../api";
import { addSfxCue, removeSfxCue, setMusic, updateSfxCue } from "../../../lib/shorts/ops";
import type { ShortsProject } from "../../../lib/shorts/schema";
import { formatClock } from "../format";
import { Field, Slider, Toggle } from "./controls";

export type AudioPanelProps = {
  project: ShortsProject;
  timeMs: number;
  onProjectEdit: (next: ShortsProject, label: string, key?: string) => void;
};

export function AudioPanel({ project, timeMs, onProjectEdit }: AudioPanelProps) {
  const [music, setMusicTracks] = useState<LibraryTrack[] | null>(null);
  const [sfx, setSfxTracks] = useState<LibraryTrack[] | null>(null);
  const [musicFolder, setMusicFolder] = useState("");
  const [sfxFolder, setSfxFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  const refresh = () => {
    shortsApi.listLibrary("music").then((result) => { setMusicTracks(result.tracks); setMusicFolder(result.folder); }).catch((cause: Error) => setError(cause.message));
    shortsApi.listLibrary("sfx").then((result) => { setSfxTracks(result.tracks); setSfxFolder(result.folder); }).catch((cause: Error) => setError(cause.message));
  };

  useEffect(refresh, []);

  const preview = (kind: "music" | "sfx", file: string) => {
    const id = `${kind}:${file}`;
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const audio = new Audio(shortsApi.libraryFileUrl(kind, file));
    audio.play().catch(() => undefined);
    audio.onended = () => setPlaying((current) => (current === id ? null : current));
    setPlaying(id);
  };

  const selectedMusic = project.audio.music;

  return (
    <div>
      {error ? <p className="sh-error" style={{ marginBottom: 12 }}>{error}</p> : null}

      <div className="sh-row" style={{ marginBottom: 6 }}>
        <span className="sh-section-title" style={{ margin: 0 }}><Music size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 5 }} />Music</span>
        <button type="button" className="sh-btn sh-btn--sm" onClick={refresh}>Refresh</button>
      </div>

      {selectedMusic ? (
        <div className="sh-card" style={{ padding: 12, marginBottom: 10 }}>
          <div className="sh-row">
            <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleFromFile(selectedMusic.file)}</span>
            <button type="button" className="sh-icon-btn" aria-label="Remove music" onClick={() => onProjectEdit(setMusic(project, null), "Remove music")}><Trash2 size={13} strokeWidth={1.6} /></button>
          </div>
          <Field label={`Volume ${Math.round(selectedMusic.volume * 100)}%`}>
            <Slider min={0} max={1.5} step={0.05} value={selectedMusic.volume} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onProjectEdit(setMusic(project, { ...selectedMusic, volume: value }), "Set music volume", "music-volume")} />
          </Field>
          <div className="sh-row" style={{ marginTop: 10 }}>
            <span className="sh-muted" style={{ fontSize: 12.5 }}>Duck under speech</span>
            <Toggle checked={selectedMusic.duckUnderSpeech} onChange={(value) => onProjectEdit(setMusic(project, { ...selectedMusic, duckUnderSpeech: value }), value ? "Duck music under speech" : "Stop ducking music")} label="Duck music under speech" />
          </div>
          {selectedMusic.duckUnderSpeech ? (
            <Field label={`Duck amount ${Math.round(selectedMusic.duckAmount * 100)}%`} hint="A real sidechain compressor, not a volume toggle: it eases down while speech is present and recovers smoothly, not on every short pause.">
              <Slider min={0} max={1} step={0.05} value={selectedMusic.duckAmount} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onProjectEdit(setMusic(project, { ...selectedMusic, duckAmount: value }), "Set duck amount", "music-duck")} />
            </Field>
          ) : null}
        </div>
      ) : null}

      {music === null ? <p className="sh-muted" style={{ fontSize: 12.5 }}>Loading…</p> : null}
      {music && music.length === 0 ? <EmptyLibrary kind="Music" folder={musicFolder} /> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {music?.map((track) => (
          <TrackRow
            key={track.file}
            track={track}
            active={selectedMusic?.file === track.file}
            playing={playing === `music:${track.file}`}
            onPreview={() => preview("music", track.file)}
            onUse={() => onProjectEdit(setMusic(project, { file: track.file, volume: 0.7, startOffsetMs: 0, duckUnderSpeech: true, duckAmount: 0.65 }), "Set music")}
            useLabel={selectedMusic?.file === track.file ? "In use" : "Use"}
          />
        ))}
      </div>

      <div className="sh-divider" />

      <div className="sh-row" style={{ marginBottom: 6 }}>
        <span className="sh-section-title" style={{ margin: 0 }}><Zap size={12} strokeWidth={1.8} style={{ verticalAlign: -1, marginRight: 5 }} />SFX</span>
        <button type="button" className="sh-btn sh-btn--sm" onClick={refresh}>Refresh</button>
      </div>
      <p className="sh-hint" style={{ marginTop: 0 }}>Adds at the playhead ({formatClock(timeMs)}).</p>

      {sfx === null ? <p className="sh-muted" style={{ fontSize: 12.5 }}>Loading…</p> : null}
      {sfx && sfx.length === 0 ? <EmptyLibrary kind="SFX" folder={sfxFolder} /> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sfx?.map((track) => (
          <TrackRow
            key={track.file}
            track={track}
            active={false}
            playing={playing === `sfx:${track.file}`}
            onPreview={() => preview("sfx", track.file)}
            onUse={() => onProjectEdit(addSfxCue(project, track.file, timeMs).project, "Add SFX")}
            useLabel="Add"
          />
        ))}
      </div>

      {project.audio.sfx.length ? (
        <>
          <div className="sh-section-title" style={{ marginTop: 14 }}>Placed SFX</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {project.audio.sfx.map((cue) => (
              <div key={cue.id} className="sh-card" style={{ padding: "8px 10px" }}>
                <div className="sh-row">
                  <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleFromFile(cue.file)} · {formatClock(cue.atMs)}</span>
                  <button type="button" className="sh-icon-btn" aria-label="Remove SFX" onClick={() => onProjectEdit(removeSfxCue(project, cue.id), "Remove SFX")}><Trash2 size={13} strokeWidth={1.6} /></button>
                </div>
                <Slider min={0} max={1.5} step={0.05} value={cue.volume} format={(value) => `${Math.round(value * 100)}%`} onChange={(value) => onProjectEdit(updateSfxCue(project, cue.id, { volume: value }), "Set SFX volume", `sfx-volume-${cue.id}`)} />
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TrackRow({ track, active, playing, onPreview, onUse, useLabel }: { track: LibraryTrack; active: boolean; playing: boolean; onPreview: () => void; onUse: () => void; useLabel: string }) {
  return (
    <div className="sh-row" style={{ padding: "6px 8px", borderRadius: 8, background: active ? "var(--sh-blue-soft)" : "transparent" }}>
      <button type="button" className="sh-icon-btn" style={{ width: 26, height: 26 }} aria-label={playing ? "Pause preview" : "Preview"} onClick={onPreview}>
        {playing ? <Pause size={12} strokeWidth={1.8} /> : <Play size={12} strokeWidth={1.8} />}
      </button>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 6 }}>{titleFromFile(track.file)}</span>
      <span className="sh-muted" style={{ fontSize: 11, marginRight: 6, fontVariantNumeric: "tabular-nums" }}>{formatClock(track.durationMs)}</span>
      <button type="button" className="sh-btn sh-btn--sm" onClick={onUse} disabled={active}>{useLabel}</button>
    </div>
  );
}

function EmptyLibrary({ kind, folder }: { kind: string; folder: string }) {
  return (
    <div className="sh-notice" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <FolderOpen size={15} strokeWidth={1.6} style={{ marginTop: 1, flexShrink: 0 }} />
      <span>
        No {kind} files yet. Drop audio files you have the rights to use into:
        <br />
        <code style={{ fontSize: 11, wordBreak: "break-all" }}>{folder}</code>
        <br />
        They appear here automatically — no import step.
      </span>
    </div>
  );
}

function titleFromFile(file: string) {
  return file.replace(/\.[^.]+$/, "");
}
