/**
 * The guided app brief shown when a welcome chip is chosen. Pure data and text
 * helpers only, so the copy and the directive sent to the agent stay testable.
 */

export type BriefPlatform = "web" | "desktop" | "ios";

export type BriefCopy = {
  label: string;
  /** Noun used in the heading, e.g. "Describe your iPhone app idea". */
  noun: string;
  /** Example of what the app should do. Clicking it adds the line to the brief. */
  functionExample: string;
  /** Example of how the app should look. Clicking it adds the line to the brief. */
  stylingExample: string;
};

export const BRIEF_COPY: Record<BriefPlatform, BriefCopy> = {
  web: {
    label: "Website",
    noun: "website",
    functionExample: "A booking page for a yoga studio with a class schedule, a sign-up form and a confirmation email",
    stylingExample: "Calm and airy: warm off-white background, near-black type, one restrained blue accent and soft rounded cards",
  },
  desktop: {
    label: "Desktop app",
    noun: "desktop app",
    functionExample: "A notes app with folders, full-text search and keyboard shortcuts",
    stylingExample: "Compact and native-feeling: a left sidebar, neutral panels, crisp 13px type and thin dividers, with light and dark mode",
  },
  ios: {
    label: "iOS app",
    noun: "iPhone app",
    functionExample: "A habit tracker with Today, History and Settings tabs, daily check-ins and local reminders",
    stylingExample: "Native iOS: large titles, grouped lists, system typography with a blue accent, and Dynamic Type and dark mode support",
  },
};

export function isBriefPlatform(value: string): value is BriefPlatform {
  return value === "web" || value === "desktop" || value === "ios";
}

/**
 * The instruction the agent receives for a chosen platform. The iOS wording is
 * deliberately strict: Clyra can author and check Swift on any host, but it may
 * only report simulator or device runs that actually happened.
 */
/**
 * What every app must contain. A short request ("build a habit tracker") is
 * expanded by this bar into a complete product, so the agent does not stop at a
 * single screen with placeholder controls.
 */
export const PRODUCT_BAR =
  "Build a complete, polished product, not a sketch. Before writing code, decide the product: the main user jobs, the screens or views and how they connect, the data model, what persists between launches, and the empty, loading and error states. Implement all of it with real behaviour: no dead buttons, no lorem ipsum, no placeholder screens. Seed sample data only where it demonstrates a feature, and label it as sample data. Put the core logic in a separate, tested layer. Keep going until every screen and flow works, then run the project's build and tests, fix every failure, and report exactly what you ran and what passed.";

/** The design language every surface shares. Warm and calm, never generic AI styling. */
export const DESIGN_LANGUAGE =
  "Design language: a warm off-white canvas, near-black typography, soft grey dividers, one restrained blue accent, slim monochrome icons, subtle shadows, purposeful whitespace, restrained radii (8 to 12 px) and smooth 150 to 250 ms transitions. Define these as design tokens in one place (colour, spacing, radius, type scale, motion) and use only those. Avoid purple gradients, glass effects, neon, orbs, stacks of identical cards and decorative hero text on utility screens.";

export function platformDirective(platform: BriefPlatform): string {
  if (platform === "ios") {
    return [
      "Build this as a native iOS app in SwiftUI. Use the project structure the repository already has, or a Swift Package with a SwiftUI app target. Set the deployment targets explicitly, include macOS 14 so Swift Testing can run, and keep the model layer free of SwiftUI so it can be tested.",
      "Use native structure: NavigationStack for drill-down, TabView for the top-level sections, Form and List for settings and records, toolbars and sheets where the platform expects them. Use SF Symbols, system colours with semantic roles so light and dark mode both work, Dynamic Type text styles rather than fixed sizes, and accessibility labels on every control. Use local persistence (SwiftData or a JSON file in Application Support) so data survives relaunch. Do not use web-style sidebars or custom back buttons.",
      "Write tests with Swift Testing for the model and persistence layers. Check the work with real tooling: swift build and swift test. If the full Xcode toolchain and an iOS simulator are not available on this host, do not claim the app ran on a simulator or device. Say which checks ran, which could not, and what the user must run in Xcode to verify the interface.",
      PRODUCT_BAR,
      DESIGN_LANGUAGE,
    ].join("\n\n") + "\n\n";
  }
  if (platform === "desktop") {
    return [
      "Build this as a desktop app with Electron. Keep the renderer runnable in a browser for development, then add the native shell.",
      "Security is part of the build: contextIsolation true, nodeIntegration false, sandboxed renderer, a typed preload bridge that exposes only named functions, IPC channels validated in the main process, and no remote content loaded into the window. Add a native menu with keyboard shortcuts, remember window size and position, and handle the window-all-closed and activate lifecycle correctly. Provide npm scripts to build and to start the app, and confirm the app starts and stays up.",
      PRODUCT_BAR,
      DESIGN_LANGUAGE,
    ].join("\n\n") + "\n\n";
  }
  return [
    "Build this as a responsive website and web application. Use the framework the request or the repository calls for, and default to a Vite and React project with a TypeScript source tree. Make the live preview work from the start. Make it responsive from 375 px to desktop widths with no horizontal scrolling, keyboard focus states, semantic HTML, text that meets AA contrast, and sensible behaviour in both light and dark mode.",
    PRODUCT_BAR,
    DESIGN_LANGUAGE,
  ].join("\n\n") + "\n\n";
}

/** Maps a platform question answer ("Web app", "Desktop app", "iOS app", ...) to a platform. */
export function platformFromAnswer(answer: string): BriefPlatform | null {
  if (/ios|iphone|ipad/i.test(answer)) return "ios";
  if (/desktop|electron|tauri/i.test(answer)) return "desktop";
  if (/web/i.test(answer)) return "web";
  return null;
}

/** The directive for an answer to the "which platform?" question, including its framework and automatic choices. */
export function answerDirective(answer: string): string {
  if (/^tauri$/i.test(answer)) return `Build this as a Tauri desktop app. Keep the frontend independently runnable for live preview, then add the native Tauri boundary and validate it.\n\n${PRODUCT_BAR}\n\n${DESIGN_LANGUAGE}\n\n`;
  if (/^electron$/i.test(answer)) return `Build this as an Electron desktop app. Keep the frontend independently runnable for live preview, then add the native Electron boundary and validate it.\n\n${PRODUCT_BAR}\n\n${DESIGN_LANGUAGE}\n\n`;
  if (/choose for me/i.test(answer)) return `Choose the most suitable platform from the request. Prefer a responsive web app unless the requirements need native desktop APIs or a desktop distribution. Record the decision and proceed without another question.\n\n${PRODUCT_BAR}\n\n${DESIGN_LANGUAGE}\n\n`;
  return platformDirective(platformFromAnswer(answer) ?? "web");
}

/**
 * The line added to the brief when an example is clicked. Function and styling
 * lines are labelled so the agent can tell behaviour from presentation.
 */
export function briefLine(kind: "function" | "styling", text: string): string {
  return `${kind === "function" ? "What it does" : "How it looks"}: ${text}`;
}
