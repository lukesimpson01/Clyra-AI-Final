import type { TemplateManifest } from "./api";

/**
 * Clearly fictional, editorially generated store-preview text.
 * This is demonstration content, NOT ratings or testimonials left by people.
 * Never publish these records to an authenticated review endpoint or count
 * them as community feedback. Their mean must always be labelled a SAMPLE.
 */
export type SampleTemplateReview = {
  id: string;
  title: string;
  body: string;
  rating: 4 | 5;
  author: "Sample review";
  isSample: true;
};

const CUSTOM: Readonly<Record<string, readonly [string, string, string]>> = {
  excalidraw: [
    "The hand-drawn whiteboard style makes Excalidraw a distinctive source to explore for diagramming and rapid sketches.",
    "A flexible canvas and diagram-editor starting point. I'd review export, collaboration and drawing behaviour in the actual upstream app before using it.",
    "For brainstorming boards rather than polished design files, the Excalidraw source looks like a relevant direction to investigate.",
  ],
  appflowy: [
    "AppFlowy's docs, tasks and database concept is especially relevant to an all-in-one workspace.",
    "The mobile and desktop targets raise interesting sync and setup considerations; I'd test those before extending AppFlowy.",
    "A Notion-style workspace direction with more than just a document editor is what makes this entry worth exploring.",
  ],
  "open-webui": [
    "The model-chat, tools and file handling focus makes Open WebUI a natural source to compare with assistant interfaces.",
    "Model-provider configuration is an important part of this setup. I would not expect the full chat experience from a source checkout alone.",
    "A useful-looking foundation for experimenting with conversational interfaces and tool integrations, subject to the upstream dependencies.",
  ],
  n8n: [
    "Node-based automation is the reason I'd explore n8n for a workflow-builder concept.",
    "Connecting external services and hosting workflows are separate from downloading the editor code; both need planning.",
    "The visual graph approach provides a clear starting point for considering triggers, actions and branching.",
  ],
  penpot: [
    "Penpot's vector editor and design-system focus makes it an interesting source for design-tool exploration.",
    "I'd examine the full-stack deployment and workspace dependencies before assuming a standalone designer can run.",
    "A Figma-style direction where components and design systems matter as much as drawing tools.",
  ],
  "actual-budget": [
    "Local-first budgeting, transaction tracking and reporting are a focused direction for a finance app.",
    "Financial data storage and optional sync deserve careful consideration before working from this source.",
    "The project scope centres on a useful budgeting workflow rather than a generic finance dashboard.",
  ],
  chatwoot: [
    "The shared support inbox and ticket workflow are concrete features to investigate in Chatwoot.",
    "I'd verify server, data storage and integrations before adapting a customer-support system.",
    "A helpful reference direction for multi-channel conversations rather than a single chat widget.",
  ],
  chopify: [
    "AI clip selection, scoring and captions are the key aspects I'd explore for a shorts editor.",
    "The CLI and web workflow need a careful dependency check before treating this as an instant clipping app.",
    "An OpusClip-style direction that focuses on identifying and preparing short-form moments.",
  ],
  "bolt-diy": [
    "Prompt-to-app development with interactive previews is a strong concept to study in Bolt DIY.",
    "Provider accounts and WebContainer terms may affect the real setup even when the source repository is available.",
    "The code generation and preview loop is what I'd inspect when comparing AI app-builder workflows.",
  ],
  "browseros": [
    "Chromium-based browsing with agent automation is a compelling architecture to examine here.",
    "The native browser build is substantial; this is not a lightweight web component to Get and run immediately.",
    "Page context and browser-control features are the distinct pieces I'd investigate before attempting integration.",
  ],
  maplibre: [
    "MapLibre's vector rendering focus is useful when building a custom map UI.",
    "Rendering tiles is not the same as geocoding or routing; those require separate services and attribution.",
    "I'd examine map styles, interaction and performance rather than expect a complete Google Maps clone.",
  ],
  coolify: [
    "Self-hosted deployment and server management make Coolify an interesting infrastructure reference.",
    "Docker, networks and secrets are operational requirements—not something an import button can configure safely.",
    "The project deserves a serious environment review before using it to deploy real applications.",
  ],
  pocketbase: [
    "Database, auth, files and realtime events in a compact backend are the attractions of PocketBase.",
    "Even a single-binary backend requires secure migrations, access rules and deployment planning.",
    "A good category fit for prototyping backend-driven apps, while keeping production expectations realistic.",
  ],
  gitea: [
    "Repositories, pull requests and issue tracking make Gitea a distinct full Git-hosting reference.",
    "I'd check storage, authentication, permissions and admin maintenance before hosting anything important.",
    "The codebase represents a service, not a small component to drop into an editor.",
  ],
  jellyfin: [
    "A self-hosted library for personal films and music is the specific appeal of Jellyfin.",
    "Server setup and compatible clients are important; this isn't a streaming-catalogue replacement.",
    "The media-server direction looks useful for learning about libraries and authorised local playback.",
  ],
  remotion: [
    "Composing videos with React components is what makes Remotion distinctive.",
    "Rendering dependencies and licensing deserve a check before building a commercial export workflow.",
    "An interesting direction for programmable motion rather than a conventional timeline editor.",
  ],
  dify: [
    "Visual agent workflows and retrieval are the core concepts I'd investigate in Dify.",
    "Model accounts, persistent services and deployment setup affect the practical experience.",
    "A structured reference for creating AI pipelines rather than just another chat window.",
  ],
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
}

function defaultBodies(entry: TemplateManifest): [string, string, string] {
  const focus = clean(entry.description);
  const target = entry.supportedTargets.slice(0, 2).join(" / ") || "documented";
  const caution = clean(entry.warnings.find((w) => !/revision, dependency tree/i.test(w)) || entry.estimatedBuildFootprint || "Verify the upstream requirements before adopting this source");
  const comparison = entry.alternativeTo[0] || entry.category;
  return [
    "The " + focus.charAt(0).toLowerCase() + focus.slice(1) + " focus gives " + entry.name + " a clear purpose among " + entry.category.toLowerCase() + " projects. I'd investigate that workflow first.",
    "For " + entry.name + ", the setup deserves attention: " + caution + ". I'd confirm these requirements before building on this source.",
    "The " + target + " target makes " + entry.name + " worth comparing to " + comparison + ". I'd check which parts of its described " + entry.category.toLowerCase() + " workflow actually run at the pinned revision.",
  ];
}

function hash(id: string): number {
  let value = 0;
  for (const char of id) value = (value * 33 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** Every template receives three distinct example review passages and a 4–5 star sample distribution. */
export function sampleTemplateReviews(entry: TemplateManifest): SampleTemplateReview[] {
  const passages = CUSTOM[entry.id] ?? defaultBodies(entry);
  const seed = hash(entry.id);
  const countFours = seed % 4 === 1 ? 2 : 1;
  const ratings: Array<4 | 5> = [5, 5, 5];
  for (let i = 0; i < countFours; i++) ratings[(seed + i) % 3] = 4;
  const titles = [
    entry.name + " concept",
    "What to check before using " + entry.name,
    entry.category + " possibilities",
  ];
  return passages.map((body, i) => ({
    id: entry.id + "-sample-" + (i + 1),
    title: titles[i],
    body,
    rating: ratings[i],
    author: "Sample review" as const,
    isSample: true as const,
  }));
}

export function sampleTemplateRating(entry: TemplateManifest): {
  average: number;
  count: number;
  distribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
} {
  const reviews = sampleTemplateReviews(entry);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const review of reviews) distribution[review.rating]++;
  return { average: reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, count: reviews.length, distribution };
}
