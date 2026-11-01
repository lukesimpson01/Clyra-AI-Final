/* Select Anything accuracy: runs the editor's own tracker (universal-core.js) over a synthetic clip and compares its
   track with where a real wall point (world coordinates known) projects in every frame.
   Usage: node score-follow.mjs video truth.json "x,y,z" startSeconds [regionPx=64] */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createUniversalTracker, verified } from '../../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/universal-core.js';
const [, , video, truthPath, pt, t0s, regionArg = '64'] = process.argv;
const truth = JSON.parse(fs.readFileSync(truthPath)), W = truth.width, H = truth.height, P = pt.split(',').map(Number), start = Number(t0s), region = Number(regionArg);
const proj = (f) => { const M = f.worldToCamera, q = M.map((r) => r[0] * P[0] + r[1] * P[1] + r[2] * P[2] + r[3]), K = truth.K; return q[2] > 0 ? [K[0][0] * q[0] / q[2] + K[0][2], K[1][1] * q[1] / q[2] + K[1][2]] : null; };
const frames = truth.frames.filter((f) => f.t >= start);
const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-ss', String(start), '-i', video, '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
const n = Math.min(frames.length, Math.floor(raw.length / (W * H))), gray = (i) => raw.subarray(i * W * H, (i + 1) * W * H);
const ratio = 384 / Math.max(W, H), gw = Math.round(W * ratio), gh = Math.round(H * ratio);
const small = (g) => { const out = new Uint8Array(gw * gh); for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) out[y * gw + x] = g[Math.min(H - 1, Math.round(y / ratio)) * W + Math.min(W - 1, Math.round(x / ratio))]; return out; };
const crop = (g, cx, cy, radius) => { const w = Math.min(W, Math.round(radius * 2)), h = Math.min(H, Math.round(radius * 2)), left = Math.max(0, Math.min(W - w, Math.round(cx - radius))), top = Math.max(0, Math.min(H - h, Math.round(cy - radius))), data = new Uint8Array(w * h); for (let r = 0; r < h; r++) data.set(g.subarray((top + r) * W + left, (top + r) * W + left + w), r * w); return { x: left, y: top, w, h, step: 1, data }; };
const p0 = proj(frames[0]), sel = { id: 'a', kind: 'object', sourceTimeUs: Math.round(frames[0].t * 1e6), anchorX: p0[0], anchorY: p0[1], region: { x: p0[0] - region / 2, y: p0[1] - region / 2, width: region, height: region } };
const tracker = createUniversalTracker(sel, W, H);
const obs = [];
let prev = null;
for (let i = 0; i < n; i++) {
  const g = gray(i), us = Math.round(frames[i].t * 1e6), pred = prev && verified(prev) ? [prev.x + prev.velocity[0] * .04, prev.y + prev.velocity[1] * .04] : [prev?.x ?? p0[0], prev?.y ?? p0[1]];
  const radius = Math.min(256, region / 2 + 70), packet = { sourceTimeUs: us, roi: crop(g, pred[0], pred[1], radius), global: { x: 0, y: 0, w: gw, h: gh, sourceW: W, sourceH: H, data: small(g) } };
  let result; if (i === 0) { result = { observation: tracker.initialize(packet), requests: [] }; } else result = tracker.observe(packet);
  if (result.needsGlobal) result.requests = tracker.recoveryCandidates(packet.global).slice(0, 4);
  if (result.requests?.length) { const regions = result.requests.slice(0, 4).map((r) => crop(g, r.x, r.y, Math.max(90, region / 2 + 65))); const rec = tracker.recover(regions); if (rec) result.observation = rec; }
  prev = result.observation; obs.push(prev);
}
if (process.env.DEBUG_FOLLOW) obs.slice(0, 40).forEach((o, i) => { const g = proj(frames[i]); console.error(i, o.status, o.x?.toFixed(1), o.y?.toFixed(1), 'gt', g && g.map((v) => v.toFixed(1)).join(','), 'conf', o.confidence?.toFixed?.(2), 'rot', o.rotation?.toFixed(2), 'w', o.width?.toFixed(1)); });
const err = [], status = {}, visible = [];
obs.forEach((o, i) => { const g = proj(frames[i]); status[o.status] = (status[o.status] ?? 0) + 1; if (!g || g[0] < 0 || g[1] < 0 || g[0] > W || g[1] > H) return; const walker = frames[i].walker, hidden = walker && Math.abs(g[0] - walker.x) < walker.halfWidth && g[1] > walker.top && g[1] < walker.bottom; if (verified(o) && !hidden) err.push(Math.hypot(o.x - g[0], o.y - g[1])); visible.push({ i, hidden, ok: verified(o) }); });
err.sort((a, b) => a - b); const q = (p) => err.length ? +err[Math.min(err.length - 1, Math.floor(err.length * p))].toFixed(2) : null;
const coverage = visible.filter((v) => !v.hidden && v.ok).length / Math.max(1, visible.filter((v) => !v.hidden).length), hiddenFrames = visible.filter((v) => v.hidden);
console.log(JSON.stringify({ frames: n, status, errorPx: { median: q(.5), p95: q(.95), max: q(1) }, trackedWhileVisible: +coverage.toFixed(3), framesHiddenByPerson: hiddenFrames.length, reportedTrackedWhileHidden: hiddenFrames.filter((v) => v.ok).length }));
