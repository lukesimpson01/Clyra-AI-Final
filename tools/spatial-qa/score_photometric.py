"""Visual stability of a surface anchor on REAL footage, with no ground truth needed.
The plane the editor would pin text to is used to warp every solved frame back into the reference frame; if the camera
poses and the plane are right, the wall texture around the click lines up. The residual shift (phase correlation, in
reference-frame pixels) is exactly how far text pinned there would slide against the wall.
Usage: score_photometric.py solution.json video refSeconds x01 y01 [radiusPx]"""
import json, subprocess, sys, numpy as np, cv2
from pathlib import Path
sol_path, video, ref, cx, cy = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]); radius = int(sys.argv[6]) if len(sys.argv) > 6 else 48
sol = json.load(open(sol_path)); W, H = sol['width'], sol['height']; here = Path(__file__).parent
import os
anchor = json.load(open(os.environ['ANCHOR_JSON'])) if os.environ.get('ANCHOR_JSON') else json.loads(subprocess.check_output(['node', str(here / 'anchor-plane.mjs'), sol_path, str(ref), str(cx), str(cy)], text=True))
poses = [p for s in sol['shots'] for p in s.get('poses', [])]; poses.sort(key=lambda p: p['sourceTimeUs'])
refPose = min(poses, key=lambda p: abs(p['sourceTimeUs'] - ref * 1e6)); cap = cv2.VideoCapture(video)
def grab(us):
    cap.set(cv2.CAP_PROP_POS_MSEC, us / 1000); ok, f = cap.read()
    return cv2.cvtColor(cv2.resize(f, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32) if ok else None
K = np.array(refPose['intrinsics']); Mr = np.array(refPose['worldToCamera']); Rr, tr = Mr[:, :3], Mr[:, 3]
n_w = np.array(anchor['normal']); X0 = np.array(anchor['position']); n_c = Rr @ n_w; d = n_c @ (Rr @ X0 + tr)
x0, y0 = int(cx * W), int(cy * H); box = (max(0, y0 - radius), min(H, y0 + radius), max(0, x0 - radius), min(W, x0 + radius))
base = grab(refPose['sourceTimeUs']); patch0 = base[box[0]:box[1], box[2]:box[3]]; win = cv2.createHanningWindow(patch0.shape[::-1], cv2.CV_32F)
res = []; zn = []
for p in poses:
    if abs(p['sourceTimeUs'] - refPose['sourceTimeUs']) < 1000: continue
    img = grab(p['sourceTimeUs'])
    if img is None: continue
    Mf = np.array(p['worldToCamera']); Rrel = Mf[:, :3] @ Rr.T; trel = Mf[:, 3] - Rrel @ tr
    Hm = K @ (Rrel + np.outer(trel, n_c) / d) @ np.linalg.inv(K)   # x_f = Hm x_ref
    if abs(Hm[2, 2]) < 1e-9: continue
    warped = cv2.warpPerspective(img, Hm, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=0)
    patch = warped[box[0]:box[1], box[2]:box[3]]
    if patch.shape != patch0.shape or (patch == 0).mean() > .1: continue
    a, b = patch0 - patch0.mean(), patch - patch.mean(); z = float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)); zn.append(z)
    if z < .25: res.append(np.nan); continue          # not enough shared texture to judge (occluded, out of view, blur)
    (dx, dy), _ = cv2.phaseCorrelate(patch0 * win, patch * win); res.append(float(np.hypot(dx, dy)))
r = np.array(res); ok = r[~np.isnan(r)]
print(json.dumps({'frames': len(r), 'judged': int(len(ok)), 'residualPx': {'median': round(float(np.median(ok)), 2), 'p95': round(float(np.percentile(ok, 95)), 2), 'max': round(float(ok.max()), 2)} if len(ok) else None,
                  'zncc_median': round(float(np.median(zn)), 3) if zn else None, 'anchor': {'support': anchor['support'], 'planeError': anchor['planeError']}}))
