"use client";

import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const letterVariants = {
  hidden: {
    opacity: 0,
    filter: "blur(10px)",
  },
  show: {
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function BlurredStaggerStream({
  text,
  isStreaming,
  className,
}: {
  text: string;
  isStreaming?: boolean;
  className?: string;
}) {
  const prevLengthRef = React.useRef(0);

  React.useEffect(() => {
    if (!isStreaming) {
      prevLengthRef.current = text.length;
    }
  }, [text.length, isStreaming]);

  if (!text) return null;

  const chars = text.split("");
  const animateFrom = isStreaming ? prevLengthRef.current : chars.length;

  React.useLayoutEffect(() => {
    prevLengthRef.current = text.length;
  }, [text.length]);

  return (
    <div
      className={cn(
        "whitespace-pre-wrap font-medium leading-relaxed inline-block",
        className,
      )}
    >
      {chars.map((char, index) => {
        const isNew = index >= animateFrom;
        if (char === "\n") {
          return <br key={`nl-${index}`} />;
        }
        if (!isNew) {
          return (
            <span key={`ch-${index}`} style={{ whiteSpace: "pre" }}>
              {char === " " ? "\u00A0" : char}
            </span>
          );
        }
        return (
          <motion.span
            key={`ch-${index}`}
            variants={letterVariants}
            initial="hidden"
            animate="show"
            transition={{ delay: (index - animateFrom) * 0.015 }}
            style={{ display: "inline-block", whiteSpace: "pre" }}
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        );
      })}
    </div>
  );
}
