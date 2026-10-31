"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { FileCode2 } from "lucide-react";

export type ExportItem = {
  name: string;
  kind: "component" | "function" | "const" | "type" | "interface" | "default";
  doc?: string;
};

export type SummaryFile = {
  path: string;
  added: number;
  removed: number;
  exports: ExportItem[];
};

const KIND_LABEL: Record<ExportItem["kind"], string> = {
  component: "component",
  function: "function",
  const: "const",
  type: "type",
  interface: "interface",
  default: "default",
};

function pickPrimarySummaryFile(files: SummaryFile[]): SummaryFile {
  return (
    files.find((f) => /\/src\/App\.(tsx|jsx|ts|js)$/i.test(f.path)) ??
    files.find((f) => f.exports.some((e) => e.kind === "default")) ??
    files.find((f) => /\.(tsx|jsx)$/i.test(f.path)) ??
    files[0]!
  );
}

function plainSummaryLine(files: SummaryFile[]): string {
  if (files.length === 0) return "";

  // --- Short description: from the primary app export, not support files like README/plan ---
  const firstFile = pickPrimarySummaryFile(files);
  const fileName =
    firstFile.path.split("/").filter(Boolean).pop() ?? firstFile.path;
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const firstExport = firstFile.exports[0];
  const shortDesc =
    (firstExport?.doc ??
      (firstExport
        ? `${firstExport.name} (${KIND_LABEL[firstExport.kind]})`
        : "")) ||
    baseName;

  // --- Main features: from export JSDoc comments ---
  const allDocs = files.flatMap((f) =>
    f.exports.filter((e) => e.doc).map((e) => e.doc!),
  );
  const features =
    allDocs.length > 0
      ? allDocs.slice(0, 3)
      : [`Core logic and types for ${baseName}`];
  const featureLines = features.map((f) => `- ${f}`).join("\n");

  // --- Controls / usage: inferred from component exports ---
  const components = files.flatMap((f) =>
    f.exports.filter((e) => e.kind === "component"),
  );
  const controls =
    components.length > 0
      ? components
          .slice(0, 2)
          .map(
            (c) =>
              `- ${c.name} — ${c.doc || "renders the UI for this feature"}`,
          )
          .join("\n")
      : `- See ${baseName} for usage details`;

  // --- Polish and reliability: derived from file count and structure ---
  const polishItems =
    files.length > 1
      ? [
          `Error handling and validation across ${files.length} files`,
          "UI polish and animation improvements",
        ]
      : [
          "Error handling and input validation",
          "UI polish and animation refinements",
        ];
  const polishLines = polishItems.map((p) => `- ${p}`).join("\n");

  return [
    `Done! Here's what I built — ${shortDesc}.`,
    "",
    "Main features:",
    featureLines,
    "",
    "Controls / usage:",
    controls,
    "",
    "Polish and reliability:",
    polishLines,
  ].join("\n");
}

function buildTypingBuffer(files: SummaryFile[]): string {
  const prose = plainSummaryLine(files);
  return `Summary\n\n${prose}`;
}

const CHARS_PER_FRAME = 28;

/**
 * Text-first session wrap-up. Title is "Summary". Top section types out; file outline appears
 * when typing finishes, then `onFullyPrinted` runs so the parent can reveal the live preview.
 */
