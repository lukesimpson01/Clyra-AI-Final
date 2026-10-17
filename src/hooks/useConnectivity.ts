import { useEffect, useRef, useState } from "react";

export type ConnectivityStatus = "online" | "offline";

const PROBE_URL = "/api/health";
const PROBE_TIMEOUT_MS = 4000;
const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 8000;
const HEARTBEAT_MS = 20000;
// A single failed /api/health probe can mean the backend hiccuped, a dev
// server restarted, or one request was just slow — none of that means the
// user has no internet. Require a long run of consecutive failures before
// ever flipping the UI, and only ever do so when navigator.onLine agrees
// there's no network at all (the one signal that's actually reliable here).
// This is intentionally conservative: falsely blocking the user from
// sending a message is a much worse failure mode than occasionally missing
// a brief real outage.
const CONSECUTIVE_FAILURES_BEFORE_OFFLINE = 6;

/**
 * Tracks connectivity for the "Reconnecting…" indicator and for gating
 * message sending. navigator.onLine is the authoritative signal for
 * "offline" — it's only ever true when the OS itself reports no network
 * path, so it can't false-positive from a slow/misbehaving backend. The
 * active /api/health probe exists purely to detect *recovery* faster than
 * waiting on a browser `online` event, and (as a conservative fallback) to
 * catch a genuinely sustained backend outage even when navigator.onLine
 * hasn't flipped.
 */
export function useConnectivity(): { status: ConnectivityStatus } {
  const [status, setStatus] = useState<ConnectivityStatus>(
    typeof navigator === "undefined" || navigator.onLine ? "online" : "offline",
  );

  const failureCountRef = useRef(0);
  const backoffRef = useRef(BACKOFF_START_MS);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleProbe = (delayMs: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => {
        void probe();
      }, delayMs);
    };

    const isBrowserOnline = () => typeof navigator === "undefined" || navigator.onLine;

    const probe = async () => {
      if (cancelledRef.current) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

      try {
        const res = await fetch(PROBE_URL, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (cancelledRef.current) return;
        if (res.ok) {
          failureCountRef.current = 0;
          backoffRef.current = BACKOFF_START_MS;
          setStatus("online");
          scheduleProbe(HEARTBEAT_MS);
          return;
        }
        throw new Error(`probe status ${res.status}`);
      } catch {
        if (cancelledRef.current) return;
        failureCountRef.current += 1;
        // navigator.onLine says we have a network path — trust it. Keep
        // probing quietly for recovery-speed purposes, but don't declare
        // the user offline (and don't block sending) over this alone.
        if (!isBrowserOnline() || failureCountRef.current >= CONSECUTIVE_FAILURES_BEFORE_OFFLINE) {
          setStatus("offline");
        }
        backoffRef.current = Math.min(backoffRef.current * 1.5, BACKOFF_MAX_MS);
        scheduleProbe(backoffRef.current);
      } finally {
        clearTimeout(timeout);
      }
    };

    const handleOffline = () => {
      failureCountRef.current = Math.max(failureCountRef.current, 1);
      backoffRef.current = BACKOFF_START_MS;
      setStatus("offline");
      scheduleProbe(0);
    };

    const handleOnline = () => {
      backoffRef.current = BACKOFF_START_MS;
      scheduleProbe(0);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        scheduleProbe(0);
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);

    if (!isBrowserOnline()) {
      handleOffline();
    } else {
      scheduleProbe(BACKOFF_START_MS);
    }

    return () => {
      cancelledRef.current = true;
      clearTimer();
      abortRef.current?.abort();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return { status };
}
