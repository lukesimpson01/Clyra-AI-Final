import type maplibregl from "maplibre-gl";
import type { Coordinate, Route } from "../../lib/maps/types";
import { RouteInterpolator } from "../navigation/RouteInterpolator";

/**
 * Cinematic 3D flight along a route.
 *
 * A dot travels the route and the camera trails it, a little behind and above, easing toward the dot so every
 * movement is followed with a slight lag rather than glued to it. Speed is shaped, not constant:
 *   cruise -> brake into a real turn -> come to a stop -> hold for a second -> swing the camera slowly round to the
 *   new street -> build speed again.
 * Gentle bends only slow the flight. The whole thing is a pure function of time, so it never stutters on a slow frame.
 */

export interface FlyoverHooks {
  /** The dot's position and heading, once per frame. */
  dot(coordinate: Coordinate, bearing: number): void;
  /** How much of the route has been flown, in metres. */
  progress(meters: number): void;
  /** Live flight data for the HUD: metres flown, current speed (m/s) and what the film is doing. */
  state?(info: { progress: number; speed: number; phase: "cruise" | "hold" | "turn" }): void;
}

interface Corner {
  /** Distance along the route, in metres. */
  at: number;
  /** Signed turn in degrees (positive = right). */
  turn: number;
  /** True for a real turn into another street: the flight stops and waits. */
  stop: boolean;
}

const HOLD_MS = 1000;
const TURN_MS = 1500;
const BRAKE = 5.5; // m/s², comfortable, film-like deceleration
const ACCEL = 4.2; // m/s², builds speed slowly after a stop
const STOP_TURN_DEG = 42;

const wrap = (deg: number) => ((deg % 360) + 540) % 360 - 180;
const lerpAngle = (from: number, to: number, k: number) => from + wrap(to - from) * k;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach: the share of the gap to close this frame. */
const follow = (dt: number, seconds: number) => 1 - Math.exp(-dt / seconds);

export function findCorners(path: RouteInterpolator): Corner[] {
  const total = path.totalDistance;
  const raw: Corner[] = [];
  for (let d = 40; d < total - 40; d += 10) {
    const before = path.at(d - 25).bearing;
    const after = path.at(d + 25).bearing;
    const turn = wrap(after - before);
    if (Math.abs(turn) >= 22) raw.push({ at: d, turn, stop: Math.abs(turn) >= STOP_TURN_DEG });
  }
  // one corner per cluster, placed at the middle of its sharpest stretch
  const clusters: Corner[][] = [];
  for (const c of raw) {
    const group = clusters[clusters.length - 1];
    if (group && c.at - group[group.length - 1].at < 70) group.push(c);
    else clusters.push([c]);
  }
  const out: Corner[] = clusters.map((group) => {
    const sharpest = Math.max(...group.map((c) => Math.abs(c.turn)));
    const core = group.filter((c) => Math.abs(c.turn) >= sharpest * 0.95);
    return {
      at: core.reduce((sum, c) => sum + c.at, 0) / core.length,
      turn: core[0].turn,
      stop: group.some((c) => c.stop),
    };
  });
  return out;
}

export class RouteFlyover {
  private frame: number | null = null;
  private readonly path: RouteInterpolator;
  private readonly corners: Corner[];
  private paused = false;
  private scale = 1;

  constructor(
    private readonly map: maplibregl.Map,
    route: Route,
    private readonly hooks: FlyoverHooks,
    private readonly onEnd: () => void,
  ) {
    this.path = new RouteInterpolator(route);
    this.corners = findCorners(this.path);
  }

  get running() {
    return this.frame != null;
  }

  setPaused(paused: boolean) { this.paused = paused; }
  setScale(scale: number) { this.scale = Math.max(0.25, Math.min(16, scale)); }

