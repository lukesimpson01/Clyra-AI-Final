/**
 * The Clyra Code source-library catalogue.
 *
 * A record is deliberately not a promise that its upstream application runs in
 * Clyra.  The curated inventory is a set of public starting points; a record
 * becomes verified only after the host resolves its exact revision and Clyra
 * inspects the checkout.  Keeping that distinction in the data model prevents
 * a card, a screenshot, or a comparison label from becoming a fake claim.
 */

import { LANDING_PAGE_SOURCES } from "./landing-pages";

export type TemplateMode = "full-app" | "framework" | "engine" | "integration" | "reference-only";
export type TemplateStatus = "unverified" | "runnable-now" | "requires-setup" | "integration-sdk" | "reference-only" | "unavailable";
export type TemplateImportMode = "clean-derived-project" | "integrate-existing-project" | "isolated-sandbox" | "dependency-source";

export type SourceScreenshot = {
  url: string;
  alt: string;
  capturedAt: string;
  provenance: string;
};

export type TemplateManifest = {
  id: string;
  name: string;
  alternativeTo: string[];
  description: string;
  category: string;
  /** Optional facet for the Landing Pages category, e.g. SaaS & AI or Restaurants. */
  landingPageType?: string;
  /** Public demo provided by the upstream author; opening it never installs scripts. */
  livePreviewUrl?: string;
  repositoryUrl: string;
  defaultBranch: string | null;
  pinnedCommit: string | null;
  licenseSpdxOrReview: string;
  attribution: string;
  mode: TemplateMode;
  stack: string[];
  supportedTargets: string[];
  requiresBackend: boolean;
  requiresNativeBuild: boolean;
  requiredSecrets: string[];
  estimatedBuildFootprint: string;
  buildCommands: string[];
  devCommand: string | null;
  testCommands: string[];
  port: number | null;
  healthcheck: string | null;
  capabilitiesVerified: string[];
  capabilitiesPlanned: string[];
  sourceScreenshots: SourceScreenshot[];
  captureProvenance: string | null;
  compatibility: string[];
  deployModes: string[];
  lastVerifiedAt: string | null;
  status: TemplateStatus;
  warnings: string[];
  templateAdapterVersion: string;
};

type Seed = readonly [
  id: string,
  name: string,
  alternatives: string,
  category: string,
  repository: string,
  description: string,
  mode: TemplateMode,
  targets: string,
  license: string,
  warning?: string,
];

