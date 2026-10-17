// The one renderer for every Shorts template. The editor preview and the
// headless export page both mount this component and call it with a timeline
// time, so a frame looks the same whether a user scrubs it or FFmpeg receives it.
// Everything here is a pure function of (project, timeMs): no wall-clock
// animations, no CSS keyframes, so repeated renders of one time are identical.

import type { CSSProperties, ReactNode, RefObject } from "react";
import {
  outputSize,
  type CaptionStyle,
  type CaptionWord,
  type ChoiceItem,
  type ListItem,
  type MessageItem,
  type NarrationItem,
  type QuizItem,
  type ShortsProject,
  type StoryItem,
  type TimelineItem,
  type TitleItem,
} from "../../../lib/shorts/schema";
import {
  CHOICE_OPTION_MS,
  CHOICE_OR_MS,
  CHOICE_PROMPT_MS,
  CHOICE_REVEAL_MS,
  QUIZ_ANSWER_STAGGER_MS,
  QUIZ_QUESTION_MS,
  QUIZ_REVEAL_MS,
  captionPages,
} from "../../../lib/shorts/templates";
import { FakeTextScene } from "./FakeTextScene";

export type CanvasMode = "preview" | "export";

export type ShortsCanvasProps = {
  project: ShortsProject;
  timeMs: number;
  mode: CanvasMode;
  /** Width in pixels the stage is displayed at. Height follows the project aspect. */
  pixelWidth: number;
  showSafeArea?: boolean;
  videoRef?: RefObject<HTMLVideoElement | null>;
  selectedItemId?: string | null;
};

const DESIGN_SHORT_SIDE = 1080;
const MESSAGE_ENTER_MS = 240;
const SAFE_TOP = 0.09;
const SAFE_BOTTOM = 0.2;

export function designSizeFor(project: ShortsProject) {
  return outputSize(project.aspect, DESIGN_SHORT_SIDE as 1080);
}

export function ShortsCanvas({ project, timeMs, mode, pixelWidth, showSafeArea = false, videoRef, selectedItemId }: ShortsCanvasProps) {
  const design = designSizeFor(project);
  const scale = pixelWidth / design.width;
  const pixelHeight = design.height * scale;
  const t = Math.max(0, timeMs);
  const isExport = mode === "export";
  const background = project.background;

  const isFakeText = project.kind === "fake-text";
  const stageItems = project.items.filter((item) => item.type !== "message" && t >= item.startMs && t < item.startMs + item.durationMs);
  const hasChat = !isFakeText && project.items.some((item) => item.type === "message");
  const chatTheme = resolveChatTheme(project.template.style, project.template.theme);

  return (
    <div
      data-shorts-stage
      data-time-ms={Math.round(t)}
      style={{ position: "relative", width: pixelWidth, height: pixelHeight, overflow: "hidden", background: isExport ? "transparent" : "#0b0c10", isolation: "isolate" }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, width: design.width, height: design.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <BackgroundLayer background={background} projectId={project.id} mode={mode} videoRef={videoRef} />

        {isFakeText ? <FakeTextScene project={project} timeMs={t} design={design} /> : null}
        {hasChat ? <ChatStage project={project} timeMs={t} theme={chatTheme} selectedItemId={selectedItemId} /> : null}

        {stageItems.map((item) => (
          <StageItem key={item.id} item={item} timeMs={t} project={project} selected={selectedItemId === item.id} />
        ))}

        {project.captions.enabled && project.captions.words.length ? (
          <CaptionLayer words={project.captions.words} style={project.captions.style} timeMs={t} design={design} />
        ) : null}

        {showSafeArea && !isExport ? <SafeAreaGuide design={design} /> : null}
      </div>
    </div>
  );
}

function BackgroundLayer({ background, projectId, mode, videoRef }: { background: ShortsProject["background"]; projectId: string; mode: CanvasMode; videoRef?: RefObject<HTMLVideoElement | null> }) {
  if (background.type === "solid") return <div style={{ position: "absolute", inset: 0, background: background.color }} />;
  if (background.type === "gradient") {
    return <div style={{ position: "absolute", inset: 0, background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})` }} />;
  }
  // Video backgrounds are composited by FFmpeg during export, so the page only draws them for the editor.
  if (mode === "export") return null;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#000" }}>
      <video
        ref={videoRef}
        src={`/api/shorts/projects/${projectId}/${background.file}`}
        muted
        playsInline
        preload="auto"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${background.offsetX}%, ${background.offsetY}%) scale(${background.zoom})`,
          filter: background.blurPx ? `blur(${background.blurPx}px)` : undefined,
        }}
      />
      {background.dim > 0 ? <div style={{ position: "absolute", inset: 0, background: `rgba(0,0,0,${background.dim})` }} /> : null}
    </div>
  );
}

