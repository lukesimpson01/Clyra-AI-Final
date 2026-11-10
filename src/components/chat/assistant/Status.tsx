import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AI_EASE } from "./motion";
import { Brain, FileText, Globe, Layers, MapPin, Music2, Terminal } from "lucide-react";
import { ActivityDisclosure } from "./Disclosure";
import { ActivityRow, type ActivityState } from "./ActivityRow";
import { StatusLine } from "./Shimmer";
import { SourcesInline, SourceStrip, safeSources, type SourceView } from "./Sources";
import { useActivityDetail } from "./detail";

export type StatusKind = "thinking" | "coding" | "search" | "web" | "maps" | "spotify" | "work" | "file";

const KIND_ICON: Record<StatusKind, React.ReactNode> = {
  thinking: <Brain />,
  work: <Brain />,
  coding: <Terminal />,
  file: <FileText />,
  search: <Globe />,
  web: <Globe />,
  maps: <MapPin />,
  spotify: <Music2 />,
};

export type ActivityStep = {
  id: string;
  label: string;
  detail?: string;
  state: ActivityState;
  kind?: StatusKind;
};

/** Live work: one shimmering status line, the sources found so far, and the steps taken. */
export function AssistantStatus({
  kind,
  label,
  query,
  sources = [],
  steps = [],
  note,
}: {
  kind: StatusKind;
  label: string;
  query?: string;
  sources?: SourceView[];
  steps?: ActivityStep[];
  note?: string;
}) {
  return (
    <div className="clyra-ai-status">
      {/* A live status should identify its kind at the left edge; reasoning
          uses the same explicit brain icon as the rest of the transcript. */}
      <StatusLine label={label} icon={KIND_ICON[kind]} trailing={<SourceStrip sources={sources.slice(0, 10)} />} />
      {query?.trim() ? <p className="clyra-ai-status__detail">Search: {query.trim()}</p> : null}
      <ActivitySteps steps={steps} />
      {note ? <p className="clyra-ai-status__detail">{note}</p> : null}
    </div>
  );
}

export function ActivitySteps({ steps }: { steps: ActivityStep[] }) {
  if (!steps.length) return null;
  return (
    <ul className="clyra-ai-activity" aria-label="Activity">
      {steps.map((step) => (
        <ActivityRow
          key={step.id}
          icon={step.kind && step.kind !== "work" && step.kind !== "thinking" ? KIND_ICON[step.kind] : undefined}
          label={step.state === "failed" ? `${step.label} failed` : step.label}
          meta={step.detail}
          state={step.state}
        />
      ))}
    </ul>
  );
}

/**
 * A finished web search, collapsed: "Searched 6 sources". Inside, only what happened: the query, the pages read,
 * the sources consulted. The footer under the answer reads the same sources.
 */
export function SearchSummary({ sources, query, pagesRead }: { sources: SourceView[]; query?: string; pagesRead?: number }) {
  const detail = useActivityDetail();
  const count = safeSources(sources).length;
  if (!count || detail === "compact") return null;
  return (
    <ActivityDisclosure icon={<Globe />} label={`Searched ${count} source${count === 1 ? "" : "s"}`} defaultOpen={detail === "detailed"}>
      <ul className="clyra-ai-activity">
        {query?.trim() ? <ActivityRow icon={<Globe />} label={`Search: ${query.trim()}`} state="done" /> : null}
        {pagesRead ? <ActivityRow icon={<FileText />} label={`Read ${pagesRead} page${pagesRead === 1 ? "" : "s"}`} state="done" /> : null}
        <ActivityRow icon={<Globe />} label={`Consulted ${count} source${count === 1 ? "" : "s"}`} state="done" />
      </ul>
    </ActivityDisclosure>
  );
}

/** "Sources" under a finished answer: a pill that slides the real sources out as circular favicons. */
export function SourcesFooter({ sources }: { sources: SourceView[]; query?: string }) {
  return <SourcesInline sources={sources} />;
}

/** Completed multi-step work (Google Workspace, app agents): the real steps, collapsed; a failure stays in sight. */
export function WorkSummary({ label, steps }: { label: string; steps: ActivityStep[] }) {
  const detail = useActivityDetail();
  if (!steps.length) return null;
  const failed = steps.filter((s) => s.state === "failed");
  if (detail === "compact") return failed.length ? <ActivitySteps steps={failed} /> : null;
  return (
    <ActivityDisclosure icon={failed.length ? undefined : <Layers />} label={failed.length ? `${label} · ${failed.length} failed` : label} defaultOpen={detail === "detailed"}>
      <ActivitySteps steps={steps} />
    </ActivityDisclosure>
  );
}

/**
 * Live work, then gone: while `active` the children show; when it turns false they fold away (height and opacity)
 * so everything below glides up instead of jumping. Collapse takes COLLAPSE_SECONDS; the answer waits for it.
 */
export const ACTIVITY_COLLAPSE_SECONDS = 0.34;
export function ActivityCollapse({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {active ? (
        <motion.div
          key="live-activity"
          style={{ overflow: "hidden" }}
          initial={false}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0, transition: { duration: reduced ? 0 : ACTIVITY_COLLAPSE_SECONDS, ease: AI_EASE } }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
