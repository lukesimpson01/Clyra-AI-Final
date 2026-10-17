import { useCallback, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { approveMissionStep, runToolStep } from "../../lib/coworkMissions";
import "./cowork.css";

type Entry = {
  id: string;
  command: string;
  status: "pending-approval" | "running" | "done" | "error";
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  message?: string;
  missionId?: string;
  stepId?: string;
};

/**
 * A real command runner, not a transcript viewer: it runs `terminal.run`
 * (`lib/clyra-agent/terminal-tools.ts`) through the Mission Runtime's
 * exact-action approval flow — every command shown here actually executed,
 * with its genuine stdout/stderr, or is still waiting on an explicit
 * approval click. Forbidden commands are refused by the tool itself before
 * anything runs.
 */
export function ClyraTerminalPanel({ initialCwd }: { initialCwd?: string }) {
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
  }, []);

  const submit = useCallback(async () => {
    const text = command.trim();
    if (!text || busy) return;
    setCommand("");
    setBusy(true);
    const id = `${Date.now()}`;
    setEntries((prev) => [...prev, { id, command: text, status: "pending-approval" }]);
    scrollToEnd();
    try {
      const result = await runToolStep("terminal.run", { command: text, cwd: initialCwd }, "run");
      const missionId = result.mission.id;
      if (result.mission.state === "WAITING_FOR_APPROVAL" && result.mission.approval) {
        setEntries((prev) => prev.map((entry) => entry.id === id ? { ...entry, status: "pending-approval", missionId, stepId: result.mission.approval!.stepId } : entry));
        return;
      }
      const output = result.mission.outputs.run;
      setEntries((prev) => prev.map((entry) => entry.id === id ? {
        ...entry,
        status: output?.ok ? "done" : "error",
        stdout: String((output?.data as { stdout?: string })?.stdout || ""),
        stderr: String((output?.data as { stderr?: string })?.stderr || ""),
        exitCode: (output?.data as { exitCode?: number })?.exitCode,
        message: output?.error?.message,
      } : entry));
    } catch (error) {
      setEntries((prev) => prev.map((entry) => entry.id === id ? { ...entry, status: "error", message: error instanceof Error ? error.message : "The command could not run." } : entry));
    } finally {
      setBusy(false);
      scrollToEnd();
    }
  }, [busy, command, initialCwd, scrollToEnd]);

  const approve = useCallback(async (entry: Entry) => {
    if (!entry.missionId || !entry.stepId) return;
    setEntries((prev) => prev.map((item) => item.id === entry.id ? { ...item, status: "running" } : item));
    try {
      const result = await approveMissionStep(entry.missionId, entry.stepId);
      const output = result.mission.outputs.run;
      setEntries((prev) => prev.map((item) => item.id === entry.id ? {
        ...item,
        status: output?.ok ? "done" : "error",
        stdout: String((output?.data as { stdout?: string })?.stdout || ""),
        stderr: String((output?.data as { stderr?: string })?.stderr || ""),
        exitCode: (output?.data as { exitCode?: number })?.exitCode,
        message: output?.error?.message,
      } : item));
    } catch (error) {
      setEntries((prev) => prev.map((item) => item.id === entry.id ? { ...item, status: "error", message: error instanceof Error ? error.message : "Approval failed." } : item));
    } finally {
      scrollToEnd();
    }
  }, [scrollToEnd]);

  const decline = useCallback((entry: Entry) => {
    setEntries((prev) => prev.map((item) => item.id === entry.id ? { ...item, status: "error", message: "Not run." } : item));
  }, []);

  return (
    <div className="cowork-terminal cowork">
      <div className="cowork-panel-header">Terminal</div>
      <div className="cowork-terminal-log clyra-scroll" ref={logRef}>
        {entries.length === 0 ? <p style={{ color: "var(--agents-tertiary)", fontSize: 12 }}>Real commands run here — nothing is simulated.</p> : null}
        {entries.map((entry) => (
          <div key={entry.id} className="cowork-terminal-entry">
            <div className="cowork-terminal-entry__cmd">{entry.command}</div>
            {entry.status === "pending-approval" ? (
              <div className="cowork-terminal-approve" style={{ margin: "4px 0", borderRadius: 8 }}>
                Approve this command?
                <button type="button" className="cowork-control-btn cowork-control-btn--accent" onClick={() => void approve(entry)}>Run</button>
                <button type="button" className="cowork-control-btn" onClick={() => decline(entry)}>Cancel</button>
              </div>
            ) : entry.status === "running" ? (
              <div style={{ color: "var(--agents-tertiary)" }}><Loader2 size={12} className="animate-spin" style={{ display: "inline", marginRight: 6 }} />Running…</div>
            ) : (
              <>
                {entry.stdout ? <div>{entry.stdout}</div> : null}
                {entry.stderr ? <div className="cowork-terminal-entry__err">{entry.stderr}</div> : null}
                {entry.message ? <div className="cowork-terminal-entry__err">{entry.message}</div> : null}
                {typeof entry.exitCode === "number" ? <div style={{ color: "var(--agents-tertiary)" }}>exit {entry.exitCode}</div> : null}
              </>
            )}
          </div>
        ))}
      </div>
      <form className="cowork-terminal-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input
          className="cowork-terminal-input"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Run a command…"
          disabled={busy}
          spellCheck={false}
        />
        <button type="submit" className="cowork-control-btn cowork-control-btn--accent" disabled={busy || !command.trim()}>Run</button>
      </form>
    </div>
  );
}
