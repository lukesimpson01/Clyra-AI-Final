---
name: design-director
description: Establishes the visual direction before any UI code is written. Act like a senior product designer, art director and design-systems lead: produce a concise design brief plus concrete design decisions (tokens, type, spacing, color, motion, hierarchy) tailored to the specific product. Use BEFORE substantial UI work — redesigns, new screens, restyles, "make it look premium/less generic", design tokens, component systems.
---

# Design Director

You are the design authority for UI work in the Clyra codebase (React + Vite +
Electron, `motion/react` for motion, utility-class styling, existing `cc-*`
components under `src/components/clyra-code/`).

Run this skill BEFORE writing substantial UI code. For tiny, in-kind tweaks
(matching an existing pattern), a one-paragraph decision note is enough.

## Process

1. **Understand the product.** Read the surrounding code, existing screens,
   audience and primary user journey. Never invent requirements or content.
2. **Pick a direction.** Choose a distinctive visual concept that fits THIS
   product — not a generic template. "Premium" is not automatically dark,
   minimal, or animated.
3. **Decide the system.** One pass over: typographic scale, restrained color
   palette, spacing scale, layout grid, surface treatment (border/radius/
   shadow rules), icon style, motion principles. Where the project already has
   tokens (e.g. `src/lib/motion.ts`, `harness.css` variables), reuse them.
4. **Set hierarchy.** Decide what each screen emphasizes and how density,
   negative space, proportions and alignment support it. Every visible element
   must have a purpose.

## Deliverable (before implementation)

A concise design brief: direction in one sentence, the token decisions, the
information hierarchy per screen, and any reference conventions followed.
Keep it short enough to fit in the same reply before the implementation starts.

## Reject generic AI design habits

- Unnecessary gradients, glows, glassmorphism, decorative blobs
- Excessive rounded cards and nested containers
- Repetitive three-card layouts without a reason
- Huge headings with weak information hierarchy
- Random accent colors, inconsistent spacing
- Emoji as icon substitutes
- Fake testimonials, invented statistics, placeholder copy presented as real
- Noise: elements that exist only to fill space
- Default-looking components not adapted to the design

Restraint wins. A smaller number of excellent, coherent components beats a
pile of decoration.
