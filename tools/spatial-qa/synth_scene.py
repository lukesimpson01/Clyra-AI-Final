"""Renders a walk through a textured room with an exactly known camera, so spatial tracking can be scored against
ground truth. Camera axes follow OpenCV (x right, y down, z forward); the world uses the same axes.
Usage: synth_scene.py OUT_DIR [--walkers N]   -> OUT_DIR/scene.mp4 and OUT_DIR/truth.json
Optional moving 'person' billboards (opaque coloured silhouettes) cross in front of the back wall for occlusion tests."""
import argparse, json, subprocess, sys
from pathlib import Path
import numpy as np, cv2

W, H, FPS, SECONDS = 540, 960, 24, 7
F = 0.95 * W
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1.0]])

def texture(seed, size=1024):
    rng = np.random.default_rng(seed); img = np.zeros((size, size), np.float32)
    for octave, amp in [(8, .5), (16, .35), (32, .25), (64, .18), (128, .12)]:
        n = rng.random((octave, octave)).astype(np.float32); img += amp * cv2.resize(n, (size, size), interpolation=cv2.INTER_CUBIC)
    for _ in range(260):  # crisp marks: corners and edges the feature detector can lock to
        x, y = rng.integers(0, size, 2); w, h = rng.integers(10, 70, 2); cv2.rectangle(img, (int(x), int(y)), (int(x + w), int(y + h)), float(rng.random()), 2 if rng.random() < .5 else -1)
    img = (255 * (img - img.min()) / (img.max() - img.min())).astype(np.uint8)
    return cv2.merge([cv2.add(img, int(rng.integers(0, 40))), img, cv2.subtract(img, int(rng.integers(0, 40)))])

# plane: point, normal, u axis, v axis, half extents (metres, texture covers 2*half), texture
PLANES = {
    'back':  dict(p=[0, 0, 7.0],  n=[0, 0, -1], u=[1, 0, 0], v=[0, 1, 0], ext=[5, 3.2]),
    'left':  dict(p=[-4.0, 0, 3.5], n=[1, 0, 0], u=[0, 0, 1], v=[0, 1, 0], ext=[4.5, 3.2]),
    'right': dict(p=[4.0, 0, 3.5],  n=[-1, 0, 0], u=[0, 0, 1], v=[0, 1, 0], ext=[4.5, 3.2]),
    'floor': dict(p=[0, 1.6, 3.5],  n=[0, -1, 0], u=[1, 0, 0], v=[0, 0, 1], ext=[5, 4.5]),
}
for i, k in enumerate(PLANES): PLANES[k]['tex'] = texture(11 + i)

def camera(t):
    """Walk forward and drift right while turning slowly toward the back wall, with smooth handheld shake."""
    s = t / SECONDS
    pos = np.array([-1.4 + 2.6 * s, 0.05 * np.sin(t * 5.1), 0.0 + 3.2 * s])
    yaw = np.radians(14 - 24 * s) + np.radians(.35) * np.sin(t * 3.7); pitch = np.radians(1.2) * np.sin(t * 4.3); roll = np.radians(.4) * np.sin(t * 2.9)
    cy, sy, cp, sp, cr, sr = np.cos(yaw), np.sin(yaw), np.cos(pitch), np.sin(pitch), np.cos(roll), np.sin(roll)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]); Rp = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]); Rr = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    Rc2w = Ry @ Rp @ Rr
    return pos, Rc2w  # camera-to-world

def render(pos, Rc, walkers):
    xs, ys = np.meshgrid(np.arange(W) + .5, np.arange(H) + .5); d = np.stack([(xs - K[0, 2]) / F, (ys - K[1, 2]) / F, np.ones_like(xs)], -1) @ Rc.T
    best = np.full((H, W), np.inf); img = np.full((H, W, 3), 90, np.uint8)
    for name, pl in PLANES.items():
        n = np.array(pl['n'], float); den = d @ n; t = ((np.array(pl['p']) - pos) @ n) / np.where(np.abs(den) < 1e-9, 1e-9, den)
        P = pos + d * t[..., None]; rel = P - np.array(pl['p']); u = rel @ np.array(pl['u'], float); v = rel @ np.array(pl['v'], float)
        ok = (t > 0) & (np.abs(u) < pl['ext'][0]) & (np.abs(v) < pl['ext'][1]) & (t < best)
        tx = ((u / pl['ext'][0] + 1) / 2 * 1023).astype(np.float32); ty = ((v / pl['ext'][1] + 1) / 2 * 1023).astype(np.float32)
        samp = cv2.remap(pl['tex'], tx, ty, cv2.INTER_LINEAR); img[ok] = samp[ok]; best[ok] = t[ok]
    return img, best

def world_to_px(P, pos, Rc):
    q = (np.array(P) - pos) @ Rc; return [F * q[0] / q[2] + K[0, 2], F * q[1] / q[2] + K[1, 2], float(q[2])]

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--walkers', type=int, default=0); a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True); frames = out / 'frames'; frames.mkdir(exist_ok=True)
    truth = {'width': W, 'height': H, 'fps': FPS, 'K': K.tolist(), 'frames': [], 'planes': {k: {kk: v[kk] for kk in ('p', 'n', 'u', 'v', 'ext')} for k, v in PLANES.items()},
             'tests': {'wall_point': [0.4, -0.5, 7.0], 'floor_point': [0.0, 1.6, 5.0], 'left_wall_point': [-4.0, -0.2, 5.5]}}
    for i in range(FPS * SECONDS):
        t = i / FPS; pos, Rc = camera(t); img, depth = render(pos, Rc, a.walkers)
        walker = None
        if a.walkers:  # an opaque person-shaped silhouette walking across at depth 4.2 m, in front of the wall
            wx = -3.0 + 6.0 * ((t / SECONDS) * 1.2 % 1.0); body = np.array([wx, 0.2, 4.2]); top = world_to_px(body + [0, -1.1, 0], pos, Rc); bot = world_to_px(body + [0, 1.4, 0], pos, Rc)
            cx = top[0]; wpx = abs(bot[1] - top[1]) * .13
            mask = np.zeros((H, W), np.uint8); cv2.ellipse(mask, (int(cx), int(top[1] + (bot[1] - top[1]) * .1)), (int(wpx * .75), int(wpx * .75)), 0, 0, 360, 255, -1)
            cv2.rectangle(mask, (int(cx - wpx), int(top[1] + (bot[1] - top[1]) * .2)), (int(cx + wpx), int(bot[1])), 255, -1)
            img[mask > 0] = (40, 60, 200); walker = {'x': cx, 'top': top[1], 'bottom': bot[1], 'halfWidth': wpx}
        cv2.imwrite(str(frames / f'{i:05d}.png'), img)
        w2c = np.eye(4); w2c[:3, :3] = Rc.T; w2c[:3, 3] = -Rc.T @ pos
        truth['frames'].append({'i': i, 't': t, 'worldToCamera': w2c[:3].tolist(), 'center': pos.tolist(), 'walker': walker, **{k: world_to_px(P, pos, Rc) for k, P in truth['tests'].items()}})
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', str(frames / '%05d.png'), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', str(out / 'scene.mp4')], check=True)
    (out / 'truth.json').write_text(json.dumps(truth)); print('wrote', out / 'scene.mp4')
