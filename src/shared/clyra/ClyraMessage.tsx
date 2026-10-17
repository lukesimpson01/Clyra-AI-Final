import type { ReactNode } from "react";
import { assistantBubbleInnerStyle, chatBubbleStyle, userBubbleInnerStyle } from "../../components/chat/ClyraComposerShell";

export function ClyraMessage({ role, children, agentName, grouped = false, reducedMotion = false }: { role: "user" | "assistant" | "agent" | "system"; children: ReactNode; agentName?: string | null; grouped?: boolean; reducedMotion?: boolean }) {
  if (role === "system") return <article className="cowork-message cowork-message--system"><p className="cowork-system-message">{children}</p></article>;
  const isUser = role === "user";
  const row = chatBubbleStyle(isUser ? "user" : "assistant");
  const rowStyle = reducedMotion && isUser ? { ...row, animation: "none" } : row;
  const replyStyle = reducedMotion ? assistantBubbleInnerStyle : { ...assistantBubbleInnerStyle, animation: "clyraReplyIn 1.15s cubic-bezier(.32,.72,0,1) both" };
  return <article className={`cowork-message cowork-message--${isUser ? "user" : "bot"}`} style={rowStyle}>{!isUser && agentName && !grouped ? <p className="cowork-message__identity">{agentName}</p> : null}<div style={isUser ? userBubbleInnerStyle : replyStyle}>{children}</div></article>;
}
