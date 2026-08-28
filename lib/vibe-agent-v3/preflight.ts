/**
 * Small, deterministic preflight for the Clyra coding runtime.  It is kept
 * independent of the model provider so the harness can make safe decisions
 * (effort, project shape and clarification) before a prompt is sent.
 */
export type VibeEffort = "low" | "medium" | "high";
export type VibeTaskMode = "ask" | "plan" | "build" | "change" | "fix" | "debug" | "review" | "test" | "goal" | "multitask" | "ship";
export type VibeProjectType = "existing" | "web" | "desktop" | "unknown";

export type VibePreflight = {
  objective: string;
  mode: VibeTaskMode;
  effort: VibeEffort;
  projectType: VibeProjectType;
  acceptanceCriteria: string[];
  question: null | {
    id: "platform";
    prompt: string;
    options: Array<{ id: "web" | "desktop" | "choose"; label: string; description: string; recommended?: boolean }>;
  };
};

const desktop = /\b(desktop app|electron|tauri|menubar|system tray|native desktop|macos app|windows app)\b/i;
const web = /\b(web ?app|website|landing page|browser|react|next(?:\.js)?|vite|html|css)\b/i;

export function normalizeEffort(value: unknown): VibeEffort {
  return value === "low" || value === "high" || value === "medium" ? value : "medium";
}

export function classifyVibeTask(value: string): VibeTaskMode {
  const text = value.trim().toLowerCase();
  if (/^\/(?:goal)\b|\b(goal|make ci green)\b/.test(text)) return "goal";
  if (/^\/(?:multitask)\b|\b(parallel|multitask|subagents?)\b/.test(text)) return "multitask";
  if (/^\/(?:review)\b|\b(code review|review (?:this|the))\b/.test(text)) return "review";
  if (/^\/(?:plan)\b|\b(plan|architecture proposal)\b/.test(text)) return "plan";
  if (/^\/(?:test)\b|\b(test|verify|validation)\b/.test(text)) return "test";
  if (/^\/(?:debug)\b|\b(debug|diagnose|investigate|broken|not working|error)\b/.test(text)) return "debug";
  if (/\b(fix|repair|regression)\b/.test(text)) return "fix";
  if (/\b(explain|what is|why does|how does)\b/.test(text)) return "ask";
  if (/\b(build|create|make|implement|add)\b/.test(text)) return "build";
  return "change";
}

function criteriaFor(mode: VibeTaskMode, projectType: VibeProjectType): string[] {
  const criteria = ["Inspect the relevant code before changing it.", "Keep the requested behaviour accessible and free of layout overflow."];
  if (mode !== "ask" && mode !== "plan" && mode !== "review") criteria.push("Run the smallest meaningful validation and repair any failure caused by the change.");
  if (projectType === "web" || projectType === "desktop") criteria.push("Check the running UI structurally: DOM, interaction state, geometry, console and network errors.");
  if (projectType === "desktop") criteria.push("Keep Electron/Tauri boundaries explicit and preserve the browser-preview path.");
  return criteria;
}

export function createVibePreflight(objective: string, requestedEffort: unknown = "medium"): VibePreflight {
  const mode = classifyVibeTask(objective);
  const projectType: VibeProjectType = desktop.test(objective) ? "desktop" : web.test(objective) ? "web" : "unknown";
  const needsPlatformChoice = mode === "build" && projectType === "unknown" && /\b(app|application|product)\b/i.test(objective);
  return {
    objective: objective.trim(),
    mode,
    effort: normalizeEffort(requestedEffort),
    projectType,
    acceptanceCriteria: criteriaFor(mode, projectType),
    question: needsPlatformChoice ? {
      id: "platform",
      prompt: "Which platform should Clyra target?",
      options: [
        { id: "web", label: "Web app", description: "Runs in a browser and is easiest to share.", recommended: true },
        { id: "desktop", label: "Desktop app", description: "Uses a native desktop shell with local integrations." },
        { id: "choose", label: "Choose for me", description: "Clyra will select the best fit from the request." },
      ],
    } : null,
  };
}
