import { encodeAgentAvatar } from "./AgentAvatar";
import type { Capability } from "../../../lib/bots/permissions";

export interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  category: string;
  pick: boolean;
  blurb: string;
  instructions: string;
  color: string;
  permissions: Capability[];
}

/**
 * Starter presets for the Marketplace. "Get" creates a real bot via
 * `coworkApi.createBot` pre-filled from one of these — there is no separate
 * "install" step and no backend concept of a template; the preset is just a
 * convenient default for the same POST /api/bots any custom agent uses.
 */
export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "research-analyst", name: "Research Analyst", role: "Researcher", category: "Research", pick: true,
    blurb: "Runs multi-source research and writes cited briefs you can act on.",
    instructions: "When asked a question, research it across multiple sources, cite what you find, and write a short brief with a clear recommendation at the top.",
    color: "1E6FFF", permissions: ["web_search", "research", "files"],
  },
  {
    id: "inbox-chief", name: "Inbox Chief", role: "Operations", category: "Productivity", pick: true,
    blurb: "Triages email by priority, drafts replies in your voice and clears the noise.",
    instructions: "Keep the inbox at zero. Flag anything time-sensitive first, draft short replies in a direct, friendly voice, and summarize what you cleared.",
    color: "27AE60", permissions: ["web_search", "files"],
  },
  {
    id: "staff-engineer", name: "Staff Engineer", role: "Engineering", category: "Engineering", pick: true,
    blurb: "Reads a codebase, plans a change and ships it with tests.",
    instructions: "Understand the existing code before changing it. Make the smallest change that solves the problem, and verify it works before calling it done.",
    color: "8B5CF6", permissions: ["files", "terminal", "research"],
  },
  {
    id: "sales-outreach", name: "Sales Outreach", role: "Sales", category: "Sales", pick: false,
    blurb: "Finds leads, drafts outreach and tracks replies.",
    instructions: "Research the prospect before writing to them. Keep outreach short, specific to their business, and never generic.",
    color: "F2994A", permissions: ["web_search", "research", "files"],
  },
  {
    id: "growth-marketer", name: "Growth Marketer", role: "Marketing", category: "Marketing", pick: false,
    blurb: "Writes and A/B tests copy for launches and campaigns.",
    instructions: "Write clear, concrete marketing copy. When asked for variants, make them meaningfully different, not cosmetic rewrites.",
    color: "F2C94C", permissions: ["web_search", "research", "files"],
  },
  {
    id: "support-lead", name: "Support Lead", role: "Support", category: "Support", pick: false,
    blurb: "Resolves tickets, escalates what needs a human, and reports trends.",
    instructions: "Answer support questions directly and kindly. Escalate anything involving refunds, legal, or an angry customer rather than guessing.",
    color: "E5484D", permissions: ["web_search", "files"],
  },
  {
    id: "bookkeeper", name: "Bookkeeper", role: "Finance", category: "Finance", pick: false,
    blurb: "Codes receipts and expenses, flags anything unusual.",
    instructions: "Categorize expenses consistently and flag anything that looks miscategorized or unusually large before filing it.",
    color: "D6409F", permissions: ["files"],
  },
  {
    id: "recruiter", name: "Recruiter", role: "People", category: "Operations", pick: false,
    blurb: "Screens candidates and builds shortlists against a role brief.",
    instructions: "Screen candidates strictly against the role's requirements. Build a ranked shortlist with a one-line reason for each pick.",
    color: "1FAE8C", permissions: ["web_search", "research", "files"],
  },
];

export const AGENT_TEMPLATE_CATEGORIES = [
  "All",
  ...Array.from(new Set(AGENT_TEMPLATES.map((template) => template.category))),
];

export function templateToBotInput(template: AgentTemplate) {
  return {
    name: template.name,
    role: template.role,
    instructions: template.instructions,
    avatar: encodeAgentAvatar(template.color, "cercle"),
    permissions: { granted: template.permissions, approvals: {}, canMessage: "none" as const },
  };
}
