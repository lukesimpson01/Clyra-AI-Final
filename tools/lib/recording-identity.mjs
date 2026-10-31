// Source identity deliberately retains punctuation, digits and repeated letters.
// Search ranking may propose a page, but it must never authorize a download.
import {exactSoundName} from '../../apps/shorts/openfilm/packages/openfilm/src/recording-identity.mjs';
export {exactSoundName};
export function decodeHtml(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(Number(entity[1].toLowerCase() === 'x' ? '0x' + entity.slice(2) : entity.slice(1)));
    return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[entity.toLowerCase()] ?? all;
  });
}
const plain = (html) => decodeHtml(html.replace(/<[^>]*>/g, '')).trim();
export function soundPageIdentity(html, pageUrl) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const title = heading ? plain(heading[1]) : plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/ - Instant Sound Effect Button \| Myinstants$/i, '');
  const host=new URL(pageUrl).hostname;
  const media = host==='freesound.org'?html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^\s"<>]+-hq\.mp3/i)?.[0]:html.match(/["'](\/media\/sounds\/[^"']+\.mp3)["']/i)?.[1];
  if (!title || !media) throw new Error('The source must expose its exact title and downloadable MP3.');
  return { title, pageUrl, mediaUrl: new URL(decodeHtml(media), pageUrl).href };
}
export function soundCandidates(html) {
  const found = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["'](\/en\/instant\/[^"?#]+\/)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = plain(match[2]);
    if (title) found.set(match[1], {title, pageUrl:new URL(match[1], 'https://www.myinstants.com').href});
  }
  return [...found.values()];
}
export function requireSoundIdentity(entry, identity) {
  if (exactSoundName(identity.title) !== exactSoundName(entry.name)) throw new Error(`Exact title mismatch: ${JSON.stringify(entry.name)} vs ${JSON.stringify(identity.title)}`);
  if (entry.sourceUrl && identity.pageUrl !== entry.sourceUrl) throw new Error(`Pinned source page changed for ${entry.id}`);
  if (entry.mediaUrl && identity.mediaUrl !== entry.mediaUrl) throw new Error(`Pinned audio URL changed for ${entry.id}`);
}
