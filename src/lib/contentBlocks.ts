import type { ResearchImage } from "../../lib/chat-agent/rich-search";
import type { AgentStepView } from "./chatAgentClient";

/**
 * An answer as an ordered list of blocks. The agent writes plain text and, where a picture belongs, one directive on its own
 * line; the renderer shows each block exactly where it was written instead of appending every image after the answer.
 *
 *   [[image: id]]                              one image, under the paragraph that introduces its subject
 *   [[carousel: id, id, id]]                   several pictures of one subject, scrolling sideways
 *   [[grid: id, id, id]]                       2–4 pictures compared or collected
 *   [[image_text: id | Title | description]]   a small picture beside a product, person or place
 *
 * Ids are the ones image_search returned. Unknown ids are skipped and a picture is never shown twice.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; image: ResearchImage }
  | { type: "image_grid"; images: ResearchImage[] }
  | { type: "carousel"; images: ResearchImage[] }
  | { type: "image_text"; image: ResearchImage; title: string; text: string };

const MARKDOWN_IMAGE = /^\s*!\[[^\]]*\]\(\s*(\S+?)(?:\s+"[^"]*")?\s*\)\s*$/;
const DIRECTIVE = /^\s*\[\[\s*(image_text|image|carousel|grid)\s*:\s*(.+?)\s*\]\]\s*$/i;

export function collectImages(steps: AgentStepView[] | undefined): ResearchImage[] {
  const seen = new Set<string>();
  const out: ResearchImage[] = [];
  for (const step of steps ?? []) {
    if (step.state !== "done") continue;
    for (const image of step.images ?? []) {
      const key = image.id || image.sourceUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(image);
    }
  }
  return out;
}

export function hasImageDirectives(content: string) {
  return /\[\[\s*(?:image_text|image|carousel|grid)\s*:/i.test(content);
}

export function parseContentBlocks(content: string, images: ResearchImage[], { streaming = false }: { streaming?: boolean } = {}): ContentBlock[] {
  if (!images.length) return [{ type: "text", text: stripDirectives(content, streaming) }];
  const byId = new Map(images.map((image) => [image.id, image]));
  // a picture the model wrote as plain markdown still belongs in place: match it to the run's real images by address
  const byUrl = new Map<string, ResearchImage>();
  for (const image of images) for (const url of [image.imageUrl, image.thumbnailUrl]) { byUrl.set(url, image); byUrl.set(url.split("?")[0], image); }
  const used = new Set<string>();
  const take = (id: string) => {
    const image = byId.get(id.trim());
    if (!image || used.has(image.id)) return null;
    used.add(image.id);
    return image;
  };
  const blocks: ContentBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) blocks.push({ type: "text", text });
    buffer = [];
  };
  const lines = content.split("\n");
  let placed = 0;
  lines.forEach((line, index) => {
    const markdown = line.match(MARKDOWN_IMAGE);
    if (markdown) {
      const image = byUrl.get(markdown[1]) ?? byUrl.get(markdown[1].split("?")[0]);
      if (image && !used.has(image.id)) { used.add(image.id); flush(); blocks.push({ type: "image", image }); placed += 1; return; }
    }
    const match = line.match(DIRECTIVE);
    if (!match) {
      // a directive still being written must not flash on screen
      if (streaming && index === lines.length - 1 && /^\s*\[\[/.test(line) && !/\]\]\s*$/.test(line)) return;
      buffer.push(line);
      return;
    }
    const kind = match[1].toLowerCase();
    const body = match[2];
    if (kind === "image") {
      const image = take(body);
      if (image) { flush(); blocks.push({ type: "image", image }); placed += 1; }
    } else if (kind === "carousel" || kind === "grid") {
      const list = body.split(",").map(take).filter((image): image is ResearchImage => Boolean(image));
      if (list.length) {
        flush();
        blocks.push(list.length === 1 ? { type: "image", image: list[0] } : kind === "carousel" ? { type: "carousel", images: list } : { type: "image_grid", images: list.slice(0, 4) });
        placed += 1;
      }
    } else {
      const [id, title = "", text = ""] = body.split("|").map((part) => part.trim());
      const image = take(id);
      if (image) { flush(); blocks.push({ type: "image_text", image, title: title || image.title, text }); placed += 1; }
    }
  });
  flush();
  if (placed === 0 && !streaming) return withFallback(blocks, images);
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

/** The model wrote no placement: show the pictures right after the introduction, never at the very end. */
function withFallback(blocks: ContentBlock[], images: ResearchImage[]): ContentBlock[] {
  const first = blocks.findIndex((block) => block.type === "text");
  if (first < 0) return blocks;
  const text = (blocks[first] as { type: "text"; text: string }).text;
  // the introduction: everything up to the first blank line, skipping a lone heading
  const paragraphs = text.split(/\n{2,}/);
  let cut = 1;
  if (/^#{1,4}\s/.test(paragraphs[0]) && paragraphs.length > 1) cut = 2;
  const head = paragraphs.slice(0, cut).join("\n\n");
  const tail = paragraphs.slice(cut).join("\n\n");
  const pick = images.slice(0, 6);
  const visual: ContentBlock = pick.length === 1 ? { type: "image", image: pick[0] } : pick.length === 2 ? { type: "image_grid", images: pick } : { type: "carousel", images: pick };
  const out: ContentBlock[] = [...blocks.slice(0, first), { type: "text", text: head }, visual];
  if (tail.trim()) out.push({ type: "text", text: tail });
  out.push(...blocks.slice(first + 1));
  return out;
}

function stripDirectives(content: string, streaming: boolean) {
  const lines = content.split("\n").filter((line, index, all) => {
    if (DIRECTIVE.test(line)) return false;
    return !(streaming && index === all.length - 1 && /^\s*\[\[/.test(line) && !/\]\]\s*$/.test(line));
  });
  return lines.join("\n");
}
