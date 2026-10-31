import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Film, FolderOpen, HardDrive, Monitor, Moon, Settings2, ShieldCheck, Sun, WandSparkles } from "lucide-react";
import { shortsApi, type ShortsUsage } from "./api";
import { Segmented, Toggle } from "./workspace/controls";

type SettingsSection = "general" | "appearance" | "editor" | "storage";
type ClyraTheme = "Light" | "Dark";

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Settings2 }> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "appearance", label: "Appearance", icon: Monitor },
  { id: "editor", label: "Video Editor", icon: Film },
  { id: "storage", label: "Storage", icon: HardDrive },
];

function readBool(key: string, fallback: boolean) {
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

export function ShortsSettings({ onBack, onOpenLibrary, onOpenVideoEditor }: { onBack: () => void; onOpenLibrary: () => void; onOpenVideoEditor: () => void }) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [theme, setTheme] = useState<ClyraTheme>(() => window.localStorage.getItem("clyra-theme") === "Dark" ? "Dark" : "Light");
  const [reduceMotion, setReduceMotion] = useState(() => readBool("clyra-shorts-reduce-motion", false));
  const [preloadEditor, setPreloadEditor] = useState(() => readBool("clyra-shorts-preload-editor", true));
  const [usage, setUsage] = useState<ShortsUsage | null>(null);

  useEffect(() => {
    shortsApi.usage().then((result) => setUsage(result.usage)).catch(() => undefined);
  }, []);

  const chooseTheme = (value: string) => {
    const next = value === "Dark" ? "Dark" : "Light";
    setTheme(next);
    window.localStorage.setItem("clyra-theme", next);
    document.documentElement.dataset.clyraTheme = next.toLowerCase();
  };

  const chooseMotion = (value: boolean) => {
    setReduceMotion(value);
    window.localStorage.setItem("clyra-shorts-reduce-motion", String(value));
    document.documentElement.dataset.shortsMotion = value ? "reduced" : "full";
  };

  const choosePreload = (value: boolean) => {
    setPreloadEditor(value);
    window.localStorage.setItem("clyra-shorts-preload-editor", String(value));
  };

  const usedGb = (usage?.totalBytes ?? 0) / 1_073_741_824;
  const budgetGb = (usage?.budgetBytes ?? 3_221_225_472) / 1_073_741_824;

  return (
    <div className="sh-settings-page sh-route-enter">
      <div className="sh-page-frame">
        <header className="sh-page-header">
          <div className="sh-page-heading">
            <button type="button" className="sh-icon-btn" onClick={onBack} aria-label="Back to Shorts"><ArrowLeft size={17} strokeWidth={1.8} /></button>
            <div>
              <span className="sh-page-eyebrow">SHORTS STUDIO</span>
              <h1>Settings</h1>
              <p>Make the studio feel right without changing how your projects are stored.</p>
            </div>
          </div>
        </header>

        <div className="sh-settings-layout">
          <nav className="sh-settings-nav" aria-label="Settings sections">
            {SETTINGS_SECTIONS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}>
                  <Icon size={16} strokeWidth={1.7} />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <main className="sh-settings-content" key={section}>
            {section === "general" ? (
              <SettingsGroup title="General" description="The defaults that apply throughout Shorts Studio.">
                <SettingsRow icon={ShieldCheck} title="Local-first workflow" detail="Projects, media and editor state stay on this computer."><span className="sh-status-pill is-good">Active</span></SettingsRow>
                <SettingsRow icon={WandSparkles} title="Autosave" detail="Dedicated editors save changes after you pause typing."><span className="sh-status-pill is-good">On</span></SettingsRow>
                <SettingsRow icon={FolderOpen} title="Project library" detail="Open projects, exports, templates and local media."><button type="button" className="sh-btn sh-btn--sm" onClick={onOpenLibrary}>Open library</button></SettingsRow>
              </SettingsGroup>
            ) : null}

            {section === "appearance" ? (
              <SettingsGroup title="Appearance" description="Keep the same visual hierarchy across every Shorts surface.">
                <SettingsRow icon={theme === "Dark" ? Moon : Sun} title="Theme" detail="This updates Clyra and Shorts together."><Segmented value={theme} options={[["Light", "Light"], ["Dark", "Dark"]]} onChange={chooseTheme} /></SettingsRow>
                <SettingsRow icon={Monitor} title="Reduce motion" detail="Removes route, card and panel transitions inside Shorts."><Toggle checked={reduceMotion} onChange={chooseMotion} label="Reduce Shorts motion" /></SettingsRow>
              </SettingsGroup>
            ) : null}

            {section === "editor" ? (
              <SettingsGroup title="Video Editor" description="Control how the local motion-graphics editor starts.">
                <SettingsRow icon={HardDrive} title="Preload editing engine" detail="Fetch the local WASM engine while the Shorts home screen is idle."><Toggle checked={preloadEditor} onChange={choosePreload} label="Preload video editor" /></SettingsRow>
                <SettingsRow icon={Film} title="Clyra Editor" detail="Multi-track timeline, subtitles, Whisper transcription and Clyra voices. Projects live on this computer."><button type="button" className="sh-btn sh-btn--primary sh-btn--sm" onClick={onOpenVideoEditor}>Open editor</button></SettingsRow>
              </SettingsGroup>
            ) : null}

            {section === "storage" ? (
              <SettingsGroup title="Storage" description="Real usage from Shorts projects, copied media, exports and local libraries.">
                <div className="sh-storage-summary">
                  <div className="sh-storage-ring" style={{ "--storage-progress": `${Math.round((usage?.fraction ?? 0) * 360)}deg` } as CSSProperties}><span>{Math.round((usage?.fraction ?? 0) * 100)}%</span></div>
                  <div><strong>{usedGb.toFixed(2)} GB used</strong><span>Recommended working set: approximately {budgetGb.toFixed(0)} GB</span></div>
                </div>
                <SettingsRow icon={FolderOpen} title="Manage stored work" detail="Review projects and exports before removing anything."><button type="button" className="sh-btn sh-btn--sm" onClick={onOpenLibrary}>Review library</button></SettingsRow>
              </SettingsGroup>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="sh-settings-group"><header><h2>{title}</h2><p>{description}</p></header><div className="sh-settings-rows">{children}</div></section>;
}

function SettingsRow({ icon: Icon, title, detail, children }: { icon: typeof Settings2; title: string; detail: string; children: ReactNode }) {
  return <div className="sh-settings-row"><span className="sh-settings-row-icon"><Icon size={16} strokeWidth={1.7} /></span><div className="sh-settings-row-copy"><strong>{title}</strong><span>{detail}</span></div><div className="sh-settings-row-control">{children}</div></div>;
}
