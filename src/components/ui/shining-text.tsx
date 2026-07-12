"use client";

import * as React from "react";
import { motion } from "motion/react";

type ShiningTextProps = {
  text: string;
  className?: string;
};

const SHINE_GRADIENT =
  "linear-gradient(110deg, #404040 35%, #ffffff 50%, #404040 75%, #404040)";

export function ShiningText({ text, className }: ShiningTextProps) {
  return (
    <motion.span
      className={[
        "inline-block whitespace-nowrap py-[1px] font-medium text-transparent",
        className ?? "text-[15px] sm:text-[16px]",
      ].join(" ")}
      style={{
        backgroundImage: SHINE_GRADIENT,
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
      }}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{
        repeat: Infinity,
        duration: 2,
        ease: "linear",
      }}
    >
      {text}
    </motion.span>
  );
}
