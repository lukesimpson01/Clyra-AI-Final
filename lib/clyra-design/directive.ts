/**
 * Pure, browser-safe pieces of Clyra Design: the catalog types, labels, and the
 * instruction block that tells the coding agent it is designing a screen. The
 * server reads the bundled files (catalog.ts); the client imports this module
 * to build prompts. Nothing here touches Node APIs.
 */

export type DesignSystemSummary = { id: string; name: string; category: string; description: string };
export type DesignTemplateSummary = { id: string; name: string; description: string };

/** Project-relative folder the server writes design references into. */
export const DESIGN_FILES_DIR = "design";

/** "saas-landing" -> "SaaS Landing"; small words stay lowercase, known acronyms stay upper. */
export function designTemplateLabel(id: string): string {
  const acronyms = new Map([["saas", "SaaS"], ["ui", "UI"], ["ux", "UX"], ["api", "API"]]);
  return id
    .split("-")
    .map((word) => acronyms.get(word) ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

/**
 * The instruction block prepended to the first prompt of a design project. It
 * points at files the server has already written, so the agent reads them
 * instead of guessing the house style.
 */
export function designDirective(options: { system?: DesignSystemSummary | null; template?: DesignTemplateSummary | null }): string {
  const lines = [
    "[Clyra Design mode] You are designing a visual screen, not scaffolding an app.",
    "- Build it as index.html at the project root: one responsive file, with CSS inline or linked.",
  ];
  if (options.system) {
    lines.push(
      `- Design system: ${options.system.name}. ${options.system.description}`.trim(),
      `  Follow ${DESIGN_FILES_DIR}/DESIGN.md for colour, type, radius, spacing and tone.`,
      `  Link the tokens with <link rel="stylesheet" href="${DESIGN_FILES_DIR}/tokens.css"> and use its CSS variables.`,
    );
  } else {
    lines.push("- No design system is chosen: use one restrained palette, one accent colour and a clear type scale, and say what you chose.");
  }
  if (options.template) {
    lines.push(
      `- Template reference: ${options.template.name}. ${options.template.description}`.trim(),
      `  Use ${DESIGN_FILES_DIR}/template.html as a structural starting point, not a copy.`,
    );
  }
  lines.push("- Open the live preview yourself and fix overflow, contrast and spacing problems before you finish.");
  return `${lines.join("\n")}\n\n`;
}
