// Startup readiness for Clyra Eye. The loading screen is dismissed only when every
// critical gate has settled: the location is known (or definitively unavailable),
// the camera is placed, and the local imagery is ready. A gate that fails or times
// out degrades the start rather than blocking it. Optional feeds (aircraft, traffic,
// incidents) are reported but never block the reveal.

export const CRITICAL_STARTUP_GATES = Object.freeze(['location', 'cameraPlaced', 'localImagery']);
export const OPTIONAL_STARTUP_GATES = Object.freeze(['aircraft', 'traffic', 'incidents']);
export const STARTUP_TIMEOUT_MS = 20_000;

export function createStartupReadiness({
  timeoutMs = STARTUP_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  const gates = [...CRITICAL_STARTUP_GATES, ...OPTIONAL_STARTUP_GATES];
  const settled = new Map(gates.map((gate) => [gate, null]));
  let resolveReady;
  let finished = false;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  const snapshot = () => ({
    ok: [...settled].filter(([, value]) => value === true).map(([gate]) => gate),
    degraded: [...settled].filter(([, value]) => value === false).map(([gate]) => gate),
    pending: [...settled].filter(([, value]) => value === null).map(([gate]) => gate),
  });

  const finish = (timedOut) => {
    if (finished) return;
    finished = true;
    clearTimer(timer);
    resolveReady({ timedOut, ...snapshot() });
  };

  const check = () => {
    if (CRITICAL_STARTUP_GATES.every((gate) => settled.get(gate) !== null)) finish(false);
  };

  const timer = setTimer(() => {
    // Any critical gate still pending at the deadline is recorded as degraded.
    for (const gate of CRITICAL_STARTUP_GATES) if (settled.get(gate) === null) settled.set(gate, false);
    finish(true);
  }, timeoutMs);

  return {
    /** Record a gate's outcome: true when ready, false when it failed or was unavailable. */
    settle(gate, ok) {
      if (!settled.has(gate)) throw new TypeError(`Unknown startup gate: ${gate}`);
      if (settled.get(gate) === null) settled.set(gate, ok === true);
      check();
    },
    /** Current gate states, for the loader, the AI and tests. */
    snapshot,
    /** Resolves once the critical gates settle, or at the deadline. */
    ready,
    /** True only when every critical gate is ready (not degraded). */
    isFullyReady() {
      return CRITICAL_STARTUP_GATES.every((gate) => settled.get(gate) === true);
    },
  };
}

/** The application's readiness state. The startup chrome waits on it before revealing the globe. */
export const clyraEyeStartupReadiness = createStartupReadiness();
