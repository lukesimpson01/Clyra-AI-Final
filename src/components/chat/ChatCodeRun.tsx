import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { Conversation } from "../clyra-code/Conversation";
import { useClyraCode } from "../clyra-code/store";

/**
 * A coding request answered in chat: the same OpenCode session, event stream and action rows that Vibe Coder uses,
 * rendered in the message instead of a second, chat-only imitation. Everything shown here comes from the harness.
 */
export function ChatCodeRun({
  projectId,
  sessionId,
  projectName,
  justStarted,
}: {
  projectId: string;
  sessionId: string;
  projectName?: string;
  /** The prompt was accepted a moment ago: show the run as live until the stream says otherwise. */
  justStarted: boolean;
}) {
  const code = useClyraCode();
  const { state, running, selectThread, replyPermission, cancelRun, setState } = code;
  const bound = useRef(false);

  useEffect(() => {
    if (bound.current) return;
    bound.current = true;
    void selectThread(projectId, sessionId).then(() => {
      if (!justStarted) return;
      setState((prev) =>
        prev.runState === "complete" && Object.keys(prev.actions).length === 0
          ? { ...prev, runState: "running", runStartedAt: prev.runStartedAt ?? Date.now(), runEndedAt: null }
          : prev,
      );
    });
  }, [projectId, sessionId, justStarted, selectThread, setState]);

  const openInVibe = () => window.dispatchEvent(new CustomEvent("clyra:open-vibe-project", { detail: projectId }));

  return (
    <div className="clyra-chat-code" data-invert-ignore>
      <Conversation
        inline
        state={state}
        running={running}
        onReplyPermission={(id, response) => void replyPermission(id, response)}
        onRetry={openInVibe}
        onOpenTerminal={openInVibe}
        onOpenFile={openInVibe}
        onOpenChanges={openInVibe}
        onStop={() => void cancelRun()}
      />
      <button type="button" className="clyra-chat-code__open" onClick={openInVibe}>
        <ExternalLink size={13} strokeWidth={1.8} aria-hidden />
        Open {projectName || "project"} in Vibe Coder
      </button>
    </div>
  );
}
