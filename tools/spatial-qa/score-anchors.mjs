/* Anchor accuracy against ground truth, using the editor's own geometry (spatial-geometry.js).
   Usage: node score-anchors.mjs solution.json truth.json [refTimeSeconds]
   For each test point: click its true pixel in one reference frame, build the surface anchor from the solved scene, then
   compare the anchor's projection in every solved frame with the true projection. Also reports the surface normal error. */
import fs from 'node:fs';
import { surfaceAnchor, spatialPoseAt, projectWorld, anchorFrame } from '../../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/spatial-geometry.js';
const sol = JSON.parse(fs.readFileSync(process.argv[2])), truth = JSON.parse(fs.readFileSync(process.argv[3])), ref = Number(process.argv[4] ?? 1.2);
const sx = sol.width / truth.width, sy = sol.height / truth.height;
const frameAt = (us) => truth.frames.reduce((a, b) => Math.abs(b.t * 1e6 - us) < Math.abs(a.t * 1e6 - us) ? b : a);
const q = (a) => { const s = a.sort((x, y) => x - y); return { median: s[s.length >> 1], p95: s[Math.floor(s.length * .95)], max: s[s.length - 1] }; };
const normals = { wall_point: [0, 0, -1], floor_point: [0, -1, 0], left_wall_point: [1, 0, 0] };
const out = {};
for (const [name, normal] of Object.entries(normals)) {
  const refFrame = frameAt(ref * 1e6), p = refFrame[name];
  if (!(p[2] > 0) || p[0] < 8 || p[1] < 8 || p[0] > truth.width - 8 || p[1] > truth.height - 8) { out[name] = 'not visible at the reference frame'; continue; }
  try {
    const anchor = surfaceAnchor(sol, Math.round(ref * 1e6), [p[0] * sx, p[1] * sy]);
    const errs = [], drift = [];
    for (const pose of sol.shots[0].poses) {
      const f = frameAt(pose.sourceTimeUs); if (Math.abs(f.t * 1e6 - pose.sourceTimeUs) > 25000) continue;
      const g = f[name]; if (!(g[2] > 0) || g[0] < 0 || g[1] < 0 || g[0] > truth.width || g[1] > truth.height) continue;
      const e = projectWorld(anchorFrame(anchor, null, pose).position, pose); if (!e) continue;
      errs.push(Math.hypot(e.x - g[0] * sx, e.y - g[1] * sy) / sx); // in ground-truth (540-wide) pixels
    }
    // normal error in the reference camera's own axes (needs no world alignment)
    const P = spatialPoseAt(sol, Math.round(ref * 1e6)), R = P.worldToCamera.map((r) => r.slice(0, 3)), n = R.map((r) => r[0] * anchor.normal[0] + r[1] * anchor.normal[1] + r[2] * anchor.normal[2]);
    const G = refFrame.worldToCamera.map((r) => r.slice(0, 3)), gn = G.map((r) => r[0] * normal[0] + r[1] * normal[1] + r[2] * normal[2]);
    const cos = Math.abs(n[0] * gn[0] + n[1] * gn[1] + n[2] * gn[2]) / Math.hypot(...n) / Math.hypot(...gn);
    out[name] = { framesScored: errs.length, reprojectionPx: q(errs), normalErrorDeg: +(Math.acos(Math.min(1, cos)) * 180 / Math.PI).toFixed(2), support: anchor.support };
  } catch (e) { out[name] = 'anchor failed: ' + e.message; }
}
console.log(JSON.stringify(out, null, 1));
