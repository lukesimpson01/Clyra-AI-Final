/* node refine-anchor.mjs solution.json video refSeconds x01 y01 out.json [every=3]
   Decodes the clip at half the solution's size, builds the pin the editor would, refines it photometrically, writes both. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { surfaceAnchor } from '../../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/spatial-geometry.js';
import { refineSurfaceAnchor } from '../../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/spatial-refine.js';
const [, , solPath, video, ref, cx, cy, outPath, every = '3'] = process.argv;
const sol = JSON.parse(fs.readFileSync(solPath)), w = Math.round(sol.width / 2), h = Math.round(sol.height / 2);
const poses = sol.shots.flatMap((s) => s.poses ?? []).sort((a, b) => a.sourceTimeUs - b.sourceTimeUs).filter((_, i) => i % Number(every) === 0);
const frames = poses.map((p) => {
  const buf = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(p.sourceTimeUs / 1e6), '-i', video, '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  return { timeUs: p.sourceTimeUs, gray: new Uint8Array(buf), w, h };
});
const snap = poses.reduce((a, b) => Math.abs(b.sourceTimeUs - Number(ref) * 1e6) < Math.abs(a.sourceTimeUs - Number(ref) * 1e6) ? b : a).sourceTimeUs / 1e6, t = snap, click = [Number(cx) * sol.width, Number(cy) * sol.height];
const base = surfaceAnchor(sol, Math.round(t * 1e6), click), t0 = performance.now(), r = refineSurfaceAnchor(base, sol, frames, click, Math.round(t * 1e6));
const ms = Math.round(performance.now() - t0), pick = (a) => ({ position: a.position, normal: a.normal, right: a.right, down: a.down, support: a.support, planeError: a.planeError });
fs.writeFileSync(outPath, JSON.stringify({ base: pick(base), refined: pick(r.anchor), info: { improved: r.improved, before: r.before, after: r.after, tiltDeg: r.tiltDeg, scale: r.scale, frames: r.frames, reason: r.reason, ms } }));
console.log(JSON.stringify({ improved: r.improved, before: r.before && +r.before.toFixed(3), after: r.after && +r.after.toFixed(3), tiltDeg: r.tiltDeg && +r.tiltDeg.toFixed(2), scale: r.scale && +r.scale.toFixed(3), frames: r.frames, reason: r.reason, ms }));
