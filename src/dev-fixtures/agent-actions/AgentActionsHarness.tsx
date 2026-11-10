/** Dev-only gallery of the assistant's action presentation, for visual checks. Not linked from the app; never in production builds. */
import { useEffect, useState } from "react";
import {
  AssistantResponse,
  AssistantStatus,
  CommandRow,
  FileEditGroup,
  MessageActions,
  SearchSummary,
  SourcesFooter,
  ThoughtLine,
  WorkSummary,
  type FileChange,
  type SourceView,
} from "../../components/chat/assistant";
import { WeatherDiagramCard, type WeatherPayload } from "../../components/WeatherDiagramCard";
import { LocationMapCard } from "../../components/LocationMapCard";
import { CreditsNotice } from "../../components/chat/CreditsNotice";
import { PlanCard } from "../../components/clyra-code/PlanCard";
import { DiffCounters } from "../../components/clyra-code/AnimatedCounter";
import { RunFold } from "../../components/clyra-code/CodexActivity";
import { splitIntoGroups, type PlanRow } from "../../components/clyra-code/activityModel";
import { ChatMapCard } from "../../components/chat/ChatMapCard";
import { ChatAgentRunView } from "../../components/chat/ChatAgentRun";
import { ActivityGroup, RunHeader } from "../../components/clyra-code/CodexActivity";
import "../../components/clyra-code/harness.css";
import type { AgentAction } from "../../components/clyra-code/store";

const sources: SourceView[] = [
  { id: "S1", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion", host: "developer.mozilla.org", title: "prefers-reduced-motion — MDN" },
  { id: "S2", url: "https://web.dev/learn/css/animations/", host: "web.dev", title: "Learn CSS animations" },
  { id: "S3", url: "https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html", host: "www.w3.org", title: "Animation from interactions" },
];
const before = 'import { useEffect, useState } from "react";\nexport const Panel = () => {\n  return <div>Hi</div>;\n};\n';
const after = 'import { useEffect, useState } from "react";\ntype Props = { title: string };\nexport function Panel({ title }: Props) {\n  const [open, setOpen] = useState(false);\n  return <section onClick={() => setOpen(!open)}>{title}</section>;\n}\n';
const changes: FileChange[] = [
  { id: "a", path: "src/components/Panel.tsx", before, after, state: "done" },
  { id: "b", path: "src/styles/panel.css", before: "", after: ".panel {\n  padding: 24px;\n}\n", state: "done" },
];

const hours = Array.from({ length: 12 }, (_, i) => ({ time: new Date(Date.now() + i * 3600_000).toISOString(), tempC: 17 + Math.round(5 * Math.sin(i / 2.2)), precipProb: 10, weatherCode: 2 }));
const days = Array.from({ length: 7 }, (_, i) => ({ date: new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10), highC: 22 + (i % 3), lowC: 14 + (i % 4), precipProb: i % 3 === 0 ? 40 : 5, weatherCode: i % 3 === 0 ? 61 : 2, condition: "Partly cloudy" }));
/* sample payload for looking at the card only: real turns get theirs from /api/research/weather */
const sampleWeather: WeatherPayload = { location: "Hornsby Heights", region: "New South Wales", country: "Australia", isCurrentLocation: true, lat: -33.6667, lon: 151.1, observedAt: new Date().toISOString(), current: { tempC: 19, feelsLikeC: 18, weatherCode: 2, isDay: true, highC: 23, lowC: 14, precipProb: 20, humidity: 62, windKph: 14, windDirection: 120, condition: "Partly cloudy" }, hourly: hours, daily: days };
const agentRun = {
  todos: [
    { id: "t1", content: "Research Iman Gadzhi", status: "completed" as const },
    { id: "t2", content: "Research his friend Alex", status: "in_progress" as const },
    { id: "t3", content: "Write a short notes document", status: "pending" as const },
  ],
  steps: [
    { type: "step" as const, id: "s1", tool: "web_search", label: "Searched the web for “Iman Gadzhi”", state: "done" as const, sources, detail: "6 results" },
    { type: "step" as const, id: "s2", tool: "web_open", label: "Read en.wikipedia.org", state: "done" as const, detail: "Iman Gadzhi - Wikipedia" },
    { type: "step" as const, id: "s3", tool: "web_find", label: "Searched S1 for “agency”", state: "done" as const, detail: "2 passages" },
    { type: "step" as const, id: "s4", tool: "web_search", label: "Searching the web for “Alex friend of Iman Gadzhi”", state: "running" as const },
    { type: "step" as const, id: "s5", tool: "web_open", label: "Couldn’t read example.org", state: "failed" as const, error: "The site blocked automated reading" },
    { type: "step" as const, id: "s6", tool: "create_note", label: "Created the note “Iman & Alex”", state: "done" as const, document: { id: "p1", title: "Iman & Alex" } },
  ],
};
const t0 = Date.now() - 60000;
const planSequential: PlanRow[] = [{ content: "Inspect existing project", status: "completed" }, { content: "Rebuild the Working UI", status: "in_progress" }, { content: "Connect tool events", status: "pending" }, { content: "Implement all tool renderers", status: "pending" }, { content: "Run verification tests", status: "pending" }];
const planBlocked: PlanRow[] = [{ content: "Inspect project", status: "completed" }, { content: "Update components", status: "completed" }, { content: "Connect agent events", status: "completed" }, { content: "Fix failing integration test", status: "blocked" }, { content: "Run final verification", status: "pending" }];
const planDone: PlanRow[] = ["Inspect existing project", "Rebuild the Working UI", "Connect tool events", "Run verification tests"].map((content) => ({ content, status: "completed" as const }));
const planParallel: PlanRow[] = [{ content: "Review the API", status: "completed" }, { content: "Review the frontend", status: "in_progress" }, { content: "Write the summary", status: "pending" }, { content: "Check the build", status: "completed" }];
const run = (id: string, kind: string, target: string, extra: Partial<AgentAction> = {}): AgentAction =>
  ({ id, kind, tool: kind, status: "success", target, startedAt: t0, endedAt: t0 + 800, ...extra } as AgentAction);
