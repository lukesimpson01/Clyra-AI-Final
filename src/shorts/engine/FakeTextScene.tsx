// Fake Text Story's iMessage overlay. A pure function of (project, timeMs),
// mounted by ShortsCanvas exactly like every other scene so preview and
// export render identically. All bubble/typing/scroll state comes from
// resolveFakeTextFrame (lib/shorts/faketext-timeline.ts) — this component
// only draws what that function returns, it never computes timing itself.

import type { CSSProperties } from "react";
import type { FakeTextTheme, MessageItem, ShortsProject } from "../../../lib/shorts/schema";
import { geometryForFakeText, resolveFakeTextFrame } from "../../../lib/shorts/faketext-timeline";

const POSITION_PERCENT: Record<"top" | "upper-middle" | "middle", number> = { top: 6, "upper-middle": 16, middle: 30 };

type ChatColors = { panel: string; header: string; incoming: string; incomingText: string; outgoing: string; outgoingText: string; headerText: string; sub: string; divider: string };
type ChatGeometry = ReturnType<typeof geometryForFakeText>["geometry"];

export function FakeTextScene({ project, timeMs, design }: { project: ShortsProject; timeMs: number; design: { width: number; height: number } }) {
  const theme = project.fakeText.theme;
  const contact = project.fakeText.contact;
  const avatarUrl = contact.avatar ? `/api/shorts/projects/${encodeURIComponent(project.id)}/assets/${encodeURIComponent(contact.avatar.replace(/^assets\//, ""))}` : "";
  const items = project.items.filter((item): item is MessageItem => item.type === "message");
  if (!items.length) return null;

  const { geometry, viewportHeightPx, bottomPaddingPx } = geometryForFakeText(project.aspect, theme);
  const frame = resolveFakeTextFrame(items, timeMs, geometry, viewportHeightPx, bottomPaddingPx);

  const dark = theme.style === "imessage-dark";
  const colors = dark
    ? { panel: "#000000", header: "#1c1c1e", incoming: "#2c2c2e", incomingText: "#ffffff", outgoing: "#0a84ff", outgoingText: "#ffffff", headerText: "#ffffff", sub: "rgba(255,255,255,0.55)", divider: "rgba(255,255,255,0.08)" }
    : { panel: "#ffffff", header: "#f6f6f8", incoming: "#e9e9eb", incomingText: "#0b0b0d", outgoing: "#1f84ff", outgoingText: "#ffffff", headerText: "#0b0b0d", sub: "rgba(0,0,0,0.45)", divider: "rgba(0,0,0,0.08)" };

  const top = theme.chatPosition === "custom" ? theme.chatPositionCustomPercent : POSITION_PERCENT[theme.chatPosition];
  const widthPx = geometry.chatWidthPx;
  const left = (design.width - widthPx) / 2;
  const topPx = (top / 100) * design.height;
  const headerHeight = theme.headerVisible ? 118 * theme.fontScale : 0;

  return (
    <div
      style={{
        position: "absolute",
        left,
        top: topPx,
        width: widthPx,
        height: viewportHeightPx + headerHeight,
        borderRadius: theme.cornerRadius,
        background: colors.panel,
        opacity: theme.chatOpacity,
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
        backdropFilter: theme.backgroundBlur ? "blur(18px)" : undefined,
      }}
    >
      {theme.headerVisible ? (
        <Header contact={contact} avatarUrl={avatarUrl} theme={theme} colors={colors} height={headerHeight} />
      ) : null}
      <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: bottomPaddingPx,
            display: "flex",
            flexDirection: "column",
            padding: `0 18px`,
            transform: `translateY(${frame.scrollOffsetPx}px)`,
            opacity: 1 - frame.resetFadeOut,
          }}
        >
          {frame.visible.map(({ message, item, enterProgress }, index) => {
            // Real iMessage groups consecutive bubbles from the same side: tight
            // spacing between them, and only the LAST bubble in the run gets the
            // pointed tail. A lone message (sides differ on both sides) is its own
            // group of one, so it keeps the tail.
            const prev = frame.visible[index - 1];
            const next = frame.visible[index + 1];
            const firstInGroup = !prev || prev.message.side !== message.side;
            const lastInGroup = !next || next.message.side !== message.side;
            const isLastOverall = index === frame.visible.length - 1;
            return (
              <Bubble
                key={message.id}
                side={message.side}
                text={message.text}
                reaction={message.reaction}
                enterProgress={enterProgress}
                geometry={geometry}
                colors={colors}
                marginTop={firstInGroup ? geometry.gapPx : geometry.gapPx * 0.22}
                showTail={lastInGroup}
                receipt={isLastOverall && message.side === "right" ? item.receipt : undefined}
              />
            );
          })}
          {frame.typing ? <TypingBubble side={frame.typing.side} timeMs={timeMs} colors={colors} geometry={geometry} marginTop={frame.visible.length && frame.visible.at(-1)!.message.side === frame.typing.side ? geometry.gapPx * 0.22 : geometry.gapPx} /> : null}
        </div>
      </div>
    </div>
  );
}

