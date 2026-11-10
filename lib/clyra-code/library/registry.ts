/**
 * The Clyra Code source-library catalogue.
 *
 * A record is deliberately not a promise that its upstream application runs in
 * Clyra.  The curated inventory is a set of public starting points; a record
 * becomes verified only after the host resolves its exact revision and Clyra
 * inspects the checkout.  Keeping that distinction in the data model prevents
 * a card, a screenshot, or a comparison label from becoming a fake claim.
 */

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
  /** The project's own app icon, copied into /library-icons; null falls back to the owner's avatar. */
  iconUrl: string | null;
  /** True when the app's headline features call an AI model API (the agent then asks which API to use). */
  aiPowered: boolean;
  /** Lower numbers appear first in the Featured section; null is not featured. */
  featuredRank: number | null;
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
    requiredSecrets: [],
    estimatedBuildFootprint: "Not measured — inspect a pinned checkout before installing dependencies.",
    buildCommands: [],
    devCommand: null,
    testCommands: [],
    port: null,
    healthcheck: null,
    capabilitiesVerified: [],
    capabilitiesPlanned: [description],
    sourceScreenshots: [],
    iconUrl: null,
    aiPowered: false,
    featuredRank: null,
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

/* The starter templates (40 original plus Adobe/Office alternatives and AI tools), each a public GitHub repository verified to exist. Clone happens on "Get". */
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
  ["stirling-pdf", "Stirling-PDF", "Adobe Acrobat", "Adobe alternatives", "Stirling-Tools/Stirling-PDF", "Web PDF toolkit: merge, compress, convert, sign, redact and OCR.", "full-app", "Java, React, Docker", "License review"],
  ["svgedit", "SVG-Edit", "Adobe Illustrator", "Adobe alternatives", "SVG-Edit/svgedit", "Vector graphics editor that runs in the browser.", "full-app", "JavaScript", "MIT"],
  ["filerobot-image-editor", "Filerobot Image Editor", "Adobe Photoshop, Lightroom", "Adobe alternatives", "scaleflex/filerobot-image-editor", "Embeddable image editor with crop, filters, annotations and resize.", "framework", "JavaScript, React", "MIT"],
  ["opencut-classic", "OpenCut Classic", "Adobe Premiere Pro, CapCut", "Adobe alternatives", "OpenCut-app/opencut-classic", "Original OpenCut browser video editor with a timeline.", "full-app", "TypeScript, Next.js", "MIT"],
  ["omniclip", "omniclip", "Adobe Premiere Pro", "Adobe alternatives", "omni-media/omniclip", "Open-source video editing web application.", "full-app", "TypeScript, Vite", "MIT"],
  ["photoprism", "PhotoPrism", "Adobe Lightroom", "Adobe alternatives", "photoprism/photoprism", "AI-assisted photo library with browsing, search and albums.", "full-app", "Go, Docker, MariaDB", "License review"],
  ["univer", "Univer", "Microsoft Word, Excel, PowerPoint", "Microsoft Office alternatives", "dream-num/univer", "Office SDK with document, spreadsheet and slide editors.", "framework", "TypeScript, React", "Apache-2.0"],
  ["pptist", "PPTist", "Microsoft PowerPoint", "Microsoft Office alternatives", "pipipi-pikachu/PPTist", "Online presentation editor that imitates PowerPoint.", "full-app", "TypeScript, Vue", "AGPL-3.0"],
  ["anything-llm", "AnythingLLM", "ChatGPT, Notion AI", "AI Tools", "Mintplex-Labs/anything-llm", "Private chat with documents, agents and any model provider.", "full-app", "JavaScript, Node, Docker", "MIT"],
  ["flowise", "Flowise", "Zapier AI, Botpress", "AI Tools", "FlowiseAI/Flowise", "Visual builder for AI agents and LLM flows.", "full-app", "TypeScript, Node, Docker", "License review"],
  ["langflow", "Langflow", "Flowise, Botpress", "AI Tools", "langflow-ai/langflow", "Visual builder and runtime for AI agents and workflows.", "full-app", "Python, React, Docker", "MIT"],
  ["openwhispr", "OpenWhispr", "Wispr Flow, Superwhisper", "AI Tools", "OpenWhispr/openwhispr", "Voice-to-text dictation with local Whisper or Parakeet models.", "reference-only", "Electron, TypeScript", "MIT", "Desktop app needing microphone access; not a browser import."],
  ["natively", "Natively", "Cluely", "AI Tools", "Natively-AI-assistant/natively-cluely-ai-assistant", "Open-source AI meeting assistant and interview copilot (Cluely alternative).", "reference-only", "Electron, TypeScript", "License review", "Desktop app using screen and audio capture; licence reported as unspecified by GitHub."],
  ["chopify", "Chopify", "OpusClip, Crayo", "AI Clippers", "mehbul/chopify", "Local long-video clipper with captions, branding and a browser dashboard.", "full-app", "Python, ffmpeg, faster-whisper", "MIT", "Fully local: needs Python 3.11+ and ffmpeg. The optional re-ranker uses a local Ollama server only."],
  ["ai-youtube-shorts-generator", "AI YouTube Shorts Generator", "OpusClip, Crayo", "AI Clippers", "Anil-matcha/AI-Youtube-Shorts-Generator", "LLM highlight detection and vertical cropping for Shorts.", "full-app", "Python, ffmpeg", "MIT", "API mode depends on the paid third-party MuAPI service; local mode needs an OpenAI or Gemini key for the LLM step."],
  ["funclip", "FunClip", "OpusClip", "AI Clippers", "modelscope/FunClip", "LLM-assisted video clipping with FunASR speech recognition.", "full-app", "Python, Gradio, FunASR", "MIT", "Speech-model weights are downloaded separately and carry their own licence terms; review them."],
  ["openclipper", "OpenClipper", "OpusClip", "AI Clippers", "GrepCut/OpenClipper", "Windows desktop app that turns long videos into short clips.", "full-app", "Rust, Tauri, TypeScript", "MIT", "Windows-only Tauri 2 desktop app with a static FFmpeg build; not a browser import."],
  ["dyad", "Dyad", "Lovable, Bolt, Replit", "AI App Builders", "dyad-sh/dyad", "Local-first AI app builder as a desktop app.", "full-app", "TypeScript, Electron", "License review", "Apache-2.0 outside src/pro/. The src/pro/ folder is Functional Source License (FSL-1.1-ALv2): do not reuse it."],
  ["onlook", "Onlook", "Lovable, Webflow", "AI App Builders", "onlook-dev/onlook", "Visual editor for React and Next.js apps with AI.", "full-app", "TypeScript, Next.js, Supabase", "Apache-2.0", "Depends on hosted services (CodeSandbox SDK, Freestyle sandboxes, Supabase, Stripe, PostHog); the sandbox and billing layers need replacing."],
  ["chatbot-ui-lite", "Chatbot UI Lite", "ChatGPT", "AI Chats & Agents", "mckaywrigley/chatbot-ui-lite", "Minimal OpenAI chat interface.", "full-app", "TypeScript, Next.js", "MIT", "Basic demo, last updated March 2023 on Next 13 and the OpenAI v3 SDK; not production-ready."],
  ["cline", "Cline", "Cursor, Claude Code", "AI Coding", "cline/cline", "Autonomous coding agent for the editor, CLI and SDK.", "integration", "TypeScript, VS Code", "Apache-2.0", "Includes cloud client code; review before bundling. Has a native DeepSeek provider."],
  ["aider", "Aider", "Cursor, Claude Code", "AI Coding", "Aider-AI/aider", "Terminal pair-programmer that edits a git repo.", "integration", "Python, CLI", "Apache-2.0", "Command-line tool; runs through LiteLLM, which supports DeepSeek."],
  ["continue", "Continue", "Cursor", "AI Coding", "continuedev/continue", "Open-source IDE assistant and CLI.", "integration", "TypeScript, VS Code, JetBrains", "Apache-2.0", "IDE extension; has a DeepSeek provider."],
  ["browser-use", "Browser Use", "Operator, Manus", "AI Agents & Automation", "browser-use/browser-use", "Python library that lets AI agents drive a browser.", "integration", "Python, Playwright", "MIT", "Library and CLI, not a hosted UI; the skills/cloud folder calls its paid cloud."],
  ["marktext", "MarkText", "Notion, Typora", "Notes, Docs & Presentations", "marktext/marktext", "Markdown editor desktop app.", "reference-only", "Electron, Vue", "MIT", "Electron desktop app; not a browser import."],
  ["docling", "Docling", "Document AI", "Notes, Docs & Presentations", "docling-project/docling", "Document parsing and conversion for AI pipelines.", "integration", "Python", "MIT", "Code is MIT but model weights and optional OCR engines carry their own licences; audit each."],
  ["markitdown", "MarkItDown", "Document conversion", "Notes, Docs & Presentations", "microsoft/markitdown", "Converts Office files, PDFs and more to Markdown.", "integration", "Python, CLI", "MIT", "Library and CLI; image description needs a vision-capable model."],
  ["slidev", "Slidev", "PowerPoint, Keynote", "Notes, Docs & Presentations", "slidevjs/slidev", "Presentation builder driven by Markdown and Vue.", "full-app", "TypeScript, Vue, Vite", "MIT", "Runs with Node; no external services."],
  ["monaco-editor", "Monaco Editor", "VS Code editor", "Developer Tools", "microsoft/monaco-editor", "The code editor that powers VS Code, for the browser.", "framework", "TypeScript, JavaScript", "MIT", "Component library; ship ThirdPartyNotices.txt with any distribution."],
  ["yt-dlp", "yt-dlp", "Video downloader", "Design, Video & Creative", "yt-dlp/yt-dlp", "Command-line downloader for video and audio from many sites.", "integration", "Python, CLI", "Unlicense", "Public domain, but bundled executables include other licences. Only use with rights-cleared or user-supplied sources."],
  ["openfilm", "OpenFilm", "Remotion, CapCut", "Design, Video & Creative", "openfilm/openfilm", "AI video agent: your coding agent writes a film as web pages and Studio edits it in the browser.", "full-app", "TypeScript, Node, ffmpeg", "MIT", "Needs Node 22.2+ and ffmpeg; the first run downloads a headless Chromium (about 100 MB). The code is MIT; the OpenFilm name and logo are trademarks (see TRADEMARK.md)."],
  ["photocraft", "PhotoCraft", "Adobe Photoshop", "Adobe alternatives", "storytold/photocraft", "Photo editor with layers, PSD support and a GPU compositor, written in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["vectorcraft", "VectorCraft", "Adobe Illustrator", "Adobe alternatives", "storytold/vectorcraft", "Vector art tool written from scratch in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["filmcraft", "FilmCraft", "Adobe Premiere Pro", "Adobe alternatives", "storytold/filmcraft", "Nonlinear video editor written from scratch in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["lightcraft", "LightCraft", "Adobe Lightroom", "Adobe alternatives", "storytold/lightcraft", "Non-destructive photo editor written from scratch in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["pdfcraft", "PdfCraft", "Adobe Acrobat", "Adobe alternatives", "storytold/pdfcraft", "PDF reader and editor written from scratch in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["wordcraft", "WordCraft", "Microsoft Word", "Microsoft Office alternatives", "storytold/wordcraft", "Clean-room word processor in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["gridcraft", "GridCraft", "Microsoft Excel", "Microsoft Office alternatives", "storytold/gridcraft", "Clean-room spreadsheet in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
  ["deckcraft", "DeckCraft", "Microsoft PowerPoint", "Microsoft Office alternatives", "storytold/deckcraft", "Clean-room presentation app in Rust.", "full-app", "Rust, WebAssembly, desktop", "MIT OR Apache-2.0", "Pure-Rust workspace with desktop (egui, wgpu) and WebAssembly builds. Not launch-tested in this pass: the sandbox blocked building cloned code, so there are no screenshots yet. Installers are attached to GitHub releases."],
];

/* Real captures, taken by cloning, installing and running each app locally (see provenance). Only apps that were actually run have any. */
const CAPTURED: Record<string, Array<[file: string, alt: string]>> = {
  activepieces: [["activepieces-1.jpg", "Activepieces project dashboard listing a flow"], ["activepieces-2.jpg", "Activepieces flow builder with an empty trigger step"], ["activepieces-3.jpg", "Activepieces trigger picker open on the canvas"]],
  actual: [["actual-1.jpg", "Actual Budget welcome screen"], ["actual-2.jpg", "Actual monthly budget with categories"], ["actual-3.jpg", "Actual account register with transactions"], ["actual-4.jpg", "Actual reports dashboard"]],
  astrofy: [["astrofy-1.jpg", "Astrofy home page"], ["astrofy-2.jpg", "Astrofy project list"], ["astrofy-3.jpg", "Astrofy blog"]],
  "bolt-diy": [["bolt-diy-1.jpg", "bolt.diy home with provider picker and prompt box"], ["bolt-diy-2.jpg", "bolt.diy with the chat history sidebar open"], ["bolt-diy-3.jpg", "bolt.diy control panel for providers and integrations"]],
  "code-server": [["code-server-1.jpg", "code-server password login"], ["code-server-2.jpg", "code-server editing a JavaScript file in the browser"], ["code-server-3.jpg", "code-server with the integrated terminal open"]],
  docusaurus: [["docusaurus-1.jpg", "Docusaurus monorepo website home page"], ["docusaurus-2.jpg", "Docusaurus documentation page with sidebar"], ["docusaurus-3.jpg", "Docusaurus blog index and post"]],
  excalidraw: [["excalidraw-1.jpg", "Excalidraw welcome screen"], ["excalidraw-2.jpg", "Excalidraw flowchart drawn with coloured shapes"], ["excalidraw-3.jpg", "Excalidraw flowchart in the dark theme"]],
  formbricks: [["formbricks-1.jpg", "Formbricks first-run welcome"], ["formbricks-2.jpg", "Formbricks project setup with live survey preview"], ["formbricks-3.jpg", "Formbricks survey template gallery"], ["formbricks-4.jpg", "Formbricks survey editor with preview"]],
  ghost: [["ghost-1.jpg", "Ghost publication front page"], ["ghost-2.jpg", "Ghost article page"], ["ghost-3.jpg", "Ghost admin analytics dashboard"], ["ghost-4.jpg", "Ghost admin post list"]],
  onlyoffice: [["onlyoffice-1.jpg", "ONLYOFFICE Text Editor mid-document with ribbon toolbar"], ["onlyoffice-2.jpg", "ONLYOFFICE Spreadsheet Editor with a sales report, charts and slicers"], ["onlyoffice-3.jpg", "ONLYOFFICE Presentation Editor with slide thumbnails"], ["onlyoffice-4.jpg", "ONLYOFFICE Docs example app home with create-new menu"]],
  langflow: [["langflow-2.jpg", "Langflow new-flow screen with model provider setup and starter templates"], ["langflow-1.jpg", "Langflow flows list in the Starter Project"], ["langflow-3.jpg", "Langflow settings with API keys, model providers and global variables"]],
  twenty: [["twenty-3.jpg", "Twenty opportunities pipeline as a kanban board by stage"], ["twenty-1.jpg", "Twenty companies table view"], ["twenty-2.jpg", "Twenty people table view"], ["twenty-4.jpg", "Twenty profile settings"]],
  gitea: [["gitea-1.jpg", "Gitea dashboard with activity feed"], ["gitea-2.jpg", "Gitea repository view with README"], ["gitea-3.jpg", "Gitea pull request diff"], ["gitea-4.jpg", "Gitea issue list"], ["gitea-5.jpg", "Gitea commit history"]],
  hoppscotch: [["hoppscotch-1.jpg", "Hoppscotch REST request builder"], ["hoppscotch-2.jpg", "Hoppscotch response with status and body"], ["hoppscotch-3.jpg", "Hoppscotch GraphQL client"], ["hoppscotch-4.jpg", "Hoppscotch realtime WebSocket client"]],
  hycanvas: [["hycanvas-1.jpg", "HyCanvas workspace home with design presets"], ["hycanvas-2.jpg", "HyCanvas template gallery"], ["hycanvas-3.jpg", "HyCanvas editor with a launch-card template"]],
  librechat: [["librechat-1.jpg", "LibreChat new chat screen"], ["librechat-2.jpg", "LibreChat model and provider picker"], ["librechat-3.jpg", "LibreChat agent builder panel"], ["librechat-4.jpg", "LibreChat settings dialog"]],
  metabase: [["metabase-2.jpg", "Metabase dashboard with KPI tiles and charts"], ["metabase-3.jpg", "Metabase saved question as a line chart"], ["metabase-1.jpg", "Metabase home after sign-in"], ["metabase-4.jpg", "Metabase browsing the sample database"]],
  minipaint: [["minipaint-1.jpg", "miniPaint canvas with brush strokes, tools and colour panel"], ["minipaint-2.jpg", "miniPaint Effects menu with filters"], ["minipaint-3.jpg", "miniPaint Image menu"]],
  navidrome: [["navidrome-1.jpg", "Navidrome album grid"], ["navidrome-2.jpg", "Navidrome album with track list"], ["navidrome-3.jpg", "Navidrome now-playing bar"], ["navidrome-4.jpg", "Navidrome song list"]],
  nocodb: [["nocodb-1.jpg", "NocoDB spreadsheet grid of deals"], ["nocodb-2.jpg", "NocoDB kanban view grouped by stage"], ["nocodb-3.jpg", "NocoDB gallery view"], ["nocodb-4.jpg", "NocoDB form view"]],
  openhands: [["openhands-4.jpg", "OpenHands workspace home with prompt and recommended automations"], ["openhands-1.jpg", "OpenHands onboarding: choose an agent"], ["openhands-2.jpg", "OpenHands onboarding: LLM settings"], ["openhands-3.jpg", "OpenHands onboarding: first message"]],
  penpot: [["penpot-1.jpg", "Penpot board with a mobile wireframe"], ["penpot-2.jpg", "Penpot design panel for a selected layer"], ["penpot-3.jpg", "Penpot prototype tab"], ["penpot-4.jpg", "Penpot inspect tab with measurements"]],
  perplexica: [["perplexica-4.jpg", "Perplexica (Vane) search home"], ["perplexica-2.jpg", "Perplexica add-connection dialog"], ["perplexica-3.jpg", "Perplexica model selection"]],
  "saas-starter": [["saas-starter-1.jpg", "SaaS Starter landing page"], ["saas-starter-2.jpg", "SaaS Starter team settings dashboard"], ["saas-starter-3.jpg", "SaaS Starter general settings"], ["saas-starter-4.jpg", "SaaS Starter activity log"]],
  umami: [["umami-1.jpg", "Umami overview with visitors, views and traffic chart"], ["umami-2.jpg", "Umami breakdown by page path"], ["umami-3.jpg", "Umami sessions list with browser and location"], ["umami-4.jpg", "Umami period comparison"]],
  "stirling-pdf": [["stirling-pdf-1.jpg", "Stirling-PDF home with the PDF tool list"], ["stirling-pdf-2.jpg", "Stirling-PDF library with two uploaded PDFs"], ["stirling-pdf-3.jpg", "Stirling-PDF compress tool with settings"]],
  "anything-llm": [["anything-llm-3.jpg", "AnythingLLM chat workspace with composer"], ["anything-llm-1.jpg", "AnythingLLM welcome screen"], ["anything-llm-2.jpg", "AnythingLLM provider choice during setup"], ["anything-llm-4.jpg", "AnythingLLM LLM provider settings"], ["anything-llm-5.jpg", "AnythingLLM vector database settings"]],
  flowise: [["flowise-3.jpg", "Flowise template canvas with a start node and an agent"], ["flowise-1.jpg", "Flowise chatflows home"], ["flowise-2.jpg", "Flowise marketplace of ready-made flows"], ["flowise-4.jpg", "Flowise tools"]],
  slidev: [["slidev-2.jpg", "Slidev slide with feature list"], ["slidev-1.jpg", "Slidev title slide"], ["slidev-3.jpg", "Slidev notes view"], ["slidev-4.jpg", "Slidev presenter view"]],
  "monaco-editor": [["monaco-editor-1.jpg", "Monaco Editor playground with code"], ["monaco-editor-2.jpg", "Monaco Editor site home"], ["monaco-editor-3.jpg", "Monaco Monarch tokenizer playground"]],
  "chatbot-ui-lite": [["chatbot-ui-lite-1.jpg", "Chatbot UI Lite single chat screen"], ["chatbot-ui-lite-2.jpg", "Chatbot UI Lite with a message typed in the composer"]],
  "uptime-kuma": [["uptime-kuma-1.jpg", "Uptime Kuma dashboard with monitors up and one down"], ["uptime-kuma-2.jpg", "Uptime Kuma monitor detail with response-time chart"], ["uptime-kuma-3.jpg", "Uptime Kuma monitor in the down state"], ["uptime-kuma-4.jpg", "Uptime Kuma add-monitor form"]],
  "vercel-chatbot": [["vercel-chatbot-1.jpg", "Vercel AI Chatbot empty chat with suggestions"], ["vercel-chatbot-2.jpg", "Vercel AI Chatbot model picker"], ["vercel-chatbot-3.jpg", "Vercel AI Chatbot register page"]],
  wekan: [["wekan-1.jpg", "WeKan kanban board with four lists"], ["wekan-2.jpg", "WeKan card detail panel"], ["wekan-3.jpg", "WeKan all-boards view"]],
};

/* Facts observed while launch-testing each app on 2026-11-10; they replace the generic unverified warnings. */
type Verified = {
  license?: string;
  status: TemplateStatus;
  port?: number;
  dev?: string;
  build?: string[];
  footprint?: string;
  secrets?: string[];
  commit?: string;
  verified: string[];
  notes: string[];
};
const VERIFIED: Record<string, Verified> = {
  activepieces: { license: "License review", status: "requires-setup", port: 8080, dev: "docker compose up -d", commit: "217384ba", footprint: "Docker: app + worker + Postgres(pgvector) + Redis; ~2 GB images.", verified: ["Starts and serves the UI", "Sign-up and project dashboard"], notes: ["MIT outside packages/ee and server/api/src/app/ee, which are commercial: review before distributing.", "The documented compose uses ghcr.io images; the sandbox blocks ghcr, so Docker Hub activepieces/activepieces was used.", "The server hard-codes IPv6 listen (::); on hosts without IPv6 it needs patching.", "Piece catalogue stays empty without access to the cloud piece registry, so no flow could be built offline."] },
  actual: { license: "MIT", status: "runnable-now", port: 3001, dev: "yarn start:browser", build: ["yarn install"], commit: "5ffb72a", footprint: "~1 GB node_modules; install ~80 s.", verified: ["Install", "Browser dev server", "Demo budget, accounts and reports"], notes: ["Needs Yarn 4 (corepack download may be blocked; install @yarnpkg/cli-dist from npm).", "Runs with Node 22; no external services."] },
  astrofy: { license: "MIT", status: "runnable-now", port: 4321, dev: "npm run dev", build: ["npm install"], commit: "9398dea", footprint: "npm install ~20 s.", verified: ["Install and dev server (re-checked)", "Home, projects and blog pages"], notes: ["Static site; no external services.", "Screenshots are from an earlier pass; this pass re-confirmed install and boot only."] },
  "bolt-diy": { license: "MIT", status: "requires-setup", port: 5173, dev: "pnpm exec react-router dev --host 127.0.0.1", build: ["pnpm install"], commit: "353b44c", secrets: ["A model provider API key"], footprint: "pnpm install ~12 s.", verified: ["Install", "Dev server and UI"], notes: ["README `pnpm run dev` binds IPv6 (`--host ::`) and fails on hosts without IPv6; use an IPv4 host.", "UI renders without a key; generating apps needs your own model provider key (not tested).", "Depends on @webcontainer/api (StackBlitz WebContainers), which has separate commercial terms for production use: replace it with your own sandbox.", "Has a native DeepSeek provider."] },
  "code-server": { license: "MIT", status: "requires-setup", port: 8080, dev: "docker run -p 8080:8080 -e PASSWORD=… codercom/code-server", commit: "fcd14dc", footprint: "Docker image ~0.7 GB.", verified: ["Official image runs", "Login, editor and terminal in the browser"], notes: ["Verified through the official Docker image, not a source build (the source build needs the VS Code toolchain).", "The install.sh script host is blocked in some environments."] },
  docusaurus: { license: "MIT", status: "requires-setup", port: 3000, dev: "pnpm --filter website start", build: ["pnpm install --frozen-lockfile"], commit: "c00f04e", footprint: "pnpm install ~45 s plus package builds.", verified: ["Install", "The monorepo's own documentation website"], notes: ["Cloning gives the framework monorepo, not a starter site; the screenshots show the monorepo's own website.", "Needs Node 24 or newer (RegExp.escape); Node 22 fails."] },
  excalidraw: { license: "MIT", status: "runnable-now", port: 3001, dev: "yarn start", build: ["yarn install"], commit: "701b901", footprint: "yarn install ~60 s.", verified: ["Install", "Dev server", "Drawing, fills, text and dark theme"], notes: ["`yarn start` opens a browser; on headless hosts set BROWSER=none.", "No external services."] },
  formbricks: { license: "License review", status: "requires-setup", port: 3000, dev: "docker run formbricks/formbricks (with Postgres + Valkey)", commit: "4d9a14f", secrets: ["NEXTAUTH_SECRET", "ENCRYPTION_KEY", "CRON_SECRET"], footprint: "Docker: app + pgvector Postgres + Valkey.", verified: ["Setup wizard", "Organisation and project", "Survey templates and editor"], notes: ["AGPLv3 outside apps/web/modules/ee and the SDK directories, which carry other licences: review before distributing.", "The repo compose and installer use ghcr.io images and Traefik with Let's Encrypt; Docker Hub formbricks/formbricks was used.", "Start-up migration needs outbound npm access; email needs SMTP (verification disabled for the test)."] },
  ghost: { license: "MIT", status: "requires-setup", port: 2368, dev: "docker run ghost", commit: "912930c", footprint: "Docker image ~0.5 GB.", verified: ["Official image runs on SQLite", "Site, posts and admin"], notes: ["Verified via the official Docker image.", "On hosts without IPv6 set server__host=0.0.0.0; staff device verification emails need a mail provider."] },
  gitea: { license: "MIT", status: "runnable-now", port: 3300, dev: "./gitea web", build: ["TAGS=\"bindata sqlite sqlite_unicode\" make build"], commit: "25c5b6a", footprint: "Build ~2.5 min; binary ~120 MB.", verified: ["Built from source", "SQLite install", "Repos, issues, pull requests"], notes: ["Needs a recent Go toolchain (downloaded automatically) and Node to build the frontend.", "Refuses to run as root unless GITEA_I_AM_BEING_UNSAFE_RUNNING_AS_ROOT=true."] },
  hoppscotch: { license: "MIT", status: "requires-setup", port: 3000, dev: "docker compose up -d (hoppscotch/hoppscotch AIO + Postgres)", commit: "55908a7", secrets: ["JWT_SECRET", "SESSION_SECRET", "DATA_ENCRYPTION_KEY"], footprint: "Docker: AIO image ~1.2 GB + Postgres.", verified: ["Official AIO image and Postgres run", "REST, GraphQL and realtime clients"], notes: ["Verified via the prebuilt image; the repo's own compose builds from source and was not run.", "The backend exits once on first boot and needs a restart policy.", "Sign-in needs SMTP or OAuth; the client works anonymously."] },
  hycanvas: { license: "AGPL-3.0", status: "requires-setup", port: 8005, dev: "docker compose up -d (docker/docker-compose.yml)", commit: "ba7b2c0", secrets: ["JWT_SECRET"], footprint: "Docker: app image + Postgres 16.", verified: ["Compose quickstart runs in ~20 s", "Sign-up, templates and editor"], notes: ["AGPL-3.0; COMMERCIAL.md describes a commercial alternative.", "Quickstart uses the prebuilt hycanvas/hycanvas image."] },
  librechat: { license: "MIT", status: "requires-setup", port: 3080, dev: "npm run backend", build: ["npm install", "npm run frontend"], commit: "f4154b6", secrets: ["A model provider API key (not set)"], footprint: "~3000 packages; frontend build ~35 s; MongoDB required.", verified: ["Built from source", "Registration, chat UI, agent builder, settings"], notes: ["The documented compose image host (registry.librechat.ai) was blocked; ran from source with MongoDB in Docker.", "npm ci failed because xlsx is pinned to cdn.sheetjs.com; the registry xlsx was substituted for the test.", "Needs MongoDB; chatting needs your own model API keys."] },
  metabase: { license: "License review", status: "requires-setup", port: 3000, dev: "docker run -p 3000:3000 metabase/metabase", commit: "da359da4", footprint: "Docker image ~0.5 GB; source build needs a JDK 21 and Clojure toolchain.", verified: ["Official image runs", "Setup, saved questions and dashboard on the sample database"], notes: ["Mixed licence: AGPL outside /enterprise, Metabase Commercial License inside /enterprise.", "Verified via the official Docker image, not a source build."] },
  minipaint: { license: "MIT", status: "runnable-now", dev: "npm run build, then serve the folder statically", build: ["npm install", "npm run build"], commit: "c9192c1", footprint: "npm install ~10 s, webpack build ~17 s.", verified: ["Install and production build", "Served as a static site; drawing and menus"], notes: ["The licence file is MIT-LICENSE.txt (which is why it is not auto-detected) and package.json also says MIT.", "Runs as a static site; no external services."] },
  navidrome: { license: "GPL-3.0", status: "requires-setup", port: 4533, dev: "docker run -p 4533:4533 -v ./music:/music deluan/navidrome", commit: "93cead9", footprint: "Docker image ~0.1 GB.", verified: ["Official image runs", "Library scan, albums, playback bar"], notes: ["Verified via the official image; a source build needs Go, Node and TagLib.", "Needs a music library; the demo used generated tracks."] },
  nocodb: { license: "License review", status: "requires-setup", port: 8080, dev: "docker run -p 8080:8080 nocodb/nocodb", commit: "7f1f236", footprint: "Docker image ~1.3 GB; SQLite by default.", verified: ["Official image runs", "Grid, kanban, gallery and form views"], notes: ["Not open source: LICENSE.md is the Sustainable Use License v1.0 (internal business or non-commercial use; redistribution only free of charge for non-commercial purposes).", "Verified via the official image; the repo's pnpm monorepo was not built."] },
  openhands: { license: "MIT", status: "requires-setup", port: 8000, dev: "npm run dev", build: ["npm ci"], commit: "e14b76c", secrets: ["An LLM API key"], footprint: "npm ci ~40 s; uses uvx for the agent server.", verified: ["Install", "Agent Canvas UI and onboarding"], notes: ["The project is now Agent Canvas; the README source path needs Node 24 or newer.", "The Docker option uses a ghcr.io image.", "An agent run needs an LLM API key (not tested)."] },
  penpot: { license: "MPL-2.0", status: "requires-setup", port: 9001, dev: "docker compose -p penpot up -d (docker/images/docker-compose.yaml)", commit: "cd1ece4", footprint: "Docker: 8 services, ~3 GB of images.", verified: ["Stack runs", "Sign-up, board with shapes, prototype and inspect tabs"], notes: ["The frontend nginx needs IPv6; on hosts without it set PENPOT_IPV6_LISTEN_DIRECTIVE to a comment.", "Uses prebuilt penpotapp images; built-in template libraries need internet."] },
  perplexica: { license: "MIT", status: "requires-setup", port: 3000, dev: "docker run -p 3000:3000 itzcrazykns1337/vane", commit: "348feca", secrets: ["A model provider key or local model"], footprint: "Docker image; SearxNG bundled in the full image.", verified: ["Official image runs", "Setup wizard and search home"], notes: ["The repository is now Vane; the clone URL redirects.", "The setup wizard needs a model connection; live search was not tested without a key."] },
  "saas-starter": { license: "MIT", status: "requires-setup", port: 3000, dev: "pnpm dev", build: ["pnpm install", "pnpm db:migrate", "pnpm db:seed"], commit: "6e33e58", secrets: ["POSTGRES_URL", "AUTH_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], footprint: "pnpm install ~6 s; Postgres in Docker.", verified: ["Install, migrations", "Landing page, sign-in and dashboard"], notes: ["db:seed creates test@test.com and then needs a live Stripe key to create products; with a dummy key it stops after the user is created.", "The pricing page needs the Stripe API and errors without it."] },
  umami: { license: "MIT", status: "requires-setup", port: 3000, dev: "pnpm run start", build: ["pnpm install", "pnpm run build"], commit: "559e3c6", secrets: ["DATABASE_URL"], footprint: "Install ~10 s, build ~90 s; Postgres in Docker.", verified: ["Build, migrations, start", "Website analytics views with generated traffic"], notes: ["Default login is admin / umami: change it.", "`next start` warns about output: standalone but works."] },
  "uptime-kuma": { license: "MIT", status: "requires-setup", port: 3001, dev: "node --import=tsx server/server.js", build: ["npm ci", "npm run build"], commit: "fb8ef0f", footprint: "npm ci ~25 s, frontend build ~5 s; SQLite.", verified: ["Install and build", "Setup wizard, monitors, dashboard"], notes: ["The current branch needs Node 26.2 or newer; the README's plain `node server/server.js` fails on this branch.", "Account setup checks passwords against haveibeenpwned; set UPTIME_KUMA_DISABLE_LEAK_PWD_CHECK=1 on offline hosts."] },
  "vercel-chatbot": { license: "Apache-2.0", status: "requires-setup", port: 3000, dev: "pnpm dev", build: ["pnpm install", "pnpm db:migrate"], commit: "a8989b5", secrets: ["POSTGRES_URL", "AUTH_SECRET", "AI_GATEWAY_API_KEY"], footprint: "pnpm install ~6 s; Postgres in Docker.", verified: ["Install and migrations", "Chat UI as a guest"], notes: ["Licence verified: Apache-2.0.", "Replies need an AI Gateway key (not tested)."] },
  wekan: { license: "MIT", status: "requires-setup", port: 80, dev: "docker compose (MongoDB 7 + wekanteam/wekan)", commit: "bc69880", footprint: "Docker: MongoDB + app ~2.5 GB.", verified: ["Stack runs", "Registration, boards, lists and cards"], notes: ["The default compose uses ghcr.io images and a FerretDB download; Docker Hub wekanteam/wekan with MongoDB 7 was used.", "The placeholder MAIL_URL crashes start-up; set a valid smtp:// URL."] },
  "stirling-pdf": { license: "License review", status: "requires-setup", port: 8080, dev: "docker run -p 8080:8080 stirlingtools/stirling-pdf", commit: "0b7d3a4", footprint: "Docker image ~1 GB.", verified: ["Official image runs", "Upload and tool panels"], notes: ["LICENSE is MIT for the core, but app/proprietary, app/saas, engine and parts of the frontend editor carry their own licences: review before distributing.", "Verified via the official Docker image; default login admin/stirling unless security is disabled (done for the test)."] },
  slidev: { license: "MIT", status: "runnable-now", port: 3030, dev: "pnpm run demo:dev", build: ["pnpm install --frozen-lockfile", "pnpm run build"], commit: "437f139", footprint: "pnpm install ~22 s.", verified: ["Install and build", "Demo deck, notes and presenter views"], notes: ["Needs Node 22.22+.", "A cypress postinstall download fails on restricted networks but does not stop the demo."] },
  "monaco-editor": { license: "MIT", status: "requires-setup", port: 8091, dev: "serve website/dist statically", build: ["npm ci", "npm run build-lsp", "npm run build-monaco-editor", "(website) npm ci && npm run typedoc && npm run build-webpack"], commit: "5359a33", footprint: "~1 min of builds.", verified: ["Editor build and playground site"], notes: ["The website dev server (webpack serve) failed on a schema error in this environment; the production build was served statically.", "The playground preview pane loads Monaco from a CDN, so it stays blank offline.", "Ship ThirdPartyNotices.txt with any distribution."] },
  "chatbot-ui-lite": { license: "MIT", status: "requires-setup", port: 3000, dev: "npm run dev", build: ["npm install"], commit: "3cb41ac", secrets: ["OPENAI_API_KEY"], footprint: "npm install ~14 s.", verified: ["Install and dev server", "Single chat screen renders"], notes: ["Basic single-screen demo last updated in March 2023 on Next 13 and the OpenAI v3 SDK; not production-ready.", "Replies need an OpenAI key (not tested)."] },
  "anything-llm": { license: "MIT", status: "requires-setup", port: 3001, dev: "docker run -p 3001:3001 mintplexlabs/anythingllm", commit: "ace9dad", secrets: ["A model provider API key"], footprint: "Docker image ~1.5 GB; embedded SQLite and LanceDB.", verified: ["Official image runs", "Onboarding, chat workspace and settings"], notes: ["Verified via the official Docker image (needs --cap-add SYS_ADMIN and a storage volume).", "Chatting needs your own model API key (not tested); DeepSeek is a built-in provider."] },
  flowise: { license: "License review", status: "requires-setup", port: 3002, dev: "docker run -p 3000:3000 flowiseai/flowise:3.1.3", commit: "9291856", secrets: ["A model provider API key"], footprint: "Docker image ~1.3 GB; SQLite.", verified: ["Official image runs (3.1.3)", "Account setup, chatflows, marketplace templates"], notes: ["Apache-2.0 except packages/server/src/enterprise and files with an explicit notice, which are under a commercial licence: exclude them.", "The latest Docker tag (3.1.4) failed to start (ERR_PACKAGE_PATH_NOT_EXPORTED); 3.1.3 was used and still logs that error for two agent nodes.", "Has a dedicated DeepSeek chat-model node."] },
  onlyoffice: { license: "AGPL-3.0", status: "requires-setup", port: 80, dev: "docker run -p 80:80 onlyoffice/documentserver (then supervisorctl start ds:example)", footprint: "Docker image ~4 GB; first boot ~2 min.", verified: ["Official Docker Hub image runs", "Example app creates and opens Document, Spreadsheet and Presentation editors"], notes: ["AGPL-3.0: network use requires publishing your modifications; commercial licence available.", "The repository is packaging; the image comes from Docker Hub onlyoffice/documentserver.", "The bundled example app is disabled by default (supervisorctl start ds:example) and is for testing only.", "In a sandbox set ALLOW_PRIVATE_IP_ADDRESS=true and ALLOW_META_IP_ADDRESS=true and make the example siteUrl resolvable from inside the container; JWT was disabled for the test only."] },
  langflow: { license: "MIT", status: "requires-setup", port: 7860, dev: "docker run -p 7860:7860 -e LANGFLOW_WORKERS=1 langflowai/langflow:latest", footprint: "Docker image ~3.6 GB; first boot ~1 min.", secrets: ["A model provider API key"], verified: ["Official Docker Hub image runs with a single worker", "Flows list, new-flow screen and settings render"], notes: ["With the default worker count the container failed to boot in this sandbox (\"Worker failed to boot\"); LANGFLOW_WORKERS=1 fixed it.", "Starter flows created through the API opened on the canvas, but their nodes rendered as empty boxes in the headless capture, so the canvas is not shown.", "Building flows needs a model provider key (not tested); it also tries to reach the Langflow GitHub/Discord widgets, which fail offline."] },
  twenty: { license: "License review", status: "requires-setup", port: 3100, dev: "docker run -p 3100:3000 twentycrm/twenty (with Postgres 16 and Redis)", commit: "50ffc86", secrets: ["APP_SECRET", "PG_DATABASE_URL", "REDIS_URL"], footprint: "Docker: app image ~1.8 GB + Postgres + Redis; first boot runs migrations (~1.5 min).", verified: ["Official Docker Hub image runs with Postgres 16 and Redis 7", "Email sign-up, workspace creation and onboarding", "Companies, people and opportunities (kanban) views with seeded demo data"], notes: ["Mostly AGPL-3.0, but files marked /* @license Enterprise */ carry a commercial licence and some packages are MIT: exclude or review before distributing.", "SERVER_URL must match the URL you open (here http://localhost:3100).", "Sign-up works without email verification; email sending and OAuth sign-in need your own provider.", "Verified via the official image, not a source build of the very large monorepo."] },
  opencut: { license: "MIT", status: "requires-setup", port: 5173, dev: "bun run dev (apps/web)", build: ["bun install"], commit: "e668010", footprint: "bun install ~6 s.", verified: ["Install and dev server start"], notes: ["The default branch is a rewrite in progress: apps/web renders only a placeholder page, so no screenshots were taken.", "The README points to opencut-classic as the working editor."] },
};

/** Featured order: OpenFilm first, then the Adobe-style and Microsoft-style tools. Entries not listed are not featured. */
const FEATURED_ORDER = ["openfilm", "photocraft", "filmcraft", "wordcraft", "gridcraft", "vectorcraft", "lightcraft", "pdfcraft", "deckcraft"];
/** Own app icons copied from each project (see public/library-icons/ATTRIBUTION.md). */
const OWN_ICONS = new Set(FEATURED_ORDER);

/** The most representative capture of each app (its main working screen), used as the card's cover. */
const COVER: Record<string, string> = {
  actual: "actual-2.jpg", "code-server": "code-server-3.jpg", excalidraw: "excalidraw-2.jpg", formbricks: "formbricks-4.jpg",
  gitea: "gitea-2.jpg", hoppscotch: "hoppscotch-2.jpg", hycanvas: "hycanvas-3.jpg", navidrome: "navidrome-3.jpg",
  "saas-starter": "saas-starter-2.jpg", "stirling-pdf": "stirling-pdf-3.jpg", "anything-llm": "anything-llm-3.jpg", flowise: "flowise-3.jpg",
  slidev: "slidev-2.jpg", wekan: "wekan-1.jpg", onlyoffice: "onlyoffice-1.jpg", langflow: "langflow-2.jpg", twenty: "twenty-3.jpg",
};

/** Apps whose main features need an AI model API. On import the agent offers Clyra AI or the user's own key. */
const AI_POWERED = new Set([
  "librechat", "vercel-chatbot", "perplexica", "openhands", "bolt-diy", "anything-llm", "flowise", "langflow", "chatbot-ui-lite",
  "funclip", "ai-youtube-shorts-generator", "onlook", "dyad", "cline", "aider", "continue", "browser-use", "hycanvas", "openfilm", "natively",
]);

function withCaptures(manifestIn: TemplateManifest): TemplateManifest {
  const rank = FEATURED_ORDER.indexOf(manifestIn.id);
  const manifest: TemplateManifest = {
    ...manifestIn,
    featuredRank: rank >= 0 ? rank : null,
    aiPowered: AI_POWERED.has(manifestIn.id),
    iconUrl: OWN_ICONS.has(manifestIn.id) ? `/library-icons/${manifestIn.id}.png` : null,
  };
  const rawShots = CAPTURED[manifest.id];
  const cover = COVER[manifest.id];
  const shots = rawShots && cover ? [...rawShots.filter(([file]) => file === cover), ...rawShots.filter(([file]) => file !== cover)] : rawShots;
  const facts = VERIFIED[manifest.id];
  let out = manifest;
  if (facts) {
    out = {
      ...out,
      licenseSpdxOrReview: facts.license ?? out.licenseSpdxOrReview,
      status: facts.status,
      port: facts.port ?? out.port,
      devCommand: facts.dev ?? out.devCommand,
      buildCommands: facts.build ?? out.buildCommands,
      estimatedBuildFootprint: facts.footprint ?? out.estimatedBuildFootprint,
      requiredSecrets: facts.secrets ?? out.requiredSecrets,
      capabilitiesVerified: facts.verified,
      lastVerifiedAt: "2026-11-10T00:00:00.000Z",
      warnings: facts.notes,
    };
  }
  if (!shots) return out;
  const capturedAt = "2026-11-10";
  return {
    ...out,
    sourceScreenshots: shots.map(([file, alt]) => ({ url: `/library-shots/${file}`, alt, capturedAt, provenance: "Captured by Clyra from a local run of the unmodified upstream source." })),
    captureProvenance: `Captured from a local run of the upstream source on 2026-11-10${facts?.commit && facts.commit !== "n/a" ? ` (commit ${facts.commit})` : ""}.`,
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
