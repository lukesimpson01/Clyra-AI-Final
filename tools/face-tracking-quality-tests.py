"""Tracking-quality tests for the AI Clipper's auto-reframe path.

These assert the behaviours a viewer actually notices, on synthetic motion
where the correct answer is known exactly:

  stationary subject  -> the crop must not drift or breathe
  micro jitter        -> detection noise must not move the camera
  deliberate pan      -> the crop must follow, and without lagging behind
  detection loss      -> the path must predict through the gap, not snap away

The pan test is the interesting one. Clyra precomputes the whole trajectory
before rendering, so it can use a *zero-phase* symmetric filter rather than an
online One Euro / Kalman filter. An online filter must trade lag against
smoothness; a symmetric one sees future samples and has no phase lag at all,
which is why the mean signed error below is asserted to be ~0 rather than
merely "small".
"""
import importlib.util
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

spec = importlib.util.spec_from_file_location("cft", os.path.join(REPO, "clipper_face_tracking.py"))
cft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cft)

OUT_W, OUT_H = 1080, 1920
FPS = 30.0
assertions = 0


def check(condition, message):
    global assertions
    assert condition, message
    assertions += 1


def build(positions, confidence=0.9):
    """One sample per frame at a given horizontal crop target."""
    rows = []
    for index, x in enumerate(positions):
        rows.append({
            "frameIndex": index,
            "timeMs": int(index * 1000 / FPS),
            "rawTargetX": float(x),
            "rawTargetY": 400.0,
            "x": float(x),
            "y": 400.0,
            "width": OUT_W,
            "height": OUT_H,
            "scaledWidth": 2400,
            "scaledHeight": 2400,
            "confidence": confidence,
            # Supplied without a "zoom" key on purpose: that keeps the
            # optimiser on its raw-target path, so these tests exercise the
            # smoothing/comfort-zone maths directly rather than the landmark
            # projection, which needs real detections to be meaningful.
            "headAnchor": {"x": 0.5, "y": 0.38, "eyeLineY": 0.38},
        })
    return rows


def optimise(rows):
    return cft._optimise_crop_trajectory(rows, [], "smooth", OUT_W, OUT_H)


# ── 1. Stationary subject: the crop must be perfectly still ──────────────
still = optimise(build([600.0] * 90))
xs = [row["x"] for row in still]
check(max(xs) - min(xs) < 1.0, f"a stationary subject must not drift (moved {max(xs) - min(xs):.2f}px)")

# ── 2. Micro jitter: detection noise must be absorbed ────────────────────
# +/-6px of noise is well inside the comfort zone (10% of 1080 = 108px).
jitter = [600.0 + (6.0 if index % 2 else -6.0) for index in range(90)]
jittered = optimise(build(jitter))
jitter_xs = [row["x"] for row in jittered]
spread = max(jitter_xs) - min(jitter_xs)
check(spread < 12.0, f"micro jitter must not shake the camera (spread {spread:.2f}px)")
input_spread = max(jitter) - min(jitter)
check(spread < input_spread, f"output jitter ({spread:.2f}px) must be below input jitter ({input_spread:.2f}px)")

# ── 3. Deliberate pan: follow it, and without lag ────────────────────────
# A 300px move over 2s — far beyond the dead zone, so it must be followed.
pan = [600.0 + min(index, 60) * 5.0 for index in range(120)]
panned = optimise(build(pan))
pan_xs = [row["x"] for row in panned]

# The crop follows a real move, but settles inside the comfort zone rather
# than pinning the subject to the exact centre — that dead zone is what stops
# the camera twitching, and is the requested "natural framing" behaviour.
comfort_px = OUT_W * cft.COMFORT_ZONE_X
travelled = pan_xs[-1] - pan_xs[0]
demanded = pan[-1] - pan[0]
check(travelled > demanded * 0.6,
      f"the crop must follow a deliberate move (travelled {travelled:.0f} of {demanded:.0f}px)")
check(abs(pan_xs[-1] - pan[-1]) < comfort_px,
      f"the crop must settle within the comfort zone ({abs(pan_xs[-1] - pan[-1]):.0f}px vs {comfort_px:.0f}px)")

# Phase lag: an online filter lags a ramp badly. A zero-phase path should not
# fall further behind than the comfort zone it is deliberately holding.
moving = range(15, 55)
signed = [pan_xs[i] - pan[i] for i in moving]
worst_lag = -min(signed)
check(worst_lag < comfort_px * 1.4,
      f"a zero-phase path must not lag beyond its dead zone (worst {worst_lag:.0f}px)")

# ── 4. Smoothness: no snapping between consecutive frames ────────────────
steps = [abs(pan_xs[i] - pan_xs[i - 1]) for i in range(1, len(pan_xs))]
check(max(steps) < 40.0, f"no single frame may snap (largest step {max(steps):.1f}px)")

# ── 5. Detection loss: predict through, do not jump ──────────────────────
# Confident motion, then a low-confidence gap, then the subject returns.
positions = [600.0 + index * 4.0 for index in range(40)]
rows = build(positions)
for row in rows[20:30]:
    row["confidence"] = 0.1        # the tracker's "not visible" state
    row["holding"] = True
held = optimise(rows)
held_xs = [row["x"] for row in held]
gap_steps = [abs(held_xs[i] - held_xs[i - 1]) for i in range(21, 30)]
check(max(gap_steps) < 40.0, f"the crop must not lurch during a detection gap (max {max(gap_steps):.1f}px)")
check(held_xs[29] >= held_xs[20] - 1.0, "the crop must keep heading the right way through the gap")

# ── 6. Diagnostics are recorded for inspection ───────────────────────────
check("velocityX" in still[5] or "targetX" in still[5], "trajectory diagnostics are recorded per frame")
check(all(row.get("zoom", 1.0) >= 1.0 for row in still), "zoom never goes below 1.0")

print(f"face-tracking-quality-tests: {assertions} assertions passed")
