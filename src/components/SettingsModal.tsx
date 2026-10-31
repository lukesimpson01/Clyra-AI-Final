import { useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  AudioLines,
  BrainCircuit,
  ChartNoAxesCombined,
  Check,
  Code2,
  Cpu,
  Download,
  Grid3X3,
  Headphones,
  MessageCircle,
  Palette,
  PanelLeft,
  PanelLeftClose,
  Play,
  RotateCcw,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { OrbColorTheme } from "./AiOrb";
import { MemorySettingsPanel } from "./memory/MemorySettingsPanel";
import { WorkspaceDockCustomizer } from "./WorkspaceDockCustomizer";

type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  theme: string;
  setTheme: (value: string) => void;
  sendOnEnter: boolean;
  setSendOnEnter: (value: boolean) => void;
  fontSize: string;
  setFontSize: (value: string) => void;
  clearChats: () => void;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
  animationSpeed?: number;
  setAnimationSpeed?: (value: number) => void;
  codeHighlighting: boolean;
  setCodeHighlighting: (value: boolean) => void;
  markdownSupport: boolean;
  setMarkdownSupport: (value: boolean) => void;
  systemPrompt: string;
  setSystemPrompt: (value: string) => void;
  temperature: number;
  setTemperature: (value: number) => void;
  userBubbleColor: string;
  setUserBubbleColor: (value: string) => void;
  orbColorTheme: OrbColorTheme;
  setOrbColorTheme: (value: OrbColorTheme) => void;
  accentColor: string;
  setAccentColor: (value: string) => void;
  voiceRate: number;
  setVoiceRate: (value: number) => void;
  voicePitch: number;
  setVoicePitch: (value: number) => void;
  voiceVolume: number;
  setVoiceVolume: (value: number) => void;
  voiceTestMode: boolean;
  setVoiceTestMode: (value: boolean) => void;
  chats: unknown[];
  /** The workspace dock's live app order (incl. the pinned "chat" at index 0). */
  workspaceRailTabs: string[];
  setWorkspaceRailTabs: (value: string[]) => void;
  /** Fires a real quick action from the dock customiser (new chat / search / voice). */
  onWorkspaceQuickAction: (id: string) => void;
  /** Section to show when the sheet opens (e.g. "account" from the profile button). */
  initialSection?: string;
  profileName?: string;
  setProfileName?: (value: string) => void;
  accountEmail?: string | null;
  /** Erases every local chat, setting and preference, then restarts the app fresh. */
  deleteAccount?: () => void;
};

const EASE_OUT = [0.16, 1, 0.3, 1] as [number, number, number, number];

export type SettingsSheetProps = Omit<SettingsModalProps, "isOpen"> & {
  onClose: () => void;
  embedded?: boolean;
};

const sections = [
  { id: "account", label: "Account", detail: "Your profile, your data, and everything tied to this device.", icon: UserRound, category: "Account" },
  { id: "workspace", label: "Workspace", detail: "Make the controls around Chat feel like your own.", icon: Grid3X3, category: "Account" },
  { id: "look", label: "Appearance", detail: "Adjust how Clyra looks and feels.", icon: Palette, category: "Preferences" },
  { id: "chat", label: "Conversation", detail: "Keep Clyra’s replies and composer behaviour in sync with you.", icon: MessageCircle, category: "Preferences" },
  { id: "memory", label: "Memory", detail: "Clyra’s identity, what it knows about you, what it has learned, and its skills.", icon: BrainCircuit, category: "Preferences" },
  { id: "voice", label: "Voice", detail: "Tune the sound and pace of spoken conversations.", icon: AudioLines, category: "Preferences" },
  { id: "advanced", label: "Model", detail: "Set the response character for your everyday chat.", icon: Cpu, category: "Preferences" },
  { id: "usage", label: "Usage", detail: "See the current status of your connected Clyra services.", icon: ChartNoAxesCombined, category: "Data & Privacy" },
  { id: "data", label: "Privacy", detail: "Control the information Clyra keeps on this device.", icon: Shield, category: "Data & Privacy" },
] as const;

type Section = (typeof sections)[number];

const navCategories = ["Account", "Preferences", "Data & Privacy"] as const;

const bubbleColors = [
  { label: "Mist", value: "#F4F4F4" },
  { label: "Sky", value: "#DBEAFE" },
  { label: "Mint", value: "#DCFCE7" },
  { label: "Lilac", value: "#F3E8FF" },
  { label: "Rose", value: "#FFE4E6" },
];