const toolActions: AgentAction[] = [
  run("g1", "git", "git status", { tool: "bash", output: " M src/App.tsx\nexit 0" }), run("g2", "git", "git diff --stat", { tool: "bash", output: " 3 files changed\nexit 0" }),
  run("b1", "browser", "https://example.com/pricing", { tool: "browser_navigate" }), run("b2", "browser", "", { tool: "browser_get_state" }), run("b3", "browser", "#buy", { tool: "browser_click" }),
  run("i1", "image", "shots/pricing.png", { tool: "read_image", output: "image/png" }),
  run("s1", "subagent", "Review the API implementation", { tool: "subagent", output: "Found 2 issues in routes.ts" }), run("s2", "subagent", "Review the frontend components", { tool: "subagent", status: "active", endedAt: undefined }),
  run("m1", "mcp", "", { tool: "mcp__github__create_issue", output: "Created issue #42" }),
];
const timelineActions: AgentAction[] = [
  run("a", "list", "src/components"), run("b", "read", "src/App.tsx"), run("c", "read", "src/components/WorkingPanel.tsx"),
  run("d", "edit", "src/components/AgentUI.tsx", { additions: 43, deletions: 17, before, after }),
  run("e", "edit", "src/components/Working.tsx", { additions: 62, deletions: 18, before, after }),
  run("f", "create", "src/components/ToolRow.tsx", { additions: 91, deletions: 0, before: "", after }),
  run("g", "create", "src/components/PlanView.tsx", { additions: 104, deletions: 0, before: "", after }),
  run("h", "command", "npm run typecheck", { output: "exit 0" }), run("i", "build", "npm run build", { output: "built in 4.2s\nexit 0" }),
  run("j", "test", "npm run test", { status: "active", endedAt: undefined }),
];
const codeActions: AgentAction[] = [
  { id: "1", kind: "read", tool: "read", status: "success", target: "src/App.tsx", startedAt: t0, endedAt: t0 + 400 },
  { id: "2", kind: "edit", tool: "edit", status: "success", target: "src/components/Panel.tsx", additions: 5, deletions: 3, before, after, startedAt: t0 + 500, endedAt: t0 + 900 },
  { id: "3", kind: "test", tool: "bash", status: "success", target: "npm test", output: "Tests: 4 passed\nexit 0", startedAt: t0 + 1000, endedAt: t0 + 4200 },
  { id: "4", kind: "build", tool: "bash", status: "error", target: "npm run build", error: "error TS2322", startedAt: t0 + 4300, endedAt: t0 + 6000 },
  { id: "5", kind: "command", tool: "bash", status: "active", target: "npm run lint", startedAt: t0 + 6100 },
];

