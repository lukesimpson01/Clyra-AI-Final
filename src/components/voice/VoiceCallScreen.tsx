import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { AudioLines, Menu, MessageCircle, Mic, MicOff, PhoneOff, X } from "lucide-react";
import type { UseVoiceCallOptions, VoiceCallStatus, VoiceTurn } from "../../hooks/useVoiceCall";
import { VoiceStage } from "./VoiceStage";
import { VoiceWaveform } from "./VoiceWaveform";

export type VoiceCallScreenCall = {
  active: boolean;
  status: VoiceCallStatus;
  muted: boolean;
  micLevel: number;
  botLevel: number;
  partialTranscript: string;
  captionLines: string[];
  turns: VoiceTurn[];
  elapsedSeconds: number;
  error: string | null;
  endCall: () => void | Promise<void>;
  toggleMute: () => void;
};

type VoiceCallScreenProps = {
  call: VoiceCallScreenCall;
  testMode: boolean;
  /** Retained for callers while the call surface uses the shared neutral UI. */
  avatarColor?: string;
  /** Opens the existing device/settings surface. */
  onOpenSettings?: () => void;
};

const formatCallTime = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;

/** A call is a focused Chat state, not a separate sci-fi application. */
export function VoiceCallScreen({ call, testMode, onOpenSettings }: VoiceCallScreenProps) {
  const [minimized, setMinimized] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const activeLevel = call.status === "speaking" ? call.botLevel : call.micLevel;
  const timer = useMemo(() => formatCallTime(call.elapsedSeconds), [call.elapsedSeconds]);

  useEffect(() => {
    if (call.active) setMinimized(false);
    else setTranscriptOpen(false);
  }, [call.active]);

  return (
    <AnimatePresence>
      {call.active && minimized ? (
        <motion.button
          key="voice-resume-chip"
          type="button"
          aria-label="Resume call"
          onClick={() => setMinimized(false)}
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.16 }}
          className="fixed bottom-6 right-6 z-[85] flex items-center gap-2 rounded-xl border border-black/5 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm"
        >
          <span className="tabular-nums text-slate-400">{timer}</span>
          <span>{call.status === "speaking" ? "Speaking…" : call.status === "thinking" ? "Thinking…" : "Clyra call"}</span>
        </motion.button>
      ) : null}

      {call.active && !minimized ? (
        <motion.div
          key="voice-call"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[80] flex flex-col overflow-hidden bg-[var(--clyra-canvas)] text-slate-900"
        >
          <header className="relative flex h-16 shrink-0 items-center justify-between px-6">
            <button type="button" aria-label="Minimize call" onClick={() => setMinimized(true)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-black/[0.045] hover:text-slate-800"><Menu size={17} /></button>
            <span className="absolute left-1/2 -translate-x-1/2 tabular-nums text-sm font-medium tracking-wide text-slate-500">{timer}</span>
            <button type="button" aria-label="Transcript" onClick={() => setTranscriptOpen((open) => !open)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-black/[0.045] hover:text-slate-800"><MessageCircle size={17} /></button>
          </header>

          <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20">
            {testMode ? <span className="mb-8 text-xs font-medium text-amber-700">Test mode — speech is echoed locally</span> : null}
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="flex w-full max-w-xl flex-col items-center gap-7">
              <VoiceStage status={call.status} muted={call.muted} partialTranscript={call.partialTranscript} captionLines={call.captionLines} />
              <VoiceWaveform level={activeLevel} active={call.active} muted={call.muted} compact state={call.status} className="opacity-70" />
              {call.error ? <p role="alert" className="max-w-md text-center text-sm leading-6 text-rose-600">{call.error}</p> : null}
            </motion.div>
          </main>

          <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-black/[0.055] px-6 py-5">
            <button type="button" aria-label={call.muted ? "Unmute" : "Mute"} onClick={call.toggleMute} className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${call.muted ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-black/[0.045]"}`}>{call.muted ? <MicOff size={16} /> : <Mic size={16} />}{call.muted ? "Unmute" : "Mute"}</button>
            <button type="button" aria-label="Audio device settings" onClick={onOpenSettings} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-black/[0.045]"><AudioLines size={16} />Audio</button>
            <button type="button" aria-label="Show transcript" onClick={() => setTranscriptOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-black/[0.045]"><MessageCircle size={16} />Messages</button>
            <button type="button" aria-label="End call" onClick={() => void call.endCall()} className="ml-2 inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"><PhoneOff size={16} />End</button>
          </footer>

          <AnimatePresence>
            {transcriptOpen ? (
              <motion.aside initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18 }} className="absolute inset-y-0 right-0 z-20 flex w-[min(360px,90vw)] flex-col border-l border-black/[0.07] bg-[#fcfcfa] shadow-[-12px_0_36px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between px-5 py-5"><span className="text-sm font-semibold text-slate-800">Conversation</span><button type="button" aria-label="Close transcript" onClick={() => setTranscriptOpen(false)} className="rounded-md p-1 text-slate-400 transition-colors hover:bg-black/[0.045] hover:text-slate-700"><X size={16} /></button></div>
                <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-6" data-testid="voice-transcript-list">
                  {call.turns.length === 0 && !call.partialTranscript ? <p className="text-sm text-slate-400">Nothing said yet.</p> : null}
                  {call.turns.map((turn, index) => <div key={`${turn.role}-${index}`} className="space-y-1"><span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{turn.role === "user" ? "You" : "Clyra"}</span><p className="text-sm leading-6 text-slate-700">{turn.content}</p></div>)}
                  {call.partialTranscript ? <div className="space-y-1"><span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">You</span><p className="text-sm italic leading-6 text-slate-500">{call.partialTranscript}</p></div> : null}
                </div>
              </motion.aside>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export type { UseVoiceCallOptions };