/** The full curated inventory, kept for when the library is rebuilt. Not served for now. */
export const FULL_SEEDS: readonly Seed[] = [
  ["chopify", "Chopify", "OpusClip, Vizard", "Video & Shorts", "mehbul/chopify", "AI clip selection, scoring and captions.", "integration", "CLI, web", "MIT"],
  ["cutawan", "Cutawan", "OpusClip, Klap", "Video & Shorts", "JeremySNR/cutawan", "Podcast clipping and active-speaker reframing.", "reference-only", "desktop", "MIT", "Desktop workflow; do not present it as a browser import."],
  ["clipmint", "ClipMint", "OpusClip, Klap", "Video & Shorts", "kleZ799/clipmint", "Local shorts generation and captions.", "reference-only", "desktop, CLI", "MIT", "Native dependencies need inspection before use."],
  ["purffle-shorts", "PurffleShorts", "Crayo, OpusClip", "Video & Shorts", "Chamanrajragu/purffle-shorts", "Chat and Reddit story video pipeline.", "full-app", "web, Python", "MIT", "Requires a Python runtime and media tooling."],
  ["lossless-cut", "LosslessCut", "CapCut", "Video & Shorts", "mifi/lossless-cut", "Lossless cut, trim and media handling.", "reference-only", "desktop", "GPL-2.0", "Copyleft desktop reference; never merge into a proprietary web project automatically."],
  ["olive", "Olive", "Premiere Pro, CapCut", "Video & Shorts", "olive-editor/olive", "Timeline-based non-linear editing.", "reference-only", "desktop", "GPL-3.0", "Copyleft desktop reference; native build required."],
  ["openshot", "OpenShot", "CapCut, iMovie", "Video & Shorts", "OpenShot/openshot-qt", "Video editing with transitions and effects.", "reference-only", "desktop, Python", "License review", "Native desktop reference; license must be reviewed in its checkout."],
  ["kdenlive", "Kdenlive", "Premiere Pro, CapCut", "Video & Shorts", "KDE/kdenlive", "Multi-track video editing.", "reference-only", "desktop", "GPL-3.0", "Copyleft desktop reference; native build required."],
  ["remotion", "Remotion", "Creatomate, video SaaS", "Video & Shorts", "remotion-dev/remotion", "React video compositions and rendering.", "framework", "web, Node", "License review"],
  ["cal-ai", "Cal AI", "Cal AI", "Nutrition", "agentprojects/cal-ai", "Offline food-photo classification and nutrition data.", "full-app", "desktop, web", "MIT", "Food estimates need review; model and data provenance matter."],
  ["stable-diffusion-webui", "Stable Diffusion WebUI", "Midjourney, Leonardo AI", "AI Images", "AUTOMATIC1111/stable-diffusion-webui", "Stable Diffusion image-generation UI.", "full-app", "Python, web", "AGPL-3.0", "Copyleft service; GPU, model and deployment costs apply."],
  ["invoke-ai", "InvokeAI", "Midjourney, Leonardo AI", "AI Images", "invoke-ai/InvokeAI", "Image workflows and asset gallery.", "full-app", "Python, web", "Apache-2.0", "GPU and model requirements must be checked."],
  ["rembg", "rembg", "remove.bg", "AI Images", "danielgatis/rembg", "Local image background-removal library.", "integration", "Python", "MIT"],
  ["tldraw", "tldraw", "Miro, FigJam", "Design", "tldraw/tldraw", "Canvas SDK with shapes and collaboration foundations.", "integration", "web", "License review"],
  ["excalidraw", "Excalidraw", "Miro, FigJam", "Design", "excalidraw/excalidraw", "Infinite whiteboard and diagram editor.", "full-app", "web", "MIT"],
  ["penpot", "Penpot", "Figma", "Design", "penpot/penpot", "Vector and design-system editor.", "full-app", "web, backend", "MPL-2.0", "Full-stack deployment required."],
  ["grapesjs", "GrapesJS", "Webflow, Framer", "Design", "GrapesJS/grapesjs", "Drag-and-drop web-page editor SDK.", "framework", "web", "License review"],
  ["appflowy", "AppFlowy", "Notion", "Knowledge", "AppFlowy-IO/AppFlowy", "Docs, tasks, databases and workspace.", "reference-only", "desktop, mobile", "AGPL-3.0", "Copyleft multi-platform application."],
  ["affine", "AFFiNE", "Notion, Miro", "Knowledge", "toeverything/AFFiNE", "Connected documents and whiteboards.", "full-app", "web, desktop", "License review", "Full application; confirm upstream licensing before distribution."],
  ["logseq", "Logseq", "Obsidian, Notion", "Knowledge", "logseq/logseq", "Graph knowledge base and backlinks.", "reference-only", "desktop", "AGPL-3.0", "Copyleft multi-platform application."],
  ["outline", "Outline", "Notion, Confluence", "Knowledge", "outline/outline", "Collaborative knowledge base.", "full-app", "web, backend", "License review", "Requires services and credentials."],
  ["docmost", "Docmost", "Notion, Confluence", "Knowledge", "docmost/docmost", "Team wiki with realtime editing.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["plane", "Plane", "Linear, Jira", "Projects", "makeplane/plane", "Issue tracking, cycles and projects.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["wekan", "Wekan", "Trello", "Projects", "wekan/wekan", "Kanban boards and tasks.", "full-app", "web, backend", "MIT"],
  ["vikunja", "Vikunja", "Todoist", "Projects", "go-vikunja/vikunja", "Task management and recurring work.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["mattermost", "Mattermost", "Slack", "Messaging", "mattermost/mattermost", "Team channels, messages and integrations.", "full-app", "web, backend", "License review", "Requires server services and license review."],
  ["rocketchat", "Rocket.Chat", "Slack, Teams", "Messaging", "RocketChat/Rocket.Chat", "Channel messaging and realtime chat.", "full-app", "web, backend", "License review", "Requires server services and license review."],
  ["zulip", "Zulip", "Slack", "Messaging", "zulip/zulip", "Threaded chat and teams.", "full-app", "web, backend", "Apache-2.0"],
  ["cap", "Cap", "Loom", "Screen Capture", "CapSoftware/Cap", "Record, share and annotate screens.", "reference-only", "desktop, backend", "License review", "Desktop capture needs native permissions."],
  ["heyform", "HeyForm", "Typeform, Tally", "Forms", "heyform/heyform", "Conversational forms and submissions.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["formbricks", "Formbricks", "Typeform, Qualtrics", "Forms", "formbricks/formbricks", "Surveys, forms and feedback.", "full-app", "web, backend", "License review", "Requires service setup and license review."],
  ["nocodb", "NocoDB", "Airtable", "Databases", "nocodb/nocodb", "Spreadsheet-style database.", "full-app", "web, backend", "License review", "Requires database and license review."],
  ["baserow", "Baserow", "Airtable", "Databases", "baserow/baserow", "No-code database and app builder.", "full-app", "web, backend", "License review", "Requires database and license review."],
  ["appsmith", "Appsmith", "Retool", "Internal Tools", "appsmithorg/appsmith", "Drag-and-drop internal dashboards.", "full-app", "web, backend", "Apache-2.0"],
  ["budibase", "Budibase", "Retool, Bubble", "Internal Tools", "Budibase/budibase", "Internal applications and automations.", "full-app", "web, backend", "License review", "Requires services and license review."],
  ["tooljet", "ToolJet", "Retool", "Internal Tools", "ToolJet/ToolJet", "Builder for connected admin tools.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["activepieces", "Activepieces", "Zapier, Make", "Automation", "activepieces/activepieces", "AI and integration workflows.", "full-app", "web, backend", "License review", "Requires services and license review."],
  ["n8n", "n8n", "Zapier, Make", "Automation", "n8n-io/n8n", "Node-based workflow automation.", "full-app", "web, backend", "Fair-code review", "Commercial and distribution terms need review."],
  ["windmill", "Windmill", "Zapier, Retool", "Automation", "windmill-labs/windmill", "Scripts, workflows and apps.", "full-app", "web, backend", "License review", "Requires services and license review."],
  ["open-webui", "Open WebUI", "ChatGPT", "AI Assistant", "open-webui/open-webui", "Chat interface with tools and files.", "full-app", "web, backend", "License review", "Model-provider configuration is required."],
  ["continue", "Continue", "Cursor, Codex", "Code Agents", "continuedev/continue", "Codebase-aware coding-agent extension and CLI.", "integration", "IDE, CLI", "Apache-2.0"],
  ["cline", "Cline", "Cursor, Codex", "Code Agents", "cline/cline", "Agentic code editing and command execution.", "integration", "IDE", "Apache-2.0", "Needs explicit command and provider approval."],
  ["medusa", "Medusa", "Shopify", "Commerce", "medusajs/medusa", "Commerce backend, carts and orders.", "full-app", "backend", "License review", "Backend service; pair with an original storefront."],
  ["saleor", "Saleor", "Shopify", "Commerce", "saleor/saleor", "Headless ecommerce storefront API.", "full-app", "backend", "BSD-3-Clause", "Backend service and database required."],
  ["lago", "Lago", "Stripe Billing, Chargebee", "Billing", "getlago/lago", "Subscriptions and usage metering.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; billing integration requires review."],
  ["chatwoot", "Chatwoot", "Intercom, Zendesk", "Support", "chatwoot/chatwoot", "Support inbox, chat and tickets.", "full-app", "web, backend", "License review", "Requires service setup and license review."],
  ["twenty", "Twenty", "HubSpot, Salesforce", "CRM", "twentyhq/twenty", "CRM objects and sales workspace.", "full-app", "web, backend", "License review", "Requires services and license review."],
  ["mautic", "Mautic", "HubSpot, Mailchimp", "Email Marketing", "mautic/mautic", "Marketing campaign automation.", "full-app", "web, backend", "License review", "Requires mail infrastructure and license review."],
  ["listmonk", "listmonk", "Mailchimp, ConvertKit", "Email Marketing", "knadh/listmonk", "Self-hosted mailing lists and campaigns.", "full-app", "backend", "AGPL-3.0", "Copyleft service; mail infrastructure required."],
  ["plunk", "Plunk", "Resend, Mailchimp", "Email Marketing", "useplunk/plunk", "Email platform, campaigns and API.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; mail infrastructure required."],
  ["plausible", "Plausible", "Google Analytics", "Analytics", "plausible/analytics", "Privacy-conscious web analytics.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and database required."],
  ["umami", "Umami", "Google Analytics, Fathom", "Analytics", "umami-software/umami", "Traffic and funnel event analytics.", "full-app", "web, backend", "MIT"],
  ["matomo", "Matomo", "Google Analytics", "Analytics", "matomo-org/matomo", "Web analytics and reports.", "full-app", "web, backend", "GPL-3.0", "Copyleft service; server and database required."],
  ["dub", "Dub", "Bitly", "Link Management", "dubinc/dub", "Short URLs and link attribution.", "full-app", "web, backend", "License review", "Requires services and license review."],
  ["linkstack", "LinkStack", "Linktree", "Creator Pages", "LinkStackOrg/LinkStack", "Profile mini-sites and link pages.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server required."],
  ["immich", "Immich", "Google Photos", "Photos", "immich-app/immich", "Photo and video backup and gallery.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; storage and background jobs required."],
  ["nextcloud", "Nextcloud", "Dropbox, Google Drive", "Storage", "nextcloud/server", "Files, sharing and collaboration.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and storage required."],
  ["jitsi", "Jitsi Meet", "Zoom, Meet", "Video Calls", "jitsi/jitsi-meet", "Video meeting room.", "full-app", "web, backend", "Apache-2.0", "Realtime media infrastructure required."],
  ["dify", "Dify", "CustomGPT, Botpress", "AI Workflows", "langgenius/dify", "RAG and agentic chatbot builder.", "full-app", "web, backend", "License review", "Model providers and services required."],
  ["langflow", "Langflow", "Flowise, Botpress", "AI Workflows", "langflow-ai/langflow", "Visual model and tool workflows.", "full-app", "web, Python", "MIT", "Python runtime and model-provider setup required."],
  ["whisper-cpp", "whisper.cpp", "WhisperFlow, Otter", "Speech", "ggml-org/whisper.cpp", "Local speech-recognition engine.", "engine", "native, CLI", "MIT", "Native compilation and model files required."],
  ["freecad", "FreeCAD", "Shapr3D, Fusion", "CAD", "FreeCAD/FreeCAD", "Parametric CAD modeler.", "reference-only", "desktop", "LGPL-2.1", "Native desktop reference; do not present as a web component."],
  ["maplibre", "MapLibre GL JS", "Google Maps, Mapbox", "Maps", "maplibre/maplibre-gl-js", "Web map rendering and vector tiles.", "framework", "web", "License review", "Tiles, geocoding and attribution remain separate concerns."],
  ["openstatus", "OpenStatus", "Better Stack, UptimeRobot", "Monitoring", "openstatusHQ/openstatus", "Uptime monitoring and public status pages.", "full-app", "web, backend", "AGPL-3.0", "Copyleft service; server and monitoring providers required."],
  ["money-printer-turbo", "MoneyPrinterTurbo", "Crayo, InVideo", "Video & Shorts", "harry0703/MoneyPrinterTurbo", "Prompt-to-faceless-shorts generation.", "full-app", "Python", "MIT", "Media and provider dependencies require inspection."],
  ["shortgpt", "ShortGPT", "Crayo, InVideo", "Video & Shorts", "RayVentura/ShortGPT", "Experimental short-form-video automation.", "framework", "Python", "MIT", "Experimental source; verify current maintenance before use."],
  ["novel", "Novel", "Notion AI", "Knowledge", "steven-tey/novel", "Rich-text editor and AI authoring.", "framework", "web", "Apache-2.0"],
  ["cal-diy", "Cal.com DIY", "Calendly", "Scheduling", "calcom/cal.diy", "Appointment booking and scheduling infrastructure.", "full-app", "web, backend", "MIT", "Requires services and calendar integrations."],
];

function split(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function stackFor(mode: TemplateMode, targets: string[]) {
  if (mode === "engine") return ["native source", ...targets];
  if (mode === "framework" || mode === "integration") return ["library / SDK", ...targets];
  return targets;
}

function seededStatus(mode: TemplateMode): TemplateStatus {
  if (mode === "reference-only") return "reference-only";
  if (mode === "framework" || mode === "engine" || mode === "integration") return "integration-sdk";
  return "unverified";
}

/** Model credentials belong to a project/provider, never to Clyra's host environment. */
const MODEL_PROVIDER_SEEDS = new Set(["librechat", "vercel-chatbot", "perplexica", "openhands", "bolt-diy", "supoclip", "opencluely", "openfilm"]);

function manifestFromSeed(seed: Seed): TemplateManifest {
  const [id, name, alternatives, category, repository, description, mode, rawTargets, license, warning] = seed;
  const supportedTargets = split(rawTargets);
  const needsServer = supportedTargets.some((target) => /backend|Python/i.test(target));
  const needsNative = supportedTargets.some((target) => /desktop|native|CLI/i.test(target));
  return {
    id,
    name,
    alternativeTo: split(alternatives),
    description,
    category,
    repositoryUrl: `https://github.com/${repository}`,
    defaultBranch: null,
    pinnedCommit: null,
    licenseSpdxOrReview: license,
    attribution: `Source repository: ${repository}. Clyra does not claim affiliation with ${name} or its comparison products.`,
    mode,
    stack: stackFor(mode, supportedTargets),
    supportedTargets,
    requiresBackend: needsServer,
    requiresNativeBuild: needsNative,
    // Exact env names must be confirmed against the imported checkout.
    requiredSecrets: MODEL_PROVIDER_SEEDS.has(id) ? ["Model provider credential (if AI features are enabled; verify upstream configuration)"] : [],
    estimatedBuildFootprint: "Not measured — inspect a pinned checkout before installing dependencies.",
    buildCommands: [],
    devCommand: null,
    testCommands: [],
    port: null,
    healthcheck: null,
    capabilitiesVerified: [],
    capabilitiesPlanned: [description],
    sourceScreenshots: [],
    captureProvenance: null,
    compatibility: [
      "Source is not copied into a project automatically.",
      "Clyra resolves the revision and scans manifest files before any install script can run.",
      "A human must review license obligations and compatibility before integration.",
    ],
    deployModes: needsServer ? ["Connected provider required", "Local sandbox"] : ["Static host after build verification", "Local sandbox"],
    lastVerifiedAt: null,
    status: seededStatus(mode),
    warnings: [
      "Repository revision, dependency tree and license file have not been verified in this Clyra installation.",
      ...(warning ? [warning] : []),
    ],
    templateAdapterVersion: "catalog-v1",
  };
}

/* The 40 starter templates, each a public GitHub repository verified to exist. Clone happens on "Get". */
const seeds: readonly Seed[] = [
  ["librechat", "LibreChat", "ChatGPT", "AI Chats & Agents", "danny-avila/LibreChat", "Multi-provider AI chat with agents, files and plugins.", "full-app", "TypeScript, Node, MongoDB", "MIT", "Needs MongoDB and your own model API keys."],
  ["vercel-chatbot", "Vercel AI Chatbot", "Claude", "AI Chats & Agents", "vercel/chatbot", "Next.js chat app built on the Vercel AI SDK.", "full-app", "TypeScript, Next.js, Postgres", "License review", "Needs a Postgres database and AI provider keys. Licence is not auto-detected; review it."],
  ["perplexica", "Perplexica", "Perplexity", "AI Chats & Agents", "ItzCrazyKns/Perplexica", "AI answer engine that searches the web and cites sources.", "full-app", "TypeScript, Next.js, SearxNG", "MIT", "Needs a SearxNG instance and a model provider. The repository has been renamed upstream (Vane)."],
  ["openhands", "OpenHands", "Codex, Cursor", "AI Chats & Agents", "OpenHands/OpenHands", "Autonomous software-development agent with a web UI.", "full-app", "TypeScript, Python, Docker", "MIT", "Needs Docker and a model API key; very large repository."],
  ["bolt-diy", "bolt.diy", "Lovable, Bolt", "AI Chats & Agents", "stackblitz-labs/bolt.diy", "Prompt, run, edit and deploy full-stack apps in the browser.", "full-app", "TypeScript, Remix, Node", "MIT", "Needs your own model provider keys."],
  ["code-server", "code-server", "VS Code", "Developer Tools", "coder/code-server", "VS Code running on a server, used from the browser.", "full-app", "TypeScript, Node", "MIT", "Needs a built VS Code toolchain; heavy to build locally."],
  ["gitea", "Gitea", "GitHub", "Developer Tools", "go-gitea/gitea", "Self-hosted Git service with issues and pull requests.", "full-app", "Go, Node", "MIT", "Needs Go and Node to build."],
  ["hoppscotch", "Hoppscotch", "Postman", "Developer Tools", "hoppscotch/hoppscotch", "Open-source API development and testing workspace.", "full-app", "TypeScript, Vue, Postgres", "MIT", "Self-hosting needs a Postgres database."],
  ["nocodb", "NocoDB", "Airtable", "Developer Tools", "nocodb/nocodb", "Turn any database into a spreadsheet interface.", "full-app", "TypeScript, Vue, Node", "License review", "Licence is custom / mixed — review before distributing. Very large repository."],
  ["uptime-kuma", "Uptime Kuma", "Uptime monitoring", "Developer Tools", "louislam/uptime-kuma", "Self-hosted uptime and status monitoring.", "full-app", "JavaScript, Vue, Node, SQLite", "MIT", "Runs with Node; no external services needed."],
  ["appflowy", "AppFlowy", "Notion", "Productivity & Collaboration", "AppFlowy-IO/AppFlowy", "Docs, databases and projects in one workspace.", "full-app", "Dart, Flutter, Rust", "AGPL-3.0", "AGPL licence. Needs Flutter and Rust toolchains."],
  ["plane", "Plane", "Linear", "Productivity & Collaboration", "makeplane/plane", "Issue tracking, cycles and project planning.", "full-app", "TypeScript, Next.js, Python, Postgres", "AGPL-3.0", "AGPL licence. Needs Postgres, Redis and Docker."],
  ["wekan", "WeKan", "Trello", "Productivity & Collaboration", "wekan/wekan", "Open-source kanban boards.", "full-app", "JavaScript, Meteor, MongoDB", "MIT", "Needs MongoDB and Meteor."],
  ["onlyoffice", "ONLYOFFICE Docs", "Google Docs, Office", "Productivity & Collaboration", "ONLYOFFICE/DocumentServer", "Online document, spreadsheet and presentation editors.", "full-app", "Shell, Docker", "AGPL-3.0", "AGPL licence. Distributed as a server image; the repository is mostly packaging."],
  ["cal-diy", "Cal.com", "Calendly", "Productivity & Collaboration", "calcom/cal.com", "Scheduling and booking infrastructure.", "full-app", "TypeScript, Next.js, Postgres", "MIT", "Needs Postgres and calendar integrations. The repository is now cal.diy upstream."],
  ["penpot", "Penpot", "Figma", "Design, Video & Creative", "penpot/penpot", "Open-source design and prototyping platform.", "full-app", "Clojure, ClojureScript, Postgres", "MPL-2.0", "MPL-2.0. Full-stack deployment (Docker) required."],
  ["hycanvas", "HyCanvas", "Canva", "Design, Video & Creative", "hyscaler/HyCanvas", "Browser-based graphic design editor.", "full-app", "TypeScript, React", "AGPL-3.0", "AGPL licence. A small project; confirm it runs before relying on it."],
  ["minipaint", "miniPaint", "Photoshop", "Design, Video & Creative", "viliusle/miniPaint", "Online image editor with layers and filters.", "full-app", "JavaScript", "License review", "Licence is not auto-detected; review it. Runs as a static site."],
  ["opencut", "OpenCut", "CapCut", "Design, Video & Creative", "OpenCut-app/OpenCut", "Browser video editor with a timeline.", "full-app", "TypeScript, Next.js", "MIT", "Needs Node and a database for accounts."],
  ["cap", "Cap", "Loom", "Design, Video & Creative", "CapSoftware/Cap", "Screen recording and sharing.", "full-app", "Rust, Tauri, TypeScript", "License review", "Mixed licence (AGPL and MIT parts) — review. Desktop capture needs native permissions."],
  ["medusa", "Medusa", "Shopify backend", "Business & SaaS", "medusajs/medusa", "Commerce modules and an admin for custom storefronts.", "full-app", "TypeScript, Node, Postgres", "License review", "Licence is not auto-detected; review it. Needs Postgres and Redis."],
  ["twenty", "Twenty CRM", "HubSpot, Salesforce", "Business & SaaS", "twentyhq/twenty", "Open-source CRM.", "full-app", "TypeScript, React, NestJS, Postgres", "License review", "Mixed licence (AGPL and commercial) — review. Needs Postgres and Redis. Very large repository."],
  ["chatwoot", "Chatwoot", "Intercom", "Business & SaaS", "chatwoot/chatwoot", "Customer messaging and support inbox.", "full-app", "Ruby, Rails, Vue, Postgres", "License review", "Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis."],
  ["invoiceninja", "Invoice Ninja", "Invoicing, accounting", "Business & SaaS", "invoiceninja/invoiceninja", "Invoices, quotes and payments.", "full-app", "PHP, Laravel, MySQL", "License review", "Source-available licence — review the terms. Needs PHP and MySQL."],
  ["formbricks", "Formbricks", "Typeform", "Business & SaaS", "formbricks/formbricks", "Surveys and in-product feedback.", "full-app", "TypeScript, Next.js, Postgres", "License review", "Mixed licence (AGPL plus enterprise parts) — review. Needs Postgres."],
  ["stoat", "Stoat", "Discord", "Social & Entertainment", "stoatchat/stoatchat", "Open-source chat platform (formerly Revolt).", "full-app", "Rust, MongoDB", "License review", "Licence is not auto-detected; review it. Needs MongoDB and Redis."],
  ["pixelfed", "Pixelfed", "Instagram", "Social & Entertainment", "pixelfed/pixelfed", "Federated photo sharing.", "full-app", "PHP, Laravel, MySQL", "AGPL-3.0", "AGPL licence. Needs PHP, a database and Redis."],
  ["peertube", "PeerTube", "YouTube", "Social & Entertainment", "Chocobozzz/PeerTube", "Federated video hosting and streaming.", "full-app", "TypeScript, Node, Postgres, FFmpeg", "AGPL-3.0", "AGPL licence. Needs Postgres, Redis and FFmpeg."],
  ["mastodon", "Mastodon", "Twitter / X", "Social & Entertainment", "mastodon/mastodon", "Federated social network.", "full-app", "Ruby, Rails, Postgres", "AGPL-3.0", "AGPL licence. Needs Postgres, Redis and Ruby."],
  ["navidrome", "Navidrome", "Spotify", "Social & Entertainment", "navidrome/navidrome", "Self-hosted music streaming server.", "full-app", "Go, React", "GPL-3.0", "GPL-3.0 licence. Needs Go and Node to build, and a music library."],
  ["saas-starter", "Next.js SaaS Starter", "SaaS website", "Websites & Publishing", "nextjs/saas-starter", "Landing page, pricing, auth and a dashboard.", "full-app", "TypeScript, Next.js, Postgres", "MIT", "Needs Postgres and Stripe keys for payments."],
  ["astrofy", "Astrofy", "Portfolio website", "Websites & Publishing", "manuelernestog/astrofy", "Portfolio and blog template.", "full-app", "Astro, Tailwind", "MIT", "Static site; no external services."],
  ["medusa-dtc", "Medusa DTC Starter", "Ecommerce storefront", "Websites & Publishing", "medusajs/dtc-starter", "Next.js storefront for a Medusa backend.", "full-app", "TypeScript, Next.js", "MIT", "Needs a running Medusa backend."],
  ["ghost", "Ghost", "Blog and newsletter", "Websites & Publishing", "TryGhost/Ghost", "Publishing platform with memberships and newsletters.", "full-app", "TypeScript, Node, MySQL", "MIT", "Needs Node and MySQL; email needs a provider."],
  ["docusaurus", "Docusaurus", "Documentation website", "Websites & Publishing", "facebook/docusaurus", "Documentation site generator.", "full-app", "TypeScript, React", "MIT", "Cloning gives the framework monorepo, not a starter site; very large."],
  ["activepieces", "Activepieces", "Zapier", "Automation & Data", "activepieces/activepieces", "Workflow automation with AI and integrations.", "full-app", "TypeScript, Angular, NestJS, Postgres", "License review", "Mixed licence (MIT plus enterprise parts) — review. Needs Postgres and Redis."],
  ["umami", "Umami", "Google Analytics", "Automation & Data", "umami-software/umami", "Privacy-focused web analytics.", "full-app", "TypeScript, Next.js, Postgres", "MIT", "Needs Postgres."],
  ["actual", "Actual Budget", "Personal finance", "Automation & Data", "actualbudget/actual", "Local-first personal finance manager.", "full-app", "TypeScript, Node", "MIT", "Runs with Node; no external services."],
  ["metabase", "Metabase", "Business intelligence", "Automation & Data", "metabase/metabase", "Dashboards and analytics on your databases.", "full-app", "Clojure, TypeScript", "License review", "Mixed licence (AGPL plus commercial) — review. Needs a JDK; very large repository."],
  ["excalidraw", "Excalidraw", "Miro", "Automation & Data", "excalidraw/excalidraw", "Virtual whiteboard for sketching diagrams.", "full-app", "TypeScript, React", "MIT", "Runs with Node; no external services."],
  // Distinct source-only additions; do not confuse a source checkout with a verified runnable app.
  ["facilmap", "FacilMap", "Google Maps, My Maps", "Maps & Navigation", "FacilMap/facilmap", "Collaborative maps with routes, places and markers.", "full-app", "web, backend", "AGPL-3.0", "Separate full-stack map app; requires hosting and OSM data/services."],
  ["photon-selfhost", "Photon", "Google Maps Places, address search", "Maps & Navigation", "komoot/photon", "Self-hostable OSM address search and autocomplete service.", "engine", "Java, backend", "Apache-2.0", "Requires a Photon server and populated OSM search index; the public Photon service is not an unlimited commercial backend."],
  ["valhalla-router", "Valhalla", "Google Maps Directions", "Maps & Navigation", "valhalla/valhalla", "OpenStreetMap routing and turn-by-turn directions engine.", "engine", "C++, backend", "License review", "Self-hosting requires routing tiles built from OSM extracts and substantial setup; not a free hosted routing endpoint."],
  ["supoclip", "SupoClip", "OpusClip, Klap", "Design, Video & Creative", "FujiwaraChoki/supoclip", "AI video highlights, subtitle generation and clip editing.", "reference-only", "web, Python", "AGPL-3.0", "Reference alternative to Clyra's existing clipper; separate AI and media-service configuration required. Review copyleft terms."],
  ["browseros", "BrowserOS", "Perplexity Comet, ChatGPT Atlas", "AI Chats & Agents", "browseros-ai/BrowserOS", "Chromium-based AI browser with page context and agent workflows.", "reference-only", "desktop, Chromium", "AGPL-3.0", "Large native browser build. Source reference only; do not treat as a drop-in embedded browser or a verified runnable template."],
  ["karakeep", "Karakeep", "Pocket, Raindrop, MyMind", "Productivity & Collaboration", "karakeep-app/karakeep", "Saved pages, bookmarks, full-text search and AI-assisted tagging.", "full-app", "web, backend", "AGPL-3.0", "Requires deployment and optional AI service; review licences before commercial redistribution."],
  ["coolify", "Coolify", "Vercel, Heroku, Railway", "Developer Tools", "coollabsio/coolify", "Self-hosted deployments, applications, databases and servers.", "full-app", "web, backend, Docker", "Apache-2.0", "Infrastructure admin application; must not run privileged install scripts on import. Needs Docker/server access."],
  ["appwrite", "Appwrite", "Firebase, Supabase", "Developer Tools", "appwrite/appwrite", "Self-hosted authentication, databases, storage, functions and realtime APIs.", "full-app", "PHP, Docker, backend", "BSD-3-Clause", "Full-stack backend; Docker and several services required. Clone for review only until a real deployment is verified."],
  ["jellyfin", "Jellyfin", "Plex", "Social & Entertainment", "jellyfin/jellyfin", "Self-hosted personal movie and music streaming library.", "full-app", "backend, .NET", "GPL-2.0", "Requires own media library, server and clients; review permissions and upstream copyleft notices."],
  ["libretranslate", "LibreTranslate", "Google Translate, DeepL", "Automation & Data", "LibreTranslate/LibreTranslate", "Self-hosted language translation API and web UI.", "full-app", "Python, backend", "AGPL-3.0", "Local language models require downloads and resources; public hosted endpoints may require credentials or impose limits."],
  // Featured source projects: validated upstream GitHub repos; not claimed as runnable apps.
  ["opencluely", "OpenCluely", "Cluely", "AI Chats & Agents", "TechyCSR/OpenCluely", "Open-source desktop screen-context assistant with an overlay and optional model integration.", "reference-only", "desktop, Electron, React", "Apache-2.0", "Native desktop build and external AI provider setup required. Check platform and assessment rules; source checkout is not a runnable in-app template."],
  ["openfilm", "OpenFilm", "Adobe Premiere Pro, After Effects", "Design, Video & Creative", "openfilm/openfilm", "AI-assisted video authoring and timeline editing with OpenFilm Studio.", "full-app", "TypeScript, Node, pnpm, FFmpeg, desktop", "MIT", "Clyra Editor separately integrates OpenFilm; this is an independent source checkout. Requires Node 22, pnpm, FFmpeg and browser runtime. Optional generated media services require separate credentials."],
  ["svgedit", "SVGEdit", "Adobe Illustrator", "Design, Video & Creative", "SVG-Edit/svgedit", "Browser-based SVG vector drawing and illustration editor.", "full-app", "JavaScript, browser, npm", "MIT", "SVG-first vector editor, not a full Illustrator clone. Requires source build and browser verification."],
  ["kdenlive", "Kdenlive", "Adobe Premiere Pro", "Design, Video & Creative", "KDE/kdenlive", "Native multitrack video editor with effects and transitions.", "reference-only", "desktop, C++, Qt", "GPL-3.0", "Large native desktop application. Copyleft GPL-3.0; do not automatically bundle with proprietary Clyra or present as a browser template."],
  ["natron", "Natron", "Adobe After Effects, Nuke", "Design, Video & Creative", "NatronGitHub/Natron", "Node-based VFX compositor for shots and motion-graphics workflows.", "reference-only", "desktop, C++, Qt", "GPL-2.0", "Native desktop compositor, not a complete After Effects clone. Build requirements and copyleft GPL terms must be reviewed."],
  ["krita", "Krita", "Adobe Photoshop, Procreate", "Design, Video & Creative", "KDE/krita", "Desktop digital painting and illustration studio with layers and brushes.", "reference-only", "desktop, C++, Qt", "GPL-3.0", "Native desktop illustration app rather than a drop-in Photoshop or browser editor. Requires extensive build tooling; GPL licence review required."],
  // Individually cloneable, framework-free landing pages from the MIT-stated uiuxlabz collection.
  // Images are author-provided screenshots, not evidence of local build or runtime verification.
  ...LANDING_PAGE_SOURCES.map((item) => [
    item.id, item.title, "", "Landing Pages", item.repository,
    item.description, "full-app", "HTML, CSS, JavaScript",
    "MIT (README)", "The upstream README states MIT, but third-party photographs, fonts, logos and commercial redistribution must be reviewed independently.",
  ] as const),

];

/* Real captures, taken by cloning, installing and running each app locally (see provenance). Only apps that were actually run have any. */
const CAPTURED: Record<string, Array<[file: string, alt: string]>> = {
  astrofy: [["astrofy-1.jpg", "Astrofy home page"], ["astrofy-2.jpg", "Astrofy project list"], ["astrofy-3.jpg", "Astrofy blog"]],
  minipaint: [["minipaint-1.jpg", "miniPaint editor with tools, layers and colour panels"]],
  "uptime-kuma": [["uptime-kuma-1.jpg", "Uptime Kuma first-run setup (database choice)"]],
};

function withCaptures(manifest: TemplateManifest): TemplateManifest {
  const landing = LANDING_PAGE_SOURCES.find((item) => item.id === manifest.id);
  if (landing) {
    return {
      ...manifest,
      landingPageType: landing.kind,
      livePreviewUrl: landing.previewUrl,
      // screenshot.png lives in this template's own upstream GitHub repo.
      // Images were downloaded, decoded and resized by the separate capture
      // workflow, and are stored locally. Clyra did not execute this source.
      sourceScreenshots: [{
        url: `/library-shots/${landing.id}.jpg`,
        alt: `${landing.title} — actual upstream homepage screenshot`,
        capturedAt: "2026-11-11",
        provenance: `Author-provided screenshot.png from ${landing.repository}; downloaded and resized on 2026-11-11. Not a Clyra local build or runtime test.`,
      }],
      captureProvenance: `Preview supplied in ${landing.repository}; locally optimised from upstream screenshot.png, not a screenshot of a Clyra execution.`,
    };
  }
  const shots = CAPTURED[manifest.id];
  if (!shots) return manifest;
  const capturedAt = "2026-11-10";
  return {
    ...manifest,
    sourceScreenshots: shots.map(([file, alt]) => ({ url: `/library-shots/${file}`, alt, capturedAt, provenance: "Captured by Clyra from a local run of the unmodified upstream source." })),
    captureProvenance: "Captured from a local run of the upstream source on 2026-11-10.",
  };
}

export const TEMPLATE_LIBRARY: readonly TemplateManifest[] = Object.freeze(seeds.map(manifestFromSeed).map(withCaptures));

export function getTemplateManifest(id: string): TemplateManifest | null {
  return TEMPLATE_LIBRARY.find((entry) => entry.id === id) ?? null;
}

export type TemplateSearch = {
  query?: string;
  category?: string;
  status?: TemplateStatus;
  mode?: TemplateMode;
};

export function searchTemplateLibrary(search: TemplateSearch = {}): TemplateManifest[] {
  const query = search.query?.trim().toLocaleLowerCase() ?? "";
  return TEMPLATE_LIBRARY.filter((entry) => {
    if (search.category && entry.category !== search.category) return false;
    if (search.status && entry.status !== search.status) return false;
    if (search.mode && entry.mode !== search.mode) return false;
    if (!query) return true;
    return [entry.name, entry.category, entry.description, ...entry.alternativeTo, ...entry.stack]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query);
  });
}

export function templateLibraryCategories(): string[] {
  return [...new Set(TEMPLATE_LIBRARY.map((entry) => entry.category))].sort((a, b) => a.localeCompare(b));
}

export function isTemplateImportMode(value: unknown): value is TemplateImportMode {
  return value === "clean-derived-project" || value === "integrate-existing-project" || value === "isolated-sandbox" || value === "dependency-source";
}