  start() {
    const { map, path, corners, hooks } = this;
    const total = path.totalDistance;
    if (total < 30) { this.onEnd(); return; }
    // a long route flies quicker so the film stays watchable; a short one stays leisurely
    const cruise = Math.max(22, Math.min(80, total / 70));

    let s = 0;
    let speed = 0;
    let next = 0; // index of the next corner not yet handled
    let phase: "cruise" | "hold" | "turn" = "cruise";
    let phaseStart = 0;
    let holdFrom = 0;
    let holdTo = 0;
    let clock = 0; // film time in seconds: drives the slow, organic drift of the camera
    let crane = 0; // 0..1: the camera rises and pulls back while the flight is stopped at a corner
    const startBearing = path.at(0).bearing;
    let camBearing = startBearing;
    let camPitch = 50;
    let camZoom = 16.2;
    let camCenter: Coordinate = path.at(0).coordinate;
    let last = performance.now();
    let began = 0;

    // open high above the start, then the first seconds of the film are a long, sweeping descent into the street
    map.easeTo({ center: camCenter, zoom: camZoom, pitch: camPitch, bearing: startBearing, duration: 1500, essential: true });
    const entryEnds = performance.now() + 1550;

    const tick = (now: number) => {
      const real = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (now < entryEnds) { this.frame = requestAnimationFrame(tick); return; }
      if (!began) began = now;
      const dt = this.paused ? 0 : real * this.scale; // flight time
      clock += real;

      const corner = corners[next];
      const stopHere = corner?.stop ? corner : undefined;

      if (phase === "cruise") {
        let limit = cruise;
        if (stopHere) {
          const gap = Math.max(0, stopHere.at - s);
          limit = Math.min(limit, Math.sqrt(2 * BRAKE * gap) + 0.6);
        }
        const bend = !stopHere && corner ? corner : corners.find((c, i) => i >= next && !c.stop && c.at - s < 60 && c.at - s > -10);
        if (bend) limit = Math.min(limit, cruise * (0.45 + 0.55 * Math.min(1, Math.abs(bend.at - s) / 60)));
        const rate = speed < limit ? ACCEL * 1.4 : BRAKE * 1.2;
        speed += Math.sign(limit - speed) * Math.min(Math.abs(limit - speed), rate * dt * Math.max(1, this.scale * 0.5));
        s = Math.min(total, s + speed * dt);

        if (stopHere && stopHere.at - s < 1.2 && speed < 1.6) {
          s = stopHere.at;
          speed = 0;
          phase = "hold";
          phaseStart = now;
          holdFrom = camBearing;
          holdTo = path.at(Math.min(total, stopHere.at + 30)).bearing;
        } else if (corner && !corner.stop && s > corner.at + 10) next += 1;
      } else if (phase === "hold") {
        // standing still for a beat; the camera begins to look toward where the road goes next
        const t = Math.min(1, (now - phaseStart) / HOLD_MS);
        camBearing = holdFrom + wrap(holdTo - holdFrom) * 0.12 * smoothstep(t);
        if (!this.paused && now - phaseStart >= HOLD_MS) { phase = "turn"; phaseStart = now; holdFrom = camBearing; }
      } else {
        const t = Math.min(1, (now - phaseStart) / TURN_MS);
        camBearing = holdFrom + wrap(holdTo - holdFrom) * smoothstep(t);
        if (t >= 1) { phase = "cruise"; next += 1; }
      }

      const here = path.at(s);
      const speedK = Math.min(1, speed / cruise);
      crane += ((phase === "cruise" ? 0 : 1) - crane) * follow(real, phase === "cruise" ? 1.6 : 0.7);

      // the camera aims a little ahead of the dot, more so the faster it flies, and trails it with a soft lag
      const lookAhead = 12 + speed * 1.3;
      let target = path.at(Math.min(total, s + lookAhead)).coordinate;
      const heading = path.at(Math.min(total, s + 20 + speed)).bearing;
      if (phase === "cruise") {
        const aim = stopHere && stopHere.at - s < 70 ? path.at(Math.max(0, stopHere.at - 12)).bearing : heading;
        // a slow yaw drift on top of the road heading: the shot is never perfectly locked
        camBearing = lerpAngle(camBearing, aim + Math.sin(clock * 0.37) * 5 * speedK, follow(real, 0.85));
      }
      // a lazy weave to one side of the road and back, like a drone that is being flown, not a rail
      const side = Math.sin(clock * 0.29) * 11 * speedK * (1 - crane);
      const rad = ((camBearing + 90) * Math.PI) / 180;
      const cos = Math.cos((target[1] * Math.PI) / 180);
      target = [target[0] + (Math.sin(rad) * side) / (111320 * cos), target[1] + (Math.cos(rad) * side) / 111320];
      camCenter = [
        camCenter[0] + (target[0] - camCenter[0]) * follow(real, 0.5),
        camCenter[1] + (target[1] - camCenter[1]) * follow(real, 0.5),
      ];

      // low and close at a crawl, drawing back as it gathers speed, rising on the crane while stopped
      const zoomGoal = 18.7 - speedK * 1.2 + Math.sin(clock * 0.45) * 0.12 - crane * 0.85;
      const pitchGoal = 74 - speedK * 8 - crane * 9 + Math.sin(clock * 0.31) * 1.5;
      camZoom += (zoomGoal - camZoom) * follow(real, 1.1);
      camPitch += (pitchGoal - camPitch) * follow(real, 1.2);

      map.jumpTo({ center: camCenter, bearing: camBearing, pitch: Math.min(80, camPitch), zoom: camZoom });
      hooks.dot(here.coordinate, here.bearing);
      hooks.progress(s);
      hooks.state?.({ progress: s, speed, phase });

      if (s >= total - 0.5 && phase === "cruise") {
        this.stop();
        this.onEnd();
        return;
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    if (this.frame != null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }
}
