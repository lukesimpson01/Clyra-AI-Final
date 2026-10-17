// Built-in caption presets. These are Clyra's own style variants, defined as
// overrides on the default caption style. They are not copies of any product's
// templates. Users can duplicate and edit them; built-ins are read-only.

import { defaultCaptionStyle, normaliseCaptionStyle, type CaptionPreset, type CaptionStyle } from "./schema";

type Override = Partial<CaptionStyle>;

const BUILTIN: Array<{ id: string; name: string; override: Override }> = [
  { id: "classic", name: "Classic", override: { font: "Helvetica Neue", weight: 700, size: 52, shadow: true, strokeWidth: 3, strokeColor: "#000000" } },
  { id: "minimal", name: "Minimal", override: { font: "Helvetica Neue", weight: 400, size: 44, shadow: false, letterSpacing: 2 } },
  { id: "clean", name: "Clean", override: { font: "Inter", weight: 600, size: 54, shadow: true } },
  { id: "bold", name: "Bold", override: { font: "Inter", weight: 900, size: 64, caseMode: "upper", shadow: true, strokeWidth: 4, strokeColor: "#000000" } },
  { id: "karaoke", name: "Karaoke", override: { font: "Inter", weight: 800, size: 58, wordsPerPage: 6, activeColor: "#ffd54a", animation: "karaoke", animationMs: 200 } },
  { id: "bounce", name: "Bounce", override: { font: "Inter", weight: 800, size: 60, animation: "bounce", animationMs: 320, intensity: 0.7 } },
  { id: "pop", name: "Pop", override: { font: "Inter", weight: 800, size: 60, animation: "pop", animationMs: 200, intensity: 0.6 } },
  { id: "word-by-word", name: "Word by word", override: { font: "Inter", weight: 800, size: 72, wordsPerPage: 1, caseMode: "upper", animation: "pop", animationMs: 160 } },
  { id: "highlight", name: "Highlight", override: { font: "Inter", weight: 700, size: 54, animation: "highlight", activeColor: "#ffd54a", shadow: false } },
  { id: "outline", name: "Outline", override: { font: "Inter", weight: 800, size: 58, color: "#ffffff", strokeWidth: 6, strokeColor: "#101010", shadow: false } },
  { id: "boxed", name: "Boxed", override: { font: "Inter", weight: 700, size: 46, box: { enabled: true, color: "#000000", opacity: 0.72, radius: 16, padding: 14, blurPx: 0 }, shadow: false } },
  { id: "gradient-highlight", name: "Gradient highlight", override: { font: "Inter", weight: 800, size: 58, animation: "karaoke", activeColor: "#7cc4ff", color: "#ffffff", shadow: true } },
  { id: "news", name: "News", override: { font: "Helvetica Neue", weight: 700, size: 46, caseMode: "upper", position: "bottom", offsetPercent: 12, box: { enabled: true, color: "#0b2f6b", opacity: 0.92, radius: 4, padding: 12, blurPx: 0 }, shadow: false } },
  { id: "podcast", name: "Podcast", override: { font: "Georgia", weight: 400, size: 46, wordsPerPage: 8, shadow: true, emphasisColor: "#ffcf7a" } },
  { id: "gaming", name: "Gaming", override: { font: "Menlo", weight: 700, size: 50, caseMode: "upper", activeColor: "#42ff8a", strokeWidth: 4, strokeColor: "#000000", animation: "type-on", animationMs: 120 } },
  { id: "story", name: "Story", override: { font: "Georgia", weight: 400, size: 50, animation: "fade", animationMs: 420, shadow: true, position: "center", offsetPercent: 0 } },
  { id: "emphasis", name: "Emphasis", override: { font: "Inter", weight: 900, size: 78, wordsPerPage: 2, caseMode: "upper", animation: "pop", animationMs: 180, intensity: 0.8, emphasisColor: "#ffd54a", strokeWidth: 5, strokeColor: "#000000" } },
];

export const CAPTION_PRESET_BUILTINS: CaptionPreset[] = BUILTIN.map(({ id, name, override }) => ({
  id,
  name,
  builtin: true,
  style: normaliseCaptionStyle({ ...defaultCaptionStyle(id), ...override, presetId: id }),
}));

export function presetStyle(id: string, presets: CaptionPreset[] = CAPTION_PRESET_BUILTINS): CaptionStyle {
  const found = presets.find((preset) => preset.id === id) ?? CAPTION_PRESET_BUILTINS.find((preset) => preset.id === id);
  return found ? found.style : defaultCaptionStyle(id);
}

/** Built-in presets plus the user's saved presets, with the default flag resolved to one entry. */
export function mergePresets(saved: CaptionPreset[]): CaptionPreset[] {
  const userPresets = saved.filter((preset) => !preset.builtin && !CAPTION_PRESET_BUILTINS.some((builtin) => builtin.id === preset.id));
  return [...CAPTION_PRESET_BUILTINS, ...userPresets];
}
