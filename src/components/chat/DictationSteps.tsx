import { AudioLines, Check, Ear, Loader2, Minus, Mic, Sparkles, Wand2, X } from "lucide-react";
import type { DictationStep } from "../../lib/dictationSteps";

const ICON: Record<DictationStep["id"], typeof Mic> = { listen: Mic, endpoint: Ear, transcribe: AudioLines, fix: Wand2, polish: Sparkles };

/**
 * What a dictation is doing, as the same kind of rows a tool run shows: listening, hearing you stop, transcribing on
 * this device, fixing, polishing with AI. Each row says what happened and how long it took.
 */
export function DictationSteps({ steps, className = "" }: { steps: DictationStep[]; className?: string }) {
  if (!steps.length) return null;
  return (
    <ol className={`clyra-dsteps ${className}`.trim()} aria-label="Dictation progress" aria-live="polite">
      {steps.map((step) => {
        const Icon = ICON[step.id];
        return (
          <li key={step.id} className="clyra-dsteps__row" data-state={step.state}>
            <span className="clyra-dsteps__node" aria-hidden>
              {step.state === "active" ? <Loader2 size={11} className="clyra-dsteps__spin" /> : step.state === "done" ? <Check size={11} strokeWidth={3} /> : step.state === "failed" ? <X size={11} strokeWidth={3} /> : step.state === "skipped" ? <Minus size={11} strokeWidth={3} /> : <Icon size={11} />}
            </span>
            <Icon size={13} className="clyra-dsteps__icon" aria-hidden />
            <span className="clyra-dsteps__label">{step.label}</span>
            {step.detail ? <span className="clyra-dsteps__detail">{step.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
