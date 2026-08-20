/**
 * The lower dock: console, tests, profiler and history.
 *
 * These are the surfaces that make the AI's work checkable by a human — the
 * same evidence the verifier reads, shown to the user.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Gauge, History as HistoryIcon, Play, TerminalSquare, XCircle } from "lucide-react";
import { cn } from "../../../lib/utils";
import { editorStore, useEditorState } from "../store/editorStore";
import { executeTool, type ToolContext } from "../ai/executor";

const TABS = [
  { id: "console", label: "Console", icon: TerminalSquare },
  { id: "tests", label: "Tests", icon: CheckCircle2 },
  { id: "profiler", label: "Profiler", icon: Gauge },
  { id: "history", label: "History", icon: HistoryIcon },
] as const;

interface TestReport {
  passed: boolean;
  steps: { line: number; instruction: string; ok: boolean; detail: string }[];
  failure?: { line: number; detail: string };
  failureCategory?: string;
  runtimeErrors: number;
}

interface ProfileReport {
  metrics: Record<string, number>;
  contract: Record<string, number | string>;
  violations: { budget: string; limit: number; actual: number; repair: string }[];
  renderProblems: string[];
  passed: boolean;
}

const DEFAULT_SCRIPT = `# Walk to the nearest door and open it
move player to door
interact
assert event door_opened
assert runtime_errors == 0`;

export function BottomDock({ toolContext }: { toolContext: ToolContext }) {
  const tab = useEditorState((state) => state.bottomTab);
  const entries = useEditorState((state) => state.console);
  const history = useEditorState((state) => state.history);
  const historyPosition = useEditorState((state) => state.historyPosition);
  const runtimeState = useEditorState((state) => state.runtimeState);
  const project = useEditorState((state) => state.project);

  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [report, setReport] = useState<TestReport | null>(null);
  const [profile, setProfile] = useState<ProfileReport | null>(null);
  const [busy, setBusy] = useState(false);

  const runTest = async () => {
    setBusy(true);
    setReport(null);
    try {
      if (runtimeState === "idle" || runtimeState === "stopped") {
        const start = await executeTool(toolContext, "runtime.start", { autoPlay: true });
        if (!start.ok) {
          editorStore.log("error", "editor", start.error?.message ?? "The runtime would not start.");
          return;
        }
      }
      const result = await executeTool(toolContext, "test.run", { script, name: "manual", timeoutMs: 90_000 });
      if (result.ok) setReport(result.data as TestReport);
      else editorStore.log("error", "editor", result.error?.message ?? "The test could not run.");
    } finally {
      setBusy(false);
    }
  };

  const runProfile = async () => {
    setBusy(true);
    setProfile(null);
    try {
      if (runtimeState === "idle" || runtimeState === "stopped") {
        const start = await executeTool(toolContext, "runtime.start", { autoPlay: true });
        if (!start.ok) {
          editorStore.log("error", "editor", start.error?.message ?? "The runtime would not start.");
          return;
        }
      }
      const result = await executeTool(toolContext, "performance.profile", { frames: 180 });
      if (result.ok) setProfile(result.data as ProfileReport);
      else editorStore.log("error", "editor", result.error?.message ?? "Profiling failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gm-dock">
      <nav className="gm-dock__tabs">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" className={cn(tab === entry.id && "is-active")} onClick={() => editorStore.setUi({ bottomTab: entry.id })}>
            <entry.icon size={11} />
            {entry.label}
            {entry.id === "console" && entries.some((item) => item.level === "error") ? <i className="gm-dot gm-dot--error" /> : null}
          </button>
        ))}
        <span className="gm-dock__spacer" />
        {tab === "console" ? (
          <button type="button" className="gm-dock__action" onClick={() => editorStore.clearConsole()}>
            Clear
          </button>
        ) : null}
      </nav>

      <div className="gm-dock__body">
        {tab === "console" ? (
          entries.length ? (
            <ul className="gm-console">
              {entries.slice(-160).map((entry) => (
                <li key={entry.id} className={cn(`is-${entry.level}`)}>
                  <span className="gm-console__source">{entry.source}</span>
                  <span className="gm-console__message">{entry.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gm-empty">Nothing logged yet. Runtime errors and warnings appear here while the game plays.</p>
          )
        ) : null}

        {tab === "tests" ? (
          <div className="gm-tests">
            <div className="gm-tests__editor">
              <textarea value={script} onChange={(event) => setScript(event.target.value)} spellCheck={false} aria-label="Playtest script" />
              <div className="gm-tests__controls">
                <button type="button" className="gm-button" onClick={runTest} disabled={busy || !project}>
                  <Play size={11} /> {busy ? "Running…" : "Run test"}
                </button>
                <p className="gm-hint">
                  move player to X · press ACTION · interact X · attack X until dead · wait Ns · assert player reached X · assert X.prop == value · assert event NAME
                </p>
              </div>
            </div>
            <div className="gm-tests__report">
              {report ? (
                <>
                  <p className={cn("gm-tests__verdict", report.passed ? "is-pass" : "is-fail")}>
                    {report.passed ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    {report.passed ? "Passed" : `Failed at line ${report.failure?.line ?? "?"}${report.failureCategory ? ` (${report.failureCategory})` : ""}`}
                  </p>
                  <ul>
                    {report.steps.map((step, index) => (
                      <li key={index} className={cn(step.ok ? "is-pass" : "is-fail")}>
                        {step.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                        <span>{step.detail}</span>
                      </li>
                    ))}
                  </ul>
                  {report.runtimeErrors > 0 ? <p className="gm-hint gm-hint--warn">{report.runtimeErrors} runtime error(s) during the run.</p> : null}
                </>
              ) : (
                <p className="gm-empty">Write a script and run it. The bot drives the real game and reports what actually happened.</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === "profiler" ? (
          <div className="gm-profiler">
            <button type="button" className="gm-button" onClick={runProfile} disabled={busy || !project}>
              <Gauge size={11} /> {busy ? "Measuring…" : "Profile 180 frames"}
            </button>
            {profile ? (
              <>
                <div className="gm-profiler__metrics">
                  {Object.entries(profile.metrics).map(([key, value]) => (
                    <div key={key}>
                      <strong>{typeof value === "number" ? Number(value.toFixed(1)) : value}</strong>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
                {profile.violations.length ? (
                  <ul className="gm-profiler__violations">
                    {profile.violations.map((violation) => (
                      <li key={violation.budget}>
                        <AlertTriangle size={11} />
                        <span>
                          <strong>
                            {violation.budget}: {violation.actual} over the {violation.limit} budget.
                          </strong>{" "}
                          {violation.repair}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="gm-hint">Inside every budget in the performance contract.</p>
                )}
                {profile.renderProblems.map((problem) => (
                  <p key={problem} className="gm-hint gm-hint--warn">
                    <CircleSlash size={11} /> {problem}
                  </p>
                ))}
              </>
            ) : (
              <p className="gm-empty">Measures draw calls, triangles, texture memory and frame rate against this project's performance contract.</p>
            )}
          </div>
        ) : null}

        {tab === "history" ? (
          history.length ? (
            <ul className="gm-history">
              {history
                .map((entry, index) => ({ entry, index }))
                .reverse()
                .map(({ entry, index }) => (
                  <li key={entry.id} className={cn(index > historyPosition && "is-undone")}>
                    <span className={cn("gm-history__author", `is-${entry.author}`)}>{entry.author === "ai" ? "Clyra" : entry.author === "user" ? "You" : "System"}</span>
                    <span className="gm-history__label">{entry.label}</span>
                    <span className="gm-history__diff">
                      {entry.summary.created ? `+${entry.summary.created}` : ""} {entry.summary.changed ? `~${entry.summary.changed}` : ""} {entry.summary.deleted ? `−${entry.summary.deleted}` : ""}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="gm-empty">Nothing has changed yet.</p>
          )
        ) : null}
      </div>
    </section>
  );
}
