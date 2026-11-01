"""Scores occlusion.json masks (SAM 2 path) against synth_scene truth silhouettes: per-frame IoU, and boundary error in pixels.
Usage: score_masks.py occlusion.json truth.json"""
import json, sys, numpy as np, cv2
from pathlib import Path
occ = json.load(open(sys.argv[1])); truth = json.load(open(sys.argv[2])); base = Path(sys.argv[1]).parent; W, H = truth['width'], truth['height']
G = {round(f['t'] * 1e6): f for f in truth['frames']}
def silhouette(wk):
    m = np.zeros((H, W), np.uint8)
    cv2.ellipse(m, (int(wk['x']), int(wk['top'] + (wk['bottom'] - wk['top']) * .1)), (int(wk['halfWidth'] * .75), int(wk['halfWidth'] * .75)), 0, 0, 360, 255, -1)
    cv2.rectangle(m, (int(wk['x'] - wk['halfWidth']), int(wk['top'] + (wk['bottom'] - wk['top']) * .2)), (int(wk['x'] + wk['halfWidth']), int(wk['bottom'])), 255, -1)
    return m > 0
ious, edge, conf, calib = [], [], [], 0
for fr in occ['frames']:
    if 'mask' not in fr: continue
    t = min(G, key=lambda k: abs(k - fr['sourceTimeUs']))
    if abs(t - fr['sourceTimeUs']) > 30000 or not G[t]['walker']: continue
    pred = cv2.imread(str(base / fr['mask']), 0)
    if pred is None: continue
    pred = cv2.resize(pred, (W, H)) > 127; gt = silhouette(G[t]['walker']); u = (pred | gt).sum()
    if u == 0: continue
    ious.append((pred & gt).sum() / u); conf.append(fr.get('confidence', None)); calib += bool(fr.get('calibration'))
    # mean distance of the predicted boundary from the true boundary
    d = cv2.distanceTransform((~(cv2.dilate(gt.astype(np.uint8), np.ones((3, 3))) - cv2.erode(gt.astype(np.uint8), np.ones((3, 3))) > 0)).astype(np.uint8), cv2.DIST_L2, 3)
    pe = cv2.dilate(pred.astype(np.uint8), np.ones((3, 3))) - cv2.erode(pred.astype(np.uint8), np.ones((3, 3)))
    if pe.sum(): edge.append(float(d[pe > 0].mean()))
ious = np.array(ious); print(json.dumps({'frames': len(ious), 'iou_median': round(float(np.median(ious)), 4), 'iou_min': round(float(ious.min()), 4), 'boundary_px_median': round(float(np.median(edge)), 2), 'boundary_px_p95': round(float(np.percentile(edge, 95)), 2), 'framesWithMetricDepth': calib, 'relativeDepthOnly': occ.get('relativeDepthOnly'), 'engine': occ.get('engine')}))
