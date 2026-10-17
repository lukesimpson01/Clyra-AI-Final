import { useEffect, useState } from "react";
import { Globe2, Monitor, Smartphone, X } from "lucide-react";
import { api, type PlatformSnapshot } from "./api";
import { BRIEF_COPY, briefLine, type BriefPlatform } from "./appBrief";

const PLATFORM_ICON = { web: Globe2, desktop: Monitor, ios: Smartphone } as const;

/** Header row for a chosen app type, with a control to clear it. */
export function BriefHeader({ platform, onClear }: { platform: BriefPlatform; onClear: () => void }) {
  const Icon = PLATFORM_ICON[platform];
  return (
    <div className="flex items-center justify-between gap-2 px-3.5 pt-3">
      <span className="inline-flex h-6 items-center gap-1.5 rounded-[7px] bg-[var(--accent-blue)]/[0.09] px-2 text-[11.5px] font-medium text-[var(--accent-blue)]">
        <Icon className="h-3 w-3" strokeWidth={1.8} />
        {BRIEF_COPY[platform].label}
      </span>
      <button
        type="button"
        aria-label={`Clear ${BRIEF_COPY[platform].label} choice`}
        onClick={onClear}
        className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors hover:bg-black/[0.04] hover:text-[var(--text-primary)]"
      >
        <X className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </div>
  );
}

function BriefRow({ label, example, onUse }: { label: string; example: string; onUse: () => void }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{label}</span>
      <button
        type="button"
        onClick={onUse}
        title="Add this example to your brief"
        className="pointer-events-auto -mx-1 rounded-[6px] px-1 py-0.5 text-left text-[12.5px] leading-[1.45] text-[var(--text-secondary)] transition-colors hover:bg-black/[0.035] hover:text-[var(--text-primary)]"
      >
        <span className="text-[var(--text-tertiary)]">e.g. </span>{example}
      </button>
    </li>
  );
}

/**
 * The skeleton prompt shown inside the empty composer. It asks for the app idea,
 * how it should function and how it should look, and offers a real example for
 * each. Clicking an example adds it to the brief. Clicks elsewhere reach the
 * textarea underneath, so the field stays usable.
 */
export function BriefSkeleton({ platform, onUse }: { platform: BriefPlatform; onUse: (line: string) => void }) {
  const copy = BRIEF_COPY[platform];
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 px-4 pt-3.5 text-left" aria-live="polite">
      <p className="text-[14px] font-medium leading-[1.35] text-[var(--text-secondary)]">
        Describe your {copy.noun} idea
      </p>
      <ul className="mt-2.5 flex flex-col gap-2">
        <BriefRow label="What it does" example={copy.functionExample} onUse={() => onUse(briefLine("function", copy.functionExample))} />
        <BriefRow label="How it looks" example={copy.stylingExample} onUse={() => onUse(briefLine("styling", copy.stylingExample))} />
      </ul>
    </div>
  );
}

let platformSnapshot: Promise<PlatformSnapshot> | null = null;

/** Honest status line for iOS briefs, taken from the real host probe. */
export function IOSHostNote() {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    platformSnapshot ??= api.platform();
    platformSnapshot
      .then((next) => { if (!cancelled) setSnapshot(next); })
      .catch(() => { platformSnapshot = null; });
    return () => { cancelled = true; };
  }, []);

  if (!snapshot) return null;
  const simulator = snapshot.matrix.apple.iosSimulator.state === "available";
  const text = simulator
    ? "This Mac can run the iOS Simulator. Clyra reports a run only after it happens."
    : snapshot.matrix.host.platform === "darwin"
      ? "The iOS Simulator needs full Xcode, which this Mac does not have. Clyra will write and check the Swift code here and say which runs it could not do."
      : "iOS runs need macOS with Xcode. Clyra will write and check the Swift code on this host and say which runs it could not do.";
  return <p className="px-4 pb-1 pt-2 text-left text-[11.5px] leading-[1.45] text-[var(--text-tertiary)]">{text}</p>;
}
