/**
 * Prepare the vendored God's Eye View checkout that powers Clyra Earth.
 *
 * Installs its dependencies (it has its own tree — Cesium, vite-plugin-cesium
 * and a Vite 6 toolchain that Clyra does not share) and re-applies Clyra's
 * commercial carve-out, so a fresh clone or an upstream sync can never
 * accidentally reintroduce the NonCommercial dataset.
 *
 * See docs/clyra-earth/LICENSE_AUDIT.md for what is removed and why.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EARTH_ROOT = path.resolve(here, '..', 'vendor', 'gods-eye-view');

/**
 * Bundled payloads that are NOT licensed for commercial redistribution.
 * Deleting them is what makes Clyra Earth shippable; see the audit doc.
 */
const NONCOMMERCIAL_PAYLOADS = [
  'src/data/local_data/telegeography_submarine_cables/cable-geo.json',
  'src/data/local_data/telegeography_submarine_cables/landing-point-geo.json',
];

function fail(message) {
  console.error(`[earth:setup] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(EARTH_ROOT, 'package.json'))) {
  fail(
    'vendor/gods-eye-view is missing. Clone it first:\n' +
      '  git clone https://github.com/bilawalsidhu/gods-eye-view.git vendor/gods-eye-view',
  );
}

console.log('[earth:setup] installing God’s Eye View dependencies…');
const install = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {
  cwd: EARTH_ROOT,
  stdio: 'inherit',
});
if (install.status !== 0) fail('dependency install failed');

let removed = 0;
for (const relative of NONCOMMERCIAL_PAYLOADS) {
  const target = path.join(EARTH_ROOT, relative);
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    removed += 1;
    console.log(`[earth:setup] removed NonCommercial asset: ${relative}`);
  }
}
if (removed === 0) {
  console.log('[earth:setup] commercial carve-out already applied');
}

console.log('[earth:setup] running God’s Eye View setup doctor…');
spawnSync('npm', ['run', 'doctor'], { cwd: EARTH_ROOT, stdio: 'inherit' });

console.log('\n[earth:setup] Clyra Earth is ready. Open it from the app launcher.');
