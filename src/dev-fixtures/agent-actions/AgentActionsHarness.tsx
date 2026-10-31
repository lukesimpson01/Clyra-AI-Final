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
import { TodoChecklist } from "../../components/clyra-code/harness";
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
const t0 = Date.now() - 60000;
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
        <div className="clyra-code-ui" style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <TodoChecklist todos={[{ content: "Read the project", status: "completed" }, { content: "Edit Panel.tsx", status: "in_progress" }, { content: "Run the tests", status: "pending" }]} />
          <TodoChecklist todos={[{ content: "Done one", status: "completed" }, { content: "Done two", status: "completed" }]} finished />
        </div>
        <WeatherDiagramCard weather={sampleWeather} />
        <LocationMapCard location={{ name: "Hornsby Heights", region: "New South Wales", country: "Australia", lat: -33.6667, lon: 151.1, isCurrentLocation: true }} />
        <CreditsNotice surface="vibe" onRecovered={() => {}} />
        <div className="clyra-code-ui" style={{ marginTop: 24 }}>
          <RunHeader phase="running" label="Running npm run lint" since={t0} until={null} onStop={() => {}} />
          <ActivityGroup actions={codeActions} liveId="5" fresh={false} defaultOpen onOpenFile={() => {}} />
          <RunHeader phase="complete" label="" since={t0} until={t0 + 9000} summary="3 files changed" />
        </div>
        <MessageActions onCopy={() => setCopied(true)} onRegenerate={() => {}} onReadAloud={() => {}} onBranch={() => {}} onExport={() => {}} copied={copied} isReading={false} />
      </div>
    </div>
  );
}
