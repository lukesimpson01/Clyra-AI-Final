// Bundled gameplay backgrounds for Fake Text Story. Scanned fresh from
// public/media/fake-text/gameplay/<category>/*.mp4 every call — no hardcoded
// catalog to go stale — so clips the project already has (see
// tools/prepare-fake-text-gameplay.sh) just show up. Each source video was
// chosen specifically because its uploader labels it no-copyright gameplay
// footage for creators; see that folder's README for exactly which ones.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const LIBRARY_ROOT = path.resolve(import.meta.dirname, "..", "..", "public", "media", "fake-text", "gameplay");

export type GameplayLibraryClip = { id: string; category: string; label: string; videoUrl: string; posterUrl: string | null };

export function scanGameplayLibrary(): GameplayLibraryClip[] {
  if (!existsSync(LIBRARY_ROOT)) return [];
  const clips: GameplayLibraryClip[] = [];
  for (const category of readdirSync(LIBRARY_ROOT, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const dir = path.join(LIBRARY_ROOT, category.name);
    for (const file of readdirSync(dir)) {
      if (!/\.mp4$/i.test(file)) continue;
      const id = file.replace(/\.mp4$/i, "");
      const poster = `${id}.jpg`;
      clips.push({
        id,
        category: category.name,
        label: id.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        videoUrl: `/media/fake-text/gameplay/${category.name}/${file}`,
        posterUrl: existsSync(path.join(dir, poster)) ? `/media/fake-text/gameplay/${category.name}/${poster}` : null,
      });
    }
  }
  return clips.sort((a, b) => (a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category)));
}

export function resolveGameplayClip(id: string): GameplayLibraryClip | null {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) return null;
  return scanGameplayLibrary().find((clip) => clip.id === id) ?? null;
}

export function gameplayClipAbsolutePath(clip: GameplayLibraryClip): string {
  return path.join(LIBRARY_ROOT, clip.category, `${clip.id}.mp4`);
}
