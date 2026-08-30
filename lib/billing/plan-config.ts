/**
 * Config-driven plan definitions. This file is the ONLY place plan limits
 * live — no UI component or route should hardcode a quota number.
 *
 * There is no real billing yet (Supabase/Stripe are the two deliberately
 * deferred integrations — see AUDIT.md and the remaster plan). Every local
 * install is on "free" until Stripe assigns a real plan; the quota engine
 * built on top of this is what Stripe will eventually flip, not something
 * that gets rewritten when Stripe arrives.
 */

export type PlanId = "free" | "plus" | "pro";

export interface PlanLimits {
  id: PlanId;
  name: string;
  /** Requests allowed per rolling 30-day period, across all providers. */
  monthlyRequestLimit: number | null;
  /** Total tokens (input+output) allowed per rolling 30-day period. */
  monthlyTokenLimit: number | null;
  /** Soft warning threshold as a fraction of the limit (e.g. 0.8 = 80%). */
  warnAtFraction: number;
}

const PLAN_DEFINITIONS: Record<PlanId, PlanLimits> = {
  free: {
    id: "free",
    name: "Free",
    monthlyRequestLimit: 500,
    monthlyTokenLimit: 2_000_000,
    warnAtFraction: 0.8,
  },
  plus: {
    id: "plus",
    name: "Plus",
    monthlyRequestLimit: 5_000,
    monthlyTokenLimit: 20_000_000,
    warnAtFraction: 0.85,
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyRequestLimit: null,
    monthlyTokenLimit: null,
    warnAtFraction: 1,
  },
};

export function getPlanLimits(planId: PlanId): PlanLimits {
  return PLAN_DEFINITIONS[planId] ?? PLAN_DEFINITIONS.free;
}

export function listPlans(): PlanLimits[] {
  return Object.values(PLAN_DEFINITIONS);
}

/**
 * Local-first single-install plan state. Stripe will eventually own this
 * value (webhook writes it after a successful subscription); until then it
 * defaults to "free" and can be overridden for local testing only via
 * CLYRA_DEV_PLAN — never trust a client-supplied plan id.
 */
export function getActivePlanId(): PlanId {
  const override = process.env.CLYRA_DEV_PLAN;
  if (override === "plus" || override === "pro" || override === "free") return override;
  return "free";
}
