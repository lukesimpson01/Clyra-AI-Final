"""Writes a planar job config whose quad is a wall rectangle (world coords on z=7) as seen in frame 0 of a synth clip.
Usage: planar_cfg.py truth.json video "x0,y0,x1,y1" out_dir cfg.json"""
import sys, json, numpy as np
t = json.load(open(sys.argv[1])); x0, y0, x1, y1 = map(float, sys.argv[3].split(',')); K = np.array(t['K']); M = np.array(t['frames'][0]['worldToCamera'])
q = []
for X, Y in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]:
    p = M[:, :3] @ [X, Y, 7.0] + M[:, 3]; q.append([(K[0, 0] * p[0] / p[2] + K[0, 2]) / t['width'], (K[1, 1] * p[1] / p[2] + K[1, 2]) / t['height']])
json.dump({'source': sys.argv[2], 'from': 0, 'to': 7, 'output': sys.argv[4], 'fps': 18, 'maxFrames': 240, 'quad': q, 'longest': 960}, open(sys.argv[5], 'w'))
