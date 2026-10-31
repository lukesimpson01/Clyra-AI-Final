import { Brain, Check, FileText, Globe, MapPin, Music2, Terminal } from "lucide-react";
import { ActivityDisclosure } from "./Disclosure";
import { ActivityRow, type ActivityState } from "./ActivityRow";
import { StatusLine } from "./Shimmer";
import { SourceList, SourceStack, SourceStrip, safeSources, type SourceView } from "./Sources";
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
      <StatusLine label={label} icon={KIND_ICON[kind]} />
      {query?.trim() ? <p className="clyra-ai-status__detail">Search: {query.trim()}</p> : null}
      <SourceStrip sources={sources.slice(0, 10)} />
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
        <ActivityRow icon={<Check />} label={`Consulted ${count} source${count === 1 ? "" : "s"}`} state="done" />
      </ul>
    </ActivityDisclosure>
  );
}

/** "Sources" under a finished answer: up to five favicons and the count, opening onto the real list. */
export function SourcesFooter({ sources }: { sources: SourceView[]; query?: string }) {
  const count = safeSources(sources).length;
  if (!count) return null;
  return (
    <div className="clyra-ai-sources">
      <p className="clyra-ai-sources__heading">Sources</p>
      <ActivityDisclosure
        leading={<SourceStack sources={sources} />}
        label={<span className="clyra-ai-sources__count">{count} source{count === 1 ? "" : "s"}</span>}
      >
        <SourceList sources={sources} />
      </ActivityDisclosure>
    </div>
  );
}

/** Completed multi-step work (Google Workspace, app agents): the real steps, collapsed; a failure stays in sight. */
export function WorkSummary({ label, steps }: { label: string; steps: ActivityStep[] }) {
  const detail = useActivityDetail();
  if (!steps.length) return null;
  const failed = steps.filter((s) => s.state === "failed");
  if (detail === "compact") return failed.length ? <ActivitySteps steps={failed} /> : null;
  return (
    <ActivityDisclosure icon={failed.length ? undefined : <Check />} label={failed.length ? `${label} · ${failed.length} failed` : label} defaultOpen={detail === "detailed"}>
      <ActivitySteps steps={steps} />
    </ActivityDisclosure>
  );
}
