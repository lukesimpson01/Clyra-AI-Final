/**
 * Real Chromium smoke for the CURRENT voice-call controller:
 * React VoiceCallHost -> dictation WebSocket -> typed/voiced turns ->
 * durable mission correction -> persistent call controls.
 *
 * The media device is fake and the backends are deterministic test doubles.
 * This validates UI and protocol wiring, NOT real speech accuracy, TTS audio,
 * DeepSeek latency, or a physical microphone.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = (process.env.CLYRA_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const missionId = "voice-ui-smoke-mission";
let starts = 0;
const revisions = [];
let objective = "Research competitors";

const mission = (state = "EXECUTING") => ({
  id: missionId,
  state,
  plan: {
    objective,
    steps: [{ id: "research", description: "Research the brief", toolId: "browser.search", status: "running" }],
  },
});
const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    class LocalVoiceSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onopen = null;
      onclose = null;
      onerror = null;
      onmessage = null;
      constructor() {
        window.__clyraVoiceSmokeSocket = this;
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.({});
          this.onmessage?.({ data: JSON.stringify({ type: "pipeline_mode", sessionId: "voice-ui-smoke" }) });
        }, 20);
      }
      send(payload) {
        try {
          const body = JSON.parse(payload);
          if (body.type === "partial") {
            this.onmessage?.({ data: JSON.stringify({ type: "partial_done" }) });
          }
        } catch { /* only JSON messages are used on this socket */ }
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
    }
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        if (String(url).startsWith("ws://voice-smoke.invalid")) return new LocalVoiceSocket();
        super(url, protocols);
      }
    };
  });
  await page.route("**/voice/session", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, sessionId: "voice-ui-smoke", websocketUrl: "ws://voice-smoke.invalid/stream" }),
  }));
  await page.route("**/voice/end", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }),
  }));
  await page.route("**/api/agent/missions/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === "/api/agent/missions/start") {
      starts += 1;
      objective = request.postDataJSON().prompt;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/revise")) {
      const instruction = request.postDataJSON().instruction;
      revisions.push(instruction);
      objective += "\\nFollow-up instruction: " + instruction;
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/resume")) {
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    if (path.endsWith("/pause")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission("PAUSED") }) });
    }
    if (path.endsWith("/stop")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission("CANCELLED") }) });
    }
    if (path === `/api/agent/missions/${missionId}`) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mission: mission() }) });
    }
    return route.continue();
  });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for the installed React voice controller itself. The chat composer
  // may not be visible while the workspace opens on another app tab.
  await page.waitForFunction(() => document.documentElement.dataset.clyraVoiceController === "ready", { timeout: 30_000 });
  // The event is also what the real chat/command palette uses.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("clyra:voice-call", { detail: { action: "start" } })));
  await page.locator(".clyra-voice-call").waitFor({ timeout: 15_000 });
  await page.locator('.clyra-voice-call[data-state="ready"]').waitFor({ timeout: 15_000 });
  const call = page.locator(".clyra-voice-call");
  await call.getByRole("button", { name: "Type a message" }).click();
  await call.locator(".clyra-voice-composer-v2__input").fill("Research competitors");
  await call.locator(".clyra-voice-composer-v2__send").click();
  await call.locator(".clyra-voice-agent-bar").getByRole("button", { name: "Chat", exact: true }).waitFor({ timeout: 12_000 });
  assert.equal(starts, 1, "first turn starts one mission");
  await call.getByRole("button", { name: "Mute microphone" }).first().click();
  await call.getByRole("button", { name: "Unmute microphone" }).first().click();
  await call.locator(".clyra-voice-agent-bar").getByRole("button", { name: "Chat", exact: true }).click();
  await call.locator(".clyra-voice-composer-v2__input").fill("Actually focus on TikTok and Instagram, and keep the budget under $500");
  const revisedRequest = page.waitForResponse((response) => response.url().includes("/revise") && response.request().method() === "POST", { timeout: 12_000 });
  await call.locator(".clyra-voice-composer-v2__send").click();
  await revisedRequest;
  assert.equal(starts, 1, "correction modifies existing mission instead of starting a second");
  assert.equal(revisions.length, 1, "correction is sent to mission revision route");
  assert.match(revisions[0], /TikTok and Instagram/);
  await call.getByRole("button", { name: "End call" }).first().click();
  await page.locator(".clyra-voice-call").waitFor({ state: "detached", timeout: 10_000 });
  console.log("voice-call-live-smoke: React call controls, same-mission correction and clean ending passed");
} finally {
  await browser.close();
}