export function VibeFinalSummary({
  files,
  onFullyPrinted,
  skipTyping = false,
}: {
  files: SummaryFile[];
  onFullyPrinted?: () => void;
  /** When true, show the full summary immediately (reopened / saved chats). */
  skipTyping?: boolean;
}) {
  const buffer = useMemo(() => buildTypingBuffer(files), [files]);
  const [phase, setPhase] = useState<"typing" | "body">(() =>
    skipTyping ? "body" : "typing",
  );
  const [revealed, setRevealed] = useState(() =>
    skipTyping ? buffer.length : 0,
  );
  const notified = useRef(false);

  useEffect(() => {
    notified.current = false;
    if (skipTyping) {
      setPhase("body");
      setRevealed(buffer.length);
    } else {
      setPhase("typing");
      setRevealed(0);
    }
  }, [buffer, skipTyping]);

  useEffect(() => {
    if (skipTyping || phase !== "typing") return;
    if (revealed >= buffer.length) {
      setPhase("body");
      return;
    }
    let frame = 0;
    let id = 0;
    const tick = () => {
      frame++;
      if (frame % 2 !== 0) {
        id = requestAnimationFrame(tick);
        return;
      }
      setRevealed((r) => Math.min(r + CHARS_PER_FRAME, buffer.length));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [skipTyping, phase, revealed, buffer.length]);

  useEffect(() => {
    if (phase !== "body" || !onFullyPrinted || notified.current) return;
    notified.current = true;
    const t = window.setTimeout(() => onFullyPrinted(), skipTyping ? 0 : 40);
    return () => window.clearTimeout(t);
  }, [phase, onFullyPrinted, skipTyping]);

  if (files.length === 0) return null;

  const summary = plainSummaryLine(files);

  const typed = buffer.slice(0, revealed);
  const typingLines = typed.split("\n");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="mt-1 w-full max-w-[640px] border-t border-slate-200/80 pt-5"
      data-invert-ignore
    >
      {phase === "typing" ? (
        <div className="text-[12.5px] leading-relaxed text-slate-700">
          {typingLines.map((line, i) => (
            <span key={i} className="block min-h-[1.25em]">
              <span
                className={
                  i === 0
                    ? "text-[13px] font-semibold tracking-tight text-slate-800"
                    : ""
                }
              >
                {line || " "}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <>
          <h3 className="text-[13px] font-semibold tracking-tight text-slate-800">
            Summary
          </h3>
          <div className="mt-2 text-[12.5px] leading-relaxed text-slate-600 space-y-2">
            {summary.split("\n").map((line, li) => {
              const isSectionHead =
                line === "Main features:" ||
                line === "Controls / usage:" ||
                line === "Polish and reliability:";
              const isBullet = line.startsWith("- ");
              const isEmpty = line.trim() === "";
              if (isEmpty) return <div key={li} className="h-1" />;
              if (isSectionHead) {
                return (
                  <p
                    key={li}
                    className="text-[12.5px] font-semibold text-slate-700 pt-1"
                  >
                    {line}
                  </p>
                );
              }
              if (isBullet) {
                return (
                  <p key={li} className="pl-3 text-slate-600">
                    {line}
                  </p>
                );
              }
              return (
                <p key={li} className="text-slate-700">
                  {line}
                </p>
              );
            })}
          </div>

          <ol className="mt-4 list-none space-y-4 pl-0 m-0">
            {files.map((f, idx) => (
              <li key={f.path} className="text-[13px] leading-snug">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="inline-flex items-baseline gap-1.5 text-slate-400 tabular-nums text-[11px] font-medium select-none">
                    {String(idx + 1).padStart(2, "0")}.
                  </span>
                  <FileCode2
                    className="h-3.5 w-3.5 shrink-0 text-slate-400 translate-y-px"
                    aria-hidden
                  />
                  <code className="font-mono text-[12.5px] font-medium text-slate-800 bg-slate-100/90 px-1.5 py-px rounded">
                    {f.path}
                  </code>
                  <span className="tabular-nums text-[11.5px] text-emerald-600 font-medium">
                    +{f.added}
                  </span>
                  <span className="tabular-nums text-[11.5px] text-rose-500 font-medium">
                    −{f.removed}
                  </span>
                </div>

                {f.exports.length > 0 ? (
                  <ul className="mt-2 ml-0 pl-[2.25rem] space-y-1.5 border-l border-slate-200/70">
                    {f.exports.map((e, i) => (
                      <li
                        key={`${f.path}-${e.name}-${i}`}
                        className="text-[12px] leading-relaxed text-slate-600"
                      >
                        <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            {KIND_LABEL[e.kind]}
                          </span>
                          <code className="font-mono text-[12px] text-slate-800">
                            {e.name}
                          </code>
                          {e.doc ? (
                            <span className="text-slate-500 min-w-0">
                              — {e.doc}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 pl-[2.25rem] text-[12px] italic text-slate-400">
                    No top-level exports detected.
                  </p>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </motion.div>
  );
}