type ChatTheme = {
  name: "imessage" | "whatsapp" | "dusk";
  panel: string;
  header: string;
  headerText: string;
  incoming: string;
  incomingText: string;
  outgoing: string;
  outgoingText: string;
  muted: string;
  accent: string;
  wallpaper?: string;
};

function resolveChatTheme(style: string, theme: "light" | "dark"): ChatTheme {
  if (style === "whatsapp") {
    return {
      name: "whatsapp",
      panel: "#efeae2",
      header: "#008069",
      headerText: "#ffffff",
      incoming: "#ffffff",
      incomingText: "#111b21",
      outgoing: "#d9fdd3",
      outgoingText: "#111b21",
      muted: "#667781",
      accent: "#008069",
      wallpaper: "#efeae2",
    };
  }
  if (style === "dusk" || theme === "dark") {
    return {
      name: "dusk",
      panel: "#17181d",
      header: "#1d1f26",
      headerText: "#f2f2f4",
      incoming: "#2a2c34",
      incomingText: "#f2f2f4",
      outgoing: "#7c5cff",
      outgoingText: "#ffffff",
      muted: "#8b8e99",
      accent: "#7c5cff",
    };
  }
  return {
    name: "imessage",
    panel: "#ffffff",
    header: "#f6f6f8",
    headerText: "#111111",
    incoming: "#e9e9eb",
    incomingText: "#111111",
    outgoing: "#1f84ff",
    outgoingText: "#ffffff",
    muted: "#8e8e93",
    accent: "#1f84ff",
  };
}

