import { cn } from "../lib/utils";
import "./chat/assistant/agent-actions.css";

type BrowserAgentAuraProps = {
  active: boolean;
  reducedMotion?: boolean;
  className?: string;
};

/**
 * The working field of the Clyra agent-UI kit: the same drifting blue light the chat window's browser run uses
 * (`.clyra-bf`), so the Browser app and chat show one aura. It only paints while the agent is in control.
 */
export function BrowserAgentAura({ active, reducedMotion = false, className }: BrowserAgentAuraProps) {
  return <div aria-hidden className={cn("clyra-bf", active && "is-working", reducedMotion && "clyra-bf--still", className)} />;
}

export default BrowserAgentAura;
