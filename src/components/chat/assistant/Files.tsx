import { useMemo, useState } from "react";
import { FilePen, FilePlus, FileText, Terminal } from "lucide-react";
import { ActivityDisclosure } from "./Disclosure";
import { ActivityRow, type ActivityState } from "./ActivityRow";
import { diffCounts, hunks, lineDiff, shortPath } from "./diff";

/** A file's change as a diff: numbered lines, "−" and "+" markers, a neutral tint — never red or green. */
export function FileDiff({ path, before, after, onOpen }: { path: string; before: string; after: string; onOpen?: () => void }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const [full, setFull] = useState(false);
  const shown = full || !before ? lines : hunks(lines);
  const long = lines.length > 11;
  return (
    <div className="clyra-ai-diff">
      <div className="clyra-ai-diff__head">
        <span title={path}>{shortPath(path, 52)}</span>
        {onOpen ? <button type="button" className="clyra-chat-button" style={{ height: 26 }} onClick={onOpen}>Open file</button> : <small>{before ? "Changed lines" : "New file"}</small>}
      </div>
      <div className="clyra-ai-diff__body" data-full={full ? "true" : undefined} data-new={before ? undefined : "true"}>
        {/* as wide as the longest line, so a tint spans the whole row when the body scrolls sideways */}
        <div className="clyra-ai-diff__lines">
        {shown.map((line, i) =>
          line.kind === "gap" ? (
            <div key={`gap-${i}`} className="clyra-ai-diff__line" data-kind="gap"><span className="clyra-ai-diff__no">⋯</span><span /><span className="clyra-ai-diff__mark">{line.count} unchanged line{line.count === 1 ? "" : "s"}</span></div>
          ) : (
            <div key={i} className="clyra-ai-diff__line" data-kind={line.kind}>
              <span className="clyra-ai-diff__no">{line.kind === "del" ? line.oldNo : line.newNo}</span>
              <span className="clyra-ai-diff__mark">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
              <span>{line.text || " "}</span>
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
  const created = !change.before;
  const name = shortPath(change.path);
  if (change.state === "running") {
    return <ul className="clyra-ai-activity"><ActivityRow icon={<FilePen />} label={`Writing ${name}`} title={change.path} state="running" /></ul>;
  }
  return (
    <ActivityDisclosure
      icon={created ? <FilePlus /> : <FilePen />}
      label={<>{created ? "Created" : "Edited"} <span className="clyra-ai-file" title={change.path}>{name}</span></>}
      meta={`+${counts.added} −${counts.removed}`}
    >
      <FileDiff path={change.path} before={change.before} after={change.after} onOpen={onOpen} />
    </ActivityDisclosure>
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
 * A command. With a real result (exit code, output) it says "Ran …" or "… failed"; without one — a command an
 * agent wrote out but nothing executed — it is only "Suggested command", never shown as run.
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
  const [full, setFull] = useState(false);
  if (state === "running") return <ul className="clyra-ai-activity"><ActivityRow icon={<Terminal />} label={`Running ${command}`} state="running" /></ul>;
  const label = state === "failed" ? `${command} failed` : state === "suggested" ? `Suggested command: ${command}` : `Ran ${command}`;
  const body = [`$ ${command}`, output?.trimEnd(), note, exitCode != null ? `Exit code: ${exitCode}` : null].filter(Boolean).join("\n\n");
  return (
    <ActivityDisclosure icon={<Terminal />} label={label} className={state === "failed" ? "clyra-ai-disclosure--failed" : ""}>
      <div className="clyra-ai-terminal">
        <pre className="clyra-ai-terminal__body" data-full={full ? "true" : undefined}>{body}</pre>
        {body.split("\n").length > 11 ? <button type="button" className="clyra-ai-more" onClick={() => setFull((v) => !v)}>{full ? "Show less" : "Show all output"}</button> : null}
      </div>
    </ActivityDisclosure>
  );
}
