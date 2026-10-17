import type { Coordinate, NavigationStep, Route } from "../../lib/maps/types";
import { RouteInterpolator } from "./RouteInterpolator";
import { BearingFilter } from "./BearingFilter";

export type SimulationStatus = "idle" | "starting" | "driving" | "paused" | "arrived";

export interface SimulationState {
  routeId: string;
  status: SimulationStatus;
  progressMeters: number;
  progressRatio: number;
  currentCoordinate: Coordinate;
  bearing: number;
  currentStepIndex: number;
  nextStepIndex: number;
  remainingDistanceMeters: number;
  remainingDurationSeconds: number;
  simulationSpeed: number;
}

export const SIMULATION_SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16] as const;

type Listener = (state: SimulationState) => void;

/** Drives a simulated "current location" continuously along a route's real
 * geometry using the route's own segment timing (not a fixed assumed speed).
 * Runs its own requestAnimationFrame loop; callers subscribe rather than
 * poll so React state updates happen at a UI-appropriate rate while the
 * underlying position updates every frame via refs. */
export class NavigationSimulationEngine {
  private route: Route;
  private interpolator: RouteInterpolator;
  private bearingFilter: BearingFilter;
  private status: SimulationStatus = "idle";
  private progressMeters = 0;
  private speed = 1;
  private lastTickAt: number | null = null;
  private rafHandle: number | null = null;
  private listeners = new Set<Listener>();
  private durationRemainingCache: number;

  constructor(route: Route) {
    this.route = route;
    this.interpolator = new RouteInterpolator(route);
    const start = this.interpolator.at(0);
    this.bearingFilter = new BearingFilter(start.bearing);
    this.durationRemainingCache = route.durationSeconds;
  }

  /** Pull-based read for consumers that throttle their own update cadence
   * (e.g. the HUD, which only needs a fresh distance/ETA a few times a
   * second, not on every animation frame). */
  getSnapshot(): SimulationState {
    return this.snapshot();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const state = this.snapshot();
    for (const l of this.listeners) l(state);
  }

  private snapshot(): SimulationState {
    const { coordinate } = this.interpolator.at(this.progressMeters);
    const { currentStepIndex, nextStepIndex } = this.stepsAround();
    return {
      routeId: this.route.id,
      status: this.status,
      progressMeters: this.progressMeters,
      progressRatio: this.interpolator.totalDistance
        ? Math.min(1, this.progressMeters / this.interpolator.totalDistance)
        : 0,
      currentCoordinate: coordinate,
      bearing: this.bearingFilter.value,
      currentStepIndex,
      nextStepIndex,
      remainingDistanceMeters: Math.max(0, this.interpolator.totalDistance - this.progressMeters),
      remainingDurationSeconds: this.durationRemainingCache,
      simulationSpeed: this.speed,
    };
  }

  /** Steps are keyed on the distance the dot has actually travelled, not on
   * the segment it sits in. A maneuver becomes "upcoming" until the dot
   * reaches its vertex, and only then does the next one take over. Keying on
   * segment index flipped one vertex too early, so the HUD skipped a turn the
   * dot was still approaching. A zero-length arrive step shares its vertex
   * with the step before it, so the first step still ahead of the dot is
   * always the one reported. */
  private stepsAround(): { currentStepIndex: number; nextStepIndex: number } {
    const steps = this.route.steps;
    const cumulative = this.route.cumulativeDistances;
    let nextStepIndex = steps.length - 1;
    for (let i = 0; i < steps.length; i += 1) {
      const vertexDistance = cumulative[steps[i].geometryStartIndex] ?? Infinity;
      if (vertexDistance > this.progressMeters + 1) {
        nextStepIndex = i;
        break;
      }
    }
    return { currentStepIndex: Math.max(0, nextStepIndex - 1), nextStepIndex };
  }

  /** Exposed so a camera controller can compute look-ahead points without
   * constructing a second interpolator over the same route. */
  getInterpolator(): RouteInterpolator {
    return this.interpolator;
  }

  getRoute(): Route {
    return this.route;
  }

  /** The maneuver the driver has yet to make — what the HUD should instruct. */
  nextManeuver(): { step: NavigationStep; distanceMeters: number } | undefined {
    const { nextStepIndex } = this.stepsAround();
    const step = this.route.steps[nextStepIndex];
    if (!step) return undefined;
    const distanceMeters = Math.max(0, this.route.cumulativeDistances[step.geometryStartIndex] - this.progressMeters);
    return { step, distanceMeters };
  }

  setSpeed(multiplier: number) {
    this.speed = multiplier;
  }

  start() {
    if (this.status === "driving") return;
    this.status = "starting";
    this.progressMeters = 0;
    this.lastTickAt = null;
    this.status = "driving";
    this.loop();
    this.emit();
  }

  pause() {
    if (this.status !== "driving") return;
    this.status = "paused";
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.emit();
  }

  resume() {
    if (this.status !== "paused") return;
    this.status = "driving";
    this.lastTickAt = null;
    this.loop();
    this.emit();
  }

  stop() {
    this.status = "idle";
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.progressMeters = 0;
    this.emit();
  }

  /** Manually relocate the simulated position (e.g. user drags the dot, or a
   * reroute starts from a different point). */
  jumpToProgress(meters: number) {
    this.progressMeters = Math.max(0, Math.min(meters, this.interpolator.totalDistance));
    this.emit();
  }

  private avgSpeedMps(): number {
    return this.interpolator.totalDistance / Math.max(this.route.durationSeconds, 1);
  }

  private loop = () => {
    if (this.status !== "driving") return;
    const now = performance.now();
    if (this.lastTickAt == null) this.lastTickAt = now;
    const dtSeconds = Math.min(0.25, (now - this.lastTickAt) / 1000);
    this.lastTickAt = now;

    const metersPerSecond = this.avgSpeedMps() * this.speed;
    this.progressMeters = Math.min(this.interpolator.totalDistance, this.progressMeters + metersPerSecond * dtSeconds);

    const { bearing } = this.interpolator.at(this.progressMeters);
    this.bearingFilter.update(bearing);
    this.durationRemainingCache = Math.max(
      0,
      (this.interpolator.totalDistance - this.progressMeters) / Math.max(this.avgSpeedMps(), 0.01),
    );

    if (this.progressMeters >= this.interpolator.totalDistance) {
      this.status = "arrived";
      this.emit();
      return;
    }

    this.emit();
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  dispose() {
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);
    this.listeners.clear();
  }
}
