import { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronRight, Copy, FilePen, FilePlus, FileText, Terminal } from "lucide-react";
import { ShimmerText } from "./Shimmer";
import { ActivityDisclosure } from "./Disclosure";
import { ActivityRow, type ActivityState } from "./ActivityRow";
import { diffCounts, hunks, lineDiff, shortPath } from "./diff";

/** A count that rolls into place digit by digit — the line counts the edit tool really returned. */
function RollingStat({ value, sign, tone }: { value: number; sign: "+" | "−"; tone: "add" | "del" }) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setRolled(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  const digits = String(value).split("");
  return (
    <span className={`clyra-stat clyra-stat--${tone}`} aria-label={`${sign}${value} lines`}>
      <span className="clyra-stat__sign" aria-hidden>{sign}</span>
      {digits.map((digit, i) => {
        const secondary = i === digits.length - 1;
        const cycle = Array.from({ length: 40 }, (_, k) => k % 10);
        return (
          <span key={i} className="clyra-stat__window" aria-hidden>
            <span
              className={`clyra-stat__column${secondary ? " is-secondary" : ""}`}
              style={{ transform: `translate3d(0,-${rolled ? ((secondary ? 20 : 10) + Number(digit)) * 18 : 0}px,0)` }}
            >
              {cycle.map((n, k) => <span key={k}>{n}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** A file's change, reviewed: line-numbered rows, removed lines in soft red, added in soft green. */
export function FileDiff({ path, before, after, onOpen }: { path: string; before: string; after: string; onOpen?: () => void }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const counts = useMemo(() => diffCounts(lines), [lines]);
  const [full, setFull] = useState(false);
  const shown = full || !before ? lines : hunks(lines);
  const long = lines.length > 11;
  return (
    <div className="clyra-edit__card">
      <div className="clyra-edit__head">
        <span className="clyra-edit__path" title={path}>{shortPath(path, 52)}</span>
        <span className="clyra-edit__totals"><span className="clyra-edit__plus">+{counts.added}</span><span className="clyra-edit__minus">−{counts.removed}</span></span>
        {onOpen ? <button type="button" className="clyra-edit__open" onClick={onOpen}>Open file</button> : null}
      </div>
      <div className="clyra-edit__viewport" data-full={full ? "true" : undefined}>
        <div className="clyra-edit__lines">
          {shown.map((line, i) =>
            line.kind === "gap" ? (
              <div key={`gap-${i}`} className="clyra-edit__line is-gap"><span className="clyra-edit__no">⋯</span><span className="clyra-edit__mark" /><span className="clyra-edit__text">{line.count} unchanged line{line.count === 1 ? "" : "s"}</span></div>
            ) : (
              <div key={i} className={`clyra-edit__line is-${line.kind}`}>
                <span className="clyra-edit__no">{line.kind === "del" ? line.oldNo : line.newNo}</span>
                <span className="clyra-edit__mark">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
                <span className="clyra-edit__text">{line.text || " "}</span>
              </div>
            ),
          )}
        </div>
      </div>
      {long ? <button type="button" className="clyra-ai-more" onClick={() => setFull((v) => !v)}>{full ? "Show less" : before ? "Show the whole file" : "Show all lines"}</button> : null}
    </div>
  );
}

export type FileChange = { id: string; path: string; before: string; after: string; state: ActivityState };

/** "Edited ChatRenderer.tsx  +24 −8" — or, while it is being written, "Writing ChatRenderer.tsx". Opens onto its diff. */
export function FileEditRow({ change, onOpen }: { change: FileChange; onOpen?: () => void }) {
  const counts = useMemo(() => diffCounts(lineDiff(change.before, change.after)), [change.before, change.after]);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const created = !change.before;
  const name = shortPath(change.path);
  if (change.state === "running") {
    return <ul className="clyra-ai-activity"><ActivityRow icon={<FilePen />} label={`Writing ${name}`} title={change.path} state="running" /></ul>;
  }
  return (
    <section className={`clyra-edit${open ? " is-open" : ""}`} aria-label={`File edit: ${change.path}`}>
      <button type="button" className="clyra-edit__trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        <span className="clyra-ai-action-icon" aria-hidden>{created ? <FilePlus /> : <FilePen />}</span>
        <span className="clyra-edit__label">{created ? "Created" : "Edited"} <span className="clyra-ai-file" title={change.path}>{name}</span></span>
        <span className="clyra-edit__stats">
          <RollingStat value={counts.added} sign="+" tone="add" />
          <RollingStat value={counts.removed} sign="−" tone="del" />
        </span>
        <ChevronRight className="clyra-edit__arrow" aria-hidden />
      </button>
      <div className="clyra-edit__expansion" id={panelId} inert={!open}>
        <div className="clyra-edit__inner">
          {open ? <FileDiff path={change.path} before={change.before} after={change.after} onOpen={onOpen} /> : null}
        </div>
      </div>
    </section>
  );
}

/** Several changes together: "Edited 3 files", each one opening onto its own diff. */
export function FileEditGroup({ changes, onOpen }: { changes: FileChange[]; onOpen?: (path: string) => void }) {
  if (changes.length === 1) return <FileEditRow change={changes[0]} onOpen={onOpen ? () => onOpen(changes[0].path) : undefined} />;
  const running = changes.find((c) => c.state === "running");
  const total = changes.reduce((sum, c) => {
    const d = diffCounts(lineDiff(c.before, c.after));
    return { added: sum.added + d.added, removed: sum.removed + d.removed };
  }, { added: 0, removed: 0 });
  return (
    <>
      <ActivityDisclosure icon={<FilePen />} label={`Edited ${changes.filter((c) => c.state !== "running").length} files`} meta={`+${total.added} −${total.removed}`}>
        {changes.filter((c) => c.state !== "running").map((change) => <FileEditRow key={change.id} change={change} onOpen={onOpen ? () => onOpen(change.path) : undefined} />)}
      </ActivityDisclosure>
      {running ? <FileEditRow change={running} /> : null}
    </>
  );
}

/** Files that were read: one "Read ChatRenderer.tsx" row, or "Read 4 files" opening onto the list. */
export function FileReadGroup({ paths, running }: { paths: string[]; running?: string }) {
  if (running) return <ul className="clyra-ai-activity"><ActivityRow icon={<FileText />} label={`Reading ${shortPath(running)}`} title={running} state="running" /></ul>;
  if (!paths.length) return null;
  if (paths.length === 1) return <ul className="clyra-ai-activity"><ActivityRow icon={<FileText />} label={`Read ${shortPath(paths[0])}`} title={paths[0]} state="done" /></ul>;
  return (
    <ActivityDisclosure icon={<FileText />} label={`Read ${paths.length} files`}>
      <ul className="clyra-ai-activity">
        {paths.map((path) => <ActivityRow key={path} icon={<FileText />} label={shortPath(path, 60)} title={path} state="done" />)}
      </ul>
    </ActivityDisclosure>
  );
}

/**
 * A command. With a real result (exit code, output) it says "Ran" or "failed"; without one — a command an agent
 * wrote out but nothing executed — it is only "Suggested command", never shown as run. The row shows the command
 * itself beside the label; opening it shows the terminal with the real output.
 */
export function CommandRow({
  command,
  output,
  exitCode,
  note,
  state,
}: {
  command: string;
  output?: string;
  exitCode?: number | null;
  note?: string;
  state: "running" | "done" | "failed" | "suggested";
}) {
  const [open, setOpen] = useState(state === "running");
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const label = state === "running" ? "Running command" : state === "failed" ? "Command failed" : state === "suggested" ? "Suggested command" : "Ran command";
  const lines = [output?.trimEnd(), note, exitCode != null ? `Exit code: ${exitCode}` : null].filter(Boolean).join("\n\n").split("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([`$ ${command}`, ...lines].join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard unavailable: nothing to confirm */ }
  };
  return (
    <section className={`clyra-command${open ? " is-open" : ""}${state === "failed" ? " is-failed" : ""}`}>
      <button type="button" className="clyra-command__head" aria-expanded={open} aria-controls={panelId} aria-label={`${label}: ${command}`} onClick={() => setOpen((v) => !v)}>
        <span className="clyra-ai-action-icon" aria-hidden><Terminal /></span>
        <span className="clyra-command__label">{state === "running" ? <ShimmerText>{label}</ShimmerText> : label}</span>
        <code className="clyra-command__text">{command}</code>
        <ChevronRight className="clyra-command__chevron" aria-hidden />
      </button>
      <div className="clyra-command__shell" id={panelId} inert={!open}>
        <div className="clyra-command__clip">
          <div className="clyra-terminal">
            <div className="clyra-terminal__bar">
              <span>Terminal output</span>
              <button type="button" className="clyra-terminal__copy" onClick={copy} aria-label="Copy terminal output" data-tip={copied ? "Copied" : "Copy output"}>{copied ? <Check /> : <Copy />}</button>
            </div>
            <div className="clyra-terminal__command">$ {command}</div>
            <div className="clyra-terminal__output" aria-live="polite">
              {lines.filter((l, i, all) => l || (i > 0 && all[i - 1])).map((line, i) => <div key={i} className="clyra-terminal__line">{line}</div>)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