function ChatStage({ project, timeMs, theme, selectedItemId }: { project: ShortsProject; timeMs: number; theme: ChatTheme; selectedItemId?: string | null }) {
  const all = project.items.filter((item): item is MessageItem => item.type === "message").sort((a, b) => a.startMs - b.startMs);
  const visible = all.filter((item) => timeMs >= item.startMs).slice(-9);
  const typing = all.find((item) => timeMs >= item.startMs - item.typingMs && timeMs < item.startMs);
  const contact = all.find((item) => item.side === "left")?.sender || "Contact";
  const panelLeft = 56;
  const panelTop = 210;
  return (
    <div
      style={{
        position: "absolute",
        left: panelLeft,
        right: panelLeft,
        top: panelTop,
        bottom: 300,
        borderRadius: 56,
        background: theme.panel,
        boxShadow: "0 30px 80px rgba(0,0,0,0.22)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ height: 178, background: theme.header, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, borderBottom: `1px solid ${theme.name === "dusk" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.08)"}` }}>
        <div style={{ width: 96, height: 96, borderRadius: 48, background: avatarColor(contact), color: "#fff", display: "grid", placeItems: "center", fontSize: 40, fontWeight: 600 }}>
          {initials(contact)}
        </div>
        <div style={{ color: theme.headerText, fontSize: 34, fontWeight: 600 }}>{contact}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 16, padding: "24px 36px 28px", overflow: "hidden", background: theme.wallpaper ?? theme.panel }}>
        {visible.map((message) => (
          <Bubble key={message.id} message={message} timeMs={timeMs} theme={theme} selected={selectedItemId === message.id} />
        ))}
        {typing ? <TypingBubble theme={theme} side={typing.side} timeMs={timeMs} /> : null}
      </div>
    </div>
  );
}

function Bubble({ message, timeMs, theme, selected }: { message: MessageItem; timeMs: number; theme: ChatTheme; selected: boolean }) {
  const progress = clamp01((timeMs - message.startMs) / MESSAGE_ENTER_MS);
  const mine = message.side === "right";
  const reactionShown = timeMs >= message.startMs + 350 && message.reaction;
  const receiptShown = mine && message.receipt && message.receipt !== "none" && timeMs >= message.startMs + 500;
  return (
    <div
      data-item-id={message.id}
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: "78%",
        opacity: progress,
        transform: `translateY(${(1 - progress) * 16}px) scale(${0.96 + 0.04 * progress})`,
        transformOrigin: mine ? "bottom right" : "bottom left",
        position: "relative",
      }}
    >
      <div
        style={{
          background: mine ? theme.outgoing : theme.incoming,
          color: mine ? theme.outgoingText : theme.incomingText,
          borderRadius: 44,
          padding: "20px 32px",
          fontSize: 38,
          lineHeight: 1.25,
          fontWeight: 400,
          boxShadow: selected ? "0 0 0 6px rgba(30,111,255,0.45)" : undefined,
          wordBreak: "break-word",
        }}
      >
        {message.text}
      </div>
      {reactionShown ? (
        <div style={{ position: "absolute", top: -22, [mine ? "left" : "right"]: -14, background: theme.incoming, borderRadius: 999, padding: "4px 12px", fontSize: 30, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>{message.reaction}</div>
      ) : null}
      {receiptShown ? (
        <div style={{ textAlign: "right", color: theme.muted, fontSize: 24, marginTop: 6, paddingRight: 8 }}>
          {message.receipt === "read" ? "Read" : "Delivered"}
        </div>
      ) : null}
    </div>
  );
}

function TypingBubble({ theme, side, timeMs }: { theme: ChatTheme; side: "left" | "right"; timeMs: number }) {
  const mine = side === "right";
  return (
    <div style={{ alignSelf: mine ? "flex-end" : "flex-start", background: mine ? theme.outgoing : theme.incoming, borderRadius: 44, padding: "24px 30px", display: "flex", gap: 10 }}>
      {[0, 1, 2].map((dot) => {
        const phase = (timeMs / 260 + dot * 0.9) % (Math.PI * 2);
        const level = 0.35 + 0.65 * Math.max(0, Math.sin(phase));
        return <span key={dot} style={{ width: 16, height: 16, borderRadius: 8, background: mine ? theme.outgoingText : theme.muted, opacity: level }} />;
      })}
    </div>
  );
}

function StageItem({ item, timeMs, project, selected }: { item: TimelineItem; timeMs: number; project: ShortsProject; selected: boolean }) {
  const local = timeMs - item.startMs;
  const ratio = clamp01(local / Math.max(1, item.durationMs));
  switch (item.type) {
    case "choice":
      return <ChoiceStage item={item} local={local} selected={selected} />;
    case "quiz":
      return <QuizStage item={item} local={local} selected={selected} />;
    case "list-item":
      return <ListStage item={item} local={local} selected={selected} accent={project.template.accent} />;
    case "story":
      return <StoryStage item={item} local={local} ratio={ratio} selected={selected} />;
    case "title":
      return <TitleStage item={item} local={local} selected={selected} accent={project.template.accent} />;
    case "narration":
      return <NarrationStage item={item} ratio={ratio} selected={selected} />;
    default:
      return null;
  }
}

function fadeIn(local: number, ms = 280) {
  return clamp01(local / ms);
}

function ChoiceStage({ item, local, selected }: { item: ChoiceItem; local: number; selected: boolean }) {
  const countdownStart = CHOICE_PROMPT_MS + CHOICE_OPTION_MS * 2 + CHOICE_OR_MS;
  const countdownMs = item.countdownSeconds * 1000;
  const revealStart = countdownStart + countdownMs;
  const revealed = local >= revealStart;
  const leftShown = local >= CHOICE_PROMPT_MS;
  const rightShown = local >= CHOICE_PROMPT_MS + CHOICE_OPTION_MS;
  const orShown = local >= CHOICE_PROMPT_MS + CHOICE_OPTION_MS * 2;
  const remaining = local >= countdownStart && local < revealStart ? Math.ceil((revealStart - local) / 1000) : 0;
  const reveal = clamp01((local - revealStart) / CHOICE_REVEAL_MS);
  const percent = revealed ? item.leftPercent * reveal + 50 * (1 - reveal) : 50;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", outline: selected ? "10px solid rgba(30,111,255,0.55)" : undefined, outlineOffset: -10 }}>
      <div style={{ position: "absolute", top: 210, left: 80, right: 80, textAlign: "center", color: "#fff", fontSize: 66, fontWeight: 700, lineHeight: 1.12, textShadow: "0 4px 24px rgba(0,0,0,0.45)", opacity: fadeIn(local) }}>
        {item.question}
      </div>
      <ChoiceHalf label={item.left} top shown={leftShown} percent={percent} revealed={revealed} color="#e8352b" fraction={revealed ? reveal : 0} local={local} />
      <ChoiceHalf label={item.right} top={false} shown={rightShown} percent={100 - percent} revealed={revealed} color="#1f6fff" fraction={revealed ? reveal : 0} local={local} />
      <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 10, marginTop: -5, background: "#0b0c10", opacity: fadeIn(local, 200) }} />
      {orShown ? (
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 150, height: 150, borderRadius: 75, background: "#0b0c10", color: "#fff", display: "grid", placeItems: "center", fontSize: 44, fontWeight: 800, boxShadow: "0 16px 40px rgba(0,0,0,0.35)", border: "4px solid #fff", opacity: fadeIn(local - CHOICE_PROMPT_MS - CHOICE_OPTION_MS * 2, 200) }}>
          {remaining > 0 ? remaining : "OR"}
        </div>
      ) : null}
      {revealed ? (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 380, textAlign: "center", color: "#fff", fontSize: 26, opacity: reveal * 0.9, textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>
          Simulated split · not real poll data
        </div>
      ) : null}
    </div>
  );
}

function ChoiceHalf({ label, top, shown, percent, revealed, color, fraction, local }: { label: string; top: boolean; shown: boolean; percent: number; revealed: boolean; color: string; fraction: number; local: number }) {
  const enter = shown ? fadeIn(local - (top ? CHOICE_PROMPT_MS : CHOICE_PROMPT_MS + CHOICE_OPTION_MS), 260) : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: top ? 0 : "50%",
        height: "50%",
        background: color,
        opacity: enter,
        transform: `translateY(${(1 - enter) * (top ? -40 : 40)}px)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 90px",
        boxSizing: "border-box",
        color: "#fff",
      }}
    >
      <div style={{ fontSize: 74, fontWeight: 700, textAlign: "center", lineHeight: 1.1, textShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>{label}</div>
      {revealed ? (
        <div style={{ marginTop: 26, fontSize: 56, fontWeight: 700, opacity: fraction }}>{Math.round(percent)}%</div>
      ) : null}
      {revealed ? (
        <div style={{ position: "absolute", left: 0, bottom: 0, height: 14, width: `${percent}%`, background: "rgba(255,255,255,0.85)" }} />
      ) : null}
    </div>
  );
}

function QuizStage({ item, local, selected }: { item: QuizItem; local: number; selected: boolean }) {
  const answersStart = QUIZ_QUESTION_MS;
  const countdownStart = answersStart + item.answers.length * QUIZ_ANSWER_STAGGER_MS;
  const revealStart = countdownStart + item.countdownSeconds * 1000;
  const revealed = local >= revealStart;
  const remaining = !revealed && local >= countdownStart ? Math.ceil((revealStart - local) / 1000) : 0;
  const reveal = clamp01((local - revealStart) / QUIZ_REVEAL_MS);
  const labels = ["A", "B", "C", "D"];
  return (
    <div style={{ position: "absolute", left: 70, right: 70, top: 230, color: "#fff", outline: selected ? "6px solid rgba(30,111,255,0.6)" : undefined, outlineOffset: 12, borderRadius: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 30, opacity: fadeIn(local) }}>
        <div style={{ fontSize: 62, fontWeight: 700, lineHeight: 1.12, textShadow: "0 4px 20px rgba(0,0,0,0.35)" }}>{item.question}</div>
        {remaining > 0 || (!revealed && local >= countdownStart) ? (
          <div style={{ minWidth: 120, height: 120, borderRadius: 60, border: "8px solid rgba(255,255,255,0.9)", display: "grid", placeItems: "center", fontSize: 54, fontWeight: 800 }}>{remaining}</div>
        ) : null}
      </div>
      <div style={{ marginTop: 52, display: "flex", flexDirection: "column", gap: 22 }}>
        {item.answers.map((answer, index) => {
          const shown = local >= answersStart + index * QUIZ_ANSWER_STAGGER_MS;
          const enter = shown ? fadeIn(local - (answersStart + index * QUIZ_ANSWER_STAGGER_MS), 260) : 0;
          const correct = revealed && index === item.correctIndex;
          const wrong = revealed && index !== item.correctIndex;
          return (
            <div
              key={index}
              style={{
                opacity: enter * (wrong ? 0.45 + 0.55 * (1 - reveal) : 1),
                transform: `translateX(${(1 - enter) * 40}px)`,
                background: correct ? "#27b26b" : "rgba(255,255,255,0.12)",
                border: correct ? "3px solid #bff5d5" : "3px solid rgba(255,255,255,0.22)",
                borderRadius: 30,
                padding: "26px 34px",
                display: "flex",
                alignItems: "center",
                gap: 26,
                fontSize: 44,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 62, height: 62, borderRadius: 31, background: correct ? "#fff" : "rgba(255,255,255,0.2)", color: correct ? "#16794a" : "#fff", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 800, flexShrink: 0 }}>{labels[index]}</span>
              <span>{answer}</span>
            </div>
          );
        })}
      </div>
      {revealed ? (
        <div style={{ marginTop: 44, fontSize: 36, lineHeight: 1.3, opacity: reveal, textShadow: "0 2px 12px rgba(0,0,0,0.5)" }}>{item.explanation}</div>
      ) : null}
    </div>
  );
}

function ListStage({ item, local, selected, accent }: { item: ListItem; local: number; selected: boolean; accent: string }) {
  const enter = fadeIn(local, 320);
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: "34%", color: "#fff", opacity: enter, transform: `translateY(${(1 - enter) * 30}px)`, outline: selected ? "6px solid rgba(30,111,255,0.6)" : undefined, outlineOffset: 16, borderRadius: 36 }}>
      <div style={{ fontSize: 210, fontWeight: 800, lineHeight: 0.9, color: accent, textShadow: "0 8px 30px rgba(0,0,0,0.35)", fontVariantNumeric: "tabular-nums" }}>#{item.rank}</div>
      <div style={{ marginTop: 26, fontSize: 88, fontWeight: 800, lineHeight: 1.06, textShadow: "0 4px 24px rgba(0,0,0,0.4)" }}>{item.title}</div>
      <div style={{ marginTop: 26, fontSize: 40, lineHeight: 1.3, opacity: fadeIn(local - 500, 400), textShadow: "0 2px 12px rgba(0,0,0,0.45)" }}>{item.body}</div>
    </div>
  );
}

