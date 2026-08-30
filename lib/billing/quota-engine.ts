/**
 * Quota enforcement built on the real usage ledger (lib/api-usage-ledger.mjs)
 * and config-driven plan limits (./plan-config). This is deliberately built
 * and wired now, ahead of Stripe: when billing lands, Stripe only needs to
 * write the active plan id — this engine already knows how to enforce it.
 */
import { getUsageInWindow } from "../api-usage-ledger.mjs";
import { getActivePlanId, getPlanLimits, type PlanLimits } from "./plan-config";

const ROLLING_WINDOW_DAYS = 30;

export interface QuotaStatus {
  plan: PlanLimits;
  requests: { used: number; limit: number | null; remaining: number | null; fraction: number | null };
  tokens: { used: number; limit: number | null; remaining: number | null; fraction: number | null };
  state: "ok" | "warning" | "exceeded";
}

function dimension(used: number, limit: number | null) {
  if (limit == null) return { used, limit: null, remaining: null, fraction: null };
  return { used, limit, remaining: Math.max(0, limit - used), fraction: limit > 0 ? used / limit : 0 };
}

export async function getQuotaStatus(): Promise<QuotaStatus> {
  const plan = getPlanLimits(getActivePlanId());
  const usage = await getUsageInWindow(ROLLING_WINDOW_DAYS);
  const requests = dimension(usage.requests, plan.monthlyRequestLimit);
  const tokens = dimension(usage.tokens, plan.monthlyTokenLimit);
  const exceeded = (requests.fraction ?? 0) >= 1 || (tokens.fraction ?? 0) >= 1;
  const warning = !exceeded && ((requests.fraction ?? 0) >= plan.warnAtFraction || (tokens.fraction ?? 0) >= plan.warnAtFraction);
  return { plan, requests, tokens, state: exceeded ? "exceeded" : warning ? "warning" : "ok" };
}

export class QuotaExceededError extends Error {
  constructor(public status: QuotaStatus) {
    super(`${status.plan.name} plan limit reached for this billing period. Upgrade or wait for the rolling window to clear.`);
    this.name = "QuotaExceededError";
  }
}

/** Call before starting an AI request that should count against quota.
 * Read-only requests (status checks, cached lookups) should not call this. */
export async function assertWithinQuota(): Promise<QuotaStatus> {
  const status = await getQuotaStatus();
  if (status.state === "exceeded") throw new QuotaExceededError(status);
  return status;
}
