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

const seeds: readonly Seed[] = [
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
  ["openhands", "OpenHands", "Codex, Devin, OpenCode", "Code Agents", "OpenHands/OpenHands", "Agentic software development workspace with a welcome composer, conversations and tools.", "full-app", "web, backend", "License review", "Requires agent server, LLM settings and a development environment. Source checkout is not a ready-to-run hosted service."],
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
  // Distinct, source-only additions to the Clyra Code catalogue (2026-11-11).
  ["facilmap", "FacilMap", "Google Maps, My Maps", "Maps", "FacilMap/facilmap", "Collaborative map projects with searchable places, routes and markers.", "full-app", "web, backend", "AGPL-3.0", "A separate map application, not a drop-in MapLibre replacement; full server and OSM services are required."],
  ["photon-self-hosted", "Photon", "Google Maps Places, address search", "Maps Services", "komoot/photon", "Self-hostable OpenStreetMap geocoder and autocomplete search service.", "engine", "backend, JVM, CLI", "Apache-2.0", "Requires running the service and provisioning an OSM search index; public Photon is not an unlimited Clyra backend."],
  ["valhalla", "Valhalla", "Google Maps Directions, routing APIs", "Maps Services", "valhalla/valhalla", "Self-hostable OpenStreetMap turn-by-turn routing engine.", "engine", "native, backend, CLI", "License review", "Requires OSM extracts, preprocessed routing tiles and substantial local or server resources; this does not provide a keyless hosted routing API."],
  ["browseros", "BrowserOS", "Perplexity Comet, ChatGPT Atlas", "AI Browsers", "browseros-ai/BrowserOS", "Chromium-based agentic AI browser with page context and browsing automation.", "reference-only", "desktop", "AGPL-3.0", "Large Chromium source/build; browser and agent dependencies need inspection. Reference checkout only, not an embedded browser."],
  ["doory", "Doory", "Canva", "Graphic Design", "shaongitbd/doory", "Visual graphics and template-based design editor.", "full-app", "web, backend", "AAL / attribution review", "Attribution Assurance License has specific requirements; review licence, notices and downstream dependencies before commercial integration."],
  ["karakeep", "Karakeep", "Pocket, Raindrop.io, MyMind", "Bookmarks", "karakeep-app/karakeep", "Bookmark and document collection with full-text search and AI-assisted tagging.", "full-app", "web, backend", "AGPL-3.0", "Self-hosting and optional AI features require service configuration; review AGPL obligations."],
  ["actual-budget", "Actual Budget", "YNAB", "Finance", "actualbudget/actual", "Local-first personal budgeting with transaction tracking and reports.", "full-app", "web, backend", "License review", "Review sync server configuration and financial data-handling requirements before deployment."],
  ["bolt-diy", "Bolt DIY", "Bolt.new, Lovable.dev", "AI App Builders", "stackblitz-labs/bolt.diy", "Prompt-driven full-stack web app generation with interactive code and previews.", "full-app", "web, backend", "MIT / dependencies review", "Commercial WebContainer and model-provider terms may apply; source checkout alone is not a working AI app builder."],
  ["coolify", "Coolify", "Vercel, Heroku, Railway", "Deployment", "coollabsio/coolify", "Self-hosted application deployment, projects and server management.", "full-app", "web, backend", "Apache-2.0", "Requires Docker, infrastructure administration and secure network configuration; never execute deployment scripts during template import."],
  ["pocketbase", "PocketBase", "Firebase, Supabase", "Backend Services", "pocketbase/pocketbase", "Single-binary backend with database, authentication, files and realtime APIs.", "full-app", "backend, CLI", "MIT", "Backend service; authentication, migrations and deployment remain the imported project's responsibility."],
  ["cryptpad", "CryptPad", "Google Docs, Google Workspace", "Office Suites", "cryptpad/cryptpad", "Collaborative privacy-focused documents, spreadsheets and shared workspaces.", "full-app", "web, backend", "License review", "Requires collaboration server setup and review of upstream licences and dependencies."],
  ["jellyfin", "Jellyfin", "Plex", "Media Servers", "jellyfin/jellyfin", "Self-hosted video and music streaming library server.", "full-app", "backend", "License review", "Media server and optional clients are separate projects; use only media for which distribution or access is authorised."],
  ["navidrome", "Navidrome", "Plexamp, personal music streaming", "Media Servers", "navidrome/navidrome", "Self-hosted music player and streaming service for a personal audio library.", "full-app", "backend, CLI", "License review", "Does not provide Spotify's music catalogue; user supplies their own authorised audio files."],
  ["libretranslate", "LibreTranslate", "Google Translate, DeepL", "Translation", "LibreTranslate/LibreTranslate", "Self-hosted text translation API and web interface.", "full-app", "web, Python", "License review", "Offline translation requires language models and CPU/RAM capacity; hosted public endpoints can enforce limits or keys."],
  ["gitea", "Gitea", "GitHub, GitLab", "Git Hosting", "go-gitea/gitea", "Self-hosted Git repositories, pull requests, issues and team access.", "full-app", "web, backend", "MIT", "Requires repository storage, admin configuration and security maintenance; not a plug-in for GitHub authentication."],
];

