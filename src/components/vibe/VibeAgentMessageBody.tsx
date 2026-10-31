"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Brain } from "lucide-react";
import {
  parseVibeAgentContent,
  sanitizeVibeAgentContent,
  type VibeParsedSegment,
} from "@/lib/parseVibeAgentContent";
import { MarkdownMessageContent } from "@/components/MarkdownMessageContent";
import {
  ActivityDisclosure,
  AssistantResponse,
  CommandRow,
  FileEditGroup,
  FileReadGroup,
  StatusLine,
  ThoughtLine,
  useActivityDetail,
  useThoughtSeconds,
  type FileChange,
} from "@/components/chat/assistant";

/** One of the agent's reasoning steps: live while it streams, then "Thought 4s" (measured here) opening onto its text. */
function VibeThought({ body, live, detail }: { body: string; live: boolean; detail: "compact" | "normal" | "detailed" }) {
  const seconds = useThoughtSeconds(live);
  if (live) return <StatusLine label="Thinking" icon={<Brain />} />;
  if (detail === "compact") return null;
  if (!body) return <ThoughtLine seconds={seconds} />;
  return (
    <ActivityDisclosure icon={<Brain />} label={seconds ? `Thought ${seconds}s` : "Thought"} defaultOpen={detail === "detailed"}>
      <p className="clyra-ai-commentary" style={{ fontSize: 13, lineHeight: "20px", color: "var(--chat-secondary)" }}>{body}</p>
    </ActivityDisclosure>
  );
}

/**
 * The coding agent's turn, as one text transcript: its commentary in body text, and what it did as compact rows —
 * the files it read, the files it wrote (with their real diffs), the commands it proposed. Everything shows as it
 * arrives: no replay, no typing, no delays. The agent works on an in-memory project and executes nothing, so a
 * command it writes is shown as a suggestion, never as run.
 */