export default function AgentActionsHarness() {
  const [copied, setCopied] = useState(false);
  useEffect(() => { document.getElementById("clyra-preboot-surface")?.remove(); }, []);
  return (
    <div className="clyra-chat-page clyra-chat-ui" style={{ background: "#fff", minHeight: "100vh", padding: 24 }}>
      <div className="clyra-assistant-column" style={{ gap: 18 }}>
        <AssistantStatus kind="thinking" label="Thinking" />
        <AssistantStatus kind="web" label="Searching the web" query="prefers-reduced-motion guidance" sources={sources} />
        <div className="clyra-ai-stack">
          <ThoughtLine seconds={4} />
          <SearchSummary sources={sources} query="prefers-reduced-motion guidance" pagesRead={3} />
          <FileEditGroup changes={[{ ...changes[0], id: "w", state: "running" }]} />
          <FileEditGroup changes={[changes[0]]} />
          <FileEditGroup changes={changes} />
          <CommandRow command="npm run build" state="running" />
          <CommandRow command="npm test" output={"PASS  src/panel.test.ts\nTests: 4 passed"} exitCode={0} state="done" />
          <CommandRow command="npm run lint" output="error TS2322" exitCode={2} state="failed" />
          <CommandRow command="rm -rf dist" state="suggested" note="Nothing ran this." />
          <WorkSummary label="Worked through 2 steps" steps={[{ id: "1", label: "Read the file", state: "done" }, { id: "2", label: "Applied the edit", state: "failed" }]} />
          <AssistantResponse enter={false} streaming={false}>
            <p>Reduced motion is a user preference exposed through a media query. Respect it by removing non-essential movement while keeping state changes clear.</p>
            <ul><li>Replace parallax with a fade.</li><li>Keep focus rings.</li></ul>
          </AssistantResponse>
          <SourcesFooter sources={sources} />
        </div>
        <ChatAgentRunView run={agentRun} live onOpenNote={() => {}} />
        <ChatMapCard location={{ name: "Sydney Opera House", region: "New South Wales", country: "Australia", lat: -33.857198, lon: 151.2151234 }} />
        <div className="clyra-code-ui" style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <PlanCard live plan={planSequential} />
          <PlanCard live={false} plan={planBlocked} />
          <PlanCard live={false} plan={planDone} />
          <PlanCard live variant="panel" plan={planParallel} />
        </div>
        <WeatherDiagramCard weather={sampleWeather} />
        <LocationMapCard location={{ name: "Hornsby Heights", region: "New South Wales", country: "Australia", lat: -33.6667, lon: 151.1, isCurrentLocation: true }} />
        <CreditsNotice surface="vibe" onRecovered={() => {}} />
        <div className="clyra-code-ui" style={{ marginTop: 24 }}>
          <RunHeader phase="running" label="Running npm run lint" since={t0} until={null} onStop={() => {}} />
          <ActivityGroup actions={codeActions} liveId="5" fresh={false} defaultOpen onOpenFile={() => {}} />
          <RunHeader phase="complete" label="" since={t0} until={t0 + 9000} summary="3 files changed" />
        </div>
        <div className="clyra-code-root" style={{ marginTop: 28, maxWidth: 688, position: "relative", paddingBottom: 56 }}>
          <RunHeader phase="running" label="" since={t0 + 44000} until={null} actionCount={0} onStop={() => {}} />
          <p className="dsh-assistant-message" style={{ marginTop: 10 }}>I found the current activity renderer and the existing code diff components. I'm replacing only the presentation.</p>
          {splitIntoGroups(timelineActions).map((group, index) => (
            <div key={index} style={{ marginTop: 8 }}>
              <ActivityGroup actions={group} liveId="j" fresh={false} defaultOpen={index === 1} onOpenFile={() => {}} />
            </div>
          ))}
          <p className="dsh-assistant-message" style={{ marginTop: 12 }}>The new components are connected. I'm now validating the build.</p>
          <div style={{ marginTop: 12 }}><PlanCard live plan={planSequential} /></div>
          <button type="button" className="cc-change-pill"><span className="cc-change-pill-files">6 files</span><DiffCounters additions={253} deletions={32} className="cc-change-pill-counts" /></button>
        </div>
        <div className="clyra-code-root" id="tool-kinds" style={{ marginTop: 28, maxWidth: 688 }}>
          {splitIntoGroups(toolActions).map((group, index) => (
            <div key={index} style={{ marginTop: 6 }}><ActivityGroup actions={group} liveId="s2" fresh={false} defaultOpen={false} onOpenFile={() => {}} /></div>
          ))}
        </div>
        <div className="clyra-code-root" style={{ marginTop: 28, maxWidth: 688 }}>
          <RunHeader phase="complete" label="" since={t0} until={t0 + 204000} summary="6 files changed · +355 −56" actionCount={10} open={false} onToggle={() => {}} />
          <RunFold open={false}><div /></RunFold>
          <p className="dsh-assistant-message" style={{ marginTop: 10 }}>I've completed the activity UI update. Build and tests passed.</p>
          <div style={{ marginTop: 12 }}><PlanCard live={false} plan={planDone} /></div>
        </div>
        <MessageActions onCopy={() => setCopied(true)} onRegenerate={() => {}} onReadAloud={() => {}} onBranch={() => {}} onExport={() => {}} copied={copied} isReading={false} />
      </div>
    </div>
  );
}
