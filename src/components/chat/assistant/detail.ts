import { useSyncExternalStore } from "react";

/**
 * How much of a run's activity the transcript shows. It changes only how existing events are displayed — never
 * reruns anything, never changes the effort the agent puts in.
 *   compact  — the current activity, results, errors and the answer
 *   normal   — compact live activity, completed groups collapsed (default)
 *   detailed — completed groups open, every observable step
 */
export type ActivityDetail = "compact" | "normal" | "detailed";
const KEY = "clyra.chat.activityDetail";
const listeners = new Set<() => void>();
const read = (): ActivityDetail => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "compact" || v === "detailed" ? v : "normal";
  } catch {
    return "normal";
  }
};
let current = read();
export function setActivityDetail(next: ActivityDetail) {
  current = next;
  try { localStorage.setItem(KEY, next); } catch { /* kept for this session */ }
  listeners.forEach((fn) => fn());
}
export function useActivityDetail(): ActivityDetail {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => current, () => "normal");
}