export function VibeAgentMessageBody({
  messageId,
  content,
  isStreaming,
  isLastAssistant,
  onVibePreviewReady,
}: {
  messageId?: string;
  content: string;
  isStreaming: boolean;
  fontSizeClass?: string;
  isLastAssistant?: boolean;
  onVibePreviewReady?: (messageId: string, filesByPath: Record<string, string>) => void;
}) {
  const detail = useActivityDetail();
  const safeContent = useMemo(() => sanitizeVibeAgentContent(content), [content]);
  const hasDelims = safeContent.includes("<<<VIBE_");
  const segments = useMemo(() => parseVibeAgentContent(safeContent), [safeContent]);
  /** this reply streamed while open (a reopened chat does not open the preview again by itself) */
  const wasLive = useRef(isStreaming);
  if (isStreaming) wasLive.current = true;

  const blocks = useMemo(() => segments.filter((s) => {
    if (s.type === "text") return !!s.body.trim() && !/^Done!\s+Here's what I built/i.test(s.body.trim());
    if (s.type === "code" && /\bplan\.md\b/i.test(s.file)) return false;
    if (s.type === "thinking") {
      const body = s.body.trim().toUpperCase();
      if (body.startsWith("SHIPPED") || body.startsWith("SELF-CRITIQUE") || body.includes("PLAN.MD: COMPLETE")) return false;
    }
    return true;
  }), [segments]);

  /* the files as last written: what the live preview opens */
  const filesByPath = useMemo(() => {
    const files: Record<string, string> = {};
    for (const seg of blocks) if (seg.type === "code" && seg.complete && seg.body.trim()) files[seg.file] = seg.body;
    return files;
  }, [blocks]);

  const sentRef = useRef(false);
  useEffect(() => {
    if (isStreaming || sentRef.current || !wasLive.current || !isLastAssistant || !onVibePreviewReady || !messageId) return;
    if (!Object.keys(filesByPath).length) return;
    sentRef.current = true;
    onVibePreviewReady(messageId, filesByPath);
  }, [isStreaming, isLastAssistant, onVibePreviewReady, messageId, filesByPath]);

  if (!hasDelims && content.length > 0) {
    return (
      <AssistantResponse enter={wasLive.current} streaming={isStreaming}>
        <MarkdownMessageContent content={safeContent} codeHighlighting codePresentation="soft" />
      </AssistantResponse>
    );
  }

  /* consecutive steps of a kind become one group ("Read 4 files", "Edited 3 files") */
  type Group =
    | { kind: "thinking"; seg: Extract<VibeParsedSegment, { type: "thinking" }>; last: boolean }
    | { kind: "read"; paths: string[]; running?: string }
    | { kind: "edit"; changes: FileChange[] }
    | { kind: "run"; seg: Extract<VibeParsedSegment, { type: "run" }> }
    | { kind: "text"; body: string; last: boolean };
  const groups: Group[] = [];
  /* an earlier version of the same file, in this reply, is what a later write changed */
  const versions: Record<string, string> = {};
  /* paths as the user knows them, without the agent's sandbox folder */
  const shown = (path: string) => path.replace(/^vibe-project\//, "");
  blocks.forEach((seg, i) => {
    const last = i === blocks.length - 1;
    const prev = groups[groups.length - 1];
    if (seg.type === "thinking") groups.push({ kind: "thinking", seg, last });
    else if (seg.type === "analyze") {
      const running = last && isStreaming && !seg.complete ? shown(seg.path) : undefined;
      if (prev?.kind === "read" && !prev.running) { if (running) prev.running = running; else prev.paths.push(shown(seg.path)); }
      else groups.push({ kind: "read", paths: running ? [] : [shown(seg.path)], running });
    } else if (seg.type === "code") {
      const before = versions[seg.file] ?? "";
      const done = seg.complete || !isStreaming;
      if (done) versions[seg.file] = seg.body;
      const change: FileChange = { id: `${i}-${seg.file}`, path: shown(seg.file), before, after: seg.body, state: done ? "done" : "running" };
      /* a file written again in the same group is one change: from its first state to its last */
      const same = prev?.kind === "edit" ? prev.changes.find((c) => c.path === change.path) : undefined;
      if (same) Object.assign(same, { after: change.after, state: change.state });
      else if (prev?.kind === "edit") prev.changes.push(change);
      else groups.push({ kind: "edit", changes: [change] });
    } else if (seg.type === "run") groups.push({ kind: "run", seg });
    else groups.push({ kind: "text", body: seg.body.trim(), last });
  });

  const nodes: ReactNode[] = groups.map((group, i) => {
    const key = `${group.kind}-${i}`;
    switch (group.kind) {
      case "thinking":
        return <VibeThought key={key} body={group.seg.body.trim()} live={group.last && isStreaming && !group.seg.complete} detail={detail} />;
      case "read":
        return detail === "compact" && !group.running ? null : <FileReadGroup key={key} paths={group.paths} running={group.running} />;
      case "edit":
        return <FileEditGroup key={key} changes={group.changes} />;
      case "run": {
        const lines = group.seg.body.split("\n");
        const commandLine = lines.find((l) => l.trim().startsWith("$"));
        const command = (commandLine ?? lines[0] ?? "command").replace(/^\s*\$\s*/, "").trim() || "command";
        const note = lines.filter((l) => l !== commandLine).join("\n").trim();
        return <CommandRow key={key} command={command} note={note || undefined} state="suggested" />;
      }
      case "text":
        return (
          <AssistantResponse key={key} enter={wasLive.current} streaming={isStreaming && group.last}>
            <MarkdownMessageContent content={group.body} codeHighlighting codePresentation="soft" suppressCodeBlocks />
          </AssistantResponse>
        );
    }
  });

  const lastGroup = groups[groups.length - 1];
  const trailingIdle = Boolean(lastGroup) && (
    (lastGroup.kind === "thinking" && !lastGroup.last) ||
    (lastGroup.kind === "read" && !lastGroup.running) ||
    (lastGroup.kind === "edit" && lastGroup.changes.every((change) => change.state === "done")) ||
    lastGroup.kind === "run" ||
    (lastGroup.kind === "thinking" && lastGroup.seg.complete)
  );
  const written = Object.keys(filesByPath).length;
  return (
    <div className="clyra-ai-stack">
      {isStreaming && groups.length === 0 ? <StatusLine label="Thinking" icon={<Brain />} /> : null}
      {nodes}
      {/* between steps (a file just finished, a command written) the agent is still generating: say so instead of leaving a gap */}
      {isStreaming && groups.length > 0 && trailingIdle ? <StatusLine key="between-steps" label="Thinking" icon={<Brain />} /> : null}
      {!isStreaming && written > 1 && detail !== "compact" ? (
        <p className="clyra-ai-note">Completed {written} file changes</p>
      ) : null}
    </div>
  );
}
