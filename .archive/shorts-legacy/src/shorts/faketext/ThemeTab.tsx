import type { FakeTextChatPosition, FakeTextTheme, ShortsProject } from "../../../lib/shorts/schema";

type Props = { project: ShortsProject; onUpdate: (updater: (prev: ShortsProject) => ShortsProject, rebuild?: boolean) => void };

const PRESETS: Record<"compact" | "standard" | "large", Partial<FakeTextTheme>> = {
  compact: { fontScale: 0.82, bubbleScale: 0.85, chatWidthPercent: 88, chatHeightPercent: 38 },
  standard: { fontScale: 1, bubbleScale: 1, chatWidthPercent: 94, chatHeightPercent: 46 },
  large: { fontScale: 1.2, bubbleScale: 1.15, chatWidthPercent: 96, chatHeightPercent: 54 },
};

// Fields the server's scroll/segment math actually reads (lib/shorts/faketext-timeline.ts's geometryForFakeText).
// Everything else is pure styling the live preview already reflects from `project` alone, so it only needs saving.
const GEOMETRY_FIELDS = new Set<keyof FakeTextTheme>(["chatWidthPercent", "chatHeightPercent", "fontScale", "bubbleScale"]);

export function ThemeTab({ project, onUpdate }: Props) {
  const theme = project.fakeText.theme;
  const patch = (next: Partial<FakeTextTheme>) => {
    const rebuild = Object.keys(next).some((key) => GEOMETRY_FIELDS.has(key as keyof FakeTextTheme));
    onUpdate((prev) => ({ ...prev, fakeText: { ...prev.fakeText, theme: { ...prev.fakeText.theme, ...next } } }), rebuild);
  };

  return (
    <>
      <div className="ft-panel-header"><span className="ft-panel-title">Choose Theme</span></div>
      <div className="ft-panel-body">
        <div className="ft-section">
          <div className="ft-field-label">Style</div>
          <div className="ft-theme-grid">
            <ThemeCard label="iMessage Dark" active={theme.style === "imessage-dark"} onClick={() => patch({ style: "imessage-dark" })} dark />
            <ThemeCard label="iMessage Light" active={theme.style === "imessage-light"} onClick={() => patch({ style: "imessage-light" })} dark={false} />
          </div>
        </div>

        <div className="ft-section">
          <div className="ft-field-label">Presets</div>
          <div className="ft-pill-group">
            {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => (
              <button key={key} type="button" className="ft-pill" onClick={() => patch(PRESETS[key])}>{key[0].toUpperCase() + key.slice(1)}</button>
            ))}
          </div>
        </div>

        <div className="ft-divider" />

        <div className="ft-section">
          <div className="ft-field-label">Chat vertical position</div>
          <div className="ft-pill-group">
            {(["top", "upper-middle", "middle", "custom"] as FakeTextChatPosition[]).map((value) => (
              <button key={value} type="button" className={`ft-pill${theme.chatPosition === value ? " active" : ""}`} onClick={() => patch({ chatPosition: value })}>
                {value === "top" ? "Top" : value === "upper-middle" ? "Upper middle" : value === "middle" ? "Middle" : "Custom"}
              </button>
            ))}
          </div>
          {theme.chatPosition === "custom" ? (
            <div style={{ marginTop: 10 }}>
              <SliderField label="Position from top" value={theme.chatPositionCustomPercent} min={0} max={70} unit="%" onChange={(value) => patch({ chatPositionCustomPercent: value })} />
            </div>
          ) : null}
        </div>

        <div className="ft-control-grid ft-section">
          <SliderField label="Chat width" value={theme.chatWidthPercent} min={70} max={100} unit="%" onChange={(value) => patch({ chatWidthPercent: value })} />
          <SliderField label="Chat height" value={theme.chatHeightPercent} min={20} max={80} unit="%" onChange={(value) => patch({ chatHeightPercent: value })} />
          <SliderField label="Corner radius" value={theme.cornerRadius} min={0} max={48} unit="px" onChange={(value) => patch({ cornerRadius: value })} />
          <SliderField label="Bubble scale" value={Math.round(theme.bubbleScale * 100)} min={70} max={140} unit="%" onChange={(value) => patch({ bubbleScale: value / 100 })} />
          <SliderField label="Message font scale" value={Math.round(theme.fontScale * 100)} min={70} max={140} unit="%" onChange={(value) => patch({ fontScale: value / 100 })} />
          <SliderField label="Chat opacity" value={Math.round(theme.chatOpacity * 100)} min={40} max={100} unit="%" onChange={(value) => patch({ chatOpacity: value / 100 })} />
        </div>

        <div className="ft-divider" />

        <ToggleRow label="Header visible" checked={theme.headerVisible} onChange={(value) => patch({ headerVisible: value })} />
        <ToggleRow label="Contact avatar" checked={theme.showAvatar} onChange={(value) => patch({ showAvatar: value })} />
        <ToggleRow label="Contact name" checked={theme.showContactName} onChange={(value) => patch({ showContactName: value })} />
        <ToggleRow label="Background blur behind chat" checked={theme.backgroundBlur} onChange={(value) => patch({ backgroundBlur: value })} />

        <div className="ft-divider" />

        <div className="ft-section">
          <div className="ft-field-label">Unread badge on back button</div>
          <div className="ft-slider-row">
            <input type="range" min={0} max={99} value={theme.headerBadgeCount} onChange={(event) => patch({ headerBadgeCount: Number(event.target.value) })} />
            <span className="ft-slider-value">{theme.headerBadgeCount === 0 ? "Off" : theme.headerBadgeCount}</span>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--ft-ink-3)", marginTop: 4 }}>A small realism touch, like a phone showing unread count from other chats. Off by default.</p>
        </div>
      </div>
    </>
  );
}

function ThemeCard({ label, active, onClick, dark }: { label: string; active: boolean; onClick: () => void; dark: boolean }) {
  const panel = dark ? "#000" : "#fff";
  const header = dark ? "#1c1c1e" : "#f6f6f8";
  const incoming = dark ? "#2c2c2e" : "#e9e9eb";
  const incomingText = dark ? "#fff" : "#0b0b0d";
  return (
    <button type="button" className={`ft-theme-card${active ? " active" : ""}`} onClick={onClick}>
      <div className="ft-theme-card-preview" style={{ background: panel }}>
        <div style={{ height: 22, background: header, borderBottom: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}` }} />
        <div style={{ padding: "8px 8px 0" }}>
          <div style={{ background: incoming, color: incomingText, fontSize: 9, borderRadius: 8, padding: "4px 7px", width: "60%" }}>Hey, got a sec?</div>
          <div style={{ background: "#0a84ff", color: "#fff", fontSize: 9, borderRadius: 8, padding: "4px 7px", width: "55%", marginLeft: "auto", marginTop: 5 }}>Yeah what's up</div>
        </div>
      </div>
      <span className="ft-theme-card-label">{label}</span>
    </button>
  );
}

function SliderField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="ft-field-label">{label}</div>
      <div className="ft-slider-row">
        <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="ft-slider-value">{value}{unit}</span>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="ft-switch-row">
      <span style={{ fontSize: 13.5 }}>{label}</span>
      <button type="button" className={`ft-switch${checked ? " on" : ""}`} onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label}>
        <span className="ft-switch-knob" />
      </button>
    </div>
  );
}