/**
 * Source-authorised visual previews surfaced in public upstream READMEs.
 * They illustrate the upstream software; they do not mean Clyra has built,
 * run or verified the corresponding template, and they are not Clyra captures.
 * Leave entries empty where a suitable demonstrable preview is unavailable.
 */
const UPSTREAM_README_PREVIEWS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  excalidraw: [
    ["https://excalidraw.nyc3.cdn.digitaloceanspaces.com/github%2Fproduct_showcase.png", "Excalidraw product canvas showcase from its upstream README"],
  ],
  "actual-budget": [
    ["https://raw.githubusercontent.com/actualbudget/actual/master/demo.png", "Actual Budget dashboard preview from its upstream README"],
  ],
  "open-webui": [
    ["https://cdn.openwebui.com/open-webui-demo.gif", "Open WebUI interface demonstration from its upstream README"],
  ],
  appflowy: [
    ["https://github.com/user-attachments/assets/1c12d629-40a0-4f35-9451-97498cf31a25", "AppFlowy Kanban board for to-dos"],
    ["https://github.com/user-attachments/assets/0cff82d3-3e40-4057-a5fa-b2e9be8dd863", "AppFlowy databases for tasks and projects"],
    ["https://github.com/user-attachments/assets/388224f4-0792-4e75-96d1-f1c671b298a3", "AppFlowy database row and comments"],
    ["https://github.com/user-attachments/assets/ae0cadf2-bb6f-496e-8f84-4916dce1fa62", "AppFlowy notes and report documents"],
    ["https://github.com/user-attachments/assets/619ea154-f714-4859-ad28-4f0bdf5028f7", "AppFlowy team wiki with AI assistance"],
    ["https://github.com/user-attachments/assets/5841c491-b564-4a26-b9b6-191def430911", "AppFlowy mobile workspace and summaries"],
    ["https://github.com/user-attachments/assets/c2ba6bb8-746c-4743-9393-d008a669be95", "AppFlowy mobile collaboration properties"],
    ["https://github.com/user-attachments/assets/e83dd1a3-4975-4d0e-91a1-9eb6e0d248cd", "AppFlowy mobile document blocks"],
  ],
  n8n: [
    ["https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-screenshot-readme.png", "n8n visual workflow automation editor"],
  ],
  penpot: [
    ["https://github.com/user-attachments/assets/cce75ad6-f783-473f-8803-da9eb8255fef", "Penpot design system interface"],
    ["https://github.com/user-attachments/assets/0abc02f0-625c-45ab-ad81-4927bec7a055", "Penpot workspace hub"],
  ],
  chatwoot: [
    ["https://raw.githubusercontent.com/chatwoot/chatwoot/develop/.github/screenshots/dashboard.png", "Chatwoot customer support dashboard"],
    ["https://raw.githubusercontent.com/chatwoot/chatwoot/develop/.github/screenshots/header.png", "Chatwoot support interface overview"],
  ],
};

function upstreamReadmePreviews(id: string, repositoryUrl: string): SourceScreenshot[] {
  return (UPSTREAM_README_PREVIEWS[id] ?? []).map(([url, alt]) => ({
    url,
    alt,
    // Upstream documentation does not state the original capture date.
    capturedAt: "",
    provenance: "Upstream project README (" + repositoryUrl + "); image cited as of 2026-11-12. Not a screenshot of a running Clyra template.",
  }));
}

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
    sourceScreenshots: upstreamReadmePreviews(id, `https://github.com/${repository}`),
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

export const TEMPLATE_LIBRARY: readonly TemplateManifest[] = Object.freeze(seeds.map(manifestFromSeed));

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
