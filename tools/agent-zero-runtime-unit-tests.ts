import assert from "node:assert/strict";
import { AgentZeroRuntimeBridge } from "../lib/clyra-agent/agent-zero-runtime";

async function run() {
  const absent = new AgentZeroRuntimeBridge({ endpoint: "" });
  assert.deepEqual(await absent.status(), {
    configured: false,
    connected: false,
    reason: "No local Agent Zero runtime is configured.",
  });

  let requested = "";
  const healthy = new AgentZeroRuntimeBridge({
    endpoint: "http://127.0.0.1:50080",
    token: "local-test-token",
    fetchImpl: (async (input) => {
      requested = String(input);
      return new Response(null, { status: 200 });
    }) as typeof fetch,
  });
  assert.deepEqual(await healthy.status(), { configured: true, connected: true });
  assert.equal(requested, "http://127.0.0.1:50080/api/health");

  const unavailable = new AgentZeroRuntimeBridge({
    endpoint: "http://localhost:50080",
    fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  assert.deepEqual(await unavailable.status(), {
    configured: true,
    connected: false,
    reason: "The local Agent Zero runtime is not reachable.",
  });

  assert.throws(
    () => new AgentZeroRuntimeBridge({ endpoint: "https://agent-zero.example" }),
    /loopback HTTP\(S\) endpoint/,
  );
  console.log("Agent Zero local runtime bridge: 4 checks passed.");
}

void run();
