"""PlateTrack planar tracking vs ground truth on a synthetic_scene clip.
Usage: bench_platetrack.py PLATETRACK_DIR video truth.json "x0,y0,x1,y1" z refSeconds
The ROI is a rectangle on the back wall (world x0..x1, y0..y1 at depth z); its true image position is known every frame."""
import sys, json, time, resource, numpy as np, cv2
sys.path.insert(0, sys.argv[1])
from platetrack.tracker import track_planar
truth = json.load(open(sys.argv[3])); x0, y0, x1, y1 = map(float, sys.argv[4].split(',')); z = float(sys.argv[5]); ref_t = float(sys.argv[6])
K = np.array(truth['K']); fr = truth['frames']
def quad(f):
    M = np.array(f['worldToCamera']); pts = []
    for X, Y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
        q = M[:, :3] @ [X, Y, z] + M[:, 3]
        if q[2] <= 0: return None
        pts.append([K[0, 0] * q[0] / q[2] + K[0, 2], K[1, 1] * q[1] / q[2] + K[1, 2]])
    return np.array(pts)
cap = cv2.VideoCapture(sys.argv[2]); frames = []
while True:
    ok, im = cap.read()
    if not ok: break
    frames.append(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY))
n = min(len(frames), len(fr)); frames = frames[:n]; ref = int(round(ref_t * truth['fps']))
t0 = time.time(); track = track_planar(frames, quad(fr[ref]), reference_frame=ref, model='homography'); dt = time.time() - t0
err = []; vis = []; conf = []
for i in range(n):
    gt = quad(fr[i]); 
    if gt is None or (gt < -50).any() or (gt[:, 0] > truth['width'] + 50).any() or (gt[:, 1] > truth['height'] + 50).any(): continue
    e = np.linalg.norm(track.corners_at(i) - gt, axis=1).mean(); err.append(e); conf.append(track.confidence[i])
    w = fr[i]['walker']; cx = gt[:, 0].mean(); cy = gt[:, 1].mean(); vis.append(bool(w and abs(cx - w['x']) < w['halfWidth'] and w['top'] < cy < w['bottom']))
err = np.array(err); vis = np.array(vis)
print(json.dumps({'frames': n, 'seconds': round(dt, 2), 'fps': round(n / dt, 1), 'peakRSS_MB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 2**20,
  'cornerErrorPx_median': round(float(np.median(err)), 2), 'p95': round(float(np.percentile(err, 95)), 2), 'max': round(float(err.max()), 2),
  'clean_frames_median': round(float(np.median(err[~vis])), 2) if (~vis).any() else None, 'frames_with_person_over_quad': int(vis.sum()), 'median_err_during_person': round(float(np.median(err[vis])), 2) if vis.any() else None, 'framesScored': len(err)}))
