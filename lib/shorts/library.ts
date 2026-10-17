// Local Music/SFX library. These are real folders on disk — not a database —
// so a user can drop a file in with Finder/Explorer and it shows up on the
// next list call, no code change or re-import step needed. Clyra never
// downloads or bundles commercial tracks here; everything in these folders is
// something the user put there themselves and has rights to use.

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { clyraDataPath } from "../runtime-paths";
import { isLibraryAudioFile } from "./schema";
import { probeLocalMedia } from "./media";

export type LibraryKind = "music" | "sfx";

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);

const README: Record<LibraryKind, string> = {
  music: `This folder is your Music library for Clyra Shorts.

Drop any audio file you have the rights to use here (.mp3, .wav, .m4a, .aac,
.ogg, .flac). It appears in Shorts under Library -> Music and in the editor's
Music picker automatically — there is no import step and nothing is uploaded
anywhere. Clyra does not put anything in this folder on its own and never
downloads commercial tracks.

Remove a file and it disappears from the list the next time a project opens
or the library panel refreshes. Projects that used it keep the filename on
record, so if you put the file back, it reconnects.
`,
  sfx: `This folder is your Sound Effects library for Clyra Shorts.

Drop any short audio file you have the rights to use here (.mp3, .wav, .m4a,
.aac, .ogg, .flac) and it appears in Shorts under Library -> SFX and in the
editor's SFX picker automatically. Clyra does not add anything to this folder
on its own and does not bundle or scrape sound effects with unclear licensing.
`,
};

export function libraryDir(kind: LibraryKind) {
  return clyraDataPath("shorts-library", kind);
}

/** Creates the folder (and a README inside it) the first time it's needed. Safe to call repeatedly. */
export function ensureLibraryDir(kind: LibraryKind) {
  const dir = libraryDir(kind);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, "README.txt");
  if (!existsSync(readme)) writeFileSync(readme, README[kind], "utf8");
  return dir;
}

export type LibraryTrack = {
  file: string;
  title: string;
  kind: LibraryKind;
  durationMs: number;
  bytes: number;
  addedAt: string;
  hasAudio: boolean;
};

const probeCache = new Map<string, { mtimeMs: number; bytes: number; durationMs: number; hasAudio: boolean }>();

/**
 * Scans the folder fresh every call — it's a handful of files at most, and
 * "drop a file in and it just shows up" only works if nothing is cached stale.
 * Per-file ffprobe results are cached by mtime so an unchanged file is cheap.
 */
export async function scanLibrary(kind: LibraryKind): Promise<LibraryTrack[]> {
  const dir = ensureLibraryDir(kind);
  const entries = readdirSync(dir).filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()) && isLibraryAudioFile(name));
  const tracks: LibraryTrack[] = [];
  for (const file of entries) {
    const full = path.join(dir, file);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    const cached = probeCache.get(full);
    let probed = cached && cached.mtimeMs === stat.mtimeMs ? cached : null;
    if (!probed) {
      try {
        const info = await probeLocalMedia(full);
        probed = { mtimeMs: stat.mtimeMs, bytes: stat.size, durationMs: info.durationMs, hasAudio: info.hasAudio };
        probeCache.set(full, probed);
      } catch {
        // A file that can't be probed (still copying, wrong format) is skipped rather than shown broken.
        continue;
      }
    }
    tracks.push({
      file,
      title: path.basename(file, path.extname(file)),
      kind,
      durationMs: probed.durationMs,
      bytes: stat.size,
      addedAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
      hasAudio: probed.hasAudio,
    });
  }
  return tracks.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1));
}

export function resolveLibraryFile(kind: LibraryKind, file: string): string | null {
  if (!isLibraryAudioFile(file)) return null;
  const candidate = path.join(libraryDir(kind), file);
  return existsSync(candidate) ? candidate : null;
}
