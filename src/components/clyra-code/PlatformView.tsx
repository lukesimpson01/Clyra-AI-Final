import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDot, RotateCw, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  api,
  type DetectedTarget,
  type PlatformSnapshot,
  type SimulatorListing,
  type SwiftPackageCommand,
  type SwiftCommandResult,
} from "./api";

/* ------------------------------------------------------------------ */
/* Labels and formatting                                                */
/* ------------------------------------------------------------------ */

const TARGET_LABEL: Record<DetectedTarget["target"], string> = {
  web: "Web",
  electron: "Electron",
  "ios-native": "iOS app",
  "swift-package": "Swift package",
  backend: "Backend",
  generic: "Project",
};

const ACTIVITY_LABEL: Record<keyof PlatformSnapshot["matrix"]["activities"], string> = {
  author: "Author",
  build: "Build",
  run: "Run",
  simulate: "Simulate",
  debug: "Debug",
  test: "Test",
  sign: "Sign",
  distribute: "Distribute",
};

const APPLE_LABEL: Record<keyof PlatformSnapshot["matrix"]["apple"], string> = {
  xcode: "Full Xcode",
  iosBuild: "iOS build",
  iosSimulator: "iOS Simulator",
  xctestIos: "XCTest on iOS",
  codeSigning: "Code signing",
  archive: "App Store archive",
};

const SWIFT_LABEL: Record<keyof PlatformSnapshot["matrix"]["swift"], string> = {
  toolchain: "Swift toolchain",
  packageManager: "Swift Package Manager",
  sourceKitLsp: "SourceKit-LSP",
};

/** Seconds with one decimal, e.g. 3.71 -> "3.7s". Sub-second values read as milliseconds. */
function formatSeconds(value: number) {
  if (value < 1) return `${Math.max(1, Math.round(value * 1000))} ms`;
  return `${value.toFixed(1)}s`;
}

function formatDurationMs(ms: number) {
  return formatSeconds(ms / 1000);
}

function pluralise(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                           */
/* ------------------------------------------------------------------ */

function StateDot({ available }: { available: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full",
        available ? "bg-[#2E9A5A]" : "bg-[#C4C6CA]",
      )}
    />
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-[color:var(--border-subtle)] first:border-t-0">
      <header className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]">{title}</h3>
        {aside}
      </header>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function CapabilityRow({ label, available, reason }: { label: string; available: boolean; reason: string }) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-[6px]" title={reason}>
      <StateDot available={available} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-[color:var(--text-primary)]">{label}</span>
          <span className={cn("shrink-0 text-[11px]", available ? "text-[#2E9A5A]" : "text-[color:var(--text-tertiary)]")}>
            {available ? "Available" : "Unavailable"}
          </span>
        </div>
        <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[color:var(--text-tertiary)]">{reason}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Swift command results                                                */
/* ------------------------------------------------------------------ */

type SwiftRunState =
  | { status: "running"; command: SwiftPackageCommand }
  | { status: "done"; command: SwiftPackageCommand; result: SwiftCommandResult }
  | { status: "error"; command: SwiftPackageCommand; message: string };

function swiftHeadline(run: SwiftRunState & { status: "done" }) {
  const { command, result } = run;
  if (result.timedOut) return `${commandName(command)} stopped after its time limit`;
  if (command === "build") {
    if (result.ok) {
      return `Built${result.buildSeconds !== undefined ? ` · ${formatSeconds(result.buildSeconds)}` : ""}`;
    }
    return `Build failed · ${pluralise(result.diagnosticCounts.errors, "error")}`;
  }
  if (command === "test") {
    const tests = result.tests;
    if (!tests) return result.ok ? "Tests finished" : "Tests failed to run";
    if (tests.failed === 0 && result.ok) {
      return `${pluralise(tests.passed, "test", "tests")} passed · ${formatSeconds(tests.durationSeconds)}`;
    }
    return `${pluralise(tests.failed, "test", "tests")} failed of ${tests.total}`;
  }
  if (command === "resolve") return result.ok ? "Dependencies resolved" : "Dependency resolution failed";
  if (command === "run") return result.ok ? "Ran successfully" : "Run failed";
  return result.ok ? "Dependency graph read" : "Could not read the dependency graph";
}

