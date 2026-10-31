import assert from "node:assert/strict";
import {createCamera} from '../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/camera-runtime.js';
import {
  createUniversalTracker,
  observationAt,
  verified,
} from "../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/universal-core.js";
import {
  sourcePlacement,
  inversePoint,
  sourcePointAt,
  transformPoint,
  solveFollow,
  pathAt,
  sourceTime,
} from "../apps/shorts/openfilm/packages/openfilm/studio/ui/src/frame/universal-motion.js";
const W = 192,
  H = 128;
// A click in the bars around a portrait source must not silently become an edge anchor.
const portrait = sourcePlacement(1080, 1920, { w: 1920, h: 1080 });
assert.equal(sourcePointAt(portrait, 10, 540, 1080, 1920), null);
assert.deepEqual(sourcePointAt(portrait, 960, 540, 1080, 1920), [540, 960]);
assert.deepEqual(sourcePointAt(portrait, 10, 540, 1080, 1920, true), [0, 960]);
function image(x, y, hidden = false) {
  const data = new Uint8Array(W * H).fill(60);
  if (!hidden)
    for (let v = -8; v <= 8; v++)
      for (let u = -8; u <= 8; u++)
        data[(y + v) * W + x + u] = (u * 37 + v * 73 + u * v * 13) & 255;
  return { data, w: W, h: H, x: 0, y: 0, step: 1, sourceW: W, sourceH: H };
}
const selection = {
  id: "point",
  kind: "point",
  sourceTimeUs: 0,
  anchorX: 40,
  anchorY: 50,
  region: { x: 31, y: 41, width: 18, height: 18 },
};
const engine = createUniversalTracker(selection, W, H);
const packet = (t, x, y, hidden = false) => {
  const g = image(x, y, hidden);
  return { sourceTimeUs: t, roi: g, global: g };
};
const observations = [engine.initialize(packet(0, 40, 50))];
const times = [];
let maxAnchorErrorPx=0;
for (let i = 1; i <= 24; i++) {
  const x = i < 12 ? 40 + i * 2 : 62,
    y = 50 + Math.floor(i / 4),
    t = i * 16667;
  const at = performance.now(),
    result = engine.observe(packet(t, x, y));
  times.push(performance.now() - at);
  observations.push(result.observation);
  maxAnchorErrorPx=Math.max(maxAnchorErrorPx,Math.hypot(result.observation.x-x,result.observation.y-y));
  assert.ok(
    verified(result.observation),
    `frame ${i} ${JSON.stringify(result.observation)}`,
  );
  assert.ok(
    Math.hypot(result.observation.x - x, result.observation.y - y) <= 0.75,
    `wrong anchor ${i}`,
  );
}
const gone = engine.observe(packet(900000, 62, 56, true));
assert.equal(gone.observation.status, "lost");
assert.ok(!verified(gone.observation));
engine.dispose();
const cursor = createUniversalTracker({ ...selection, kind: "cursor" }, W, H);
cursor.initialize(packet(0, 40, 50));
const largeJump = cursor.observe(packet(16667, 140, 50));
assert.ok(!verified(largeJump.observation));
const recovered = cursor.recover([image(140, 50)]);
assert.equal(recovered?.status, "reacquired");
assert.ok(recovered.jump);
assert.ok(Math.abs(recovered.x - 140) < 0.75);
cursor.dispose();
const caret = createUniversalTracker(
  { ...selection, kind: "text-caret" },
  W,
  H,
);
caret.initialize(packet(0, 40, 50));
const blink = caret.observe(packet(400000, 40, 50, true));
assert.equal(blink.observation.status, "occluded");
caret.dispose();
const jump = [
  { ...observations[0], sourceTimeUs: 0 },
  { ...observations[1], x: 180, sourceTimeUs: 40000, jump: true },
];
assert.equal(
  observationAt(jump, 20000).x,
  40,
  "no invented motion through jump",
);
assert.equal(observationAt(jump, 20000).status, "predicted");
assert.equal(
  observationAt([observations[0], gone.observation], 500000).status,
  "predicted",
);
for (const fit of ["contain", "cover", "fill"])
  for (const r of [0, 45, 90, -25]) {
    const m = sourcePlacement(
      3840,
      2160,
      { w: 1080, h: 1920 },
      { x: 13, y: 42, w: 960, h: 1700, r },
      fit,
    );
    for (const p of [
      [0, 0],
      [3839, 2159],
      [2000.25, 400.75],
    ]) {
      const q = inversePoint(m, ...transformPoint(m, ...p));
      assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-8);
    }
  }
assert.equal(sourceTime({ time: [2, 5], speed: 2 }, 1, 0), 4);
assert.equal(sourceTime({ time: [2, 5], speed: -1 }, 1, 0), 4);
const raw = structuredClone(observations),
  track = { sourceWidth: W, sourceHeight: H, selection, observations },
  stage = { w: W, h: H },
  settings = {
    style: "precise",
    x: 0.5,
    y: 0.5,
    zoom: 2,
    smoothness: 0.7,
    lookahead: 0.15,
    deadZone: 0.02,
    autoZoom: false,
    maxSpeed: 2,
    maxAcceleration: 6,
    maxJerk: 30,
    bounds: "constrain",
  };
const precise = solveFollow(track, settings, stage),
  smooth = solveFollow(track, { ...settings, style: "cinematic" }, stage);
assert.deepEqual(observations, raw, "solver must not change raw measurements");
assert.notDeepEqual(smooth, precise);
assert.ok(pathAt(precise, 60000));
for (const p of precise) {
  assert.ok(p.x >= W / p.zoom / 2 && p.x <= W - W / p.zoom / 2);
  assert.ok(p.y >= H / p.zoom / 2 && p.y <= H - H / p.zoom / 2);
}
const oldWindow=globalThis.window;
try{
  globalThis.window={parent:{__filmSpans:()=>[{id:'selected',src:'fixture.mp4',at:0,end:3}],__filmSourceAt:(_id,t)=>t}};
  const path=[{sourceTimeUs:0,x:80,y:60,zoom:2,visible:true},{sourceTimeUs:1e6,x:180,y:100,zoom:1,visible:false}];
  const camera=createCamera({duration:3,camera:{mode:'2d',stageW:192,stageH:128,tracking:{clipId:'selected',src:'fixture.mp4',path}}});
  const seen=camera.camera(0,0),lost=camera.camera(1.5,1.5);
  assert.equal(lost.css,seen.css,'camera holds verified framing during target loss');assert.equal(lost.trackingStatus,'holding');assert.equal(path[1].x,180,'holding must not rewrite raw unverified coordinates');
}finally{if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
console.log(
  JSON.stringify({
    passed: true,
    frames: observations.length,
    maxAnchorErrorPx,
    allowedAnchorErrorPx:0.75,
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    p95Ms: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
  }),
);