const accentColors = [
  { label: "Blue", value: "#2563eb" },
  { label: "Ocean", value: "#0284c7" },
  { label: "Violet", value: "#7c3aed" },
  { label: "Sunset", value: "#ea580c" },
  { label: "Forest", value: "#16a34a" },
  { label: "Dream pink", value: "#ec4899" },
  { label: "Graphite", value: "#475569" },
];

const voicePresets = [
  { id: "calm", label: "Calm", detail: "Warm and measured", rate: 0.88, pitch: 0.98, volume: 0.9 },
  { id: "natural", label: "Natural", detail: "Balanced conversation", rate: 0.94, pitch: 1.03, volume: 0.96 },
  { id: "bright", label: "Bright", detail: "Clear with energy", rate: 1.02, pitch: 1.1, volume: 0.92 },
] as const;

const modelPresets = [
  { label: "Precise", detail: "Shorter, direct answers", temperature: 0.1 },
  { label: "Balanced", detail: "Useful default", temperature: 0.7 },
  { label: "Creative", detail: "More exploration", temperature: 1 },
] as const;

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-label={label}
      aria-pressed={checked}
      role="switch"
      aria-checked={checked}
      data-on={checked}
      className="clys-toggle"
    >
      <span className="clys-toggle__knob" aria-hidden />
    </button>
  );
}

function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="clys-row">
      <div className="min-w-0">
        <p className="clys-row__label">{title}</p>
        {detail ? <p className="clys-row__detail">{detail}</p> : null}
      </div>
      <div className="clys-row__control">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="clys-segmented" role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onChange(option.value)}
            className="clys-segmented__option"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
  valueLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  valueLabel: string;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="clys-range-row">
      <div className="clys-range-row__top">
        <p className="clys-row__label">{label}</p>
        <p className="clys-range-row__value">{valueLabel}</p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
        className="clys-range"
        style={{ background: `linear-gradient(90deg, #0066FF ${percent}%, #E2E5EA ${percent}%)` }}
      />
    </div>
  );
}

/** Circular swatches with the precise double-ring selection treatment. */
function SwatchRow({
  colors,
  value,
  onChange,
  customLabel,
  showHex = false,
}: {
  colors: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
  customLabel: string;
  showHex?: boolean;
}) {
  const isCustom = !colors.some((c) => c.value.toLowerCase() === value.toLowerCase());
  return (
    <div className="clys-swatches">
      {colors.map((color) => {
        const selected = value.toLowerCase() === color.value.toLowerCase();
        return (
          <button
            key={color.value}
            type="button"
            onClick={() => onChange(color.value)}
            title={color.label}
            aria-label={`${color.label}${selected ? ", selected" : ""}`}
            aria-pressed={selected}
            data-selected={selected}
            className="clys-swatch"
            style={{ backgroundColor: color.value }}
          />
        );
      })}
      <label
        title={customLabel}
        aria-label={`${customLabel}${isCustom ? ", selected" : ""}`}
        data-selected={isCustom}
        className="clys-swatch clys-swatch--custom"
      >
        <span className="clys-swatch__rainbow" />
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="clys-swatch__input"
        />
      </label>
      {showHex ? <span className="clys-hex">{value.toUpperCase()}</span> : null}
    </div>
  );
}

/** A group of settings rendered inside a white card with hairline row dividers. */
function SettingsCard({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("clys-settings-card", className)}>
      {title || description ? (
        <div className="clys-settings-card__head">
          {title ? <h2 className="clys-subtitle">{title}</h2> : null}
          {description ? <p className="clys-subdetail">{description}</p> : null}
        </div>
      ) : null}
      <div className="clys-card clys-settings-card__body">{children}</div>
    </section>
  );
}

