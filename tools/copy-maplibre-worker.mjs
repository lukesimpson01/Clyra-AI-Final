/**
 * Copy MapLibre's worker + shared chunk into public/ so the bundler serves
 * them at a stable URL. MapLibre v6 resolves its worker from import.meta.url,
 * which Vite does not emit, so these two files must exist at a known path for
 * tile parsing to run. Run before `vite build` (wired as npm `prebuild`).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "node_modules", "maplibre-gl", "dist");
const out = join(root, "public", "vendor", "maplibre");

mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(out, file));
}
console.log("[maps] maplibre worker assets copied to public/vendor/maplibre");
