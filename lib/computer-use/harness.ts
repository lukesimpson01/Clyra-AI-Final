import crypto from "node:crypto";
import { ComputerPolicy } from "./policy";
import { SemanticDesktop } from "./semantic-desktop";
import type { ComputerAction, ComputerUseSession, NativeComputerAdapter, ProposedComputerAction, SemanticDesktopSnapshot } from "./types";

export class ComputerHarness {
  readonly desktop = new SemanticDesktop();
  readonly session: ComputerUseSession;
  private abort = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(session: ComputerUseSession) => void>();
  private attempts = new Map<string, number>();
  constructor(private adapter: NativeComputerAdapter, goal: string, private policy = new ComputerPolicy()) {
    this.session = { id: crypto.randomUUID(), status: "IDLE", userGoal: goal, createdAt: Date.now(), currentPlan: { goal, steps: [] }, approvals: [], recentActions: [], checkpoints: [], takeoverActive: false, failedStrategies: [] };
  }
  subscribe(listener: (session: ComputerUseSession) => void) { this.listeners.add(listener); listener(this.session); return () => this.listeners.delete(listener); }
  private transition(status: ComputerUseSession["status"]) { this.session.status = status; this.listeners.forEach(listener => listener(this.session)); }
  async observe(): Promise<SemanticDesktopSnapshot> {
    if (this.session.takeoverActive) throw new Error("OBSERVATION_DISABLED_DURING_TAKEOVER");
    this.transition("OBSERVING"); const snapshot = this.desktop.update(await this.adapter.observe(this.abort.signal));
    this.session.activeApp = snapshot.activeApp; this.session.activeWindow = snapshot.activeWindow; this.transition("WAITING"); return snapshot;
  }
  enqueue(action: ComputerAction, proposal: ProposedComputerAction) {
    const operation = this.queue.then(() => this.perform(action, proposal));
    this.queue = operation.catch(() => undefined); return operation;
  }
  private async perform(action: ComputerAction, proposal: ProposedComputerAction) {
    if (this.abort.signal.aborted || ["PAUSED", "USER_CONTROL", "CANCELLED"].includes(this.session.status)) throw new Error("SESSION_NOT_CONTROLLING");
    const review = this.policy.review(proposal);
    if (review.decision === "DENY") { this.session.recentActions.push({ at: Date.now(), action, result: "denied", detail: review.reason }); throw new Error(`ACTION_DENIED: ${review.reason}`); }
    if (review.decision === "REQUIRE_USER_TAKEOVER") { await this.takeControl(); this.transition("NEEDS_USER"); return { review }; }
    if (review.decision === "REQUIRE_USER_CONFIRMATION") { this.transition("NEEDS_APPROVAL"); return { review }; }
    let target = action.elementId ? this.desktop.inspect(action.elementId) : undefined;
    if (action.elementId && !target) throw new Error("TARGET_NOT_FOUND");
    this.transition("OBSERVING"); const fresh = this.desktop.update(await this.adapter.observe(this.abort.signal));
    if (action.elementId) {
      const current = fresh.elements.find(element => element.id === action.elementId);
      if (!current) throw new Error("TARGET_DISAPPEARED");
      if (target?.bounds && current.bounds && JSON.stringify(target.bounds) !== JSON.stringify(current.bounds)) {
        const error = new Error("TARGET_MOVED") as Error & { previousBounds?: unknown; currentBounds?: unknown };
        error.previousBounds = target.bounds; error.currentBounds = current.bounds; throw error;
      }
      target = current;
    }
    const signature = this.desktop.signature(`${action.name}:${action.elementId ?? ""}`);
    const count = (this.attempts.get(signature) ?? 0) + 1; this.attempts.set(signature, count);
    if (count >= 4) { this.transition("NEEDS_USER"); throw new Error("STAGNATION_DETECTED"); }
    if (count >= 2) this.transition("RECOVERING"); else this.transition("ACTING");
    const result = await this.adapter.execute(action, target, this.abort.signal);
    this.session.recentActions.push({ at: Date.now(), action, result: result.success ? "success" : "failed", stateSignature: signature, detail: result.detail });
    if (!result.success) { this.transition("RECOVERING"); throw new Error(result.detail || "ACTION_FAILED"); }
    this.transition("VERIFYING"); const after = this.desktop.update(await this.adapter.observe(this.abort.signal));
    if (!this.verify(action, after)) { this.transition("RECOVERING"); throw new Error("POSTCONDITION_NOT_MET"); }
    this.attempts.delete(signature); this.transition("WAITING"); return { review, result, snapshot: after };
  }
  private verify(action: ComputerAction, state: SemanticDesktopSnapshot) {
    const expected = action.expected; if (!expected) return true;
    if (expected.windowTitleContains && !state.windows.some(w => w.title.toLowerCase().includes(expected.windowTitleContains!.toLowerCase()))) return false;
    if (expected.focusedElementId && !state.elements.some(e => e.id === expected.focusedElementId && e.focused)) return false;
    if (expected.elementExists && !state.elements.some(e => e.id === expected.elementExists)) return false;
    if (expected.valueEquals !== undefined && !state.elements.some(e => e.id === action.elementId && e.value === expected.valueEquals)) return false;
    return true;
  }
  pause() { if (!this.abort.signal.aborted) this.transition("PAUSED"); }
  async resume() { if (this.abort.signal.aborted) throw new Error("SESSION_ENDED"); this.session.takeoverActive = false; await this.observe(); }
  async takeControl() { this.session.takeoverActive = true; await this.adapter.releaseInput(); this.transition("USER_CONTROL"); }
  async cancel() { this.abort.abort(); await this.adapter.releaseInput(); this.transition("CANCELLED"); }
}