/** Theme / mode selector as visual preview cards with an accent selection ring. */
function ThemeCards({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const themes = [
    { label: "Light", value: "Light" },
    { label: "Dark", value: "Dark" },
  ] as const;
  return (
    <div className="clys-theme-cards" role="radiogroup" aria-label="Theme">
      {themes.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-active={active}
            onClick={() => onChange(option.value)}
            className="clys-theme-card"
          >
            <span className={cn("clys-theme-thumb", option.value === "Dark" && "clys-theme-thumb--dark")} aria-hidden>
              <span className="clys-theme-thumb__bar clys-theme-thumb__bar--wide" />
              <span className="clys-theme-thumb__bar" />
              <span className="clys-theme-thumb__bar clys-theme-thumb__bar--short" />
            </span>
            <span className="clys-theme-card__label">{option.label}</span>
            {active ? <Check className="clys-theme-card__check" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Sidebar navigation item: monoline icon, label, quiet hover, pill active state. */
function NavItem({
  section,
  active,
  onSelect,
}: {
  section: Section;
  active: boolean;
  onSelect: (id: Section["id"]) => void;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(section.id)}
      data-active={active}
      aria-current={active ? "page" : undefined}
      className="clys-nav-item"
      title={section.label}
    >
      <Icon aria-hidden />
      <span>{section.label}</span>
    </button>
  );
}

export function SettingsSheet({
  onClose,
  embedded = false,
  theme,
  setTheme,
  sendOnEnter,
  setSendOnEnter,
  fontSize,
  setFontSize,
  clearChats,
  autoScroll,
  setAutoScroll,
  codeHighlighting,
  setCodeHighlighting,
  markdownSupport,
  setMarkdownSupport,
  systemPrompt,
  setSystemPrompt,
  temperature,
  setTemperature,
  userBubbleColor,
  setUserBubbleColor,
  orbColorTheme,
  setOrbColorTheme,
  accentColor,
  setAccentColor,
  voiceRate,
  setVoiceRate,
  voicePitch,
  setVoicePitch,
  voiceVolume,
  setVoiceVolume,
  voiceTestMode,
  setVoiceTestMode,
  chats,
  workspaceRailTabs,
  setWorkspaceRailTabs,
  onWorkspaceQuickAction,
  initialSection,
  profileName = "Luke",
  setProfileName,
  accountEmail,
  deleteAccount,
}: SettingsSheetProps) {
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>("look");
  const [navQuery, setNavQuery] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [nameDraft, setNameDraft] = useState(profileName);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  useEffect(() => {
    const match = sections.find((section) => section.id === initialSection);
    setActiveSection(match ? match.id : "look");
    setNameDraft(profileName);
    setConfirmingDelete(false);
    setDeleteText("");
    // Runs once on mount — the sheet is unmounted when closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [voicePreviewState, setVoicePreviewState] = useState<"idle" | "loading" | "error">("idle");
  const [whisperProfile, setWhisperProfile] = useState<"auto" | "tiny" | "base" | "small">(() => {
    try { const value = localStorage.getItem("clyra-whisper-profile"); return value === "tiny" || value === "base" || value === "small" ? value : "auto"; } catch { return "auto"; }
  });
  const [usage, setUsage] = useState<any>(null);
  const [usageState, setUsageState] = useState<"idle" | "loading" | "error">("idle");
  const voicePreviewRef = useRef<{ audio: HTMLAudioElement; url: string } | null>(null);
  const chatCount = chats.length;
  void orbColorTheme;
  void setOrbColorTheme;
  const activeMeta = useMemo(
    () => sections.find((section) => section.id === activeSection) ?? sections[0],
    [activeSection],
  );

  const query = navQuery.trim().toLowerCase();
  const filteredSections = useMemo(
    () => (query ? sections.filter((section) => section.label.toLowerCase().includes(query)) : sections),
    [query],
  );
  const navGroups = useMemo(() => {
    const groups: Array<{ label: string; items: Section[] }> = [];
    for (const category of navCategories) {
      const items = filteredSections.filter((section) => section.category === category);
      if (items.length) groups.push({ label: category, items });
    }
    return groups;
  }, [filteredSections]);

  const closeSettings = (event?: MouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    onClose();
  };

  const applyVoicePreset = (preset: (typeof voicePresets)[number]) => {
    setVoiceRate(preset.rate);
    setVoicePitch(preset.pitch);
    setVoiceVolume(preset.volume);
  };

  const refreshUsage = async () => {
    setUsageState("loading");
    try {
      const response = await fetch("/api/usage", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error("Usage unavailable");
      setUsage(payload);
      setUsageState("idle");
    } catch {
      setUsageState("error");
    }
  };

  useEffect(() => {
    if (activeSection !== "usage") return;
    void refreshUsage();
    const interval = window.setInterval(() => void refreshUsage(), 5_000);
    return () => window.clearInterval(interval);
  }, [activeSection]);

  useEffect(() => () => {
    voicePreviewRef.current?.audio.pause();
    if (voicePreviewRef.current?.url) URL.revokeObjectURL(voicePreviewRef.current.url);
  }, []);

  const previewVoicePreset = async (preset: (typeof voicePresets)[number]) => {
    applyVoicePreset(preset);
    voicePreviewRef.current?.audio.pause();
    if (voicePreviewRef.current?.url) URL.revokeObjectURL(voicePreviewRef.current.url);
    voicePreviewRef.current = null;
    setVoicePreviewState("loading");
    try {
      const response = await fetch("/api/creator/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Hi, I'm Max. This is how I'll sound in a natural Clyra conversation.`,
          voice: "Max",
        }),
      });
      if (!response.ok) throw new Error("Async Voice preview is unavailable");
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      audio.playbackRate = preset.rate;
      audio.volume = preset.volume;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (voicePreviewRef.current?.url === url) voicePreviewRef.current = null;
      };
      voicePreviewRef.current = { audio, url };
      await audio.play();
      setVoicePreviewState("idle");
    } catch {
      setVoicePreviewState("error");
    }
  };

  const exportChats = () => {
    const blob = new Blob([JSON.stringify(chats, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "clyra-chat-export.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      role="dialog"
      aria-modal={embedded ? undefined : "true"}
      aria-label="Settings"
      className={cn(
        "clys-window",
        embedded && "clys-sheet--embedded",
        navCollapsed && "clys-window--collapsed",
      )}
    >
            <aside className="clys-sidebar" data-collapsed={navCollapsed || undefined}>
              <div className="clys-sidebar__top">
                <div className="clys-sidebar__brand">
                  <span className="clys-brand__mark">Clyra</span>
                  <button
                    type="button"
                    onClick={() => setNavCollapsed((value) => !value)}
                    className="clys-icon-btn clys-sidebar__collapse"
                    aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                  >
                    {navCollapsed ? <PanelLeft aria-hidden /> : <PanelLeftClose aria-hidden />}
                  </button>
                </div>
                <button type="button" onClick={closeSettings} className="clys-back">
                  <ArrowLeft aria-hidden />
                  <span>Back to application</span>
                </button>
                <label className="clys-search">
                  <Search className="clys-search__icon" aria-hidden />
                  <input
                    type="search"
                    value={navQuery}
                    onChange={(event) => setNavQuery(event.target.value)}
                    placeholder="Search settings"
                    aria-label="Search settings"
                  />
                </label>
              </div>
              <nav className="clys-nav" aria-label="Settings sections">
                {navGroups.map((group) => (
                  <div key={group.label} className="clys-nav-group">
                    <p className="clys-nav-group__label">{group.label}</p>
                    {group.items.map((section) => (
                      <NavItem
                        key={section.id}
                        section={section}
                        active={section.id === activeSection}
                        onSelect={setActiveSection}
                      />
                    ))}
                  </div>
                ))}
                {navGroups.length === 0 ? (
                  <p className="clys-nav-empty">No results for “{navQuery.trim()}”.</p>
                ) : null}
              </nav>
            </aside>

            <div className="clys-main">
              <header className="clys-header">
                <h2 className="clys-header__title">Settings</h2>
                <button
                  type="button"
                  onClick={closeSettings}
                  className="clys-header__close"
                  aria-label="Close settings"
                >
                  <X className="h-[17px] w-[17px]" strokeWidth={1.9} />
                </button>
              </header>

              <div className="clys-content">
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn("clys-content__inner", activeSection === "memory" && "max-w-[760px]")}
                >
                  <h1 className="clys-section-title">{activeMeta.label}</h1>
                  <p className="clys-section-detail">{activeMeta.detail}</p>
                  <div className="clys-lead-gap" aria-hidden />

                  {activeSection === "account" ? (
                    <>
                      <SettingsCard>
                        <div className="clys-profile">
                          <span
                            className="clys-profile__avatar"
                            style={{ background: `linear-gradient(145deg, ${accentColor}, #15171C)` }}
                            aria-hidden
                          >
                            {(profileName.trim().charAt(0) || "C").toUpperCase()}
                          </span>
                          <div className="clys-profile__meta">
                            <p className="clys-profile__name">{profileName}</p>
                            <p className="clys-profile__email">{accountEmail ?? "Stored privately on this device"}</p>
                            <p className="clys-profile__count">{chatCount} saved {chatCount === 1 ? "chat" : "chats"}</p>
                          </div>
                        </div>
                      </SettingsCard>
                      <SettingsCard title="Profile" description="How you appear across Clyra.">
                        <SettingRow title="Display name" detail="Shown in your greeting and profile.">
                          <form
                            className="flex items-center gap-2"
                            onSubmit={(event) => { event.preventDefault(); setProfileName?.(nameDraft); }}
                          >
                            <input
                              value={nameDraft}
                              onChange={(event) => setNameDraft(event.target.value)}
                              maxLength={32}
                              aria-label="Display name"
                              className="clys-input w-40"
                            />
                            <button
                              type="submit"
                              disabled={!nameDraft.trim() || nameDraft.trim() === profileName}
                              className="clys-btn clys-btn--primary disabled:cursor-default disabled:opacity-35"
                            >
                              Save
                            </button>
                          </form>
                        </SettingRow>
                        <SettingRow title="Export my data" detail="Download every saved chat as JSON.">
                          <button type="button" onClick={exportChats} className="clys-btn">
                            <Download aria-hidden />
                            Export
                          </button>
                        </SettingRow>
                      </SettingsCard>
                      <div className="clys-danger-zone">
                        <div>
                          <p className="clys-danger-zone__title">Delete account</p>
                          <p className="clys-danger-zone__detail">
                            Permanently erases your chats, preferences and profile from this device. This can’t be undone.
                          </p>
                        </div>
                        <AnimatePresence initial={false} mode="wait">
                          {confirmingDelete ? (
                            <motion.div
                              key="confirm"
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.22, ease: EASE_OUT }}
                              className="mt-4 flex flex-wrap items-center gap-2"
                            >
                              <input
                                autoFocus
                                value={deleteText}
                                onChange={(event) => setDeleteText(event.target.value)}
                                placeholder="Type DELETE to confirm"
                                aria-label="Type DELETE to confirm"
                                className="clys-input w-52"
                              />
                              <button
                                type="button"
                                disabled={deleteText.trim() !== "DELETE"}
                                onClick={() => deleteAccount?.()}
                                className="clys-btn clys-btn--solid-danger disabled:cursor-default disabled:opacity-35"
                              >
                                <Trash2 aria-hidden />
                                Delete everything
                              </button>
                              <button
                                type="button"
                                onClick={() => { setConfirmingDelete(false); setDeleteText(""); }}
                                className="clys-btn"
                              >
                                Cancel
                              </button>
                            </motion.div>
                          ) : (
                            <motion.button
                              key="start"
                              type="button"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              onClick={() => setConfirmingDelete(true)}
                              className="clys-btn clys-btn--danger mt-4"
                            >
                              <Trash2 aria-hidden />
                              Delete account…
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </div>
                    </>
                  ) : null}

                  {activeSection === "look" ? (
                    <>
                      <SettingsCard title="Appearance" description="Choose how Clyra looks on this device.">
                        <div className="clys-block">
                          <p className="clys-row__label">Theme</p>
                          <p className="clys-row__detail">Choose the look that's comfortable for you.</p>
                          <div className="clys-theme-cards-wrap">
                            <ThemeCards value={theme} onChange={setTheme} />
                          </div>
                        </div>
                        <SettingRow title="Accent color" detail="Used for highlights and interactive elements.">
                          <SwatchRow
                            colors={accentColors}
                            value={accentColor}
                            onChange={setAccentColor}
                            customLabel="Custom color"
                            showHex
                          />
                        </SettingRow>
                        <SettingRow title="Text size" detail="Adjust the reading size across your conversations.">
                          <Segmented
                            value={fontSize}
                            onChange={setFontSize}
                            options={[
                              { label: "Small", value: "Small" },
                              { label: "Medium", value: "Medium" },
                              { label: "Large", value: "Large" },
                            ]}
                          />
                        </SettingRow>
                        <SettingRow title="Message color" detail="Choose a color for your chat messages.">
                        <SwatchRow
                          colors={bubbleColors}
                          value={userBubbleColor}
                          onChange={setUserBubbleColor}
                          customLabel="Custom color"
                          showHex
                        />
                      </SettingRow>
                      </SettingsCard>
                    </>
                  ) : null}

                  {activeSection === "workspace" ? (
                    <>
                      <div className="clys-lead-gap" aria-hidden />
                      <WorkspaceDockCustomizer
                        railTabs={workspaceRailTabs}
                        onChange={setWorkspaceRailTabs}
                        onQuickAction={onWorkspaceQuickAction}
                        onDone={closeSettings}
                      />
                    </>
                  ) : null}

                  {activeSection === "chat" ? (
                    <>
                      <SettingsCard title="Composer" description="Control how messages are sent and rendered.">
                        <SettingRow title="Send on Enter" detail="Shift + Enter for a new line.">
                          <Toggle checked={sendOnEnter} onChange={setSendOnEnter} label="Toggle send on Enter" />
                        </SettingRow>
                        <SettingRow title="Auto-scroll" detail="Keep the latest response in view.">
                          <Toggle checked={autoScroll} onChange={setAutoScroll} label="Toggle auto-scroll" />
                        </SettingRow>
                        <SettingRow title="Markdown" detail="Render headings, lists, and links.">
                          <Toggle checked={markdownSupport} onChange={setMarkdownSupport} label="Toggle markdown" />
                        </SettingRow>
                        <SettingRow title="Code highlighting" detail="Colorize code blocks.">
                          <Toggle checked={codeHighlighting} onChange={setCodeHighlighting} label="Toggle highlighting" />
                        </SettingRow>
                      </SettingsCard>
                    </>
                  ) : null}

                  {activeSection === "memory" ? (
                    <MemorySettingsPanel
                      profileName={profileName ?? "Luke"}
                      setProfileName={setProfileName}
                      accentColor={accentColor}
                      setAccentColor={setAccentColor}
                      theme={theme}
                      setTheme={setTheme}
                    />
                  ) : null}

                  {activeSection === "voice" ? (
                    <>
                      <SettingsCard title="Voice presets" description="Pick a starting point, then fine-tune the result below.">
                        <div className="clys-block">
                          <div className="clys-option-grid">
                            {voicePresets.map((preset) => {
                              const active =
                                Math.abs(voiceRate - preset.rate) < 0.01 &&
                                Math.abs(voicePitch - preset.pitch) < 0.01 &&
                                Math.abs(voiceVolume - preset.volume) < 0.02;
                              return (
                                <button
                                  key={preset.id}
                                  type="button"
                                  onClick={() => applyVoicePreset(preset)}
                                  data-active={active}
                                  className="clys-option-card"
                                >
                                  <div className="clys-option-card__top">
                                    <Headphones className="clys-option-card__icon" aria-hidden />
                                    <span
                                      role="button"
                                      tabIndex={0}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void previewVoicePreset(preset);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          void previewVoicePreset(preset);
                                        }
                                      }}
                                      className="clys-option-card__preview"
                                      aria-label={`Preview ${preset.label} voice`}
                                    >
                                      <Play className="h-3.5 w-3.5" />
                                    </span>
                                  </div>
                                  <p className="clys-option-card__label">{preset.label}</p>
                                  <p className="clys-option-card__detail">{preset.detail}</p>
                                </button>
                              );
                            })}
                          </div>
                          {voicePreviewState !== "idle" ? (
                            <p className={cn("clys-option-status", voicePreviewState === "error" && "clys-option-status--error")}>
                              {voicePreviewState === "loading" ? "Preparing voice preview…" : "Async Voice preview is unavailable."}
                            </p>
                          ) : null}
                        </div>
                      </SettingsCard>
                      <SettingsCard title="Adjust" description="Fine-tune the voice you heard.">
                        <RangeControl label="Pace" value={voiceRate} min={0.82} max={1.08} step={0.01} onChange={setVoiceRate} valueLabel={voiceRate < 0.91 ? "Calmer" : voiceRate > 1 ? "Quicker" : "Balanced"} />
                        <RangeControl label="Warmth" value={voicePitch} min={0.9} max={1.16} step={0.01} onChange={setVoicePitch} valueLabel={voicePitch < 0.99 ? "Lower" : voicePitch > 1.08 ? "Brighter" : "Natural"} />
                        <RangeControl label="Volume" value={voiceVolume} min={0.5} max={1} step={0.01} onChange={setVoiceVolume} valueLabel={`${Math.round(voiceVolume * 100)}%`} />
                        <SettingRow title="Test Mode" detail="Voice call repeats back what you say instead of using DeepSeek. Use this to check the mic, connection, and Fish Audio voice without spending chat credits.">
                          <Toggle checked={voiceTestMode} onChange={setVoiceTestMode} label="Toggle voice call test mode" />
                        </SettingRow>
                      </SettingsCard>
                    </>
                  ) : null}

                  {activeSection === "advanced" ? (
                    <>
                      <SettingsCard title="Transcription" description="Choose a local model only when you need a fixed performance/accuracy trade-off.">
                        <SettingRow title="Local model" detail="Auto keeps Clyra light.">
                          <div className="clys-control-group">
                            <select aria-label="Local transcription model" value={whisperProfile} onChange={(event) => { const value = event.target.value as typeof whisperProfile; setWhisperProfile(value); try { if (value === "auto") localStorage.removeItem("clyra-whisper-profile"); else localStorage.setItem("clyra-whisper-profile", value); } catch {} }} className="clys-select">
                              <option value="auto">Automatic</option><option value="tiny">Tiny · fastest</option><option value="base">Base · balanced</option><option value="small">Small · best quality</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => { setWhisperProfile("auto"); try { localStorage.removeItem("clyra-whisper-profile"); } catch {} }}
                              className="clys-icon-btn"
                              aria-label="Reset transcription model"
                              title="Reset to automatic"
                            >
                              <RotateCcw aria-hidden />
                            </button>
                          </div>
                        </SettingRow>
                      </SettingsCard>
                      <SettingsCard title="Response character" description="How exploratory or direct everyday answers should feel.">
                        <div className="clys-block">
                          <div className="clys-option-grid">
                            {modelPresets.map((preset) => {
                              const active = Math.abs(temperature - preset.temperature) < 0.01;
                              return (
                                <button
                                  key={preset.label}
                                  type="button"
                                  onClick={() => setTemperature(preset.temperature)}
                                  data-active={active}
                                  className="clys-option-card"
                                >
                                  <p className="clys-option-card__label">{preset.label}</p>
                                  <p className="clys-option-card__detail">{preset.detail}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </SettingsCard>
                      <SettingsCard title="System prompt" description="Persistent instructions for Clyra on every reply.">
                        <div className="clys-block">
                          <textarea
                            value={systemPrompt}
                            onChange={(event) => setSystemPrompt(event.target.value)}
                            placeholder="Add persistent instructions for Clyra..."
                            spellCheck={false}
                            className="clys-textarea"
                          />
                          <div className="clys-chip-row">
                            {["Be concise and practical.", "Ask one clarifying question.", "Prefer polished UI details."].map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                onClick={() => setSystemPrompt(prompt)}
                                className="clys-btn h-8 px-3 text-[12px]"
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                          <p className="clys-note">
                            <Code2 className="clys-note__icon" aria-hidden />
                            Model routing stays automatic so the app preserves existing OpenAI-compatible API behavior.
                          </p>
                        </div>
                      </SettingsCard>
                    </>
                  ) : null}

                  {activeSection === "usage" ? (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="clys-group__title">API usage</p>
                          <p className="clys-group__detail mt-1">
                            Live token and unit metering from completed provider calls. Totals refresh automatically after each use.
                          </p>
                        </div>
                        <button type="button" onClick={() => void refreshUsage()} className="clys-header__close shrink-0" aria-label="Refresh API usage">
                          <RefreshCw className={cn("h-4 w-4", usageState === "loading" && "animate-spin")} />
                        </button>
                      </div>
                      {usageState === "error" ? (
                        <p className="mt-5 rounded-[10px] bg-[#FFF7F7] px-3.5 py-2.5 text-[12px] text-[#B3382F]">
                          Usage data is temporarily unavailable. Your API calls continue normally.
                        </p>
                      ) : null}
                      <div className="mt-6 grid grid-cols-2 gap-3">
                        <div className="clys-card clys-card--muted p-4">
                          <p className="text-[11.5px] font-medium text-[#9599A1]">Total cost</p>
                          <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-[#191919]">${Number(usage?.total?.costUsd || 0).toFixed(4)}</p>
                          <p className="mt-1 text-[11px] text-[#9599A1]">
                            {Number(usage?.total?.unpricedRequests || 0) > 0
                              ? `USD · ${Number(usage.total.unpricedRequests).toLocaleString()} request${Number(usage.total.unpricedRequests) === 1 ? "" : "s"} not yet priced`
                              : "USD · verified rates"}
                          </p>
                        </div>
                        <div className="clys-card clys-card--muted p-4">
                          <p className="text-[11.5px] font-medium text-[#9599A1]">Today</p>
                          <p className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-[#191919]">{Number(usage?.today?.tokens || 0).toLocaleString()}</p>
                          <p className="mt-1 text-[11px] text-[#9599A1]">provider tokens</p>
                        </div>
                      </div>
                      {Array.isArray(usage?.daily) && usage.daily.length ? (
                        <div className="mt-6">
                          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9599A1]">Last {usage.daily.length} days</p>
                          <div className="clys-card p-4">
                            {(() => {
                              const maxTokens = Math.max(1, ...usage.daily.map((day: any) => Number(day.tokens || 0)));
                              return (
                                <div className="flex h-24 items-end gap-1">
                                  {usage.daily.map((day: any) => {
                                    const heightPct = Math.max(2, Math.round((Number(day.tokens || 0) / maxTokens) * 100));
                                    const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                                    return (
                                      <div
                                        key={day.date}
                                        className="group relative flex-1"
                                        title={`${label}: ${Number(day.tokens || 0).toLocaleString()} tokens · ${day.requests} requests`}
                                      >
                                        <div
                                          className={cn(
                                            "w-full rounded-[3px] transition-colors",
                                            day.requests ? "bg-[#9DB8F5] group-hover:bg-[#2864F5]" : "bg-[#EDEFF2]",
                                          )}
                                          style={{ height: `${heightPct}%` }}
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <div className="mt-2 flex items-center justify-between text-[10.5px] text-[#9599A1]">
                              <span>{new Date(`${usage.daily[0].date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                              <span>{new Date(`${usage.daily[usage.daily.length - 1].date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-6">
                        <div className="mb-2.5 flex items-center justify-between">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9599A1]">By provider & model</p>
                          <p className="text-[11px] text-[#9599A1]">{usage?.total?.requests || 0} requests</p>
                        </div>
                        <div className="clys-card overflow-hidden">
                          {(usage?.byModel || []).length
                            ? usage.byModel.slice(0, 6).map((item: any) => (
                                <div key={`${item.provider}-${item.model}`} className="flex items-center justify-between gap-3 border-b border-[#ECEEF1] px-4 py-3 last:border-0">
                                  <div className="min-w-0">
                                    <p className="truncate text-[12.5px] font-medium text-[#191919]">{item.model}</p>
                                    <p className="mt-0.5 text-[10.5px] text-[#9599A1]">{item.provider} · {Number(item.tokens || 0).toLocaleString()} tokens · {item.requests} requests</p>
                                  </div>
                                  <p className={cn("shrink-0 text-[11.5px] font-medium", item.unpricedRequests ? "text-[#B45309]" : "text-[#3A3E46]")}>
                                    {item.unpricedRequests ? "Unpriced" : `$${Number(item.costUsd || 0).toFixed(4)}`}
                                  </p>
                                </div>
                              ))
                            : <div className="px-4 py-7 text-center text-[12px] text-[#9599A1]">No provider calls recorded yet.</div>}
                        </div>
                      </div>
                      <p className="mt-4 text-[11px] leading-relaxed text-[#9599A1]">
                        {usage?.methodology || "Models without a verified rate are labeled Unpriced rather than counted as $0. Usage records never store prompt or response content."}
                      </p>
                      <button
                        type="button"
                        onClick={async () => { await fetch("/api/usage/clear", { method: "POST" }); await refreshUsage(); }}
                        className="clys-btn mt-4 h-8 px-3 text-[11.5px]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        Clear usage history
                      </button>
                    </>
                  ) : null}

                  {activeSection === "data" ? (
                    <>
                      <SettingsCard title="On this device" description="Export a local copy or clear browser history.">
                        <SettingRow title="Saved chats" detail={`${chatCount} stored in this browser.`}>
                          <span className="clys-value-pill">{chatCount}</span>
                        </SettingRow>
                        <SettingRow title="Export chats" detail="Download as JSON.">
                          <button type="button" onClick={exportChats} className="clys-btn">
                            <Download aria-hidden />
                            Export
                          </button>
                        </SettingRow>
                        <SettingRow title="Clear chats" detail="Remove from this browser.">
                          <button type="button" onClick={clearChats} className="clys-btn clys-btn--solid-danger">
                            <Trash2 aria-hidden />
                            Clear
                          </button>
                        </SettingRow>
                      </SettingsCard>
                      <SettingsCard title="Reset" description="Restore every preference to its original value.">
                        <div className="clys-block clys-block--action">
                          <p className="clys-row__detail">Resets appearance, conversation, voice and model settings. Your chats are kept.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setTheme("Light");
                              setFontSize("Medium");
                              setUserBubbleColor("#F4F4F4");
                              setOrbColorTheme("default");
                              setSendOnEnter(true);
                              setAutoScroll(true);
                              setMarkdownSupport(true);
                              setCodeHighlighting(true);
                              setTemperature(0.7);
                              setSystemPrompt("");
                              setVoiceRate(0.94);
                              setVoicePitch(1.03);
                              setVoiceVolume(0.96);
                            }}
                            className="clys-btn mt-3"
                          >
                            <RotateCcw aria-hidden />
                            Reset defaults
                          </button>
                        </div>
                      </SettingsCard>
                    </>
                  ) : null}
                </motion.div>
              </div>
            </div>
    </section>
  );
}

/** The floating Settings window: blurred backdrop, soft rise-in, and the
 * embedded sheet inside. The sheet itself is the same surface the composer
 * morphs into, so both entry points share one design and one state model. */
export function SettingsModal(props: SettingsModalProps) {
  return (
    <AnimatePresence>
      {props.isOpen ? (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <motion.button
            type="button"
            aria-label="Close settings"
            className="clys-backdrop"
            onClick={props.onClose}
            tabIndex={-1}
          />
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <SettingsSheet {...props} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
