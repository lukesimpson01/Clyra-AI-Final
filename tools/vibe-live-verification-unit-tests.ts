import assert from "node:assert/strict";
import { verifyLiveVibeProject } from "../src/lib/vibe-coder/live-browser-verification";

(globalThis as any).window = globalThis;

const URL = "http://127.0.0.1:39401/";
type Scenario = "pass" | "failed" | "empty" | "off-origin" | "no-key" | "preview-failed";

function fakeFetch(scenario: Scenario, calls: Array<{ url: string; input?: any }>) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const requestUrl = String(url);
    const input = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: requestUrl, input });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (requestUrl.endsWith("/api/vibe/preview/start")) {
      return json({ session: scenario === "preview-failed"
        ? { status: "build_failed", lastError: { message: "Cannot resolve module" } }
        : { status: "ready", url: URL } });
    }
    if (requestUrl === "/api/openbrowser/action") {
      return json({ ok: true, state: {
        activeTabId: input.action.type === "open_tab" ? "verification-tab" : "previous-user-tab",
        url: URL,
      } });
    }
    if (requestUrl === "/api/openbrowser/assist") {
      if (scenario === "no-key") return json({ ok: false, error: { message: "Browser intelligence needs a DeepSeek API key." } }, 503);
      const pieces = scenario === "empty" ? [] : [{
        type: "progress", phase: "executing", message: "Clicked the actual control",
        action: { type: "click" }, cursor: { x: 42, y: 27, kind: "click", at: Date.now() },
        state: { viewport: { width: 1440, height: 900 } },
      }];
      pieces.push({
        type: "complete", success: scenario !== "failed",
        content: scenario === "failed" ? "Submit button did not change the form state." : "Form worked.",
        evidence: scenario === "empty" ? [] : [{ url: URL, checks: ["Form input changed after click"] }],
        state: { url: scenario === "off-origin" ? "https://example.org/" : URL },
      });
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of pieces) {
            // Deliberately split a progress line to verify streamed parser buffering.
            const bytes = encoder.encode("data: " + JSON.stringify(event) + "\n\n");
            const middle = Math.floor(bytes.length / 2);
            controller.enqueue(bytes.subarray(0, middle));
            controller.enqueue(bytes.subarray(middle));
          }
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error("Unexpected request in browser test: " + requestUrl);
  };
}

const previousFetch = globalThis.fetch;
try {
  for (const scenario of ["pass", "failed", "empty", "off-origin", "no-key", "preview-failed"] as const) {
    const calls: Array<{ url: string; input?: any }> = [];
    (globalThis as any).fetch = fakeFetch(scenario, calls);
    const events: string[] = [];
    const run = verifyLiveVibeProject({
      projectId: "verification-fixture",
      request: "Fix the contact form and test submit button",
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event.message),
    });
    if (scenario === "pass") {
      const result = await run;
      assert.equal(result.testedSteps, 1);
      assert.equal(result.evidence[0].checks?.[0], "Form input changed after click");
      assert.ok(events.some(text => text.includes("actual control")));
      assert.equal(calls.filter(call => call.url === "/api/openbrowser/assist").length, 1);
    } else {
      const reason = scenario === "failed" ? /button did not change/ :
        scenario === "empty" ? /without any test actions/ :
        scenario === "off-origin" ? /local origin/ :
        scenario === "no-key" ? /API key/ : /Cannot resolve module/;
      await assert.rejects(run, reason);
    }
    assert.equal(calls.filter(call => call.url === "/api/openbrowser/action" &&
      call.input.action.type === "close_tab").length, scenario === "preview-failed" ? 0 : 1);
    console.log("PASS Vibe live browser verification: " + scenario);
  }
} finally {
  (globalThis as any).fetch = previousFetch;
}
