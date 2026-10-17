import type { AgentEvent } from "../../../lib/agent-events/agent-event";

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

/**
 * A single quiet line that shows what the run is actually doing right now.
 * Both the text and whether it is shown come from the typed event stream and
 * the mission state; nothing here is inferred from model prose.
 */
export function ClyraAgentActivity({ events, missionState, reducedMotion = false }: { events: AgentEvent[]; missionState: string; reducedMotion?: boolean }) {
  if (TERMINAL_STATES.has(missionState) || events.length === 0) return null;
  const last = events[events.length - 1];
  if (last.type === "approval.required") {
    return (
      <div className="clyra-thinking-status" role="status" aria-live="polite" style={{ animation: reducedMotion ? "none" : "clyraThinkIn .4s cubic-bezier(.32,.72,0,1) both" }}>
        <div className="clyra-thinking-status__line">
          <span className="clyra-thinking-wave min-w-0 truncate" style={{ color: "#8A5A00" }}>Waiting for your approval</span>
        </div>
      </div>
    );
  }
  const running = [...events].reverse().find((event): event is Extract<AgentEvent, { type: "tool.started" }> => event.type === "tool.started");
  if (!running) return null;
  return (
    <div className="clyra-thinking-status" role="status" aria-live="polite" style={{ animation: reducedMotion ? "none" : "clyraThinkIn .4s cubic-bezier(.32,.72,0,1) both" }}>
      <div className="clyra-thinking-status__line">
        <span className="clyra-thinking-wave clyra-thinking-wave--shimmer min-w-0 truncate">{running.label}</span>
      </div>
    </div>
  );
}
