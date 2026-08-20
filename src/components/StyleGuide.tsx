import { useLayoutEffect, useState } from "react";
import { Pencil, Globe2, Terminal } from "lucide-react";
import { GlassPanel } from "./ui/GlassPanel";
import { StatusDot, type AgentStepStatus } from "./ui/StatusDot";
import { DiffStatChip } from "./ui/DiffStatChip";
import { CollapsibleDisclosureRow } from "./ui/CollapsibleDisclosureRow";
import { ComposerBar } from "./ui/ComposerBar";
import { SkeletonLoader, SkeletonListRow } from "./ui/SkeletonLoader";

const STATUSES: AgentStepStatus[] = ["queued", "running", "done", "failed"];

/**
 * Dev-only visual verification page for the shared design-token foundation
 * and component library (Platform-Wide UI/UX Overhaul, Phase 2). Reached via
 * `?embedTool=styleguide`. Not linked from product navigation.
 */
export default function StyleGuide() {
  const [value, setValue] = useState("");
  const [running, setRunning] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  useLayoutEffect(() => {
    document.getElementById("clyra-preboot-surface")?.remove();
  }, []);

  useLayoutEffect(() => {
    // The [data-theme] override selectors target :root (<html>), not a
    // nested wrapper - the attribute has to live on the actual root element.
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  return (
    <div
      className="min-h-screen w-full p-8"
      style={{ background: "var(--clyra-color-background)", color: "var(--clyra-color-label)" }}
    >
      <div className="mx-auto flex max-w-[860px] flex-col gap-8">
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em]">Style guide</h1>
          <div className="flex gap-1 rounded-full bg-[var(--clyra-color-surface-muted)] p-1">
            {(["system", "light", "dark"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                className="rounded-full px-3 py-1 text-[12px] font-medium capitalize transition-colors"
                style={{
                  background: theme === option ? "var(--clyra-color-accent)" : "transparent",
                  color: theme === option ? "#fff" : "var(--clyra-color-label-secondary)",
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--clyra-color-label-tertiary)]">Glass panel</h2>
          <div className="relative flex gap-4 rounded-2xl p-6" style={{ background: "linear-gradient(135deg, #6ea8ff, #a56eff)" }}>
            <GlassPanel className="flex-1 p-4">
              <p className="text-[13px] text-[var(--clyra-color-label-secondary)]">Regular glass — receding chrome</p>
            </GlassPanel>
            <GlassPanel strong className="flex-1 p-4">
              <p className="text-[13px] text-[var(--clyra-color-label-secondary)]">Strong glass — closest/primary control</p>
            </GlassPanel>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--clyra-color-label-tertiary)]">Status dots + diff chips</h2>
          <div className="flex items-center gap-5 rounded-xl bg-[var(--clyra-color-surface)] p-4">
            {STATUSES.map((status) => (
              <div key={status} className="flex items-center gap-1.5 text-[12px] text-[var(--clyra-color-label-secondary)]">
                <StatusDot status={status} /> {status}
              </div>
            ))}
            <div className="ml-auto flex items-center gap-3">
              <DiffStatChip added={194} removed={0} />
              <DiffStatChip added={12} removed={38} />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--clyra-color-label-tertiary)]">Collapsible disclosure rows</h2>
          <div className="rounded-xl bg-[var(--clyra-color-surface)] p-2">
            <CollapsibleDisclosureRow icon={<Pencil className="h-3.5 w-3.5" />} label="Edited" target="ChunkManager.ts" status="done" trailing={<DiffStatChip added={186} removed={12} />}>
              <p className="text-[12px] leading-5 text-[var(--clyra-color-label-secondary)]">Diff / reasoning content renders here — fully generic body.</p>
            </CollapsibleDisclosureRow>
            <CollapsibleDisclosureRow icon={<Globe2 className="h-3.5 w-3.5" />} label="Searched the web" status="running">
              <p className="text-[12px] leading-5 text-[var(--clyra-color-label-secondary)]">"voxel greedy meshing webgl"</p>
            </CollapsibleDisclosureRow>
            <CollapsibleDisclosureRow icon={<Terminal className="h-3.5 w-3.5" />} label="Ran" target="npm run test:game-maker" status="failed" />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--clyra-color-label-tertiary)]">Universal composer bar</h2>
          <ComposerBar
            value={value}
            onValueChange={setValue}
            onSubmit={() => setRunning(true)}
            onStop={() => setRunning(false)}
            running={running}
            onAttach={() => {}}
            onVoice={() => {}}
            permission="ask"
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--clyra-color-label-tertiary)]">Skeleton loaders</h2>
          <div className="rounded-xl bg-[var(--clyra-color-surface)] p-2">
            <SkeletonListRow />
            <SkeletonListRow />
            <SkeletonLoader className="mx-2 mb-2 h-24 w-[calc(100%-16px)]" />
          </div>
        </section>
      </div>
    </div>
  );
}