function commandName(command: SwiftPackageCommand) {
  return ({ resolve: "Resolve", build: "Build", test: "Test", run: "Run", "show-dependencies": "Dependency graph" } as const)[command];
}

function SwiftRunCard({ run }: { run: SwiftRunState }) {
  const [showLog, setShowLog] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (run.status === "running") {
    return (
      <div className="flex items-center gap-2 px-3.5 py-[7px] text-[12px] text-[color:var(--text-secondary)]" role="status">
        <CircleDot className="h-[13px] w-[13px] animate-pulse text-[#3977F6]" strokeWidth={1.8} />
        {commandName(run.command)} running…
      </div>
    );
  }

  if (run.status === "error") {
    return (
      <div className="flex items-start gap-2 px-3.5 py-[7px] text-[12px] text-[color:var(--text-secondary)]" role="alert">
        <AlertTriangle className="mt-[1px] h-[13px] w-[13px] shrink-0 text-[#B5651D]" strokeWidth={1.8} />
        <span>{commandName(run.command)} could not run: {run.message}</span>
      </div>
    );
  }

  const { result } = run;
  const failed = !result.ok;
  const diagnosticCount = result.diagnostics.length;

  return (
    <div className="px-3.5 py-[7px] text-[12px]">
      <div className="flex items-start gap-2">
        {failed ? (
          <XCircle className="mt-[1px] h-[14px] w-[14px] shrink-0 text-[#C2453D]" strokeWidth={1.8} />
        ) : (
          <CheckCircle2 className="mt-[1px] h-[14px] w-[14px] shrink-0 text-[#2E9A5A]" strokeWidth={1.8} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[color:var(--text-primary)]">{swiftHeadline(run)}</div>
          <div className="mt-0.5 text-[11px] text-[color:var(--text-tertiary)]">
            {formatDurationMs(result.durationMs)}
            {result.diagnosticCounts.warnings > 0 ? ` · ${pluralise(result.diagnosticCounts.warnings, "warning")}` : ""}
          </div>
        </div>
      </div>

      {diagnosticCount > 0 ? (
        <div className="mt-1.5 pl-[22px]">
          <button
            type="button"
            onClick={() => setShowDiagnostics((v) => !v)}
            aria-expanded={showDiagnostics}
            className="flex items-center gap-1 text-[11.5px] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showDiagnostics ? "rotate-0" : "-rotate-90")} />
            {pluralise(diagnosticCount, "diagnostic")}
          </button>
          {showDiagnostics ? (
            <ul className="mt-1 flex flex-col gap-1.5">
              {result.diagnostics.map((d, index) => (
                <li key={index} className="text-[11.5px] leading-[1.45]">
                  <span className={d.severity === "error" ? "text-[#C2453D]" : "text-[#B5651D]"}>{d.severity}</span>
                  {d.file ? (
                    <span className="ml-1.5 font-mono text-[11px] text-[color:var(--text-tertiary)]">
                      {basename(d.file)}
                      {d.line !== undefined ? `:${d.line}` : ""}
                    </span>
                  ) : null}
                  <span className="ml-1.5 text-[color:var(--text-secondary)]">{d.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {result.tail ? (
        <div className="mt-1.5 pl-[22px]">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            aria-expanded={showLog}
            className="flex items-center gap-1 text-[11.5px] text-[color:var(--text-tertiary)] hover:text-[color:var(--text-secondary)]"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", showLog ? "rotate-0" : "-rotate-90")} />
            Output
          </button>
          {showLog ? (
            <pre className="mt-1 max-h-[200px] overflow-auto rounded-[6px] bg-[#F6F6F5] p-2 font-mono text-[10.5px] leading-[1.45] text-[color:var(--text-secondary)]">
              {result.tail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function basename(file: string) {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}

/* ------------------------------------------------------------------ */
/* Simulator listing                                                    */
/* ------------------------------------------------------------------ */

function SimulatorBlock({ listing }: { listing: SimulatorListing }) {
  if (listing.ok === false) {
    return <p className="px-3.5 py-[6px] text-[11.5px] leading-[1.45] text-[color:var(--text-tertiary)]">{listing.reason}</p>;
  }
  if (listing.devices.length === 0) {
    return <p className="px-3.5 py-[6px] text-[11.5px] text-[color:var(--text-tertiary)]">No simulators are installed. Add one in Xcode settings.</p>;
  }
  return (
    <ul className="flex flex-col">
      {listing.devices.map((device) => (
        <li key={device.udid} className="flex items-center gap-2.5 px-3.5 py-[5px] text-[12px]">
          <span
            aria-label={device.state === "Booted" ? "Booted" : "Shut down"}
            className={cn("h-[6px] w-[6px] shrink-0 rounded-full", device.state === "Booted" ? "bg-[#2E9A5A]" : "bg-[#C4C6CA]")}
          />
          <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{device.name}</span>
          <span className="shrink-0 text-[11px] text-[color:var(--text-tertiary)]">{device.runtime}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Panel                                                                */
/* ------------------------------------------------------------------ */

export function PlatformView({ projectId }: { projectId: string | null }) {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState<{ targets: DetectedTarget[] } | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Partial<Record<SwiftPackageCommand, SwiftRunState>>>({});
  const [configuration, setConfiguration] = useState<"debug" | "release">("debug");

  const loadPlatform = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setSnapshot(await api.platform(refresh));
      setSnapshotError(null);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : "Could not check this host.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadPlatform(); }, [loadPlatform]);

  useEffect(() => {
    setRuns({});
    setTargets(null);
    setTargetsError(null);
    if (!projectId) return;
    let cancelled = false;
    api.projectTargets(projectId)
      .then((result) => { if (!cancelled) setTargets({ targets: result.targets }); })
      .catch((error: unknown) => { if (!cancelled) setTargetsError(error instanceof Error ? error.message : "Could not read the project."); });
    return () => { cancelled = true; };
  }, [projectId]);

  const swiftAvailable = snapshot?.matrix.swift.toolchain.state === "available";
  const hasSwiftPackage = Boolean(targets?.targets.some((t) => t.target === "swift-package"));

  const runSwift = async (command: SwiftPackageCommand) => {
    if (!projectId) return;
    // Only the latest Swift result is shown. An earlier build or test describes older sources,
    // so keeping it beside a new run would present stale evidence as current.
    setRuns({ [command]: { status: "running", command } });
    try {
      const result = await api.swiftCommand(projectId, command, command === "build" || command === "test" ? { configuration } : {});
      setRuns({ [command]: { status: "done", command, result } });
    } catch (error) {
      setRuns({
        [command]: { status: "error", command, message: error instanceof Error ? error.message : "The command failed." },
      });
    }
  };

  if (!snapshot && loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center" role="status">
        <p className="text-[12.5px] text-[color:var(--text-tertiary)]">Checking this Mac…</p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-[12.5px] text-[color:var(--text-secondary)]">Platform check failed.</p>
        <p className="text-[11.5px] text-[color:var(--text-tertiary)]">{snapshotError}</p>
        <button type="button" onClick={() => void loadPlatform(true)} className="mt-1 text-[12px] text-[#3977F6] hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const { matrix } = snapshot;
  const hostLabel = `${matrix.host.platform === "darwin" ? "macOS" : matrix.host.platform === "win32" ? "Windows" : matrix.host.platform} · ${matrix.host.arch}`;

  return (
    <div className="cc-scroll min-h-0 flex-1 overflow-y-auto pb-3">
      <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium text-[color:var(--text-primary)]">Platform</div>
          <div className="text-[11px] text-[color:var(--text-tertiary)]">{hostLabel}</div>
        </div>
        <button
          type="button"
          aria-label="Re-check platform"
          onClick={() => void loadPlatform(true)}
          disabled={loading}
          className="rounded-[6px] p-1.5 text-[color:var(--text-tertiary)] hover:bg-black/[0.04] hover:text-[color:var(--text-primary)] disabled:opacity-50"
        >
          <RotateCw className={cn("h-[13px] w-[13px]", loading && "animate-spin")} strokeWidth={1.8} />
        </button>
      </div>

      {snapshotError ? (
        <p role="alert" className="px-3.5 pb-1 text-[11.5px] text-[#B5651D]">Showing the last check. {snapshotError}</p>
      ) : null}

      <Section title="Project">
        {!projectId ? (
          <p className="px-3.5 py-[6px] text-[11.5px] text-[color:var(--text-tertiary)]">Open a project to see its targets.</p>
        ) : targetsError ? (
          <p className="px-3.5 py-[6px] text-[11.5px] text-[#B5651D]">{targetsError}</p>
        ) : !targets ? (
          <p className="px-3.5 py-[6px] text-[11.5px] text-[color:var(--text-tertiary)]">Reading project files…</p>
        ) : targets.targets.length === 0 ? (
          <p className="px-3.5 py-[6px] text-[11.5px] text-[color:var(--text-tertiary)]">No recognised project target in this folder yet.</p>
        ) : (
          <ul className="flex flex-col">
            {targets.targets.map((target) => (
              <li key={`${target.location}:${target.target}`} className="flex items-start gap-2.5 px-3.5 py-[6px]">
                <span className="mt-[2px] rounded-[5px] bg-[#F1F1F0] px-1.5 py-[1px] text-[11px] font-medium text-[#34363A]">
                  {TARGET_LABEL[target.target]}
                </span>
                <span className="min-w-0 flex-1 truncate pt-[1px] font-mono text-[11px] text-[color:var(--text-tertiary)]">
                  {target.location === "." ? "project root" : target.location}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {projectId && hasSwiftPackage ? (
        <Section
          title="Swift"
          aside={
            swiftAvailable ? (
              <label className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-tertiary)]">
                Configuration
                <select
                  value={configuration}
                  onChange={(event) => setConfiguration(event.target.value as "debug" | "release")}
                  className="rounded-[5px] border border-[color:var(--border-subtle)] bg-transparent px-1 py-[1px] text-[11px] text-[color:var(--text-secondary)]"
                >
                  <option value="debug">Debug</option>
                  <option value="release">Release</option>
                </select>
              </label>
            ) : null
          }
        >
          {swiftAvailable ? (
            <>
              <div className="flex gap-1.5 px-3.5 py-1.5">
                {(["resolve", "build", "test"] as const).map((command) => (
                  <button
                    key={command}
                    type="button"
                    onClick={() => void runSwift(command)}
                    disabled={runs[command]?.status === "running"}
                    className="rounded-[6px] border border-[color:var(--border-subtle)] px-2.5 py-[4px] text-[11.5px] text-[color:var(--text-secondary)] hover:bg-black/[0.03] hover:text-[color:var(--text-primary)] disabled:opacity-50"
                  >
                    {commandName(command)}
                  </button>
                ))}
              </div>
              {(["resolve", "build", "test"] as const).map((command) =>
                runs[command] ? <SwiftRunCard key={command} run={runs[command]!} /> : null,
              )}
            </>
          ) : (
            <p className="px-3.5 py-[6px] text-[11.5px] leading-[1.45] text-[color:var(--text-tertiary)]">{matrix.swift.toolchain.reason}</p>
          )}
        </Section>
      ) : null}

      <Section title="Swift toolchain">
        <CapabilityRow label={SWIFT_LABEL.toolchain} available={matrix.swift.toolchain.state === "available"} reason={matrix.swift.toolchain.reason} />
        <CapabilityRow label={SWIFT_LABEL.packageManager} available={matrix.swift.packageManager.state === "available"} reason={matrix.swift.packageManager.reason} />
        <CapabilityRow label={SWIFT_LABEL.sourceKitLsp} available={matrix.swift.sourceKitLsp.state === "available"} reason={matrix.swift.sourceKitLsp.reason} />
      </Section>

      <Section title="Apple">
        {(Object.keys(APPLE_LABEL) as Array<keyof typeof APPLE_LABEL>).map((key) => (
          <CapabilityRow key={key} label={APPLE_LABEL[key]} available={matrix.apple[key].state === "available"} reason={matrix.apple[key].reason} />
        ))}
      </Section>

      <Section title="Simulators">
        <SimulatorBlock listing={snapshot.simulators} />
      </Section>

      <Section title="Capabilities">
        {(Object.keys(ACTIVITY_LABEL) as Array<keyof typeof ACTIVITY_LABEL>).map((key) => (
          <CapabilityRow key={key} label={ACTIVITY_LABEL[key]} available={matrix.activities[key].state === "available"} reason={matrix.activities[key].reason} />
        ))}
      </Section>
    </div>
  );
}
