"""Writes an editor matte atlas (assets/mattes/<id>/atlas-N.png) from synth_scene truth silhouettes, standing in for a
perfect person detector so the editor's occlusion compositing can be tested apart from the detector.
Usage: make_matte_from_truth.py truth.json matte_dir   (matte_dir already holds the scan's matte.json)"""
import json, sys, numpy as np, cv2
from pathlib import Path
truth = json.load(open(sys.argv[1])); d = Path(sys.argv[2]); m = json.load(open(d / 'matte.json'))
w, h, cols, rows, fps, count = m['w'], m['h'], m['cols'], m['rows'], m['fps'], m['count']; per = cols * rows
sx, sy = w / truth['width'], h / truth['height']; frames = {round(f['t'] * 1000): f for f in truth['frames']}
def tile(i):
    t = min(frames, key=lambda k: abs(k - i / fps * 1000)); wk = frames[t]['walker']; img = np.zeros((h, w), np.uint8)
    if wk:
        cx, top, bot, hw = wk['x'] * sx, wk['top'] * sy, wk['bottom'] * sy, wk['halfWidth'] * sx
        cv2.ellipse(img, (int(cx), int(top + (bot - top) * .1)), (int(hw * .75), int(hw * .75)), 0, 0, 360, 255, -1)
        cv2.rectangle(img, (int(cx - hw), int(top + (bot - top) * .2)), (int(cx + hw), int(bot)), 255, -1)
    return cv2.GaussianBlur(img, (0, 0), 1.2)
for a in range((count + per - 1) // per):
    atlas = np.zeros((rows * h, cols * w, 4), np.uint8); atlas[..., 3] = 255
    for j in range(per):
        i = a * per + j
        if i >= count: break
        r, c = divmod(j, cols); t = tile(i); atlas[r * h:(r + 1) * h, c * w:(c + 1) * w, :3] = t[..., None]
    cv2.imwrite(str(d / f'atlas-{a}.png'), atlas)
# the editor's subject pass also wants each frame's box and foot line (proxy pixels), as the detector would report them
info = []
for i in range(count):
    t = min(frames, key=lambda k: abs(k - i / fps * 1000)); wk = frames[t]['walker']
    if not wk: info.append(None); continue
    b = [(wk['x'] - wk['halfWidth']) * sx, wk['top'] * sy, (wk['x'] + wk['halfWidth']) * sx, wk['bottom'] * sy]
    info.append({'box': b, 'foot': b[3], 'area': (b[2] - b[0]) * (b[3] - b[1]) / (w * h)})
m['frames'] = info; json.dump(m, open(d / 'matte.json', 'w'))
print('wrote', (count + per - 1) // per, 'atlases and', sum(1 for x in info if x), 'subject boxes')
