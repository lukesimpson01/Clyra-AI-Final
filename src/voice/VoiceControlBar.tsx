import { Hand, MessageSquareText, Pause, Play, Square } from "lucide-react";
import type { AgentTask, VoiceCallState } from "./state/voiceSession";

type Props = {
  state: VoiceCallState;
  task: AgentTask;
  onPause: () => void;
  onResume: () => void;
  onTakeControl: () => void;
  onStop: () => void;
  onChat: () => void;
};

export function VoiceControlBar({ state, task, onPause, onResume, onTakeControl, onStop, onChat }: Props) {
  const paused = state === "paused";
  const takeover = state === "user_takeover";
  return (
    <div className="clyra-voice-agent-bar" aria-label="Agent controls">
      {task.canPause || takeover ? <button type="button" onClick={paused || takeover ? onResume : onPause}>
          {paused || takeover ? <Play size={16} /> : <Pause size={16} />}
          <span>{takeover ? "Resume Clyra" : paused ? "Resume" : "Pause"}</span>
        </button> : <span aria-hidden />}
      <p>{takeover ? "You’re controlling" : paused ? "Paused" : task.label}</p>
      <div>
        {task.canTakeControl && !takeover ? <button type="button" onClick={onTakeControl}><Hand size={16} /><span>Take Control</span></button> : null}
        <button type="button" onClick={onChat}><MessageSquareText size={16} /><span>Chat</span></button>
        {task.canStop ? <button type="button" onClick={onStop} aria-label="Stop task"><Square size={14} fill="currentColor" /></button> : null}
      </div>
    </div>
  );
}
