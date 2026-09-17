/**
 * Compact, automatic frontend-quality skill for the coding harness.
 * It is intentionally evidence-led: it tells the agent how to use a
 * repository's own visual language instead of giving it a fashionable style
 * recipe that produces the same generic interface everywhere.
 */
export const FRONTEND_DESIGN_SKILL_ID = "github-frontend-quality";

const UI_SIGNAL = /\b(ui|ux|frontend|front-end|website|web\s*app|page|screen|component|dashboard|landing|responsive|css|tailwind|react|design|modal|sidebar|button|form)\b/i;

export function automaticFrontendSkill(objective: string) {
  if (!UI_SIGNAL.test(objective)) return null;
  return `[Clyra skill: ${FRONTEND_DESIGN_SKILL_ID}]
Use this only for the UI-facing portions of the task. First inspect the existing component library, styles, tokens, layout primitives, and representative neighbouring screens. Reuse those conventions; do not replace a working visual system.

Make hierarchy follow the user's primary task, with one obvious primary action and restrained secondary controls. Use real task content, clear labels, keyboard/focus behavior, responsive constraints, and honest empty/loading/error states. Avoid generic AI-dashboard tropes: decorative gradients or glows, glass-card grids, fake metrics/activity, oversized hero text, arbitrary rounded controls, emoji/icon mosaics, and controls with no behavior.

Before completion, structurally inspect the running UI where possible: semantic roles/text, interaction state, narrow-width overflow, console/runtime errors, and network failures. Use screenshots only as optional supporting evidence; DOM and accessibility evidence are sufficient when vision is unavailable.`;
}
