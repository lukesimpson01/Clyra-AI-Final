import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import type { VoiceCallStatus } from "../../hooks/useVoiceCall";

const STATUS_COPY: Record<VoiceCallStatus, string> = {
  idle: "Idle",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Error",
};

const STATUS_COLOR: Record<VoiceCallStatus, string> = {
  idle: "text-slate-400",
  connecting: "text-slate-400",
  listening: "text-slate-500",
  thinking: "text-amber-500",
  speaking: "text-blue-500",
  error: "text-rose-500",
};

const DOT_COLOR: Record<VoiceCallStatus, string> = {
  idle: "bg-slate-300",
  connecting: "bg-slate-300",
  listening: "bg-slate-400",
  thinking: "bg-amber-400",
  speaking: "bg-blue-500",
  error: "bg-rose-500",
};

function ThinkingPulse() {
  return (
    <div className="flex items-center gap-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-2 w-2 rounded-full bg-slate-300"
          animate={{ scale: [0.6, 1, 0.6], opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}

type VoiceStageProps = {
  status: VoiceCallStatus;
  muted: boolean;
  partialTranscript: string;
  captionLines: string[];
};

/**
 * The always-mounted centre content: name, live status word, and a 1-line
 * transcript/caption slot.
 *
 * This used to end with a 39-bar waveform, reacting to the same mic/bot
 * energy VoiceStateOrb already draws around the avatar above it — two
 * independent visualisations of one signal, stacked on the same screen. That
 * reads as two different widgets bolted together rather than one considered
 * surface, and it cost a second rAF loop for no second piece of information.
 * VoiceStateOrb is the one place energy is now shown.
 */
export function VoiceStage({
  status,
  muted,
  partialTranscript,
  captionLines,
}: VoiceStageProps) {
  const latestCaption = captionLines.filter((l) => l.trim()).slice(-1)[0] ?? "";

  let contentKey: string = status;
  let content: ReactNode = null;
  if (status === "thinking" || status === "connecting") {
    content = <ThinkingPulse />;
  } else if (status === "speaking" && latestCaption) {
    contentKey = "speaking-" + latestCaption.slice(0, 24);
    content = (
      <p className="max-w-md truncate text-[15px] leading-snug text-slate-600" data-testid="voice-caption-line">
        {latestCaption}
      </p>
    );
  } else if (status === "listening" && partialTranscript) {
    content = (
      <p className="max-w-md truncate text-[15px] leading-snug text-slate-400">{partialTranscript}</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-[26px] font-semibold tracking-tight text-slate-900">Clyra</span>
        <span className={`flex items-center gap-1.5 text-[15px] font-medium ${STATUS_COLOR[status]}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {muted && status !== "error" ? "Muted" : STATUS_COPY[status]}
            </motion.span>
          </AnimatePresence>
          <span className={`h-1.5 w-1.5 rounded-full ${DOT_COLOR[status]}`} />
        </span>
      </div>

      <div className="flex h-6 items-center justify-center px-6 text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