function Header({ contact, avatarUrl, theme, colors, height }: { contact: ShortsProject["fakeText"]["contact"]; avatarUrl: string; theme: FakeTextTheme; colors: ChatColors; height: number }) {
  const showAvatar = theme.showAvatar;
  const showName = theme.showContactName;
  return (
    <div style={{ height, flexShrink: 0, background: colors.header, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: `1px solid ${colors.divider}`, position: "relative" }}>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <Chevron color={colors.outgoing} size={22 * theme.fontScale} />
        {theme.headerBadgeCount > 0 ? (
          <span style={{
            position: "absolute", top: -6, right: -8, minWidth: 15 * theme.fontScale, height: 15 * theme.fontScale, borderRadius: 999,
            background: "#ff3b30", color: "#fff", fontSize: 9.5 * theme.fontScale, fontWeight: 700, display: "grid", placeItems: "center",
            padding: "0 3px", lineHeight: 1,
          }}>
            {theme.headerBadgeCount > 99 ? "99+" : theme.headerBadgeCount}
          </span>
        ) : null}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        {showAvatar ? (
          avatarUrl ? (
            <div style={{ width: 40 * theme.fontScale, height: 40 * theme.fontScale, borderRadius: "50%", overflow: "hidden", background: "#8e8e93" }}>
              <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <div style={{ width: 40 * theme.fontScale, height: 40 * theme.fontScale, borderRadius: "50%", background: "#8e8e93", color: "#fff", display: "grid", placeItems: "center", fontSize: 16 * theme.fontScale, fontWeight: 600 }}>
              {initials(contact.name)}
            </div>
          )
        ) : null}
        {showName ? (
          <div style={{ display: "flex", alignItems: "center", gap: 3, color: colors.headerText, fontSize: 13.5 * theme.fontScale, fontWeight: 600 }}>
            {contact.name || "Unknown"}
            <Chevron color={colors.sub} size={10} rotate />
          </div>
        ) : null}
      </div>
      <FaceTimeIcon color={colors.outgoing} size={22 * theme.fontScale} />
    </div>
  );
}

