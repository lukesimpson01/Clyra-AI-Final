import type { AgentRunState } from "./types";

const transitions: Record<AgentRunState, ReadonlySet<AgentRunState>> = {
  IDLE: new Set(["PREPARING"]),
  PREPARING: new Set(["OBSERVING", "FAILED", "CANCELLED"]),
  OBSERVING: new Set(["PLANNING", "SEARCHING", "READING", "EDITING", "FAILED", "CANCELLED"]),
  PLANNING: new Set(["SEARCHING", "READING", "EDITING", "WAITING_FOR_USER", "FAILED", "CANCELLED"]),
  SEARCHING: new Set(["SEARCHING", "READING", "PLANNING", "EDITING", "FAILED", "CANCELLED"]),
  READING: new Set(["READING", "SEARCHING", "PLANNING", "EDITING", "EXECUTING", "FAILED", "CANCELLED"]),
  EDITING: new Set(["EDITING", "READING", "SEARCHING", "EXECUTING", "VERIFYING", "FAILED", "CANCELLED"]),
  EXECUTING: new Set(["EXECUTING", "READING", "EDITING", "VERIFYING", "WAITING_FOR_APPROVAL", "FAILED", "CANCELLED"]),
  VERIFYING: new Set(["COMPLETED", "RECOVERING", "EDITING", "EXECUTING", "FAILED", "CANCELLED"]),
  WAITING_FOR_APPROVAL: new Set(["EXECUTING", "EDITING", "FAILED", "CANCELLED"]),
  WAITING_FOR_USER: new Set(["OBSERVING", "PLANNING", "FAILED", "CANCELLED"]),
  RECOVERING: new Set(["READING", "SEARCHING", "EDITING", "EXECUTING", "VERIFYING", "FAILED", "CANCELLED"]),
  COMPLETED: new Set(["PREPARING"]),
  FAILED: new Set(["PREPARING"]),
  CANCELLED: new Set(["PREPARING"]),
};

export class AgentStateMachine {
  #state: AgentRunState = "IDLE";

  get state() { return this.#state; }

  transition(next: AgentRunState) {
    if (next === this.#state) return this.#state;
    if (!transitions[this.#state].has(next)) {
      throw new Error(`Invalid agent transition: ${this.#state} -> ${next}`);
    }
    this.#state = next;
    return this.#state;
  }
}
