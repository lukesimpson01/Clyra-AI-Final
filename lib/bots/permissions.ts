/**
 * Tool permissions and approval gating for Clyra Cowork bots.
 *
 * Two separate questions, deliberately kept apart:
 *
 *   1. *Can* this bot use this capability at all? — the grant, set when the
 *      bot is created. A capability that was never granted is not merely
 *      gated behind a prompt; it is unavailable.
 *   2. Does this specific action need a human first? — some actions are
 *      consequential enough that holding the grant is not sufficient
 *      (sending mail, publishing, spending money, destructive commands).
 *
 * Collapsing these into one flag is the common mistake: it either nags on
 * every harmless read, or lets a granted capability quietly send email.
 */

export const CAPABILITIES = [
  "web_search",
  "browser",
  "terminal",
  "files",
  "google_workspace",
  "research",
  "computer_control",
  "clyra_tools",
  "messaging",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type ApprovalMode = "always_ask" | "ask_once" | "never_ask";

export interface ToolPermissions {
  granted: Capability[];
  /** Per-capability approval posture; defaults applied by `approvalFor`. */
  approvals: Partial<Record<Capability, ApprovalMode>>;
  /** Bot ids this bot may message. `"all"` and `"none"` are the shorthands. */
  canMessage: "all" | "none" | string[];
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value);
}

export function defaultPermissions(): ToolPermissions {
  // A new bot starts able to read and research, but not to act on the world:
  // no terminal, no computer control, no messaging. Escalation is a choice
  // the user makes explicitly, per bot.
  return {
    granted: ["web_search", "research", "files"],
    approvals: {},
    canMessage: "none",
  };
}

/**
 * Actions that always need a human, regardless of granted capability.
 *
 * Deliberately expressed as *actions*, not capabilities: "terminal" is not
 * inherently dangerous, `rm -rf` is. Gating the capability would make the bot
 * useless; gating the action keeps it useful and safe.
 */
export const CONSEQUENTIAL_ACTIONS = [
  "file_delete_outside_project",
  "purchase",
  "send_message",
  "publish",
  "account_change",
  "destructive_command",
  "access_other_folder",
  "credential_use",
] as const;

export type ConsequentialAction = (typeof CONSEQUENTIAL_ACTIONS)[number];

export function isConsequential(action: string): action is ConsequentialAction {
  return (CONSEQUENTIAL_ACTIONS as readonly string[]).includes(action);
}

export type PermissionDecision =
  | { allowed: true; requiresApproval: false }
  | { allowed: true; requiresApproval: true; reason: string }
  | { allowed: false; reason: string };

export function approvalFor(permissions: ToolPermissions, capability: Capability): ApprovalMode {
  const explicit = permissions.approvals?.[capability];
  if (explicit) return explicit;
  // Capabilities that reach outside the workspace default to asking; the
  // read-only ones do not, or the bot would be unusable.
  if (capability === "terminal" || capability === "computer_control" || capability === "messaging") {
    return "always_ask";
  }
  return "never_ask";
}

/**
 * Decide whether a bot may perform one action now.
 *
 * `action` is optional: a plain capability use (reading a file it owns) has
 * no action name, while a consequential one does. An action that is
 * consequential always requires approval even when the capability's mode is
 * `never_ask` — a user who silenced prompts for the terminal has not thereby
 * consented to `rm -rf /`.
 */
export function checkPermission(
  permissions: ToolPermissions,
  capability: Capability,
  action?: string,
): PermissionDecision {
  if (!permissions.granted.includes(capability)) {
    return { allowed: false, reason: `This bot does not have the "${capability}" capability.` };
  }
  if (action && isConsequential(action)) {
    return { allowed: true, requiresApproval: true, reason: `"${action}" needs your approval before it runs.` };
  }
  const mode = approvalFor(permissions, capability);
  if (mode === "always_ask") {
    return { allowed: true, requiresApproval: true, reason: `Using "${capability}" needs your approval.` };
  }
  return { allowed: true, requiresApproval: false };
}

/** Whether `from` may send a message to `to`. */
export function canMessage(permissions: ToolPermissions, targetBotId: string): boolean {
  const rule = permissions.canMessage;
  if (rule === "all") return true;
  if (rule === "none") return false;
  return Array.isArray(rule) && rule.includes(targetBotId);
}

/** Coerce untrusted input into a valid permission set. */
export function normalisePermissions(input: unknown): ToolPermissions {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fallback = defaultPermissions();

  const granted = Array.isArray(source.granted)
    ? [...new Set(source.granted.filter(isCapability))]
    : fallback.granted;

  const approvals: Partial<Record<Capability, ApprovalMode>> = {};
  if (source.approvals && typeof source.approvals === "object") {
    for (const [key, value] of Object.entries(source.approvals as Record<string, unknown>)) {
      if (!isCapability(key)) continue;
      if (value === "always_ask" || value === "ask_once" || value === "never_ask") approvals[key] = value;
    }
  }

  let canMessageRule: ToolPermissions["canMessage"] = fallback.canMessage;
  if (source.canMessage === "all" || source.canMessage === "none") {
    canMessageRule = source.canMessage;
  } else if (Array.isArray(source.canMessage)) {
    canMessageRule = source.canMessage.filter((id): id is string => typeof id === "string" && id.length > 0);
  }

  return { granted, approvals, canMessage: canMessageRule };
}
