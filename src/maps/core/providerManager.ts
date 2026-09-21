export type ProviderStatus = "healthy" | "degraded" | "offline" | "rate_limited" | "unknown";

export interface ProviderHealth {
  id: string;
  label: string;
  status: ProviderStatus;
  priority: number;
  capabilities: string[];
  limits: string;
  lastFailure?: string;
  checkedAt: number;
}

export interface ManagedProvider {
  id: string;
  label: string;
  priority: number;
  capabilities: string[];
  limits: string;
  healthCheck?: () => Promise<boolean>;
}

/**
 * A deliberately tiny registry that keeps a provider swap out of UI code. It
 * has no polling loop: callers request a health refresh when opening the
 * diagnostics sheet, which prevents background calls while Maps is hidden.
 */
export class ProviderManager {
  private readonly providers = new Map<string, ManagedProvider>();
  private readonly health = new Map<string, ProviderHealth>();

  register(provider: ManagedProvider): void {
    this.providers.set(provider.id, provider);
    if (!this.health.has(provider.id)) {
      this.health.set(provider.id, {
        id: provider.id,
        label: provider.label,
        status: "unknown",
        priority: provider.priority,
        capabilities: provider.capabilities,
        limits: provider.limits,
        checkedAt: 0,
      });
    }
  }

  async check(id: string): Promise<ProviderHealth | undefined> {
    const provider = this.providers.get(id);
    if (!provider) return undefined;
    const previous = this.health.get(id)!;
    try {
      const ok = provider.healthCheck ? await provider.healthCheck() : true;
      const next = { ...previous, status: ok ? "healthy" as const : "degraded" as const, lastFailure: undefined, checkedAt: Date.now() };
      this.health.set(id, next);
      return next;
    } catch (error) {
      const next = {
        ...previous,
        status: "offline" as const,
        lastFailure: error instanceof Error ? error.message : "Provider unavailable",
        checkedAt: Date.now(),
      };
      this.health.set(id, next);
      return next;
    }
  }

  recordFailure(id: string, reason: string, status: ProviderStatus = "degraded"): void {
    const previous = this.health.get(id);
    if (!previous) return;
    this.health.set(id, { ...previous, status, lastFailure: reason, checkedAt: Date.now() });
  }

  snapshot(): ProviderHealth[] {
    return [...this.health.values()].sort((a, b) => a.priority - b.priority);
  }
}

export const mapProviders = new ProviderManager();
