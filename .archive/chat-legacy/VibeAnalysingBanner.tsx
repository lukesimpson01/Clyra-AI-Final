"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ShiningText } from "@/components/ShiningText";

const READING_HOLD_MS = 180;
const READ_SHINE_MS = 360;

type Phase = "reading" | "readShine" | "done";

export function VibeAnalysingBanner({
  path,
  lineCount,
  active = true,
  onCompleted,
  archived = false,
}: {
  path: string;
  lineCount?: number;
  active?: boolean;
  onCompleted?: () => void;
  archived?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(() => (archived ? "done" : "reading"));
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (archived) {
      setPhase("done");
      return;
    }
    if (!active || phase !== "reading") return;
    const id = window.setTimeout(() => setPhase("readShine"), READING_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [archived, active, phase]);

  useEffect(() => {
    if (archived) return;
    if (!active || phase !== "readShine") return;
    const id = window.setTimeout(() => setPhase("done"), READ_SHINE_MS);
    return () => window.clearTimeout(id);
  }, [archived, active, phase]);

  useEffect(() => {
    if (archived) return;
    if (phase !== "done" || notifiedRef.current) return;
    notifiedRef.current = true;
    onCompleted?.();
  }, [phase, onCompleted, archived]);

  const verb = phase === "reading" ? "Inspecting" : "Inspected";

  return (
    <motion.span
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="clyra-vibe-agent-pill block max-w-[640px] px-3 py-2 text-[12.5px] leading-6 text-slate-600 backdrop-blur-md backdrop-saturate-125"
    >
      {phase === "readShine" ? (
        <ShiningText
          text={verb}
          preset="thinkingChat"
          play
          className="text-[12.5px] font-medium"
        />
      ) : (
        <span className={phase === "done" ? "font-bold" : "font-medium"}>
          {verb}
        </span>
      )}{" "}
      <code className="font-mono text-[12px] text-slate-500">
        {path}
      </code>
      {lineCount != null && <> (lines 1-{lineCount})</>}
    </motion.span>
  );
}
