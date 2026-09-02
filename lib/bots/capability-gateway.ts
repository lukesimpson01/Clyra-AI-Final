/**
 * The Clyra Capability Gateway.
 *
 * Every tool a bot invokes goes through here. The point is not indirection
 * for its own sake — it is that permission checks, workspace jailing,
 * approval gating, credential handling and the execution log all have to
 * happen on *every* call, and the only reliable way to guarantee that is to
 * make a single function the sole path to a capability.
 *
 * Capabilities are registered by the host (server) with the real Clyra
 * implementations, so this file contains no duplicate tool logic: it is the
 * guard rail around functions that already exist.
 */
import { checkPermission, type Capability, type ToolPermissions } from "./permissions";
import { resolveInWorkspace, WorkspaceViolationError } from "./workspace";

export interface GatewayCallContext {
  botId: string;
  slug: string;
  permissions: ToolPermissions;
  /** Set once the user has approved this specific call. */
  approved?: boolean;
}

export interface CapabilityRequest {
  capability: Capability;
  /** Optional consequential action name, e.g. "send_message". */
  action?: string;
  input: Record<string, unknown>;
}

export type GatewayResult =
  | { ok: true; output: unknown; log: ExecutionLogEntry }
  | { ok: false; error: string; needsApproval?: boolean; log: ExecutionLogEntry };

export interface ExecutionLogEntry {
  at: string;
  botId: string;
  capability: Capability;
  action: string | null;
  outcome: "ok" | "denied" | "needs_approval" | "error";
  detail: string;
  /** Never contains credentials — see `redact`. */
  input: Record<string, unknown>;
  durationMs: number;
}

export type CapabilityHandler = (
  input: Record<string, unknown>,
  context: GatewayCallContext,
) => Promise<unknown>;

/** Keys whose values must never reach an execution log or an agent prompt. */
const SECRET_KEYS = /(^|_)(api[_-]?key|token|secret|password|authorization|cookie|credential)s?($|_)/i;

/**
 * Strip anything credential-shaped before it is logged.
 *
 * The gateway logs tool inputs for the "watch the agent" view, and those logs
 * are shown to the user and persisted. A tool that legitimately receives a
 * key must not have it copied into that record.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEYS.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return output;
  }
  if (typeof value === "string" && value.length > 4000) return `${value.slice(0, 4000)}…`;
  return value;
}

export class CapabilityGateway {
  private readonly handlers = new Map<Capability, CapabilityHandler>();
  private readonly log: ExecutionLogEntry[] = [];

  /** Register the real Clyra implementation for a capability. */
  register(capability: Capability, handler: CapabilityHandler): this {
    this.handlers.set(capability, handler);
    return this;
  }

  registered(): Capability[] {
    return [...this.handlers.keys()];
  }

  recentLog(botId?: string, limit = 100): ExecutionLogEntry[] {
    const entries = botId ? this.log.filter((entry) => entry.botId === botId) : this.log;
    return entries.slice(-limit);
  }

  /**
   * Resolve a bot-supplied path inside its workspace.
   *
   * Exposed so filesystem-shaped handlers jail their paths through the same
   * code the gateway itself trusts, rather than each re-implementing it.
   */
  resolvePath(context: GatewayCallContext, candidate: string): string {
    return resolveInWorkspace(context.slug, candidate);
  }

  async call(request: CapabilityRequest, context: GatewayCallContext): Promise<GatewayResult> {
    const started = Date.now();
    const base = {
      at: new Date().toISOString(),
      botId: context.botId,
      capability: request.capability,
      action: request.action ?? null,
      input: redact(request.input) as Record<string, unknown>,
    };
    const finish = (outcome: ExecutionLogEntry["outcome"], detail: string): ExecutionLogEntry => {
      const entry: ExecutionLogEntry = { ...base, outcome, detail, durationMs: Date.now() - started };
      this.log.push(entry);
      if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
      return entry;
    };

    const handler = this.handlers.get(request.capability);
    if (!handler) {
      return { ok: false, error: `No handler is registered for "${request.capability}".`, log: finish("error", "unregistered capability") };
    }

    const decision = checkPermission(context.permissions, request.capability, request.action);
    if (!decision.allowed) {
      return { ok: false, error: decision.reason, log: finish("denied", decision.reason) };
    }
    // An approval requirement is satisfied only by an explicit prior approval
    // for this call. The bot cannot set this itself — the host sets it after
    // the user answers the confirmation card.
    if (decision.requiresApproval && !context.approved) {
      return { ok: false, error: decision.reason, needsApproval: true, log: finish("needs_approval", decision.reason) };
    }

    try {
      const output = await handler(request.input, context);
      return { ok: true, output, log: finish("ok", "completed") };
    } catch (error) {
      const message = error instanceof WorkspaceViolationError
        ? error.message
        : error instanceof Error ? error.message : "Tool failed.";
      return { ok: false, error: message, log: finish("error", message) };
    }
  }
}
