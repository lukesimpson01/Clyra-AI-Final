"""Scores a solution.json against synth_scene truth.json: similarity-align the camera centres (the solve has arbitrary
scale), then report trajectory error relative to the walk length and rotation error in degrees."""
import json, sys, numpy as np
sol = json.load(open(sys.argv[1])); truth = json.load(open(sys.argv[2]))
G = {round(f['t'] * 1e6): f for f in truth['frames']}
def nearest(us):
    k = min(G, key=lambda x: abs(x - us)); return G[k] if abs(k - us) < 25000 else None
for shot in sol['shots']:
    if not shot.get('poses'): continue
    est, gt, Rg, Re = [], [], [], []
    for p in shot['poses']:
        f = nearest(p['sourceTimeUs'])
        if not f: continue
        M = np.array(p['worldToCamera']); est.append(-M[:, :3].T @ M[:, 3]); Re.append(M[:, :3].T)
        N = np.array(f['worldToCamera']); gt.append(-N[:, :3].T @ N[:, 3]); Rg.append(N[:, :3].T)
    est, gt = np.array(est), np.array(gt)
    # Umeyama similarity: gt ≈ s R est + t
    me, mg = est.mean(0), gt.mean(0); E, Gc = est - me, gt - mg; U, D, Vt = np.linalg.svd(Gc.T @ E / len(est)); S = np.eye(3); S[2, 2] = np.sign(np.linalg.det(U @ Vt)); R = U @ S @ Vt
    s = (D * np.diag(S)).sum() / (E ** 2).sum() * len(est); t = mg - s * R @ me; aligned = (s * (R @ est.T)).T + t
    err = np.linalg.norm(aligned - gt, axis=1); walk = np.linalg.norm(np.diff(gt, axis=0), axis=1).sum()
    rot = [np.degrees(np.arccos(np.clip((np.trace((R @ Re[i]).T @ Rg[i]) - 1) / 2, -1, 1))) for i in range(len(Re))]
    print(f"shot {shot['id']}: {len(est)} poses scored | centre error median {np.median(err):.4f} m, p95 {np.percentile(err, 95):.4f} m, as % of walk {100*np.median(err)/walk:.2f}% | rotation error median {np.median(rot):.3f}°, p95 {np.percentile(rot, 95):.3f}°, max {np.max(rot):.2f}° | scale {s:.3f}")