function StoryStage({ item, local, ratio, selected }: { item: StoryItem; local: number; ratio: number; selected: boolean }) {
  const words = item.body.split(/\s+/).filter(Boolean);
  const visibleWords = Math.min(words.length, Math.floor(ratio * words.length * 1.05));
  const enter = fadeIn(local, 300);
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: 300,
        bottom: 380,
        borderRadius: 48,
        background: "#1a1b1f",
        color: "#f2f2f4",
        padding: "48px 52px",
        boxSizing: "border-box",
        boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 24}px)`,
        display: "flex",
        flexDirection: "column",
        fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
        outline: selected ? "8px solid rgba(30,111,255,0.6)" : undefined,
        outlineOffset: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, color: "#a8abb4" }}>
        <span style={{ width: 52, height: 52, borderRadius: 26, background: avatarColor(item.author), display: "grid", placeItems: "center", color: "#fff", fontWeight: 700, fontSize: 24 }}>{initials(item.author)}</span>
        <span>{item.author}</span>
      </div>
      <div style={{ marginTop: 28, fontSize: 58, fontWeight: 700, lineHeight: 1.12 }}>{item.title}</div>
      <div style={{ marginTop: 30, fontSize: 40, lineHeight: 1.45, color: "#e6e7eb" }}>
        {words.map((word, index) => (
          <span key={index} style={{ opacity: index < visibleWords ? 1 : 0.14 }}>
            {word}{index < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
      <div style={{ marginTop: "auto", display: "flex", gap: 30, color: "#8b8e99", fontSize: 30 }}>
        <span>▲</span>
        <span>◻ Comments</span>
      </div>
    </div>
  );
}

function TitleStage({ item, local, selected, accent }: { item: TitleItem; local: number; selected: boolean; accent: string }) {
  const enter = fadeIn(local, 360);
  return (
    <div style={{ position: "absolute", left: 80, right: 80, top: "38%", textAlign: "center", color: "#fff", opacity: enter, transform: `translateY(${(1 - enter) * 24}px)`, outline: selected ? "6px solid rgba(30,111,255,0.6)" : undefined, outlineOffset: 14, borderRadius: 30 }}>
      <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1.04, textShadow: "0 6px 30px rgba(0,0,0,0.45)" }}>{item.text}</div>
      {item.subtitle ? <div style={{ marginTop: 26, fontSize: 40, color: accent }}>{item.subtitle}</div> : null}
    </div>
  );
}

function NarrationStage({ item, ratio, selected }: { item: NarrationItem; ratio: number; selected: boolean }) {
  const words = item.text.split(/\s+/).filter(Boolean);
  const visible = Math.min(words.length, Math.ceil(ratio * words.length * 1.1));
  return (
    <div style={{ position: "absolute", left: 90, right: 90, bottom: 460, textAlign: "center", color: "#fff", fontSize: 60, fontWeight: 700, lineHeight: 1.22, textShadow: "0 4px 20px rgba(0,0,0,0.6)", outline: selected ? "6px solid rgba(30,111,255,0.6)" : undefined, outlineOffset: 12, borderRadius: 24 }}>
      {words.slice(0, visible).join(" ")}
    </div>
  );
}

/** Captions render from word timestamps only. Pages are grouped by pauses and the word limit. */
function CaptionLayer({ words, style, timeMs, design }: { words: CaptionWord[]; style: CaptionStyle; timeMs: number; design: { width: number; height: number } }) {
  const pages = captionPages(words, style.wordsPerPage);
  const page = pages.find((candidate) => timeMs >= candidate.startMs && timeMs < candidate.endMs + 260);
  if (!page) return null;
  const top = style.position === "top" ? `${style.offsetPercent}%` : style.position === "center" ? "50%" : undefined;
  const bottom = style.position === "bottom" ? `${style.offsetPercent}%` : undefined;
  const transform = style.position === "center" ? "translateY(-50%)" : undefined;
  const fontSize = (style.size / 1080) * design.width;
  const sizeScale = design.width / 1080;
  const text = (value: string) => (style.caseMode === "upper" ? value.toUpperCase() : style.caseMode === "lower" ? value.toLowerCase() : style.caseMode === "title" ? value.replace(/\b\w/g, (c) => c.toUpperCase()) : value);
  const shadow = [
    style.shadow ? `0 ${Math.round(4 * sizeScale)}px ${Math.round(14 * sizeScale)}px rgba(0,0,0,0.55)` : "",
    style.strokeWidth > 0 ? `${Math.round(style.strokeWidth * sizeScale)}px 0 0 ${style.strokeColor}, -${Math.round(style.strokeWidth * sizeScale)}px 0 0 ${style.strokeColor}, 0 ${Math.round(style.strokeWidth * sizeScale)}px 0 ${style.strokeColor}, 0 -${Math.round(style.strokeWidth * sizeScale)}px 0 ${style.strokeColor}` : "",
  ].filter(Boolean).join(", ");
  const boxStyle: CSSProperties = style.box.enabled
    ? {
        background: hexWithOpacity(style.box.color, style.box.opacity),
        borderRadius: style.box.radius * sizeScale,
        padding: `${style.box.padding * sizeScale}px ${style.box.padding * 1.4 * sizeScale}px`,
        backdropFilter: style.box.blurPx ? `blur(${style.box.blurPx}px)` : undefined,
      }
    : {};
  return (
    <div
      data-caption-layer
      style={{
        position: "absolute",
        left: `${(100 - style.maxWidthPercent) / 2}%`,
        width: `${style.maxWidthPercent}%`,
        top,
        bottom,
        transform,
        textAlign: style.align,
        fontFamily: `"${style.font}", -apple-system, system-ui, sans-serif`,
        fontWeight: style.weight,
        fontSize,
        lineHeight: style.lineHeight,
        letterSpacing: `${(style.letterSpacing / 1000) * design.width}px`,
        color: style.color,
        textShadow: shadow || undefined,
        ...boxStyle,
      }}
    >
      {page.words.map((word, index) => (
        <CaptionWordSpan
          key={`${word.startMs}-${index}`}
          word={word}
          text={text(word.text)}
          style={style}
          timeMs={timeMs}
          fontSize={fontSize}
          trailing={index < page.words.length - 1}
        />
      ))}
    </div>
  );
}

function CaptionWordSpan({ word, text, style, timeMs, fontSize, trailing }: { word: CaptionWord; text: string; style: CaptionStyle; timeMs: number; fontSize: number; trailing: boolean }) {
  const started = timeMs >= word.startMs;
  const active = timeMs >= word.startMs && timeMs < word.endMs;
  const p = clamp01((timeMs - word.startMs) / Math.max(40, style.animationMs));
  const k = style.intensity;
  const base: CSSProperties = { display: "inline-block", whiteSpace: "pre", transformOrigin: "center bottom" };
  let inner: CSSProperties = {};
  let content: ReactNode = text;
  const color = active ? style.activeColor : style.color;
  const emphasisColor = word.emphasis ? style.emphasisColor : color;
  switch (style.animation) {
    case "none":
      inner = { color: emphasisColor };
      break;
    case "fade":
      inner = { opacity: started ? p : 0, color: emphasisColor };
      break;
    case "pop":
      inner = { opacity: started ? 1 : 0, transform: `scale(${started ? 0.55 + 0.45 * easeOutBack(p, k) : 0.55})`, color: emphasisColor };
      break;
    case "scale":
      inner = { opacity: started ? 1 : 0, transform: `scale(${started ? 0.85 + 0.15 * easeOut(p) : 0.85})`, color: emphasisColor };
      break;
    case "bounce":
      inner = { opacity: started ? 1 : 0, transform: `translateY(${started ? -(1 - easeOutBounce(p)) * 46 * k : 0}px)`, color: emphasisColor };
      break;
    case "slide":
      inner = { opacity: started ? clamp01(p * 1.6) : 0, transform: `translateX(${started ? (1 - easeOut(p)) * 48 * k : 48}px)`, color: emphasisColor };
      break;
    case "highlight":
      inner = { color: active ? "#0b0c10" : emphasisColor, background: active ? style.activeColor : "transparent", borderRadius: 10 * (fontSize / 54), padding: active ? "0 0.12em" : "0 0.12em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" };
      break;
    case "karaoke": {
      const fill = clamp01((timeMs - word.startMs) / Math.max(1, word.endMs - word.startMs)) * 100;
      inner = {
        color: "transparent",
        backgroundImage: `linear-gradient(90deg, ${style.activeColor} ${fill}%, ${color} ${fill}%)`,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
      };
      break;
    }
    case "type-on": {
      const visible = started ? Math.max(1, Math.ceil(text.length * clamp01((timeMs - word.startMs) / Math.max(40, style.animationMs)))) : 0;
      content = text.slice(0, visible);
      inner = { color: emphasisColor };
      break;
    }
    case "pulse":
      inner = { color: active ? style.activeColor : emphasisColor, transform: active ? `scale(${1 + 0.08 * k * Math.sin(((timeMs - word.startMs) / 180) * Math.PI)})` : undefined };
      break;
  }
  return (
    <span style={base} data-word={word.text} data-active={active || undefined}>
      <span style={inner}>{content}</span>
      {trailing ? " " : null}
    </span>
  );
}

function SafeAreaGuide({ design }: { design: { width: number; height: number } }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: design.height * SAFE_TOP, background: "rgba(255,80,80,0.12)", borderBottom: "2px dashed rgba(255,80,80,0.5)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: design.height * SAFE_BOTTOM, background: "rgba(255,80,80,0.12)", borderTop: "2px dashed rgba(255,80,80,0.5)" }} />
    </div>
  );
}

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function easeOut(p: number) {
  return 1 - Math.pow(1 - p, 3);
}

function easeOutBack(p: number, intensity: number) {
  const c1 = 1.2 + intensity * 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

function easeOutBounce(p: number) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
}

function hexWithOpacity(hex: string, opacity: number) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${clamp01(opacity)})`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function avatarColor(name: string) {
  const palette = ["#5e6ad2", "#2f9e7a", "#d9822b", "#c0456a", "#3b7dd8", "#8a5cc2"];
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
