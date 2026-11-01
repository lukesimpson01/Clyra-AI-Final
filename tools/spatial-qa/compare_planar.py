"""Clyra's current planar tracker (a scan's track json) vs PlateTrack, same ROI, same reference frame, same truth.
Usage: compare_planar.py PLATETRACK_DIR video truth.json clyra_track.json "x0,y0,x1,y1" z"""
import sys, json, time, numpy as np, cv2
sys.path.insert(0, sys.argv[1])
from platetrack.tracker import track_planar
truth = json.load(open(sys.argv[3])); clyra = json.load(open(sys.argv[4])); x0, y0, x1, y1 = map(float, sys.argv[5].split(',')); z = float(sys.argv[6])
K = np.array(truth['K']); fr = truth['frames']; sc = clyra['w'] / truth['width']
def quad(f):
    M = np.array(f['worldToCamera']); out = []
    for X, Y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
        q = M[:, :3] @ [X, Y, z] + M[:, 3]
        if q[2] <= 0: return None
        out.append([K[0, 0] * q[0] / q[2] + K[0, 2], K[1, 1] * q[1] / q[2] + K[1, 2]])
    return np.array(out)
def inside(q): return q is not None and (q > -20).all() and (q[:, 0] < truth['width'] + 20).all() and (q[:, 1] < truth['height'] + 20).all()
def person(f, q):
    w = f['walker']; cx, cy = q[:, 0].mean(), q[:, 1].mean(); return bool(w and abs(cx - w['x']) < w['halfWidth'] + 40 and w['top'] < cy < w['bottom'])
roi = quad(fr[0]); cap = cv2.VideoCapture(sys.argv[2]); frames = []
while True:
    ok, im = cap.read()
    if not ok: break
    frames.append(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
n = min(len(frames), len(fr)); t0 = time.time(); pt = track_planar(frames[:n], roi, reference_frame=0, model='homography'); pt_s = time.time() - t0
def stats(errs, tag):
    e = np.array([x for x, _ in errs]); p = np.array([p for _, p in errs]); 
    return {tag + '_median': round(float(np.median(e)), 2), tag + '_p95': round(float(np.percentile(e, 95)), 2), tag + '_clean_median': round(float(np.median(e[~p])), 2), tag + '_during_person_median': round(float(np.median(e[p])), 2) if p.any() else None, tag + '_n': len(e)}
pe = []; ce = []
for i in range(n):
    q = quad(fr[i])
    if not inside(q): continue
    pe.append((np.linalg.norm(pt.corners_at(i) - q, axis=1).mean(), person(fr[i], q)))
cf = clyra['frames']
for f in cf:
    i = min(n - 1, int(round(f['t'] * truth['fps']))); q = quad(fr[i])
    if not inside(q) or f.get('lost'): continue
    H = np.array(f['H']).reshape(3, 3); pts = cv2.perspectiveTransform((roi * sc).reshape(-1, 1, 2), H).reshape(-1, 2) / sc
    ce.append((np.linalg.norm(pts - q, axis=1).mean(), person(fr[i], q)))
lost = sum(1 for f in cf if f.get('lost'))
print(json.dumps({**stats(pe, 'platetrack'), 'platetrack_seconds': round(pt_s, 2), **stats(ce, 'clyra'), 'clyra_lost_frames': lost}))
