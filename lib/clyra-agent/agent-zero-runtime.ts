/**
 * Optional, local-only bridge to an Agent Zero runtime.
 *
 * Clyra owns the product experience and remains the orchestrator. Agent Zero
 * is deliberately not started here: a separately configured local runtime is
 * an opt-in capability, not an implicit Docker process or a public service.
 */
export type AgentZeroRuntimeStatus = {
  configured: boolean;
  connected: boolean;
  reason?: string;
};

type AgentZeroRuntimeOptions = {
  endpoint?: string;
  token?: string;
  fetchImpl?: typeof fetch;
};

function localRuntimeUrl(value: string): URL | null {
  if (!value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CLYRA_AGENT_ZERO_URL must be a valid local HTTP URL.");
  }
  const host = url.hostname.toLowerCase();
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (!/^https?:$/.test(url.protocol) || !loopbackHosts.has(host) || url.username || url.password) {
    throw new Error("Agent Zero must use an unauthenticated loopback HTTP(S) endpoint.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export class AgentZeroRuntimeBridge {
  private readonly endpoint: URL | null;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentZeroRuntimeOptions = {}) {
    this.endpoint = localRuntimeUrl(options.endpoint ?? process.env.CLYRA_AGENT_ZERO_URL ?? process.env.AGENT_ZERO_URL ?? "");
    this.token = String(options.token ?? process.env.CLYRA_AGENT_ZERO_TOKEN ?? "").trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async status(): Promise<AgentZeroRuntimeStatus> {
    if (!this.endpoint) {
      return {
        configured: false,
        connected: false,
        reason: "No local Agent Zero runtime is configured.",
      };
    }
    try {
      const headers = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
      const response = await this.fetchImpl(new URL("/api/health", this.endpoint), {
        headers,
        signal: AbortSignal.timeout(2_500),
      });
      if (!response.ok) {
        return { configured: true, connected: false, reason: `Health check returned HTTP ${response.status}.` };
      }
      return { configured: true, connected: true };
    } catch {
      return { configured: true, connected: false, reason: "The local Agent Zero runtime is not reachable." };
    }
  }
}
