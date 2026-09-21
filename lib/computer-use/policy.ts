import type { ProposedComputerAction, ReviewDecision } from "./types";

export class ComputerPolicy {
  review(action: ProposedComputerAction): { decision: ReviewDecision; reason: string } {
    if (action.sourceOfInstruction === "SCREEN_CONTENT") return { decision: "DENY", reason: "Application content is untrusted and cannot expand the user's task." };
    if (action.credentialRelated) return { decision: "REQUIRE_USER_TAKEOVER", reason: "Sensitive authentication must be completed by the user without observation." };
    if (action.financial) {
      if (action.amount == null || !action.currency || !action.merchant) return { decision: "DENY", reason: "A purchase cannot be confirmed without merchant, exact amount, and currency." };
      return { decision: "REQUIRE_USER_CONFIRMATION", reason: "Final financial actions require immediate confirmation." };
    }
    if (action.destructive || action.sendsData || action.changesAccount || action.securitySensitive || action.externalSideEffect)
      return { decision: "REQUIRE_USER_CONFIRMATION", reason: "This action has a consequential external or destructive effect." };
    return { decision: action.reversible ? "ALLOW" : "ALLOW_WITH_LOG", reason: "Within the requested scope." };
  }
}