function Bubble({ side, text, reaction, enterProgress, geometry, colors, marginTop, showTail, receipt }: {
  side: "left" | "right"; text: string; reaction?: string; enterProgress: number; geometry: ChatGeometry; colors: ChatColors;
  marginTop: number; showTail: boolean; receipt?: "none" | "delivered" | "read";
}) {
  const mine = side === "right";
  const bg = mine ? colors.outgoing : colors.incoming;
  const fg = mine ? colors.outgoingText : colors.incomingText;
  // Real iMessage: the last bubble in a same-sender run gets a flatter corner
  // on the side the tail points from; grouped bubbles above it stay fully round.
  const tailCorner: CSSProperties = showTail ? (mine ? { borderBottomRightRadius: 5 } : { borderBottomLeftRadius: 5 }) : {};
  // Bubbles appear instantly (hard cut), matching real text-message apps — no
  // fade/slide/scale entrance. `enterProgress` still gates visibility (a bubble
  // whose turn hasn't come yet stays fully hidden) but never partially renders.
  const shown = enterProgress > 0;
  return (
    <div
      style={{
        alignSelf: mine ? "flex-end" : "flex-start",
        maxWidth: `${geometry.maxWidthFraction * 100}%`,
        marginTop,
        opacity: shown ? 1 : 0,
        transformOrigin: mine ? "bottom right" : "bottom left",
        position: "relative",
      }}
    >
      <div
        style={{
          background: bg,
          color: fg,
          borderRadius: 18,
          ...tailCorner,
          padding: `${geometry.paddingYPx}px 16px`,
          fontSize: geometry.fontSizePx,
          lineHeight: `${geometry.lineHeightPx}px`,
          fontWeight: 400,
          wordBreak: "break-word",
          position: "relative",
        }}
      >
        {text}
        {showTail ? <Tail mine={mine} color={bg} /> : null}
      </div>
      {reaction ? (
        <div style={{ position: "absolute", top: -16, [mine ? "left" : "right"]: -10, background: colors.incoming, borderRadius: 999, padding: "2px 7px", fontSize: geometry.fontSizePx * 0.62, boxShadow: "0 4px 10px rgba(0,0,0,0.2)" }}>{reaction}</div>
      ) : null}
      {receipt && receipt !== "none" ? (
        <div style={{ textAlign: "right", color: colors.sub, fontSize: geometry.fontSizePx * 0.42, marginTop: 4, paddingRight: 4 }}>
          {receipt === "read" ? "Read" : "Delivered"}
        </div>
      ) : null}
    </div>
  );
}

function Tail({ mine, color }: { mine: boolean; color: string }) {
  return (
    <svg
      width="9"
      height="11"
      viewBox="0 0 9 11"
      style={{ position: "absolute", bottom: 0, [mine ? "right" : "left"]: -6, transform: mine ? undefined : "scaleX(-1)" }}
    >
      <path d="M0 0 C 2 6 5 10 9 11 C 5 11 0 9 0 4 Z" fill={color} />
    </svg>
  );
}

function TypingBubble({ side, timeMs, colors, geometry, marginTop }: { side: "left" | "right"; timeMs: number; colors: ChatColors; geometry: ChatGeometry; marginTop: number }) {
  const mine = side === "right";
  return (
    <div style={{ alignSelf: mine ? "flex-end" : "flex-start", marginTop, background: mine ? colors.outgoing : colors.incoming, borderRadius: 18, padding: `${geometry.paddingYPx}px 16px`, display: "flex", gap: 5, position: "relative" }}>
      <Tail mine={mine} color={mine ? colors.outgoing : colors.incoming} />
      {[0, 1, 2].map((dot) => {
        const phase = (timeMs / 260 + dot * 0.9) % (Math.PI * 2);
        const level = 0.35 + 0.65 * Math.max(0, Math.sin(phase));
        return <span key={dot} style={{ width: geometry.fontSizePx * 0.22, height: geometry.fontSizePx * 0.22, borderRadius: 99, background: mine ? colors.outgoingText : colors.sub, opacity: level, alignSelf: "center" }} />;
      })}
    </div>
  );
}

function Chevron({ color, size, rotate }: { color: string; size: number; rotate?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, transform: rotate ? "rotate(-90deg)" : undefined }}>
      <path d="M15 5L8 12L15 19" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FaceTimeIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M15 8.5H4a1.5 1.5 0 0 0-1.5 1.5v4a1.5 1.5 0 0 0 1.5 1.5h11a1 1 0 0 0 1-1V9.5a1 1 0 0 0-1-1Z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M16.5 11.2l4.3-2.6a.6.6 0 0 1 .9.5v6a.6.6 0 0 1-.9.5l-4.3-2.6" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}
