import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";

/**
 * Seconds the assistant really spent thinking, measured on this device's clock from the moment `active` turns on
 * to the moment it turns off. Undefined until a run has been watched end — a conversation reopened from storage
 * has no measurement, and says only "Thought".
 */
export function useThoughtSeconds(active: boolean) {
  const startedAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | undefined>();
  useEffect(() => {
    if (active) {
      if (startedAt.current === null) startedAt.current = performance.now();
    } else if (startedAt.current !== null) {
      setSeconds(Math.max(1, Math.round((performance.now() - startedAt.current) / 1000)));
      startedAt.current = null;
    }
  }, [active]);
  return seconds;
}

/** The finished thinking row: the same brain, quiet, "Thought 4s". */
export function ThoughtLine({ seconds }: { seconds?: number }) {
  return (
    <div className="clyra-ai-status__line clyra-ai-status__line--finished">
      <span className="clyra-ai-status__icon" aria-hidden><Brain /></span>
      <span className="clyra-ai-status__label">{seconds ? `Thought ${seconds}s` : "Thought"}</span>
    </div>
  );
}
