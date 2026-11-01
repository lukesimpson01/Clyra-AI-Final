/* The advanced editor's subtitle catalog (its Word presets, Lines styles and animations), shared so the AI clipper offers
   exactly what the editor does. One source: frame/subtitle-styles.js in openfilm. */
export { WORD_PRESETS, LINE_STYLES, SUB_ANIMATIONS } from '../../openfilm/packages/openfilm/studio/ui/src/frame/subtitle-styles.js';
import { WORD_PRESETS, LINE_STYLES } from '../../openfilm/packages/openfilm/studio/ui/src/frame/subtitle-styles.js';

/* The editor draws Word presets in Sora 800 with a 9% outline and a soft drop shadow (frame/subtitle-runtime.js). */
const WORD_FONT = "Sora, Poppins, 'Helvetica Neue', Arial, sans-serif";

/** One style as both looks need it: CSS for the preview and the clipper's burn-in description (clipper-pipeline.py
 *  write_styled_subtitles). `mode`: 'Word' or 'Lines'. */
export function captionStyle(mode, id) {
  if (mode === 'Lines') {
    const st = LINE_STYLES[id] || LINE_STYLES[1];
    return {
      font: st.font, weight: st.weight, italic: !!st.italic, upper: !!st.upper, fill: st.fill, active: st.active,
      stroke: st.stroke || null, strokeW: st.strokeW || 0, box: st.box || null, glow: st.glow || null,
      shadow: st.shadow || (st.drop ? ['#000000', st.drop * 2] : null),
    };
  }
  const [fill, edge] = WORD_PRESETS[id] || WORD_PRESETS[2];
  return { font: WORD_FONT, weight: 800, italic: false, upper: false, fill, active: fill, stroke: edge, strokeW: 0.09, box: null, glow: null, shadow: ['rgba(0,0,0,.45)', 12] };
}

/** A style with the person's own choices over it, as the editor's Text and Colors tabs allow: `font` (a bundled family,
 *  null keeps the style's), `upper` (null keeps the style's) and `colors` ({ text, spoken, outline }, or null). */
export function customStyle(mode, id, { font = null, upper = null, colors = null } = {}) {
  const st = captionStyle(mode, id);
  return {
    ...st,
    ...(font ? { font: `'${font}', ${st.font}` } : {}),
    ...(upper != null ? { upper } : {}),
    ...(colors ? { fill: colors.text, active: colors.spoken, stroke: colors.outline, strokeW: st.strokeW || 0.08, glow: st.glow ? [colors.spoken, st.glow[1]] : null } : {}),
  };
}

/** The burn-in description sent with a run (sizePct: of the frame's width; yPct: the caption's centre from the top). */
export function captionPayload({ mode, id, animation, sizePct, yPct, font = null, upper = null, colors = null }) {
  return { mode: mode === 'Lines' ? 'lines' : 'word', presetId: id, ...customStyle(mode, id, { font, upper, colors }), animation, sizePct, yPct };
}

/** Inline CSS for a word drawn in a style, at a font size in px (the preview's own scale). */
export function captionCss(style, px, lit) {
  const css = {
    fontFamily: style.font, fontWeight: style.weight, fontStyle: style.italic ? 'italic' : 'normal', fontSize: `${px}px`,
    color: lit ? style.active : style.fill, textTransform: style.upper ? 'uppercase' : 'none', lineHeight: 1.12,
    WebkitTextStroke: style.stroke && style.strokeW ? `${Math.max(1, px * style.strokeW)}px ${style.stroke}` : '0', paintOrder: 'stroke fill',
  };
  if (style.glow) css.textShadow = `0 0 ${style.glow[1] * px / 60}px ${style.glow[0]}`;
  else if (style.shadow) css.textShadow = `0 ${px / 18}px ${style.shadow[1] * px / 60}px ${style.shadow[0]}`;
  return css;
}

export const WORD_IDS = Object.keys(WORD_PRESETS).map(Number);
export const LINE_IDS = Object.keys(LINE_STYLES).map(Number);
