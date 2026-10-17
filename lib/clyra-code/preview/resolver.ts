/**
 * Target-aware preview resolution. The project's real targets decide the preview
 * provider before anything is started. Resolution is read-only: it never creates,
 * edits or deletes a file, and it never substitutes HTML for a native runtime.
 */
import type { PlatformCapabilityMatrix } from "../platform/capabilities";
import type { DetectedTarget, ProjectTarget } from "../targets/detect";

export type PreviewKind = "browser" | "electron" | "ios-simulator" | "none";

export type PreviewProviderId =
  | "WebPreviewProvider"
  | "ElectronPreviewProvider"
  | "IOSSimulatorPreviewProvider"
  | "NoRuntimePreviewProvider";

export type ProjectCapabilities = {
  canAuthor: boolean;
  canBuild: boolean;
  canRun: boolean;
  canPreview: boolean;
  canTest: boolean;
  previewKind: PreviewKind;
};

export type PreviewResolution = {
  provider: PreviewProviderId;
  kind: PreviewKind;
  /** The target the preview is for, or null when nothing previewable was found. */
  target: ProjectTarget | null;
  /** True only when the provider's runtime is genuinely available on this host. */
  available: boolean;
  /** A plain-language reason shown to the user. Always set. */
  reason: string;
};

const PREVIEW_ORDER: ProjectTarget[] = ["web", "electron", "ios-native"];

function kindFor(target: ProjectTarget): PreviewKind {
  if (target === "web") return "browser";
  if (target === "electron") return "electron";
  if (target === "ios-native") return "ios-simulator";
  return "none";
}

/**
 * Chooses the preview for a project. The root target is preferred. Otherwise the
 * first target that has a runtime, in the order web, Electron, iOS, is used.
 */
export function resolvePreview(
  targets: readonly DetectedTarget[],
  matrix: PlatformCapabilityMatrix | null,
): PreviewResolution {
  const root = targets.find((t) => t.location === ".");
  const ordered = [...(root ? [root] : []), ...targets.filter((t) => t !== root)];
  const previewable = ordered
    .filter((t) => PREVIEW_ORDER.includes(t.target))
    .sort((a, b) => PREVIEW_ORDER.indexOf(a.target) - PREVIEW_ORDER.indexOf(b.target));
  const chosen = root && PREVIEW_ORDER.includes(root.target) ? root : previewable[0];

  if (!chosen) {
    const swift = targets.find((t) => t.target === "swift-package");
    const reason = swift
      ? "This is a Swift package. It has no app preview: run it with swift run, or check it with swift test."
      : targets.length
        ? "This project type has no visual preview. Its commands are available in the terminal."
        : "No recognised project target was found, so there is nothing to preview yet.";
    return { provider: "NoRuntimePreviewProvider", kind: "none", target: null, available: false, reason };
  }

  const kind = kindFor(chosen.target);
  if (kind === "browser") {
    return {
      provider: "WebPreviewProvider",
      kind,
      target: chosen.target,
      available: true,
      reason: "Web project: the preview runs the project's own dev server.",
    };
  }
  if (kind === "electron") {
    return {
      provider: "ElectronPreviewProvider",
      kind,
      target: chosen.target,
      available: true,
      reason: "Electron app: the preview launches the real Electron process, so native behaviour is checked as it is.",
    };
  }

  // Native iOS: never HTML. Availability comes from the real host probe.
  const simulator = matrix?.apple.iosSimulator;
  if (!simulator) {
    return {
      provider: "IOSSimulatorPreviewProvider",
      kind,
      target: chosen.target,
      available: false,
      reason: "Native iOS runtime verification is unavailable: this host has not been checked for Xcode and the iOS Simulator.",
    };
  }
  if (simulator.state !== "available") {
    return {
      provider: "IOSSimulatorPreviewProvider",
      kind,
      target: chosen.target,
      available: false,
      reason: `Native iOS runtime verification is unavailable on this host. ${simulator.reason}`,
    };
  }
  return {
    provider: "IOSSimulatorPreviewProvider",
    kind,
    target: chosen.target,
    available: false,
    reason: "This Mac can run the iOS Simulator, but Clyra's simulator preview is not implemented in this build. Build and run the app from Xcode.",
  };
}

/** What the project can do, derived from its targets and the host. The UI and the agent both use this. */
export function projectCapabilities(
  targets: readonly DetectedTarget[],
  matrix: PlatformCapabilityMatrix | null,
): ProjectCapabilities {
  const resolution = resolvePreview(targets, matrix);
  const hasSwift = targets.some((t) => t.target === "swift-package" || t.target === "ios-native");
  const hasNode = targets.some((t) => t.target === "web" || t.target === "electron" || t.target === "backend" || t.target === "generic");
  return {
    // Source files can always be created and edited, whatever the target.
    canAuthor: true,
    canBuild: hasNode || (hasSwift && matrix?.activities.build.state === "available"),
    canRun: resolution.kind === "browser" || resolution.kind === "electron" || (hasNode && targets.some((t) => t.target === "backend")),
    canPreview: resolution.kind === "browser" || resolution.kind === "electron" || (resolution.kind === "ios-simulator" && resolution.available),
    canTest: hasNode || (hasSwift && matrix?.activities.test.state === "available"),
    previewKind: resolution.kind,
  };
}
