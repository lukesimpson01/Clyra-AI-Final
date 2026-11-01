/* The advanced editor's 24 bundled fonts (frame/font-library.js), loaded from the same files the editor ships, so a
   caption previewed here is drawn in the font the clipper burns in (clipper-pipeline.py passes that folder to libass). */
import { FONT_CHOICES } from '../../openfilm/packages/openfilm/studio/ui/src/frame/font-library.js';

const files = import.meta.glob('../../openfilm/packages/openfilm/studio/ui/public/assets/fonts/*.ttf', { query: '?url', import: 'default', eager: true });
const urlOf = (id) => Object.entries(files).find(([path]) => path.endsWith(`/${id}.ttf`))?.[1];
const loaded = new Map();

export const CAPTION_FONTS = FONT_CHOICES;

/** Make `name` drawable in the page (once); resolves when it is, or quietly when it cannot be. */
export function loadCaptionFont(name) {
  const font = FONT_CHOICES.find((f) => f.name === name), url = font && urlOf(font.id);
  if (!url) return Promise.resolve();
  if (!loaded.has(name)) loaded.set(name, new FontFace(name, `url("${url}")`, { weight: '100 900' }).load().then((face) => { document.fonts.add(face); }).catch(() => { loaded.delete(name); }));
  return loaded.get(name);
}
